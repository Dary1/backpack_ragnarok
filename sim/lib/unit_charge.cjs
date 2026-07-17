'use strict';
// sim/lib/unit_charge.cjs -- REQ-0200: THE unit charge runtime.
//
// A unit def carries a FROZEN `charge` block {trigger, gain, capacity, spend,
// effects|transform_to} (content/vocab.json `charge`; validated by
// shared/content_validate.cjs validateCharge). This module is the deterministic
// runtime that honours it: a per-unit-instance counter that fills on combat events
// and spends via one of three modes, resolving effects onto link-graph targets.
//
// DETERMINISM: no RNG. Every ranged number (capacity, and each ranged verb param)
// resolves through the SINGLE seam resolveRolledRange(). No wall-clock; time is fed.
//
// EVENT MODEL: the caller (sim/lib/encounter.cjs, or the driver test) feeds combat
// events via feed(ev). Each event type maps to the charge trigger(s) it can fire:
//   timer{now}                        -> every_secs (per-instance period)
//   bp_attack{sourceId, amount}       -> OnHit + on_damage_dealt (source) + on_connected_unit_attack (linked)
//   bp_damaged{bpId, amount}          -> OnBPBeenHit (bp) + on_connected_unit_bp_been_hit (linked)
//   bp_healed{bpId}                   -> on_heal_done (bp)
//   status_applied{sourceId}          -> on_status_applied (source)
//   enemy_killed{sourceId, enemyId}   -> on_kill (source; DEDUPED once per enemyId)
//   passive_fired{instanceId}         -> on_own_passive_fire (self)
//   (on_connected_unit_spend is emitted INTERNALLY when a linked unit spends.)
//
// CASCADE SAFETY: a spend that GRANTS charge (grant_charge verb) to another unit
// which thereby REACHES capacity does NOT spend that unit in the same tick -- it is
// deferred to settle() (the next tick). This breaks the king<->jester grant loop.
// Independently, every instance spends AT MOST ONCE per feed()/settle() cascade
// (spentThisTick guard), so any spend chain terminates in <= N hops.

// ---------------------------------------------------------------------------
// resolveRolledRange(range, instanceRolls, key): THE seam.
// If the instance carries a pre-rolled value for `key` (future REQ-0190 supplies
// these per instance -- ハスクラ), use it. Otherwise fall back to the deterministic
// MIDPOINT (lo+hi)/2. Documented fallback: the midpoint is the honest "expected"
// value of a range when no per-instance roll exists; REQ-0190 makes the whole engine
// per-instance-rolled by populating one map, with NO other code change.
function resolveRolledRange(range, instanceRolls, key) {
  if (instanceRolls && key != null && Object.prototype.hasOwnProperty.call(instanceRolls, key)) {
    return instanceRolls[key];
  }
  if (Array.isArray(range) && range.length === 2) return (range[0] + range[1]) / 2;
  if (typeof range === 'number') return range;
  return 0;
}

// A minimal combat-target model: the honest landing surface for charge effect verbs.
// The sim will provide a richer adapter; the driver test uses this directly. Every
// field is the simplest honest accumulation consistent with the item-side verbs.
function makeChargeTarget(id) {
  return {
    id,
    hp: 100, hpMax: 100, itemCooldown: 0, // selector inputs (lowest-hp / max-cooldown)
    damageTaken: 0, healed: 0, shield: 0, block: 0,
    buffPct: 0, dmgReductionPct: 0, reflectPct: 0, bonusVsStatusPct: 0,
    hasteStacks: 0, cooldownAdvanced: 0,
    statuses: {}, onHitStatus: {}, statusAmp: {}, immune: {},
    lifesteal: [], firedItems: [], cleansed: 0,
    standing: {}, // passive_per_stack standing effects: verbKey -> {pct|n, stacks}
    log: [],
  };
}

// groundVerb: the honest, documented grounding of one charge-effect verb onto a
// target. `divisor` (>=1) implements units_connected_distributed (amount split).
// grant_charge and transform are STRUCTURAL (handled by the engine, not here).
function groundVerb(verb, target, rolls, key, divisor) {
  const d = divisor && divisor > 0 ? divisor : 1;
  const num = (p) => resolveRolledRange(verb[p], rolls, key + ':' + p) / d;
  const pctOf = () => resolveRolledRange(verb.pct !== undefined ? verb.pct : verb.n, rolls, key + ':pct') / d;
  const rec = (kind, extra) => { const r = Object.assign({ verb: verb.t, kind }, extra); target.log.push(r); return r; };
  switch (verb.t) {
    case 'strike': { const n = num('n'); target.damageTaken += n; return rec('damage', { amount: n }); }
    case 'multi_strike': { const n = num('n'), h = num('hits'); const total = n * h; target.damageTaken += total; return rec('damage', { amount: total, hits: h }); }
    case 'block': { const n = num('n'); target.block += n; return rec('block', { amount: n }); }
    case 'heal_bp': { const n = num('n'); target.healed += n; target.hp = Math.min(target.hpMax, target.hp + n); return rec('heal', { amount: n }); }
    case 'apply_status': { const n = num('n'); target.statuses[verb.status] = (target.statuses[verb.status] || 0) + n; return rec('status', { status: verb.status, n }); }
    case 'add_on_hit_status': { const n = num('n'); target.onHitStatus[verb.status] = (target.onHitStatus[verb.status] || 0) + n; return rec('on_hit_status', { status: verb.status, n }); }
    case 'amp_status': { const n = num('n'); target.statusAmp[verb.status] = (target.statusAmp[verb.status] || 0) + n; return rec('amp_status', { status: verb.status, n }); }
    case 'cleanse': { target.statuses = {}; target.cleansed += 1; return rec('cleanse', {}); }
    case 'reflect_damage': { const p = pctOf(); target.reflectPct += p; return rec('reflect', { pct: p }); }
    case 'haste': { const n = num('n'); target.hasteStacks += n; return rec('haste', { amount: n }); }
    case 'status_immune': { target.immune[verb.status] = true; return rec('immune', { status: verb.status }); }
    case 'bonus_vs_status': { const p = pctOf(); target.bonusVsStatusPct += p; return rec('bonus_vs_status', { pct: p, status: verb.status }); }
    case 'buff_self': { const p = pctOf(); target.buffPct += p; return rec('buff', { pct: p }); }
    case 'buff_linked': { const p = pctOf(); target.buffPct += p; return rec('buff', { pct: p }); }
    case 'damage_reduction': { const p = pctOf(); target.dmgReductionPct += p; return rec('damage_reduction', { pct: p }); }
    case 'grant_shield': { const n = num('n'); target.shield += n; return rec('shield', { amount: n }); }
    case 'grant_lifesteal': { const p = pctOf(); const dur = resolveRolledRange(verb.dur_s, rolls, key + ':dur_s'); target.lifesteal.push({ pct: p, dur_s: dur }); return rec('lifesteal', { pct: p, dur_s: dur }); }
    case 'advance_cooldown': { const n = num('n'); target.cooldownAdvanced += n; target.itemCooldown = Math.max(0, target.itemCooldown - n); return rec('advance_cooldown', { amount: n }); }
    case 'fire_items': { target.firedItems.push(verb.tag || '*'); return rec('fire_items', { tag: verb.tag || null }); }
    default: return rec('unhandled', {}); // never reached: verbs are validateCharge-gated
  }
}

// ---------------------------------------------------------------------------
function createChargeEngine(opts) {
  opts = opts || {};
  const adjacency = opts.adjacency || {};       // id -> [connected ids] (undirected connectivity)
  const targets = opts.targets || {};           // id -> target model (effects land here)
  const rolls = opts.instanceRolls || null;     // REQ-0190 seam input
  const emit = typeof opts.emit === 'function' ? opts.emit : function () {};
  // REQ-0200 real-actor adapter seam: a caller-supplied sink fires for every GROUNDED
  // effect (spend + standing), carrying the resolved concrete numbers (the same `rec`
  // the internal target model logs). The engine still mutates its own target model
  // (chargeState / module-boundary tests); the sink is the ADDITIONAL real mutation on
  // live sim actors. grant_charge + transform are STRUCTURAL and never call the sink.
  const sink = typeof opts.sink === 'function' ? opts.sink : null;
  const MAX_CASCADE = opts.maxCascade || 256;   // hard safety bound (never hit under the rules)

  const inst = {};  // id -> instance state
  for (const spec of (opts.instances || [])) {
    if (!spec.charge) continue;
    inst[spec.id] = {
      id: spec.id, unitId: spec.unitId, charge: spec.charge,
      counter: 0, stacks: 0, transformed: false,
      lastEverySecFire: 0, spentThisTick: false,
      capacity: resolveRolledRange(spec.charge.capacity, rolls, spec.id + ':cap'),
    };
  }
  const killed = new Set();          // enemyId set (on_kill dedup)
  let deferred = [];                 // ids whose grant_charge fill spends next tick
  const spendCount = {};             // id -> total spends (observability)

  // ALL adjacency neighbours -- target resolution (units_connected / bp_connected /
  // selectors) reaches any linked BP, not only charge-bearing ones. The trigger-firing
  // path (fireTrigger) skips non-charge ids on its own, so unfiltering is safe there too.
  const connected = (id) => (adjacency[id] || []).slice();

  function resolveTargetIds(id, target) {
    switch (target) {
      case 'self': return [id];
      case 'units_connected':
      case 'bp_connected':
      case 'units_connected_distributed':
        return connected(id);
      case 'bp_connected_max_cooldown_item': {
        const c = connected(id);
        if (!c.length) return [];
        let best = c[0];
        for (const x of c) if ((targets[x] ? targets[x].itemCooldown : 0) > (targets[best] ? targets[best].itemCooldown : 0)) best = x;
        return [best];
      }
      case 'bp_connected_lowest_hp': {
        const c = connected(id);
        if (!c.length) return [];
        let best = c[0];
        for (const x of c) if ((targets[x] ? targets[x].hp : Infinity) < (targets[best] ? targets[best].hp : Infinity)) best = x;
        return [best];
      }
      default: return [];
    }
  }

  // performSpend: fire one instance's spend (fire_on_full / transform). Returns nothing;
  // may enqueue grant_charge-induced fills into `deferred`. Guarded: at most one spend
  // per instance per cascade.
  function performSpend(s, work, depth) {
    if (s.spentThisTick) return;
    const ch = s.charge;
    if (ch.spend === 'transform') {
      s.transformed = true;
      s.unitId = ch.transform_to;
      s.counter = 0;
      s.spentThisTick = true;
      emit({ ev: 'unit_charge_transform', id: s.id, into: ch.transform_to });
      return;
    }
    // fire_on_full
    s.spentThisTick = true;
    spendCount[s.id] = (spendCount[s.id] || 0) + 1;
    const applied = [];
    for (let ei = 0; ei < (ch.effects || []).length; ei++) {
      const e = ch.effects[ei];
      const ids = resolveTargetIds(s.id, e.target);
      if (e.verb.t === 'grant_charge') {
        const n = resolveRolledRange(e.verb.n, rolls, s.id + ':e' + ei + ':n');
        for (const tid of ids) {
          const ts = inst[tid];
          if (!ts) continue;
          ts.counter += n;
          applied.push({ verb: 'grant_charge', to: tid, n });
          // CASCADE RULE: a grant_charge fill defers the filled unit's spend to next tick.
          if (ts.charge.spend === 'fire_on_full' && !ts.spentThisTick && ts.counter >= ts.capacity) {
            if (deferred.indexOf(tid) === -1) deferred.push(tid);
          }
        }
      } else {
        const divisor = e.target === 'units_connected_distributed' ? Math.max(1, ids.length) : 1;
        for (const tid of ids) {
          if (!targets[tid]) targets[tid] = makeChargeTarget(tid);
          const r = groundVerb(e.verb, targets[tid], rolls, s.id + ':e' + ei, divisor);
          if (sink) sink({ sourceId: s.id, targetId: tid, standing: false, rec: r });
          applied.push({ verb: e.verb.t, to: tid, kind: r.kind });
        }
      }
    }
    s.counter = 0;
    emit({ ev: 'unit_charge_spend', id: s.id, spend: 'fire_on_full', effects: applied });
    // on_connected_unit_spend: linked units observe this spend (same cascade, bounded
    // by spentThisTick). NOT a grant_charge fill, so these may spend this tick.
    fireTrigger('on_connected_unit_spend', connected(s.id), undefined, work, depth + 1);
  }

  // fireTrigger: for each candidate id whose charge trigger matches trigName, apply a
  // gain, then (fire_on_full) spend if full; (passive_per_stack) recompute stacks;
  // (transform) transform if full.
  function fireTrigger(trigName, ids, evAmount, work, depth) {
    if (depth > MAX_CASCADE) throw new Error('unit_charge: cascade exceeded ' + MAX_CASCADE + ' (loop-guard bug)');
    for (const id of ids) {
      const s = inst[id];
      if (!s || s.transformed) continue;
      if (s.charge.trigger.t !== trigName) continue;
      const gain = s.charge.gain === 'damage' ? (evAmount != null ? evAmount : 1) : 1;
      s.counter += gain;
      if (s.charge.spend === 'passive_per_stack') {
        s.stacks = Math.min(Math.floor(s.counter), Math.floor(s.capacity));
        applyStanding(s);
        emit({ ev: 'unit_charge_stack', id: s.id, stacks: s.stacks });
        continue;
      }
      if (s.charge.spend === 'transform') {
        if (s.counter >= s.capacity) performSpend(s, work, depth);
        continue;
      }
      // fire_on_full. deferred[] guard: a grant_charge-induced fill spends next tick,
      // so a same-cascade on_connected_unit_spend must NOT spend it here.
      if (s.counter >= s.capacity && !s.spentThisTick && deferred.indexOf(id) === -1) performSpend(s, work, depth);
    }
  }

  // The standing effect of a passive_per_stack instance: base effect x stacks (capped).
  function standingEffects(id) {
    const s = inst[id];
    if (!s || s.charge.spend !== 'passive_per_stack') return [];
    return (s.charge.effects || []).map((e) => ({ verb: e.verb.t, target: e.target, stacks: s.stacks }));
  }

  // applyStanding: passive_per_stack effects are STANDING, not spent -- recompute the
  // effect total (base-per-stack x current stacks) and set it on the target. Idempotent
  // (a set, not an accumulate): re-running on every stack change is correct.
  function applyStanding(s) {
    if (!s || s.charge.spend !== 'passive_per_stack') return;
    for (let ei = 0; ei < (s.charge.effects || []).length; ei++) {
      const e = s.charge.effects[ei];
      const v = e.verb;
      const baseKey = v.pct !== undefined ? 'pct' : (v.n !== undefined ? 'n' : null);
      const base = baseKey ? resolveRolledRange(v[baseKey], rolls, s.id + ':e' + ei + ':' + baseKey) : 1;
      for (const tid of resolveTargetIds(s.id, e.target)) {
        if (!targets[tid]) targets[tid] = makeChargeTarget(tid);
        targets[tid].standing[v.t] = { base, stacks: s.stacks, total: base * s.stacks, target: e.target, kind: baseKey === 'pct' ? 'pct' : 'flat' };
        // REQ-0200: standing effects are an idempotent SET on the real actor (base x stacks).
        if (sink) sink({ sourceId: s.id, targetId: tid, standing: true, rec: { verb: v.t, kind: baseKey === 'pct' ? 'buff' : 'flat', total: base * s.stacks, base, stacks: s.stacks, status: v.status } });
      }
    }
  }

  // feed(ev): apply one combat event (a fresh cascade). Resets spentThisTick.
  function feed(ev) {
    for (const id in inst) inst[id].spentThisTick = false;
    const work = [];
    switch (ev.type) {
      case 'timer': everySecsTick(ev.now, work); break;
      case 'bp_attack':
        fireTrigger('OnHit', [ev.sourceId], undefined, work, 0);
        fireTrigger('on_damage_dealt', [ev.sourceId], ev.amount, work, 0);
        fireTrigger('on_connected_unit_attack', connected(ev.sourceId), undefined, work, 0);
        break;
      case 'bp_damaged':
        fireTrigger('OnBPBeenHit', [ev.bpId], ev.amount, work, 0);
        fireTrigger('on_connected_unit_bp_been_hit', connected(ev.bpId), undefined, work, 0);
        break;
      case 'bp_healed': fireTrigger('on_heal_done', [ev.bpId], undefined, work, 0); break;
      case 'status_applied': fireTrigger('on_status_applied', [ev.sourceId], undefined, work, 0); break;
      case 'enemy_killed':
        if (!killed.has(ev.enemyId)) { killed.add(ev.enemyId); fireTrigger('on_kill', [ev.sourceId], undefined, work, 0); }
        break;
      case 'passive_fired': fireTrigger('on_own_passive_fire', [ev.instanceId], undefined, work, 0); break;
      default: break;
    }
  }

  function everySecsTick(now, work) {
    for (const id in inst) {
      const s = inst[id];
      if (s.transformed || s.charge.trigger.t !== 'every_secs') continue;
      const period = resolveRolledRange(s.charge.trigger.s, rolls, s.id + ':secs');
      if (period <= 0) continue;
      let guard = 0;
      while (now - s.lastEverySecFire >= period && guard++ < 100000) {
        s.lastEverySecFire += period;
        s.counter += 1; // every_secs gain is 'count'
        if (s.charge.spend === 'passive_per_stack') { s.stacks = Math.min(Math.floor(s.counter), Math.floor(s.capacity)); applyStanding(s); continue; }
        if (s.charge.spend === 'transform') { if (s.counter >= s.capacity) performSpend(s, work, 0); continue; }
        if (s.counter >= s.capacity && !s.spentThisTick && deferred.indexOf(s.id) === -1) performSpend(s, work, 0);
      }
    }
  }

  // settle(): process ONE tick's worth of deferred (grant_charge-induced) spends. Each
  // may enqueue further deferrals for the following tick. Returns the count processed.
  function settle() {
    for (const id in inst) inst[id].spentThisTick = false;
    const batch = deferred; deferred = [];
    let processed = 0;
    for (const id of batch) {
      const s = inst[id];
      if (!s || s.transformed) continue;
      if (s.charge.spend === 'fire_on_full' && s.counter >= s.capacity && !s.spentThisTick) {
        performSpend(s, [], 0); processed++;
      }
    }
    return processed;
  }
  function hasDeferred() { return deferred.length > 0; }

  return {
    feed, settle, hasDeferred, standingEffects,
    counterOf: (id) => (inst[id] ? inst[id].counter : undefined),
    stacksOf: (id) => (inst[id] ? inst[id].stacks : undefined),
    capacityOf: (id) => (inst[id] ? inst[id].capacity : undefined),
    unitIdOf: (id) => (inst[id] ? inst[id].unitId : undefined),
    spendsOf: (id) => spendCount[id] || 0,
    target: (id) => targets[id],
    instances: inst,
  };
}

module.exports = { resolveRolledRange, makeChargeTarget, groundVerb, createChargeEngine };
