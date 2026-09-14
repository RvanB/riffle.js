const DEFAULT_CROP = { top: 0, left: 0, right: 0, bottom: 0 };
const EMPTY_SURFACE = Object.freeze({ canvas: null, placed: false });

function taggedSurface(canvas, placed) {
  return canvas ? { canvas, placed } : null;
}

// A page as seen by the viewer. In Phase 2 the bitmap and placement fields
// are passthroughs to `metadata` (which the source populates — for the margin
// app this is the corresponding app-side Page instance). Phase 3 will narrow
// this to bitmaps-only by moving content placement into an app-side composer.
export class ViewerPage {
  constructor({ aspectRatio = 1, metadata = null } = {}) {
    this.aspectRatio = aspectRatio;
    this.metadata = metadata;
  }

  get srcCanvas() { return this.metadata?.srcCanvas ?? null; }
  // Prefer the composed (already-margin-applied) bitmaps when the app has
  // produced them. Fall back to raw source bitmaps before the first
  // composition completes so the renderer never reads a stale-null.
  get previewCanvas() {
    const m = this.metadata;
    return m?.composedPreviewCanvas ?? m?.previewCanvas ?? null;
  }
  get displayCanvas() { return this.displaySurface.canvas; }

  /**
   * The best display bitmap, tagged with whether it is already a composed
   * page surface (`placed: true`) or raw content that still needs the page's
   * placement applied (`placed: false`).
   *
   * Consumers must read `placed` rather than inferring it — a composed page
   * and a raw bitmap are not distinguishable from their pixels, and guessing
   * from the aspect ratio misfires on rounding (a composed canvas is
   * integer-sized, so its aspect only approximates the page's) and on stale
   * canvases composed under a previous layout. Guessing wrong composes the
   * page twice, shrinking the content into its own text block.
   *
   * @returns {{canvas: (HTMLCanvasElement|OffscreenCanvas|ImageBitmap|null), placed: boolean}} Tagged surface.
   */
  get displaySurface() {
    const m = this.metadata;
    if (!m) return EMPTY_SURFACE;
    return taggedSurface(m.displayCanvasOverride, false)
      ?? taggedSurface(m.composedDisplayCanvas, true)
      ?? taggedSurface(m.srcCanvas, false)
      ?? taggedSurface(m.composedPreviewCanvas, true)
      ?? taggedSurface(m.previewCanvas, false)
      ?? EMPTY_SURFACE;
  }

  /**
   * The best preview-resolution bitmap, tagged the same way as
   * {@link ViewerPage#displaySurface}.
   *
   * Composed previews outrank the raw thumbnail source: both are cheap, but
   * only the composed one carries the page's margins, so preferring the raw
   * bitmap would turn pages with no placed preview yet at preview-texture
   * sizes (high zoom, mid-jump turn steps) as unplaced, full-bleed art.
   *
   * @returns {{canvas: (HTMLCanvasElement|OffscreenCanvas|ImageBitmap|null), placed: boolean}} Tagged surface.
   */
  get previewSurface() {
    const m = this.metadata;
    if (!m) return EMPTY_SURFACE;
    return taggedSurface(m.placedPreviewCanvas, true)
      ?? taggedSurface(m.composedPreviewCanvas, true)
      ?? taggedSurface(m.thumbnailSourceCanvas, false)
      ?? taggedSurface(m.previewCanvas, false)
      ?? taggedSurface(m.srcCanvas, false)
      ?? EMPTY_SURFACE;
  }
  // Raw (unmposed) bitmaps. The renderer's show-through code still does its
  // own placement composition for the back-face appearance and needs these
  // unmodified source bitmaps to do that. Phase 4 will lift the show-through
  // composition into the app so these go away.
  get rawPreviewCanvas() { return this.metadata?.previewCanvas ?? null; }
  get rawDisplayCanvas() {
    const m = this.metadata;
    return m?.displayCanvasOverride ?? m?.srcCanvas ?? m?.previewCanvas ?? null;
  }
  get thumbnailSourceCanvas() { return this.metadata?.thumbnailSourceCanvas ?? null; }
  get placedPreviewCanvas() { return this.metadata?.placedPreviewCanvas ?? null; }
  get displayCanvasOverride() { return this.metadata?.displayCanvasOverride ?? null; }
  get thumbnailCanvas() { return this.metadata?.thumbnailCanvas ?? null; }
  get contentAlignX() { return this.metadata?.contentAlignX ?? null; }
  get contentAlignY() { return this.metadata?.contentAlignY ?? null; }
  get cover() { return this.metadata?.cover ?? false; }
  get spread() { return this.metadata?.spread ?? false; }
  get fitAxis() { return this.metadata?.fitAxis ?? "inside"; }
  get crop() { return this.metadata?.crop ?? null; }

  getCropFor(sourceCanvas) {
    return this.metadata?.getCropFor?.(sourceCanvas) ?? { ...DEFAULT_CROP };
  }
}
