Riffle can overlay a **selectable text layer** on the rendered pages, so users
can select and copy text and find it with the browser's search (Ctrl/⌘-F).
There are two ways text gets there.

## Selectable text from a PDF (automatic)

For PDFs that contain real text, the text layer is on by default — you don't
have to do anything. Load a PDF and the words become selectable once each
spread settles.

To turn it off, pass `selectablePdfText: false` when creating the viewer:

```js
import { createViewer } from "riffle";

const viewer = createViewer({ selectablePdfText: false });
```

## Adding OCR text for scanned pages (`openHocr`)

Scanned documents have no embedded text — the page is just an image. To make
them selectable, run OCR to produce **hOCR** (the standard HTML format emitted
by Tesseract and most OCR engines) and attach it with
{@link RiffleViewer#openHocr}. This works whether the pages came from a PDF or
from images:

```js
// Scanned images…
await viewer.openImages(scanFiles);
// …or an image-only PDF:
// await viewer.openPdf(scannedPdfFile);

// hocr can be a File/Blob, or a markup string.
const { attached } = await viewer.openHocr(hocrFile);
console.log(`attached OCR text to ${attached} pages`);
```

`openHocr` parses the `.ocr_page` / `.ocrx_word` boxes, positions each word
over the matching page, and refreshes the text layer. Where a page already has
embedded text, attached OCR text takes precedence.

### Aligning pages

hOCR pages are matched to document pages in order. If your hOCR only covers
part of the document, use `pageOffset` to say which page the first hOCR page
maps to:

```js
// OCR starts at the 3rd page (0-based offset 2).
await viewer.openHocr(hocrText, { pageOffset: 2 });
```
