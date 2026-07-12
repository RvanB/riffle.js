Riffle shows two facing pages at a time — a **spread**. Navigation is in terms
of spreads, and every method lives directly on the {@link RiffleViewer}
element.

## Relative navigation

Use `navigateBy` to move by a number of spreads. It animates a page turn and
respects any turn already in flight (it reads the *effective* target, not just
the settled spread):

```js
nextButton.addEventListener("click", () => viewer.navigateBy(+1));
prevButton.addEventListener("click", () => viewer.navigateBy(-1));
```

## Absolute navigation

Use `navigateTo(spreadIndex)` to jump to a specific spread:

```js
viewer.navigateTo(0);                 // first spread
viewer.navigateTo(viewer.numSpreads - 1); // last spread
```

## Keyboard navigation

```js
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") viewer.navigateBy(+1);
  if (e.key === "ArrowLeft") viewer.navigateBy(-1);
});
```

## Jump to a page

Spreads show two pages at once, so "page 7" and "spread 3" aren't the same
number. Use `goToPage` to navigate by **page number** (1-based) without doing
any of that math yourself:

```js
viewer.goToPage(1);              // first page
viewer.goToPage(viewer.pageCount); // last page

pageInput.addEventListener("change", () => {
  viewer.goToPage(Number(pageInput.value));
});
```

To show a "page N of M" readout, ask which pages are on screen with
`pagesInSpread` — it returns the 1-based page numbers in a spread, e.g.
`[3, 4]`:

```js
function readout() {
  const pages = viewer.pagesInSpread(viewer.effectiveSpread); // e.g. [3, 4]
  label.textContent = `pages ${pages.join("–")} of ${viewer.pageCount}`;
}
viewer.on("effectivespreadchange", readout);
```

## Reading the current position

- `viewer.currentSpread` — the settled spread on screen.
- `viewer.effectiveSpread` — the spread being turned *to*, including an
  in-flight animation. Use this when you need "where are we heading."
- `viewer.numSpreads` — total spreads in the document.
- `viewer.isAnimating` — whether a page turn is currently animating.

To keep your own UI (a page counter, buttons) in sync as the user turns pages,
listen for the `spreadchange` event — see {@tutorial 06-events}.
