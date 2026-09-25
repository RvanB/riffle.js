import test from "node:test";
import assert from "node:assert/strict";
import { enablePageSwipes } from "./pageSwipes.js";

function reader() {
    const win = new EventTarget();
    win.visualViewport = Object.assign(new EventTarget(), { scale: 1 });
    win.performance = performance;
    const viewport = Object.assign(new EventTarget(), {
        clientWidth: 390,
        ownerDocument: { defaultView: win },
        style: { setProperty(name, value) { this[name] = value; } },
    });
    const events = new Map();
    const turns = [];
    const viewer = {
        contentZoom: 1,
        pageCount: 8,
        on: (name, callback) => events.set(name, callback),
        navigateBy: (direction) => turns.push(direction),
    };
    enablePageSwipes(viewport, viewer);
    const pointer = (type, x, y, fields = {}) => {
        const event = new Event(type, { cancelable: true });
        Object.defineProperties(event, Object.fromEntries(Object.entries({
            pointerType: "touch", pointerId: 1, isPrimary: true,
            clientX: x, clientY: y, timeStamp: 100, ...fields,
        }).map(([key, value]) => [key, { value }])));
        viewport.dispatchEvent(event);
    };
    const swipe = (x1 = 300, y1 = 100, x2 = 100, y2 = 105, fields = {}) => {
        pointer("pointerdown", x1, y1, fields);
        pointer("pointermove", x2, y2, fields);
        pointer("pointerup", x2, y2, { ...fields, timeStamp: 300 });
    };
    return { viewport, win, viewer, events, turns, pointer, swipe };
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
    r.pointer("pointerdown", 300, 100);
    r.pointer("pointerup", 100, 100, { timeStamp: 1000 });
    assert.deepEqual(r.turns, []);
});

test("a vertical start cannot become a page turn", () => {
    const r = reader();
    r.pointer("pointerdown", 300, 100);
    r.pointer("pointermove", 300, 130);
    r.pointer("pointerup", 100, 130);
    assert.deepEqual(r.turns, []);
});

test("pinch and cancelled gestures do not turn pages; the next swipe works", () => {
    const r = reader();
    r.pointer("pointerdown", 300, 100);
    r.pointer("pointerdown", 200, 100, { pointerId: 2, isPrimary: false });
    r.pointer("pointerup", 200, 100, { pointerId: 2, isPrimary: false });
    r.pointer("pointerup", 100, 100);
    r.pointer("pointerdown", 300, 100);
    r.pointer("pointercancel", 100, 100);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("reader zoom and browser zoom permit panning instead of turning", () => {
    const r = reader();
    r.viewer.contentZoom = 1.25;
    r.events.get("zoomchange")();
    assert.equal(r.viewport.style["--reader-touch-action"], "auto");
    r.swipe();
    r.viewer.contentZoom = 1;
    r.win.visualViewport.scale = 2;
    r.win.visualViewport.dispatchEvent(new Event("resize"));
    r.swipe();
    assert.deepEqual(r.turns, []);
    r.win.visualViewport.scale = 1;
    r.win.visualViewport.dispatchEvent(new Event("resize"));
    assert.equal(r.viewport.style["--reader-touch-action"], "pan-y pinch-zoom");
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});

test("mouse and pen selection, and an empty reader, do not turn pages", () => {
    const r = reader();
    r.swipe(300, 100, 100, 100, { pointerType: "mouse" });
    r.swipe(300, 100, 100, 100, { pointerType: "pen" });
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
    r.pointer("pointerdown", 300, 100);
    r.events.get("sourcechange")();
    r.pointer("pointerup", 100, 100);
    r.pointer("pointerdown", 300, 100);
    r.win.dispatchEvent(new Event("blur"));
    r.pointer("pointerup", 100, 100);
    assert.deepEqual(r.turns, []);
    r.swipe();
    assert.deepEqual(r.turns, [1]);
});
