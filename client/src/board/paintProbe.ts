// client/src/board/paintProbe.ts -- REQ-0345 (board renders on demand).
//
// Per-board FRAME counter: the measurement seam for "this board paints only
// when something changed, and idles at exactly zero". PURE DATA -- no Pixi
// import -- so store/boot.ts can expose it on __backpackDebug alongside the
// other read seams (usageRibbonProbe.ts is the precedent for this shape).
//
// WHERE the count is taken is the whole point, and it is not a free choice.
// The obvious instrument -- wrap the WebGL context from the page, count draw
// calls -- was tried first (both on `WebGLRenderingContext.prototype` and on
// the live context object) and read ZERO even during a real, visible state
// change. Reported to this REQ, NOT re-reproduced here, and only half
// explained:
//   * the prototype patch cannot have worked. A board context is WebGL2
//     (GlContextSystem defaults `preferWebGLVersion: 2`, GlContextSystem.mjs
//     :268, and calls `canvas.getContext('webgl2', ...)`, :117), and in Chrome
//     WebGL2RenderingContext.prototype does NOT inherit from
//     WebGLRenderingContext.prototype -- so the patched method is never on the
//     lookup path at all.
//   * the instance patch SHOULD have been seen: GlGeometrySystem.draw() looks
//     its draw call up on `gl` on every call (GlGeometrySystem.mjs:265-272),
//     it does not hold a captured function reference. Why that read zero is
//     unexplained, and is left stated rather than guessed at.
// The transferable lesson is the one that survives either way: a zero from an
// UNVALIDATED probe is worth nothing, and looks exactly like a fixed bug. So
// the spec that consumes this counter (e2e/board-render-ondemand.spec.ts test
// 1) never asserts the zero without also making the same counter climb for a
// render that certainly happened, in the same test.
//
// The seam counted here is `renderer.render`, in app code, and both frame
// producers funnel through it:
//   * the Pixi Ticker -- TickerPlugin adds Application.render at
//     UPDATE_PRIORITY.LOW (TickerPlugin.mjs:28), and Application.render() is
//     literally `this.renderer.render({ container: this.stage })`
//     (Application.mjs:83), which resolves `this.renderer` at CALL time; and
//   * BoardRenderer.paintNow() -- the on-demand path.
// BoardRenderer.mount() wraps that one method on the renderer INSTANCE right
// after app.init(), so the counter sees every frame either path submits --
// including a frame from a ticker somebody re-enables by accident, which is
// exactly the regression this REQ must stay able to detect.
const counts = new Map<string, number>();

/** Called by BoardRenderer's renderer.render wrapper, keyed by boardIdKey
 * (`'canvas'` | `'inv:<page>'`). */
export function countPaint(boardKey: string): void {
  counts.set(boardKey, (counts.get(boardKey) ?? 0) + 1);
}

/** Frames this board has submitted since its Application was created. */
export function paintCount(boardKey: string): number {
  return counts.get(boardKey) ?? 0;
}

/** Every board's count, for a single round-trip read from e2e. */
export function paintCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of counts) out[k] = v;
  return out;
}
