// client/src/board/usageRibbons.ts -- REQ-0287 (shared-usage visibility).
//
// Ownership ribbons: a compact, FULL-OPACITY, corner-anchored marker that
// stays legible on top of the newer visual layers (full-opacity registry
// item art, REQ-0273 per-PO ink+rim outlines, REQ-0266 bp-skin composites)
// that had out-shouted the 0.2-alpha REQ-0033 usage wash. The wash itself is
// UNCHANGED -- it still marks the exact footprint; this only ADDS a second,
// louder channel on top.
//
// Two channels, disambiguated by BOTH corner AND colour (REQ-0143: never hue
// alone -- position disambiguates even under all three CVD sims):
//   - shared-elsewhere -> TOP-RIGHT triangle, OVERLAY.usage.otherSquad (blue)
//   - in-current-squad -> TOP-LEFT  triangle, OVERLAY.usage.selfSquad (verm.)
// A share-count Text rides inside the shared ribbon when >= 2 OTHER squads
// hold the uid (matches the ✥ badge glyph type style).
//
// Pure draw helpers, ghosts.ts pattern: a `self: BoardRenderer` receiver that
// draws into self.gBadges (above item art, below sockets/units -- exactly
// where the ✥ badge already lives), every node eventMode='none' per the
// constructor hit-test doctrine.
import { Graphics, Text } from 'pixi.js';
import type { Cell } from '../engine/engine.d.ts';
import type { BoardRenderer } from './BoardRenderer';
import { CELL, PAD } from './geom';
import { OVERLAY } from './overlayPalette';

/** A pixel-space bounding box in board-LOCAL coords (the same space every
 * draw loop in BoardRenderer uses: `PAD + (c-1)*CELL`, `PAD + (r-1)*CELL`). */
export interface BBoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEG = 16; // triangle leg length (px) along each of the two cell edges
const KEYLINE = 0x0e0d0b; // dark keyline so the ribbon reads on any art below
const KEYLINE_W = 1.5;
const COUNT_FILL = 0xf2fbff; // matches the ✥ badge glyph (BoardRenderer ~L552)
const COUNT_SIZE = 9;

/** Inclusive 1-based cell list -> its pixel bounding box. Correct for POs
 * (multi-cell footprint) and SIs (a single [[r,c]]) alike. */
export function cellsBBoxPx(cells: Cell[]): BBoxPx {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { x: PAD + (minC - 1) * CELL, y: PAD + (minR - 1) * CELL, w: (maxC - minC + 1) * CELL, h: (maxR - minR + 1) * CELL };
}

/** The single cell that owns a BP's TOP-RIGHT ribbon: smallest row, and among
 * those the largest column (spec item 1 -- "anchor on the BP's top-right-most
 * cell", since the bbox top-right corner of an L-shaped BP can be dead space). */
export function topRightCellBBoxPx(cells: Cell[]): BBoxPx {
  const minR = Math.min(...cells.map((c) => c[0]));
  const maxC = Math.max(...cells.filter((c) => c[0] === minR).map((c) => c[1]));
  return { x: PAD + (maxC - 1) * CELL, y: PAD + (minR - 1) * CELL, w: CELL, h: CELL };
}

/** The BP's TOP-LEFT-most cell (r0,c0) -- the same anchor its ✥ handle and
 * name/HP label already use. The 16px corner wedge never reaches the centred
 * ✥ glyph (drawn at cell-centre 14,14), so the handle is never occluded. */
export function topLeftCellBBoxPx(cells: Cell[]): BBoxPx {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.filter((c) => c[0] === minR).map((c) => c[1]));
  return { x: PAD + (minC - 1) * CELL, y: PAD + (minR - 1) * CELL, w: CELL, h: CELL };
}

/** Shared-elsewhere ribbon: a right triangle folded into the bbox TOP-RIGHT
 * corner, otherSquad colour at full opacity, dark keyline, optional count. */
export function drawSharedRibbon(self: BoardRenderer, bbox: BBoxPx, count: number | null): void {
  const x1 = bbox.x + bbox.w;
  const y0 = bbox.y;
  const g = new Graphics();
  g.poly([x1 - LEG, y0, x1, y0, x1, y0 + LEG]);
  g.fill({ color: OVERLAY.usage.otherSquad.color, alpha: 1 });
  g.stroke({ color: KEYLINE, width: KEYLINE_W });
  g.eventMode = 'none';
  self.gBadges.addChild(g);
  if (count !== null && count >= 2) {
    const label = new Text({ text: String(count), style: { fill: COUNT_FILL, fontSize: COUNT_SIZE } });
    label.anchor.set(0.5);
    label.x = x1 - LEG / 3; // triangle centroid
    label.y = y0 + LEG / 3;
    label.eventMode = 'none';
    self.gBadges.addChild(label);
  }
}

/** In-current-squad ribbon: a right triangle folded into the bbox TOP-LEFT
 * corner, selfSquad colour at full opacity, dark keyline. */
export function drawSelfRibbon(self: BoardRenderer, bbox: BBoxPx): void {
  const x0 = bbox.x;
  const y0 = bbox.y;
  const g = new Graphics();
  g.poly([x0, y0, x0 + LEG, y0, x0, y0 + LEG]);
  g.fill({ color: OVERLAY.usage.selfSquad.color, alpha: 1 });
  g.stroke({ color: KEYLINE, width: KEYLINE_W });
  g.eventMode = 'none';
  self.gBadges.addChild(g);
}

/** How many squads OTHER than the current one hold `uid` (spec item 2 --
 * `usageOf` minus the current squad). tintSets/usageOf are the only truth
 * (shared/engine.js); this never forks that math. */
function otherSquadCount(self: BoardRenderer, uid: string): number {
  const st = self.lastState;
  if (!st || !st.presets) return 0;
  const active = st.presets.active;
  return self.deps.engine.usageOf(st, uid).filter((i: number) => i !== active).length;
}

/** Draw both applicable ribbons for `uid` and record the probe entries.
 * `sharedBbox`/`selfBbox` differ only for BPs (tr = top-right-most cell, tl =
 * top-left-most cell); PO/SI pass the same footprint bbox for both. Membership
 * uses the per-board sets render() already selected (canvas: {red:{},
 * yellow:canvasYellow}; inventory: {red, yellow}), so "canvas never shows red"
 * falls out for free -- tintRedSet is empty there. */
export function paintUsageRibbons(
  self: BoardRenderer,
  uid: string,
  sharedBbox: BBoxPx,
  selfBbox: BBoxPx,
  redSet: Set<string>,
  yellowSet: Set<string>,
): void {
  if (yellowSet.has(uid)) {
    const count = otherSquadCount(self, uid);
    drawSharedRibbon(self, sharedBbox, count);
    self.usageRibbonProbe.push({ uid, corner: 'tr', count: count >= 2 ? count : null });
  }
  if (redSet.has(uid)) {
    drawSelfRibbon(self, selfBbox);
    self.usageRibbonProbe.push({ uid, corner: 'tl', count: null });
  }
}
