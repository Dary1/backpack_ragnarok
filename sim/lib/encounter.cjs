'use strict';
// sim/lib/encounter.cjs -- REQ-0047 (d): runEncounter -- the event-driven encounter loop.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES, deepCopy } = require('./core.cjs');
const { EventHeap } = require('./heap.cjs');
const { freshStatusBag, tickStatuses, foldBattleStartStatusVerbs, applyStatus, cadenceMultiplier, DEBUFF_STATUSES } = require('./status.cjs'); // REQ-0200: cadenceMultiplier for real haste; REQ-0212: DEBUFF_STATUSES for transfer_status
const { registerHpBelowWatchers, foldFlatBonusInPlace } = require('./hpbelow.cjs'); // REQ-0121
const { FIELD_ROWS, FIELD_COLS } = require('./field.cjs');
const { maskLabel } = require('./replay.cjs');
const { effectStreamName, makeBPActor, makeEnemyActor, fireSkillRay, scheduleEffect, defaultAttackProfileFor, applyReactiveVerbToTarget, selectHealAllyTarget } = require('./skills.cjs');
const { compileEnemyPack } = require('./packs.cjs');
const { createEncounterChargeManager } = require('./unit_charge_encounter.cjs'); // REQ-0200

function runEncounter(opts) {
  const {
    rng, encIndex, troopBps, troopPos, troopSis, formationBox, enemyDefsById, skillDefsById,
    encounterDef, seedLabel,
    // REQ-0184: monster_pack defs by id, for encounters that name one via packId.
    // NOT `packDefsById` -- that name is already taken, by REQ-0170's GACHA pack
    // registry (server/services/core.cjs getScheduleContent). Two different things
    // called `packDefsById` in one opts bag is a bug waiting for a careless
    // destructure to feed emission pools to the monster placer.
    monsterPackDefsById,
  } = opts;
  const events = [];
  const heap = new EventHeap();
  const t0 = 0; // encounter-local time origin
  events.push({ t: t0, seq: heap.nextSeq(), ev: 'encounter_start', enc: encIndex, kind: encounterDef.type, seed: seedLabel, formation: formationBox.formationId });

  // ---- Build player-side actors (BPs already compiled + persistent HP) ----
  const playerActors = troopBps.map(makeBPActor);

  // ---- REQ-0200: unit charge manager. Guarded -- built ONLY when some troop BP
  // carries a `charge` block. No live unit does yet, so chargeMgr stays null on all
  // current content: every hook below is skipped and the event stream / goldens stay
  // byte-identical. The runtime uses no RNG and this adapter consumes no rng stream,
  // so even a charge-BEARING encounter's non-charge events are byte-identical to the
  // same encounter without charge -- the only added events are unit_charge_*.
  const chargeBps = troopBps.filter(b => b && b.charge);
  const chargeClock = { now: t0 };
  // REQ-0200: real-actor ops the charge manager invokes for effects that must run
  // through the encounter loop itself -- a real strike ray into the enemy side, an
  // immediate item re-fire, and an item-cooldown advance on the event heap. (The
  // methods are only ever called from inside the loop, so referencing the
  // later-declared schedulable/enemyActorList is safe.) All charge-guarded: no live
  // unit carries charge, so none of this runs on current content.
  let chargeStrikeSeq = 0;
  const chargeOps = {
    strikeFromBp(bpId, perHit, hits, t) {
      const bp = troopBps.find(b => b.id === bpId);
      if (!bp) return;
      const verb = hits > 1 ? { t: 'multi_strike', n: [perHit, perHit], hits } : { t: 'strike', n: [perHit, perHit] };
      const ap = defaultAttackProfileFor({});
      const attacker = { fieldCells: bp.fieldCells, ownerId: 'charge#' + bpId, bonusVsStatus: bp.bonusVsStatus || [], outgoingBuffPct: bp.chargeDmgBuffPct || 0 };
      const rayEvents = [];
      fireSkillRay({
        attacker, attackProfile: ap, verbEff: { verb }, mode: encounterDef.mode,
        targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
        rng, streamPrefix: 'charge-strike/' + bpId + '/' + t + '/' + (chargeStrikeSeq++), events: rayEvents, aoeStatuses: false,
      });
      for (const re of rayEvents) events.push(Object.assign({ t, seq: heap.nextSeq(), cause: 'charge' }, re));
    },
    fireItems(bpId, tag, t) {
      const bp = troopBps.find(b => b.id === bpId);
      if (!bp) return;
      for (const s of schedulable) {
        const po = troopPos.find(p => p.uid === s.ownerUid);
        if (!po || po.bpId !== bpId) continue;
        if (tag && !((po.def.tags || []).includes(tag))) continue;
        if (!s.effect.verb || (s.effect.verb.t !== 'strike' && s.effect.verb.t !== 'multi_strike')) continue;
        const attacker = { fieldCells: bp.fieldCells, ownerId: po.id + '#charge-fire', bonusVsStatus: bp.bonusVsStatus || [], outgoingBuffPct: bp.chargeDmgBuffPct || 0 };
        const rayEvents = [];
        fireSkillRay({
          attacker, attackProfile: s.attackProfile, verbEff: s.effect, mode: encounterDef.mode,
          targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
          rng, streamPrefix: 'charge-fire/' + bpId + '/' + po.uid + '/' + t + '/' + (chargeStrikeSeq++), events: rayEvents, aoeStatuses: !!s.attackProfile.aoe_statuses,
        });
        for (const re of rayEvents) events.push(Object.assign({ t, seq: heap.nextSeq(), cause: 'charge' }, re));
      }
    },
    advanceCooldown(bpId, n, t) {
      const uids = new Set(troopPos.filter(p => p.bpId === bpId).map(p => p.uid));
      if (!uids.size) return;
      let changed = false;
      for (const e of heap.a) {
        if (e.kind === 'skill_fire' && uids.has(e.ownerUid)) {
          const nt = Math.max(t, e.t - n);
          if (nt !== e.t) { e.t = nt; changed = true; }
        }
      }
      if (changed) { const items = heap.a.splice(0); for (const it of items) heap.push(it); }
    },
    // REQ-0212: transfer_status -- MOVE up to n negative statuses (Burn/Poison/Chill/Weakness/
    // Stun) from the host BP's status bag onto the first living enemy, each keeping its remaining
    // stacks/duration (a MOVE: removed from the host). Respects enemy status immunity.
    transferStatus(bpId, n, t) {
      const bp = troopBps.find(b => b.id === bpId);
      if (!bp || !bp.statusBag) return;
      const enemies = enemyActorList().filter(a => a && a.alive && a.kind === 'enemy');
      if (!enemies.length) return;
      const target = enemies[0]; // first living enemy (deterministic list order)
      const budget = Math.max(0, Math.floor(n));
      let moved = 0;
      for (const st of DEBUFF_STATUSES) { // fixed order: Burn, Poison, Chill, Weakness, Stun
        if (moved >= budget) break;
        const cur = bp.statusBag[st];
        if (!cur) continue;
        delete bp.statusBag[st]; // leaves the host
        if (!(target.statusBag._immune && target.statusBag._immune.has(st))) {
          const d = target.statusBag[st];
          if (!d) { target.statusBag[st] = Object.assign({}, cur); } // transplant: keeps stacks/remain
          else {
            if (cur.stacks != null) d.stacks = (d.stacks || 0) + cur.stacks;
            if (cur.remain != null) d.remain = Math.max(d.remain || 0, cur.remain);
          }
        }
        moved++;
        events.push({ t, seq: heap.nextSeq(), cause: 'charge', ev: 'unit_charge_transfer', src: bpId, dst: target.id, status: st, stacks: (cur.stacks != null ? cur.stacks : null), remain: (cur.remain != null ? cur.remain : null) });
      }
    },
    // REQ-0212: shield_break -- strip up to n points of flat block (ref.damageReduction, the
    // enemy's active block pool the damage pipeline reads) from every living enemy, floored at 0.
    // No damage.
    breakShield(bpId, n, t) {
      const amt = Math.max(0, n);
      if (!amt) return;
      for (const a of enemyActorList()) {
        if (!a || !a.alive || a.kind !== 'enemy') continue;
        const ref = a.ref || {};
        const before = ref.damageReduction || 0;
        if (before <= 0) continue;
        const after = Math.max(0, before - amt);
        if (after === before) continue;
        ref.damageReduction = after;
        events.push({ t, seq: heap.nextSeq(), cause: 'charge', ev: 'unit_charge_shieldbreak', src: bpId, dst: a.id, before, after });
      }
    },
  };
  const chargeMgr = chargeBps.length
    ? createEncounterChargeManager({ chargeBps, troopBps, troopPos, playerActors, events, heap, clock: chargeClock, ops: chargeOps })
    : null;
  function feedCharge(ev, t) { if (chargeMgr) chargeMgr.feed(ev, t); }
  // REQ-0200: a firing player BP's real Haste/Chill net cadence (only when a charge
  // manager exists -> charge-less reschedules stay hard-coded 1.0 -> byte-identical).
  function playerCadenceMult(ownerUid) {
    const po = troopPos.find(p => p.uid === ownerUid);
    const bp = po && troopBps.find(b => b.id === po.bpId);
    // Floor the net multiplier at 0.2 (<=5x cadence): unbounded Haste stacks would
    // otherwise drive the interval to zero/negative -> same-tick refire storm (a
    // determinism/DoS hazard the sim never had while POs ignored Haste). Documented guard.
    return bp ? Math.max(0.2, cadenceMultiplier(bp.statusBag)) : 1.0;
  }
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
    // REQ-0184: the PLACEABLE area is B2:Y17 (24x16) -- the 26x18 field carries a
    // margin of 1, the same box formations.json draws player canvases in. This box
    // used to be {1,1,18,26}, the WHOLE plane, so every enemy in the game stood ON
    // the margin (frost_gnoll at A1). The user ruled 2026-07-15 that 24x16 is canon
    // and the margin-riding was the bug; correcting it moves the goldens by a
    // uniform +1 row / +1 col, and by nothing else.
    const enemyFieldBox = { rowMin: 2, colMin: 2, rowMax: FIELD_ROWS - 1, colMax: FIELD_COLS - 1 };
    // REQ-0184: an encounter may name a monster_pack def by id instead of inlining
    // enemyIds. The packId spelling is what REQ-0185 (dungeons as pre-generated
    // content) builds on; the inline spelling is what dungen.cjs still emits.
    let packDef = encounterDef.enemyPack;
    if (packDef.packId) {
      const resolved = monsterPackDefsById && monsterPackDefsById[packDef.packId];
      if (!resolved) throw new Error('runEncounter: encounter ' + encounterDef.id + ' names monster_pack "' + packDef.packId + '", which has no def');
      packDef = resolved;
    }
    enemyActors = compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, enemyFieldBox).map(en => ({ raw: en, actor: makeEnemyActor(en) }));
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

  // ---- REQ-0049: Layered encounters -- trap/chest/door attachments run in
  // PARALLEL with the pack on the battle clock. Additive: only active when
  // encounterDef.attachments is present, so attachment-free content stays
  // byte-identical (goldens). Mode-pure by construction: attachment POs
  // (detection/unlock) resolve ONLY against attachments; battle rays only
  // ever target enemies -> neither can touch the other's occupants.
  const ATTACH_CAP = 2; // [TUNABLE <=2 attachments per encounter]
  const attachments = [];
  if (Array.isArray(encounterDef.attachments) && encounterDef.attachments.length) {
    const occ = new Set();
    for (const e of enemyActors) for (const c of e.raw.fieldCells) occ.add(c[0] + ',' + c[1]);
    const freeCells = [];
    for (let r = 1; r <= FIELD_ROWS; r++) for (let c = 1; c <= FIELD_COLS; c++) if (!occ.has(r + ',' + c)) freeCells.push([r, c]);
    const cR = (1 + FIELD_ROWS) / 2, cC = (1 + FIELD_COLS) / 2;
    const placeStream = rng.stream('attach/' + encIndex + '/placement');
    const claimed = new Set();
    const fits = (r, c, fh, fw) => {
      for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) {
        const rr = r + dr, cc = c + dc, k = rr + ',' + cc;
        if (rr > FIELD_ROWS || cc > FIELD_COLS || occ.has(k) || claimed.has(k)) return false;
      }
      return true;
    };
    const takeCluster = (fh, fw, centerMost) => {
      const anchors = freeCells.filter(([r, c]) => fits(r, c, fh, fw));
      if (!anchors.length) return null;
      let anchor;
      if (centerMost) {
        anchors.sort((a, b) => (Math.abs(a[0] - cR) + Math.abs(a[1] - cC)) - (Math.abs(b[0] - cR) + Math.abs(b[1] - cC)) || (a[0] - b[0]) || (a[1] - b[1]));
        anchor = anchors[0];
      } else {
        anchor = anchors[Math.floor(placeStream.next() * anchors.length)];
      }
      const cells = [];
      for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) { cells.push([anchor[0] + dr, anchor[1] + dc]); claimed.add((anchor[0] + dr) + ',' + (anchor[1] + dc)); }
      return cells;
    };
    for (const adef of encounterDef.attachments.slice(0, ATTACH_CAP)) {
      const ent = adef.entity || {};
      const fp = ent.footprint || [1, 1];
      const isTrap = adef.kind === 'trap';
      const cells = takeCluster(fp[0], fp[1], !isTrap);
      if (!cells) continue;
      const skills = (ent.skills || []).map(sid => skillDefsById[sid]).filter(Boolean);
      const hpR = Array.isArray(ent.hp) ? ent.hp : (typeof ent.hp === 'number' ? [ent.hp, ent.hp] : null);
      const hpVal = hpR ? Math.round(rng.stream('attach/' + encIndex + '/' + adef.id + '/hp').range(hpR[0], hpR[1])) : 0;
      attachments.push({
        id: adef.id, kind: adef.kind, mode: adef.mode, reward: adef.reward || null,
        fieldCells: cells, skills, statusBag: freshStatusBag(),
        hp: hpVal, hpMax: hpVal,
        timeout_secs: ent.timeout_secs != null ? ent.timeout_secs : (encounterDef.deadline_secs || 30),
        masked: isTrap, discovered: false, alive: true, settled: false,
        stage: adef.kind === 'door' ? 1 : null, firedVolley: false,
      });
    }
  }
  const hasAtt = attachments.length > 0;
  const attachmentRewards = [];
  let doorShortcut = false;
  function attFireVolley(att, t, reason) {
    if (att.firedVolley) return; att.firedVolley = true;
    events.push({ t, seq: heap.nextSeq(), ev: 'att_fire', att: att.id, kind: att.kind, reason });
    const skill = att.skills[0];
    if (skill) {
      const ap = skill.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
      const rayEvents = [];
      fireSkillRay({
        attacker: { fieldCells: att.fieldCells, ownerId: att.id + '#trap', bonusVsStatus: [] },
        attackProfile: ap, verbEff: skill, mode: 'battle',
        targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
        rng, streamPrefix: 'att-fire/' + encIndex + '/' + att.id + '/' + t, events: rayEvents, aoeStatuses: !!ap.aoe_statuses,
      });
      for (const re of rayEvents) events.push(Object.assign({ t, seq: heap.nextSeq() }, re));
    }
  }
  function resolveDetection(s, t) {
    const targets = attachments.filter(a => a.alive && !a.settled && !a.discovered && (a.kind === 'trap' || (a.kind === 'door' && a.stage === 1)));
    if (!targets.length) return;
    targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const att = targets[0];
    events.push({ t, seq: heap.nextSeq(), ev: 'ray_fire', src: s.ownerId, field: 'enemy', mode: 'detection', entry: att.fieldCells[0].slice() });
    att.discovered = true; att.masked = false;
    events.push({ t, seq: heap.nextSeq(), ev: 'att_reveal', att: att.id, kind: att.kind, at: att.fieldCells[0].slice() });
    if (att.kind === 'trap') {
      att.settled = true; att.alive = false;
      events.push({ t, seq: heap.nextSeq(), ev: 'att_disarm', att: att.id, reward: att.reward ? att.reward.roll : null });
      if (att.reward) attachmentRewards.push(att.reward);
    } else { att.stage = 2; }
  }
  function resolveUnlock(s, t) {
    const targets = attachments.filter(a => a.alive && !a.settled && (a.kind === 'chest' || (a.kind === 'door' && a.stage === 2 && a.discovered)));
    if (!targets.length) return;
    targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const att = targets[0];
    const v = s.effect.verb, ds = rng.stream('unlock/' + s.ownerUid + '/' + s.effIdx + '/' + t);
    let amt = 0;
    if (v.t === 'strike') amt = ds.range(v.n[0], v.n[1]);
    else if (v.t === 'multi_strike') { for (let i = 0; i < v.hits; i++) amt += ds.range(v.n[0], v.n[1]); }
    att.hp = Math.max(0, att.hp - amt);
    events.push({ t, seq: heap.nextSeq(), ev: 'ray_fire', src: s.ownerId, field: 'enemy', mode: 'unlock', entry: att.fieldCells[0].slice() });
    events.push({ t, seq: heap.nextSeq(), ev: 'ray_hit', dst: att.id, amount: amt, hp_after: att.hp, mode: 'unlock' });
    if (att.hp <= 0) {
      att.settled = true; att.alive = false;
      if (att.kind === 'chest') { events.push({ t, seq: heap.nextSeq(), ev: 'att_open', att: att.id, kind: 'chest', reward: att.reward ? att.reward.roll : null }); if (att.reward) attachmentRewards.push(att.reward); }
      else { events.push({ t, seq: heap.nextSeq(), ev: 'att_open', att: att.id, kind: 'door', shortcut: true }); doorShortcut = true; }
    }
  }
  function checkAttachmentTimeouts(t) {
    for (const att of attachments) {
      if (att.settled || !att.alive || t <= att.timeout_secs) continue;
      if (att.kind === 'trap' && !att.discovered) { attFireVolley(att, t, 'timeout'); att.settled = true; att.alive = false; }
      else { att.settled = true; att.alive = false; events.push({ t, seq: heap.nextSeq(), ev: 'att_lost', att: att.id, kind: att.kind }); }
    }
  }
  function settleAttachmentsAtEnd(t) {
    for (const att of attachments) {
      if (att.settled || !att.alive) continue;
      if (att.kind === 'trap' && !att.discovered) { attFireVolley(att, t, 'end'); att.settled = true; att.alive = false; }
      else { att.settled = true; att.alive = false; events.push({ t, seq: heap.nextSeq(), ev: 'att_lost', att: att.id, kind: att.kind }); }
    }
  }

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
    for (const po of troopPos) {
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
          if (chargeMgr) feedCharge({ type: 'bp_healed', bpId: host.id }, ev.t); // REQ-0200: on_heal_done
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
    const attActive = hasAtt && s.modes.some(m => (m === 'detection' && attachments.some(a => a.kind === 'trap' || a.kind === 'door')) || (m === 'unlock' && attachments.some(a => a.kind === 'chest' || a.kind === 'door')));
    if (s.modes.includes(encounterDef.mode) || attActive) {
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
  for (const po of troopPos) {
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
  function troopWiped() {
    return playerActors.every(a => !a.alive);
  }

  let guardIters = 0;
  while (heap.size() > 0 && guardIters < 200000) {
    guardIters++;
    const ev = heap.popMin();
    if (ev.t > deadlineSecs) break;
    simNow = ev.t; // REQ-0121: honest timestamps for on_hp_below fires
    if (hasAtt) checkAttachmentTimeouts(ev.t);

    if (ev.kind === 'status_tick') {
      if (chargeMgr) chargeMgr.settle(ev.t); // REQ-0200: drain one deferred grant_charge hop (cascade rule: <=1/tick)
      const healHook = chargeMgr ? (id => feedCharge({ type: 'bp_healed', bpId: id }, ev.t)) : null; // REQ-0200: on_heal_done
      for (const a of playerActors) if (a.alive) tickAndEmit(a, ev.t, events, healHook);
      for (const e of enemyActors) if (e.actor.alive) tickAndEmit(e.actor, ev.t, events);
      if (entity && entity.alive) tickAndEmit(makeEnemyActor(entity), ev.t, events);
      if (chargeMgr) feedCharge({ type: 'timer', now: ev.t }, ev.t); // REQ-0200: every_secs charge triggers
      heap.push({ t: ev.t + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });
    } else if (ev.kind === 'skill_fire') {
      const isPlayerSide = schedulable.some(s => s.ownerUid === ev.ownerUid && s.effIdx === ev.effIdx);
      if (isPlayerSide) {
        const s = schedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s.modes.includes(encounterDef.mode) && s.effect.verb && s.effect.verb.t === 'pulse') {
          // REQ-0048: a "spark" (every_secs pulse) emits along the BP's links.
          const spo = troopPos.find(p => p.uid === s.ownerUid);
          const pOut = [];
          if (spo) emitPulse(spo.bpId, ev.t, pOut);
          for (const re of pOut) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        } else if (s.modes.includes(encounterDef.mode)) {
          const attacker = { fieldCells: unionCells(playerActorsInSameBpAs(s.ownerUid, troopPos, playerActors)), ownerId: s.ownerId, bonusVsStatus: bonusVsStatusForOwnerUid(s.ownerUid, troopPos, troopBps), outgoingBuffPct: chargeMgr ? chargeMgr.outgoingBuffPctFor((troopPos.find(p => p.uid === s.ownerUid) || {}).bpId) : 0 };
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
          if (chargeMgr) {
            // REQ-0200: this player PO's landed hits feed the charge runtime -- OnHit +
            // on_damage_dealt on the firing BP, on_connected_unit_attack on its linked
            // BPs; enemy deaths feed on_kill (deduped by enemyId); a landed status
            // application feeds on_status_applied.
            const firePo = troopPos.find(p => p.uid === s.ownerUid);
            const fireBp = firePo && firePo.bpId;
            if (fireBp) {
              for (const lh of (fr.landedHits || [])) {
                feedCharge({ type: 'bp_attack', sourceId: fireBp, amount: lh.amount }, ev.t);
                if (lh.actor && lh.actor.kind === 'enemy' && !lh.actor.alive) feedCharge({ type: 'enemy_killed', sourceId: fireBp, enemyId: lh.actor.id }, ev.t);
              }
              if (rayEvents.some(re => re.ev === 'apply_status')) feedCharge({ type: 'status_applied', sourceId: fireBp }, ev.t);
              // REQ-0200 real-actor: this BP's add_on_hit_status riders land on the
              // struck enemies (amped by amp_status), and grant_lifesteal heals it.
              chargeMgr.onOffensiveLanded(fireBp, fr.landedHits || [], ev.t);
            }
          }
        } else if (hasAtt && s.modes.includes('detection')) {
          resolveDetection(s, ev.t);
        } else if (hasAtt && s.modes.includes('unlock')) {
          resolveUnlock(s, ev.t);
        }
        // reschedule regardless of match (pause = simply not fired above;
        // rescheduling from ev.t keeps cadence continuous while matching)
        scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, chargeMgr ? playerCadenceMult(s.ownerUid) : 1.0);
      } else {
        const s = enemySchedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s && s.raw.alive) {
          const attackProfile = s.effect.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
          const attacker = { fieldCells: s.raw.fieldCells, ownerId: s.ownerId, bonusVsStatus: s.raw.bonusVsStatus || [], selfActor: s.actor };
          const lead = TUNABLES.TELEGRAPH_LEAD_SECS;
          if (s.effect.verb && s.effect.verb.t === 'heal_ally') {
            // REQ-0203: enemy SUPPORT skill -- NO ray at the player field. Heal the
            // lowest-HP living pack ally (self only if alone); target is deterministic
            // (selectHealAllyTarget), the amount rolls from an isolated named stream.
            const target = selectHealAllyTarget(s.actor, enemyActors.map(e => e.actor));
            if (target) {
              const healN = rng.stream(effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t + '/heal_ally').range(s.effect.verb.n[0], s.effect.verb.n[1]);
              const hpBefore = target.hp();
              target.heal(healN);
              events.push({ t: ev.t, seq: heap.nextSeq(), ev: 'heal_ally', src: s.ownerId, dst: target.id, amount: healN, hp_before: hpBefore, hp_after: target.hp() });
            }
          } else {
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
            if (chargeMgr) {
              // REQ-0200: a player BP taking a direct enemy hit feeds OnBPBeenHit on that
              // BP + on_connected_unit_bp_been_hit on its linked BPs.
              for (const lh of (fr.landedHits || [])) {
                if (lh.actor && lh.actor.kind === 'bp') feedCharge({ type: 'bp_damaged', bpId: lh.actor.id, amount: lh.amount }, ev.t);
              }
              // REQ-0200 real-actor: reflect_damage pct of each hit onto the attacker.
              chargeMgr.onDefensiveLanded(s.actor, fr.landedHits || [], ev.t);
            }
          }
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
      if (allEnemiesDead()) { if (hasAtt) settleAttachmentsAtEnd(ev.t); result = 'clear'; break; }
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
  return { events, result, discoveredEntity, entity, attachments: attachments.map(a => ({ id: a.id, kind: a.kind, discovered: a.discovered, opened: (a.settled && a.kind !== 'trap' && a.hp <= 0), settled: a.settled })), attachmentRewards, doorShortcut, chargeState: chargeMgr ? chargeMgr.summary() : undefined };
}

function tickAndEmit(actor, t, events, onHeal) {
  const ticks = tickStatuses(actor.statusBag, TUNABLES.STATUS_TICK_PERIOD_SECS);
  for (const tk of ticks) {
    if (tk.kind === 'damage') { actor.applyDamage(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); }
    else if (tk.kind === 'heal') { actor.heal(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); if (onHeal) onHeal(actor.id); } // REQ-0200: on_heal_done
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
