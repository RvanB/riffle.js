import test from "node:test";
import assert from "node:assert/strict";
import { ZoomController } from "../src/controllers/ZoomController.js";

function book() {
    let left = 0;
    let top = 0;
    const canvas = { style: {} };
    const width = () => parseFloat(canvas.style.width) || 326;
    const height = () => parseFloat(canvas.style.height) || 163;
    const viewport = {
        clientWidth: 390, clientHeight: 600,
        getBoundingClientRect: () => ({ left: 10, top: 100, width: 390, height: 600 }),
        get scrollLeft() { return left; },
        set scrollLeft(value) { left = Math.max(0, Math.min(value, Math.max(0, width() + 64 - 390))); },
        get scrollTop() { return top; },
        set scrollTop(value) { top = Math.max(0, Math.min(value, Math.max(0, height() + 64 - 600))); },
    };
    canvas.getBoundingClientRect = () => ({
        left: 10 + Math.max(32, (390 - width()) / 2) - left,
        top: 100 + Math.max(32, (600 - height()) / 2) - top,
        width: width(), height: height(),
    });
    const changes = [];
    const viewer = {
        viewport, spreadCanvas: canvas, layout: { pw: 100, ph: 100 },
        navigationController: { getEffectiveSpread: () => 0 },
        book: { numSpreads: () => 0 },
        emit: (name, detail) => changes.push({ name, detail }),
    };
    const zoom = new ZoomController(viewer);
    zoom.syncCanvasStage();
    return { zoom, canvas, viewport, changes };
}

test("continuous zoom preserves the point on a centered book beneath the fingers", () => {
    const { zoom, canvas, viewport, changes } = book();
    const anchor = { clientX: 160, clientY: 400 };
    const point = () => {
        const r = canvas.getBoundingClientRect();
        return [(anchor.clientX - r.left) / r.width, (anchor.clientY - r.top) / r.height];
    };
    const before = point();
    zoom.setContentZoom(2.5, anchor);
    const after = point();
    assert.ok(Math.abs(before[0] - after[0]) < 1e-8);
    assert.ok(Math.abs(before[1] - after[1]) < 1e-8);
    assert.equal(zoom.contentZoom, 2.5);
    assert.equal(changes.at(-1).detail.contentZoom, 2.5);
    zoom.resetContentZoom();
    assert.equal(zoom.contentZoom, 1);
    assert.equal(viewport.scrollLeft, 0);
});

test("absolute zoom clamps limits, rejects invalid input, and preserves step controls", () => {
    const { zoom, changes } = book();
    zoom.setContentZoom(100);
    assert.equal(zoom.contentZoom, 6);
    zoom.setContentZoom(0.01);
    assert.equal(zoom.contentZoom, 0.5);
    const count = changes.length;
    zoom.setContentZoom(NaN);
    zoom.setContentZoom(Infinity);
    assert.equal(changes.length, count);
    zoom.resetContentZoom();
    zoom.adjustContentZoom(1);
    assert.equal(zoom.contentZoom, 1.25);
    zoom.adjustContentZoom(-1);
    assert.equal(zoom.contentZoom, 1);
});
