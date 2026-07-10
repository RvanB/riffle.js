const PDFIUM_URL = "https://unpkg.com/@hyzyla/pdfium@2.1.13/dist/index.esm.cdn.js";
const MAX_PDFIUM_RENDER_EDGE = 8192;

let pdfiumPromise = null;
function getPdfiumLibrary() {
  if (!pdfiumPromise) {
    pdfiumPromise = import(PDFIUM_URL)
      .then(mod => mod.PDFiumLibrary.init({ disableCDNWarning: true }));
  }
  return pdfiumPromise;
}

function computeTargetSize(sourceWidth, sourceHeight, maxEdge) {
  const safeMaxEdge = Math.max(1, Math.round(maxEdge || 1));
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  if (sourceMaxEdge <= safeMaxEdge) {
    return {
      width: Math.max(1, Math.round(sourceWidth)),
      height: Math.max(1, Math.round(sourceHeight)),
    };
  }
  const scale = safeMaxEdge / sourceMaxEdge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function downscaleToTarget(source, targetWidth, targetHeight) {
  const downscaled = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = downscaled.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return downscaled.transferToImageBitmap();
}

function bitmapToImageData(data, width, height) {
  const rgba = data instanceof Uint8ClampedArray
    ? data
    : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return new ImageData(rgba, width, height);
}

function closePdfiumPage(page) {
  if (!page?.module || typeof page.pageIdx !== "number") return;
  page.module._FPDF_ClosePage(page.pageIdx);
}

function getPageInfo(page) {
  const { originalWidth, originalHeight } = page.getOriginalSize();
  return {
    width: originalWidth,
    height: originalHeight,
    aspectRatio: originalWidth / originalHeight,
  };
}

const docs = new Map();
const cleanupPending = new Set();
const activeOps = new Map();
let nextDocId = 1;

function bumpOps(docId) {
  activeOps.set(docId, (activeOps.get(docId) || 0) + 1);
}

function dropOps(docId) {
  const remaining = Math.max(0, (activeOps.get(docId) || 1) - 1);
  if (remaining === 0) activeOps.delete(docId);
  else activeOps.set(docId, remaining);
  maybeCleanup(docId);
}

function maybeCleanup(docId) {
  if (!cleanupPending.has(docId)) return;
  if ((activeOps.get(docId) || 0) > 0) return;
  cleanupPending.delete(docId);
  docs.get(docId)?.destroy?.();
  docs.delete(docId);
}

async function withPdfiumDocument(docId, work) {
  const doc = docs.get(docId);
  if (!doc) throw new Error(`Unknown PDFium docId: ${docId}`);
  bumpOps(docId);
  try {
    return await work(doc);
  } finally {
    dropOps(docId);
  }
}

const handlers = {
  async loadDocument({ buffer }) {
    const library = await getPdfiumLibrary();
    const doc = await library.loadDocument(new Uint8Array(buffer));
    const docId = nextDocId++;
    docs.set(docId, doc);
    return { docId, numPages: doc.getPageCount(), backend: "pdfium" };
  },

  async getAspectRatio({ docId, pageNum }) {
    return withPdfiumDocument(docId, doc => {
      const page = doc.getPage(pageNum - 1);
      try {
        return getPageInfo(page).aspectRatio;
      } finally {
        closePdfiumPage(page);
      }
    });
  },

  async getPageInfo({ docId, pageNum }) {
    return withPdfiumDocument(docId, doc => {
      const page = doc.getPage(pageNum - 1);
      try {
        return getPageInfo(page);
      } finally {
        closePdfiumPage(page);
      }
    });
  },

  async renderPage({ docId, pageNum, scale, downscaleTo = 0 }) {
    return withPdfiumDocument(docId, async doc => {
      const page = doc.getPage(pageNum - 1);
      const { width, height } = getPageInfo(page);
      const rawMaxEdge = Math.max(width * scale, height * scale);
      const effectiveScale = rawMaxEdge > MAX_PDFIUM_RENDER_EDGE
        ? scale * (MAX_PDFIUM_RENDER_EDGE / rawMaxEdge)
        : scale;
      const rendered = await page.render({
        scale: effectiveScale,
        colorSpace: "BGRA",
        render: "bitmap",
        renderFormFields: false,
        transparent: false,
      });
      const imageData = bitmapToImageData(rendered.data, rendered.width, rendered.height);
      const canvas = new OffscreenCanvas(imageData.width, imageData.height);
      canvas.getContext("2d").putImageData(imageData, 0, 0);
      if (downscaleTo > 0) {
        const { width: targetWidth, height: targetHeight } = computeTargetSize(canvas.width, canvas.height, downscaleTo);
        if (targetWidth !== canvas.width || targetHeight !== canvas.height) {
          return downscaleToTarget(canvas, targetWidth, targetHeight);
        }
      }
      return canvas.transferToImageBitmap();
    });
  },

  releaseDocument({ docId }) {
    if (!docs.has(docId)) return null;
    cleanupPending.add(docId);
    maybeCleanup(docId);
    return null;
  },

  requestCleanup({ docId }) {
    if (!docs.has(docId)) return null;
    return null;
  },
};

self.addEventListener("message", async event => {
  const { id, type, payload } = event.data;
  const handler = handlers[type];
  if (!handler) {
    self.postMessage({ id, ok: false, error: `Unknown message type: ${type}` });
    return;
  }

  try {
    const result = await handler(payload || {});
    const transfer = [];
    if (result instanceof ImageBitmap) transfer.push(result);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
