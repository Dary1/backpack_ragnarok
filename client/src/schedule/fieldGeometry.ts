// Shared-field geometry helpers -- REQ-0036 P1-C monitor. The combat sim
// (sim/combat.cjs, docs/combat_spec_draft.md S2/S5) places ray events on
// two independent A1:Z18 planes (26 cols A-Z, 18 rows), one per side
// (`field: 'player' | 'enemy'` on ray_fire). Formation defs
// (content/batches/batch-002-dungeon-pilot/formations.json) place each of
// the 4 unit canvases (8x8 boxes) within that same A1:Z18 space using
// "TopLeft:BottomRight" box strings, e.g. "F2:M9". This module is the
// client-side mirror of sim/combat.cjs's own parseBox/colLetterToIndex --
// re-derived here (not imported) since the client has no access to
// server-only CommonJS modules; kept byte-simple and covered by the
// monitor's own visual smoke test (client/e2e/schedule.spec.ts) rather
// than a unit test file of its own (this is intentionally tiny,
// framework-free arithmetic, same spirit as render/itemCard.ts).
export const FIELD_COLS = 26; // A..Z
export const FIELD_ROWS = 18;

/** "A".."Z" -> 1..26 (1-based, matches sim/combat.cjs's colLetterToIndex). */
export function colLetterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

/** Parses a cell id like "M9" into {col, row} (both 1-based: col 1..26,
 * row 1..18) -- sim/combat.cjs's ray events (ray_step's path entries,
 * ray_fire's entry, ray_bounce's at, ray_hit's dst, ray_aoe's center/
 * hits[].dst) all use this exact id shape. */
export function cellIdToColRow(cellId: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(cellId.trim());
  if (!m) return { col: 1, row: 1 };
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) };
}

/** Converts a cell id to pixel coordinates (top-left of the cell) within
 * a field box of `cellPx` per cell -- callers add half a cell for a
 * center point. */
export function cellIdToXY(cellId: string, cellPx: number): { x: number; y: number } {
  const { col, row } = cellIdToColRow(cellId);
  return { x: (col - 1) * cellPx, y: (row - 1) * cellPx };
}

/** Parses a "TopLeft:BottomRight" box string (e.g. "F2:M9") into pixel
 * bounds within a field box of `cellPx` per cell -- used to draw each
 * unit's formation canvas outline/backdrop on the monitor's player-side
 * grid. Inclusive of both corners (F2:M9 is 8 cols x 8 rows, matching
 * every ratified formation def's 8x8 unit-canvas invariant). */
export function parseBoxToPixelRect(box: string, cellPx: number): { x: number; y: number; w: number; h: number } {
  const [tl, br] = box.split(':');
  const a = cellIdToColRow(tl);
  const b = cellIdToColRow(br);
  return {
    x: (a.col - 1) * cellPx,
    y: (a.row - 1) * cellPx,
    w: (b.col - a.col + 1) * cellPx,
    h: (b.row - a.row + 1) * cellPx,
  };
}
