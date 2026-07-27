// client/src/board/chargeRing.ts — REQ-0125a, golden G7.
//
// G7 (unit_icon_pipeline.md §1, ratified 2026-07-12): "The Unit charge-state
// overlay is a RING FILL (radial progress around the icon), renderer-drawn
// per G2 and identical across all skins." G2 in turn forbids gameplay state in
// art -- an icon containing a gauge is a FAIL. So charge is drawn HERE, over
// the icon, by the renderer, and never baked into a sprite. G7 was reserved
// in the pipeline golden precisely so no icon bakes in ring-like framing that
// would collide with this overlay.
//
// ---------------------------------------------------------------------------
// THERE IS NO CHARGE DATA IN THIS CODEBASE. Verified 2026-07-12 (REQ-0125a):
//   * shared/engine.js is the PLACEMENT engine -- it has no time axis at all
//     (grep: no `charge`, no `cooldown`, no `timer`, no tick).
//   * sim/ has no per-unit charge either. The only `cooldown` in the tree is
//     sim/lib/dungeon.cjs's cooldownForH() -- the ROOM re-entry cooldown
//     (60-600s). That is a different quantity at a different granularity and
//     belongs to REQ-0098's room ring; wiring it into a UNIT's ring would be
//     semantically wrong.
//   * Canvas/inventory units are DORMANT by construction (out of combat --
//     REQ-0030 spec item 1: inventory BP units render dimmed, "no beams").
//     A dormant unit holds no charge.
//
// Therefore `charge` is `number | null` and every production call site passes
// NULL today -- no ring is drawn on the board. This is a deliberate, ratified
// choice (user, 2026-07-12: "描画は完成させ、値は null"): the DRAWING is finished,
// tested and visually verified via web/preview/unit-charge-ring/, but no fake
// charge value is put on the board pretending to be game state. REQ-0129
// (charge trigger taxonomy) supplies the real value; when it does, it changes
// ONE argument at the call site and this module needs no edit.
// ---------------------------------------------------------------------------
//
// Pure geometry lives in chargeRingArc() (no Pixi, no DOM) so it is exercised
// from plain Node -- see client/scripts/check_unit_icon.mjs.
import type { Graphics } from 'pixi.js';

/** Ring geometry constants. The ring hugs the OUTSIDE of the unit core disc
 * (r=26 in BoardRenderer) so it never occludes the character's face -- G4
 * demands the silhouette stay readable at 64px, and a ring drawn across the
 * icon would eat exactly the pixels that carry identity. */
export const RING_RADIUS = 30;
export const RING_WIDTH = 3;

/** Ring fill starts at 12 o'clock and sweeps CLOCKWISE -- the reading every
 * radial progress control in the genre uses. Pixi angles are radians, 0 = 3
 * o'clock, +ve = clockwise (y-down screen space), so 12 o'clock is -PI/2. */
export const RING_START_ANGLE = -Math.PI / 2;

export interface ChargeRingArc {
  startAngle: number;
  endAngle: number;
  /** Swept angle in radians; 0 <= sweep <= 2*PI. */
  sweep: number;
  /** True once the ring is full -- callers may style a "ready" flash off this
   * without re-deriving the comparison (and without float-equality bugs). */
  full: boolean;
}

/**
 * Maps a normalized charge to a ring arc.
 *
 *   null  -> null  (NO ring: "this unit has no charge concept / no data")
 *   0     -> null  (NO ring: an empty ring is visual noise on every idle unit;
 *                   the track is only worth drawing once charging has begun)
 *   0..1  -> arc sweeping clockwise from 12 o'clock
 *   >1,NaN-> clamped/rejected, never throws
 *
 * Out-of-band input is CLAMPED rather than thrown on: a renderer must never be
 * the thing that takes the board down because a gameplay value drifted.
 * Non-finite input (NaN/Infinity -- the classic "divided by a zero maximum"
 * bug) is treated as "no data" and draws nothing, which fails visibly-silent
 * rather than painting a garbage arc.
 *
 * Pure. Total. Never throws.
 */
export function chargeRingArc(charge: number | null | undefined): ChargeRingArc | null {
  if (charge === null || charge === undefined) return null;
  if (!Number.isFinite(charge)) return null;
  const t = Math.min(1, Math.max(0, charge));
  if (t === 0) return null;
  const sweep = t * Math.PI * 2;
  return {
    startAngle: RING_START_ANGLE,
    endAngle: RING_START_ANGLE + sweep,
    sweep,
    full: t >= 1,
  };
}

export interface ChargeRingStyle {
  /** Unfilled remainder of the ring. Drawn only when an arc exists, so an
   * idle unit stays visually quiet. */
  trackColor: number | string;
  fillColor: number | string;
  /** Colour once full -- the "ready" read, at a glance, across a board of
   * units. */
  readyColor: number | string;
  alpha: number;
}

/** Board palette (matches the unit core's existing cyan stroke, #59d6d6). */
export const DEFAULT_RING_STYLE: ChargeRingStyle = {
  trackColor: '#1c2b2b',
  fillColor: '#59d6d6',
  readyColor: '#ffd479',
  alpha: 1,
};

/**
 * Draws the charge ring for one unit into an existing Graphics.
 *
 * No-op when `charge` yields no arc (null / 0 / non-finite) -- so the current
 * production call sites, which all pass null, draw nothing and cost nothing.
 * The Graphics is expected to be decorative (eventMode 'none' at the call
 * site): the ring must never eat the pointer events that make the unit core a
 * BP drag handle.
 */
export function drawChargeRing(
  g: Graphics,
  x: number,
  y: number,
  charge: number | null | undefined,
  style: ChargeRingStyle = DEFAULT_RING_STYLE,
  radius: number = RING_RADIUS,
  width: number = RING_WIDTH
): void {
  const arc = chargeRingArc(charge);
  if (!arc) return;
  // Track first (full circle), then the fill arc on top of it: the unfilled
  // remainder reads as "how much is left", which is the whole point of a
  // radial gauge.
  g.circle(x, y, radius);
  g.stroke({ color: style.trackColor, width, alpha: style.alpha });
  g.arc(x, y, radius, arc.startAngle, arc.endAngle);
  g.stroke({
    color: arc.full ? style.readyColor : style.fillColor,
    width,
    alpha: style.alpha,
    cap: 'round',
  });
}
