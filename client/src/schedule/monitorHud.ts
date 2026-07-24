// REQ-0292 P2: stateless Pixi draw primitives for the instance HUD's ramp
// overlays -- the clockwise sweeps + wedges. Kept out of MonitorRenderer so the
// geometry (12-o'clock start, screen-clockwise winding) lives in ONE place and
// P3 (Fable aesthetics) can retune fill/alpha here. Draw-only: each takes a
// caller-owned Graphics and repaints it; no scene ownership, no ticker, no state.
//
// WINDING: Pixi's y-axis points DOWN, so an arc drawn with counterclockwise=false
// advances CLOCKWISE on screen. Starting at -PI/2 (12 o'clock) and sweeping
// frac*2PI gives the clockwise sweep REQ-0263 (k)/(l) call for.
import { Graphics } from 'pixi.js';

const TWO_PI = Math.PI * 2;
const START = -Math.PI / 2; // 12 o'clock

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Clockwise pie from 12 o'clock covering `frac` of a disc of radius r at
 * (cx,cy). Clears g first; frac<=0 leaves it EMPTY (nothing drawn -> vanishes at
 * ready); frac>=1 is a full disc. Used for the circular skill-badge sweep and the
 * unit-charge wedge (a coloured fill behind the seat icon). */
export function sweepPie(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  frac: number,
  color: number,
  alpha: number,
): void {
  g.clear();
  const f = clamp01(frac);
  if (f <= 0 || r <= 0) return;
  if (f >= 1) { g.circle(cx, cy, r).fill({ color, alpha }); return; }
  g.moveTo(cx, cy);
  g.arc(cx, cy, r, START, START + f * TWO_PI, false);
  g.lineTo(cx, cy);
  g.fill({ color, alpha });
}

/** Clockwise sweep covering `frac` of a RECTANGLE (x,y,w,h) -- the item-cooldown
 * overlay, drawn exactly over the PO's own footprint box (nothing displaced). The
 * pie is a disc large enough to cover the box's corners, CLIPPED to the box via
 * `mask` (a rect the caller wires as `pie.mask = mask`), so it never spills into
 * an adjacent item's cell. Both Graphics are cleared and repainted; frac<=0
 * leaves the pie empty (overlay gone at ready). The mask is always a full rect so
 * the overlay's live/ready transition is a pure pie change. */
export function sweepRectMasked(
  pie: Graphics,
  mask: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
  alpha: number,
): void {
  mask.clear();
  mask.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 1 });
  pie.clear();
  const f = clamp01(frac);
  if (f <= 0 || w <= 0 || h <= 0) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.hypot(w, h) / 2 + 1;
  if (f >= 1) { pie.circle(cx, cy, r).fill({ color, alpha }); return; }
  pie.moveTo(cx, cy);
  pie.arc(cx, cy, r, START, START + f * TWO_PI, false);
  pie.lineTo(cx, cy);
  pie.fill({ color, alpha });
}
