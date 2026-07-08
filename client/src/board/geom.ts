// client/src/board/geom.ts -- REQ-0047 (f2-3): board geometry + shared render constants (cell math, screen mapping, socket positions, arrowheads).
// Moved MECHANICALLY from BoardRenderer.ts (this. -> self. receiver).
import { Graphics, Sprite } from 'pixi.js';
import type { Assembly, Cell, GameState, IconAlign, Socket } from '../engine/engine.d.ts';
import { fitBoxInBounds } from '../render/itemCard';
import type { BoardRenderer } from './BoardRenderer';

export const SOCK_GLYPH: Record<string, string> = { gem: '◆', edge: '▷', coat: '●', bond: '▬' };
// Nearest-socket search radius in board-canvas pixels — CELL is 80 in both
// the mock and this renderer, so the mock's absolute-pixel threshold (26px)
// ports directly with no rescaling.
export const SOCKET_SEARCH_RADIUS = 26;
// Plain-click vs drag threshold, pixels — same as the mock's
// `Math.hypot(dx,dy) < 5`.
export const DRAG_ARM_THRESHOLD = 5;
// Double-click detection window, ms — Pixi's federated events do not expose
// a native multi-click/dblclick concept the way DOM elements do, so this is
// tracked manually: a second pointerdown on the SAME uid within this window
// (with the first pointerdown never having armed a drag) is treated as a
// double-click-rotate, mirroring the mock's native SVG `dblclick` listener
// behaviorally (not mechanically).
export const DBLCLICK_WINDOW_MS = 300;
// Reject-flash duration, ms — matches the mock's flash()'s `setTimeout(...,
// 350)`.
export const FLASH_MS = 350;
// REQ-0041: warehouse-claim placement pulse ("ピコンピコン") -- a
// SUCCESS-colored (green, not reject-red) pulse on the cell(s) an
// auto-claimed item just landed on, distinct from flash()'s reject
// feedback. ~2s total per the REQ's "pulse for ~2 seconds" spec,
// composed of a few discrete on/off blinks (a single fade doesn't read
// as "pikon-pikon" -- a repeated blink does).
export const CLAIM_PULSE_TOTAL_MS = 2000;
export const CLAIM_PULSE_BLINK_MS = 330; // ~3 full on/off cycles across the 2s total
// Inventory linker dormancy visual (REQ-0030): dimmed core alpha, vs the
// canvas core's alpha (0.5 stroke / 0.55 fill, see render()).
export const INV_LINKER_ALPHA = 0.22;

export const CELL = 80;
export const PAD = 38;
export const DIR_ANGLES: Record<number, number> = {
  0: -90,
  1: -45,
  2: 0,
  3: 45,
  4: 90,
  5: 135,
  6: 180,
  7: -135,
};

export function cx(c: number): number {
  return PAD + (c - 1) * CELL + CELL / 2;
}
export function cy(r: number): number {
  return PAD + (r - 1) * CELL + CELL / 2;
}

export function mapPt(k: number, x: number, y: number, W0: number, H0: number): [number, number] {
  const kk = k % 4;
  if (kk === 0) return [x, y];
  if (kk === 1) return [H0 - y, x];
  if (kk === 2) return [W0 - x, H0 - y];
  return [y, W0 - x];
}


export function socketScreenPos(self: BoardRenderer, state: GameState, s: Socket, asm: Assembly | null): { x: number; y: number } | null {
    const { engine, ops } = self.deps;
    if (s.host === 'bond') {
      if (!asm) return null;
      return { x: cx(asm.hilt.cell![1]), y: PAD + (asm.hilt.cell![0] - 1) * CELL };
    }
    const container = ops.container(state);
    const p = container.pos.find((z) => z.uid === s.host);
    if (!p || p.loc !== 'grid' || !p.cell) return null;
    const box = { x: PAD + (p.cell[1] - 1) * CELL, y: PAD + (p.cell[0] - 1) * CELL };
    const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
    const W0 = cw * CELL;
    const H0 = ch * CELL;
    const [mx, my] = mapPt(((p.rot % 4) + 4) % 4, (s.ax ?? 0) * W0, (s.ay ?? 0) * H0, W0, H0);
    return { x: box.x + mx, y: box.y + my };
  }

export function arrowHead(_self: BoardRenderer, x: number, y: number, angle: number, color: string): Graphics {
    const g = new Graphics();
    const size = 8;
    g.moveTo(x, y);
    g.lineTo(x - size * Math.cos(angle - Math.PI / 7), y - size * Math.sin(angle - Math.PI / 7));
    g.lineTo(x - size * Math.cos(angle + Math.PI / 7), y - size * Math.sin(angle + Math.PI / 7));
    g.closePath();
    g.fill({ color });
    return g;
  }

  // -----------------------------------------------------------------------
  // Interaction machinery — REQ-0027 T0.2, extended REQ-0030 Phase 2 for
  // cross-board drags. See drag.ts's module comment for the overall
  // design: each mounted BoardRenderer registers a BoardCommitApi under
  // its own BoardId; pointerdown/pointermove stay per-instance (Pixi-
  // scoped: only the board currently under the pointer fires them, which
  // is exactly the board whose legality/ghost should be shown); pointerup
  // is handled by ONE centralized window listener (drag.ts's
  // ensurePointerUpWired) that looks up the drop's target board and
  // delegates the commit to it -- never duplicated per-instance, so a
  // drag ending on board B while it started on board A is never
  // double-committed by two independent listeners.
  // -----------------------------------------------------------------------

  /** Board-canvas-local pixel coords -> grid cell, matching the mock's
   * `cellAt(pt)`. */
export function cellAt(_self: BoardRenderer, x: number, y: number): Cell {
    return [Math.floor((y - PAD) / CELL) + 1, Math.floor((x - PAD) / CELL) + 1];
  }

  /** Converts a raw client (viewport) coordinate to board-canvas-local
   * pixel space, accounting for CSS scaling of the canvas element -- same
   * purpose as the mock's `svgPt(e)` (which scales by `W/rect.width`). */
export function clientToLocal(self: BoardRenderer, clientX: number, clientY: number): { x: number; y: number } {
    const rect = self.app.canvas.getBoundingClientRect();
    const scaleX = self.app.canvas.width / (rect.width || 1) / (self.app.renderer.resolution || 1);
    const scaleY = self.app.canvas.height / (rect.height || 1) / (self.app.renderer.resolution || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  /** REQ-0028 (aspect law): sizes+positions a Sprite to uniformly contain-fit
   * its texture's OWN native aspect ratio inside a (bx, by, bw, bh) box,
   * centered -- never stretching width/height independently. Replaces the
   * old pattern (three call sites: placed-PO art, ghost-PO art, merged
   * Longsword blade/hilt art) that set sprite.width/sprite.height from two
   * DIFFERENT box-fraction formulas per axis (e.g. `W0*0.8` for width vs
   * `H0-8` for height), which would visibly distort any icon whose native
   * texture aspect didn't exactly match the box aspect. With v8's
   * exact-aspect viewBoxes for all symbols, contain-fit and the old
   * stretch-fill produce IDENTICAL pixels for placed art (box aspect ==
   * texture aspect already) -- this is a correctness/safety fix, not a
   * visual change, for any icon actually shipped today. */
export function fitSpriteToBox(sprite: Sprite, bx: number, by: number, bw: number, bh: number, align?: IconAlign, foot?: { x: number; y: number; w: number; h: number }): void {
    // REQ-0038 R2: delegates to the shared, framework-agnostic box-fit
    // function (client/src/render/itemCard.ts's fitBoxInBounds) instead of
    // duplicating the scale/center formula here -- this is now the ONLY
    // place BoardRenderer computes that math; the Dex (ShapeGrid.tsx)
    // calls the exact same shared function for its own icon-on-shape
    // compositing, so both consumers stay byte-for-byte in sync by
    // construction, not by convention.
    const box = fitBoxInBounds(sprite.texture.width, sprite.texture.height, bx, by, bw, bh);
    // REQ-0102: optional directional alignment. Given an align + footprint
    // box, re-anchor the (same-size) contain-fit result to that footprint
    // edge -- translation only (aspect law). Omitted => centered, as before.
    let px = box.x;
    let py = box.y;
    if (align && foot) {
      if (align.h === 'left') px = foot.x;
      else if (align.h === 'right') px = foot.x + foot.w - box.w;
      if (align.v === 'top') py = foot.y;
      else if (align.v === 'bottom') py = foot.y + foot.h - box.h;
    }
    sprite.width = box.w;
    sprite.height = box.h;
    sprite.x = px;
    sprite.y = py;
  }

  /** pointerdown on a PO group -- REQ-0027 T0.2 double-click vs drag
   * disambiguation (see DBLCLICK_WINDOW_MS's module comment). Manual
   * bookkeeping: if a second pointerdown for this uid arrives within the
   * window AND the carry that the first pointerdown may have started never
   * armed (i.e. it was a plain click), treat this as a double-click and
   * call rotatePO immediately -- otherwise, start a normal drag exactly
   * like any other pointerdown (matches the mock's own dual dblclick+
   * pointerdown listeners coexisting on the same SVG group). Works
   * identically on an inventory board via self.deps.ops.rotatePO
   * (invRotatePO), REQ-0030 spec item 3: "rotate with dblclick works in
   * inventory too". */
  /** pointerdown on a BP's move-handle badge, an empty BP cell, or its
   * linker core -- REQ-0045 (a2) double-click vs drag disambiguation,
   * mirroring handlePOPointerDown's own manual dblclick-window bookkeeping
   * exactly (Pixi has no native dblclick event). A second pointerdown for
   * the SAME bpId within DBLCLICK_WINDOW_MS, whose first click never armed
   * a drag, rotates the BP in place via ops.canRotateBP/rotateBP (canvas)
   * or invCanRotateBP/invRotateBP (inventory, via BoardOps's ROTATE
   * indirection -- see boardOps.ts). Uses lastBPPointerDown (a SEPARATE
   * map from PO's own lastPointerDown -- see that field's doc) so a BP id
   * and a PO uid sharing the same literal string can never cross-trigger
   * each other's double-click. This handler is the ONE place all three
   * BP-drag entry points (move-handle badge, empty-cell handles, linker
   * core) route through -- POs keep their OWN separate dblclick handling
   * (handlePOPointerDown) entirely untouched, so a click landing on a PO
   * that happens to sit on top of a BP cell is never intercepted here
   * (call sites only wire this handler to BP-only hit areas: the badge,
   * empty cells with no PO, and the linker core circle, never a PO's own
   * sprite/hit-shape). */


/** Inverse of clientToLocal for a board-local pixel box (REQ-0119): maps a
 * (x,y,w,h) rect in this board's OWN local coordinate space to a viewport
 * (client) pixel rect, accounting for the canvas's CSS scale + renderer
 * resolution exactly as clientToLocal does, so the two round-trip. Used to
 * anchor the floating item tooltip (an HTML overlay, FloatingItemTip.tsx)
 * to a tapped PixiJS icon. */
export function localBoxToClient(
  self: BoardRenderer,
  x: number,
  y: number,
  w: number,
  h: number
): { left: number; top: number; width: number; height: number } {
  const rect = self.app.canvas.getBoundingClientRect();
  const res = self.app.renderer.resolution || 1;
  const sx = self.app.canvas.width ? (rect.width * res) / self.app.canvas.width : 1;
  const sy = self.app.canvas.height ? (rect.height * res) / self.app.canvas.height : 1;
  return { left: rect.left + x * sx, top: rect.top + y * sy, width: w * sx, height: h * sy };
}
