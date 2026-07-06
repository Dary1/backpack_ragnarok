'use strict';
// sim/lib/field.cjs -- REQ-0047 (d): field dimensions + occupancy index helpers.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


const FIELD_ROWS = 18, FIELD_COLS = 26;

function cellKey(cell) { return cell[0] + ',' + cell[1]; }

// Build a live-occupancy index for one field/plane from a list of
// occupants, each {kind:'bp'|'enemy', id, fieldCells:[[r,c],...], alive}.
function buildOccupancyIndex(occupants) {
  const map = new Map();
  for (const occ of occupants) {
    if (!occ.alive) continue;
    for (const cell of occ.fieldCells) map.set(cellKey(cell), occ);
  }
  return map;
}

// =====================================================================
// Replay log helpers (S1.5). Events are plain objects; toJSONL joins
// them as newline-delimited JSON text (one event per line, matching the
// spec's example format exactly).
// =====================================================================

module.exports = {
  FIELD_ROWS,
  cellKey,
  buildOccupancyIndex,
  FIELD_COLS,
};
