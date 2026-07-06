'use strict';
// sim/lib/entry.cjs -- REQ-0047 (d): entry-cell selection (S4): centroid round-half-up + edge projection/jitter.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES } = require('./core.cjs');
const { EDGE_DIRS } = require('./geometry.cjs');

function centroidRoundHalfUp(cells) {
  const rSum = cells.reduce((a, c) => a + c[0], 0);
  const cSum = cells.reduce((a, c) => a + c[1], 0);
  const rAvg = rSum / cells.length, cAvg = cSum / cells.length;
  // round-half-up (not banker's rounding): floor(x+0.5)
  return [Math.floor(rAvg + 0.5), Math.floor(cAvg + 0.5)];
}

// selectEntryCell(attackerFieldCells, edges, rngRayStream, oppFieldBounds)
// edges: attack_profile.edge list (e.g. ['top'] or ['left','right']).
// oppFieldBounds: {ROWS,COLS} of the shared field (A1:Z18 => rows 1-18,
// cols 1-26) that the ray will be fired ONTO (the opposing plane).
// Returns { edge, entryCell:[r,c], dir }.
function selectEntryCell(attackerFieldCells, edges, rayStream, oppFieldBounds) {
  const [rowc, colc] = centroidRoundHalfUp(attackerFieldCells);
  let edge;
  if (edges.length > 1) {
    const u0 = rayStream.next();
    const idx = Math.floor(u0 * edges.length);
    edge = edges[Math.min(idx, edges.length - 1)];
  } else {
    edge = edges[0];
  }
  const J = TUNABLES.ENTRY_JITTER_HALF_WIDTH;
  const ROWS = oppFieldBounds.ROWS, COLS = oppFieldBounds.COLS;
  let base, edgeMin, edgeMax, fixedCoord, isRowEdge;
  if (edge === 'top' || edge === 'bottom') {
    base = colc; edgeMin = 1; edgeMax = COLS; isRowEdge = false;
    fixedCoord = (edge === 'top') ? 1 : ROWS;
  } else {
    base = rowc; edgeMin = 1; edgeMax = ROWS; isRowEdge = true;
    fixedCoord = (edge === 'left') ? 1 : COLS;
  }
  const u1 = rayStream.next();
  const offset = Math.round((u1 * 2 - 1) * J);
  const entryCoord = Math.min(edgeMax, Math.max(edgeMin, base + offset));
  const entryCell = isRowEdge ? [entryCoord, fixedCoord] : [fixedCoord, entryCoord];
  // fixed diagonal dir per edge (S2.2); if the edge has >1 possible dir
  // (top/bottom), pick via the SAME u0 draw's fractional structure is not
  // specified separately in the spec for dir-choice on multi-dir edges --
  // the spec only describes edge-choice via u0 when attack_profile.edge
  // lists >1 EDGE. For top/bottom's inherent 2-direction fan (S2.2: "top
  // edge -> down-left/down-right"), we deterministically pick by the ray
  // stream's NEXT draw (documented interpretation, see sim/README.md).
  let dir;
  const dirs = EDGE_DIRS[edge];
  if (dirs.length > 1) {
    const u2 = rayStream.next();
    dir = dirs[Math.floor(u2 * dirs.length) % dirs.length];
  } else {
    dir = dirs[0];
  }
  return { edge, entryCell, dir };
}

// =====================================================================
// Ray walk (S2.2/S3, verbatim pseudocode).
// field: {ROWS,COLS, occupants: Map(cellKey -> occupant)} where occupant
// is {kind:'bp'|'enemy', ref, isDiscoveryTarget?, alive}.
// mode: 'battle' | 'detection' | 'unlock'.
// Returns { events: [...], hits: [...] } and mutates HP/discovery state via
// the provided callback functions (dealHitFn, splashFn) so the caller
// (encounter runner) controls actual HP application + logging uniformly.
// =====================================================================

module.exports = {
  centroidRoundHalfUp,
  selectEntryCell,
};
