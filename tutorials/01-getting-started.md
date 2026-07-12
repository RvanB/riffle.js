Riffle is a **DOM-native** book/PDF viewer. Components are regular DOM
elements with methods — there is no separate controller object and no mounting
step. You create an element, append it to the page, and call methods on it.

## The programming model

A viewer *is* a DOM element (a `<canvas>`) with the viewer API mixed in.

```js
import { createViewer } from "riffle";

const viewer = createViewer();   // returns a <canvas> element
document.body.append(viewer);    // append it like any other node

await viewer.openPdf(file);       // call methods directly on it
```

That's the whole mental model:

1. **Create** a viewer with {@link createViewer}.
2. **Append** it wherever you want it in the DOM.
3. **Call** methods on it (`openPdf`, `navigateTo`, `on`, …).

Riffle never wraps your layout or injects styling. You decide where the viewer
lives, how it sizes, and how it scrolls.

## A minimal, paste-and-run page

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* The viewer sizes itself to its container. */
      #viewport {
        width: 800px;
        height: 600px;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <input id="file-picker" type="file" accept="application/pdf" />
    <div id="viewport"></div>

    <script type="module">
      import { createViewer } from "https://cdn.jsdelivr.net/gh/RvanB/riffle.js@v0.2.0/dist/riffle.min.js";

      const viewer = createViewer();
      document.getElementById("viewport").append(viewer);

      document.getElementById("file-picker").addEventListener("change", (e) => {
        viewer.openPdf(e.target.files[0]);
      });
    </script>
  </body>
</html>
```

## What counts as public API

Everything in the {@link createViewer} and {@link createPageStrip} reference,
plus the paper/render options in {@link RiffleOptions}, is the stable public
API. Undocumented properties and the generated DOM structure inside the viewer
may change between releases — don't rely on them.

## Next steps

- {@tutorial 02-load-a-pdf} — load from a file, a URL, or bytes.
- {@tutorial 03-navigate-pages} — turn pages programmatically.
- {@tutorial 04-page-strip} — add a thumbnail strip.
