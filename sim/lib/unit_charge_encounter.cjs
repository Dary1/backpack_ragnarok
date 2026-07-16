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

function createEncounterChargeManager(opts) {
  const { chargeBps, troopBps, troopPos, playerActors, events, heap, clock } = opts;

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

  const instances = chargeBps.map(bp => ({ id: bp.id, unitId: bp.unitId, charge: bp.charge }));
  const engine = createChargeEngine({
    instances, adjacency, targets,
    emit: (cev) => { events.push(Object.assign({ t: clock.now, seq: heap.nextSeq() }, cev)); },
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

  return { feed, settle, hasDeferred: engine.hasDeferred, summary, adjacency, cdProxy, engine };
}

module.exports = { createEncounterChargeManager };
