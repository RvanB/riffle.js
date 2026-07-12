import { BookViewer } from "./BookViewer.js";
import { WebGPUSpreadRenderer } from "./rendering/WebGPUSpreadRenderer.js";
import { SpreadRenderer } from "./rendering/SpreadRenderer.js";
import { PdfTextLayerController } from "./controllers/PdfTextLayerController.js";

function pickRendererClass(option) {
  if (option === "2d") return SpreadRenderer;
  if (option === "webgpu") return WebGPUSpreadRenderer;
  if (option && typeof option === "function") return option;
  return "gpu" in navigator ? WebGPUSpreadRenderer : SpreadRenderer;
}

/**
 * Options for {@link createViewer}.
 *
 * @typedef {Object} RiffleOptions
 * @property {"auto"|"webgpu"|"2d"|Function} [renderer="auto"] Renderer selection. `auto` uses WebGPU when available.
 * @property {PageSource|null} [source=null] Initial page source.
 * @property {Partial<Layout>|null} [layout=null] Initial layout overrides.
 * @property {Partial<Display>|null} [display=null] Initial display overrides.
 * @property {"natural"|"ivory"|"bright-white"} [paperPreset] Named paper preset.
 * @property {string} [contentBlendMode="multiply"] Blend mode for page content.
 * @property {number} [paperThickness] Paper edge and turn-lighting strength from 0 to 1.
 * @property {number} [showThrough=0] Strength of the show-through translucency (adjacent page bleeding through) from 0 (off) to 1.
 * @property {number} [paperTextureStrength] Paper texture/normal strength from 0 to 1.
 * @property {boolean} [showPageBorder=true] Whether to render the page edge treatment.
 * @property {number} [maxHighResPages=8] High-resolution page bitmap LRU capacity.
 * @property {HTMLElement|null} [viewport=null] Element used for zoom measurement and scroll preservation.
 * @property {boolean} [selectablePdfText=true] Whether to overlay selectable PDF text on settled spreads.
 * @property {number} [renderScale=1] Pixel supersampling multiplier for the rendered spread canvas.
 * @property {number} [pdfRenderScale=1.5] Baseline PDF rasterization scale before DPR/zoom.
 * @property {number} [pdfRenderScaleHeadroom=1.1] Extra PDF rasterization margin above visible size.
 * @property {number} [pdfMaxRenderScale=0] Maximum PDF rasterization scale; set 0 to disable.
 * @property {number} [pdfPreviewSourceScale=0.5] Fallback PDF preview rasterization scale when page dimensions are unavailable.
 */

/**
 * A Riffle viewer.
 *
 * A viewer *is* a DOM element (a `<canvas>`) with the viewer API mixed in.
 * Create it with {@link createViewer}, append it to the document, then call
 * these methods directly on it — there is no separate controller object or
 * mounting step. Riffle imposes no wrapper element or layout styling; you
 * decide how the element is positioned, scrolled, and decorated.
 *
 * @interface RiffleViewer
 */

/**
 * Number of pages in the current document.
 * @member {number} pageCount
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * Total number of two-page spreads in the current document.
 * @member {number} numSpreads
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * Index of the settled spread currently on screen.
 * @member {number} currentSpread
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * The target spread, including any in-flight page turn. Use this for
 * "where are we heading" reads (e.g. a page counter that updates the moment a
 * turn starts rather than when it settles).
 * @member {number} effectiveSpread
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * Whether a page turn is currently animating.
 * @member {boolean} isAnimating
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * Current visual zoom factor (`1` = fit to viewport).
 * @member {number} contentZoom
 * @memberof RiffleViewer
 * @instance
 * @readonly
 */

/**
 * Loads a PDF and displays its first spread. To load from a URL, `fetch()` it
 * first and pass the resulting `ArrayBuffer`.
 *
 * @function openPdf
 * @memberof RiffleViewer
 * @instance
 * @param {File|Blob|ArrayBuffer} source The PDF to display.
 * @returns {Promise<void>} Resolves once the first spread is on screen.
 */

/**
 * Displays a list of image files, one page per image. Fits the layout to the
 * first image. Non-image files in the list are ignored.
 *
 * @function openImages
 * @memberof RiffleViewer
 * @instance
 * @param {File[]|FileList} files The images to display.
 * @returns {Promise<void>} Resolves once the first spread is on screen.
 */

/**
 * Displays an arbitrary page source and fits the layout to its first page.
 * Most callers use {@link RiffleViewer#openPdf} or
 * {@link RiffleViewer#openImages} instead; reach for this to display a custom
 * {@link PageSource}.
 *
 * @function setSource
 * @memberof RiffleViewer
 * @instance
 * @param {PageSource} source The source to display.
 * @returns {void}
 */

/**
 * Navigates to a spread by index, animating a page turn.
 *
 * @function navigateTo
 * @memberof RiffleViewer
 * @instance
 * @param {number} spreadIndex Destination spread index.
 * @returns {void}
 */

/**
 * Navigates by a relative number of spreads, animating a page turn. Respects a
 * turn already in flight (it moves from the effective target, not the settled
 * spread).
 *
 * @function navigateBy
 * @memberof RiffleViewer
 * @instance
 * @param {number} delta Spreads to move, e.g. `+1` (next) or `-1` (previous).
 * @returns {void}
 */

/**
 * Navigates so a given page is visible, focusing it within its spread. A no-op
 * if the page is out of range.
 *
 * @function goToPage
 * @memberof RiffleViewer
 * @instance
 * @param {number} page 1-based page number (`1` is the first page).
 * @returns {void}
 */

/**
 * The 1-based page number(s) visible in a spread — e.g. `[3, 4]`, or `[1]` for
 * a single-page spread. Empty when the spread has no source pages. Handy for a
 * "page N of M" readout: `viewer.pagesInSpread(viewer.effectiveSpread)`.
 *
 * @function pagesInSpread
 * @memberof RiffleViewer
 * @instance
 * @param {number} spreadIndex Spread to inspect.
 * @returns {number[]} 1-based page numbers on that spread.
 */

/**
 * Multiplies the current zoom by a factor.
 *
 * @function adjustZoom
 * @memberof RiffleViewer
 * @instance
 * @param {number} factor Zoom multiplier, e.g. `1.25` to zoom in, `0.8` out.
 * @returns {void}
 */

/**
 * Restores the fit-to-viewport zoom.
 *
 * @function resetZoom
 * @memberof RiffleViewer
 * @instance
 * @returns {void}
 */

/**
 * Sets the element used for zoom measurement and scroll preservation. Defaults
 * to the viewer's parent; set this when the viewer isn't a direct child of the
 * element you scroll.
 *
 * @function setViewport
 * @memberof RiffleViewer
 * @instance
 * @param {HTMLElement} element The scroll/viewport element.
 * @returns {void}
 */

/**
 * Subscribes to a viewer event. See the {@tutorial 06-events} guide for the
 * event names and their payloads.
 *
 * @function on
 * @memberof RiffleViewer
 * @instance
 * @param {string} event Event name, e.g. `"spreadchange"`.
 * @param {Function} handler Called with the event payload.
 * @returns {void}
 */

/**
 * Removes a previously registered event listener.
 *
 * @function off
 * @memberof RiffleViewer
 * @instance
 * @param {string} event Event name.
 * @param {Function} handler The same handler reference passed to `on`.
 * @returns {void}
 */

/**
 * Attaches an hOCR text layer to the current source for selectable and
 * searchable text *(advanced)*. Works with pages loaded from a PDF
 * ({@link RiffleViewer#openPdf}) or from images ({@link RiffleViewer#openImages}).
 *
 * @function openHocr
 * @memberof RiffleViewer
 * @instance
 * @param {File|Blob|string} fileOrText hOCR markup, or a file/blob containing it.
 * @param {Object} [options={}] Text-attachment options.
 * @param {number} [options.pageOffset=0] Index of the first document page the hOCR pages map to.
 * @returns {Promise<{pages: Object[], attached: number}>} Resolves with the parsed `pages` and the `attached` count (number of document pages updated).
 */

/**
 * Creates a Riffle viewer.
 *
 * The returned value is a `<canvas>` element with the viewer API mixed in.
 * Append it to the document and call methods on it directly; Riffle imposes no
 * DOM wrapper or layout styling.
 *
 * @param {RiffleOptions} [options={}] Viewer options.
 * @returns {RiffleViewer} A canvas element with the public viewer API.
 */
export function createViewer({
  renderer = "auto",
  source = null,
  layout = null,
  display = null,
  paperPreset,
  contentBlendMode = "multiply",
  paperThickness,
  showThrough,
  paperTextureStrength,
  showPageBorder = true,
  maxHighResPages = 8,
  viewport = null,
  selectablePdfText = true,
  renderScale = 1,
  pdfRenderScale = 1.5,
  pdfRenderScaleHeadroom = 1.1,
  pdfMaxRenderScale = 0,
  pdfPreviewSourceScale = 0.5,
} = {}) {
  const spreadCanvas = document.createElement("canvas");
  spreadCanvas.width = 0;
  spreadCanvas.height = 0;
  spreadCanvas.style.display = "block";
  spreadCanvas.style.width = "100%";
  spreadCanvas.style.height = "100%";
  spreadCanvas.style.objectFit = "contain";

  const rendererClass = pickRendererClass(renderer);
  const bookViewer = new BookViewer({
    spreadCanvas,
    viewport,          // BookViewer falls back to spreadCanvas.parentElement
    rendererClass,
    source,
    layout,
    display,
    paperPreset,
    contentBlendMode,
    paperThickness,
    showThrough,
    paperTextureStrength,
    showPageBorder,
    maxHighResPages,
    renderScale,
    pdfRenderScale,
    pdfRenderScaleHeadroom,
    pdfMaxRenderScale,
    pdfPreviewSourceScale,
  });
  const pdfTextLayer = selectablePdfText ? new PdfTextLayerController(bookViewer) : null;

  // Display a source, deriving the spread layout from its first page's aspect
  // ratio. openPdf and setSource both route through here so the page geometry
  // is correct no matter how content was loaded — callers never set layout.
  const applySource = (src) => {
    bookViewer.setSource(src);
    const firstAspect = src?.getPageMetadata?.(0)?.aspectRatio ?? 0.647;
    bookViewer.setLayout({
      pw: bookViewer.layout.ph * firstAspect,
      ratio: firstAspect * 0.999,
    });
  };

  const api = {
    // --- Content ---
    get pageCount() { return bookViewer.book.sourcePageCount(); },
    openPdf: async (file) => {
      const { PdfPageSource } = await import("./sources/PdfPageSource.js");
      const src = new PdfPageSource();
      await src.openPdf(file);
      applySource(src);
    },
    openImages: async (files) => {
      const { createImageSourceFromFiles } = await import("./sources/imageFilesSource.js");
      const src = await createImageSourceFromFiles(files);
      if (src) applySource(src);
    },
    setSource: (s) => applySource(s),

    // --- Navigation ---
    get numSpreads() { return bookViewer.numSpreads; },
    get currentSpread() { return bookViewer.currentSpread; },
    // The currently-targeted spread including any in-flight animation. Use
    // this for "where are we heading" reads (e.g., relative navigation).
    get effectiveSpread() { return bookViewer.navigationController.getEffectiveSpread(); },
    get isAnimating() { return bookViewer.isAnimating; },
    navigateTo: (s, p) => bookViewer.navigateTo(s, p),
    navigateBy: (delta) => bookViewer.navigateTo(bookViewer.navigationController.getEffectiveSpread() + delta),
    // Navigate so 1-based page `page` is visible, focusing it within its
    // spread. No-op if the page is out of range.
    goToPage: (page) => {
      const sourcePageIndex = page - 1;
      const spread = bookViewer.book.spreadIndexForSourcePage(sourcePageIndex);
      if (spread < 0) return;
      bookViewer.navigateTo(spread, bookViewer.book.sourcePageIndexToPageIndex(sourcePageIndex));
    },
    // The 1-based page number(s) visible in a spread, e.g. [3, 4] (or [1] for a
    // single-page spread). Empty when the spread has no source pages.
    pagesInSpread: (spreadIndex) => {
      const book = bookViewer.book;
      const entries = book.spreadPageEntries?.(spreadIndex);
      if (!entries) return [];
      const pages = [];
      for (const side of [entries.left, entries.right]) {
        const sourcePageIndex = book.pageIndexToSourcePageIndex(side?.pageIndex ?? -1);
        if (sourcePageIndex >= 0) pages.push(sourcePageIndex + 1);
      }
      return pages;
    },

    // --- Zoom ---
    get contentZoom() { return bookViewer.contentZoom; },
    adjustZoom: (d) => bookViewer.adjustZoom(d),
    resetZoom: () => bookViewer.resetZoom(),
    setViewport: (el) => bookViewer.setViewport(el),

    // --- Events ---
    on: (event, fn) => bookViewer.on(event, fn),
    off: (event, fn) => bookViewer.off(event, fn),

    // --- Text layer (advanced) ---
    openHocr: async (fileOrText, options = {}) => {
      const { loadHocr } = await import("./loading/hocr.js");
      const pages = await loadHocr(fileOrText);
      const attach = bookViewer.source?.attachTextContent;
      if (typeof attach !== "function") {
        throw new Error("Current Riffle source does not support external text content");
      }
      const attached = attach.call(bookViewer.source, pages, options);
      pdfTextLayer?.update();
      return { pages, attached };
    },
  };
  // Use defineProperties so getters stay live — Object.assign would
  // invoke each getter once at copy time and stamp the resulting value,
  // freezing `numSpreads`/`currentSpread`/etc. at construction-time
  // values (back when the book was empty).
  Object.defineProperties(spreadCanvas, Object.getOwnPropertyDescriptors(api));

  // Internal engine handle used by createPageStrip to bind to the same book.
  // Non-enumerable and not part of the public API — its shape can change
  // between releases; use the documented methods above instead.
  Object.defineProperty(spreadCanvas, "bookViewer", { value: bookViewer, enumerable: false });
  return spreadCanvas;
}
