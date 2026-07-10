const PDFJS_URL = "https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.mjs";
const PDF_WORKER_URL = "https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.worker.mjs";
const PDF_CMAP_URL = "https://unpkg.com/pdfjs-dist@5.6.205/cmaps/";
const PDF_STANDARD_FONT_DATA_URL = "https://unpkg.com/pdfjs-dist@5.6.205/standard_fonts/";
const PDF_WASM_URL = "https://unpkg.com/pdfjs-dist@5.6.205/wasm/";

const MAX_IN_FLIGHT = 2;
let mainPdfjsPromise = null;
const mainTextContentCache = new WeakMap();
const mainLinkAnnotationCache = new WeakMap();

function createWorkerClient(workerFile, label, { maxInFlight = MAX_IN_FLIGHT } = {}) {
  let worker = null;
  let workerPromise = null;
  let nextRequestId = 1;
  let inFlight = 0;
  const pending = new Map();
  const highPriorityQueue = [];
  const lowPriorityQueue = [];

  async function createWorker() {
    const workerUrl = new URL(workerFile, import.meta.url);
    let scriptUrl;
    if (workerUrl.origin === self.location.origin) {
      // Same origin (dev mode or self-hosted): load the worker file directly.
      // Cache-bust per page load — Firefox in particular caches module
      // workers aggressively and hard-reload doesn't always invalidate them.
      workerUrl.searchParams.set("v", String(Date.now()));
      scriptUrl = workerUrl.href;
    } else {
      // Cross-origin (CDN-hosted): browsers refuse to spawn a Worker from a
      // different origin even with permissive CORS. Fetch the worker source
      // and wrap it in a same-origin Blob URL.
      const response = await fetch(workerUrl, { mode: "cors" });
      if (!response.ok) throw new Error(`Failed to fetch ${workerFile}: ${response.status}`);
      const source = await response.text();
      const blob = new Blob([source], { type: "application/javascript" });
      scriptUrl = URL.createObjectURL(blob);
    }
    const w = new Worker(scriptUrl, { type: "module" });
    w.addEventListener("message", event => {
      if (event.data?.debug) { console.log(`[${label}]`, ...event.data.debug); return; }
      const { id, ok, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      inFlight = Math.max(0, inFlight - 1);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error));
      dispatch();
    });
    w.addEventListener("error", event => {
      console.error(`${label} worker error:`, event.message || event);
    });
    return w;
  }

  function ensureWorker() {
    if (worker) return Promise.resolve(worker);
    if (workerPromise) return workerPromise;
    workerPromise = createWorker().then(w => {
      worker = w;
      return w;
    });
    return workerPromise;
  }

  function dispatch() {
    while (inFlight < maxInFlight) {
      const entry = highPriorityQueue.shift() || lowPriorityQueue.shift();
      if (!entry) return;
      inFlight += 1;
      const id = nextRequestId++;
      pending.set(id, { resolve: entry.resolve, reject: entry.reject });
      ensureWorker().then(
        w => w.postMessage({ id, type: entry.type, payload: entry.payload }, entry.transfer),
        err => {
          pending.delete(id);
          inFlight = Math.max(0, inFlight - 1);
          entry.reject(err);
          dispatch();
        },
      );
    }
  }

  return function call(type, payload, { transfer = [], priority = false } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { type, payload, transfer, resolve, reject };
      if (priority) highPriorityQueue.push(entry);
      else lowPriorityQueue.push(entry);
      dispatch();
    });
  };
}

const pdfjsCall = createWorkerClient("./pdfWorker.js", "PDF.js");
const pdfiumCall = createWorkerClient("./pdfiumWorker.js", "PDFium");

function getMainPdfjs() {
  if (!mainPdfjsPromise) {
    mainPdfjsPromise = import(PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return lib;
    });
  }
  return mainPdfjsPromise;
}

function getPageCache(cache, pdfDoc) {
  let docCache = cache.get(pdfDoc);
  if (!docCache) {
    docCache = new Map();
    cache.set(pdfDoc, docCache);
  }
  return docCache;
}

async function getMainThreadPdfDocument(pdfDoc) {
  if (!pdfDoc?._mainThreadPdfBytes) return null;
  if (!pdfDoc._mainThreadPdfDocumentPromise) {
    const data = pdfDoc._mainThreadPdfBytes.slice(0);
    pdfDoc._mainThreadPdfDocumentPromise = getMainPdfjs().then(lib => lib.getDocument({
      data,
      cMapUrl: PDF_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      wasmUrl: PDF_WASM_URL,
      disableFontFace: true,
    }).promise);
  }
  return pdfDoc._mainThreadPdfDocumentPromise;
}

async function getMainThreadTextContent(pdfDoc, pageNum) {
  const cache = getPageCache(mainTextContentCache, pdfDoc);
  if (!cache.has(pageNum)) {
    cache.set(pageNum, (async () => {
      const doc = await getMainThreadPdfDocument(pdfDoc);
      if (!doc) throw new Error("PDF document is not available on the main thread");
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
        disableCombineTextItems: true,
      });
      return {
        width: viewport.width,
        height: viewport.height,
        transform: viewport.transform,
        styles: Object.fromEntries(
          Object.entries(textContent.styles || {}).map(([name, style]) => [
            name,
            {
              fontFamily: style.fontFamily || "",
              ascent: Number(style.ascent) || 0,
              descent: Number(style.descent) || 0,
              vertical: !!style.vertical,
            },
          ])
        ),
        items: (textContent.items || [])
          .filter(item => item?.str)
          .map(item => ({
            str: item.str,
            dir: item.dir || "ltr",
            fontName: item.fontName || "",
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
            transform: item.transform,
          })),
      };
    })());
  }
  return cache.get(pageNum);
}

async function getMainThreadLinkAnnotations(pdfDoc, pageNum) {
  const cache = getPageCache(mainLinkAnnotationCache, pdfDoc);
  if (!cache.has(pageNum)) {
    cache.set(pageNum, (async () => {
      const doc = await getMainThreadPdfDocument(pdfDoc);
      if (!doc) throw new Error("PDF document is not available on the main thread");
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations({ intent: "display" });
      const links = [];
      for (const annotation of annotations || []) {
        if (annotation?.subtype !== "Link" || !annotation.rect) continue;
        let destPageNum = 0;
        if (annotation.dest && doc?.getDestination && doc?.getPageIndex) {
          try {
            const dest = typeof annotation.dest === "string"
              ? await doc.getDestination(annotation.dest)
              : annotation.dest;
            const ref = Array.isArray(dest) ? dest[0] : null;
            if (ref) destPageNum = (await doc.getPageIndex(ref)) + 1;
          } catch (_error) {
            destPageNum = 0;
          }
        }
        links.push({
          rect: annotation.rect,
          url: annotation.url || annotation.unsafeUrl || "",
          destPageNum,
          title: annotation.title || "",
        });
      }
      return {
        width: viewport.width,
        height: viewport.height,
        transform: viewport.transform,
        links,
      };
    })());
  }
  return cache.get(pageNum);
}

async function getPdfJsWorkerDocId(pdfDoc) {
  if (!pdfDoc?._mainThreadPdfBytes) {
    if (pdfDoc?.docId && pdfDoc?._pdfBackend !== "pdfium") return pdfDoc.docId;
    throw new Error("PDF.js worker document bytes are not available");
  }
  if (!pdfDoc._pdfjsWorkerDocumentPromise) {
    pdfDoc._pdfjsWorkerDocumentPromise = (async () => {
      const buffer = pdfDoc._mainThreadPdfBytes.slice(0);
      const result = await pdfjsCall("loadDocument", { buffer }, { transfer: [buffer] });
      pdfDoc._pdfjsWorkerDocId = result.docId;
      return result.docId;
    })();
  }
  return pdfDoc._pdfjsWorkerDocumentPromise;
}

/**
 * Loads a PDF document in the worker.
 *
 * @param {ArrayBuffer} buffer PDF data.
 * @returns {Promise<Object>} Worker document handle.
 */
export async function loadPdfDocument(buffer) {
  const mainThreadBytes = buffer instanceof ArrayBuffer ? buffer.slice(0) : null;
  const transferable = buffer instanceof ArrayBuffer ? [buffer] : [];
  const pdfDoc = await pdfiumCall("loadDocument", { buffer }, { transfer: transferable });
  if (mainThreadBytes) {
    Object.defineProperties(pdfDoc, {
      _pdfBackend: { value: "pdfium" },
      _mainThreadPdfBytes: { value: mainThreadBytes },
      _mainThreadPdfDocumentPromise: { value: null, writable: true },
      _pdfjsWorkerDocumentPromise: { value: null, writable: true },
      _pdfjsWorkerDocId: { value: 0, writable: true },
    });
  }
  return pdfDoc;
}

/**
 * Returns a PDF page aspect ratio.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @returns {Promise<number>} Page width divided by page height.
 */
export async function getPdfPageAspectRatio(pdfDoc, pageNum) {
  return pdfiumCall("getAspectRatio", { docId: pdfDoc.docId, pageNum });
}

/**
 * Returns a PDF page's native point size.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @returns {Promise<{width:number,height:number,aspectRatio:number}>} Page size in PDF points.
 */
export async function getPdfPageInfo(pdfDoc, pageNum) {
  return pdfiumCall("getPageInfo", { docId: pdfDoc.docId, pageNum });
}

/**
 * Returns raster source information for a PDF page.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @param {Object} [options={}] Request options.
 * @param {boolean} [options.priority=false] If true, queue ahead of low-priority renders.
 * @returns {Promise<Object>} Raster source information.
 */
export async function getPdfPageRasterSourceInfo(pdfDoc, pageNum, { priority = false } = {}) {
  const docId = await getPdfJsWorkerDocId(pdfDoc);
  return pdfjsCall("getRasterInfo", { docId, pageNum }, { priority });
}

/**
 * Returns selectable text content for a PDF page.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @returns {Promise<Object>} Page viewport info and text items.
 */
export async function getPdfPageTextContent(pdfDoc, pageNum, { priority = false } = {}) {
  try {
    return await getMainThreadTextContent(pdfDoc, pageNum);
  } catch (_error) {
    // Fall back to the worker path for externally-created document handles or
    // browsers that reject the duplicate main-thread PDF.js document.
  }
  const docId = await getPdfJsWorkerDocId(pdfDoc);
  return pdfjsCall("getTextContent", { docId, pageNum }, { priority });
}

/**
 * Returns link annotations for a PDF page.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @returns {Promise<Object>} Page viewport info and link annotations.
 */
export async function getPdfPageLinkAnnotations(pdfDoc, pageNum, { priority = false } = {}) {
  try {
    return await getMainThreadLinkAnnotations(pdfDoc, pageNum);
  } catch (_error) {
    // Fall back to the worker path for externally-created document handles or
    // browsers that reject the duplicate main-thread PDF.js document.
  }
  const docId = await getPdfJsWorkerDocId(pdfDoc);
  return pdfjsCall("getLinkAnnotations", { docId, pageNum }, { priority });
}

/**
 * Renders a PDF page at a scale.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @param {number} pageNum One-based PDF page number.
 * @param {number} scale Render scale.
 * @param {Object} [options={}] Render options.
 * @param {number} [options.downscaleTo=0] If positive, downscale to this maximum edge before transfer.
 * @param {boolean} [options.priority=false] If true, queue ahead of low-priority renders.
 * @returns {Promise<ImageBitmap>} Rendered page bitmap.
 */
export async function renderPdfPage(pdfDoc, pageNum, scale, { downscaleTo = 0, priority = false } = {}) {
  return pdfiumCall(
    "renderPage",
    { docId: pdfDoc.docId, pageNum, scale, downscaleTo },
    { priority },
  );
}

/**
 * Requests worker cleanup for a PDF document.
 *
 * @param {Object} pdfDoc Worker document handle.
 * @returns {void}
 */
export function requestPdfDocumentCleanup(pdfDoc) {
  if (!pdfDoc?.docId) return;
  pdfiumCall("requestCleanup", { docId: pdfDoc.docId }).catch(() => {});
  if (pdfDoc._pdfjsWorkerDocId) {
    pdfjsCall("requestCleanup", { docId: pdfDoc._pdfjsWorkerDocId }).catch(() => {});
  } else if (pdfDoc._pdfjsWorkerDocumentPromise) {
    pdfDoc._pdfjsWorkerDocumentPromise
      .then(docId => pdfjsCall("requestCleanup", { docId }).catch(() => {}))
      .catch(() => {});
  }
}
