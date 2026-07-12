# riffle.js

riffle.js is a browser book viewer for page bitmaps and PDFs. It renders a
two-page spread with animated page turns, paper lighting, and translucency.

Riffle is **DOM-native and framework-agnostic**: a viewer *is* a DOM element
with a small set of methods. There is no controller object and no mounting
step — you create an element, append it, and call methods on it. Nothing
assumes React, Vue, Angular, or any framework.

- [Live demo](https://rvanb.github.io/riffle.js/)
- [Guides & API reference](https://rvanb.github.io/riffle.js/docs/)

![riffle.js screenshot](https://media.githubusercontent.com/media/RvanB/riffle.js/refs/heads/main/artifacts/riffle.png)

*A screenshot of [the demo](https://rvanbronkhorst.com/riffle.js/) — view its [source](https://github.com/RvanB/riffle.js/blob/main/index.html).*

## The programming model

```js
import { createViewer } from "riffle";

const viewer = createViewer(); // returns a <canvas> element
container.append(viewer);      // append it like any other node
await viewer.openPdf(file);    // call methods directly on it
```

1. **Create** a viewer with `createViewer()`.
2. **Append** it wherever you want it in the DOM.
3. **Call** methods on it (`openPdf`, `navigateBy`, `on`, …).

Riffle never wraps your layout or injects styling — you decide where the viewer
lives, how it sizes, and how it scrolls.

## Quick start

A minimal, paste-and-run HTML file with a viewer and a thumbnail strip:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* The viewer sizes itself to its scrollable container. */
      #viewport {
        width: 800px;
        height: 600px;
        overflow: auto;
      }
      /* Style the page strip through its stable class. */
      .riffle-page-strip {
        display: flex;
        flex-direction: row;
        gap: 4px;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <input id="file-picker" type="file" accept="application/pdf" />
    <div id="viewport"></div>
    <div id="strip"></div>

    <script type="module">
      import { createViewer, createPageStrip } from "https://cdn.jsdelivr.net/gh/RvanB/riffle.js@v0.2.0/dist/riffle.min.js";

      const viewer = createViewer();
      document.getElementById("viewport").append(viewer);
      document.getElementById("strip").append(createPageStrip(viewer));

      document.getElementById("file-picker").addEventListener("change", (e) => {
        viewer.openPdf(e.target.files[0]);
      });
    </script>
  </body>
</html>
```

## Guides

Task-first walkthroughs live in the docs:

- **Getting started** — the programming model and your first viewer.
- **Load a PDF** — from a file, a URL, or bytes.
- **Navigate pages** — turn pages and track position.
- **Add a thumbnail strip** — `createPageStrip` and styling.
- **Control zoom** — zoom methods and wheel/trackpad zoom.
- **Listen for events** — `on` / `off`, event names, and payloads.
- **Select & OCR text** — selectable PDF text and attaching hOCR.

## Public API

The public API is intentionally small:

- `createViewer(options)` — create a viewer element.
- `createPageStrip(viewer)` — create a thumbnail strip bound to a viewer.
- The viewer element's methods (`openPdf`, `navigateTo`, `navigateBy`,
  `adjustZoom`, `resetZoom`, `on`, `off`, …).

Everything documented in the [guides & API reference](https://rvanb.github.io/riffle.js/docs/)
is stable. Undocumented properties, internal modules under `src/`, and the DOM
structure Riffle generates inside its elements may change between releases —
please don't rely on them.
