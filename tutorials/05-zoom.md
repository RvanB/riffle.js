The viewer fits the spread to its container by default. You can zoom in and out
through methods on the {@link RiffleViewer} element.

## Zoom controls

`adjustZoom(direction)` takes a positive value to zoom in one step and a
negative value to zoom out. `setZoom(zoom)` sets an absolute zoom (0.5–6),
and `resetZoom()` restores the fit-to-viewport zoom:

```js
zoomInButton.addEventListener("click", () => viewer.adjustZoom(1));
zoomOutButton.addEventListener("click", () => viewer.adjustZoom(-1));
resetButton.addEventListener("click", () => viewer.resetZoom());
```

For continuous pinch zoom, pass the desired scale and an optional focal point
in browser client coordinates. The book stays anchored beneath that point:

```js
viewer.setZoom(startZoom * currentDistance / startDistance, {
  clientX: midpointX,
  clientY: midpointY,
});
```

The standalone demo handles two-finger gestures within the reader and prevents
the browser from scaling the whole webpage during those gestures.

## Wheel / trackpad zoom

Zoom on ctrl/⌘ + wheel, the convention most PDF readers use:

```js
viewer.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  viewer.setZoom(viewer.contentZoom * (e.deltaY < 0 ? 1.1 : 0.9));
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
