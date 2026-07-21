'use strict';
// sim/lib/geometry.cjs -- REQ-0047 (d): ray-geometry primitives (S2): dir vectors, reflection, stepping, bounds.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


// Diagonal direction vectors (S2.2/S3): (drow,dcol) terms.
// down-right=(+1,+1)  down-left=(+1,-1)  up-right=(-1,+1)  up-left=(-1,-1)
// (rehomed from heap.cjs by REQ-0256 -- REQ-0047's file split left this header
// behind in the heap module; the heap retired, the vectors live here.)
const DIR_VEC = {
  'DR': [1, 1], 'DL': [1, -1], 'UR': [-1, 1], 'UL': [-1, -1],
};
// Edge -> its fixed diagonal direction(s) per S2.2:
// "top edge -> down-left/down-right; left edge -> down-right; right edge ->
// down-left; bottom edge -> up-right/up-left"
const EDGE_DIRS = {
  top: ['DL', 'DR'],
  left: ['DR'],
  right: ['DL'],
  bottom: ['UR', 'UL'],
};

// reflect(dir, corner-aware): flip drow sign if a horizontal boundary (row
// 1 or ROWS) was crossed, flip dcol sign if a vertical boundary (col 1 or
// COLS) was crossed. A ray can cross both simultaneously at a corner --
// handle by flipping whichever component(s) actually went out of bounds.
function reflectDir(dirName, hitRow, hitCol, ROWS, COLS) {
  let [dr, dc] = DIR_VEC[dirName];
  const hitRowBound = (hitRow < 1 || hitRow > ROWS);
  const hitColBound = (hitCol < 1 || hitCol > COLS);
  if (hitRowBound) dr = -dr;
  if (hitColBound) dc = -dc;
  // find the direction name matching the new (dr,dc)
  for (const name of Object.keys(DIR_VEC)) {
    const v = DIR_VEC[name];
    if (v[0] === dr && v[1] === dc) return name;
  }
  // Should never happen (only 4 diagonal directions exist), but fail safe.
  return dirName;
}

function stepCell(cell, dirName) {
  const [dr, dc] = DIR_VEC[dirName];
  return [cell[0] + dr, cell[1] + dc];
}

function outside(cell, ROWS, COLS) {
  return cell[0] < 1 || cell[0] > ROWS || cell[1] < 1 || cell[1] > COLS;
}

// bounce mult table (S3 pseudocode): 1.0(b<=2) / 1.5(b=3) / 2.0(b=4) / 2.5(b=5)
function mult(b) {
  if (b <= 2) return 1.0;
  if (b === 3) return 1.5;
  if (b === 4) return 2.0;
  return 2.5; // b>=5
}

// =====================================================================
// Box parser for formation defs: "J2:Q9" -> {colMin,colMax,rowMin,rowMax}
// Columns A=1..Z=26.
// =====================================================================

module.exports = {
  DIR_VEC,
  EDGE_DIRS,
  reflectDir,
  stepCell,
  outside,
  mult,
};
