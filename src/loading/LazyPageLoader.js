import { SHARED_PREVIEW_SIZE } from "../previewSizing.js";
import { comparePriority } from "./workerClient.js";

const DEFAULT_PDF_RENDER_SCALE_HEADROOM = 1.1;
const DEFAULT_PDF_MAX_RENDER_SCALE = 1.5;
const DEFAULT_PDF_PREVIEW_FALLBACK_SCALE = 0.5;
const PREVIEW_PRIORITIES = new Set(["critical", "visible", "high", "normal", "background"]);

function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === "function") bitmap.close();
}

function normalizePreviewPriority(priority) {
  if (priority === true) return "visible";
  if (priority === false || priority == null) return "background";
  return PREVIEW_PRIORITIES.has(priority) ? priority : "normal";
}

/**
 * Lazily loads PDF/image page bitmaps and tracks high-res memory via an LRU.
 *
 * Capacity is the maximum number of pages held at high resolution at once
 * (default 8 ≈ 4 spreads). Requesting a page (`ensurePageHighRes` or via
 * `ensureSpreadLoaded`) "touches" it, moving it to the most-recent slot;
 * over-capacity entries at the oldest slot are evicted (bitmap closed,
 * `page.srcCanvas` cleared). Previews are kept loaded indefinitely — they're
 * cheap and the page strip depends on them.
 *
 * Eviction can be deferred via `setEvictionsDeferred(true)` to avoid closing
 * a bitmap whose texture is still in use by an in-flight WebGPU animation.
 * Call `flushEvictions()` (or `setEvictionsDeferred(false)`) once it's safe.
 */
export class LazyPageLoader {
  constructor(book, onPageReady, {
    source = null,
    maxHighResPages = 8,
    pdfRenderScale = 1.5,
    pdfRenderScaleHeadroom = DEFAULT_PDF_RENDER_SCALE_HEADROOM,
    pdfMaxRenderScale = DEFAULT_PDF_MAX_RENDER_SCALE,
    pdfPreviewSourceScale = DEFAULT_PDF_PREVIEW_FALLBACK_SCALE,
    pdfPreviewMaxEdge = SHARED_PREVIEW_SIZE,
  } = {}) {
    this.book = book;
    this.source = source;
    this.onPageReady = onPageReady;
    this.pdfRenderScale = pdfRenderScale;
    this.pdfRenderScaleHeadroom = Math.max(1, Number(pdfRenderScaleHeadroom) || DEFAULT_PDF_RENDER_SCALE_HEADROOM);
    this.pdfMaxRenderScale = Math.max(0, Number(pdfMaxRenderScale) || DEFAULT_PDF_MAX_RENDER_SCALE);
    this.pdfPreviewSourceScale = Math.max(0, Number(pdfPreviewSourceScale) || DEFAULT_PDF_PREVIEW_FALLBACK_SCALE);
    this.pdfPreviewMaxEdge = pdfPreviewMaxEdge;
    this.maxHighResPages = maxHighResPages;
    this.lastEnsuredPreviewZoom = 1;
    // LRU: pageIndex -> {} (Map iteration is insertion-order; re-insert to bump).
    this.highResLru = new Map();
    this.evictionsDeferred = false;
    this.previewQueue = new Map();
    this.previewQueued = new Set();
    this.previewRendering = false;
    this.previewPaused = false;
    this.pageReadyWaiters = new Map();
  }

  #getHighResPixelRatio() {
    return Math.max(1, globalThis.devicePixelRatio || 1);
  }

  #getTargetPdfRenderScale(previewZoom = 1) {
    return this.pdfRenderScale
      * Math.max(1, previewZoom || 1)
      * this.#getHighResPixelRatio();
  }

  #getPreviewTargetPagePixels(pageIndex) {
    return this.source?.getPagePreviewTarget?.(pageIndex, { maxEdge: this.pdfPreviewMaxEdge })
      ?? { width: SHARED_PREVIEW_SIZE, height: SHARED_PREVIEW_SIZE };
  }

  #getRenderConfig(extra = {}) {
    return {
      pdfRenderScale: this.pdfRenderScale,
      pdfRenderScaleHeadroom: this.pdfRenderScaleHeadroom,
      pdfMaxRenderScale: this.pdfMaxRenderScale,
      pdfPreviewSourceScale: this.pdfPreviewSourceScale,
      pdfPreviewMaxEdge: this.pdfPreviewMaxEdge,
      devicePixelRatio: this.#getHighResPixelRatio(),
      ...extra,
    };
  }

  #resolvePageReadyWaiters(pageIndex) {
    const waiters = this.pageReadyWaiters.get(pageIndex);
    if (!waiters?.length) return;
    const pending = [];
    for (const waiter of waiters) {
      if (this.isPageHighResReady(pageIndex, waiter.previewZoom, { targetPagePixels: waiter.targetPagePixels })) {
        waiter.resolve(true);
      } else {
        pending.push(waiter);
      }
    }
    if (pending.length) this.pageReadyWaiters.set(pageIndex, pending);
    else this.pageReadyWaiters.delete(pageIndex);
  }

  #touchHighRes(pageIndex) {
    if (pageIndex < 0) return;
    if (this.highResLru.has(pageIndex)) this.highResLru.delete(pageIndex);
    this.highResLru.set(pageIndex, {});
    this.#evictOverCapacity();
  }

  #isWantedHighRes(pageIndex) {
    return this.highResLru.has(pageIndex);
  }

  #evictOverCapacity() {
    if (this.evictionsDeferred) return;
    while (this.highResLru.size > this.maxHighResPages) {
      const oldestIndex = this.highResLru.keys().next().value;
      this.highResLru.delete(oldestIndex);
      this.#unloadPage(oldestIndex);
    }
  }

  setEvictionsDeferred(deferred) {
    const wasDeferred = this.evictionsDeferred;
    this.evictionsDeferred = !!deferred;
    if (wasDeferred && !this.evictionsDeferred) {
      this.#evictOverCapacity();
    }
  }

  flushEvictions() {
    this.setEvictionsDeferred(false);
  }

  retainHighResPages(pageIndices) {
    if (this.evictionsDeferred) return;
    const keep = new Set(pageIndices);
    for (const pageIndex of [...this.highResLru.keys()]) {
      if (keep.has(pageIndex)) continue;
      this.highResLru.delete(pageIndex);
      this.#unloadPage(pageIndex);
    }
  }

  touchHighResPage(pageIndex) {
    this.#touchHighRes(pageIndex);
  }

  setPreviewPaused(paused) {
    const wasPaused = this.previewPaused;
    this.previewPaused = !!paused;
    if (wasPaused && !this.previewPaused) {
      this.#drainPreviewQueue();
    }
  }

  setPreviewBackgroundPaused(paused) {
    this.setPreviewPaused(paused);
  }

  reset() {
    this.lastEnsuredPreviewZoom = 1;
    this.previewQueue.clear();
    this.previewQueued.clear();
    this.previewRendering = false;
    this.previewPaused = false;
    for (const pageIndex of this.highResLru.keys()) {
      this.#unloadPage(pageIndex);
    }
    this.highResLru.clear();
    this.evictionsDeferred = false;
  }

  ensureSpreadLoaded(spreadIndex, previewZoom = 1, {
    allowHighRes = true,
    priority = false,
    targetPagePixels = null,
    previewPriority = "visible",
    adjacentPreviewPriority = "background",
  } = {}) {
    this.lastEnsuredPreviewZoom = Math.max(1, previewZoom || 1);
    const targetPdfRenderScale = this.#getTargetPdfRenderScale(this.lastEnsuredPreviewZoom);
    const spreadCount = this.book.numSpreads();
    for (
      let spread = Math.max(0, spreadIndex - 1);
      spread <= Math.min(spreadCount - 1, spreadIndex + 1);
      spread += 1
    ) {
      const { left, right } = this.book.spreadPageEntries(spread);
      if (left.pageIndex >= 0) {
        this.#ensurePreviewLoaded(left.pageIndex, spread === spreadIndex ? previewPriority : adjacentPreviewPriority);
        if (allowHighRes && spread === spreadIndex) {
          this.#ensurePageLoaded(left.pageIndex, targetPdfRenderScale, { priority, targetPagePixels });
        }
      }
      if (right.pageIndex >= 0 && right.pageIndex < this.book.pages.length) {
        this.#ensurePreviewLoaded(right.pageIndex, spread === spreadIndex ? previewPriority : adjacentPreviewPriority);
        if (allowHighRes && spread === spreadIndex) {
          this.#ensurePageLoaded(right.pageIndex, targetPdfRenderScale, { priority, targetPagePixels });
        }
      }
    }
  }

  warmAllPreviews({ includeImages = true, priority = "background" } = {}) {
    for (let pageIndex = 0; pageIndex < this.book.pages.length; pageIndex += 1) {
      if (!includeImages && this.source?.getPageKind?.(pageIndex) === "image") continue;
      this.#ensurePreviewLoaded(pageIndex, priority);
    }
  }

  ensurePageHighRes(pageIndex, previewZoom = 1, { priority = true, targetPagePixels = null } = {}) {
    if (pageIndex < 0 || pageIndex >= this.book.pages.length) return Promise.resolve(false);
    const targetPdfRenderScale = this.#getTargetPdfRenderScale(previewZoom);
    this.#ensurePreviewLoaded(pageIndex, "critical");
    const loadPromise = this.#ensurePageLoaded(pageIndex, targetPdfRenderScale, { priority, targetPagePixels });
    if (this.isPageHighResReady(pageIndex, previewZoom, { targetPagePixels })) return Promise.resolve(true);
    return new Promise(resolve => {
      const waiters = this.pageReadyWaiters.get(pageIndex) || [];
      waiters.push({ previewZoom, targetPagePixels, resolve });
      this.pageReadyWaiters.set(pageIndex, waiters);
      Promise.resolve(loadPromise).then(() => this.#resolvePageReadyWaiters(pageIndex));
    });
  }

  isPageHighResReady(pageIndex, previewZoom = 1, { targetPagePixels = null } = {}) {
    const page = this.book.pages[pageIndex];
    if (!page) return false;
    return !!this.source?.getPageHighResStatus?.(pageIndex, {
      page,
      previewZoom,
      targetPagePixels,
      targetPdfRenderScale: this.#getTargetPdfRenderScale(previewZoom),
      renderConfig: this.#getRenderConfig(),
    })?.ready;
  }

  #ensurePreviewLoaded(pageIndex, priority = "background") {
    const page = this.book.pages[pageIndex];
    if (!page || page.previewCanvas || !this.source?.getPagePreview) return;
    const normalizedPriority = normalizePreviewPriority(priority);
    if (this.previewQueued.has(pageIndex)) {
      const existing = this.previewQueue.get(pageIndex);
      if (existing && comparePriority(normalizedPriority, existing.priority) < 0) {
        this.previewQueue.set(pageIndex, { pageIndex, priority: normalizedPriority });
      }
      this.#drainPreviewQueue();
      return;
    }
    this.previewQueued.add(pageIndex);
    this.previewQueue.set(pageIndex, { pageIndex, priority: normalizedPriority });
    this.#drainPreviewQueue();
  }

  #canRunPreviewEntry(entry) {
    return !this.previewPaused;
  }

  #shiftNextPreviewEntry() {
    let selectedPageIndex = -1;
    let selectedEntry = null;
    for (const [pageIndex, entry] of this.previewQueue) {
      if (!this.#canRunPreviewEntry(entry)) continue;
      if (!selectedEntry || comparePriority(entry.priority, selectedEntry.priority) < 0) {
        selectedPageIndex = pageIndex;
        selectedEntry = entry;
      }
    }
    if (!selectedEntry) return null;
    this.previewQueue.delete(selectedPageIndex);
    this.previewQueued.delete(selectedPageIndex);
    return selectedEntry;
  }

  #hasRunnablePreviewEntry() {
    for (const entry of this.previewQueue.values()) {
      if (this.#canRunPreviewEntry(entry)) return true;
    }
    return false;
  }

  async #drainPreviewQueue() {
    if (this.previewRendering) return;
    if (!this.#hasRunnablePreviewEntry()) return;
    this.previewRendering = true;
    while (this.#hasRunnablePreviewEntry()) {
      const entry = this.#shiftNextPreviewEntry();
      if (!entry) break;
      const { pageIndex, priority } = entry;
      const page = this.book.pages[pageIndex];
      if (!page || page.previewCanvas) continue;
      try {
        const targetPagePixels = this.#getPreviewTargetPagePixels(pageIndex);
        const previewBitmap = await this.source?.getPagePreview?.(pageIndex, {
          page,
          targetPagePixels,
          maxEdge: this.pdfPreviewMaxEdge,
          priority,
          ...this.#getRenderConfig(),
        });
        if (!previewBitmap) continue;
        page.previewCanvas = previewBitmap;
        if (!page.thumbnailSourceCanvas) page.thumbnailSourceCanvas = previewBitmap;
        this.onPageReady?.(pageIndex);
        this.#resolvePageReadyWaiters(pageIndex);
      } catch (error) {
        const label = this.source?.getPageKind?.(pageIndex) || page.source?.type || "page";
        console.error(`Failed to load ${label}:`, error);
      }
    }
    this.previewRendering = false;
    if (this.#hasRunnablePreviewEntry()) this.#drainPreviewQueue();
  }

  async #ensurePageLoaded(pageIndex, targetPdfRenderScale = this.pdfRenderScale, { priority = false, targetPagePixels = null } = {}) {
    const page = this.book.pages[pageIndex];
    if (!page) return;

    // Touch the LRU first so the page is marked as wanted before we kick off
    // (or check for) a render. If a previously in-flight render for this page
    // lands, the LRU-membership check at completion will recognize it as
    // still wanted.
    this.#touchHighRes(pageIndex);

    const requestPriority = priority === true ? "high" : priority === false ? "background" : priority;
    const status = this.source?.getPageHighResStatus?.(pageIndex, {
      page,
      previewZoom: this.lastEnsuredPreviewZoom,
      targetPagePixels,
      targetPdfRenderScale,
      renderConfig: this.#getRenderConfig({ priority: requestPriority }),
    }) ?? { ready: false, shouldLoad: false, request: null };
    if (status.ready || !status.shouldLoad) return;

    page.loading = true;
    try {
      const bitmap = await this.source.getPageHighRes(pageIndex, {
        ...status.request,
        priority: requestPriority,
      });
      if (!bitmap) {
        page.loading = false;
        return;
      }
      if (!this.#isWantedHighRes(pageIndex)) {
        // Page was evicted from the LRU while we were rendering.
        page.loading = false;
        closeBitmap(bitmap);
        return;
      }
      const previousSrcCanvas = page.srcCanvas && page.srcCanvas !== bitmap ? page.srcCanvas : null;
      page.srcCanvas = bitmap;
      if (page.previewCanvas && !page.thumbnailSourceCanvas) {
        page.thumbnailSourceCanvas = page.previewCanvas;
      }
      page.aspectRatio = bitmap.width / bitmap.height;
      this.source.commitPageHighRes?.(pageIndex, { page, bitmap, request: status.request });
      page.loading = false;
      this.onPageReady?.(pageIndex);
      // Close the previous bitmap AFTER onPageReady so that the renderer has
      // a chance to swing its scene-pinned source refs onto the new bitmap
      // first. Otherwise an in-flight animation that still references the
      // old bitmap would see it become unreadable mid-frame.
      if (previousSrcCanvas) closeBitmap(previousSrcCanvas);
      this.#resolvePageReadyWaiters(pageIndex);
      if (!page.previewCanvas) {
        setTimeout(() => this.#ensurePreviewLoaded(pageIndex, "visible"), 0);
      }
      if (!this.isPageHighResReady(pageIndex, this.lastEnsuredPreviewZoom, { targetPagePixels })) {
        setTimeout(() => this.#ensurePageLoaded(pageIndex, targetPdfRenderScale, { priority: false, targetPagePixels }), 0);
      }
    } catch (error) {
      page.loading = false;
      const label = this.source?.getPageKind?.(pageIndex) || page.source?.type || "page";
      console.error(`Failed to load high-res ${label} page ${pageIndex + 1}:`, error);
    }
  }

  #unloadPage(pageIndex) {
    const page = this.book.pages[pageIndex];
    if (!page || !page.srcCanvas) return;
    closeBitmap(page.srcCanvas);
    page.srcCanvas = null;
    page.displayCanvasOverride = null;
    // interactivePreviewCanvas is either an aliased bitmap (already closed
    // above) or a freshly allocated HTMLCanvasElement (GC handles it).
    page.interactivePreviewCanvas = null;
    page.interactivePreviewSourceCanvas = null;
    page.interactivePreviewMaxEdge = 0;
    this.source?.cleanupPageHighRes?.(pageIndex, { page });
  }
}
