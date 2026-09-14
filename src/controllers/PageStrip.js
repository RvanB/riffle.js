import { PAGE_STRIP_DISPLAY_HEIGHT, SHARED_PREVIEW_SIZE } from "../previewSizing.js";

/**
 * Thumbnail page strip.
 *
 * {@link createPageStrip} wraps this for the common case — one call, bound to a
 * viewer, no configuration. Use the class directly when the host owns its own
 * page model, selection, or thumbnail sources: it draws whichever of
 * `placedPreviewCanvas` / `thumbnailCanvas` / `previewCanvas` a page carries,
 * and asks the host for display, layout, and per-page effect entries.
 *
 * @param {HTMLElement} container Element to populate with thumbnails.
 * @param {Object} callbacks Host callbacks.
 * @param {function(number, MouseEvent):void} callbacks.onPageClick Called with the clicked page index and the original event.
 * @param {function(Object):{pipeline: Array, key: string}} callbacks.getEffectEntry Per-page effect entry; its `key` participates in the repaint cache key.
 * @param {function():Object} callbacks.getDisplay Returns display settings (`paperColor`, `contentBlendMode`).
 * @param {function():Object|null} callbacks.getLayout Returns page layout, used for thumbnail aspect.
 */
export class PageStrip {
  constructor(container, { onPageClick, getEffectEntry, getDisplay, getLayout }) {
    this.container = container;
    this.onPageClick = onPageClick;
    this.getEffectEntry = getEffectEntry;
    this.getDisplay = getDisplay;
    this.getLayout = getLayout;
    this.thumbs = [];
  }

  invalidateThumbnail(pageIndex) {
    const record = typeof pageIndex === "number" ? this.thumbs[pageIndex] : null;
    if (!record) return;
    record.paintedSource = null;
    record.paintedKey = null;
  }

  invalidateAllThumbnails() {
    for (const record of this.thumbs) {
      record.paintedSource = null;
      record.paintedKey = null;
    }
  }

  scrollToStart() {
    this.container.scrollLeft = 0;
  }

  /**
   * @param {Object} book Book with a `pages` array and `spreadPageEntries(i)`.
   * @param {Object} uiState Strip state.
   * @param {number} uiState.effectiveSpread Spread to highlight and scroll to.
   * @param {number} [uiState.editingPageIdx=-1] Page drawn as active.
   * @param {Set<number>} [uiState.selectedPageIdxs] Pages drawn as selected.
   * @param {boolean} [uiState.showSelection=true] Whether to paint active/selected styling.
   * @returns {void}
   */
  update(book, uiState) {
    if (!book.pages.length) {
      this.#clear();
      this.container.style.display = "none";
      return;
    }
    this.container.style.display = "";

    while (this.thumbs.length < book.pages.length) this.#appendThumb();
    while (this.thumbs.length > book.pages.length) this.#popThumb();

    const spread = uiState.effectiveSpread;
    const entries = book.spreadPageEntries?.(spread);
    const leftIndex = entries?.left?.pageIndex ?? -1;
    const rightIndex = entries?.right?.pageIndex ?? -1;

    book.pages.forEach((page, index) => {
      const record = this.thumbs[index];
      const inSpread = index === leftIndex || index === rightIndex;
      // `showSelection` lets a host suppress the active/selected styling
      // without clearing its own selection state (margin keeps a selection in
      // both of its modes but only paints it in one). Defaults to on, so a
      // host that simply never selects anything needs no flag.
      const showSelection = uiState.showSelection !== false;
      const isActive = showSelection && index === uiState.editingPageIdx;
      const isSelected = showSelection && !!uiState.selectedPageIdxs?.has(index);
      record.thumb.classList.toggle("in-spread", inSpread);
      record.thumb.classList.toggle("active", isActive);
      record.thumb.classList.toggle("selected", isSelected);

      const labelText = String(index + 1);
      if (record.label.textContent !== labelText) record.label.textContent = labelText;

      this.#refreshThumbCanvas(record, page, index);
    });

    this.#centerOnSpread(leftIndex, rightIndex);
  }

  #centerOnSpread(leftIndex, rightIndex) {
    const leftThumb = leftIndex >= 0 ? this.thumbs[leftIndex]?.thumb : null;
    const rightThumb = rightIndex >= 0 ? this.thumbs[rightIndex]?.thumb : null;
    const anchor = leftThumb ?? rightThumb;
    if (!anchor) return;
    const spreadLeft = leftThumb ? leftThumb.offsetLeft : rightThumb.offsetLeft;
    const spreadRight = rightThumb
      ? rightThumb.offsetLeft + rightThumb.offsetWidth
      : leftThumb.offsetLeft + leftThumb.offsetWidth;
    const spreadCenter = (spreadLeft + spreadRight) / 2;
    const target = spreadCenter - this.container.clientWidth / 2;
    const maxScroll = Math.max(0, this.container.scrollWidth - this.container.clientWidth);
    const clamped = Math.max(0, Math.min(maxScroll, target));
    if (Math.abs(clamped - this.container.scrollLeft) < 0.5) return;
    // Instant scroll so the in-spread thumb stays exactly centered the
    // moment the highlight class changes — a smooth scroll lags behind and
    // the highlight appears to "run ahead" before snapping back.
    this.container.scrollLeft = clamped;
  }

  updateThumbnail(pageIndex, page) {
    const record = this.thumbs[pageIndex];
    if (!record) return;
    // Force a repaint by clearing the source marker, then refresh.
    record.paintedSource = null;
    record.paintedKey = null;
    this.#refreshThumbCanvas(record, page, pageIndex);
  }

  #clear() {
    this.container.innerHTML = "";
    this.thumbs = [];
  }

  #appendThumb() {
    const thumb = document.createElement("div");
    thumb.className = "strip-thumb";
    const canvas = document.createElement("canvas");
    const label = document.createElement("span");
    thumb.append(canvas, label);
    const record = {
      thumb,
      canvas,
      label,
      page: null,
      paintedSource: null,
      paintedKey: null,
    };
    thumb.addEventListener("click", event => {
      const index = this.thumbs.indexOf(record);
      if (index >= 0) this.onPageClick(index, event);
    });
    this.container.appendChild(thumb);
    this.thumbs.push(record);
  }

  #popThumb() {
    const record = this.thumbs.pop();
    if (record) record.thumb.remove();
  }

  #refreshThumbCanvas(record, page, pageIndex) {
    const display = this.getDisplay();
    const effectEntry = this.getEffectEntry(page);
    const layout = this.getLayout();
    const side = pageIndex % 2 === 1 ? "left" : "right";
    const layoutKey = layout
      ? `${layout.pw},${layout.ph},${layout.ratio},${layout.b},${layout.mInner},${layout.mTop},${layout.mBottom}`
      : "";
    const key = `${effectEntry.key}|${display.paperColor}|${display.contentBlendMode}|${layoutKey}|${side}`;
    // Margin-style hosts paint a placedPreviewCanvas (page with margins
    // applied). Standalone hosts (no PlacedPreviewManager) fall back to the
    // raw preview/thumbnail bitmap so the strip still shows page content.
    const source = page.placedPreviewCanvas
      ?? page.thumbnailCanvas
      ?? page.previewCanvas
      ?? null;

    const thumbHeight = SHARED_PREVIEW_SIZE;
    const thumbAspect = page.placedPreviewCanvas && layout
      ? layout.pw / layout.ph
      : page.aspectRatio || 1;
    const thumbWidth = Math.max(1, Math.round(thumbHeight * thumbAspect));
    const displayWidth = Math.max(1, Math.round(thumbWidth * (PAGE_STRIP_DISPLAY_HEIGHT / thumbHeight)));
    const sizeKey = `${thumbWidth}x${thumbHeight}`;
    const paintKey = `${key}|${sizeKey}`;

    if (record.page === page && record.paintedSource === source && record.paintedKey === paintKey) {
      return;
    }

    const canvas = record.canvas;
    if (canvas.width !== thumbWidth) canvas.width = thumbWidth;
    if (canvas.height !== thumbHeight) canvas.height = thumbHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${PAGE_STRIP_DISPLAY_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, thumbWidth, thumbHeight);
    ctx.fillStyle = display.paperColor;
    ctx.fillRect(0, 0, thumbWidth, thumbHeight);
    if (source) ctx.drawImage(source, 0, 0, thumbWidth, thumbHeight);

    record.page = page;
    record.paintedSource = source;
    record.paintedKey = paintKey;
  }
}
