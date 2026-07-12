'use strict';
// sim/lib/encounter.cjs -- REQ-0047 (d): runEncounter -- the event-driven encounter loop.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES, deepCopy } = require('./core.cjs');
const { EventHeap } = require('./heap.cjs');
const { freshStatusBag, tickStatuses, foldBattleStartStatusVerbs } = require('./status.cjs');
const { registerHpBelowWatchers, foldFlatBonusInPlace } = require('./hpbelow.cjs'); // REQ-0121
const { FIELD_ROWS, FIELD_COLS } = require('./field.cjs');
const { maskLabel } = require('./replay.cjs');
const { effectStreamName, makeBPActor, makeEnemyActor, fireSkillRay, scheduleEffect, defaultAttackProfileFor, applyReactiveVerbToTarget } = require('./skills.cjs');
const { compileEnemyPack } = require('./packs.cjs');

function runEncounter(opts) {
  const {
    rng, encIndex, troopBps, troopPos, troopSis, formationBox, enemyDefsById, skillDefsById,
    encounterDef, seedLabel,
  } = opts;
  const events = [];
  const heap = new EventHeap();
  const t0 = 0; // encounter-local time origin
  events.push({ t: t0, seq: heap.nextSeq(), ev: 'encounter_start', enc: encIndex, kind: encounterDef.type, seed: seedLabel, formation: formationBox.formationId });

  // ---- Build player-side actors (BPs already compiled + persistent HP) ----
  const playerActors = troopBps.map(makeBPActor);
  // Player-side schedulable effects: every PO's effects with an every_secs
  // trigger (host_on_hit/on_hit/passive/battle_start handled at compile
  // time or as immediate reactive hooks -- for the sim's scope here we
  // schedule every_secs-triggered verbs, which covers all of batch-002's
  // and live_items.json's damage-dealing content).
  const schedulable = [];
  for (const po of troopPos) {
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
    let entitySkills = (ed.skills || []).map(sid => skillDefsById[sid]).filter(Boolean);
    // REQ-0121: same instance-copy rule as packs.cjs -- buff_self mutates
    // this instance's skill ranges, so never share content defs.
    if (entitySkills.some(s => s && s.verb && s.verb.t === 'buff_self')) entitySkills = deepCopy(entitySkills);
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

  // ---- REQ-0121: on_hp_below watcher registration ----------------------
  // simNow tracks the encounter-local time of the event being processed so
  // watcher fires (which happen deep inside applyDamage) can stamp honest
  // timestamps on their passive_proc events.
  let simNow = t0;
  function makeHpBelowWatcher(key, skillOrEff, srcLabel, foldTargetList, streamName) {
    const frac = skillOrEff.trigger.hp_frac;
    const verb = skillOrEff.verb;
    return {
      key, frac,
      onFire(ref) {
        // Only buff_self (stat:'damage') is a supported on_hp_below payload
        // in this REQ (matches batch-004's usage; other verbs would need
        // their own fire-time semantics -- documented, not silently faked).
        if (verb && verb.t === 'buff_self' && verb.stat === 'damage' && Array.isArray(verb.n)) {
          const amount = rng.stream(streamName).range(verb.n[0], verb.n[1]);
          foldFlatBonusInPlace(foldTargetList(), amount);
          events.push({ t: simNow, seq: heap.nextSeq(), ev: 'passive_proc', trigger: 'on_hp_below', verb: verb.t, src: srcLabel, frac, amount });
        }
      },
    };
  }
  for (const e of enemyActors) {
    const watchers = [];
    (e.raw.skills || []).forEach((sk, sIdx) => {
      if (sk && sk.trigger && sk.trigger.t === 'on_hp_below') {
        watchers.push(makeHpBelowWatcher('enemy/' + e.raw.ownerId + '/' + sIdx + '/' + sk.trigger.hp_frac, sk, e.raw.ownerId, () => e.raw.skills, 'hpbelow/' + e.raw.ownerId + '/' + sIdx));
      }
    });
    if (watchers.length) registerHpBelowWatchers(e.raw, watchers);
  }
  if (entity) {
    const watchers = [];
    (entity.skills || []).forEach((sk, sIdx) => {
      if (sk && sk.trigger && sk.trigger.t === 'on_hp_below') {
        watchers.push(makeHpBelowWatcher('entity/' + entity.ownerId + '/' + sIdx + '/' + sk.trigger.hp_frac, sk, maskLabel(entity), () => entity.skills, 'hpbelow/' + entity.ownerId + '/' + sIdx));
      }
    });
    if (watchers.length) registerHpBelowWatchers(entity, watchers);
  }
  // Player side (domain ruling, REQ-0121): a PO's on_hp_below watches its
  // OWNING BP's hp/hpMax; the buff folds onto that PO's OWN damage verbs.
  // Watcher keys are stable across encounters and fired-state lives on the
  // persistent bp object, so "once ever" means once per RUN here (the
  // folded mutation on po.effects persists too -- fold-once matches
  // buff-once). Registration replaces the list each encounter; fired-state
  // survives (see hpbelow.cjs).
  {
    // NOTE: bp ids can repeat across squads (runDungeon flatMaps 4 squads
    // compiled from possibly-identical snapshots), so the owning BP is
    // resolved by (id AND squadSlot); plain id is the fallback for direct
    // runEncounter callers that never tagged squadSlot.
    const watchersByBp = new Map(); // bp OBJECT -> watcher list
    for (const po of troopPos) {
      (po.effects || []).forEach((eff, effIdx) => {
        if (eff && eff.trigger && eff.trigger.t === 'on_hp_below' && po.bpId) {
          const bp = troopBps.find(b => b.id === po.bpId && (po.squadSlot == null || b.squadSlot === po.squadSlot));
          if (!bp) return;
          const list = watchersByBp.get(bp) || [];
          list.push(makeHpBelowWatcher('po/' + (po.squadSlot || '') + '/' + po.uid + '/' + effIdx + '/' + eff.trigger.hp_frac, eff, po.id, () => po.effects, 'hpbelow/' + (po.squadSlot || '') + '/' + po.uid + '/' + effIdx));
          watchersByBp.set(bp, list);
        }
      });
    }
    for (const [bp, list] of watchersByBp) registerHpBelowWatchers(bp, list);
  }

  // ---- REQ-0095: player-side reactive dispatch (Phase 1b) -- mirrors the enemy side. ----
  function bpActorOf(bpId) { return playerActors.find(a => a.id === bpId) || null; }
  // Offensive riders: when player PO `firingPoUid` lands a DIRECT hit on enemies, its
  // OnHit (self) / OnBPHierarchyHit (same BP) / OnSquadHit (same squad) effects ride each hit.
  function dispatchPlayerOffensive(firingPoUid, landedEnemies, t, outEvents) {
    const fpo = troopPos.find(p => p.uid === firingPoUid);
    if (!fpo || !landedEnemies.length) return;
    let idx = 0;
    for (const po of troopPos) {
      for (const eff of (po.effects || [])) {
        const tt = eff.trigger && eff.trigger.t;
        const match = (tt === 'OnHit' && po.uid === fpo.uid) ||
                      (tt === 'OnBPHierarchyHit' && po.bpId === fpo.bpId) ||
                      (tt === 'OnSquadHit' && po.squadSlot === fpo.squadSlot);
        if (!match) continue;
        const owner = bpActorOf(po.bpId);
        for (const en of landedEnemies) {
          const rs = rng.stream('reactive/' + tt + '/' + po.uid + '/' + t + '/' + (idx++));
          applyReactiveVerbToTarget(eff.verb, owner, en, rs, outEvents, tt);
        }
      }
    }
    // REQ-0095: OnPOHit -- an SI seated in the firing PO fires when its host PO lands a hit.
    for (const si of (troopSis || [])) {
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
  // squad (OnSquadBeenHit) fire a retaliation ray at the enemy field.
  function dispatchPlayerDefensive(hitBpActors, t, outEvents) {
    for (const bpA of hitBpActors) {
      const bpId = bpA.id, squad = bpA.ref && bpA.ref.squadSlot;
      for (const po of troopPos) {
        const inBp = po.bpId === bpId, inSquad = (squad != null && po.squadSlot === squad);
        for (const eff of (po.effects || [])) {
          const tt = eff.trigger && eff.trigger.t;
          if (!((tt === 'OnBPBeenHit' && inBp) || (tt === 'OnSquadBeenHit' && inSquad))) continue;
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
  heap.push({ t: t0 + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });

  const timeoutSecs = encounterDef.timeout_secs;
  const deadlineSecs = encounterDef.deadline_secs || (timeoutSecs != null ? timeoutSecs + 0.001 : 600);
  let result = null;
  let discoveredEntity = false;

  function allEnemiesDead() {
    return enemyActors.length > 0 && enemyActors.every(e => !e.actor.alive);
  }
  function troopWiped() {
    return playerActors.every(a => !a.alive);
  }

  let guardIters = 0;
  while (heap.size() > 0 && guardIters < 200000) {
    guardIters++;
    const ev = heap.popMin();
    if (ev.t > deadlineSecs) break;
    simNow = ev.t; // REQ-0121: honest timestamps for on_hp_below fires

    if (ev.kind === 'status_tick') {
      for (const a of playerActors) if (a.alive) tickAndEmit(a, ev.t, events);
      for (const e of enemyActors) if (e.actor.alive) tickAndEmit(e.actor, ev.t, events);
      if (entity && entity.alive) tickAndEmit(makeEnemyActor(entity), ev.t, events);
      heap.push({ t: ev.t + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });
    } else if (ev.kind === 'skill_fire') {
      const isPlayerSide = schedulable.some(s => s.ownerUid === ev.ownerUid && s.effIdx === ev.effIdx);
      if (isPlayerSide) {
        const s = schedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s.modes.includes(encounterDef.mode)) {
          const attacker = { fieldCells: unionCells(playerActorsInSameBpAs(s.ownerUid, troopPos, playerActors)), ownerId: s.ownerId, bonusVsStatus: bonusVsStatusForOwnerUid(s.ownerUid, troopPos, troopBps) };
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
          // their OnSquadBeenHit skills as a retaliation ray at the player field.
          // Depth-1 (retaliation hits are not re-dispatched); isolated RNG keeps
          // existing golden streams byte-identical.
          const reactDef = [];
          for (const lh of (fr.landedHits || [])) {
            const ent = enemyActors.find(e => e.actor === lh.actor);
            if (!ent || !ent.actor.alive) continue;
            for (const sk of (ent.raw.skills || [])) {
              if (!sk.trigger || sk.trigger.t !== 'OnSquadBeenHit') continue;
              const ap = sk.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
              reactDef.push({ ev: 'reactive_proc', trigger: 'OnSquadBeenHit', verb: sk.verb.t, src: ent.raw.ownerId });
              fireSkillRay({
                attacker: { fieldCells: ent.raw.fieldCells, ownerId: ent.raw.ownerId + '#react', bonusVsStatus: ent.raw.bonusVsStatus || [] },
                attackProfile: ap, verbEff: sk, mode: 'battle',
                targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
                rng, streamPrefix: 'reactive/OnSquadBeenHit/' + ent.raw.ownerId + '/' + ev.t,
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
          // REQ-0078 reactive (offensive rider): this monster's OnHit/OnSquadHit
          // skills fire on each player actor its attack just directly hit
          // (OnHit == OnSquadHit for a flat monster squad); isolated RNG.
          const reactOff = [];
          for (const sk of (s.raw.skills || [])) {
            if (!sk.trigger || (sk.trigger.t !== 'OnHit' && sk.trigger.t !== 'OnSquadHit')) continue;
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
    }

    if (encounterDef.type === 'pack' || encounterDef.type === 'boss') {
      if (allEnemiesDead()) { result = 'clear'; break; }
      if (troopWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'trap') {
      if (discoveredEntity) { result = 'clear'; break; }
      if (troopWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'door') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (troopWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'chest') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (troopWiped()) { result = 'wipe'; break; }
    }
  }

  if (!result) {
    // timeout/deadline path per S6 encounter table.
    if (encounterDef.type === 'trap' && !discoveredEntity) {
      // "trap fires its skill payload ONCE (a battle-style volley on the
      // player field, rolled), then encounter ends. No disarm step."
      if (entity && entity.skills.length > 0) {
        if (timeoutSecs != null) simNow = timeoutSecs; // REQ-0121
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
      result = troopWiped() ? 'wipe' : 'timeout';
    } else if (encounterDef.type === 'door') {
      result = 'timeout_break'; // "keyhole breaks": forced end, no shortcut
    } else if (encounterDef.type === 'chest') {
      result = 'timeout_lost'; // chest lost, no penalty
    } else if (encounterDef.type === 'pack') {
      result = troopWiped() ? 'wipe' : 'pressure_timeout'; // no forced win
    } else {
      result = troopWiped() ? 'wipe' : 'timeout';
    }
  }

  events.push({ t: heap.size() ? heap.a[0].t : deadlineSecs, seq: heap.nextSeq(), ev: 'encounter_end', enc: encIndex, result, troop_bp_hp: troopBps.map(b => b.hp) });
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

function playerActorsInSameBpAs(ownerUid, troopPos, playerActors) {
  const po = troopPos.find(p => p.uid === ownerUid);
  if (!po) return [];
  const bpActor = playerActors.find(a => a.id === po.bpId);
  return bpActor ? [bpActor.fieldCells] : [];
}

// REQ-0093: looks up the owning BP's compiled bonusVsStatus list (folded
// at compile time in compile.cjs) for a firing PO's ownerUid.
function bonusVsStatusForOwnerUid(ownerUid, troopPos, troopBps) {
  const po = troopPos.find(p => p.uid === ownerUid);
  if (!po) return [];
  const bp = troopBps.find(b => b.id === po.bpId);
  return (bp && bp.bonusVsStatus) || [];
}


module.exports = {
  runEncounter,
  tickAndEmit,
  unionCells,
  playerActorsInSameBpAs,
  bonusVsStatusForOwnerUid,
};
