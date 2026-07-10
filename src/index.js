// Public API
export { Riffle } from "./Riffle.js";
export { RifflePageStrip } from "./RifflePageStrip.js";
export { BookViewer } from "./BookViewer.js";

// Sources
export { PageSource } from "./sources/PageSource.js";
export { ImagePageSource } from "./sources/ImagePageSource.js";
export { PdfPageSource } from "./sources/PdfPageSource.js";

// Models
export { ViewerBook } from "./model/ViewerBook.js";
export { ViewerPage } from "./model/ViewerPage.js";

// Renderers
export { WebGPUSpreadRenderer } from "./rendering/WebGPUSpreadRenderer.js";
export { SpreadRenderer } from "./rendering/SpreadRenderer.js";

// Controllers (for callers who want a lower-level page strip with custom
// callbacks than RifflePageStrip provides).
export { PageStrip } from "./controllers/PageStrip.js";
export { NavigationController } from "./controllers/NavigationController.js";
export { ZoomController } from "./controllers/ZoomController.js";
export { PdfTextLayerController } from "./controllers/PdfTextLayerController.js";

// Layout helpers (consumers building their own composition pipelines may
// need these to align with the renderer's page-rect math).
export {
  computeLayoutValues,
  computeMargins,
  computeScale,
  computeContentScale,
  getPageGeometry,
} from "./rendering/layout.js";

// Primitive draw helpers + crop-handle constants (for overlay UIs).
export {
  CROP_HANDLE_LEN,
  CROP_HANDLE_PAD,
  CROP_HANDLE_THICK,
  drawCropHandles,
  drawMarginOverlay,
  drawVdG,
  drawPageBorder,
  getPageChromeColor,
  snappedStrokeRect,
  drawDirectionalLightFalloff,
} from "./rendering/primitives.js";

// PDF rasterization client (use this if you want raw PDF page bitmaps
// without going through PdfPageSource — e.g. for export pipelines).
export {
  loadPdfDocument,
  renderPdfPage,
  getPdfPageAspectRatio,
  getPdfPageInfo,
  getPdfPageRasterSourceInfo,
  getPdfPageTextContent,
  getPdfPageLinkAnnotations,
  requestPdfDocumentCleanup,
} from "./loading/pdfLoader.js";
export { loadHocr, parseHocr } from "./loading/hocr.js";

// Image loading + downscaling helpers.
export { loadImageFile, loadImagePreview } from "./loading/imageLoader.js";
export { downscaleCanvasToMaxEdgeSync } from "./loading/downscaleCanvas.js";

// Paper presets.
export {
  applyPaperPreset,
  getPaperPresetOptions,
  normalizePaperPreset,
  getPaperPresetIdForColor,
  DEFAULT_PAPER_PRESET_ID,
} from "./model/paper.js";
