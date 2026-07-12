'use strict';
// sim/lib/compile.cjs -- REQ-0047 (d): the compile pass (S1): snapshot -> folded static topology + field cells.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { deepCopy } = require('./core.cjs');
const { makeRng } = require('./rng.cjs');
const { parseBox, FORMATIONS } = require('./formation.cjs');
const { freshStatusBag, foldBattleStartStatusVerbs } = require('./status.cjs');

function cellsChebyshevAdjacent(cellsA, cellsB) {
  for (const [ra, ca] of cellsA) {
    for (const [rb, cb] of cellsB) {
      if (Math.max(Math.abs(ra - rb), Math.abs(ca - cb)) <= 1) return true;
    }
  }
  return false;
}

// Compute the absolute field cells for every PO instance in a squad
// snapshot, replicating engine.js's cellsOf/bpCells logic locally (we do
// NOT call engine mutators; we only need the pure shape math, which is
// simple enough to reimplement directly against plain-data state so this
// module has zero risk of ever touching engine's live objects).
function localCellsOfPO(poInst, itemDef) {
  // NOTE: rotation is folded at authoring/placement time in scenario.json
  // (rot field); for the sim's compile pass we only need the PLACED shape,
  // so we replicate rotOffsets' 90-degree-CW-per-step + renormalize logic
  // exactly as engine.js's rotOffsets (mock-src/engine.js function
  // rotOffsets(base,k)) so results match engine.js bit-for-bit.
  let off = itemDef.shape.map(o => [o[0], o[1]]);
  const k = ((poInst.rot % 4) + 4) % 4;
  for (let i = 0; i < k; i++) off = off.map(([r, c]) => [c, -r]);
  const mr = Math.min(...off.map(o => o[0]));
  const mc = Math.min(...off.map(o => o[1]));
  off = off.map(([r, c]) => [r - mr, c - mc]);
  return off.map(([r, c]) => [poInst.cell[0] + r, poInst.cell[1] + c]);
}

function localBpCells(bpDef) {
  return bpDef.shape.map(([dr, dc]) => [bpDef.origin[0] + dr, bpDef.origin[1] + dc]);
}

// compileSquadSnapshot(squadState, itemDefsById, formationId, squadSlot)
// squadState: deep-copied {bps:[...], pos:[...], layout:{ROWS,COLS}} (shape
// of content/live/scenario.json). itemDefsById: map id->PO def (from
// live_items.json entries). formationId: one of FORMATIONS keys.
// squadSlot: 'unit1'..'unit4' (which canvas box this squad occupies).
//
// Returns a compiled snapshot:
// {
//   bps: [{id,name,hpMax,hp,localCells,fieldCells,statusBag}],
//   pos: [{uid,id,def,localCells,fieldCells,effects (buff-folded), bpId}],
// }
function compileSquadSnapshot(squadState, itemDefsById, formationId, squadSlot, siDefsById) {
  const st = deepCopy(squadState);
  const formation = FORMATIONS[formationId];
  if (!formation) throw new Error('compileSquadSnapshot: unknown formation ' + formationId);
  const boxStr = formation.canvases[squadSlot];
  if (!boxStr) throw new Error('compileSquadSnapshot: unknown squad slot ' + squadSlot);
  const box = parseBox(boxStr);
  // Local (1-indexed, 8x8) -> shared field (A1:Z18) offset: field = local +
  // (box.rowMin-1, box.colMin-1), since local origin (1,1) maps to the
  // box's top-left absolute cell (box.rowMin, box.colMin).
  const rOff = box.rowMin - 1, cOff = box.colMin - 1;
  const toField = ([r, c]) => [r + rOff, c + cOff];

  const bps = st.bps.map(bpDef => {
    const localCells = localBpCells(bpDef);
    const fieldCells = localCells.map(toField);
    const hpMax = (typeof bpDef.hpMax === 'number') ? bpDef.hpMax : 100;
    return {
      id: bpDef.id, name: bpDef.name, hpMax, hp: hpMax,
      localCells, fieldCells, statusBag: freshStatusBag(),
      alive: true,
    };
  });
  const bpByLocalCellKey = new Map();
  for (const bp of bps) for (const [r, c] of bp.localCells) bpByLocalCellKey.set(r + ',' + c, bp.id);

  // Build PO instances with local + field cells, and figure out which BP
  // each PO physically sits in (needed for buff_self_per_tag "in this BP").
  const posRaw = st.pos.filter(p => p.loc === 'grid').map(p => {
    const def = itemDefsById[p.id];
    if (!def) throw new Error('compileSquadSnapshot: missing item def for ' + p.id);
    const localCells = localCellsOfPO(p, def);
    const fieldCells = localCells.map(toField);
    const bpId = bpByLocalCellKey.get(localCells[0][0] + ',' + localCells[0][1]) || null;
    // REQ-0063: q (0..1, the per-instance quality roll -- see
    // server/services/dismantle.cjs's rollQuality) defaults to 0 for any
    // instance lacking the field (pre-REQ-0063 saves, or an acquisition
    // path that doesn't mint one) -- q=0 is an exact no-op in
    // applyQualityToEffects below, so an absent field changes nothing.
    const q = (typeof p.q === 'number') ? p.q : 0;
    return { uid: p.uid, id: p.id, def, localCells, fieldCells, bpId, q };
  });

  // REQ-0093: battle_start status_immune / bonus_vs_status fold -- unlike
  // buff_host/buff_self_per_tag/buff_adjacent (trigger:"passive", folded
  // below into a flat strike/multi_strike n-range shift), these use
  // trigger:"battle_start" and shift PER-BP STATE (an immunity Set / a
  // bonus list checked against the LIVE target at hit time) rather than
  // this PO's own damage range -- folded directly onto the owning BP here,
  // once, before any combat event fires.
  for (const bp of bps) {
    const bpEffects = [];
    for (const p of posRaw) {
      if (p.bpId !== bp.id) continue;
      for (const eff of (p.def.effects || [])) bpEffects.push(eff);
    }
    const { immuneSet, bonusVsStatus } = foldBattleStartStatusVerbs(bpEffects);
    bp.statusBag._immune = immuneSet;
    bp.bonusVsStatus = bonusVsStatus;
  }

  // ---- Buff folding (S1.4 OQ2 "fold everything") ----
  // Combination formula (documented interpretation, see sim/README.md):
  // base strike/verb-range for each PO's damage-bearing verbs (those
  // carrying an 'n' [lo,hi] range representing damage) is shifted by an
  // ADDITIVE flat bonus, summed from ALL qualifying buff_host / passive
  // buff_self_per_tag / buff_adjacent contributions, applied ONCE at
  // compile time, in this fixed order: buff_host (self) -> buff_self_per_tag
  // (counts other qualifying-tag POs in the SAME bp) -> buff_adjacent
  // (counts qualifying-tag POs in Chebyshev-adjacent BPs). Each bonus's own
  // [lo,hi] range is itself resolved to a single scalar via the compile-time
  // RNG's "compile/buff" sub-stream (deterministic per run) BEFORE being
  // added, since buffs are folded once and frozen (not re-rolled per
  // application).
  function resolveScalar(range, rng) {
    if (Array.isArray(range)) return rng.range(range[0], range[1]);
    return range;
  }

  // applyQualityToEffects(effects, q): REQ-0063 per-instance quality
  // roll. q in [0,1) narrows a strike/multi_strike verb's [lo,hi] range
  // by raising ONLY the minimum, proportionally toward (never reaching,
  // since q is generated strictly below 1 -- see rollQuality) the
  // midpoint: [lo + q*(hi-lo), hi]. q=0 is an exact no-op (returns the
  // original range unchanged) -- the documented default for any instance
  // with no quality roll on record. Mirrors applyFlatBonusToEffects's
  // shape/verb allowlist/immutability discipline exactly; the two passes
  // are independently composable and deliberately ordered quality-first
  // (this instance's OWN performance envelope is narrowed before
  // combat-time buffs from other placed POs/SIs shift it by a flat
  // amount) -- see foldBuffsForPO below, which applies this to the raw
  // def effects before flat-bonus folding begins.
  function applyQualityToEffects(effects, q) {
    if (!q) return effects;
    return effects.map(eff => {
      const e = deepCopy(eff);
      if (e.verb && (e.verb.t === 'strike' || e.verb.t === 'multi_strike') && Array.isArray(e.verb.n)) {
        const lo = e.verb.n[0], hi = e.verb.n[1];
        e.verb.n = [lo + q * (hi - lo), hi];
      }
      return e;
    });
  }

  function foldBuffsForPO(poEntry, rng) {
    const effects = applyQualityToEffects(deepCopy(poEntry.def.effects || []), poEntry.q);
    let flatBonus = 0;
    // buff_host: passive, self-only, stat must be 'damage' (OQ7 LOCKED).
    for (const eff of effects) {
      if (eff.trigger && eff.trigger.t === 'passive' && eff.verb && eff.verb.t === 'buff_host' && eff.verb.stat === 'damage') {
        flatBonus += resolveScalar(eff.verb.n, rng.stream('compile/buff/' + poEntry.uid));
      }
    }
    // buff_self_per_tag: passive; sums contribution per OTHER qualifying-tag
    // PO in the SAME bp.
    for (const eff of effects) {
      if (eff.trigger && eff.trigger.t === 'passive' && eff.verb && eff.verb.t === 'buff_self_per_tag' && eff.verb.stat === 'damage') {
        const tag = eff.verb.tag;
        const perTag = resolveScalar(eff.verb.n, rng.stream('compile/buff/' + poEntry.uid));
        let count = 0;
        for (const other of posRaw) {
          if (other.uid === poEntry.uid) continue;
          if (other.bpId !== poEntry.bpId) continue;
          if ((other.def.tags || []).includes(tag)) count++;
        }
        flatBonus += perTag * count;
      }
    }
    return { effects, flatBonus };
  }

  function applyFlatBonusToEffects(effects, flatBonus) {
    if (flatBonus === 0) return effects;
    return effects.map(eff => {
      const e = deepCopy(eff);
      if (e.verb && (e.verb.t === 'strike' || e.verb.t === 'multi_strike') && Array.isArray(e.verb.n)) {
        e.verb.n = [e.verb.n[0] + flatBonus, e.verb.n[1] + flatBonus];
      }
      return e;
    });
  }

  // Pass 1: fold buff_host + buff_self_per_tag (both are self/same-bp scoped,
  // no cross-PO ordering dependency).
  const rngForCompile = makeRng('compile-placeholder'); // caller overrides via foldWithRng below
  const folded = posRaw.map(p => {
    const { effects, flatBonus } = foldBuffsForPO(p, rngForCompile);
    return { ...p, _effects: effects, _flatBonus: flatBonus };
  });

  // Pass 2: buff_adjacent -- sums contribution from qualifying-tag POs in
  // Chebyshev-ADJACENT bps (on the local grid, pre-formation-offset, since
  // adjacency is a placement-local concept).
  for (const p of folded) {
    let adjBonus = 0;
    for (const eff of p._effects) {
      if (eff.trigger && eff.trigger.t === 'adjacent' && eff.verb && eff.verb.t === 'buff_adjacent' && eff.verb.stat === 'damage') {
        const tag = eff.verb.tag;
        const perTag = resolveScalar(eff.verb.n, rngForCompile.stream('compile/buff/' + p.uid));
        for (const other of folded) {
          if (other.uid === p.uid) continue;
          if (!(other.def.tags || []).includes(tag)) continue;
          const pBp = bps.find(b => b.id === p.bpId);
          const oBp = bps.find(b => b.id === other.bpId);
          if (!pBp || !oBp || pBp.id === oBp.id) continue;
          if (cellsChebyshevAdjacent(pBp.localCells, oBp.localCells)) adjBonus += perTag;
        }
      }
    }
    p._flatBonus += adjBonus;
  }

  const pos = folded.map(p => ({
    uid: p.uid, id: p.id, def: p.def, localCells: p.localCells, fieldCells: p.fieldCells,
    bpId: p.bpId, effects: applyFlatBonusToEffects(p._effects, p._flatBonus),
  }));

  // REQ-0095: compile socketed items (SIs) SEATED IN A PO ({po,si} host) so OnPOHit
  // can fire when the host PO lands a hit. 'inv' (unseated) and 'bond' (assembly) hosts
  // have no {po,si} host PO here and are skipped (bond resolution is a follow-up).
  const sis = (st.sis || []).map(si => {
    const host = si.host;
    const hostPoUid = (host && typeof host === 'object' && host.po) ? host.po : null;
    const def = siDefsById && siDefsById[si.id];
    return { uid: si.uid, id: si.id, hostPoUid, effects: (def && def.effects) ? deepCopy(def.effects) : [] };
  }).filter(x => x.hostPoUid && x.effects.length);
  return { bps, pos, sis, formationId, squadSlot, box };
}

// =====================================================================
// Entry-cell selection (S4.3, ruling 4) -- deterministic + bounded jitter.
// =====================================================================

module.exports = {
  cellsChebyshevAdjacent,
  localCellsOfPO,
  localBpCells,
  compileSquadSnapshot,
};
