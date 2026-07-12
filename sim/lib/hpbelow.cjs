'use strict';
// sim/lib/hpbelow.cjs -- REQ-0121: on_hp_below trigger bookkeeping.
//
// on_hp_below is NOT a status and NOT a scheduled timer: it is a
// state-crossing condition on the actor itself ("enrage below X% HP" --
// orc Bloodlust / behemoth Last Stand, batch-004). Per this project's
// one-module-per-concern pattern it gets its own small module rather
// than a bolt-on inside status.cjs.
//
// Semantics (user ruling, 2026-07-12, recorded in REQ-0121 + vocab
// provenance): fires ONCE EVER per (owner, watcher key). No re-arm when
// the owner heals back above the threshold and crosses again. "Below"
// is STRICT: hp/hpMax < hp_frac. A crossing that lands exactly ON the
// threshold does not fire. A killing blow does not fire it either
// (hp must still be > 0 after the damage) -- a dead actor's enrage is
// meaningless and would only pollute the replay.
//
// Bookkeeping lives on the actor REF (the plain bp/enemy/entity object),
// NOT on the makeBPActor/makeEnemyActor wrapper -- wrappers are recreated
// freely (e.g. enemyActorList() re-wraps the trap entity per call), so
// only the ref is a stable home. For player BPs the ref persists across
// encounters within a run (S8.2 HP persistence), which makes "once ever"
// mean once per RUN on the player side; for enemies the ref lives for
// exactly one encounter, so once-per-encounter falls out of the same rule.
//
// The check is invoked from the applyDamage chokepoint (both actor
// wrappers in skills.cjs) so the trigger fires the INSTANT the threshold
// is crossed -- including crossings caused by DoT status ticks -- not on
// the next tick boundary (REQ-0121 design note).

// registerHpBelowWatchers(ref, watchers): attach watcher specs to an
// actor ref. watcher: { key: string (unique, stable across re-registration
// -- fired-state is keyed on it), frac: number, onFire: fn(ref, watcher) }.
// Registration is idempotent per key: re-registering (e.g. a new
// encounter re-scanning a persistent BP) replaces the watcher list but
// fired-state survives in ref._hpBelowFired.
function registerHpBelowWatchers(ref, watchers) {
  ref._hpWatchers = watchers || [];
  if (!ref._hpBelowFired) ref._hpBelowFired = new Set();
}

// checkHpBelow(ref): called after any HP reduction on ref. Fires every
// registered, not-yet-fired watcher whose threshold the actor is now
// strictly below (while still alive). Multiple thresholds can fire from
// one hit (e.g. a huge hit crossing 0.5 and 0.3 at once) -- they fire in
// registration order.
function checkHpBelow(ref) {
  if (!ref._hpWatchers || !ref._hpWatchers.length) return;
  if (!(ref.hp > 0)) return; // killing blow: no posthumous enrage
  const hpMax = ref.hpMax || 0;
  if (!(hpMax > 0)) return;
  for (const w of ref._hpWatchers) {
    if (ref._hpBelowFired.has(w.key)) continue;
    if (ref.hp / hpMax < w.frac) {
      ref._hpBelowFired.add(w.key); // mark BEFORE onFire: re-entrancy guard
      w.onFire(ref, w);
    }
  }
}

// foldFlatBonusInPlace(effectsOrSkills, flatBonus): the fire-time fold --
// mutates strike/multi_strike verb.n [lo,hi] ranges IN PLACE by a flat
// additive bonus. Callers must guarantee the list holds per-instance
// copies (packs.cjs deep-copies an enemy's skills at compile time whenever
// that enemy carries any buff_self; compile.cjs's PO effects are already
// per-instance copies), never shared content defs. Mutating in place is
// deliberate: the encounter loop's schedulable entries hold references to
// these same effect objects, so subsequent firings pick the buffed range
// up automatically.
function foldFlatBonusInPlace(effectsOrSkills, flatBonus) {
  if (!flatBonus) return;
  for (const eff of (effectsOrSkills || [])) {
    const verb = eff && eff.verb;
    if (verb && (verb.t === 'strike' || verb.t === 'multi_strike') && Array.isArray(verb.n)) {
      verb.n = [verb.n[0] + flatBonus, verb.n[1] + flatBonus];
    }
  }
}

module.exports = {
  registerHpBelowWatchers,
  checkHpBelow,
  foldFlatBonusInPlace,
};
