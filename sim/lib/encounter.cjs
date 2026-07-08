'use strict';
// sim/lib/encounter.cjs -- REQ-0047 (d): runEncounter -- the event-driven encounter loop.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES } = require('./core.cjs');
const { EventHeap } = require('./heap.cjs');
const { freshStatusBag, tickStatuses, foldBattleStartStatusVerbs, applyStatus } = require('./status.cjs');
const { FIELD_ROWS, FIELD_COLS } = require('./field.cjs');
const { maskLabel } = require('./replay.cjs');
const { effectStreamName, makeBPActor, makeEnemyActor, fireSkillRay, scheduleEffect, defaultAttackProfileFor, applyReactiveVerbToTarget } = require('./skills.cjs');
const { compileEnemyPack } = require('./packs.cjs');

function runEncounter(opts) {
  const {
    rng, encIndex, partyBps, partyPos, partySis, formationBox, enemyDefsById, skillDefsById,
    encounterDef, seedLabel,
  } = opts;
  const events = [];
  const heap = new EventHeap();
  const t0 = 0; // encounter-local time origin
  events.push({ t: t0, seq: heap.nextSeq(), ev: 'encounter_start', enc: encIndex, kind: encounterDef.type, seed: seedLabel, formation: formationBox.formationId });

  // ---- Build player-side actors (BPs already compiled + persistent HP) ----
  const playerActors = partyBps.map(makeBPActor);
  // Player-side schedulable effects: every PO's effects with an every_secs
  // trigger (host_on_hit/on_hit/passive/battle_start handled at compile
  // time or as immediate reactive hooks -- for the sim's scope here we
  // schedule every_secs-triggered verbs, which covers all of batch-002's
  // and live_items.json's damage-dealing content).
  const schedulable = [];
  for (const po of partyPos) {
    (po.effects || []).forEach((eff, idx) => {
      if (eff.trigger && eff.trigger.t === 'every_secs') {
        schedulable.push({ ownerUid: po.uid, ownerId: po.id, effIdx: idx, effect: eff, modes: po.def.modes || ['battle'], attackProfile: eff.attack_profile || po.def.attack_profile || defaultAttackProfileFor(po) });
      }
    });
  }

  // ---- Build enemy-side actors ----
  let enemyActors = [];
  if (encounterDef.enemyPack) {
    const enemyFieldBox = { rowMin: 1, colMin: 1, rowMax: FIELD_ROWS, colMax: FIELD_COLS };
    enemyActors = compileEnemyPack(encounterDef.enemyPack, enemyDefsById, skillDefsById, rng, enemyFieldBox).map(en => ({ raw: en, actor: makeEnemyActor(en) }));
  }
  let entity = null; // trap/door/chest "?" entity
  if (encounterDef.entityDef) {
    const ed = encounterDef.entityDef;
    const [fh, fw] = ed.footprint || [1, 1];
    const centerRow = Math.floor((1 + FIELD_ROWS) / 2), centerCol = Math.floor((1 + FIELD_COLS) / 2);
    const fieldCells = [];
    for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) fieldCells.push([centerRow + dr, centerCol + dc]);
    const entitySkills = (ed.skills || []).map(sid => skillDefsById[sid]).filter(Boolean);
    const entityStatusBag = freshStatusBag();
    const entityFold = foldBattleStartStatusVerbs(entitySkills); // REQ-0093
    entityStatusBag._immune = entityFold.immuneSet;
    entity = {
      id: ed.id, name: ed.name, hp: (ed.hp || 20), hpMax: (ed.hp || 20), fieldCells,
      statusBag: entityStatusBag, alive: true, ownerId: ed.id,
      masked: !!ed.masked, skills: entitySkills, bonusVsStatus: entityFold.bonusVsStatus,
    };
  }

  function enemyActorList() { return enemyActors.map(e => e.actor).concat(entity ? [makeEnemyActor(entity)] : []); }

  // ---- REQ-0048: Linker pulse propagation (Mechanism A). ----
  const PULSE_HOP_BUDGET = TUNABLES.PULSE_HOP_BUDGET;
  const PULSE_LATENCY = TUNABLES.PULSE_HOP_LATENCY_SECS;
  const PULSE_CAP = TUNABLES.PULSE_CAP_PER_SEC;
  const pulseEmitTimes = new Map(); // originBpId -> [t,...] within trailing 1s
  function playerBpActorById(id) { return playerActors.find(a => a.id === id) || null; }
  function schedulePulseArrive(pst, atT) {
    heap.push({ t: atT + PULSE_LATENCY, seq: heap.nextSeq(), kind: 'pulse_arrive', origin: pst.origin, from: pst.from, to: pst.to, hop: pst.hop, visited: pst.visited });
  }
  // Emit one pulse from originBpId along ALL its outgoing links (fan-out).
  // Rate-guarded per origin (PULSE_CAP/sec); excess drops with pulse_fizzle.
  function emitPulse(originBpId, t, outEvents) {
    const origin = playerBpActorById(originBpId);
    if (!origin || !origin.alive) return;
    const times = (pulseEmitTimes.get(originBpId) || []).filter(x => x > t - 1.0 + 1e-9);
    if (times.length >= PULSE_CAP) { outEvents.push({ ev: 'pulse_fizzle', reason: 'rate_cap', origin: originBpId }); pulseEmitTimes.set(originBpId, times); return; }
    times.push(t); pulseEmitTimes.set(originBpId, times);
    for (const e of (origin.ref.linkOut || [])) {
      schedulePulseArrive({ origin: originBpId, from: originBpId, to: e.to, hop: 1, visited: [originBpId] }, t);
    }
  }
  // On arrival at a live BP, fire that BP's on_link_pulse payloads (mode-gated).
  function firePulsePayloads(bpId, ev, outEvents) {
    const host = playerBpActorById(bpId);
    if (!host) return;
    for (const po of partyPos) {
      if (po.bpId !== bpId) continue;
      (po.effects || []).forEach((eff, idx) => {
        if (!eff.trigger || eff.trigger.t !== 'on_link_pulse') return;
        const modes = eff.modes || (po.def && po.def.modes) || ['battle'];
        if (!modes.includes(encounterDef.mode)) return;
        const v = eff.verb;
        if (v.t === 'strike' || v.t === 'multi_strike') {
          const ap = eff.attack_profile || (po.def && po.def.attack_profile) || defaultAttackProfileFor(po);
          const rayEvents = [];
          fireSkillRay({
            attacker: { fieldCells: host.fieldCells, ownerId: po.id + '#pulse', bonusVsStatus: (host.ref.bonusVsStatus || []) },
            attackProfile: ap, verbEff: eff, mode: encounterDef.mode,
            targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
            rng, streamPrefix: 'pulse/' + ev.origin + '/' + bpId + '/h' + ev.hop + '/' + po.uid + '/' + idx + '/' + ev.t,
            events: rayEvents, aoeStatuses: !!ap.aoe_statuses,
          });
          for (const re of rayEvents) { re.cause = 'pulse'; outEvents.push(re); }
        } else if (v.t === 'heal') {
          const rs = rng.stream('pulse-payload/' + ev.origin + '/' + bpId + '/h' + ev.hop + '/' + po.uid + '/' + idx + '/' + ev.t);
          const n = rs.range(v.n[0], v.n[1]); host.heal(n);
          outEvents.push({ ev: 'pulse_payload', dst: host.id, verb: 'heal', amount: n, hp_after: host.hp(), cause: 'pulse' });
        } else if (v.t === 'apply_status' || v.t === 'add_on_hit_status') {
          const rs = rng.stream('pulse-payload/' + ev.origin + '/' + bpId + '/h' + ev.hop + '/' + po.uid + '/' + idx + '/' + ev.t);
          const n = rs.range(v.n[0], v.n[1]); applyStatus(host.statusBag, v.status, n);
          outEvents.push({ ev: 'apply_status', dst: host.id, status: v.status, n: n, cause: 'pulse' });
        }
      });
    }
  }

  // ---- REQ-0095: player-side reactive dispatch (Phase 1b) -- mirrors the enemy side. ----
  function bpActorOf(bpId) { return playerActors.find(a => a.id === bpId) || null; }
  // Offensive riders: when player PO `firingPoUid` lands a DIRECT hit on enemies, its
  // OnHit (self) / OnBPHierarchyHit (same BP) / OnUnitHit (same unit) effects ride each hit.
  function dispatchPlayerOffensive(firingPoUid, landedEnemies, t, outEvents) {
    const fpo = partyPos.find(p => p.uid === firingPoUid);
    if (!fpo || !landedEnemies.length) return;
    let idx = 0;
    for (const po of partyPos) {
      for (const eff of (po.effects || [])) {
        const tt = eff.trigger && eff.trigger.t;
        const match = (tt === 'OnHit' && po.uid === fpo.uid) ||
                      (tt === 'OnBPHierarchyHit' && po.bpId === fpo.bpId) ||
                      (tt === 'OnUnitHit' && po.unitSlot === fpo.unitSlot);
        if (!match) continue;
        const owner = bpActorOf(po.bpId);
        for (const en of landedEnemies) {
          const rs = rng.stream('reactive/' + tt + '/' + po.uid + '/' + t + '/' + (idx++));
          applyReactiveVerbToTarget(eff.verb, owner, en, rs, outEvents, tt);
        }
      }
    }
    // REQ-0095: OnPOHit -- an SI seated in the firing PO fires when its host PO lands a hit.
    for (const si of (partySis || [])) {
      if (si.hostPoUid !== fpo.uid) continue;
      for (const eff of (si.effects || [])) {
        if (!eff.trigger || eff.trigger.t !== 'OnPOHit') continue;
        const owner = bpActorOf(fpo.bpId);
        for (const en of landedEnemies) {
          const rs = rng.stream('reactive/OnPOHit/' + si.uid + '/' + t + '/' + (idx++));
          applyReactiveVerbToTarget(eff.verb, owner, en, rs, outEvents, 'OnPOHit');
        }
      }
    }
  }
  // Defensive: when a player BP takes a DIRECT hit, POs in that BP (OnBPBeenHit) / in that
  // unit (OnUnitBeenHit) fire a retaliation ray at the enemy field.
  function dispatchPlayerDefensive(hitBpActors, t, outEvents) {
    for (const bpA of hitBpActors) {
      const bpId = bpA.id, unit = bpA.ref && bpA.ref.unitSlot;
      for (const po of partyPos) {
        const inBp = po.bpId === bpId, inUnit = (unit != null && po.unitSlot === unit);
        for (const eff of (po.effects || [])) {
          const tt = eff.trigger && eff.trigger.t;
          if (!((tt === 'OnBPBeenHit' && inBp) || (tt === 'OnUnitBeenHit' && inUnit))) continue;
          const ap = eff.attack_profile || (po.def && po.def.attack_profile) || { edge: ['top'], penetration: 0, aoe: 0 };
          outEvents.push({ ev: 'reactive_proc', trigger: tt, verb: eff.verb.t, src: po.id });
          fireSkillRay({
            attacker: { fieldCells: bpA.fieldCells, ownerId: po.id + '#react' },
            attackProfile: ap, verbEff: eff, mode: 'battle',
            targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
            rng, streamPrefix: 'reactive/' + tt + '/' + po.uid + '/' + t,
            events: outEvents, aoeStatuses: !!ap.aoe_statuses,
          });
        }
      }
    }
  }

  // ---- Schedule initial firings (player side, filtered by encounter mode) ----
  const cadenceMultFor = () => 1.0; // cadence buffs folded at compile-time (OQ2); no per-actor Haste/Chill on POs in v1 scope.
  for (const s of schedulable) {
    if (s.modes.includes(encounterDef.mode)) {
      scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, t0, 1.0);
    }
    // non-matching effects: simply never scheduled while this encounter is
    // active (no timer exists to backlog) -- satisfies S6.2 pause semantics.
  }
  // Enemy-side schedule (packs/boss/trap/door skills, always scheduled --
  // enemies are typed to their own encounter and always match its mode).
  const enemySchedulable = [];
  for (const e of enemyActors) {
    e.raw.skills.forEach((skill, sIdx) => {
      if (skill.trigger && skill.trigger.t === 'every_secs') {
        enemySchedulable.push({ ownerUid: e.raw.ownerId, ownerId: e.raw.defId, effIdx: sIdx, effect: skill, actor: e.actor, raw: e.raw });
      }
    });
  }
  if (entity) {
    entity.skills.forEach((skill, sIdx) => {
      if (skill.trigger && skill.trigger.t === 'every_secs') {
        enemySchedulable.push({ ownerUid: entity.ownerId, ownerId: entity.id, effIdx: sIdx, effect: skill, actor: makeEnemyActor(entity), raw: entity });
      }
    });
  }
  for (const s of enemySchedulable) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, t0, 1.0);

  // ---- Status tick scheduling: a lightweight periodic tick event drives
  // Burn/Poison/Regen/Chill/Stun/Weakness/Haste countdown for ALL actors
  // (S7). Scheduled at STATUS_TICK_PERIOD_SECS cadence.
  // REQ-0048: battle_start pulse openers -- emit once at t0 (mode-gated).
  for (const po of partyPos) {
    for (const eff of (po.effects || [])) {
      if (eff.trigger && eff.trigger.t === 'battle_start' && eff.verb && eff.verb.t === 'pulse') {
        const modes = eff.modes || (po.def && po.def.modes) || ['battle'];
        if (!modes.includes(encounterDef.mode)) continue;
        const pOut = [];
        emitPulse(po.bpId, t0, pOut);
        for (const re of pOut) events.push(Object.assign({ t: t0, seq: heap.nextSeq() }, re));
      }
    }
  }
  heap.push({ t: t0 + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });

  const timeoutSecs = encounterDef.timeout_secs;
  const deadlineSecs = encounterDef.deadline_secs || (timeoutSecs != null ? timeoutSecs + 0.001 : 600);
  let result = null;
  let discoveredEntity = false;

  function allEnemiesDead() {
    return enemyActors.length > 0 && enemyActors.every(e => !e.actor.alive);
  }
  function partyWiped() {
    return playerActors.every(a => !a.alive);
  }

  let guardIters = 0;
  while (heap.size() > 0 && guardIters < 200000) {
    guardIters++;
    const ev = heap.popMin();
    if (ev.t > deadlineSecs) break;

    if (ev.kind === 'status_tick') {
      for (const a of playerActors) if (a.alive) tickAndEmit(a, ev.t, events);
      for (const e of enemyActors) if (e.actor.alive) tickAndEmit(e.actor, ev.t, events);
      if (entity && entity.alive) tickAndEmit(makeEnemyActor(entity), ev.t, events);
      heap.push({ t: ev.t + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });
    } else if (ev.kind === 'skill_fire') {
      const isPlayerSide = schedulable.some(s => s.ownerUid === ev.ownerUid && s.effIdx === ev.effIdx);
      if (isPlayerSide) {
        const s = schedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s.modes.includes(encounterDef.mode) && s.effect.verb && s.effect.verb.t === 'pulse') {
          // REQ-0048: a "spark" (every_secs pulse) emits along the BP's links.
          const spo = partyPos.find(p => p.uid === s.ownerUid);
          const pOut = [];
          if (spo) emitPulse(spo.bpId, ev.t, pOut);
          for (const re of pOut) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        } else if (s.modes.includes(encounterDef.mode)) {
          const attacker = { fieldCells: unionCells(playerActorsInSameBpAs(s.ownerUid, partyPos, playerActors)), ownerId: s.ownerId, bonusVsStatus: bonusVsStatusForOwnerUid(s.ownerUid, partyPos, partyBps) };
          const lead = TUNABLES.TELEGRAPH_LEAD_SECS;
          // telegraph is derived + emitted at fire-time as an informational
          // preview line (S4.5) since this is a server-authoritative batch
          // sim, not a live monitor stream; we emit it immediately before
          // ray_fire with fires_at = ev.t (lead is a DISPLAY concern for a
          // live monitor UI, not a sim-timing concern -- documented interp).
          events.push({ t: Math.max(0, ev.t - lead), seq: heap.nextSeq(), ev: 'telegraph', src: s.ownerId, skill: s.effect.verb.t, edge: (s.attackProfile.edge || ['top'])[0], fires_at: ev.t });
          const rayEvents = [];
          const fr = fireSkillRay({
            attacker, attackProfile: s.attackProfile, verbEff: s.effect, mode: encounterDef.mode,
            targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
            rng, streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t, events: rayEvents, aoeStatuses: !!s.attackProfile.aoe_statuses,
          });
          for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
          if (encounterDef.mode === 'detection' && rayEvents.some(r => r.ev === 'ray_hit' && r.dst !== '?')) {
            discoveredEntity = true;
          }
          // REQ-0078 reactive (defensive): enemies that took a DIRECT hit fire
          // their OnUnitBeenHit skills as a retaliation ray at the player field.
          // Depth-1 (retaliation hits are not re-dispatched); isolated RNG keeps
          // existing golden streams byte-identical.
          const reactDef = [];
          for (const lh of (fr.landedHits || [])) {
            const ent = enemyActors.find(e => e.actor === lh.actor);
            if (!ent || !ent.actor.alive) continue;
            for (const sk of (ent.raw.skills || [])) {
              if (!sk.trigger || sk.trigger.t !== 'OnUnitBeenHit') continue;
              const ap = sk.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
              reactDef.push({ ev: 'reactive_proc', trigger: 'OnUnitBeenHit', verb: sk.verb.t, src: ent.raw.ownerId });
              fireSkillRay({
                attacker: { fieldCells: ent.raw.fieldCells, ownerId: ent.raw.ownerId + '#react', bonusVsStatus: ent.raw.bonusVsStatus || [] },
                attackProfile: ap, verbEff: sk, mode: 'battle',
                targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
                rng, streamPrefix: 'reactive/OnUnitBeenHit/' + ent.raw.ownerId + '/' + ev.t,
                events: reactDef, aoeStatuses: !!ap.aoe_statuses,
              });
            }
          }
          for (const re of reactDef) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
          const playerOff = [];
          dispatchPlayerOffensive(s.ownerUid, (fr.landedHits || []).map(lh => lh.actor), ev.t, playerOff);
          for (const re of playerOff) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        }
        // reschedule regardless of match (pause = simply not fired above;
        // rescheduling from ev.t keeps cadence continuous while matching)
        scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);
      } else {
        const s = enemySchedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s && s.raw.alive) {
          const attackProfile = s.effect.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
          const attacker = { fieldCells: s.raw.fieldCells, ownerId: s.ownerId, bonusVsStatus: s.raw.bonusVsStatus || [] };
          const lead = TUNABLES.TELEGRAPH_LEAD_SECS;
          events.push({ t: Math.max(0, ev.t - lead), seq: heap.nextSeq(), ev: 'telegraph', src: s.ownerId, skill: s.effect.verb.t, edge: (attackProfile.edge || ['top'])[0], fires_at: ev.t });
          const rayEvents = [];
          const fr = fireSkillRay({
            attacker, attackProfile, verbEff: s.effect, mode: 'battle',
            targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
            rng, streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t, events: rayEvents, aoeStatuses: !!attackProfile.aoe_statuses,
          });
          for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
          // REQ-0078 reactive (offensive rider): this monster's OnHit/OnUnitHit
          // skills fire on each player actor its attack just directly hit
          // (OnHit == OnUnitHit for a flat monster unit); isolated RNG.
          const reactOff = [];
          for (const sk of (s.raw.skills || [])) {
            if (!sk.trigger || (sk.trigger.t !== 'OnHit' && sk.trigger.t !== 'OnUnitHit')) continue;
            (fr.landedHits || []).forEach((lh, li) => {
              const rs = rng.stream('reactive/' + sk.trigger.t + '/' + s.ownerUid + '/' + ev.t + '/' + li);
              applyReactiveVerbToTarget(sk.verb, s.actor, lh.actor, rs, reactOff, sk.trigger.t);
            });
          }
          for (const re of reactOff) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
          const playerDef = [];
          dispatchPlayerDefensive((fr.landedHits || []).map(lh => lh.actor), ev.t, playerDef);
          for (const re of playerDef) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        }
        if (s && s.raw.alive) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);
      }
    } else if (ev.kind === 'pulse_arrive') {
      const toActor = playerBpActorById(ev.to);
      if (!toActor || !toActor.alive) {
        events.push({ t: ev.t, seq: heap.nextSeq(), ev: 'pulse_fizzle', reason: 'dead_target', origin: ev.origin, to: ev.to });
      } else {
        events.push({ t: ev.t, seq: heap.nextSeq(), ev: 'link_pulse', from: ev.from, to: ev.to, hop: ev.hop, origin: ev.origin });
        const payloadOut = [];
        firePulsePayloads(ev.to, ev, payloadOut);
        for (const re of payloadOut) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        if (ev.hop < PULSE_HOP_BUDGET) {
          for (const e of (toActor.ref.linkOut || [])) {
            if (ev.visited.includes(e.to)) continue;
            schedulePulseArrive({ origin: ev.origin, from: ev.to, to: e.to, hop: ev.hop + 1, visited: ev.visited.concat([ev.to]) }, ev.t);
          }
        }
      }
    }

    if (encounterDef.type === 'pack' || encounterDef.type === 'boss') {
      if (allEnemiesDead()) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'trap') {
      if (discoveredEntity) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'door') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'chest') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    }
  }

  if (!result) {
    // timeout/deadline path per S6 encounter table.
    if (encounterDef.type === 'trap' && !discoveredEntity) {
      // "trap fires its skill payload ONCE (a battle-style volley on the
      // player field, rolled), then encounter ends. No disarm step."
      if (entity && entity.skills.length > 0) {
        const skill = entity.skills[0];
        const attackProfile = skill.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
        const attacker = { fieldCells: entity.fieldCells, ownerId: entity.id, bonusVsStatus: entity.bonusVsStatus || [] };
        const rayEvents = [];
        fireSkillRay({
          attacker, attackProfile, verbEff: skill, mode: 'battle',
          targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
          rng, streamPrefix: 'trap-timeout/' + encounterDef.id, events: rayEvents, aoeStatuses: !!attackProfile.aoe_statuses,
        });
        for (const re of rayEvents) events.push(Object.assign({ t: timeoutSecs, seq: heap.nextSeq() }, re));
      }
      result = partyWiped() ? 'wipe' : 'timeout';
    } else if (encounterDef.type === 'door') {
      result = 'timeout_break'; // "keyhole breaks": forced end, no shortcut
    } else if (encounterDef.type === 'chest') {
      result = 'timeout_lost'; // chest lost, no penalty
    } else if (encounterDef.type === 'pack') {
      result = partyWiped() ? 'wipe' : 'pressure_timeout'; // no forced win
    } else {
      result = partyWiped() ? 'wipe' : 'timeout';
    }
  }

  events.push({ t: heap.size() ? heap.a[0].t : deadlineSecs, seq: heap.nextSeq(), ev: 'encounter_end', enc: encIndex, result, party_bp_hp: partyBps.map(b => b.hp) });
  return { events, result, discoveredEntity, entity };
}

function tickAndEmit(actor, t, events) {
  const ticks = tickStatuses(actor.statusBag, TUNABLES.STATUS_TICK_PERIOD_SECS);
  for (const tk of ticks) {
    if (tk.kind === 'damage') { actor.applyDamage(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); }
    else if (tk.kind === 'heal') { actor.heal(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); }
  }
}

function unionCells(actorsOrCellsArrays) {
  const out = [];
  for (const item of actorsOrCellsArrays) {
    if (Array.isArray(item)) out.push(...item);
    else if (item && item.fieldCells) out.push(...item.fieldCells);
  }
  return out.length ? out : [[9, 13]]; // fallback center-ish cell if empty
}

function playerActorsInSameBpAs(ownerUid, partyPos, playerActors) {
  const po = partyPos.find(p => p.uid === ownerUid);
  if (!po) return [];
  const bpActor = playerActors.find(a => a.id === po.bpId);
  return bpActor ? [bpActor.fieldCells] : [];
}

// REQ-0093: looks up the owning BP's compiled bonusVsStatus list (folded
// at compile time in compile.cjs) for a firing PO's ownerUid.
function bonusVsStatusForOwnerUid(ownerUid, partyPos, partyBps) {
  const po = partyPos.find(p => p.uid === ownerUid);
  if (!po) return [];
  const bp = partyBps.find(b => b.id === po.bpId);
  return (bp && bp.bonusVsStatus) || [];
}


module.exports = {
  runEncounter,
  tickAndEmit,
  unionCells,
  playerActorsInSameBpAs,
  bonusVsStatusForOwnerUid,
};
