/**
 * Abstract bridge between a viewer and the underlying page provider.
 *
 * Subclasses provide page count, metadata, preview bitmaps, and high
 * resolution bitmaps. Sources emit `pagechanged` and `pagecountchanged`
 * when those values change.
 */
export class PageSource {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribes to a source event.
   *
   * @param {string} event Event name.
   * @param {Function} fn Listener callback.
   * @returns {Function} Unsubscribe function.
   */
  on(event, fn) {
    let arr = this.listeners.get(event);
    if (!arr) {
      arr = [];
      this.listeners.set(event, arr);
    }
    arr.push(fn);
    return () => this.off(event, fn);
  }

  /**
   * Removes a source event listener.
   *
   * @param {string} event Event name.
   * @param {Function} fn Listener callback.
   * @returns {void}
   */
  off(event, fn) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  /**
   * Emits a source event.
   *
   * @param {string} event Event name.
   * @param {...*} args Event arguments.
   * @returns {void}
   */
  emit(event, ...args) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of arr.slice()) fn(...args);
  }

  /**
   * Emits `pagechanged` for a page index.
   *
   * @param {number} index Page index.
   * @returns {void}
   */
  notifyPageChanged(index) { this.emit("pagechanged", index); }

  /**
   * Emits `pagecountchanged`.
   *
   * @returns {void}
   */
  notifyPageCountChanged() { this.emit("pagecountchanged"); }

  /**
   * Returns the number of pages exposed by this source.
   *
   * @abstract
   * @returns {number} Page count.
   */
  getPageCount() { throw new Error("PageSource.getPageCount not implemented"); }

  /**
   * Returns metadata for a page.
   *
   * @abstract
   * @param {number} _index Page index.
   * @returns {PageMetadata|null} Page metadata.
   */
  getPageMetadata(_index) { throw new Error("PageSource.getPageMetadata not implemented"); }

  /**
   * Returns the mutable page record used for bitmap cache fields.
   *
   * Sources that expose an internal book usually return one of its pages.
   * Callback-driven sources may return metadata.passthrough instead.
   *
   * @param {number} index Page index.
   * @returns {Object|null} Mutable page record.
   */
  getPageRecord(index) {
    const internalPage = this.getInternalBook?.()?.pages?.[index];
    if (internalPage) return internalPage;
    try {
      return this.getPageMetadata(index)?.passthrough ?? null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Returns the page loading kind, such as "pdf" or "image".
   *
   * @param {number} index Page index.
   * @returns {string} Page kind.
   */
  getPageKind(index) {
    return this.getPageRecord(index)?.source?.type || "";
  }

  /**
   * Returns the target preview bitmap size for a page.
   *
   * @param {number} index Page index.
   * @param {Object} [options={}] Preview options.
   * @param {number} [options.maxEdge] Maximum preview edge.
   * @returns {{width:number,height:number}} Target size.
   */
  getPagePreviewTarget(index, { maxEdge = 96 } = {}) {
    const page = this.getPageRecord(index);
    const height = Math.max(1, Math.round(Number(maxEdge) || 96));
    const aspectRatio = Math.max(0.01, Number(page?.aspectRatio) || 1);
    return {
      width: Math.max(1, Math.round(height * aspectRatio)),
      height,
    };
  }

  /**
   * Returns a preview bitmap for a page.
   *
   * @abstract
   * @param {number} _index Page index.
   * @param {Object} [_options={}] Preview load options.
   * @returns {Promise<CanvasImageSource|null>} Preview bitmap.
   */
  async getPagePreview(_index, _options = {}) { return null; }

  /**
   * Returns high-resolution cache status and the source-specific request to load.
   *
   * @param {number} index Page index.
   * @param {Object} [options={}] Status options.
   * @returns {{ready:boolean,shouldLoad:boolean,request:Object|null}} Status.
   */
  getPageHighResStatus(index, _options = {}) {
    const page = this.getPageRecord(index);
    return { ready: !!page?.srcCanvas, shouldLoad: false, request: null };
  }

  /**
   * Returns a high-resolution bitmap for a page.
   *
   * @abstract
   * @param {number} _index Page index.
   * @param {Object} [_request={}] Source-specific request.
   * @returns {Promise<CanvasImageSource|null>} High-resolution bitmap.
   */
  async getPageHighRes(_index, _request = {}) { return null; }

  /**
   * Records source-specific high-resolution cache metadata after a load.
   *
   * @param {number} _index Page index.
   * @param {Object} _options Commit options.
   * @returns {void}
   */
  commitPageHighRes(_index, _options = {}) {}

  /**
   * Clears source-specific high-resolution cache metadata after eviction.
   *
   * @param {number} _index Page index.
   * @param {Object} _options Cleanup options.
   * @returns {void}
   */
  cleanupPageHighRes(_index, _options = {}) {}

  /**
   * Releases source-owned resources.
   *
   * @returns {void}
   */
  dispose() {}
}
