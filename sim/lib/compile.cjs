'use strict';
// sim/lib/compile.cjs -- REQ-0047 (d): the compile pass (S1): snapshot -> folded static topology + field cells.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { deepCopy, TUNABLES } = require('./core.cjs');
const { makeRng } = require('./rng.cjs');
const { parseBox, FORMATIONS } = require('./formation.cjs');
const { freshStatusBag, foldBattleStartStatusVerbs } = require('./status.cjs');
const { IBattleInstance } = require('./battle.cjs'); // REQ-0256 s8
const { defaultAttackProfileFor } = require('./skills.cjs'); // REQ-0256 s8.4: PO attack-profile precedence

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
function compileSquadSnapshot(squadState, itemDefsById, formationId, squadSlot, siDefsById, unitDefsById, connShapes) {
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

  // ---- REQ-0048: static link graph (beam first-hit scan; mirrors
  // engine.js traceBeams on LOCAL canvas coords) + per-BP link cond flags.
  // Links are WITHIN a unit's canvas (BP<->BP). Determinism-safe: this only
  // affects replay when a pulse fires or a buff_linked resonance exists.
  // REQ-0170: the shape-driven walker, kept in LOCKSTEP with engine.js's
  // traceBeams() (same occluder set, same range/pierce/offset semantics, same
  // board-absolute dirs). A BP's rays come from its Unit's def
  // (bp.unit.id -> unit/1 -> connection_shape -> vocab.connection_shapes), so the
  // sim and the board can never disagree about who is linked to whom. With no unit
  // registry injected, no links form -- which is exactly how every pre-REQ-0170
  // fixture behaves, and why goldens without units stay byte-identical.
  const LINK_DIRS = { 0: [-1, 0], 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [1, 0], 5: [1, -1], 6: [0, -1], 7: [-1, -1] };
  const LROWS = (squadState.layout && squadState.layout.ROWS) || 8;
  const LCOLS = (squadState.layout && squadState.layout.COLS) || 8;
  const UNIT_DEFS = unitDefsById || {};
  const CONN_SHAPES = connShapes || {};
  const shapeOfBp = (bpDef) => {
    const u = bpDef && bpDef.unit;
    if (!u || !u.id) return null;
    const def = UNIT_DEFS[u.id];
    if (!def || !def.connection_shape) return null;
    return CONN_SHAPES[def.connection_shape] || null;
  };
  const unitCellOf = (bpDef) => [bpDef.origin[0] + bpDef.unit.off[0], bpDef.origin[1] + bpDef.unit.off[1]];
  const unitKeyToBp = new Map();
  for (const bpDef of st.bps) { if (!bpDef.unit) continue; const lc0 = unitCellOf(bpDef); unitKeyToBp.set(lc0[0] + ',' + lc0[1], bpDef.id); }
  const linkEdges = [];
  for (const bpDef of st.bps) {
    const shp = shapeOfBp(bpDef);
    if (!shp || shp.kind === 'none') continue;
    if (shp.kind === 'offset') {
      const [ur, uc] = unitCellOf(bpDef);
      for (const [dr, dc] of (shp.offsets || [])) {
        const r = ur + dr, c = uc + dc;
        if (r < 1 || r > LROWS || c < 1 || c > LCOLS) continue;
        const hit = unitKeyToBp.get(r + ',' + c);
        if (hit && hit !== bpDef.id) linkEdges.push({ from: bpDef.id, to: hit, dir: null, mutual: false });
      }
      continue;
    }
    const range = (shp.range === 0 || shp.range == null) ? Infinity : shp.range;
    const pierce = !!shp.pierce;
    for (const d of (shp.dirs || [])) {
      const start = unitCellOf(bpDef); let r = start[0], c = start[1];
      for (let step = 1; step <= range; step++) {
        r += LINK_DIRS[d][0]; c += LINK_DIRS[d][1];
        if (r < 1 || r > LROWS || c < 1 || c > LCOLS) break;
        const hit = unitKeyToBp.get(r + ',' + c);
        if (hit && hit !== bpDef.id) { linkEdges.push({ from: bpDef.id, to: hit, dir: d, mutual: false }); if (!pierce) break; }
      }
    }
  }
  for (const e of linkEdges) e.mutual = linkEdges.some(o => o.from === e.to && o.to === e.from);
  for (const bp of bps) {
    bp.linkOut = linkEdges.filter(e => e.from === bp.id).map(e => ({ to: e.to, dir: e.dir, mutual: e.mutual }));
    bp.linkFlags = {
      linked_in: linkEdges.some(e => e.to === bp.id),
      linked_out: bp.linkOut.length > 0,
      mutual: linkEdges.some(e => e.mutual && (e.from === bp.id || e.to === bp.id)),
    };
  }

  // REQ-0200: attach the unit def's `charge` block (if any) so runEncounter can build
  // a charge manager keyed on this BP. undefined for ALL current content (no live unit
  // carries a charge block, and callers with no unit registry resolve UNIT_DEFS = {})
  // -> no new property is set -> byte-identical goldens.
  const rawBpById = new Map(st.bps.map(b => [b.id, b]));
  for (const bp of bps) {
    const bpDef = rawBpById.get(bp.id);
    const u = bpDef && bpDef.unit;
    const def = u && u.id ? UNIT_DEFS[u.id] : null;
    if (def && def.charge) { bp.charge = def.charge; bp.unitId = u.id; }
    // REQ-0256 s8.4 slot category 3: the Unit's OWN effects (UNIT_DEFS[bp.unitId]).
    // No live unit def carries an `effects` array today (charge blocks are the
    // charge manager's, not cooldownSkills'), so this is structurally supported
    // but empty on all current content -- same guarded-attach pattern as charge.
    if (def && Array.isArray(def.effects) && def.effects.length) { bp.unitEffects = deepCopy(def.effects); bp.unitId = u.id; }
  }

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
    // REQ-0121: buff_self at battle_start -- permanent fold onto this PO's
    // OWN damage verbs (same posture as buff_host, but self-targeted; the
    // on_hp_below-triggered form is dynamic and handled at encounter time
    // by hpbelow.cjs watchers, never here).
    for (const eff of effects) {
      if (eff.trigger && eff.trigger.t === 'battle_start' && eff.verb && eff.verb.t === 'buff_self' && eff.verb.stat === 'damage') {
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

  // REQ-0121: battle_start damage_reduction from a BP's placed POs folds
  // onto the OWNING BP as a resolved flat scalar (bp.damageReduction) --
  // reduces direct-hit damage that BP takes (chokepoint: skills.cjs
  // reduceIncoming). Resolved via the same compile-time RNG pattern the
  // buff folds use; per-BP named stream, independent of existing streams.
  for (const bp of bps) {
    let dr = 0;
    for (const p of folded) {
      if (p.bpId !== bp.id) continue;
      for (const eff of p._effects) {
        if (eff.trigger && eff.trigger.t === 'battle_start' && eff.verb && eff.verb.t === 'damage_reduction') {
          dr += resolveScalar(eff.verb.n, rngForCompile.stream('compile/dr/' + bp.id));
        }
      }
    }
    bp.damageReduction = dr;
  }

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

  // Pass 3 (REQ-0048): buff_linked resonance -- folds like buff_adjacent but
  // along the static link edges (direction per verb.dir: out|in|mutual).
  // Mutual pairs multiply the contribution by MUTUAL_RESONANCE_MULT. Scoped
  // to the hosting PO (more qualifying-tag POs in linked BPs => stronger).
  for (const p of folded) {
    let resBonus = 0;
    for (const eff of p._effects) {
      if (!(eff.trigger && eff.trigger.t === 'passive' && eff.verb && eff.verb.t === 'buff_linked' && eff.verb.stat === 'damage')) continue;
      const tag = eff.verb.tag;
      const dir = eff.verb.dir || 'out';
      const perTag = resolveScalar(eff.verb.n, rngForCompile.stream('compile/buff/' + p.uid));
      const linkedBps = new Map();
      for (const e of linkEdges) {
        if (dir === 'out' && e.from === p.bpId) linkedBps.set(e.to, e.mutual);
        else if (dir === 'in' && e.to === p.bpId) linkedBps.set(e.from, e.mutual);
        else if (dir === 'mutual' && e.mutual && (e.from === p.bpId || e.to === p.bpId)) linkedBps.set(e.from === p.bpId ? e.to : e.from, true);
      }
      for (const [otherBp, mutualFlag] of linkedBps) {
        let count = 0;
        for (const other of folded) {
          if (other.uid === p.uid) continue;
          if (other.bpId !== otherBp) continue;
          if ((other.def.tags || []).includes(tag)) count++;
        }
        let contrib = perTag * count;
        if (mutualFlag) contrib *= TUNABLES.MUTUAL_RESONANCE_MULT;
        resBonus += contrib;
      }
    }
    p._flatBonus += resBonus;
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
  // REQ-0256 s8.2: +instances, one IBattleInstance per BP, built AFTER all
  // folding so slots see final, buff-folded effects. ADDITIVE, not a
  // replacement: bps/pos/sis stay as the compatibility surface (~40 readers);
  // a follow-up REQ deletes them once every consumer reads instances.
  return { bps, pos, sis, formationId, squadSlot, box, linkEdges, instances: buildInstances(bps, pos, sis, squadSlot) };
}

// =====================================================================
// Entry-cell selection (S4.3, ruling 4) -- deterministic + bounded jitter.
// =====================================================================

// =====================================================================
// REQ-0256 s8.2-8.4: the flattening. One IBattleInstance per BP whose
// cooldownSkills is the FLAT TIMED-FIRE map fusing PO + SI + Unit
// every_secs effects. Slot order (THE determinism contract, s10.1 level 3):
//   1. the BP's POs by ASCENDING po.uid (string compare), each PO's effects
//      in def array order;
//   2. the SIs seated in those POs by ASCENDING si.uid, effects in def order;
//   3. the Unit's OWN effects in def order (bp.unitEffects; none live today).
// Ascending uid, NOT posRaw array order: array order is scenario.json
// authoring incident; uid is minted per instance and save-stable, so the
// slot map reproduces from DATA, not file layout (s8.4 -- a deliberate,
// small behaviour choice). Only trigger.t === 'every_secs' effects get a
// slot -- cooldownSkills is the TIMED-FIRE map, not "all effects"; reactive
// triggers keep their existing dispatch paths (s8.4).
// =====================================================================
function buildInstances(bps, pos, sis, defaultSquadSlot) {
  // s10.1 level 2: player instances in (squadSlot asc, then BP id asc) order.
  const sorted = bps.slice().sort((a, b) => {
    const sa = a.squadSlot != null ? String(a.squadSlot) : (defaultSquadSlot != null ? String(defaultSquadSlot) : '');
    const sb = b.squadSlot != null ? String(b.squadSlot) : (defaultSquadSlot != null ? String(defaultSquadSlot) : '');
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.map(bp => buildBpInstance(bp, pos, sis, defaultSquadSlot));
}

function buildBpInstance(bp, pos, sis, defaultSquadSlot) {
  // bp ids can repeat across squads (runDungeon flatMaps 4 squads), so a PO
  // belongs to this BP by (bpId AND squadSlot); plain bpId is the fallback for
  // direct runEncounter callers that never tagged squadSlot (same rule as the
  // REQ-0121 hp-below owner resolution).
  const myPos = pos
    .filter(p => p.bpId === bp.id && (p.squadSlot == null || bp.squadSlot == null || p.squadSlot === bp.squadSlot))
    .slice().sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  const cooldownSkills = new Map();
  let slot = 0;
  const addSlot = (ownerUid, ownerId, effIdx, eff, attackProfile, modes) => {
    cooldownSkills.set(slot++, {
      // IBattleInstanceSkill: the same 4 fields goldens.cjs builds for monster
      // skills (s8.4). remainingTicks is rolled at battle start (s8.5);
      // Infinity marks not-yet-scheduled.
      skill: { trigger: eff.trigger, verb: eff.verb, attack_profile: attackProfile, modes },
      remainingTicks: Infinity,
      ownerUid, ownerId, effIdx, effect: eff, attackProfile, modes,
    });
  };
  for (const po of myPos) {
    (po.effects || []).forEach((eff, idx) => {
      if (eff.trigger && eff.trigger.t === 'every_secs') {
        // attack-profile precedence preserved EXACTLY (load-bearing for every
        // live item): eff > po.def > default (s8.4).
        addSlot(po.uid, po.id, idx, eff, eff.attack_profile || po.def.attack_profile || defaultAttackProfileFor(po), po.def.modes || ['battle']);
      }
    });
  }
  const myPoUids = new Set(myPos.map(p => p.uid));
  const mySis = (sis || [])
    .filter(x => myPoUids.has(x.hostPoUid))
    .slice().sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  for (const si of mySis) {
    (si.effects || []).forEach((eff, idx) => {
      if (eff.trigger && eff.trigger.t === 'every_secs') {
        addSlot(si.uid, si.id, idx, eff, eff.attack_profile || defaultAttackProfileFor({}), eff.modes || ['battle']);
      }
    });
  }
  (bp.unitEffects || []).forEach((eff, idx) => {
    if (eff.trigger && eff.trigger.t === 'every_secs') {
      addSlot(bp.id + '#unit', bp.id, idx, eff, eff.attack_profile || defaultAttackProfileFor({}), eff.modes || ['battle']);
    }
  });
  return new IBattleInstance({
    id: bp.id, kind: 'bp',
    squadSlot: bp.squadSlot != null ? bp.squadSlot : (defaultSquadSlot != null ? defaultSquadSlot : null),
    fieldCells: bp.fieldCells, hp: bp.hp, hpMax: bp.hpMax, statusBag: bp.statusBag,
    cooldownSkills,
    // Heap-model parity: player skill fires never checked BP aliveness -- a BP's
    // POs keep firing until the whole troop wipes (the loop's termination check).
    aliveFn: () => true,
  });
}

// REQ-0256 s8.4: a monster (or "?" entity) instance, built the same way from
// e.raw.skills in def array order (sIdx = the effIdx encounter.cjs:531 used).
// Player and enemy differ only in provenance -- "same interface, different
// provenance". That is the flattening.
function buildEnemyInstance(raw, actor) {
  const cooldownSkills = new Map();
  let slot = 0;
  (raw.skills || []).forEach((skill, sIdx) => {
    if (skill.trigger && skill.trigger.t === 'every_secs') {
      cooldownSkills.set(slot++, {
        skill: { trigger: skill.trigger, verb: skill.verb, attack_profile: skill.attack_profile, modes: skill.modes },
        remainingTicks: Infinity,
        ownerUid: raw.ownerId, ownerId: raw.defId || raw.id, effIdx: sIdx, effect: skill,
        modes: skill.modes || ['battle'],
      });
    }
  });
  const inst = new IBattleInstance({
    id: raw.ownerId, kind: 'enemy', fieldCells: raw.fieldCells, hp: raw.hp, hpMax: raw.hpMax,
    statusBag: raw.statusBag, cooldownSkills,
    aliveFn: () => !!raw.alive, // enemies stop ticking the tick they die (heap parity: dead enemies never rescheduled)
    raw, actor,
  });
  return inst;
}

module.exports = {
  cellsChebyshevAdjacent,
  localCellsOfPO,
  localBpCells,
  compileSquadSnapshot,
  buildInstances, // REQ-0256
  buildEnemyInstance, // REQ-0256
};
