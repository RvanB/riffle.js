// Demo-only touch navigation and book pinch zoom. Zoomed pages can be panned
// until their horizontal edges; mouse/pen text selection remains available.
export function enablePageSwipes(viewport, viewer) {
    const win = viewport.ownerDocument.defaultView;
    let swipe = null;
    let pinch = null;
    let pinching = false;
    let suppressClickUntil = 0;
    const browserAtFit = () => (win.visualViewport?.scale ?? 1) <= 1.001;
    const syncTouchAction = () => {
        swipe = null;
        viewport.style.setProperty("--reader-touch-action",
            viewer.contentZoom <= 1.001 && browserAtFit() ? "pan-y" : "pan-x pan-y");
    };
    const resetGesture = () => {
        swipe = null;
        pinch = null;
        pinching = false;
    };
    viewer.on("zoomchange", syncTouchAction);
    viewer.on("sourcechange", () => { resetGesture(); syncTouchAction(); });
    win.visualViewport?.addEventListener("resize", () => { resetGesture(); syncTouchAction(); });
    syncTouchAction();

    // Keep the PDF overlay from starting its custom pointer selection. This
    // does not prevent native scrolling or the click from a tap.
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        viewport.addEventListener(type, (event) => {
            if (event.pointerType === "touch") event.stopPropagation();
        }, { capture: true });
    }

    const startPinch = (touches) => {
        pinching = true;
        swipe = null;
        pinch = null;
        if (touches.length !== 2 || viewer.pageCount <= 0) return;
        const [a, b] = touches;
        const rect = viewer.getBoundingClientRect();
        pinch = {
            ids: [a.identifier, b.identifier],
            distance: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)),
            zoom: viewer.contentZoom,
            bookX: ((a.clientX + b.clientX) / 2 - rect.left) / Math.max(1, rect.width),
            bookY: ((a.clientY + b.clientY) / 2 - rect.top) / Math.max(1, rect.height),
        };
    };
    viewport.addEventListener("touchstart", (event) => {
        suppressClickUntil = 0;
        swipe = null;
        if (event.touches.length >= 2) {
            if (event.cancelable) event.preventDefault();
            startPinch(Array.from(event.touches));
            return;
        }
        if (pinching) return;
        if (event.touches.length !== 1 || !browserAtFit() || viewer.pageCount <= 0) return;
        const touch = event.touches[0];
        const fitted = viewer.contentZoom <= 1.001;
        const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        swipe = {
            id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp,
            // Decide from the starting position: panning TO an edge must not
            // also turn a page during the same gesture. Allow rounding errors.
            previous: fitted || viewport.scrollLeft <= 2,
            next: fitted || viewport.scrollLeft >= maxScroll - 2,
        };
    }, { capture: true, passive: false });

    const directionFor = (touch) => {
        if (!swipe) return 0;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
        if (dx < 0 && swipe.next) return 1;
        if (dx > 0 && swipe.previous) return -1;
        return 0;
    };
    viewport.addEventListener("touchmove", (event) => {
        if (pinching || event.touches.length >= 2) {
            if (event.cancelable) event.preventDefault();
            if (!pinching) startPinch(Array.from(event.touches));
            if (event.touches.length !== 2) { pinch = null; return; }
            if (!pinch) startPinch(Array.from(event.touches));
            if (!pinch) return;
            const [a, b] = pinch.ids.map(id => Array.from(event.touches).find(t => t.identifier === id));
            if (!a || !b) { startPinch(Array.from(event.touches)); return; }
            const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
            const anchor = {
                clientX: (a.clientX + b.clientX) / 2,
                clientY: (a.clientY + b.clientY) / 2,
            };
            viewer.setZoom(pinch.zoom * distance / pinch.distance, anchor);
            // Preserve the original book point across the whole pinch. While
            // the book still fits, scrolling is clamped; once it overflows,
            // restore that point instead of accumulating centering drift.
            const rect = viewer.getBoundingClientRect();
            viewport.scrollLeft += rect.left + pinch.bookX * rect.width - anchor.clientX;
            viewport.scrollTop += rect.top + pinch.bookY * rect.height - anchor.clientY;
            return;
        }
        if (!swipe) return;
        if (event.touches.length !== 1 || !browserAtFit()) {
            swipe = null;
            return;
        }
        const touch = event.touches[0];
        if (touch.identifier !== swipe.id) return;
        const dx = Math.abs(touch.clientX - swipe.x);
        const dy = Math.abs(touch.clientY - swipe.y);
        if (dy > 12 && dy > dx) {
            swipe = null;
            return;
        }
        if (directionFor(touch)) {
            // An explicit non-passive TouchEvent handler is needed here:
            // relying on touch-action + pointerup alone lets some mobile
            // browsers take over the gesture as a canvas scroll.
            if (event.cancelable) event.preventDefault();
            else swipe = null;
        } else if (dx > 12 && dx > dy) {
            swipe = null;
        }
    }, { capture: true, passive: false });

    viewport.addEventListener("touchend", (event) => {
        if (pinching) {
            if (event.cancelable) event.preventDefault();
            suppressClickUntil = win.performance.now() + 600;
            if (event.touches.length >= 2) startPinch(Array.from(event.touches));
            else pinch = null;
            // Do not interpret the remaining finger as a page swipe.
            if (!event.touches.length) resetGesture();
            return;
        }
        const start = swipe;
        const touch = Array.from(event.changedTouches).find(t => t.identifier === start?.id);
        const direction = touch ? directionFor(touch) : 0;
        swipe = null;
        if (!start || !touch || event.touches.length || !browserAtFit() || !direction) return;
        const threshold = Math.max(40, Math.min(80, viewport.clientWidth * 0.12));
        if (event.timeStamp - start.time > 700 || Math.abs(touch.clientX - start.x) < threshold) return;
        // A swipe beginning on a PDF link must not also activate the link.
        if (event.cancelable) event.preventDefault();
        suppressClickUntil = win.performance.now() + 600;
        viewer.navigateBy(direction);
    }, { capture: true, passive: false });
    viewport.addEventListener("touchcancel", resetGesture, { capture: true, passive: true });
    viewport.addEventListener("click", (event) => {
        if (win.performance.now() >= suppressClickUntil) return;
        event.preventDefault();
        event.stopPropagation();
    }, { capture: true });
    win.addEventListener("blur", resetGesture);
}
