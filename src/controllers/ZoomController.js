import { computeScale } from "../rendering/layout.js";

const CONTENT_ZOOM_MIN = 0.5;
const CONTENT_ZOOM_MAX = 6;
const CONTENT_ZOOM_STEP = 1.25;
const MAX_RENDER_CANVAS_EDGE = 8192;

function findScrollableAncestor(node) {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return node?.parentElement ?? null;
}

// Owns content/render zoom. Reads viewer.spreadCanvas + viewer.viewport for
// sizing math, and lets CSS scale the canvas display box smoothly while the
// backing store is redrawn after layout settles.
export class ZoomController {
  constructor(viewer, { renderScale = 1 } = {}) {
    this.viewer = viewer;
    this.renderScale = Math.max(1, Number(renderScale) || 1);
    this.contentZoom = 1;
    this.renderZoom = this.getSafeRenderZoom(this.contentZoom * this.renderScale);
  }

  #resolveViewport() {
    return this.viewer.viewport ?? findScrollableAncestor(this.viewer.spreadCanvas);
  }

  getViewportElement() {
    return this.#resolveViewport();
  }

  getCanvasViewportSize() {
    const viewport = this.getViewportElement();
    const rect = viewport?.getBoundingClientRect();
    return {
      width: Math.max(1, rect?.width ?? 1),
      height: Math.max(1, rect?.height ?? 1),
    };
  }

  getRenderScale() {
    const viewport = this.getCanvasViewportSize();
    const baseScale = computeScale(this.viewer.layout, viewport.width, viewport.height);
    return baseScale * this.renderZoom;
  }

  getSafeRenderZoom(targetZoom = this.contentZoom) {
    const viewport = this.getCanvasViewportSize();
    const baseScale = computeScale(this.viewer.layout, viewport.width, viewport.height);
    const baseWidth = 2 * this.viewer.layout.pw * baseScale;
    const baseHeight = this.viewer.layout.ph * baseScale;
    const maxWidthZoom = baseWidth > 0
      ? MAX_RENDER_CANVAS_EDGE / baseWidth
      : targetZoom;
    const maxHeightZoom = baseHeight > 0
      ? MAX_RENDER_CANVAS_EDGE / baseHeight
      : targetZoom;
    return Math.max(CONTENT_ZOOM_MIN, Math.min(targetZoom, maxWidthZoom, maxHeightZoom));
  }

  // Sets percentage CSS sizing only when zoom changes. Window/container
  // resizes are handled by CSS itself; the backing canvas catches up after a
  // debounced redraw.
  syncCanvasStage() {
    const { spreadCanvas } = this.viewer;
    if (!spreadCanvas) return;
    const size = `${Math.max(0.01, this.contentZoom) * 100}%`;
    const cssW = size;
    const cssH = size;
    if (spreadCanvas.style.width !== cssW) spreadCanvas.style.width = cssW;
    if (spreadCanvas.style.height !== cssH) spreadCanvas.style.height = cssH;
    if (spreadCanvas.style.objectFit !== "contain") spreadCanvas.style.objectFit = "contain";
  }

  #zoomTo(nextZoom) {
    if (Math.abs(nextZoom - this.contentZoom) < 0.0001) return;
    const viewport = this.#resolveViewport();
    const viewportWidth = viewport?.clientWidth ?? 0;
    const viewportHeight = viewport?.clientHeight ?? 0;
    const centerX = (viewport?.scrollLeft ?? 0) + viewportWidth / 2;
    const centerY = (viewport?.scrollTop ?? 0) + viewportHeight / 2;
    const zoomRatio = nextZoom / this.contentZoom;

    this.contentZoom = nextZoom;
    this.syncCanvasStage();
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, centerX * zoomRatio - viewportWidth / 2);
        viewport.scrollTop = Math.max(0, centerY * zoomRatio - viewportHeight / 2);
      });
    }
    this.#requestHighResAtCurrentZoom();
    this.viewer.emit("zoomchange", { contentZoom: this.contentZoom });
  }

  #requestHighResAtCurrentZoom() {
    const v = this.viewer;
    const targetSpread = v.navigationController.getEffectiveSpread();
    if (targetSpread < 0 || targetSpread >= v.book.numSpreads()) return;
    const targetPagePixels = v.getHighResTargetPagePixels?.() ?? null;
    const { left, right } = v.book.spreadPageEntries(targetSpread);
    for (const pageIndex of [left.pageIndex, right.pageIndex]) {
      if (pageIndex < 0) continue;
      if (v.lazyPageLoader.isPageHighResReady(pageIndex, this.contentZoom, { targetPagePixels })) continue;
      v.lazyPageLoader.ensurePageHighRes(pageIndex, this.contentZoom, { targetPagePixels });
    }
  }

  adjustContentZoom(direction) {
    const multiplier = direction > 0 ? CONTENT_ZOOM_STEP : 1 / CONTENT_ZOOM_STEP;
    const nextZoom = Math.max(CONTENT_ZOOM_MIN, Math.min(CONTENT_ZOOM_MAX, this.contentZoom * multiplier));
    this.#zoomTo(nextZoom);
  }

  resetContentZoom() {
    this.#zoomTo(1);
  }

  applySafeRenderZoom() {
    const next = this.getSafeRenderZoom(this.contentZoom * this.renderScale);
    if (Math.abs(this.renderZoom - next) < 0.0001) return false;
    this.renderZoom = next;
    return true;
  }

  isSpreadHighResReady(spreadIndex, previewZoom = this.contentZoom) {
    const v = this.viewer;
    if (spreadIndex < 0 || spreadIndex >= v.book.numSpreads()) return true;
    const { left, right } = v.book.spreadPageEntries(spreadIndex);
    const targetPagePixels = v.getHighResTargetPagePixels?.() ?? null;
    return [left.pageIndex, right.pageIndex]
      .filter(index => index >= 0)
      .every(index => v.lazyPageLoader.isPageHighResReady(index, previewZoom, { targetPagePixels }));
  }
}
