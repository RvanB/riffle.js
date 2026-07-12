import { PageSource } from "./PageSource.js";
import { SHARED_PREVIEW_SIZE } from "../previewSizing.js";
import { loadImageFile, loadImagePreview } from "../loading/imageLoader.js";

const DEFAULT_IMAGE_MIN_VISIBLE_EDGE = SHARED_PREVIEW_SIZE;

function getImageAspectRatio(page) {
  const aspectRatio = Number(page?.aspectRatio) || 0;
  return aspectRatio > 0 ? Math.max(0.01, aspectRatio) : 0;
}

function getAspectMatchedTargetPagePixels(page, targetPagePixels = null, fallbackHeight = 0) {
  const aspectRatio = getImageAspectRatio(page);
  if (aspectRatio <= 0) return null;
  const width = Math.max(0, Math.round(Number(targetPagePixels?.width) || 0));
  const height = Math.max(0, Math.round(Number(targetPagePixels?.height) || 0));
  if (width > 0 && height > 0) {
    const matchedHeight = Math.max(height, width / aspectRatio);
    return {
      width: Math.max(1, Math.round(matchedHeight * aspectRatio)),
      height: Math.max(1, Math.round(matchedHeight)),
    };
  }
  const fallback = Math.max(1, Math.round(Number(fallbackHeight) || SHARED_PREVIEW_SIZE));
  return {
    width: Math.max(1, Math.round(fallback * aspectRatio)),
    height: fallback,
  };
}

function getRequiredImageMaxEdge(page, targetPagePixels = null) {
  const target = getAspectMatchedTargetPagePixels(page, targetPagePixels, DEFAULT_IMAGE_MIN_VISIBLE_EDGE);
  if (!target) return 0;
  return Math.max(target.width, target.height);
}

function getAspectMatchedTargetForMaxEdge(page, maxEdge) {
  const aspectRatio = getImageAspectRatio(page);
  if (aspectRatio <= 0) return null;
  const edge = Math.max(1, Math.round(Number(maxEdge) || DEFAULT_IMAGE_MIN_VISIBLE_EDGE));
  if (aspectRatio >= 1) {
    return {
      width: edge,
      height: Math.max(1, Math.round(edge / aspectRatio)),
    };
  }
  return {
    width: Math.max(1, Math.round(edge * aspectRatio)),
    height: edge,
  };
}

// Callback-driven source for image-backed callers (like the demo or margin
// app) that maintain their own page model.
//
// Pass an options object with `getPageCount` and `getPageMetadata`. The
// metadata return value is opaque to the viewer beyond `{ aspectRatio,
// passthrough }`; the `passthrough` field becomes `viewerPage.metadata` for
// the renderer to read app-specific placement fields (crop, fitAxis, etc.)
// while older composition code still lives on host-owned page records.
//
// `getPagePreview` and `getPageHighRes` are optional overrides. When omitted,
// the source loads from `passthrough.source.file` using Riffle's image worker.
/**
 * Options for {@link ImagePageSource}.
 *
 * @typedef {Object} ImagePageSourceOptions
 * @property {function():number} getPageCount Returns viewer page count.
 * @property {function(number):PageMetadata|null} getPageMetadata Returns page metadata.
 * @property {function(number, Object=):Promise<CanvasImageSource|null>|null} [getPagePreview=null] Optional preview loader.
 * @property {function(number, number, Object=):Promise<CanvasImageSource|null>|null} [getPageHighRes=null] Optional high-resolution loader.
 * @property {Object|null} [internalBook=null] Optional mutable book object used directly by Riffle's lazy loader.
 */

/**
 * Callback-driven page source for host-owned page models.
 */
export class ImagePageSource extends PageSource {
  /**
   * @param {ImagePageSourceOptions} options Source callbacks.
   */
  constructor({
    getPageCount,
    getPageMetadata,
    getPagePreview = null,
    getPageHighRes = null,
    internalBook = null,
  }) {
    super();
    this._getPageCount = getPageCount;
    this._getPageMetadata = getPageMetadata;
    this._getPagePreview = getPagePreview;
    this._getPageHighRes = getPageHighRes;
    this._internalBook = internalBook;
  }

  // If the host owns the per-page mutable model that LazyPageLoader writes
  // to (margin's app.book is the canonical example), pass it via
  // `internalBook` — the viewer's lazy loader will operate directly on it.
  // When omitted, the source is bitmap-callback-driven and the viewer won't
  // try to write into a host-owned book.
  /**
   * Returns the optional host-owned mutable book.
   *
   * @returns {Object|null} Internal book, if supplied.
   */
  getInternalBook() { return this._internalBook; }

  /** @returns {number} Page count. */
  getPageCount() { return this._getPageCount(); }

  getTargetHighResWindowPageCount({ currentPageCount = 1 } = {}) {
    return Math.max(1, Math.round(Number(currentPageCount) || 1));
  }

  shouldRefreshPageSourceDuringAnimation(_index) {
    return false;
  }

  shouldWarmTargetHighResBeforeNavigation(_targetSpread, _options = {}) {
    return false;
  }

  /**
   * @param {number} index Page index.
   * @returns {PageMetadata|null} Page metadata.
   */
  getPageMetadata(index) { return this._getPageMetadata(index); }

  /**
   * @param {number} index Page index.
   * @returns {Promise<CanvasImageSource|null>} Preview bitmap.
   */
  async getPagePreview(index, {
    targetPagePixels = this.getPagePreviewTarget(index),
    maxEdge = SHARED_PREVIEW_SIZE,
    priority = "normal",
  } = {}) {
    if (this._getPagePreview) return this._getPagePreview(index, { targetPagePixels, maxEdge, priority });
    const page = this.getPageRecord(index);
    if (!page?.source?.file) return null;
    const aspectRatio = getImageAspectRatio(page);
    if (aspectRatio > 0) {
      return loadImageFile(page.source.file, {
        purpose: "preview",
        targetWidth: targetPagePixels.width,
        targetHeight: targetPagePixels.height,
        priority,
      });
    }
    const preview = await loadImagePreview(page.source.file, maxEdge, { priority });
    page.aspectRatio = preview.width / preview.height;
    return preview.canvas;
  }

  /**
   * @param {number} index Page index.
   * @param {number} targetEdgePx Requested maximum edge in pixels.
   * @returns {Promise<CanvasImageSource|null>} High-resolution bitmap.
   */
  getPageHighResStatus(index, { targetPagePixels = null } = {}) {
    const page = this.getPageRecord(index);
    if (!page) return { ready: false, shouldLoad: false, request: null };
    const requiredMaxEdge = getRequiredImageMaxEdge(page, targetPagePixels);
    page.requestedImageMaxEdge = page.loading
      ? Math.max(page.requestedImageMaxEdge || 0, requiredMaxEdge)
      : requiredMaxEdge;
    if (page.loading) return { ready: false, shouldLoad: false, request: null };
    const loadedMaxEdge = page.loadedImageMaxEdge || (
      page.srcCanvas ? Math.max(page.srcCanvas.width, page.srcCanvas.height) : 0
    );
    if (page.srcCanvas && loadedMaxEdge >= requiredMaxEdge) {
      return { ready: true, shouldLoad: false, request: null };
    }
    return {
      ready: false,
      shouldLoad: true,
      request: {
        targetMaxEdge: page.requestedImageMaxEdge || requiredMaxEdge || DEFAULT_IMAGE_MIN_VISIBLE_EDGE,
      },
    };
  }

  async getPageHighRes(index, request = {}) {
    const page = this.getPageRecord(index);
    if (!page?.source?.file) return null;
    if (this._getPageHighRes) {
      return this._getPageHighRes(index, request.targetMaxEdge, request);
    }
    const renderTarget = getAspectMatchedTargetForMaxEdge(page, request.targetMaxEdge);
    return renderTarget
      ? loadImageFile(page.source.file, {
          purpose: "high-res",
          targetWidth: renderTarget.width,
          targetHeight: renderTarget.height,
          priority: request.priority,
        })
      : loadImageFile(page.source.file, { priority: request.priority });
  }

  commitPageHighRes(index, { page = this.getPageRecord(index), bitmap = null } = {}) {
    if (!page || !bitmap) return;
    page.loadedImageMaxEdge = Math.max(bitmap.width, bitmap.height);
    page.aspectRatio = bitmap.width / bitmap.height;
  }

  cleanupPageHighRes(index, { page = this.getPageRecord(index) } = {}) {
    if (!page) return;
    page.loadedImageMaxEdge = 0;
    page.requestedImageMaxEdge = 0;
  }
}
