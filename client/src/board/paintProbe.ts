// client/src/board/paintProbe.ts -- REQ-0345 (board renders on demand).
//
// Per-board FRAME counter: the measurement seam for "this board paints only
// when something changed, and idles at exactly zero". PURE DATA -- no Pixi
// import -- so store/boot.ts can expose it on __backpackDebug alongside the
// other read seams (usageRibbonProbe.ts is the precedent for this shape).
//
// WHERE the count is taken is the whole point. Patching
// `WebGLRenderingContext.prototype` (or the live context object) from the page
// reads ZERO even during a real, visible state change: PixiJS v8 resolves and
// caches its GL entry points when the context is created (GlRenderTargetSystem
// / GlBufferSystem / GlGeometrySystem all capture `this.gl` and its methods at
// contextChange time), so a patch applied afterwards is never called. A zero
// read that way means "the probe is broken", not "nothing rendered".
//
// The seam that DOES respond is `renderer.render`. Both frame producers funnel
// through it:
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
