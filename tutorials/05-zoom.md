The viewer fits the spread to its container by default. You can zoom in and out
through methods on the {@link RiffleViewer} element.

## Zoom controls

`adjustZoom(delta)` multiplies the current zoom by `delta`; `resetZoom()`
restores the fit-to-viewport zoom:

```js
zoomInButton.addEventListener("click", () => viewer.adjustZoom(1.25));
zoomOutButton.addEventListener("click", () => viewer.adjustZoom(0.8));
resetButton.addEventListener("click", () => viewer.resetZoom());
```

## Wheel / trackpad zoom

Zoom on ctrl/⌘ + wheel, the convention most PDF readers use:

```js
viewer.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  viewer.adjustZoom(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });
```

## Reading the zoom

`viewer.contentZoom` reports the current visual zoom factor (`1` = fit to
viewport). To keep a zoom readout in sync as it changes, listen for the
`zoomchange` event — see {@tutorial 06-events}.

## The viewport element

Zoom is measured against a **viewport** element — the scrollable container the
spread is fit into. By default that's the viewer's parent. Pass an explicit
element via the `viewport` option to {@link createViewer}, or call
`viewer.setViewport(el)` later, when the viewer isn't a direct child of the
element you scroll.
