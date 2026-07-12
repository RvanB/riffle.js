import { PageStrip } from "./controllers/PageStrip.js";

/**
 * Creates a thumbnail page strip bound to a Riffle viewer.
 *
 * The returned element is a `div` with the class `riffle-page-strip`,
 * populated with one thumbnail per page as the source loads. Style it by
 * targeting that class — e.g. `.riffle-page-strip { display: flex; }`. Riffle
 * imposes no layout of its own; you own all styling and placement.
 *
 * @param {RiffleViewer} viewer Viewer element returned by {@link createViewer}.
 * @returns {HTMLDivElement} The `.riffle-page-strip` element. Append it wherever you like.
 */
export function createPageStrip(viewer) {
  const container = document.createElement("div");
  container.className = "riffle-page-strip";
  const bookViewer = viewer.bookViewer ?? viewer;
  const pageStrip = new PageStrip(container, {
    onPageClick: (pageIndex) => {
      bookViewer.navigateTo(bookViewer.book.spreadIndexForPage(pageIndex), pageIndex);
    },
    getEffectEntry: () => ({ pipeline: [], key: "" }),
    getDisplay: () => bookViewer.display,
    getLayout: () => bookViewer.layout,
  });

  const refresh = () => {
    pageStrip.update(bookViewer.book, {
      appMode: "content",
      effectiveSpread: bookViewer.navigationController.getEffectiveSpread(),
      editingPageIdx: -1,
      selectedPageIdxs: new Set(),
    });
  };

  bookViewer.on("sourcechange", refresh);
  bookViewer.on("spreadchange", refresh);
  // Scroll-track the in-flight target so the strip moves WITH the page
  // turn instead of waiting for it to settle.
  bookViewer.on("effectivespreadchange", refresh);
  bookViewer.on("pageready", ({ pageIndex }) => {
    const page = bookViewer.book.pages[pageIndex];
    if (page) pageStrip.updateThumbnail(pageIndex, page);
  });

  container.pageStrip = pageStrip;
  container.refresh = refresh;
  return container;
}
