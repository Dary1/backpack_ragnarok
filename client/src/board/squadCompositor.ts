// client/src/board/squadCompositor.ts -- REQ-0283.
//
// THE shared "squad drawn faithfully at its cells" compositor. Canvas /
// Inventory (BoardRenderer.ts) is the visual canon; the /schedule monitor did
// PARTIALLY the same thing but with its own, WRONG unit-art path (REQ-0276's
// drawUnitArt washed a translucent sprite across the BP's whole footprint
// bounding box). The user ruled (2026-07-22): unit art is NOT the BP
// background; it is drawn AT THE UNIT'S SEAT CELL, board-style -- a core disc
// plus a contain-fit icon centred on that one cell, at FULL alpha, ON TOP of
// the BP fill and any POs. This module is that common mechanism, extracted so
// the monitor now, and BoardRenderer later (non-goal today), compose a squad
// the SAME way instead of each maintaining its own placement math.
//
// DRAW-ONLY. Every object it adds is eventMode 'none' (decorative -- it never
// eats pointer events, the constructor-note discipline BoardRenderer keeps for
// its own decorative children). It owns no scene graph, no ticker, no state:
// the caller passes a Container and the geometry, this paints into it.
//
// cellPx-PARAMETERISED. BoardRenderer draws at a fixed CELL=80 grid; the
// monitor draws formation boxes at ~18px cells. So every board constant used
// here (unit core disc r=26, unit icon box 44x44, PO outline inset 3px + its
// two-tone stroke widths -- all authored against CELL=80) is expressed as a
// RATIO of the caller's cellPx, so the board look scales down without being
// re-tuned by hand.
//
// COORDINATE CONVENTION. Cells are 1-indexed engine cells (A1 == [1,1]). The
// caller supplies an origin pixel (originX/originY) and a cellPx; a cell (r,c)
// is drawn with its top-left at (originX + c*cellPx, originY + r*cellPx). NOTE
// this is the monitor's own convention (offset by its formation-box origin,
// NOT the board's PAD + (c-1)*CELL) -- so the compositor takes the same cells
// the caller already positions its fills with, and the seat disc / PO outline
// land pixel-consistent with those fills (the whole point: nothing is
// displaced relative to anything else).
//
// REUSE, NEVER FORK. The math comes from the ratified pure modules:
//   * render/itemCard.ts  -- computeFootprintCells, insetBoxFor, fitBoxInBounds
//   * board/poOutline.ts   -- boundaryLoops, insetLoop, the two-tone ink+rim
//   * board/unitIcon.ts    -- resolveUnitIcon chain + key helpers + skin picks
//   * board/itemArt.ts     -- resolveItemIcon (registry->sprite->placeholder)
//   * board/skin/*         -- resolveBpSkin + bpSkinSprite (bp-skin tiling)
// The only thing written here is the board->cellPx coordinate remap.
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Cell, Offset } from '../engine/engine.d.ts';
import { CELL as BOARD_CELL } from './geom';
import { computeFootprintCells, insetBoxFor, fitBoxInBounds } from '../render/itemCard';
import { boundaryLoops, insetLoop, PO_OUTLINE_INK, PO_OUTLINE_RIM, PO_OUTLINE_INSET, type Pt } from './poOutline';
import { resolveUnitIcon, unitIconKey, activeUnitSkinKey, pickedSkinId, defaultSkinId } from './unitIcon';
import { resolveItemIcon } from './itemArt';
import { resolveBpSkin } from './skin/bpSkinResolve';
import { bpSkinDefs, hasBpSkin } from './skin/skinRegistry';
import { bpSkinSprite } from './skin/bpSkinTexture';

/** Board reference geometry (px at CELL=80), taken verbatim from
 * BoardRenderer.ts:1008-1074 so the seat marker reads identically to the
 * board, just scaled to the caller's cellPx. */
const BOARD_UNIT_CORE_R = 26; // core disc radius at CELL=80
const BOARD_UNIT_ICON = 44; // contain-fit icon box at CELL=80 (0.55 * CELL)
/** The board's unit core: near-black disc, cyan hairline (BoardRenderer). */
const DEFAULT_DISC_FILL = '#0e0d0b';
const DEFAULT_DISC_STROKE = '#59d6d6';
/** bpSkinTexture.ts composites with one cell of MARGIN around the silhouette;
 * its board-space sprite anchor bakes that in. Mirrored here for the remap. */
const SKIN_MARGIN = 1;

/** One BP to compose. `cells` and `seatCell` are in the caller's 1-indexed
 * cell space (see module coordinate note). `seatCell` is the Unit's seat
 * (engine.unitCell(bp) = origin + unit.off); null draws no unit at all. */
export interface CompositorBP {
  cells: Offset[];
  seatCell: Offset | null;
  color: string;
  /** The seated Unit's def id -- drives resolveUnitIcon (skin/default) and the
   * bp-skin pick. Absent = no unit art, only the bare core disc. */
  unitId?: string;
}

/** One placed PO to compose, at its own absolute top-left cell. */
export interface CompositorPO {
  /** Unrotated footprint offsets (ItemDef.shape). */
  shape: Offset[];
  rot: number;
  /** Absolute top-left cell of the footprint (1-indexed, caller space). */
  origin: Offset;
  /** SVG sprite-symbol key (ItemDef.icon) -- the `sprite` rung of the chain. */
  spriteKey: string;
  /** Item def id -- the `registry` (raster) rung of resolveItemIcon. */
  itemId?: string;
  /** REQ-0028 aspect-law inset selector (ItemDef.stretch). */
  stretch?: boolean;
}

export interface ComposeOpts {
  cellPx: number;
  originX: number;
  originY: number;
  /** The loaded Pixi texture map (has()/get()); same map BoardRenderer holds. */
  textures: Map<string, Texture>;
  // --- BP fill styling (defaults reproduce the monitor's REQ-0276 look) ---
  fillAlpha?: number;
  cellStrokeColor?: number | string;
  cellStrokeAlpha?: number;
  cellStrokeWidth?: number;
  // --- unit seat styling (defaults reproduce the board look) ---
  discFill?: string;
  discStroke?: string;
  /** Draw bp-skin tiling when a skin resolves (default true). A BP that lands
   * on neutral / an unadopted skin paints nothing, exactly as on the board. */
  drawSkin?: boolean;
  /** Called when an async bp-skin raster finishes decoding, so a live caller
   * can repaint. Omit for a one-shot draw (skin then paints only if cached). */
  onSkinReady?: () => void;
}

/** Absolute px of a cell's top-left corner in the caller's convention. */
function cellTopLeft(r: number, c: number, o: ComposeOpts): { x: number; y: number } {
  return { x: o.originX + c * o.cellPx, y: o.originY + r * o.cellPx };
}

/** BP fill: one tinted, dark-stroked rect per cell -- the base layer (board
 * gBase). Drawn first so POs and the unit seat sit on top. */
function drawBpFill(container: Container, bp: CompositorBP, o: ComposeOpts): void {
  const g = new Graphics();
  const colorNum = parseInt(bp.color.replace('#', ''), 16) || 0x888888;
  const alpha = o.fillAlpha ?? 0.72;
  const strokeColor = o.cellStrokeColor ?? 0x0a0a0a;
  const strokeAlpha = o.cellStrokeAlpha ?? 0.55;
  const strokeWidth = o.cellStrokeWidth ?? 1;
  for (const [r, c] of bp.cells) {
    const { x, y } = cellTopLeft(r, c, o);
    g.rect(x, y, o.cellPx, o.cellPx)
      .fill({ color: colorNum, alpha })
      .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha });
  }
  g.eventMode = 'none';
  container.addChild(g);
}

/** bp-skin tiling (board gSkins): resolve the BP's skin through the ratified
 * chain, build the board-space composite sprite via the shared bpSkinSprite,
 * then REMAP it from board (PAD + (c-1)*CELL) space into the caller's
 * (originX + c*cellPx) space. Reuses bpSkinSprite whole -- only the transform
 * is written here. No-op (no child) when no skin declares art. */
function drawBpSkin(container: Container, bp: CompositorBP, o: ComposeOpts): void {
  if (o.drawSkin === false || !bp.unitId) return;
  const res = resolveBpSkin(
    {
      instanceSkinId: null,
      profileSkinId: pickedSkinId(bp.unitId, 'bpskin'),
      unitSetSkinId: defaultSkinId(bp.unitId, 'bpskin'),
    },
    hasBpSkin
  );
  if (!res.skinId) return;
  const def = bpSkinDefs()[res.skinId];
  const sprite = bpSkinSprite(bp.cells as Cell[], def, o.onSkinReady);
  if (!sprite) return; // neutral / unadopted / not-yet-decoded -> paints nothing
  // bpSkinSprite returns a CELL=80-scale sprite anchored in board space. Scale
  // it to the caller's cellPx and re-anchor: the composite's pixel (0,0) is the
  // top-left of cell (r0-MARGIN, c0-MARGIN) (bpSkinTexture bakes MARGIN cells of
  // padding), which in the caller's convention sits at originX + (c0-1)*cellPx.
  const r0 = Math.min(...bp.cells.map((cc) => cc[0]));
  const c0 = Math.min(...bp.cells.map((cc) => cc[1]));
  sprite.scale.set(o.cellPx / BOARD_CELL);
  sprite.x = o.originX + (c0 - SKIN_MARGIN) * o.cellPx;
  sprite.y = o.originY + (r0 - SKIN_MARGIN) * o.cellPx;
  sprite.eventMode = 'none';
  container.addChild(sprite);
}

/** Trace + stroke a PO footprint outline (board's two-tone ink+rim) at the
 * caller's scale. Reuses boundaryLoops + insetLoop; the ONLY new arithmetic is
 * the cell-vertex -> px map. boundaryLoops emits vertices where cell (r,c) owns
 * column vertices {c-1, c}; the caller draws that cell's left edge at
 * originX + c*cellPx, so a vertex value X maps to originX + (X+1)*cellPx. */
function drawPOOutlineScaled(g: Graphics, absCells: Offset[], o: ComposeOpts): void {
  const scale = o.cellPx / BOARD_CELL;
  const inset = Math.max(0.75, PO_OUTLINE_INSET * scale);
  const inkW = Math.max(1, PO_OUTLINE_INK.width * scale);
  const rimW = Math.max(0.5, PO_OUTLINE_RIM.width * scale);
  const loops = boundaryLoops(absCells as Cell[]).map((loop) =>
    insetLoop(
      loop.map(([x, y]) => [o.originX + (x + 1) * o.cellPx, o.originY + (y + 1) * o.cellPx] as Pt),
      inset
    )
  );
  if (loops.length === 0) return;
  const trace = (): void => {
    for (const loop of loops) {
      g.moveTo(loop[0][0], loop[0][1]);
      for (let i = 1; i < loop.length; i++) g.lineTo(loop[i][0], loop[i][1]);
      g.closePath();
    }
  };
  trace();
  g.stroke({ color: PO_OUTLINE_INK.color, width: inkW, alpha: PO_OUTLINE_INK.alpha, join: 'miter', cap: 'butt' });
  trace();
  g.stroke({ color: PO_OUTLINE_RIM.color, width: rimW, alpha: PO_OUTLINE_RIM.alpha, join: 'miter', cap: 'butt' });
}

/** One placed PO (board gItems): registry-first icon contain-fit across the
 * item's WHOLE rotated footprint (never one cell, never stretched -- the
 * aspect law), plus the footprint outline stating true cell ownership. */
function drawPO(container: Container, po: CompositorPO, o: ComposeOpts): void {
  const footprint = computeFootprintCells(po.shape, po.rot);
  const [originR, originC] = po.origin;
  const boxW = footprint.w * o.cellPx;
  const boxH = footprint.h * o.cellPx;
  const bx = o.originX + originC * o.cellPx;
  const by = o.originY + originR * o.cellPx;

  const res = resolveItemIcon(po.itemId, po.spriteKey, (k) => o.textures.has(k));
  const tex = res.key ? o.textures.get(res.key) : undefined;
  if (tex) {
    // REQ-0028 aspect law: contain-fit into the stretch/non-stretch inset box,
    // the same two branches BoardRenderer's placed-PO path uses.
    const inset = insetBoxFor(po.stretch, boxW, boxH);
    const fit = fitBoxInBounds(tex.width, tex.height, bx + inset.x, by + inset.y, inset.w, inset.h);
    const sprite = new Sprite(tex);
    sprite.eventMode = 'none';
    sprite.x = fit.x;
    sprite.y = fit.y;
    sprite.width = fit.w;
    sprite.height = fit.h;
    container.addChild(sprite);
  }
  // Footprint outline -- drawn even with no texture (the no-art case is where
  // the footprint is hardest to read), above the sprite (art fills the bbox and
  // can overhang an L/T shape's true cells).
  const absCells: Offset[] = footprint.off.map(([dr, dc]) => [originR + dr, originC + dc]);
  const outline = new Graphics();
  outline.eventMode = 'none';
  drawPOOutlineScaled(outline, absCells, o);
  container.addChild(outline);
}

/** The unit seat (board gUnits, ON TOP): a core disc + contain-fit icon centred
 * on the SEAT CELL -- board-style, full alpha, NEVER washed across the
 * footprint. The disc is drawn even when no art resolves, so a unit with no
 * art still shows its seat marker at the exact cell (REQ-0283 binding rule). */
function drawUnitSeat(container: Container, bp: CompositorBP, o: ComposeOpts): void {
  if (!bp.seatCell) return;
  const [sr, sc] = bp.seatCell;
  // REQ-0284 (hotfix hardening): never let a non-finite seat (NaN/Infinity from
  // a malformed unit.off) reach Pixi geometry -- skip the seat marker instead.
  if (!Number.isFinite(sr) || !Number.isFinite(sc)) return;
  const cx = o.originX + (sc + 0.5) * o.cellPx;
  const cy = o.originY + (sr + 0.5) * o.cellPx;
  const r = (BOARD_UNIT_CORE_R / BOARD_CELL) * o.cellPx;

  const core = new Graphics();
  core.circle(cx, cy, r)
    .fill({ color: o.discFill ?? DEFAULT_DISC_FILL, alpha: 0.9 })
    .stroke({ color: o.discStroke ?? DEFAULT_DISC_STROKE, width: Math.max(1, r * 0.06), alpha: 0.9 });
  core.eventMode = 'none';
  container.addChild(core);

  const res = resolveUnitIcon(
    {
      skinKey: bp.unitId ? activeUnitSkinKey(bp.unitId) : null,
      defaultKey: bp.unitId ? unitIconKey(bp.unitId) : null,
    },
    (k) => o.textures.has(k)
  );
  const tex = res.key ? o.textures.get(res.key) : undefined;
  if (!tex) return; // placeholder rung: the disc IS the seat marker
  const box = (BOARD_UNIT_ICON / BOARD_CELL) * o.cellPx;
  const fit = fitBoxInBounds(tex.width, tex.height, cx - box / 2, cy - box / 2, box, box);
  const sprite = new Sprite(tex);
  sprite.eventMode = 'none';
  sprite.x = fit.x;
  sprite.y = fit.y;
  sprite.width = fit.w;
  sprite.height = fit.h;
  sprite.alpha = 1; // real art (and the legacy glyph, as a seat marker) full alpha
  container.addChild(sprite);
}

/**
 * Compose ONE BP together with a set of POs, in board z-order:
 *   BP cell fill (+ bp-skin tiling)  ->  PO sprites + outlines  ->  unit seat.
 * The primitive named in the REQ contract; also the natural unit for a future
 * BoardRenderer adoption where each BP owns its contained POs.
 */
export function composeSquadBP(
  container: Container,
  bp: CompositorBP,
  pos: CompositorPO[],
  opts: ComposeOpts
): void {
  drawBpFill(container, bp, opts);
  drawBpSkin(container, bp, opts);
  for (const po of pos) drawPO(container, po, opts);
  drawUnitSeat(container, bp, opts);
}

/**
 * Compose a WHOLE squad (several BPs sharing one formation canvas + its placed
 * POs). Draws in three global passes -- all BP fills, then all POs, then all
 * unit seats -- so the board's gBase < gItems < gUnits layering holds ACROSS
 * the squad (a PO on one BP never paints over another BP's fill, a unit seat
 * always sits above every PO). This is the monitor's entry point.
 */
export function composeSquad(
  container: Container,
  squad: { bps: CompositorBP[]; pos: CompositorPO[] },
  opts: ComposeOpts
): void {
  for (const bp of squad.bps) {
    drawBpFill(container, bp, opts);
    drawBpSkin(container, bp, opts);
  }
  for (const po of squad.pos) drawPO(container, po, opts);
  for (const bp of squad.bps) drawUnitSeat(container, bp, opts);
}
