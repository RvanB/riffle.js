// Demo-only touch navigation. Keep the library's mouse/pen text selection,
// while allowing native scrolling and pinch zoom on touchscreens.
export function enablePageSwipes(viewport, viewer) {
    const win = viewport.ownerDocument.defaultView;
    const touches = new Set();
    let swipe = null;
    let suppressClickUntil = 0;
    const atFit = () => viewer.contentZoom <= 1.001
        && (win.visualViewport?.scale ?? 1) <= 1.001;
    const syncTouchAction = () => {
        swipe = null;
        viewport.style.setProperty("--reader-touch-action", atFit() ? "pan-y pinch-zoom" : "auto");
    };
    viewer.on("zoomchange", syncTouchAction);
    viewer.on("sourcechange", syncTouchAction);
    win.visualViewport?.addEventListener("resize", syncTouchAction);
    syncTouchAction();

    viewport.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") return;
        // The PDF overlay otherwise starts its custom text-selection drag.
        // Stopping propagation leaves native pan/pinch and link taps intact.
        event.stopPropagation();
        suppressClickUntil = 0;
        touches.add(event.pointerId);
        swipe = touches.size === 1 && event.isPrimary && atFit() && viewer.pageCount > 0
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
            : null;
    }, { capture: true });

    viewport.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "touch") return;
        event.stopPropagation();
        if (!swipe || event.pointerId !== swipe.id) return;
        const dx = Math.abs(event.clientX - swipe.x);
        const dy = Math.abs(event.clientY - swipe.y);
        // Once a drag is vertical, it cannot become a page turn later.
        if (dy > 12 && dy > dx) swipe = null;
    }, { capture: true });

    const endTouch = (event) => {
        if (event.pointerType !== "touch") return;
        event.stopPropagation();
        touches.delete(event.pointerId);
        const start = swipe;
        swipe = null;
        if (!start || start.id !== event.pointerId || event.type === "pointercancel" || !atFit()) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const threshold = Math.max(40, Math.min(80, viewport.clientWidth * 0.12));
        if (event.timeStamp - start.time > 700 || Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // A swipe beginning on a PDF link must not also activate the link.
        suppressClickUntil = win.performance.now() + 600;
        viewer.navigateBy(dx < 0 ? 1 : -1);
    };
    viewport.addEventListener("pointerup", endTouch, { capture: true });
    viewport.addEventListener("pointercancel", endTouch, { capture: true });
    viewport.addEventListener("click", (event) => {
        if (win.performance.now() >= suppressClickUntil) return;
        event.preventDefault();
        event.stopPropagation();
    }, { capture: true });
    win.addEventListener("blur", () => {
        touches.clear();
        swipe = null;
    });
}
