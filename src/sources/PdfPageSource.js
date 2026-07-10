import { PageSource } from "./PageSource.js";
import { loadPdfDocument, getPdfPageAspectRatio, getPdfPageInfo } from "../loading/pdfLoader.js";

const ASPECT_RATIO_WARNING_EPSILON = 0.001;

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
 * The PDF is rasterized lazily by the viewer's lazy page loader. This source
 * describes the page set, exposes an internal mutable book for the loader,
 * and warns in the console when page aspect ratios differ.
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
