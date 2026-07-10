const BASE_TURN_DURATION_MS = 750;
const BASE_MULTI_SPREAD_TURN_INTERVAL_MS = 40;
const MAX_QUEUE_DURATION_MS = 2000;

// Drives spread-to-spread navigation including the page-turn animation and
// queued multi-spread jumps. Reads viewer.currentSpread / effectiveSpread,
// writes to them, and emits animation lifecycle events for hosts (overlays,
// editing UI, etc.) to react to.
export class NavigationController {
  constructor(viewer) {
    this.viewer = viewer;
    this.queuedSpreadTurnTimer = 0;
    this.queuedSpreadTurnToken = 0;
    this.pendingTurnStartToken = 0;
    this.animationDirection = 0;
    this.animationCompletionScheduled = false;
  }

  getEffectiveSpread() {
    const v = this.viewer;
    return v.spreadRenderer.isAnimating ? v.effectiveSpread : v.currentSpread;
  }

  resetAnimationState() {
    this.animationCompletionScheduled = false;
    this.animationDirection = 0;
  }

  #kickoffHighResForSpread(spreadIndex) {
    const v = this.viewer;
    if (spreadIndex < 0 || spreadIndex >= v.book.numSpreads()) return;
    const targetPagePixels = v.getHighResTargetPagePixels?.() ?? null;
    const { left, right } = v.book.spreadPageEntries(spreadIndex);
    for (const pageIndex of [left.pageIndex, right.pageIndex]) {
      if (pageIndex < 0) continue;
      if (v.lazyPageLoader.isPageHighResReady(pageIndex, v.contentZoom, { targetPagePixels })) continue;
      v.lazyPageLoader.ensurePageHighRes(pageIndex, v.contentZoom, { targetPagePixels });
    }
  }

  cancelQueuedSpreadTurns() {
    this.queuedSpreadTurnToken += 1;
    if (this.queuedSpreadTurnTimer) {
      clearTimeout(this.queuedSpreadTurnTimer);
      this.queuedSpreadTurnTimer = 0;
    }
  }

  queueSpreadTurnsTo(targetSpread, preferredPageIndex = null) {
    const v = this.viewer;
    const clampedTarget = Math.max(0, Math.min(targetSpread, v.book.numSpreads() - 1));
    const fromSpread = this.getEffectiveSpread();
    const distance = Math.abs(clampedTarget - fromSpread);
    if (distance <= 1 || !v.lastMargins || !v.book.pages.length) {
      this.navigateTo(clampedTarget, preferredPageIndex);
      return;
    }

    const direction = clampedTarget > fromSpread ? 1 : -1;
    if (v.spreadRenderer.isAnimating && this.animationDirection && direction !== this.animationDirection) return;

    this.cancelQueuedSpreadTurns();
    const token = this.queuedSpreadTurnToken;
    this.#kickoffHighResForSpread(clampedTarget);

    const nominalTotal = BASE_TURN_DURATION_MS + (distance - 1) * BASE_MULTI_SPREAD_TURN_INTERVAL_MS;
    const scale = Math.min(1, MAX_QUEUE_DURATION_MS / nominalTotal);
    const stepDurationMs = BASE_TURN_DURATION_MS * scale;
    const stepIntervalMs = BASE_MULTI_SPREAD_TURN_INTERVAL_MS * scale;

    const advance = () => {
      if (token !== this.queuedSpreadTurnToken) return;
      const currentSpread = this.getEffectiveSpread();
      if (currentSpread === clampedTarget) {
        this.queuedSpreadTurnTimer = 0;
        return;
      }
      const nextSpread = currentSpread + direction;
      const isFinalStep = nextSpread === clampedTarget;
      this.navigateTo(nextSpread, isFinalStep ? preferredPageIndex : null, {
        fromQueuedJump: true,
        isFinalQueuedStep: isFinalStep,
        durationMs: stepDurationMs,
      });
      if (!isFinalStep) {
        this.queuedSpreadTurnTimer = setTimeout(advance, stepIntervalMs);
      } else {
        this.queuedSpreadTurnTimer = 0;
      }
    };

    advance();
  }

  navigateTo(targetSpread, preferredPageIndex = null, options = {}) {
    const v = this.viewer;
    const clampedTarget = Math.max(0, Math.min(targetSpread, v.book.numSpreads() - 1));
    if (clampedTarget === this.getEffectiveSpread()) return;
    if (!options.fromQueuedJump) this.cancelQueuedSpreadTurns();
    const fromSpread = this.getEffectiveSpread();
    const direction = clampedTarget > fromSpread ? 1 : -1;

    v.emit("beforenavigate", { fromSpread, toSpread: clampedTarget, preferredPageIndex });
    v.lazyPageLoader.ensureSpreadLoaded(clampedTarget, 1, { allowHighRes: false });

    if (!v.lastMargins || !v.book.pages.length) {
      v.currentSpread = clampedTarget;
      v.effectiveSpread = clampedTarget;
      this.animationDirection = 0;
      v.spreadRenderer.stopAnimation();
      this.animationCompletionScheduled = false;
      v.emit("effectivespreadchange", { spreadIndex: clampedTarget });
      v.emit("animationend", {});
      v.emit("spreadchange", { spreadIndex: clampedTarget });
      v.redraw();
      return;
    }

    if (v.spreadRenderer.isAnimating && this.animationDirection && direction !== this.animationDirection) return;
    const turnStartToken = ++this.pendingTurnStartToken;
    const startTurn = () => {
      if (this.pendingTurnStartToken !== turnStartToken) return;

      v.effectiveSpread = clampedTarget;
      this.animationDirection = direction;
      const fromCanvas = v.createSpreadSnapshot(fromSpread);
      const toCanvas = v.createSpreadSnapshot(clampedTarget);
      v.lazyPageLoader.setEvictionsDeferred(true);

      const onDone = this.animationCompletionScheduled
        ? null
        : () => {
            this.animationCompletionScheduled = false;
            this.animationDirection = 0;
            v.currentSpread = v.effectiveSpread;
            v.emit("animationend", {});
            v.emit("spreadchange", { spreadIndex: v.currentSpread });
            v.redraw();
            v.lazyPageLoader.flushEvictions();
            v.schedulePreviewRedraw();
          };

      this.animationCompletionScheduled = true;
      v.spreadRenderer.animateTo(fromCanvas, toCanvas, direction, onDone, {
        durationMs: options.durationMs,
      });
      // Emit AFTER animateTo so spreadRenderer.isAnimating is true; this is
      // the moment `getEffectiveSpread()` will return the new target.
      // Fired at the start of every navigation (including each step of a
      // queued multi-spread turn) so consumers like the page strip can
      // scroll-track the in-flight target rather than waiting for the
      // animation to settle.
      v.emit("effectivespreadchange", { spreadIndex: clampedTarget });
      v.emit("animationstart", { fromSpread, toSpread: clampedTarget, direction });
      v.schedulePreviewRedraw();
    };

    if (!options.fromQueuedJump) this.#kickoffHighResForSpread(clampedTarget);
    startTurn();
  }
}
