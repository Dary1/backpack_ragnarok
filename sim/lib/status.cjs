'use strict';
// sim/lib/status.cjs -- REQ-0047 (d): status system: buffs/debuffs, stacking, ticking, spikes.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES } = require('./core.cjs');

const STATUS_KIND = {
  Burn: 'dot', Poison: 'dot', Chill: 'cadence_slow', Regen: 'hot',
  Spikes: 'onhit_reflect', Stun: 'suspend', Weakness: 'dmg_reduce', Haste: 'cadence_fast',
};
const DEBUFF_STATUSES = new Set(['Burn', 'Poison', 'Chill', 'Weakness', 'Stun']);
const BUFF_STATUSES = new Set(['Regen', 'Spikes', 'Haste']);

// A "statusBag" lives on any actor (BP instance or enemy instance):
// { Burn:{stacks,...}, Poison:{...}, Chill:{stacks}, Regen:{stacks},
//   Spikes:{stacks}, Stun:{remain}, Weakness:{stacks,remain}, Haste:{stacks,remain} }
function freshStatusBag() { return {}; }

// =====================================================================
// REQ-0093: status_kind resolution -- the 9-keyword closed vocab
// (content/vocab.json "status_kinds") exposing BOTH existing engine
// classification axes (polarity: buff/debuff, 2 buckets; mechanical:
// STATUS_KIND's 7 buckets) to status_immune/bonus_vs_status content, with
// zero new classification data anywhere (reuse-only, per this REQ's design
// doc, docs/REQ/built/REQ-0093-status-kind-targeting.md).
// =====================================================================
const STATUS_KINDS = ['buff', 'debuff', 'dot', 'hot', 'cadence_slow', 'cadence_fast', 'onhit_reflect', 'suspend', 'dmg_reduce'];

function resolveStatusKind(keyword) {
  if (keyword === 'debuff') return new Set(DEBUFF_STATUSES);
  if (keyword === 'buff') return new Set(BUFF_STATUSES);
  return new Set(Object.keys(STATUS_KIND).filter(s => STATUS_KIND[s] === keyword));
}

// resolveVerbStatusSet: a status_immune/bonus_vs_status verb object carries
// EXACTLY ONE of `status` (literal name) XOR `status_kind` (9-value
// keyword) -- resolves either form to a concrete Set of status names.
function resolveVerbStatusSet(verb) {
  if (verb.status_kind) return resolveStatusKind(verb.status_kind);
  return new Set([verb.status]);
}

// foldBattleStartStatusVerbs: scans an effects/skills list (PO effects or
// EnemySkill skills -- both are {trigger,verb}-shaped) for battle_start
// status_immune / bonus_vs_status entries and folds them into one
// {immuneSet, bonusVsStatus} result. Shared by compile.cjs (per-BP, across
// that BP's placed POs) and packs.cjs/encounter.cjs (per-enemy/entity,
// across its own skills).
// REQ-0121: additionally collects the two battle_start-folded stat verbs
// added by that REQ, as UNRESOLVED [lo,hi] ranges (each caller resolves
// scalars with its own compile-time RNG stream, mirroring how buff folds
// already resolve per caller):
//   - damageReductionRanges: battle_start damage_reduction n-ranges
//     (folded onto the DEFENDER as ref.damageReduction).
//   - buffSelfRanges: battle_start buff_self (stat:'damage') n-ranges
//     (folded onto the owner's OWN strike/multi_strike ranges).
// on_hp_below-triggered buff_self is NOT folded here -- it is dynamic and
// handled by hpbelow.cjs watchers at encounter time.
function foldBattleStartStatusVerbs(effects) {
  const immuneSet = new Set();
  const bonusVsStatus = [];
  const damageReductionRanges = [];
  const buffSelfRanges = [];
  const selfStatuses = []; // REQ-0299: grant_self_status (Spikes/Regen/Haste on self)
  for (const eff of (effects || [])) {
    if (!eff || !eff.trigger || eff.trigger.t !== 'battle_start' || !eff.verb) continue;
    if (eff.verb.t === 'status_immune') {
      for (const s of resolveVerbStatusSet(eff.verb)) immuneSet.add(s);
    } else if (eff.verb.t === 'bonus_vs_status') {
      bonusVsStatus.push({ set: resolveVerbStatusSet(eff.verb), n: eff.verb.n });
    } else if (eff.verb.t === 'damage_reduction') { // REQ-0121
      damageReductionRanges.push(eff.verb.n);
    } else if (eff.verb.t === 'buff_self' && eff.verb.stat === 'damage') { // REQ-0121
      buffSelfRanges.push(eff.verb.n);
    } else if (eff.verb.t === 'grant_self_status') { // REQ-0299
      selfStatuses.push({ status: eff.verb.status, n: eff.verb.n });
    }
  }
  return { immuneSet, bonusVsStatus, damageReductionRanges, buffSelfRanges, selfStatuses };
}

function applyStatus(bag, name, n, ampMult) {
  // REQ-0093: flat immunity fold (status_immune, battle_start) -- checked
  // here, once, at the single chokepoint every apply_status/add_on_hit_status
  // call already routes through (direct hits, splash, reactive riders,
  // amp_status), rather than re-checking at each call site individually.
  if (bag._immune && bag._immune.has(name)) return;
  const magnitude = (ampMult && ampMult > 0) ? n * ampMult : n;
  if (name === 'Stun') {
    // "no magnitude stack; refresh duration = n s"
    bag.Stun = bag.Stun || {};
    bag.Stun.remain = Math.max(bag.Stun.remain || 0, magnitude);
    return;
  }
  if (name === 'Weakness' || name === 'Haste') {
    bag[name] = bag[name] || { stacks: 0, remain: 0 };
    bag[name].stacks += magnitude;
    // duration = n s, refresh (S7 table): here n is the SAME magnitude used
    // for stack count per authoring convention (apply_status/n ranged param
    // doubles as both "stacks added" and "refresh duration" for these two,
    // consistent with the table's single n column). Document as interp.
    bag[name].remain = Math.max(bag[name].remain || 0, magnitude);
    return;
  }
  // Burn/Poison/Chill/Regen/Spikes: "stacks add"
  bag[name] = bag[name] || { stacks: 0 };
  bag[name].stacks += magnitude;
  if (name === 'Chill') bag[name].stacks = Math.min(bag[name].stacks, TUNABLES.CHILL_STACK_CAP);
}

function cleanse(bag) {
  for (const s of DEBUFF_STATUSES) delete bag[s];
  // buffs (Regen/Spikes/Haste) untouched (S7 rule 3)
}

// net cadence multiplier from Chill/Haste (S7 rule 1: "one cadence axis,
// opposite sign -> NET (one number)"). Returned as a multiplier on the
// base every_secs interval: >1 slower (chilled), <1 faster (hasted).
function cadenceMultiplier(bag) {
  const chillStacks = (bag.Chill && bag.Chill.stacks) || 0;
  const hasteStacks = (bag.Haste && bag.Haste.stacks) || 0;
  const netPct = chillStacks * TUNABLES.CHILL_PCT_PER_STACK - hasteStacks * TUNABLES.HASTE_PCT_PER_STACK;
  // netPct>0 => net slow (interval longer); netPct<0 => net fast (interval shorter)
  return 1 + netPct;
}

function weaknessMultiplier(bag) {
  const stacks = (bag.Weakness && bag.Weakness.stacks) || 0;
  return Math.max(0, 1 - stacks * TUNABLES.WEAKNESS_PCT_PER_STACK);
}

function isStunned(bag) {
  return !!(bag.Stun && bag.Stun.remain > 0);
}

// Advance all status timers/ticks for one actor by dtSecs of elapsed time,
// applied whenever we cross a STATUS_TICK_PERIOD_SECS boundary. Returns a
// list of {kind,name,amount} tick effects for the caller to apply as HP
// changes + emit as status_tick events. This function operates on a
// per-actor "elapsed accumulator" (bag._acc) so ticks land on a clean
// period cadence regardless of dt granularity.
function tickStatuses(bag, dtSecs) {
  const P = TUNABLES.STATUS_TICK_PERIOD_SECS;
  const results = [];
  bag._acc = (bag._acc || 0) + dtSecs;
  // Stun/Weakness/Haste duration countdown -- advances by dtSecs per call. The
  // sole caller passes P (= STATUS_TICK_PERIOD_SECS) once per status tick, so
  // these durations decay in 1.0s quanta, NOT real time (false comment fixed by
  // REQ-0256 s7.2; moving to per-tick decay would be an unasked balance change).
  // Stun pauses ACTION timers only; DoTs (Burn/Poison) keep ticking through
  // Stun (S7 rule 4) -- so this function still runs during Stun.
  if (bag.Stun) { bag.Stun.remain -= dtSecs; if (bag.Stun.remain <= 0) delete bag.Stun; }
  if (bag.Weakness) { bag.Weakness.remain -= dtSecs; if (bag.Weakness.remain <= 0) delete bag.Weakness; }
  if (bag.Haste) { bag.Haste.remain -= dtSecs; if (bag.Haste.remain <= 0) delete bag.Haste; }

  while (bag._acc >= P) {
    bag._acc -= P;
    if (bag.Burn && bag.Burn.stacks > 0) {
      results.push({ name: 'Burn', amount: bag.Burn.stacks, kind: 'damage' });
      bag.Burn.stacks -= 1;
      if (bag.Burn.stacks <= 0) delete bag.Burn;
    }
    if (bag.Poison && bag.Poison.stacks > 0) {
      results.push({ name: 'Poison', amount: bag.Poison.stacks, kind: 'damage' });
      bag.Poison.stacks -= 1;
      if (bag.Poison.stacks <= 0) delete bag.Poison;
    }
    if (bag.Chill && bag.Chill.stacks > 0) {
      bag.Chill.stacks -= 1;
      if (bag.Chill.stacks <= 0) delete bag.Chill;
    }
    if (bag.Regen && bag.Regen.stacks > 0) {
      results.push({ name: 'Regen', amount: bag.Regen.stacks, kind: 'heal' });
      bag.Regen.stacks -= 1;
      if (bag.Regen.stacks <= 0) delete bag.Regen;
    }
    // Spikes: NO time decay (consumed per hit only, handled at hit-resolution time)
  }
  return results;
}

// Spikes: "consumed per hit; when BP hit, attacker takes 1xstacks; 1 stack
// consumed per hit" (S7, OQ9 LOCKED).
function consumeSpikes(bag) {
  if (!bag.Spikes || bag.Spikes.stacks <= 0) return 0;
  const reflect = bag.Spikes.stacks; // 1x stacks reflected
  bag.Spikes.stacks -= 1; // 1 stack consumed per hit
  if (bag.Spikes.stacks <= 0) delete bag.Spikes;
  return reflect;
}

// =====================================================================
// Compile pass (S1.4) -- given a squad snapshot (BPs+POs+layout, shape of
// scenario.json) and a chosen formation id, compute absolute field cells
// for every BP and fold passive/battle_start buffs onto POs' effects.
// =====================================================================

// Chebyshev-adjacent check used for buff_adjacent folding: two BPs are
// "adjacent" if any of their footprint cells are within Chebyshev
// distance 1 of each other (on the squad's OWN local 8x8 grid, pre-offset;
// adjacency is a placement-time/local concept per the engine's own
// `adjacent(A,B)` helper at engine.js:233 -- we re-derive a Chebyshev
// cell-set adjacency here rather than reusing engine's mutation-coupled
// internals, since we only need the geometric predicate).

module.exports = {
  STATUS_KIND,
  DEBUFF_STATUSES,
  BUFF_STATUSES,
  STATUS_KINDS,
  resolveStatusKind,
  resolveVerbStatusSet,
  foldBattleStartStatusVerbs,
  freshStatusBag,
  applyStatus,
  cleanse,
  cadenceMultiplier,
  weaknessMultiplier,
  isStunned,
  tickStatuses,
  consumeSpikes,
};
