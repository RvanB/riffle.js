import { createViewer, createPageStrip } from "../src/index.js";
import { isImageFile } from "../src/sources/imageFilesSource.js";
import { enablePageSwipes } from "./pageSwipes.js";

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const stage = $("stage");
const stripContainer = $("strip-container");
const viewer = createViewer({ viewport, paperPreset: "bright-white", renderScale: 1.5, paperThickness: 0, showThrough: 0.35 });
stage.appendChild(viewer);
stripContainer.appendChild(createPageStrip(viewer));
enablePageSwipes(viewport, viewer);
let loading = false;
let focused = false;

const syncZoom = () => {
    const zoom = viewer.contentZoom;
    $("zoom-reset").disabled = !viewer.pageCount;
    $("zoom-reset").textContent = Math.abs(zoom - 1) < .001 ? "Fit" : `${Math.round(zoom * 100)}%`;
    $("zoom-out").disabled = !viewer.pageCount || zoom <= .501;
    $("zoom-in").disabled = !viewer.pageCount || zoom >= 5.999;
    $("gesture-hint").textContent = zoom > 1.001
        ? "Drag to pan · Swipe at an edge to turn pages"
        : matchMedia("(pointer: coarse)").matches ? "Swipe to turn pages · Pinch to zoom" : "Arrow keys to turn pages · Pinch to zoom";
};
viewer.on("zoomchange", syncZoom);
syncZoom();

const setFocused = (value) => {
    focused = value;
    $("paper-settings").hidePopover();
    $("toolbar").hidden = value;
    $("reader-footer").hidden = value;
    $("show-toolbar").hidden = !value;
    (value ? $("show-toolbar") : $("hide-toolbar")).focus({ preventScroll: true });
};
$("hide-toolbar").addEventListener("click", () => setFocused(true));
$("show-toolbar").addEventListener("click", () => setFocused(false));
$("toggle-strip").addEventListener("click", () => {
    stripContainer.hidden = !stripContainer.hidden;
    $("toggle-strip").setAttribute("aria-expanded", String(!stripContainer.hidden));
});

const paperPreset = $("paper-preset");
for (const { id, label } of viewer.paperPresets) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    paperPreset.appendChild(option);
}
paperPreset.value = viewer.display.paperPreset;
paperPreset.addEventListener("change", () => viewer.setPaperPreset(paperPreset.value));
$("show-through").addEventListener("input", () => {
    const value = Number($("show-through").value);
    viewer.setDisplay({ showThrough: value });
    $("show-through-value").textContent = `${Math.round(value * 100)}%`;
});

const pageInput = $("page-input");
const refreshPageReadout = () => {
    const total = viewer.pageCount;
    const pages = viewer.pagesInSpread(viewer.effectiveSpread);
    $("spread-readout").textContent = total ? `of ${total}` : "of —";
    $("spread-readout").setAttribute("aria-label", `Page${pages.length > 1 ? "s" : ""} ${pages.join(" and ")} of ${total}`);
    pageInput.disabled = !total;
    $("previous-page").disabled = !total || viewer.effectiveSpread <= 0;
    $("next-page").disabled = !total || viewer.effectiveSpread >= viewer.numSpreads - 1;
    $("empty-state").hidden = total > 0;
    stage.hidden = !total;
    $("reader-footer").hidden = focused;
    $("toggle-strip").disabled = !total;
    $("hide-toolbar").disabled = !total;
    syncZoom();
    pageInput.max = String(Math.max(1, total));
    if (document.activeElement !== pageInput) pageInput.value = total && pages[0] ? String(pages[0]) : "";
    // Make the library's thumbnail divs usable with a keyboard in this demo.
    stripContainer.querySelectorAll(".strip-thumb").forEach((thumb, index) => {
        thumb.tabIndex = 0;
        thumb.setAttribute("role", "button");
        thumb.setAttribute("aria-label", `Go to page ${index + 1}`);
        thumb.setAttribute("aria-current", thumb.classList.contains("in-spread") ? "page" : "false");
    });
};
for (const event of ["sourcechange", "spreadchange", "effectivespreadchange"]) viewer.on(event, refreshPageReadout);
refreshPageReadout();
$("previous-page").addEventListener("click", () => viewer.navigateBy(-1));
$("next-page").addEventListener("click", () => viewer.navigateBy(1));
pageInput.addEventListener("change", () => {
    const value = Number(pageInput.value);
    const page = Math.min(viewer.pageCount, Math.max(1, Number.isFinite(value) ? Math.round(value) : 1));
    pageInput.value = String(page);
    viewer.goToPage(page);
});
pageInput.addEventListener("keydown", (event) => { if (event.key === "Enter") pageInput.blur(); });
pageInput.addEventListener("blur", refreshPageReadout);
stripContainer.addEventListener("keydown", (event) => {
    const thumb = event.target.closest(".strip-thumb");
    if (thumb && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); thumb.click(); }
});

const status = (message, error = false) => {
    $("loading-status").hidden = false;
    $("loading-status").dataset.error = String(error);
    $("status-message").textContent = message;
    $("dismiss-status").hidden = !error;
};
$("dismiss-status").addEventListener("click", () => { $("loading-status").hidden = true; });
const loadDocument = async (load, name, kind) => {
    if (loading) return;
    loading = true;
    viewport.setAttribute("aria-busy", "true");
    document.querySelectorAll("[data-open-file]").forEach(button => { button.disabled = true; });
    status(`Opening ${name}…`);
    try {
        await load();
        viewer.resetZoom();
        $("document-name").textContent = name;
        $("document-name").title = name;
        $("document-meta").textContent = `${viewer.pageCount} ${viewer.pageCount === 1 ? "page" : "pages"} · ${kind}`;
        $("document-info").hidden = false;
        document.title = `${name} — Riffle`;
        refreshPageReadout();
        $("loading-status").hidden = true;
        viewport.focus({ preventScroll: true });
    } catch (error) {
        console.error(error);
        refreshPageReadout();
        status("This file couldn’t be opened. Try another PDF or image.", true);
    } finally {
        loading = false;
        viewport.removeAttribute("aria-busy");
        document.querySelectorAll("[data-open-file]").forEach(button => { button.disabled = false; });
    }
};
const openFiles = async (files) => {
    if (loading) return;
    const list = [...files];
    if (!list.length) return;
    const pdfs = list.filter(file => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    if (pdfs.length === 1 && list.length === 1) {
        await loadDocument(() => viewer.openPdf(pdfs[0]), pdfs[0].name, "PDF");
    } else if (!pdfs.length && list.every(isImageFile)) {
        await loadDocument(() => viewer.openImages(list), list.length === 1 ? list[0].name : `${list[0].name} + ${list.length - 1} more`, "Images");
    } else {
        status("Choose one PDF or a collection of images together.", true);
    }
};
document.querySelectorAll("[data-open-file]").forEach(button => button.addEventListener("click", () => $("file-input").click()));
$("file-input").addEventListener("change", (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    openFiles(files);
});
let dragDepth = 0;
const clearDrag = () => { dragDepth = 0; $("drop-overlay").hidden = true; };
window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    $("drop-overlay").hidden = false;
});
window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = loading ? "none" : "copy";
});
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) clearDrag(); });
window.addEventListener("drop", (event) => {
    event.preventDefault();
    clearDrag();
    if (event.dataTransfer?.files.length) openFiles(event.dataTransfer.files);
});
window.addEventListener("blur", clearDrag);
window.addEventListener("dragend", clearDrag);
$("zoom-in").addEventListener("click", () => viewer.adjustZoom(1));
$("zoom-out").addEventListener("click", () => viewer.adjustZoom(-1));
$("zoom-reset").addEventListener("click", () => viewer.resetZoom());
window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && focused) { setFocused(false); return; }
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest("input, select, textarea, a, [contenteditable], [popover]")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); viewer.navigateBy(1); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); viewer.navigateBy(-1); }
});
