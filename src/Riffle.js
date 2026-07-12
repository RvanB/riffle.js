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
 * Options for {@link Riffle}.
 *
 * @typedef {Object} RiffleOptions
 * @property {"auto"|"webgpu"|"2d"|Function} [renderer="auto"] Renderer selection. `auto` uses WebGPU when available.
 * @property {PageSource|null} [source=null] Initial page source.
 * @property {Partial<Layout>|null} [layout=null] Initial layout overrides.
 * @property {Partial<Display>|null} [display=null] Initial display overrides.
 * @property {"natural"|"ivory"|"bright-white"} [paperPreset] Named paper preset.
 * @property {string} [contentBlendMode="multiply"] Blend mode for page content.
 * @property {number} [paperThickness] Paper edge and turn-lighting strength from 0 to 1.
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
 * Creates a Riffle viewer canvas.
 *
 * The returned value is the canvas itself with viewer methods and getters
 * mixed in. Riffle imposes no DOM wrapper or layout styling; the consumer
 * decides how the canvas is positioned, scrolled, and decorated.
 *
 * @param {RiffleOptions} [options={}] Viewer options.
 * @returns {RiffleCanvas} Canvas element with the public viewer API.
 */
export function Riffle({
  renderer = "auto",
  source = null,
  layout = null,
  display = null,
  paperPreset,
  contentBlendMode = "multiply",
  paperThickness,
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

  const api = {
    bookViewer,
    pdfTextLayer,
    get backendName() { return bookViewer.backendName; },
    get contentZoom() { return bookViewer.contentZoom; },
    get renderZoom() { return bookViewer.renderZoom; },
    get currentSpread() { return bookViewer.currentSpread; },
    // The currently-targeted spread including any in-flight animation. Use
    // this for "where are we heading" reads (e.g., relative navigation).
    get effectiveSpread() { return bookViewer.navigationController.getEffectiveSpread(); },
    get numSpreads() { return bookViewer.numSpreads; },
    get isAnimating() { return bookViewer.isAnimating; },
    navigateBy: (delta) => bookViewer.navigateTo(bookViewer.navigationController.getEffectiveSpread() + delta),
    setSource: (s) => bookViewer.setSource(s),
    setLayout: (l) => bookViewer.setLayout(l),
    setDisplay: (d) => bookViewer.setDisplay(d),
    setViewport: (el) => bookViewer.setViewport(el),
    setShowPageBorder: (b) => bookViewer.setShowPageBorder(b),
    navigateTo: (s, p) => bookViewer.navigateTo(s, p),
    spreadIndexForPage: (pageIndex) => bookViewer.book.spreadIndexForPage(pageIndex),
    primaryPageIndexForSpread: (spreadIndex) => bookViewer.book.primaryPageIndexForSpread(spreadIndex),
    sourcePageCount: () => bookViewer.book.sourcePageCount(),
    sourcePageIndexToPageIndex: (sourcePageIndex) => bookViewer.book.sourcePageIndexToPageIndex(sourcePageIndex),
    pageIndexToSourcePageIndex: (pageIndex) => bookViewer.book.pageIndexToSourcePageIndex(pageIndex),
    spreadIndexForSourcePage: (sourcePageIndex) => bookViewer.book.spreadIndexForSourcePage(sourcePageIndex),
    primarySourcePageIndexForSpread: (spreadIndex) => bookViewer.book.primarySourcePageIndexForSpread(spreadIndex),
    adjustZoom: (d) => bookViewer.adjustZoom(d),
    resetZoom: () => bookViewer.resetZoom(),
    redraw: () => bookViewer.redraw(),
    getSpreadGeometry: () => bookViewer.getSpreadGeometry(),
    on: (event, fn) => bookViewer.on(event, fn),
    off: (event, fn) => bookViewer.off(event, fn),
    openPdf: async (file) => {
      const { PdfPageSource } = await import("./sources/PdfPageSource.js");
      const src = new PdfPageSource();
      await src.openPdf(file);
      bookViewer.setSource(src);
      const firstAspect = src.getPageMetadata(0)?.aspectRatio ?? 0.647;
      bookViewer.setLayout({
        pw: bookViewer.layout.ph * firstAspect,
        ratio: firstAspect * 0.999,
      });
    },
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
  return spreadCanvas;
}
