import {
  getPdfPageAspectRatio,
  getPdfPageInfo,
  getPdfPageRasterSourceInfo,
  loadPdfDocument,
  renderPdfPage,
  requestPdfDocumentCleanup,
} from "./loading/pdfLoader.js";

/**
 * An open PDF, for hosts that keep their own page model.
 *
 * {@link PdfPageSource} is the whole story when Riffle owns the pages — open a
 * file, hand the source to a viewer, done. A host that builds its own pages
 * (its own ordering, placement, or export pipeline) still needs the PDF itself:
 * page count, page geometry, and rasterisation. This exposes that much without
 * making the host ship a second PDF engine, and without exposing the worker
 * handles those calls are threaded through.
 */
export class PdfDocument {
  /**
   * @param {File|Blob|ArrayBuffer} data PDF bytes.
   * @returns {Promise<PdfDocument>} Opened document.
   */
  static async open(data) {
    const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    return new PdfDocument(await loadPdfDocument(buffer));
  }

  /**
   * Prefer {@link PdfDocument.open}; this wraps an already-loaded handle.
   *
   * @param {Object} handle Worker document handle.
   */
  constructor(handle) {
    this.handle = handle;
  }

  /** @returns {number} Number of pages. */
  get pageCount() {
    return this.handle?.numPages ?? 0;
  }

  /**
   * @param {number} pageNumber One-based page number.
   * @returns {Promise<number>} Page width divided by height.
   */
  getPageAspectRatio(pageNumber) {
    return getPdfPageAspectRatio(this.handle, pageNumber);
  }

  /**
   * @param {number} pageNumber One-based page number.
   * @returns {Promise<{width: number, height: number, aspectRatio: number}>} Page size in PDF points.
   */
  getPageInfo(pageNumber) {
    return getPdfPageInfo(this.handle, pageNumber);
  }

  /**
   * Raster metadata: the scale that reproduces the page's embedded image at its
   * native resolution, and whether the page has one at all (vector pages do
   * not, and can be rendered at any scale).
   *
   * @param {number} pageNumber One-based page number.
   * @param {Object} [options={}] Request options (`priority`).
   * @returns {Promise<Object>} Raster source information.
   */
  getRasterSourceInfo(pageNumber, options = {}) {
    return getPdfPageRasterSourceInfo(this.handle, pageNumber, options);
  }

  /**
   * @param {number} pageNumber One-based page number.
   * @param {number} scale Render scale.
   * @param {Object} [options={}] Render options (`downscaleTo`, `priority`).
   * @returns {Promise<ImageBitmap>} Rendered page bitmap.
   */
  renderPage(pageNumber, scale, options = {}) {
    return renderPdfPage(this.handle, pageNumber, scale, options);
  }

  /**
   * Releases the document's worker-side resources.
   *
   * @returns {void}
   */
  close() {
    requestPdfDocumentCleanup(this.handle);
  }
}
