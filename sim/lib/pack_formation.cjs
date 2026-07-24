'use strict';
// sim/lib/pack_formation.cjs -- REQ-0298. Pure, dependency-free formation-fill
// inspection for monster_pack/1 content.
//
// THE RULE (ratified 2026-07-24): a monster_pack is INVALID if its formation
// fills < 30% of the enemy placeable area. 30% is a DATA-tunable constant
// (FILL_MIN). GIMIC content is EXEMPT of the rule -- but gimics are a different
// kind and are simply never passed to this module, so there is no per-pack
// exempt flag here (packs.json marks none today; if one ever did, a follow-up
// adds it -- this module deliberately stays a pure area check).
//
// Determinism contract: no clocks, no RNG, no I/O. Given the same packs + enemy
// defs + placeableCells, the output is byte-stable -- the admincontent view (a
// follow-up REQ) consumes inspectPacks(...)'s object verbatim.
//
// A member occupies its ENEMY's footprint [fh, fw] (height x width) anchored at
// its `at` cell; occupied cells = fh*fw. This matches shared/content_validate.cjs
// cellsFor() (anchor is the TOP-LEFT, footprint grows down/right) -- we only need
// the AREA, so we multiply rather than enumerate cells. A member whose enemy has
// no footprint (or a malformed one) defaults to [1,1] = 1 cell, exactly as
// cellsFor() does.

const FILL_MIN = 0.30;

// The placeable region is the field MINUS its 1-cell margin on every side:
// B2:Y17 for the live 26x18 field = 24x16 = 384. DERIVED from the field
// constants, never hardcoded, so a field resize moves the denominator with it.
function placeableCellsFor(fieldRows, fieldCols) {
  return (fieldCols - 2) * (fieldRows - 2);
}

// The AREA one member occupies = its enemy footprint height*width. Missing or
// malformed footprint -> [1,1] (1 cell), matching content_validate.cjs cellsFor().
function memberCells(member, enemyDefsById) {
  const def = enemyDefsById && enemyDefsById[member && member.enemy];
  const fp = def && Array.isArray(def.footprint) ? def.footprint : [1, 1];
  const fh = Number.isInteger(fp[0]) && fp[0] > 0 ? fp[0] : 1;
  const fw = Number.isInteger(fp[1]) && fp[1] > 0 ? fp[1] : 1;
  return fh * fw;
}

// packFill: the per-pack math. occupiedCells = sum of member footprint areas;
// fillFrac = occupiedCells / placeableCells (full precision, never rounded here).
function packFill(packDef, enemyDefsById, placeableCells) {
  const members = Array.isArray(packDef && packDef.members) ? packDef.members : [];
  let occupiedCells = 0;
  for (const m of members) occupiedCells += memberCells(m, enemyDefsById);
  const fillFrac = placeableCells > 0 ? occupiedCells / placeableCells : 0;
  return {
    occupiedCells: occupiedCells,
    placeableCells: placeableCells,
    fillFrac: fillFrac,
    memberCount: members.length,
  };
}

// inspectPacks: run packFill over every pack + a summary. pass iff
// fillFrac >= fillMin. Deterministic; preserves input pack order.
function inspectPacks(packs, enemyDefsById, opts) {
  opts = opts || {};
  const placeableCells = opts.placeableCells;
  const fillMin = opts.fillMin == null ? FILL_MIN : opts.fillMin;
  const out = [];
  const failingIds = [];
  for (const packDef of (packs || [])) {
    const f = packFill(packDef, enemyDefsById, placeableCells);
    const pass = f.fillFrac >= fillMin;
    out.push({
      id: packDef.id,
      memberCount: f.memberCount,
      occupiedCells: f.occupiedCells,
      placeableCells: f.placeableCells,
      fillFrac: f.fillFrac,
      pass: pass,
    });
    if (!pass) failingIds.push(packDef.id);
  }
  return {
    fillMin: fillMin,
    placeableCells: placeableCells,
    packs: out,
    summary: {
      total: out.length,
      failing: failingIds.length,
      failingIds: failingIds,
    },
  };
}

module.exports = { FILL_MIN, placeableCellsFor, packFill, inspectPacks };
