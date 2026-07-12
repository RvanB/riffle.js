// Public API.
//
// Riffle is a DOM-native PDF/book viewer: a viewer *is* a DOM element with a
// small set of methods. Everything documented here is the stable public API.
// The modules under src/ (renderers, controllers, models, loaders, layout
// math, primitives) are internal implementation details and may change
// between releases — do not import them directly.
export { createViewer } from "./createViewer.js";
export { createPageStrip } from "./createPageStrip.js";

// Page sources. Use these to display content other than a PDF file loaded via
// `viewer.openPdf()` — e.g. an array of page images via ImagePageSource, or a
// custom source subclassing PageSource.
export { PageSource } from "./sources/PageSource.js";
export { ImagePageSource } from "./sources/ImagePageSource.js";
export { PdfPageSource } from "./sources/PdfPageSource.js";
