import { LazyPageLoader } from "./loading/LazyPageLoader.js";
import { NavigationController } from "./controllers/NavigationController.js";
import { ZoomController } from "./controllers/ZoomController.js";
import { ViewerBook } from "./model/ViewerBook.js";
import { computeMargins } from "./rendering/layout.js";
import { applyPaperPreset, DEFAULT_PAPER_PRESET_ID } from "./model/paper.js";

const DEFAULT_LAYOUT = {
  pw: 5.5, ph: 8.5,
  ratio: 0, b: 1,
  mInner: 0, mTop: 0, mBottom: 0,
};
const TARGET_HIGH_RES_WINDOW_PAGES = 6;

/**
 * Options for {@link BookViewer}.
 *
 * @typedef {Object} BookViewerOptions
 * @property {HTMLCanvasElement} spreadCanvas Canvas the renderer draws into.
 * @property {HTMLElement|null} [viewport=null] Element used for zoom measurement and scroll preservation.
 * @property {Function} rendererClass Renderer constructor, usually {@link WebGPUSpreadRenderer} or {@link SpreadRenderer}.
 * @property {PageSource|null} [source=null] Initial page source.
 * @property {Partial<Layout>|null} [layout=null] Initial layout overrides.
 * @property {Partial<Display>|null} [display=null] Initial display overrides.
 * @property {string} [paperPreset="natural"] Paper preset id.
 * @property {string} [contentBlendMode="multiply"] Blend mode for page content.
 * @property {number} [paperThickness=0.5] Paper edge and turn-lighting strength from 0 to 1.
 * @property {number} [showThrough=0] Strength of the show-through translucency (adjacent page bleeding through) from 0 (off) to 1.
 * @property {number} [paperTextureStrength=0.18] Paper texture/normal strength from 0 to 1.
 * @property {boolean} [showPageBorder=true] Whether to render the page edge treatment.
 * @property {number} [maxHighResPages=8] High-resolution page bitmap LRU capacity.
 * @property {number} [pdfRenderScale=1.5] Baseline PDF rasterization scale before DPR/zoom.
 * @property {number} [pdfRenderScaleHeadroom=1.1] Extra PDF rasterization margin above visible size.
 * @property {number} [pdfMaxRenderScale=0] Maximum PDF rasterization scale; set 0 to disable.
 * @property {number} [pdfPreviewSourceScale=0.5] Fallback PDF preview rasterization scale when page dimensions are unavailable.
 * @property {number} [renderScale=1] Pixel supersampling multiplier for the rendered spread canvas.
 */

/**
 * Renderer-facing viewer class.
 *
 * Hosts supply a canvas and a {@link PageSource}; `BookViewer` drives
 * navigation, page-turn animation, zoom, lazy bitmap loading, and events.
 */
export class BookViewer {
  /**
   * @param {BookViewerOptions} options Viewer options.
   */
  constructor({
    spreadCanvas,
    viewport = null,
    rendererClass,
    source = null,
    layout = null,
    display = null,
    paperPreset = DEFAULT_PAPER_PRESET_ID,
    contentBlendMode = "multiply",
    paperThickness = 0.5,
    showThrough = 0,
    paperTextureStrength = 0.18,
    showPageBorder = true,
    maxHighResPages = 8,
    pdfRenderScale = 1.5,
    pdfRenderScaleHeadroom = 1.1,
    pdfMaxRenderScale = 0,
    pdfPreviewSourceScale = 0.5,
    renderScale = 1,
  } = {}) {
    if (!spreadCanvas) throw new Error("BookViewer: spreadCanvas is required");
    if (!rendererClass) throw new Error("BookViewer: rendererClass is required");

    // The renderer draws into `spreadCanvas`. CSS sizing for zoom is applied
    // to the canvas itself. `viewport` is a separate element used for zoom
    // math (its bounding rect is the visible area, its scrollLeft/Top is
    // adjusted on zoom). If not passed, ZoomController falls back to the
    // canvas's nearest scrollable ancestor.
    this.spreadCanvas = spreadCanvas;
    this.viewport = viewport;

    // Viewer state (replaces the app.uiState the controllers used to read).
    this.layout = layout ? { ...DEFAULT_LAYOUT, ...layout } : { ...DEFAULT_LAYOUT };
    this.display = applyPaperPreset({
      contentBlendMode,
      paperThickness,
      showThrough,
      paperTextureStrength,
      ...display,
    }, paperPreset);
    this.showPageBorder = showPageBorder;
    this.currentSpread = 0;
    this.effectiveSpread = 0;
    this.lastMargins = computeMargins(this.layout, 1);

    // Public reactive surface.
    this.listeners = new Map();
    this.latestGeometry = null;
    this.source = null;
    this.book = new ViewerBook({ getPageCount: () => 0, getPageMetadata: () => null, on: () => () => {} });
    this.resizeObserver = null;
    this.observedResizeTarget = null;
    this.resizeFrame = 0;
    this.resizeDebounceTimer = 0;
    this.boundResize = () => this.#scheduleResizeRedraw();

    // Renderer + loaders.
    this.spreadRenderer = new rendererClass(spreadCanvas);
    this.lazyPageLoader = new LazyPageLoader(this.#loaderBook(), pageIndex => this.#onPageReady(pageIndex), {
      source: this.source,
      maxHighResPages,
      pdfRenderScale,
      pdfRenderScaleHeadroom,
      pdfMaxRenderScale,
      pdfPreviewSourceScale,
    });

    // Controllers — they read fields off `this` (the viewer).
    this.navigationController = new NavigationController(this);
    this.zoomController = new ZoomController(this, { renderScale });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.boundResize);
    } else {
      spreadCanvas.ownerDocument?.defaultView?.addEventListener("resize", this.boundResize);
    }

    if (source) this.setSource(source);
  }

  // ---- public API ----

  get backendName() { return this.spreadRenderer.backendName; }
  get contentZoom() { return this.zoomController.contentZoom; }
  get renderZoom() { return this.zoomController.renderZoom; }
  get isAnimating() { return this.spreadRenderer.isAnimating; }
  get numSpreads() { return this.book.numSpreads(); }
  get viewerBook() { return this.book; }   // alias for legacy host code

  getHighResTargetPagePixels() {
    const margins = computeMargins(this.layout, this.zoomController.getRenderScale());
    const displayScale = this.#getDisplayedCanvasContentScale(margins);
    if (displayScale > 0) {
      const supersample = Math.max(1, Number(this.zoomController.renderScale) || 1);
      return {
        width: Math.max(1, Math.round(margins.pagePxW * displayScale * supersample)),
        height: Math.max(1, Math.round(margins.pagePxH * displayScale * supersample)),
      };
    }
    return {
      width: Math.max(1, Math.round(margins.pagePxW)),
      height: Math.max(1, Math.round(margins.pagePxH)),
    };
  }

  #getDisplayedCanvasContentScale(margins) {
    const canvas = this.spreadCanvas;
    const rect = canvas?.getBoundingClientRect?.();
    const cssWidth = Number(rect?.width) || canvas?.clientWidth || parseFloat(canvas?.style?.width) || 0;
    const cssHeight = Number(rect?.height) || canvas?.clientHeight || parseFloat(canvas?.style?.height) || 0;
    if (cssWidth <= 0 || cssHeight <= 0) return 0;

    const intrinsicWidth = Math.max(1, Number(canvas?.width) || 2 * margins.pagePxW || 1);
    const intrinsicHeight = Math.max(1, Number(canvas?.height) || margins.pagePxH || 1);
    return Math.min(cssWidth / intrinsicWidth, cssHeight / intrinsicHeight);
  }

  /**
   * Replaces the page source, resets navigation to spread 0, warms previews,
   * redraws, and emits `sourcechange`.
   *
   * @param {PageSource} source New page source.
   * @returns {void}
   */
  setSource(source) {
    this.source = source;
    this.book = new ViewerBook(source);
    // LazyPageLoader operates on a book-shaped object whose pages are mutable
    // (it writes srcCanvas/previewCanvas onto them). We give it the source's
    // own internal book if available, else fall back to a derived passthrough.
    this.lazyPageLoader.book = source.getInternalBook?.() ?? this.#loaderBook();
    this.lazyPageLoader.source = source;
    this.currentSpread = 0;
    this.effectiveSpread = 0;
    this.lazyPageLoader.reset();
    if (this.book.pages.length) {
      this.lazyPageLoader.ensureSpreadLoaded(0, 1, { allowHighRes: false });
      this.lazyPageLoader.warmAllPreviews({ includeImages: true });
    }
    this.redraw();
    this.schedulePreviewRedraw();
    this.emit("sourcechange", { source });
  }

  /**
   * Merges layout fields and redraws.
   *
   * @param {Partial<Layout>} layout Layout fields to update.
   * @returns {void}
   */
  setLayout(layout) {
    this.layout = { ...this.layout, ...layout };
    this.redraw();
  }

  /**
   * Merges display fields and redraws.
   *
   * @param {Partial<Display>} display Display fields to update.
   * @returns {void}
   */
  setDisplay(display) {
    this.display = { ...this.display, ...display };
    this.redraw();
  }

  /**
   * Toggles page edge rendering.
   *
   * @param {boolean} show Whether the page edge treatment should render.
   * @returns {void}
   */
  setShowPageBorder(show) {
    this.showPageBorder = !!show;
    this.zoomController.syncCanvasStage();
    this.redraw();
  }

  /**
   * Sets the element used for zoom measurement and scroll preservation.
   *
   * @param {HTMLElement|null} viewport Viewport element.
   * @returns {void}
   */
  setViewport(viewport) {
    this.viewport = viewport;
    this.#observeResizeTarget();
    this.redraw();
  }

  /**
   * Navigates to a spread. Long jumps are queued as multiple page turns.
   *
   * @param {number} spreadIndex Target spread index.
   * @param {number|null} [preferredPageIndex=null] Page index to prefer when updating selection/readouts.
   * @returns {void}
   */
  navigateTo(spreadIndex, preferredPageIndex = null) {
    const target = Math.max(0, Math.min(spreadIndex, this.numSpreads - 1));
    const distance = Math.abs(target - this.navigationController.getEffectiveSpread());
    if (distance > 1) {
      this.navigationController.queueSpreadTurnsTo(target, preferredPageIndex);
    } else {
      this.navigationController.navigateTo(target, preferredPageIndex);
    }
  }

  /**
   * Adjusts content zoom. Positive values zoom in; negative values zoom out.
   *
   * @param {number} direction Zoom direction.
   * @returns {void}
   */
  adjustZoom(direction) { this.zoomController.adjustContentZoom(direction); }

  /**
   * Resets content zoom to 1.
   *
   * @returns {void}
   */
  resetZoom() { this.zoomController.resetContentZoom(); }

  /**
   * Subscribes to a viewer event.
   *
   * @param {string} event Event name.
   * @param {Function} fn Listener callback.
   * @returns {Function} Unsubscribe function.
   */
  on(event, fn) {
    let arr = this.listeners.get(event);
    if (!arr) { arr = []; this.listeners.set(event, arr); }
    arr.push(fn);
    return () => this.off(event, fn);
  }

  /**
   * Removes a viewer event listener.
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
   * Returns the latest geometry emitted by the renderer.
   *
   * @returns {SpreadGeometry|null} Latest spread geometry.
   */
  getSpreadGeometry() { return this.latestGeometry; }

  ensureTargetHighResWindow(targetSpread = this.navigationController.getEffectiveSpread(), {
    currentPriority = true,
    adjacentPriority = false,
    retainPageIndices = [],
  } = {}) {
    const pageIndices = this.#centeredHighResWindowPageIndices(targetSpread);
    if (!pageIndices.length) return pageIndices;

    const currentPages = new Set(this.#spreadPageIndices(targetSpread));
    const targetPagePixels = this.getHighResTargetPagePixels();
    this.lazyPageLoader.retainHighResPages([...new Set([...pageIndices, ...retainPageIndices])]);

    const requestOrder = [...pageIndices].sort((a, b) => {
      const aCurrent = currentPages.has(a);
      const bCurrent = currentPages.has(b);
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      return a - b;
    });

    for (const pageIndex of requestOrder) {
      const priority = currentPages.has(pageIndex) ? currentPriority : adjacentPriority;
      if (this.lazyPageLoader.isPageHighResReady(pageIndex, this.contentZoom, { targetPagePixels })) {
        this.lazyPageLoader.touchHighResPage(pageIndex);
        continue;
      }
      this.lazyPageLoader.ensurePageHighRes(pageIndex, this.contentZoom, { priority, targetPagePixels });
    }

    return pageIndices;
  }

  // ---- internal ----

  redraw() {
    if (!this.spreadRenderer || !this.book) return;
    this.#observeResizeTarget();
    const scale = this.zoomController.getRenderScale();
    const margins = computeMargins(this.layout, scale);
    this.lastMargins = margins;
    this.currentSpread = Math.min(this.currentSpread, Math.max(0, this.numSpreads - 1));
    this.effectiveSpread = this.navigationController.getEffectiveSpread();

    if (this.book.pages.length) {
      this.lazyPageLoader.ensureSpreadLoaded(this.currentSpread, 1, {
        allowHighRes: false,
        targetPagePixels: {
          width: Math.max(1, Math.round(margins.pagePxW)),
          height: Math.max(1, Math.round(margins.pagePxH)),
        },
      });
    }

    const spreadPages = this.#renderableSpreadPages(this.currentSpread);
    const result = this.spreadRenderer.render(
      spreadPages,
      margins,
      { left: { pipeline: [], key: "" }, right: { pipeline: [], key: "" } },
      this.display,
      {
        showPlaceholder: !this.book.pages.length,
        previewZoom: this.renderZoom,
        showPageBorder: this.showPageBorder,
        pageCount: this.book.pages.length,
      }
    );
    this.latestGeometry = {
      spreadRects: result?.spreadRects ?? null,
      sideStates: result?.sideStates ?? null,
      margins,
    };
    this.zoomController.syncCanvasStage();
    this.emit("geometrychange", this.latestGeometry);
  }

  schedulePreviewRedraw() {
    if (this.spreadRenderer.isAnimating) return;
    const targetSpread = this.navigationController.getEffectiveSpread();
    if (this.book.pages.length) {
      this.lazyPageLoader.ensureSpreadLoaded(targetSpread, this.contentZoom, {
        allowHighRes: false,
        targetPagePixels: this.getHighResTargetPagePixels(),
      });
      this.ensureTargetHighResWindow(targetSpread);
    }
    if (this.zoomController.applySafeRenderZoom()) this.redraw();
  }

  // Build a renderable-spread payload for the renderer's render() call.
  #renderableSpreadPages(spreadIndex) {
    if (!this.book.pages.length) return null;
    const entries = this.book.spreadPageEntries(spreadIndex);
    return {
      left: { ...entries.left, showThroughEffectEntry: { pipeline: [], key: "" } },
      right: { ...entries.right, showThroughEffectEntry: { pipeline: [], key: "" } },
    };
  }

  #spreadPageIndices(spreadIndex) {
    if (spreadIndex < 0 || spreadIndex >= this.numSpreads) return [];
    const { left, right } = this.book.spreadPageEntries(spreadIndex);
    return [left.pageIndex, right.pageIndex]
      .filter(pageIndex => pageIndex >= 0 && pageIndex < this.book.pages.length);
  }

  #centeredHighResWindowPageIndices(targetSpread) {
    const pageCount = this.book.pages.length;
    const maxHighResPages = Math.max(0, Math.floor(Number(this.lazyPageLoader.maxHighResPages) || 0));
    const currentPages = this.#spreadPageIndices(targetSpread);
    if (!currentPages.length) return [];
    const sourceWindowCount = this.source?.getTargetHighResWindowPageCount?.({
      targetSpread,
      currentPageCount: currentPages.length,
      currentPageIndices: currentPages,
      defaultCount: TARGET_HIGH_RES_WINDOW_PAGES,
      maxHighResPages,
      pageCount,
    }) ?? TARGET_HIGH_RES_WINDOW_PAGES;
    const desiredCount = Math.min(pageCount, Math.max(0, Math.floor(Number(sourceWindowCount) || 0)), maxHighResPages);
    if (desiredCount <= 0) return [];

    const pageIndices = [...new Set(currentPages)].sort((a, b) => a - b).slice(0, desiredCount);
    let start = pageIndices[0];
    let end = pageIndices[pageIndices.length - 1];
    let preferBefore = true;

    while (pageIndices.length < desiredCount) {
      const canAddBefore = start > 0;
      const canAddAfter = end < pageCount - 1;
      if (!canAddBefore && !canAddAfter) break;

      if ((preferBefore && canAddBefore) || !canAddAfter) {
        start -= 1;
        pageIndices.unshift(start);
      } else {
        end += 1;
        pageIndices.push(end);
      }
      preferBefore = !preferBefore;
    }

    return pageIndices;
  }

  /**
   * Builds a renderer snapshot used as one side of a page-turn animation.
   *
   * On WebGPU this returns a sentinel canvas that maps back to a scene; the
   * texture flags come from PageTurnTexturePolicy and decide whether the
   * front face/back face should sample page-strip previews or display bitmaps.
   *
   * @param {number} spreadIndex Spread to snapshot.
   * @param {Object} [options={}] Texture source options for the snapshot.
   * @param {boolean} [options.preferPreviewSources=false] Use preview sources for the page front faces.
   * @param {boolean} [options.preferPreviewBackFaceSources=options.preferPreviewSources] Use preview sources for turning-leaf back faces.
   * @returns {HTMLCanvasElement|OffscreenCanvas} Snapshot key canvas.
   */
  createSpreadSnapshot(spreadIndex, {
    preferPreviewSources = false,
    preferPreviewBackFaceSources = preferPreviewSources,
  } = {}) {
    const margins = computeMargins(this.layout, this.zoomController.getRenderScale());
    const pages = this.#renderableSpreadPages(spreadIndex);
    const { canvas } = this.spreadRenderer.snapshot(
      pages,
      margins,
      { left: { pipeline: [], key: "" }, right: { pipeline: [], key: "" } },
      this.display,
      {
        previewZoom: this.renderZoom,
        showPageBorder: this.showPageBorder,
        pageCount: this.book.pages.length,
        preferPreviewSources,
        preferPreviewBackFaceSources,
      },
    );
    return canvas;
  }

  #onPageReady(pageIndex) {
    const viewerPage = this.book.pages[pageIndex] ?? null;
    if (this.spreadRenderer.isAnimating) {
      // Let host code (composition pipelines, thumbnail managers) react to
      // the fresh bitmap before the renderer reads through ViewerPage's
      // getter chain.
      this.emit("pageready", { pageIndex, animating: true });
      if (viewerPage && this.source?.shouldRefreshPageSourceDuringAnimation?.(pageIndex) !== false) {
        this.spreadRenderer.refreshPageSource?.(viewerPage);
      }
      return;
    }
    // Emit first so host listeners can populate composed canvases / placed
    // previews before the redraw samples ViewerPage.displayCanvas.
    this.emit("pageready", { pageIndex, animating: false });
    const { left, right } = this.book.spreadPageEntries(this.currentSpread);
    const isOnCurrent = pageIndex === left.pageIndex || pageIndex === right.pageIndex;
    if (isOnCurrent) {
      this.zoomController.applySafeRenderZoom();
      this.redraw();
    }
  }

  #loaderBook() {
    // LazyPageLoader expects book.numSpreads() / book.spreadPageEntries() /
    // book.pages — and writes srcCanvas etc. onto the page objects. Our
    // ViewerBook returns ViewerPage instances whose bitmap fields are
    // getters delegating to metadata. If the source provides its own
    // internal book (via getInternalBook), prefer that; otherwise build a
    // minimal proxy that walks the source's passthrough pages.
    if (this.source?.getInternalBook) return this.source.getInternalBook();
    return {
      get pages() { return []; },
      numSpreads() { return 1; },
      spreadPageEntries() { return { left: { page: null, pageIndex: -1, showThroughPage: null }, right: { page: null, pageIndex: -1, showThroughPage: null } }; },
    };
  }

  #observeResizeTarget() {
    if (!this.resizeObserver) return;
    const target = this.zoomController.getViewportElement?.() ?? null;
    if (target === this.observedResizeTarget) return;
    if (this.observedResizeTarget) this.resizeObserver.unobserve(this.observedResizeTarget);
    this.observedResizeTarget = target;
    if (target) this.resizeObserver.observe(target);
  }

  #scheduleResizeRedraw() {
    if (this.resizeFrame) return;
    const win = this.spreadCanvas.ownerDocument?.defaultView ?? globalThis;
    this.resizeFrame = win.requestAnimationFrame?.(() => {
      this.resizeFrame = 0;
      this.zoomController.syncCanvasStage();
      if (this.resizeDebounceTimer) win.clearTimeout?.(this.resizeDebounceTimer);
      this.resizeDebounceTimer = win.setTimeout?.(() => {
        this.resizeDebounceTimer = 0;
        this.zoomController.applySafeRenderZoom();
        this.redraw();
        this.schedulePreviewRedraw();
      }, 160) ?? 0;
      if (!this.resizeDebounceTimer) {
        this.zoomController.applySafeRenderZoom();
        this.redraw();
        this.schedulePreviewRedraw();
      }
    }) ?? 0;
    if (!this.resizeFrame) {
      this.zoomController.syncCanvasStage();
      this.zoomController.applySafeRenderZoom();
      this.redraw();
      this.schedulePreviewRedraw();
    }
  }

  emit(event, ...args) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of arr.slice()) fn(...args);
  }
}
