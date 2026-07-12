The viewer's {@link RiffleViewer} `openPdf` method takes a `File`, a `Blob`,
or an `ArrayBuffer`. It rasterizes the PDF, displays the first spread, and
resolves when the document is ready.

## From a file input

```js
import { createViewer } from "riffle";

const viewer = createViewer();
document.getElementById("viewport").append(viewer);

document.querySelector("input[type=file]").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) viewer.openPdf(file);
});
```

## From a URL

`openPdf` does not fetch for you — fetch the bytes and pass the `ArrayBuffer`:

```js
const bytes = await fetch("/books/example.pdf").then((r) => r.arrayBuffer());
await viewer.openPdf(bytes);
```

## From a drag-and-drop drop

```js
viewer.addEventListener("dragover", (e) => e.preventDefault());
viewer.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) viewer.openPdf(file);
});
```

## Awaiting the load

`openPdf` returns a promise. Await it (or chain `.then`) when you need to run
code once the document is on screen — for example to enable navigation
controls or read {@link RiffleViewer} `numSpreads`.

```js
await viewer.openPdf(file);
console.log(`${viewer.numSpreads} spreads`);
```

To display page images instead of a PDF, see
{@tutorial 07-images}.
