'use strict';
// sim/lib/unit_charge_encounter.cjs -- REQ-0200: the FUSION adapter that runs the
// unit charge runtime (sim/lib/unit_charge.cjs) INSIDE the deterministic encounter
// loop (sim/lib/encounter.cjs).
//
// Built ONLY when some troop BP carries a `charge` block (no live unit does yet, so
// runEncounter builds no manager on any current content -> every hook is skipped ->
// byte-identical goldens). The runtime uses no RNG and this adapter consumes no rng
// stream, so even a charge-BEARING encounter's NON-charge event stream is byte-
// identical to the same encounter without charge: the ONLY added events are the
// engine's unit_charge_* emissions.
//
// What the adapter wires:
//  - link topology  : symmetric adjacency built from the compiled link graph
//                     (bp.linkOut, which compile.cjs derives from each unit's
//                     connection_shape -> vocab.connection_shapes). This is the same
//                     graph the board/pulse system links over -- no second source.
//  - selector inputs: bp_connected_lowest_hp reads each BP's LIVE hp (real actor);
//                     bp_connected_max_cooldown_item reads a per-BP item-cooldown
//                     proxy = the slowest every_secs interval among that BP's placed
//                     POs (the sim has no live per-BP cooldown scalar yet -- this is
//                     the honest static stand-in the selector ranks over).
//  - landing surface: charge-effect verbs land on the runtime's own target model
//                     (makeChargeTarget). Feeding real-actor HP write-back is the
//                     documented richer-adapter step (REQ-0200 s7); the groundings do
//                     not change, only the target backing.

const { createChargeEngine, makeChargeTarget } = require('./unit_charge.cjs');
const { applyStatus, cleanse } = require('./status.cjs'); // REQ-0200: reuse the REAL status maps

// The sim's 8 concrete status names -- bonus_vs_status "any" resolves to all of them
// (the charge grammar's wildcard; the sim's bonusVsStatus list is name-set based).
const ALL_STATUS_NAMES = ['Burn', 'Poison', 'Chill', 'Regen', 'Spikes', 'Stun', 'Weakness', 'Haste'];
function bonusStatusSet(name) { return name === 'any' ? new Set(ALL_STATUS_NAMES) : new Set([name]); }

function createEncounterChargeManager(opts) {
  const { chargeBps, troopBps, troopPos, playerActors, events, heap, clock, ops } = opts;
  const realOps = ops || {}; // REQ-0200: encounter-provided callbacks needing the sim loop (strike/fire_items/advance_cooldown)

  // Symmetric adjacency (undirected connectivity) from the compiled link edges.
  const adjacency = {};
  const addEdge = (a, b) => { (adjacency[a] = adjacency[a] || []); if (adjacency[a].indexOf(b) < 0) adjacency[a].push(b); };
  for (const bp of troopBps) for (const e of (bp.linkOut || [])) { addEdge(bp.id, e.to); addEdge(e.to, bp.id); }

  // Per-BP item-cooldown proxy for bp_connected_max_cooldown_item.
  const cdProxy = {};
  for (const po of (troopPos || [])) {
    if (!po.bpId) continue;
    for (const eff of (po.effects || [])) {
      if (eff.trigger && eff.trigger.t === 'every_secs' && Array.isArray(eff.trigger.s)) {
        const mid = (eff.trigger.s[0] + eff.trigger.s[1]) / 2;
        if (mid > (cdProxy[po.bpId] || 0)) cdProxy[po.bpId] = mid;
      }
    }
  }

  // A landing-surface target for every troop BP (so any linked BP can be a target).
  const targets = {};
  for (const bp of troopBps) targets[bp.id] = makeChargeTarget(bp.id);
  const actorById = {};
  for (const a of playerActors) actorById[a.id] = a;
  const bpRefById = {};
  for (const bp of troopBps) bpRefById[bp.id] = bp; // REQ-0200: the REAL compiled actor state (hp/statusBag/shield/...)

  // -------------------------------------------------------------------------
  // REQ-0200 REAL-ACTOR ADAPTER: the charge engine's sink. Same verb groundings
  // as the internal target model, but the mutation now lands on the LIVE sim
  // actor -- BP hp/shield pools, status maps, damage-reduction/buff knobs the real
  // damage pipeline reads, and the item cooldown/firing machinery (via realOps).
  // grant_charge + transform are structural (engine-internal) and never reach here.
  function applyReal(desc) {
    const { targetId, standing, rec } = desc;
    const bp = bpRefById[targetId];
    if (!bp) return;
    const actor = actorById[targetId];
    const t = clock.now;
    switch (rec.verb) {
      // strike / multi_strike: a REAL damage ray from this BP into the enemy side.
      case 'strike': if (realOps.strikeFromBp) realOps.strikeFromBp(targetId, rec.amount, 1, t); break;
      case 'multi_strike': if (realOps.strikeFromBp) realOps.strikeFromBp(targetId, rec.hits ? rec.amount / rec.hits : rec.amount, rec.hits || 1, t); break;
      // mitigation -> the real damage pipeline (reduceIncoming flat/pct + shield pool).
      case 'block': bp.damageReduction = (bp.damageReduction || 0) + rec.amount; break;
      case 'damage_reduction': bp.damageReductionPct = standing ? rec.total : (bp.damageReductionPct || 0) + rec.pct; break;
      case 'grant_shield': bp.shield = (bp.shield || 0) + rec.amount; break;
      case 'reflect_damage': bp.reflectPct = (bp.reflectPct || 0) + rec.pct; break;
      // healing -> the real hp pool (actor.heal caps at hpMax).
      case 'heal_bp': if (actor) actor.heal(rec.amount); else bp.hp = Math.min(bp.hpMax, bp.hp + rec.amount); break;
      // status maps -> the REAL status machinery (applyStatus / cleanse / _immune).
      case 'apply_status': applyStatus(bp.statusBag, rec.status, rec.n); break;
      case 'cleanse': cleanse(bp.statusBag); break;
      case 'haste': applyStatus(bp.statusBag, 'Haste', rec.amount); break;
      case 'status_immune': bp.statusBag._immune = bp.statusBag._immune || new Set(); bp.statusBag._immune.add(rec.status); break;
      // on-hit rider + amp: stored on the BP; applied to landed enemies by onOffensiveLanded.
      case 'add_on_hit_status': bp.chargeOnHit = bp.chargeOnHit || {}; bp.chargeOnHit[rec.status] = (bp.chargeOnHit[rec.status] || 0) + rec.n; break;
      case 'amp_status': bp.chargeAmp = bp.chargeAmp || {}; bp.chargeAmp[rec.status] = (bp.chargeAmp[rec.status] || 0) + rec.n; break;
      // outgoing-damage hooks read by the offensive damage path (dealHitOnField).
      case 'buff_self':
      case 'buff_linked': bp.chargeDmgBuffPct = standing ? rec.total : (bp.chargeDmgBuffPct || 0) + rec.pct; break;
      case 'bonus_vs_status': bp.bonusVsStatus = (bp.bonusVsStatus || []).concat([{ set: bonusStatusSet(rec.status), n: [rec.pct, rec.pct] }]); break;
      // lifesteal: heal the attacker for pct of damage it deals, until dur_s expires.
      case 'grant_lifesteal': bp.chargeLifesteal = { pct: rec.pct, until: t + (rec.dur_s || 0) }; break;
      // item cooldown / firing machinery (needs the encounter heap + schedulable).
      case 'advance_cooldown': if (realOps.advanceCooldown) realOps.advanceCooldown(targetId, rec.amount, t); break;
      case 'fire_items': if (realOps.fireItems) realOps.fireItems(targetId, rec.tag, t); break;
      // REQ-0212: charge_strike -- a REAL single strike ray from the host BP into the enemy side,
      // for the pre-resolved n x stacks_spent total; plus a dedicated event carrying the amount.
      case 'charge_strike':
        if (realOps.strikeFromBp) realOps.strikeFromBp(targetId, rec.amount, 1, t);
        events.push({ t, seq: heap.nextSeq(), ev: 'unit_charge_strike', src: targetId, amount: rec.amount, stacks_spent: rec.stacksSpent });
        break;
      // REQ-0212: transfer_status -- move up to n negative statuses from this BP onto the enemy squad.
      case 'transfer_status': if (realOps.transferStatus) realOps.transferStatus(targetId, rec.n, t); break;
      // REQ-0212: shield_break -- strip up to n flat block from the enemy squad's active block pool.
      case 'shield_break': if (realOps.breakShield) realOps.breakShield(targetId, rec.n, t); break;
      default: break;
    }
  }

  // When a charge-bearing BP's items land DIRECT hits on enemies: apply its
  // add_on_hit_status riders (amplified by amp_status) to the struck enemies, and
  // lifesteal-heal the attacker for a pct of the volley's damage.
  function onOffensiveLanded(fireBp, landedHits, t) {
    const bp = bpRefById[fireBp];
    if (!bp || !landedHits || !landedHits.length) return;
    if (bp.chargeOnHit) {
      for (const st in bp.chargeOnHit) {
        const n = bp.chargeOnHit[st];
        if (!n) continue;
        const ampMult = 1 + ((bp.chargeAmp && bp.chargeAmp[st]) || 0);
        for (const lh of landedHits) {
          const tgt = lh.actor;
          if (!tgt || tgt.kind !== 'enemy' || !tgt.alive) continue;
          applyStatus(tgt.statusBag, st, n, ampMult);
          events.push({ t, seq: heap.nextSeq(), ev: 'unit_charge_onhit', src: fireBp, status: st, n: n * ampMult });
        }
      }
    }
    if (bp.chargeLifesteal && t <= bp.chargeLifesteal.until) {
      let total = 0; for (const lh of landedHits) total += (lh.amount || 0);
      const heal = total * bp.chargeLifesteal.pct / 100;
      if (heal > 0) {
        const actor = actorById[fireBp];
        if (actor) actor.heal(heal); else bp.hp = Math.min(bp.hpMax, bp.hp + heal);
        events.push({ t, seq: heap.nextSeq(), ev: 'unit_charge_lifesteal', src: fireBp, heal, hp_after: actor ? actor.hp() : bp.hp });
      }
    }
  }

  // When an enemy volley lands DIRECT hits on player BPs: reflect_damage pct of each
  // hit back onto the ATTACKING enemy (real enemy hp loss).
  function onDefensiveLanded(enemyActor, landedHits, t) {
    if (!enemyActor || !landedHits) return;
    for (const lh of landedHits) {
      const pbp = lh.actor;
      if (!pbp || pbp.kind !== 'bp') continue;
      const bp = bpRefById[pbp.id];
      if (!bp || !bp.reflectPct) continue;
      const reflect = (lh.amount || 0) * bp.reflectPct / 100;
      if (reflect > 0 && enemyActor.alive) {
        enemyActor.applyDamage(reflect);
        events.push({ t, seq: heap.nextSeq(), ev: 'unit_charge_reflect', src: pbp.id, amount: reflect, hp_after: enemyActor.hp() });
      }
    }
  }

  // The outgoing-damage buff a firing BP carries (read by the offensive damage path).
  function outgoingBuffPctFor(bpId) { return (bpRefById[bpId] && bpRefById[bpId].chargeDmgBuffPct) || 0; }

  const instances = chargeBps.map(bp => ({ id: bp.id, unitId: bp.unitId, charge: bp.charge }));
  const engine = createChargeEngine({
    instances, adjacency, targets,
    emit: (cev) => { events.push(Object.assign({ t: clock.now, seq: heap.nextSeq() }, cev)); },
    sink: applyReal, // REQ-0200: the REAL-actor mutation seam
  });

  // Refresh selector inputs from LIVE actor state right before each feed/settle.
  function syncTargets() {
    for (const bp of troopBps) {
      const tg = targets[bp.id];
      if (!tg) continue;
      const a = actorById[bp.id];
      tg.hp = a ? a.hp() : bp.hp;
      tg.hpMax = a ? a.hpMax() : bp.hpMax;
      tg.itemCooldown = cdProxy[bp.id] || 0;
    }
  }

  function feed(ev, t) { clock.now = t; syncTargets(); engine.feed(ev); }
  function settle(t) { clock.now = t; syncTargets(); return engine.settle(); }

  function summary() {
    const inst = {};
    for (const id in engine.instances) {
      inst[id] = {
        unitId: engine.unitIdOf(id), counter: engine.counterOf(id),
        stacks: engine.stacksOf(id), spends: engine.spendsOf(id),
        capacity: engine.capacityOf(id),
      };
    }
    const tgt = {};
    for (const bp of troopBps) { const t = engine.target(bp.id); if (t) tgt[bp.id] = t; }
    return { instances: inst, targets: tgt, adjacency, cdProxy };
  }

  return { feed, settle, hasDeferred: engine.hasDeferred, summary, adjacency, cdProxy, engine, onOffensiveLanded, onDefensiveLanded, outgoingBuffPctFor };
}

module.exports = { createEncounterChargeManager };
