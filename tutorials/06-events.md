The viewer is an event emitter. Subscribe with `viewer.on(name, handler)` and
unsubscribe with `viewer.off(name, handler)`. Use events to keep your own UI —
page counters, buttons, zoom readouts — in sync with what the viewer is doing.

```js
function onSpreadChange({ spreadIndex }) {
  counter.textContent = `${spreadIndex + 1} / ${viewer.numSpreads}`;
}

viewer.on("spreadchange", onSpreadChange);
// later…
viewer.off("spreadchange", onSpreadChange);
```

> These are Riffle's own events, delivered through `viewer.on` / `viewer.off` —
> not DOM events, so `addEventListener` won't receive them.

## Events

| Event | Payload | Fires when |
|-------|---------|-----------|
| `sourcechange` | `{ source }` | A new document/source is displayed. |
| `spreadchange` | `{ spreadIndex }` | A page turn settles on a new spread. |
| `effectivespreadchange` | `{ spreadIndex }` | The *target* spread changes, at the start of a turn (before it settles). |
| `beforenavigate` | `{ fromSpread, toSpread, preferredPageIndex }` | Navigation is requested, before it begins. |
| `animationstart` | `{ fromSpread, toSpread, direction }` | A page-turn animation starts. |
| `animationend` | `{}` | A page-turn animation finishes. |
| `zoomchange` | `{ contentZoom }` | The zoom factor changes. |
| `pageready` | `{ pageIndex, animating }` | A page's high-resolution bitmap has finished rendering. |
| `pagecountchanged` | *(none)* | The number of pages in the source changes. |

## Common recipe: keep a counter and buttons in sync

```js
function sync() {
  counter.textContent = `${viewer.currentSpread + 1} / ${viewer.numSpreads}`;
  prevButton.disabled = viewer.currentSpread <= 0;
  nextButton.disabled = viewer.currentSpread >= viewer.numSpreads - 1;
}

viewer.on("sourcechange", sync);
viewer.on("spreadchange", sync);
```

## Common recipe: synchronize two viewers

Mirror one viewer's page turns onto another by forwarding `spreadchange`:

```js
main.on("spreadchange", ({ spreadIndex }) => {
  if (mirror.currentSpread !== spreadIndex) mirror.navigateTo(spreadIndex);
});
```
