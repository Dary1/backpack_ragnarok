'use strict';
// sim/lib/skills.cjs -- REQ-0047 (d): actor wrappers, hit dealing, skill firing (fireSkillRay incl. AOE splash) + effect scheduling.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { applyStatus, weaknessMultiplier, consumeSpikes } = require('./status.cjs');
const { selectEntryCell } = require('./entry.cjs');
const { walkRay, chebyshevDist } = require('./ray.cjs');
const { maskLabel } = require('./replay.cjs');

function effectStreamName(ownerUid, effectIdx) {
  return 'effect/' + ownerUid + '/' + effectIdx;
}

// Actor wrapper: unifies BP occupants (player field) and enemy occupants
// (enemy field) behind one shape so ray-hit / status / HP logic doesn't
// need to branch on kind everywhere. Built once per encounter from the
// compiled unit snapshots (player side) and the encounter's enemy pack
// (enemy side).
function makeBPActor(bp) {
  return {
    kind: 'bp', id: bp.id, ref: bp, fieldCells: bp.fieldCells,
    statusBag: bp.statusBag,
    get alive() { return bp.hp > 0; },
    hp() { return bp.hp; },
    hpMax() { return bp.hpMax; },
    applyDamage(amount) {
      bp.hp = Math.max(0, bp.hp - amount);
      if (bp.hp <= 0) bp.alive = false;
    },
    heal(amount) { bp.hp = Math.min(bp.hpMax, bp.hp + amount); },
  };
}
function makeEnemyActor(en) {
  return {
    kind: 'enemy', id: en.id, ref: en, fieldCells: en.fieldCells,
    statusBag: en.statusBag,
    get alive() { return en.hp > 0; },
    hp() { return en.hp; },
    hpMax() { return en.hpMax; },
    applyDamage(amount) {
      en.hp = Math.max(0, en.hp - amount);
      if (en.hp <= 0) en.alive = false;
    },
    heal(amount) { en.hp = Math.min(en.hpMax, en.hp + amount); },
  };
}

// dealHitOnField: applies a skill's verb(s) to a single occupant actor
// (S3.3). Returns {amount, hpAfter, dstLabel, isDiscovery}.
function dealHitOnField(actor, verbEff, bounceMult, rng, mode, events) {
  if (mode === 'detection') {
    // "a hit IS the find, damage irrelevant" -- no HP change, just discovery.
    return { amount: 0, hpAfter: actor.hp(), dstLabel: maskLabel(actor.ref), isDiscovery: true };
  }
  const verb = verbEff.verb;
  let amount = 0;
  if (verb.t === 'strike') {
    let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
    hitAmt *= weaknessMultiplier(actor.statusBag);
    actor.applyDamage(hitAmt);
    amount += hitAmt;
  } else if (verb.t === 'multi_strike') {
    // OQ19 LOCKED: each sub-hit is a SEPARATE on_hit event (per-hit status
    // stacking). Each sub-hit independently rolls n and applies bounceMult.
    for (let i = 0; i < verb.hits; i++) {
      let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
      hitAmt *= weaknessMultiplier(actor.statusBag);
      actor.applyDamage(hitAmt);
      amount += hitAmt;
    }
  }
  if (verb.t === 'apply_status' || verb.t === 'add_on_hit_status') {
    const n = rng.range(verb.n[0], verb.n[1]);
    applyStatus(actor.statusBag, verb.status, n);
    events.push({ ev: 'apply_status', dst: maskLabel(actor.ref), status: verb.status, n });
  }
  // Spikes: consumed per hit when the ACTOR (defender) is hit (OQ9 LOCKED).
  const spikesReflect = consumeSpikes(actor.statusBag);
  if (spikesReflect > 0) {
    events.push({ ev: 'reflect_damage', dst: 'attacker', amount: spikesReflect });
  }
  return { amount, hpAfter: actor.hp(), dstLabel: maskLabel(actor.ref), isDiscovery: false };
}

// fireSkillRay: fires ONE ray for one skill-effect against the opposing
// field. Wraps walkRay with dealHit/splash callbacks bound to the actual
// actor list + RNG streams, and emits entry-cell events (ray_fire).
// attacker: {fieldCells, ownerId} (centroid computed from fieldCells).
// attackProfile: S4.2 schema. verbEff: {trigger,verb}. mode: encounter mode.
// targetActors: live actor list on the OPPOSING field.
// rng: the run's makeRng() instance. streamPrefix: unique per-firing key
// for '.../ray' sub-stream isolation (S4.3: "All ray randomness confined
// to .../ray sub-stream, isolated from damage/timing streams").
function fireSkillRay(opts) {
  const {
    attacker, attackProfile, verbEff, mode, targetActors, targetBounds,
    rng, streamPrefix, events, aoeStatuses,
  } = opts;
  const rayStream = rng.stream(streamPrefix + '/ray');
  const dmgStream = rng.stream(streamPrefix + '/dmg');
  const { edge, entryCell, dir } = selectEntryCell(attacker.fieldCells, attackProfile.edge, rayStream, targetBounds);
  events.push({
    ev: 'ray_fire', src: attacker.ownerId, field: targetBounds.label, entry: entryCell.slice(),
    dir, pen: attackProfile.penetration || 0, aoe: attackProfile.aoe || 0,
  });

  function liveOccupantFn(cell) {
    for (const a of targetActors) {
      if (!a.alive) continue;
      for (const c of a.fieldCells) if (c[0] === cell[0] && c[1] === cell[1]) return a;
    }
    return null;
  }
  function dealHitFn(occ, bmult, opts2) {
    if (opts2 && opts2.allField) {
      const hits = [];
      for (const a of targetActors) {
        if (!a.alive) continue;
        const r = dealHitOnField(a, verbEff, bmult, dmgStream, mode, events);
        hits.push({ dst: r.dstLabel, amount: r.amount });
      }
      return hits;
    }
    return dealHitOnField(occ, verbEff, bmult, dmgStream, mode, events);
  }
  function splashFn(landing, radius, bmult, doStatuses) {
    const hits = [];
    for (const a of targetActors) {
      if (!a.alive) continue;
      const withinRadius = a.fieldCells.some(c => chebyshevDist(c, landing) <= radius);
      if (!withinRadius) continue;
      // "Landing occupant NOT double-hit (primary already applied)" (S3.4)
      const isLandingOccupant = a.fieldCells.some(c => c[0] === landing[0] && c[1] === landing[1]);
      if (isLandingOccupant) continue;
      let dmgAmount = 0;
      if (mode !== 'detection' && verbEff.verb.t === 'strike') {
        dmgAmount = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]) * bmult * weaknessMultiplier(a.statusBag);
        a.applyDamage(dmgAmount);
      } else if (mode !== 'detection' && verbEff.verb.t === 'multi_strike') {
        for (let i = 0; i < verbEff.verb.hits; i++) {
          const hitAmt = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]) * bmult * weaknessMultiplier(a.statusBag);
          a.applyDamage(hitAmt);
          dmgAmount += hitAmt;
        }
      }
      if (doStatuses && (verbEff.verb.t === 'apply_status' || verbEff.verb.t === 'add_on_hit_status')) {
        const n = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]);
        applyStatus(a.statusBag, verbEff.verb.status, n);
      }
      hits.push({ dst: maskLabel(a.ref), amount: dmgAmount });
    }
    return hits;
  }

  const result = walkRay({
    field: { ROWS: targetBounds.ROWS, COLS: targetBounds.COLS },
    entryCell, dir, mode,
    penetration: attackProfile.penetration || 0,
    aoe: attackProfile.aoe || 0,
    aoeStatuses: !!attackProfile.aoe_statuses,
    bounceBudget: attackProfile.bounce_budget || 0,
    dealHitFn, splashFn, liveOccupantFn,
  });
  for (const e of result.events) events.push(e);
  return result;
}

// =====================================================================
// Enemy pack compilation -- footprints on enemy field, HP rolled from
// [lo,hi] def range, skills attached (S4.4).
// =====================================================================
function scheduleEffect(heap, rng, ownerUid, effIdx, effect, encounterStart, cadenceMult, pushEvFn) {
  const s = effect.trigger.s; // [lo,hi] seconds
  const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');
  const interval = stream.range(s[0], s[1]) * cadenceMult;
  const fireAt = encounterStart + interval;
  heap.push({ t: fireAt, seq: heap.nextSeq(), kind: 'skill_fire', ownerUid, effIdx, effect, interval0: s });
}

function effectModesOf(effect, ownerModes) {
  return effect.modes || ownerModes || ['battle'];
}

// =====================================================================
// runEncounter -- drives ONE encounter (pack/trap/door/chest/boss) to
// completion via the event-driven loop (S1.1). Mutates partyBps (array of
// compiled BP objects, HP persists across encounters per S8.2/OQ13) and
// returns { events, result, progressAwarded, rewardEligible }.
//
// encounterDef shape (documented, informal schema -- see sim/README.md):
// {
//   id, type: 'pack'|'trap'|'door'|'chest'|'boss', mode: 'battle'|'detection'|'unlock',
//   enemyPack?: {enemyIds:[...]}    // pack/boss
//   entityDef?: {id,hp,footprint,skills,timeout_secs,modes,masked?}  // trap/door/chest
//   doorStage2?: {...}              // door only: unlock-stage entity def
//   timeout_secs?: number,
//   deadline_secs?: number  // for pack: escalating-pressure soft deadline (no forced win)
// }
// =====================================================================
function defaultAttackProfileFor(po) {
  return { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false, bounce_budget: 3 };
}

// =====================================================================
// Run integration (S8) -- progress accrual, scheduling, shortcuts,
// rewards, wipe/level-down, cooldown.
// =====================================================================

// computeEncounterDeltas: even split of 100% across the generated
// encounter list, EXCLUDING the boss slot -- the boss is "pinned at 100%"
// (S8.2), i.e. clearing it is what brings progress to exactly 100.
// Documented interpretation (spec gives no numbers, S8.1): non-boss
// encounters evenly split the remaining 100% among themselves; the boss
// entry's own delta is whatever closes the gap to 100 exactly.

module.exports = {
  effectStreamName,
  makeBPActor,
  makeEnemyActor,
  dealHitOnField,
  fireSkillRay,
  scheduleEffect,
  effectModesOf,
  defaultAttackProfileFor,
};
