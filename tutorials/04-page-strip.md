A **page strip** is a scrollable row of page thumbnails, kept in sync with the
viewer. Clicking a thumbnail navigates to that page. It's a separate component,
so you can place it wherever your layout needs it — above, below, or beside the
viewer.

## Create and append

{@link createPageStrip} takes a viewer and returns a `<div>` with the class
`riffle-page-strip`:

```js
import { createViewer, createPageStrip } from "riffle";

const viewer = createViewer();
document.getElementById("viewport").append(viewer);

const strip = createPageStrip(viewer);
document.getElementById("strip").append(strip);
```

The strip populates itself with one thumbnail per page as the document loads,
highlights the current spread, and scrolls to keep it centered. You don't have
to wire any of that up.

## Styling

Riffle imposes no layout — style the strip yourself by targeting its stable
class. To lay the thumbnails out in a horizontal, scrollable row:

```css
.riffle-page-strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
}
```

Target the component's own class rather than the DOM Riffle generates inside
it — the internal structure is not part of the public API and may change.

## Multiple strips

You can bind more than one strip to the same viewer (for example a compact one
in a toolbar and a larger one in a sidebar). Each stays in sync independently:

```js
toolbar.append(createPageStrip(viewer));
sidebar.append(createPageStrip(viewer));
```
