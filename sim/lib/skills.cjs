'use strict';
// sim/lib/skills.cjs -- REQ-0047 (d): actor wrappers, hit dealing, skill firing (fireSkillRay incl. AOE splash) + effect scheduling.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { applyStatus, weaknessMultiplier, consumeSpikes } = require('./status.cjs');
const { checkHpBelow } = require('./hpbelow.cjs'); // REQ-0121
const { selectEntryCell } = require('./entry.cjs');
const { walkRay, chebyshevDist } = require('./ray.cjs');
const { maskLabel } = require('./replay.cjs');

function effectStreamName(ownerUid, effectIdx) {
  return 'effect/' + ownerUid + '/' + effectIdx;
}

// REQ-0093: bonus_vs_status -- flat additive bonus rolled FRESH per hit
// (mirrors strike's own per-hit n roll; NOT pre-folded into a static
// scalar at compile time like buff_host, since the condition -- target's
// LIVE status bag -- is dynamic across the encounter) when the target
// currently carries any status in a matching bonus's resolved Set.
// Documented interpretation: the bonus is added AFTER weaknessMultiplier
// is applied to the base roll (i.e. the bonus itself is not
// weakness-scaled) -- "add the bonus before the hit is applied" (REQ-0093)
// is read as "before applyDamage", not "before weaknessMultiplier".
function bonusVsStatusAmount(targetBag, bonusList, rng) {
  if (!bonusList || !bonusList.length) return 0;
  let bonus = 0;
  for (const b of bonusList) {
    let matches = false;
    for (const s of b.set) { if (targetBag[s]) { matches = true; break; } }
    if (matches) bonus += rng.range(b.n[0], b.n[1]);
  }
  return bonus;
}

// Actor wrapper: unifies BP occupants (player field) and enemy occupants
// (enemy field) behind one shape so ray-hit / status / HP logic doesn't
// need to branch on kind everywhere. Built once per encounter from the
// compiled squad snapshots (player side) and the encounter's enemy pack
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
      checkHpBelow(bp); // REQ-0121: on_hp_below fires the instant a threshold is crossed
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
      checkHpBelow(en); // REQ-0121
    },
    heal(amount) { en.hp = Math.min(en.hpMax, en.hp + amount); },
  };
}

// REQ-0121: flat incoming-damage reduction (damage_reduction verb, folded
// at battle_start onto the DEFENDER's ref as a resolved scalar --
// ref.damageReduction; see packs.cjs / compile.cjs). Applied per hit /
// per sub-hit to DIRECT hit damage only, AFTER weaknessMultiplier and
// bonus_vs_status, floored at zero. DoT status ticks and Spikes reflect
// are deliberately NOT reduced (vocab provenance note: a hide blunts
// blows, not poison).
function reduceIncoming(amount, actor) {
  const dr = (actor.ref && actor.ref.damageReduction) || 0;
  if (!dr) return amount;
  return Math.max(0, amount - dr);
}

// dealHitOnField: applies a skill's verb(s) to a single occupant actor
// (S3.3). Returns {amount, hpAfter, dstLabel, isDiscovery}.
function dealHitOnField(actor, verbEff, bounceMult, rng, mode, events, attackerBonusVsStatus) {
  if (mode === 'detection') {
    // "a hit IS the find, damage irrelevant" -- no HP change, just discovery.
    return { amount: 0, hpAfter: actor.hp(), dstLabel: maskLabel(actor.ref), isDiscovery: true };
  }
  const verb = verbEff.verb;
  let amount = 0;
  if (verb.t === 'strike') {
    let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
    hitAmt *= weaknessMultiplier(actor.statusBag);
    hitAmt += bonusVsStatusAmount(actor.statusBag, attackerBonusVsStatus, rng); // REQ-0093
    hitAmt = reduceIncoming(hitAmt, actor); // REQ-0121: defender damage_reduction
    actor.applyDamage(hitAmt);
    amount += hitAmt;
  } else if (verb.t === 'multi_strike') {
    // OQ19 LOCKED: each sub-hit is a SEPARATE on_hit event (per-hit status
    // stacking). Each sub-hit independently rolls n and applies bounceMult.
    for (let i = 0; i < verb.hits; i++) {
      let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
      hitAmt *= weaknessMultiplier(actor.statusBag);
      // REQ-0093: bonus_vs_status re-checked + re-rolled per sub-hit,
      // consistent with multi_strike's existing per-sub-hit independence.
      hitAmt += bonusVsStatusAmount(actor.statusBag, attackerBonusVsStatus, rng);
      // REQ-0121: reduction applies per sub-hit (each sub-hit is its own
      // hit event per OQ19) -- the classic flat-reduction-vs-multi-hit
      // tradeoff is intentional.
      hitAmt = reduceIncoming(hitAmt, actor);
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

  // REQ-0078: collect DIRECT (strike/multi_strike, amount>0) hits so the
  // encounter loop can drive reactive OnHit/OnBeenHit procs after the ray
  // resolves. Pure strike damage only (OQ-A: DoT/reflect/0-dmg do NOT count).
  const landedHits = [];

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
        const r = dealHitOnField(a, verbEff, bmult, dmgStream, mode, events, attacker.bonusVsStatus);
        if (r.amount > 0) landedHits.push({ actor: a, amount: r.amount });
        hits.push({ dst: r.dstLabel, amount: r.amount });
      }
      return hits;
    }
    const r = dealHitOnField(occ, verbEff, bmult, dmgStream, mode, events, attacker.bonusVsStatus);
    if (r.amount > 0) landedHits.push({ actor: occ, amount: r.amount });
    return r;
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
        dmgAmount += bonusVsStatusAmount(a.statusBag, attacker.bonusVsStatus, dmgStream); // REQ-0093
        dmgAmount = reduceIncoming(dmgAmount, a); // REQ-0121
        a.applyDamage(dmgAmount);
      } else if (mode !== 'detection' && verbEff.verb.t === 'multi_strike') {
        for (let i = 0; i < verbEff.verb.hits; i++) {
          let hitAmt = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]) * bmult * weaknessMultiplier(a.statusBag);
          hitAmt += bonusVsStatusAmount(a.statusBag, attacker.bonusVsStatus, dmgStream);
          hitAmt = reduceIncoming(hitAmt, a); // REQ-0121
          a.applyDamage(hitAmt);
          dmgAmount += hitAmt;
        }
      }
      if (doStatuses && (verbEff.verb.t === 'apply_status' || verbEff.verb.t === 'add_on_hit_status')) {
        const n = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]);
        applyStatus(a.statusBag, verbEff.verb.status, n);
      }
      if (dmgAmount > 0) landedHits.push({ actor: a, amount: dmgAmount });
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
  result.landedHits = landedHits;
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
// completion via the event-driven loop (S1.1). Mutates troopBps (array of
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

// REQ-0078: apply a reactive verb to a single target actor as a RIDER on a hit
// that already landed (offensive OnHit/OnSquadHit): the owner's attack already
// struck `target`; this augments that same hit. Depth-1 (never re-dispatches);
// caller passes an isolated reactive RNG sub-stream (OQ-C / OQ-D).
function applyReactiveVerbToTarget(verb, ownerActor, target, rng, events, trigTag) {
  let amount = 0;
  if (verb.t === 'strike') {
    amount = rng.range(verb.n[0], verb.n[1]) * weaknessMultiplier(target.statusBag);
    amount = reduceIncoming(amount, target); // REQ-0121
    target.applyDamage(amount);
    events.push({ ev: 'reactive_proc', trigger: trigTag, verb: verb.t, dst: maskLabel(target.ref), amount, hp_after: target.hp() });
  } else if (verb.t === 'multi_strike') {
    for (let i = 0; i < verb.hits; i++) {
      let a = rng.range(verb.n[0], verb.n[1]) * weaknessMultiplier(target.statusBag);
      a = reduceIncoming(a, target); // REQ-0121
      target.applyDamage(a); amount += a;
    }
    events.push({ ev: 'reactive_proc', trigger: trigTag, verb: verb.t, dst: maskLabel(target.ref), amount, hp_after: target.hp() });
  } else if (verb.t === 'apply_status' || verb.t === 'add_on_hit_status') {
    const n = rng.range(verb.n[0], verb.n[1]);
    applyStatus(target.statusBag, verb.status, n);
    events.push({ ev: 'reactive_proc', trigger: trigTag, verb: verb.t, dst: maskLabel(target.ref), status: verb.status, n });
  } else if (verb.t === 'lifesteal') {
    const n = rng.range(verb.n[0], verb.n[1]);
    ownerActor.heal(n);
    events.push({ ev: 'reactive_proc', trigger: trigTag, verb: verb.t, dst: maskLabel(ownerActor.ref), heal: n });
  }
  // other verbs are not supported as reactive riders in Phase 1 (documented).
  return amount;
}

module.exports = {
  effectStreamName,
  makeBPActor,
  makeEnemyActor,
  bonusVsStatusAmount,
  reduceIncoming, // REQ-0121
  dealHitOnField,
  fireSkillRay,
  applyReactiveVerbToTarget,
  scheduleEffect,
  effectModesOf,
  defaultAttackProfileFor,
};
