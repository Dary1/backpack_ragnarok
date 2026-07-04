// Shared item-on-shape compositing -- REQ-0038 feedback round 2.
//
// ROOT CAUSE this module fixes: client/src/dex/ShapeGrid.tsx rendered an
// item's icon inline inside ONE per-cell <div> (the shape's "anchor" cell,
// shape[0] -- see that file's old module comment), sized to fill that
// single CSS-grid cell via `inset:0`. For any multi-cell item (blade
// shape=[[0,0],[1,0]], tower_shield shape=[[0,0],[0,1],[1,0],[1,1]]) this
// visually squeezes the whole icon into the first cell's small box instead
// of compositing it across the item's full footprint -- exactly the bug
// screenshotted in feedback round 2. client/src/board/BoardRenderer.ts
// never had this bug: it computes one pixel box spanning the item's ENTIRE
// rotated footprint (engine.shapeInfo(id,rot).w/h * CELL) and uniform-
// contain-fits the sprite texture inside that box via fitSpriteToBox, once,
// as a single element layered OVER the per-cell backdrops -- never once
// per cell. This module extracts that exact box-fitting math (not a
// rewrite -- see fitBoxInBounds below, byte-for-byte the same formula as
// BoardRenderer.fitSpriteToBox, and computeFootprintCells/insetBoxFor
// below, the same shapeInfo(id,0)+stretch-branch logic as BoardRenderer's
// placed-PO draw path) into ONE framework-agnostic module so both the
// PixiJS board and the DOM-based Dex compose "icon mounted on shape" the
// same way, instead of each maintaining its own placement math.
//
// Loose coupling, by design:
//  - This module depends ONLY on mock-src/engine.js's pure, state-free
//    `rotOffsets` free function (via engine/adapter.ts's `Engine` module
//    export -- Engine.rotOffsets, not a bound EngineInstance/GameState) and
//    on nothing PixiJS-specific. BoardRenderer.ts (a Pixi scene) and the
//    Dex components (plain DOM/React) both call these same pure functions
//    and then apply the result in whatever rendering technology they use
//    (Sprite width/height/x/y for Pixi; inline style left/top/width/height
//    for DOM) -- no shared UI framework, no shared scene-graph objects.
//  - Nothing here touches sprites.ts's Pixi Texture/rasterize path. DOM
//    consumers keep using dexIcons.ts's existing iconDataUrl() (already an
//    SVG data: URL, sized via a plain <img>) -- this module only tells
//    them WHERE to put that <img> and how big to make it.
import type { Offset } from '../engine/engine.d.ts';
import { Engine } from '../engine/adapter';

export interface ItemCardShapeInput {
  /** Unrotated shape offsets, e.g. ItemDef.shape / ApiItemEntry.shape. */
  shape: Offset[];
  /** REQ-0028 aspect-law inset preset selector -- same field BoardRenderer
   * reads off ItemDef.stretch to choose which inset-fraction branch to
   * use below. */
  stretch?: boolean;
}

export interface FootprintCells {
  /** Rotated shape offsets (each already re-normalized to a non-negative
   * min row/col by Engine.rotOffsets, matching engine.js's shapeInfo). */
  off: Offset[];
  /** Rotated bounding-box height, in whole grid cells. */
  h: number;
  /** Rotated bounding-box width, in whole grid cells. */
  w: number;
}

/**
 * Computes an item's occupied-cell footprint at a given rotation -- the
 * exact math mock-src/engine.js's shapeInfo(id,rot) performs internally
 * (rotOffsets + bbox), but callable from a bare `shape` array with no
 * GameState/ItemDefMap/EngineInstance required. This is what makes the
 * function usable both from BoardRenderer (which already HAS a bound
 * EngineInstance and could call engine.shapeInfo directly) and from Dex
 * (which only ever has the raw /api/content shape array, no engine
 * instance bound to any game state) without either side forking the
 * rotation/bbox arithmetic.
 */
export function computeFootprintCells(shape: Offset[], rot = 0): FootprintCells {
  const off = Engine.rotOffsets(shape, rot);
  const h = Math.max(...off.map((o) => o[0])) + 1;
  const w = Math.max(...off.map((o) => o[1])) + 1;
  return { off, h, w };
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Uniform contain-fit box for a texture of size (texW,texH) inside an
 * arbitrary pixel box (bx,by,bw,bh), centered -- byte-for-byte the same
 * formula as BoardRenderer.fitSpriteToBox (REQ-0028 "aspect law": never
 * stretches width/height independently). BoardRenderer.ts now calls this
 * function instead of duplicating the arithmetic (see that file's
 * fitSpriteToBox, refactored to a thin wrapper that applies this box to a
 * Pixi Sprite's width/height/x/y).
 */
export function fitBoxInBounds(texW: number, texH: number, bx: number, by: number, bw: number, bh: number): PixelBox {
  const scale = texW > 0 && texH > 0 ? Math.min(bw / texW, bh / texH) : 1;
  const w = texW * scale;
  const h = texH * scale;
  return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
}

/**
 * The REQ-0028 inset-fraction box an icon is fit into within its own
 * unrotated W0xH0 footprint box, before the uniform contain-fit above is
 * applied -- same two presets BoardRenderer's placed-PO/ghost-PO draw
 * paths branch on via ItemDef.stretch (def.stretch ? tight 10%/80% inset :
 * looser 6/5%..88/90% inset). Pure box arithmetic, no texture involved yet.
 */
export function insetBoxFor(stretch: boolean | undefined, w0: number, h0: number): PixelBox {
  return stretch
    ? { x: w0 * 0.1, y: h0 * 0.1, w: w0 * 0.8, h: h0 * 0.8 }
    : { x: w0 * 0.06, y: h0 * 0.05, w: w0 * 0.88, h: h0 * 0.9 };
}

export interface ItemCardLayout {
  /** Footprint at rot=0, in cells (w x h) -- this is the full grid the icon
   * must be composited across, NOT a single cell. */
  footprint: FootprintCells;
  /** Pixel size of the whole footprint box, given the caller's per-cell
   * pixel budget. */
  footprintPx: { w: number; h: number };
  /** Where, within the footprint box, the (still cell-aspect, unrotated)
   * icon box sits after applying the stretch/non-stretch inset. */
  insetPx: PixelBox;
  /** Final contain-fit box for the icon texture/image, in the SAME pixel
   * coordinate space as footprintPx (i.e. (0,0) is the footprint box's own
   * top-left corner) -- this is the box a consumer positions its <img> (or
   * Pixi Sprite) at. Always fully inside footprintPx, spanning the item's
   * real multi-cell shape rather than being clipped to one cell. */
  iconBox: PixelBox;
}

/**
 * Computes the full "item mounted on its shape" layout for rot=0 given a
 * per-cell pixel budget (cellPx) -- the one function both the board (via
 * BoardRenderer's refactor) and the Dex (catalog cards, edit-mode
 * thumbnails, detail diagram) call so the placement math is written once.
 * texW/texH are the icon texture/image's OWN native pixel dimensions
 * (Pixi Texture.width/height, an <img> naturalWidth/naturalHeight, or an
 * SVG symbol's viewBox width/height -- same units fitBoxInBounds already
 * expects). Board content ships icons whose viewBox aspect already matches
 * the shape's cell-aspect box (REQ-0028's "exact-aspect viewBoxes" note),
 * so DOM callers that haven't decoded the image yet (no natural size
 * available synchronously) can still get a correct box by passing the
 * icon's own SVG viewBox width/height (dexIcons.ts's SymbolInfo already
 * carries these).
 */
export function computeItemCardLayout(
  input: ItemCardShapeInput,
  cellPx: number,
  texW: number,
  texH: number
): ItemCardLayout {
  const footprint = computeFootprintCells(input.shape, 0);
  const w0 = footprint.w * cellPx;
  const h0 = footprint.h * cellPx;
  const insetPx = insetBoxFor(input.stretch, w0, h0);
  const iconBox = fitBoxInBounds(texW, texH, insetPx.x, insetPx.y, insetPx.w, insetPx.h);
  return { footprint, footprintPx: { w: w0, h: h0 }, insetPx, iconBox };
}

/**
 * DOM-context convenience wrapper: returns everything a React consumer
 * (ShapeGrid.tsx's overlay, see that file's fix) needs to render one
 * absolutely-positioned <img>, covering the item's full rotated-at-0
 * footprint instead of one cell, plus the footprint metrics as plain
 * numbers so E2E can assert on rendered geometry without pixel-sampling
 * (exposed by the caller as data-* attributes -- see ShapeGrid's
 * `data-footprint-w`/`data-footprint-h` on the overlay wrapper).
 */
export interface DomIconOverlay {
  /** Inline style box for the <img> itself, relative to a wrapper element
   * sized to footprintPx and positioned at the footprint's own top-left
   * grid cell (callers already have that origin from their own cell
   * layout loop -- this function does not know about grid-line pixel
   * offsets outside the footprint, only the footprint-local box). */
  style: { left: number; top: number; width: number; height: number };
  footprintCells: { w: number; h: number };
  footprintPx: { w: number; h: number };
}

export function computeDomIconOverlay(
  input: ItemCardShapeInput,
  cellPx: number,
  texW: number,
  texH: number
): DomIconOverlay {
  const layout = computeItemCardLayout(input, cellPx, texW, texH);
  return {
    style: { left: layout.iconBox.x, top: layout.iconBox.y, width: layout.iconBox.w, height: layout.iconBox.h },
    footprintCells: { w: layout.footprint.w, h: layout.footprint.h },
    footprintPx: layout.footprintPx,
  };
}
