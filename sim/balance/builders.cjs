'use strict';
// sim/balance/builders.cjs -- REQ-0269: loadout builders for ITEM candidates.
//
// A builder takes a board TEMPLATE (content/s4_boards/* shape) plus a candidate
// item def and returns a NEW board with the candidate placed on a legal cell
// (or null if the template admits no legal placement). Legality reuses the
// engine's own rotation math (sim/lib/compile.cjs localCellsOfPO) so we never
// reimplement grid geometry -- we only enumerate anchor cells / rotations and
// test them against the board's BP-cell set and existing occupancy.
//
// Placement modes (the authored s4_boards are near-full, so both are needed):
//   add     -- drop the candidate on free BP cells (baseline = candidate ABSENT).
//   replace -- if no free room, swap out one removable (non-`fixed`, loc:grid) PO
//              and place the candidate in the freed cells (baseline = the ORIGINAL
//              template incl. the displaced PO, i.e. candidate REPLACED). The spec
//              allows "absent/replaced"; add is preferred, replace is the fallback.
//
// Pluggable policy interface: each builder is { name, build(ctx, rng) } where
//   ctx = { board, candidateDef, itemDefsById, uid }  (board is NOT mutated)
//   rng = a sim/lib/rng.cjs stream ( .next()/.range() ). Every stochastic choice
//         goes through it -- no Math.random anywhere (sim invariant).
// build(...) returns { board, note, mode } or null.

const { localCellsOfPO } = require('../lib/compile.cjs');

function keyOf(r, c) { return r + ',' + c; }

function bpCellSet(board) {
  const s = new Set();
  for (const bp of board.bps) for (const off of bp.shape) s.add(keyOf(bp.origin[0] + off[0], bp.origin[1] + off[1]));
  return s;
}

// All grid cells physically covered by existing grid POs (full shapes, via the
// engine's own rotation math -- not just anchors).
function occupiedCells(board, itemDefsById) {
  const s = new Set();
  for (const p of board.pos) {
    if (p.loc !== 'grid' || !p.cell) continue;
    const def = itemDefsById[p.id];
    if (def && Array.isArray(def.shape)) { for (const c of localCellsOfPO(p, def)) s.add(keyOf(c[0], c[1])); }
    else s.add(keyOf(p.cell[0], p.cell[1]));
  }
  return s;
}

// Every legal (cell, rot) placement of candidateDef on board: all shape cells
// must be BP cells and unoccupied. Symmetric rotations de-duplicated by signature.
function legalPlacements(board, candidateDef, itemDefsById) {
  const ROWS = (board.layout && board.layout.ROWS) || 8;
  const COLS = (board.layout && board.layout.COLS) || 8;
  const bpCells = bpCellSet(board);
  const occ = occupiedCells(board, itemDefsById);
  const out = [];
  const seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    for (let r = 1; r <= ROWS; r++) {
      for (let c = 1; c <= COLS; c++) {
        const cells = localCellsOfPO({ cell: [r, c], rot }, candidateDef);
        let ok = true;
        for (const cell of cells) { const k = keyOf(cell[0], cell[1]); if (!bpCells.has(k) || occ.has(k)) { ok = false; break; } }
        if (!ok) continue;
        const sig = cells.map(x => keyOf(x[0], x[1])).sort().join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({ cell: [r, c], rot, cells });
      }
    }
  }
  return out;
}

function chebyAdjacent(a, b) { return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 1; }

// Static coverage heuristic: how many existing grid POs sit Chebyshev-adjacent
// to any candidate cell -- a placement touching more neighbours is "more active"
// (a proxy for buff_adjacent synergy / effect coverage density). Purely static.
function coverageScore(placement, board, itemDefsById) {
  let score = 0;
  for (const p of board.pos) {
    if (p.loc !== 'grid' || !p.cell) continue;
    const def = itemDefsById[p.id];
    const cells = (def && def.shape) ? localCellsOfPO(p, def) : [p.cell];
    let touches = false;
    for (const oc of cells) { for (const cc of placement.cells) { if (chebyAdjacent(oc, cc)) { touches = true; break; } } if (touches) break; }
    if (touches) score++;
  }
  return score;
}

function removePo(board, uid) { const b = JSON.parse(JSON.stringify(board)); b.pos = b.pos.filter(p => p.uid !== uid); return b; }
function withCandidate(base, placement, candidateDef, uid) {
  const b = JSON.parse(JSON.stringify(base));
  b.pos.push({ uid, id: candidateDef.id, loc: 'grid', cell: placement.cell.slice(), rot: placement.rot });
  return b;
}

// All placement options: prefer `add` (free cells); fall back to `replace`
// (remove one removable PO, then place). Each option carries the base board it
// is legal against (the template for add, template-minus-PO for replace).
function placementOptions(board, candidateDef, itemDefsById) {
  const adds = legalPlacements(board, candidateDef, itemDefsById).map(pl => ({ mode: 'add', base: board, placement: pl, removeUid: null, removeId: null }));
  if (adds.length) return adds;
  const reps = [];
  for (const p of board.pos) {
    if (p.loc !== 'grid' || p.fixed) continue;
    const without = removePo(board, p.uid);
    for (const pl of legalPlacements(without, candidateDef, itemDefsById)) reps.push({ mode: 'replace', base: without, placement: pl, removeUid: p.uid, removeId: p.id });
  }
  return reps;
}

function optSort(a, b) {
  return (a.mode === b.mode ? 0 : (a.mode === 'add' ? -1 : 1))
    || (a.placement.rot - b.placement.rot)
    || (a.placement.cell[0] - b.placement.cell[0])
    || (a.placement.cell[1] - b.placement.cell[1])
    || String(a.removeUid).localeCompare(String(b.removeUid));
}
function noteOf(o, candidateDef) {
  const at = '[' + o.placement.cell.join(',') + '] rot ' + o.placement.rot;
  return o.mode === 'add' ? ('add ' + candidateDef.id + ' at ' + at)
    : ('replace ' + o.removeId + '(' + o.removeUid + ') with ' + candidateDef.id + ' at ' + at);
}

// greedy: maximize the static coverage heuristic; ties broken lexicographically
// (add before replace) then by the rng stream -- deterministic given the stream.
const greedy = {
  name: 'greedy',
  build(ctx, rng) {
    const { board, candidateDef, itemDefsById, uid } = ctx;
    const opts = placementOptions(board, candidateDef, itemDefsById);
    if (!opts.length) return null;
    const scored = opts.map(o => ({ o, s: coverageScore(o.placement, o.base, itemDefsById) }));
    let best = -Infinity; for (const x of scored) if (x.s > best) best = x.s;
    const top = scored.filter(x => x.s === best).map(x => x.o).sort(optSort);
    const pick = top[Math.min(top.length - 1, Math.floor(rng.next() * top.length))];
    return { board: withCandidate(pick.base, pick.placement, candidateDef, uid || '__cand_po'), note: noteOf(pick, candidateDef), mode: pick.mode };
  },
};

// random: seeded uniform pick over the legal option set (rejection sampling over
// cells/rotations is subsumed by enumerating legal placements first, which also
// stays robust under the replace fallback). Deterministic given the rng stream.
const random = {
  name: 'random',
  build(ctx, rng) {
    const { board, candidateDef, itemDefsById, uid } = ctx;
    const opts = placementOptions(board, candidateDef, itemDefsById);
    if (!opts.length) return null;
    opts.sort(optSort);
    const pick = opts[Math.min(opts.length - 1, Math.floor(rng.next() * opts.length))];
    return { board: withCandidate(pick.base, pick.placement, candidateDef, uid || '__cand_po'), note: noteOf(pick, candidateDef), mode: pick.mode };
  },
};

module.exports = { greedy, random, BUILDERS: { greedy, random }, legalPlacements, placementOptions, bpCellSet, occupiedCells, coverageScore };
