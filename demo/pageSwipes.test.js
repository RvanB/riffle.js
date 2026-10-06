import test from "node:test";
import assert from "node:assert/strict";
import { enablePageSwipes } from "./pageSwipes.js";

function reader() {
    const win = new EventTarget();
    win.visualViewport = Object.assign(new EventTarget(), { scale: 1 });
    win.performance = performance;
    const viewport = Object.assign(new EventTarget(), {
        clientWidth: 390, scrollWidth: 390, scrollLeft: 0, scrollTop: 0,
        ownerDocument: { defaultView: win },
        style: { setProperty(name, value) { this[name] = value; } },
    });
    const events = new Map();
    const turns = [];
    const zooms = [];
    const viewer = {
        contentZoom: 1,
        pageCount: 8,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 600 }),
        on: (name, callback) => events.set(name, callback),
        navigateBy: (direction) => turns.push(direction),
        setZoom: (zoom, anchor) => {
            viewer.contentZoom = Math.max(0.5, Math.min(6, zoom));
            zooms.push({ zoom: viewer.contentZoom, anchor });
            events.get("zoomchange")();
        },
    };
    enablePageSwipes(viewport, viewer);
    const activeTouches = new Map();
    const touch = (type, x, y, fields = {}) => {
        const id = fields.identifier ?? 1;
        const point = { identifier: id, clientX: x, clientY: y };
        if (type === "touchstart" || type === "touchmove") activeTouches.set(id, point);
        else activeTouches.delete(id);
        const event = new Event(type, { cancelable: true });
        Object.defineProperties(event, Object.fromEntries(Object.entries({
            touches: [...activeTouches.values()], changedTouches: [point],
            timeStamp: 100, ...fields,
        }).map(([key, value]) => [key, { value }])));
        viewport.dispatchEvent(event);
        return event;
    };
    const swipe = (x1 = 300, y1 = 100, x2 = 100, y2 = 105, fields = {}) => {
        touch("touchstart", x1, y1, fields);
        touch("touchmove", x2, y2, fields);
        touch("touchend", x2, y2, { ...fields, timeStamp: 300 });
    };
    return { viewport, win, viewer, events, turns, zooms, touch, swipe };
}

test("left/right swipes turn exactly one spread", () => {
    const r = reader();
    r.swipe();
    r.swipe(100, 100, 300, 105);
    assert.deepEqual(r.turns, [1, -1]);
});

test("short, diagonal, vertical, and long-press drags do not turn pages", () => {
    const r = reader();
    r.swipe(100, 100, 125, 100);
    r.swipe(100, 100, 180, 170);
    r.swipe(100, 100, 105, 250);
    r.touch("touchstart", 300, 100);
    r.touch("touchend", 100, 100, { timeStamp: 1000 });
    assert.deepEqual(r.turns, []);
});

test("a vertical start cannot become a page turn", () => {
    const r = reader();
    r.touch("touchstart", 300, 100);
    r.touch("touchmove", 300, 130);
    r.touch("touchend", 100, 130);
    assert.deepEqual(r.turns, []);
});

test("pinch and cancelled gestures do not turn pages; the next swipe works", () => {
    const r = reader();
    r.touch("touchstart", 300, 100);
    r.touch("touchstart", 200, 100, { identifier: 2 });
    r.touch("touchend", 200, 100, { identifier: 2 });
    r.touch("touchend", 100, 100);
    r.touch("touchstart", 300, 100);
    r.touch("touchcancel", 100, 100);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("reader zoom and browser zoom permit panning instead of turning", () => {
    const r = reader();
    r.viewer.contentZoom = 2;
    r.viewport.scrollWidth = 780;
    r.viewport.scrollLeft = 150;
    r.events.get("zoomchange")();
    assert.equal(r.viewport.style["--reader-touch-action"], "pan-x pan-y");
    r.swipe();
    r.viewer.contentZoom = 1;
    r.win.visualViewport.scale = 2;
    r.win.visualViewport.dispatchEvent(new Event("resize"));
    r.swipe();
    assert.deepEqual(r.turns, []);
    r.win.visualViewport.scale = 1;
    r.win.visualViewport.dispatchEvent(new Event("resize"));
    assert.equal(r.viewport.style["--reader-touch-action"], "pan-y");
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("mouse and pen selection, and an empty reader, do not turn pages", () => {
    const r = reader();
    for (const pointerType of ["mouse", "pen"]) {
        for (const type of ["pointerdown", "pointermove", "pointerup"]) {
            r.viewport.dispatchEvent(Object.assign(new Event(type), { pointerType }));
        }
    }
    r.viewer.pageCount = 0;
    r.swipe();
    assert.deepEqual(r.turns, []);
});

test("swipes suppress link activation, but a subsequent tap still works", () => {
    const r = reader();
    r.swipe();
    const swipeClick = new Event("click", { cancelable: true });
    r.viewport.dispatchEvent(swipeClick);
    assert.equal(swipeClick.defaultPrevented, true);
    r.swipe(100, 100, 100, 100);
    const tapClick = new Event("click", { cancelable: true });
    r.viewport.dispatchEvent(tapClick);
    assert.equal(tapClick.defaultPrevented, false);
});

test("source changes and blur cancel an in-progress gesture", () => {
    const r = reader();
    r.touch("touchstart", 300, 100);
    r.events.get("sourcechange")();
    r.touch("touchend", 100, 100);
    r.touch("touchstart", 300, 100);
    r.win.dispatchEvent(new Event("blur"));
    r.touch("touchend", 100, 100);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("horizontal touchmove prevents native canvas scrolling; vertical motion does not", () => {
    const r = reader();
    r.touch("touchstart", 300, 100);
    const horizontal = r.touch("touchmove", 290, 100);
    assert.equal(horizontal.defaultPrevented, true);
    r.touch("touchend", 100, 100);
    assert.deepEqual(r.turns, [1]);
    r.touch("touchstart", 100, 100);
    const vertical = r.touch("touchmove", 100, 130);
    assert.equal(vertical.defaultPrevented, false);
});

test("zoomed swipes turn outward from each edge but pan inward", () => {
    const r = reader();
    r.viewer.contentZoom = 2;
    r.viewport.scrollWidth = 780;
    r.viewport.scrollLeft = 390;
    r.swipe();
    r.viewport.scrollLeft = 0;
    r.swipe(100, 100, 300, 100);
    assert.deepEqual(r.turns, [1, -1]);
    r.touch("touchstart", 300, 100);
    const inward = r.touch("touchmove", 100, 100);
    assert.equal(inward.defaultPrevented, false);
    r.touch("touchend", 100, 100);
    assert.deepEqual(r.turns, [1, -1]);
});

test("panning to an edge does not turn pages in the same gesture", () => {
    const r = reader();
    r.viewer.contentZoom = 2;
    r.viewport.scrollWidth = 780;
    r.viewport.scrollLeft = 150;
    r.touch("touchstart", 300, 100);
    r.touch("touchmove", 200, 100);
    r.viewport.scrollLeft = 390;
    r.touch("touchend", 100, 100);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("pinching changes book zoom continuously and blocks webpage scaling", () => {
    const r = reader();
    r.touch("touchstart", 100, 200);
    const start = r.touch("touchstart", 200, 200, { identifier: 2 });
    assert.equal(start.defaultPrevented, true);
    const move = r.touch("touchmove", 250, 200, { identifier: 2 });
    assert.equal(move.defaultPrevented, true);
    assert.equal(r.viewer.contentZoom, 1.5);
    assert.deepEqual(r.zooms[0].anchor, { clientX: 175, clientY: 200 });
    r.touch("touchmove", 150, 200, { identifier: 2 });
    assert.equal(r.viewer.contentZoom, 0.5);
    r.touch("touchend", 150, 200, { identifier: 2 });
    r.touch("touchmove", 300, 200);
    r.touch("touchend", 300, 200);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("cancelled pinches and replaced fingers start a fresh zoom baseline", () => {
    const r = reader();
    r.touch("touchstart", 100, 200);
    r.touch("touchstart", 200, 200, { identifier: 2 });
    r.touch("touchmove", 250, 200, { identifier: 2 });
    r.touch("touchend", 250, 200, { identifier: 2 });
    r.touch("touchstart", 200, 200, { identifier: 3 });
    r.touch("touchmove", 300, 200, { identifier: 3 });
    assert.equal(r.viewer.contentZoom, 3);
    r.touch("touchcancel", 300, 200, { identifier: 3 });
    r.touch("touchend", 100, 200);
    assert.deepEqual(r.turns, []);
});
