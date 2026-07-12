import { PageSource } from "./PageSource.js";
import {
  loadPdfDocument,
  getPdfPageAspectRatio,
  getPdfPageInfo,
  renderPdfPage,
  requestPdfDocumentCleanup,
} from "../loading/pdfLoader.js";

const ASPECT_RATIO_WARNING_EPSILON = 0.001;
const DEFAULT_PDF_MIN_VISIBLE_RENDER_SCALE = 0.25;

function getVisiblePdfRenderScale(page, targetPagePixels = null) {
  const width = Number(targetPagePixels?.width) || 0;
  const height = Number(targetPagePixels?.height) || 0;
  const pdfWidth = Number(page?.pdfPointWidth) || 0;
  const pdfHeight = Number(page?.pdfPointHeight) || 0;
  if (width <= 0 || height <= 0 || pdfWidth <= 0 || pdfHeight <= 0) return 0;
  return Math.max(width / pdfWidth, height / pdfHeight);
}

function capPdfRenderScale(scale, { pdfMaxRenderScale = 1.5 } = {}) {
  return pdfMaxRenderScale > 0 ? Math.min(scale, pdfMaxRenderScale) : scale;
}

function getPdfRenderScaleForTarget(page, targetPagePixels, {
  pdfMaxRenderScale = 1.5,
  headroom = 1,
  minScale = 0,
} = {}) {
  const visibleScale = getVisiblePdfRenderScale(page, targetPagePixels);
  if (visibleScale <= 0) return 0;
  return capPdfRenderScale(Math.max(minScale, visibleScale) * headroom, { pdfMaxRenderScale });
}

function getRequiredPdfRenderScale(page, previewZoom = 1, {
  targetPagePixels = null,
  targetPdfRenderScale = 0,
  pdfRenderScale = 1.5,
  pdfRenderScaleHeadroom = 1.1,
  pdfMaxRenderScale = 1.5,
  devicePixelRatio = 1,
} = {}) {
  const visibleScale = getPdfRenderScaleForTarget(page, targetPagePixels, {
    pdfMaxRenderScale,
    headroom: pdfRenderScaleHeadroom,
    minScale: DEFAULT_PDF_MIN_VISIBLE_RENDER_SCALE,
  });
  if (visibleScale > 0) return visibleScale;
  const highResPixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
  const minimumHighResScale = pdfRenderScale * highResPixelRatio;
  const requestedScale = Math.max(
    minimumHighResScale,
    targetPdfRenderScale || 0,
    pdfRenderScale * Math.max(1, previewZoom || 1) * highResPixelRatio
  ) * pdfRenderScaleHeadroom;
  return capPdfRenderScale(requestedScale, { pdfMaxRenderScale });
}

// A "Page" shaped to match what LazyPageLoader writes to (mutable
// srcCanvas/previewCanvas fields, a `source` describing the backing
// rasterization). The viewer's ViewerPage proxies these via `metadata`.
function makePdfPage(pdfDoc, pageNum, pageInfo) {
  const aspectRatio = pageInfo.aspectRatio || pageInfo.width / pageInfo.height;
  return {
    source: { type: "pdf", pdfDoc, pageNum },
    ocrTextContent: null,
    aspectRatio,
    pdfPointWidth: pageInfo.width,
    pdfPointHeight: pageInfo.height,
    srcCanvas: null,
    previewCanvas: null,
    thumbnailSourceCanvas: null,
    displayCanvasOverride: null,
    placedPreviewCanvas: null,
    loading: false,
    loadedPdfRenderScale: 0,
    requestedPdfRenderScale: 0,
    crop: { top: 0, left: 0, right: 0, bottom: 0 },
    cropSourceWidth: 0,
    cropSourceHeight: 0,
    cover: true,
    spread: false,
    fitAxis: "inside",
    contentAlignX: null,
    contentAlignY: "center",
    get displayCanvas() { return this.displayCanvasOverride || this.srcCanvas || this.previewCanvas || null; },
    get thumbnailCanvas() { return this.placedPreviewCanvas || this.thumbnailSourceCanvas || this.previewCanvas || this.srcCanvas || null; },
    getCropFor() { return { ...this.crop }; },
    setCropFor(_canvas, crop) { this.crop = { ...this.crop, ...crop }; },
  };
}

function warnIfMixedPageAspectRatios(aspectRatios) {
  if (aspectRatios.length < 2) return;
  const baseline = aspectRatios[0];
  const mismatches = aspectRatios
    .map((aspectRatio, index) => ({ page: index + 1, aspectRatio }))
    .filter(({ aspectRatio }) => Math.abs(aspectRatio - baseline) > ASPECT_RATIO_WARNING_EPSILON);

  if (!mismatches.length) return;
  console.warn(
    "[Riffle] Loaded PDF has mixed page aspect ratios. " +
      `Page 1 is ${baseline.toFixed(4)}; ` +
      mismatches
        .slice(0, 12)
        .map(({ page, aspectRatio }) => `page ${page} is ${aspectRatio.toFixed(4)}`)
        .join(", ") +
      (mismatches.length > 12 ? `, and ${mismatches.length - 12} more` : "") +
      "."
  );
}

/**
 * PDF-backed page source.
 *
 * The source describes the page set, owns PDF preview/high-res rasterization,
 * exposes an internal mutable book for bitmap cache fields, and warns in the
 * console when page aspect ratios differ.
 */
export class PdfPageSource extends PageSource {
  constructor() {
    super();
    this.pdfDoc = null;
    this.pages = [];
    const source = this;
    this.book = {
      get pages() { return source.pages; },
      numSpreads() { return Math.max(1, Math.ceil((source.pages.length + 1) / 2)); },
      spreadPages(spreadIndex) {
        const leftIndex = spreadIndex * 2 - 1;
        const rightIndex = spreadIndex * 2;
        return [
          leftIndex >= 0 ? source.pages[leftIndex] ?? null : null,
          source.pages[rightIndex] ?? null,
        ];
      },
      spreadPageEntries(spreadIndex) {
        const leftIndex = spreadIndex * 2 - 1;
        const rightIndex = spreadIndex * 2;
        return {
          left: {
            page: leftIndex >= 0 ? source.pages[leftIndex] ?? null : null,
            pageIndex: leftIndex,
            showThroughPage: leftIndex - 1 >= 0 ? source.pages[leftIndex - 1] ?? null : null,
          },
          right: {
            page: source.pages[rightIndex] ?? null,
            pageIndex: rightIndex,
            showThroughPage: source.pages[rightIndex + 1] ?? null,
          },
        };
      },
    };
  }

  /**
   * Loads a PDF file or ArrayBuffer.
   *
   * @param {File|ArrayBuffer} file PDF file or binary buffer.
   * @returns {Promise<void>}
   */
  async openPdf(file) {
    const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const pdfDoc = await loadPdfDocument(buffer);
    this.pdfDoc = pdfDoc;
    const aspectRatios = [];
    const pages = [];
    for (let i = 0; i < pdfDoc.numPages; i++) {
      let pageInfo;
      try {
        pageInfo = await getPdfPageInfo(pdfDoc, i + 1);
      } catch (_error) {
        const aspectRatio = await getPdfPageAspectRatio(pdfDoc, i + 1);
        pageInfo = { width: 0, height: 0, aspectRatio };
      }
      const aspectRatio = pageInfo.aspectRatio || pageInfo.width / pageInfo.height;
      aspectRatios.push(aspectRatio);
      pages.push(makePdfPage(pdfDoc, i + 1, pageInfo));
    }
    warnIfMixedPageAspectRatios(aspectRatios);
    this.pages = pages;
    this.notifyPageCountChanged();
  }

  /**
   * Returns the mutable book used by Riffle's lazy page loader.
   *
   * @returns {Object} Internal book.
   */
  getInternalBook() { return this.book; }

  /** @returns {number} Page count. */
  getPageCount() { return this.pages.length; }

  /**
   * @param {number} index Page index.
   * @returns {PageMetadata|null} Page metadata.
   */
  getPageMetadata(index) {
    const page = this.pages[index] ?? null;
    if (!page) return null;
    return { aspectRatio: page.aspectRatio, passthrough: page };
  }

  async getPagePreview(index, {
    targetPagePixels = this.getPagePreviewTarget(index),
    priority = "normal",
    pdfPreviewSourceScale = 0.5,
    pdfMaxRenderScale = 1.5,
  } = {}) {
    const page = this.pages[index];
    if (!page) return null;
    const previewScale = getPdfRenderScaleForTarget(page, targetPagePixels, { pdfMaxRenderScale }) || pdfPreviewSourceScale;
    const previewMaxEdge = Math.max(targetPagePixels.width, targetPagePixels.height);
    return renderPdfPage(
      page.source.pdfDoc,
      page.source.pageNum,
      previewScale,
      { downscaleTo: previewMaxEdge, priority }
    );
  }

  getPageHighResStatus(index, {
    previewZoom = 1,
    targetPagePixels = null,
    targetPdfRenderScale = 0,
    renderConfig = {},
  } = {}) {
    const page = this.pages[index];
    if (!page) return { ready: false, shouldLoad: false, request: null };
    const requestedScale = getRequiredPdfRenderScale(page, previewZoom, {
      targetPagePixels,
      targetPdfRenderScale,
      ...renderConfig,
    });
    page.requestedPdfRenderScale = page.loading
      ? Math.max(page.requestedPdfRenderScale || 0, requestedScale)
      : requestedScale;
    if (page.loading) return { ready: false, shouldLoad: false, request: null };
    const loadedScale = page.loadedPdfRenderScale || 0;
    if (page.srcCanvas && loadedScale >= requestedScale) {
      return { ready: true, shouldLoad: false, request: null };
    }
    const renderScale = capPdfRenderScale(page.requestedPdfRenderScale || requestedScale, renderConfig);
    return {
      ready: false,
      shouldLoad: true,
      request: {
        renderScale,
        requestedScale,
        priority: renderConfig.priority,
      },
    };
  }

  async getPageHighRes(index, { renderScale, priority = "normal" } = {}) {
    const page = this.pages[index];
    if (!page) return null;
    return renderPdfPage(page.source.pdfDoc, page.source.pageNum, renderScale, { priority });
  }

  commitPageHighRes(index, { page = this.pages[index], request = {}, bitmap = null } = {}) {
    if (!page) return;
    page.loadedPdfRenderScale = request.renderScale || page.requestedPdfRenderScale || page.loadedPdfRenderScale || 0;
    if (bitmap) page.aspectRatio = bitmap.width / bitmap.height;
  }

  cleanupPageHighRes(index, { page = this.pages[index] } = {}) {
    if (!page) return;
    page.loadedPdfRenderScale = 0;
    page.requestedPdfRenderScale = 0;
    requestPdfDocumentCleanup(page.source.pdfDoc);
  }

  /**
   * Attaches externally-generated text content to PDF pages.
   *
   * @param {Object[]} pages Text content pages, such as parsed hOCR pages.
   * @param {Object} [options={}] Attachment options.
   * @param {number} [options.pageOffset=0] Zero-based destination page offset.
   * @returns {number} Number of pages attached.
   */
  attachTextContent(pages, { pageOffset = 0 } = {}) {
    if (!Array.isArray(pages)) throw new TypeError("attachTextContent: pages must be an array");
    let count = 0;
    for (let i = 0; i < pages.length; i += 1) {
      const page = this.pages[pageOffset + i];
      if (!page) continue;
      page.ocrTextContent = pages[i] || null;
      this.notifyPageChanged(pageOffset + i);
      count += 1;
    }
    return count;
  }
}
