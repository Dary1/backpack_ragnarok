// client/src/board/squadCellGeom.ts -- REQ-0286.
//
// THE single source of truth for the squad compositor's cell->pixel mapping.
// Extracted so squadCompositor.ts (the DRAW) and MonitorRenderer.ts (the
// ray_fire muzzle-flash handle geometry) share ONE convention -- and so the
// pure arithmetic is node-gate-testable without a Pixi renderer, exactly like
// board/poOutline.ts is. No pixi import lives here on purpose.
//
// COORDINATE CONVENTION -- BINDING, and IDENTICAL to the board canon
// (Canvas/Inventory, BoardRenderer.ts, which is pixel-correct in production):
//   * BP cell fill top-left   BoardRenderer.ts:411,435  PAD + (c-1)*CELL
//   * PO footprint box         BoardRenderer.ts:791-793  PAD + (p.cell[1]-1)*CELL
//   * PO outline vertex map     poOutline.ts:64          PAD + x*CELL   (NO +1)
//   * unit seat centre          geom.ts:67-72            PAD + (c-1)*CELL + CELL/2
// Cells are 1-INDEXED engine-local cells (A1 == [1,1], shared/engine.d.ts:28).
// The caller supplies its own box-origin pixel (originX/originY) and a cellPx:
//   * cell (r,c) top-left = ( originX + (c-1)*cellPx, originY + (r-1)*cellPx )
//   * cell (r,c) centre   = ( originX + (c-0.5)*cellPx, originY + (r-0.5)*cellPx )
//   * boundary VERTEX x   = ( originX + x*cellPx )  [x already 0-based: cell c
//                            owns vertices x in {c-1,c}, see poOutline.boundaryLoops]
// So the top-left cell (1,1) is FLUSH with (originX, originY) -- ZERO padding --
// and an 8x8 formation fills EXACTLY [origin, origin + 8*cellPx].
//
// DO NOT re-introduce `c*cellPx` (no -1): that was the REQ-0283 skew this module
// exists to forbid -- it padded the squad one cell down-right and overflowed the
// formation box at the bottom-right (owner report, REQ-0286).

/** The minimal frame every mapping needs; ComposeOpts satisfies it structurally. */
export interface CellFrame {
  originX: number;
  originY: number;
  cellPx: number;
}

/** Top-left pixel of 1-indexed local cell (r,c). */
export function cellTopLeftPx(r: number, c: number, f: CellFrame): { x: number; y: number } {
  return { x: f.originX + (c - 1) * f.cellPx, y: f.originY + (r - 1) * f.cellPx };
}

/** Centre pixel of 1-indexed local cell (r,c) -- the unit seat disc / icon centre. */
export function cellCenterPx(r: number, c: number, f: CellFrame): { x: number; y: number } {
  return { x: f.originX + (c - 0.5) * f.cellPx, y: f.originY + (r - 0.5) * f.cellPx };
}

/** Pixel of a boundary VERTEX (x,y), already in 0-based grid-vertex units as
 * emitted by poOutline.boundaryLoops -- the PO-outline map (board: PAD + x*CELL). */
export function vertexPx(x: number, y: number, f: CellFrame): { x: number; y: number } {
  return { x: f.originX + x * f.cellPx, y: f.originY + y * f.cellPx };
}

/** Bounding-box pixels of a placed PO whose w x h cell footprint has its
 * top-left at 1-indexed local cell (originR, originC). Used both to draw the PO
 * (squadCompositor) and to anchor its muzzle-flash FX (MonitorRenderer), so the
 * flash can never drift off the sprite. */
export function poBoxPx(
  originR: number,
  originC: number,
  w: number,
  h: number,
  f: CellFrame
): { x: number; y: number; w: number; h: number } {
  const { x, y } = cellTopLeftPx(originR, originC, f);
  return { x, y, w: w * f.cellPx, h: h * f.cellPx };
}
