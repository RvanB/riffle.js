Riffle can display a set of images as a book — scanned pages, exported artwork,
anything the browser can decode — with the same page-turn treatment as a PDF.

## openImages

Pass a `FileList` or an array of `File`s to {@link RiffleViewer} `openImages`.
It creates one page per image, fits the layout to the first image, and displays
the first spread. Non-image files are ignored.

```js
import { createViewer } from "riffle";

const viewer = createViewer();
document.getElementById("viewport").append(viewer);

document.querySelector("input[type=file]").addEventListener("change", (e) => {
  viewer.openImages(e.target.files);
});
```

The file input should allow images and multiple selection:

```html
<input type="file" accept="image/*" multiple />
```

## From URLs

`openImages` takes files, so fetch remote images into `File`/`Blob` objects
first:

```js
const urls = ["/pages/01.jpg", "/pages/02.jpg", "/pages/03.jpg"];
const files = await Promise.all(
  urls.map(async (url) => new File([await (await fetch(url)).blob()], url))
);
await viewer.openImages(files);
```

## Awaiting the load

Like `openPdf`, `openImages` returns a promise that resolves once the pages are
on screen, so you can then read {@link RiffleViewer} `pageCount` or wire up
navigation:

```js
await viewer.openImages(files);
console.log(`${viewer.pageCount} pages`);
```

Everything in the other guides — {@tutorial 03-navigate-pages},
{@tutorial 04-page-strip}, {@tutorial 05-zoom} — works the same whether the
pages came from a PDF or from images.
