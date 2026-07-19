'use strict';
// server/services/seals.cjs -- REQ-0058: Sealed Seed Share service.
// Business logic for POST /api/schedule/seal (mint), sealed-room creation
// (a recipient copies the frozen tuple verbatim), the anti-spoiler-gated
// post-settle comparison view, and the seal-scoped replay read. Sits
// alongside the other schedule services (rooms/runs/warehouse); server/
// storage.cjs is the sole persistence chokepoint (sealed_seeds +
// seal_runs registry). Requires services/rooms.cjs (createRoom /
// resolveDungeonType) one-directionally -- rooms.cjs never requires this
// file, so there is no cycle.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const { getScheduleContent } = require('./core.cjs');
const { createRoom } = require('./rooms.cjs');

const SEAL_SCHEMA_VERSION = 1;

function err(msg, code, reason) {
  const e = new Error(msg);
  e.code = code;
  if (reason) e.reason = reason;
  return e;
}

// mintSeal: the server mints a FRESH genSeed (never caller-supplied --
// REQ-0043's admin-only custom-seed gate is untouched: sealing ALWAYS
// mints, so no caller ever hands us a seed here, and no gate is bypassed).
// The sealed tuple is frozen at mint time; the sealId doubles as the
// unguessable share token a minter passes to friends.
function mintSeal(creatorId, opts) {
  const o = opts || {};
  // REQ-0185: a seal pins a dungeon DEF id + the roll seed (genSeed) -- a replay
  // re-rolls the same def with the same seed to reproduce the dive byte-for-byte
  // (Open Q3). Default to (or fall back to) the first live def when the caller
  // names none / an unknown one.
  const { dungeonDefsById } = getScheduleContent();
  let dungeonId = o.dungeonId;
  if (typeof dungeonId !== 'string' || !dungeonId || !dungeonDefsById[dungeonId]) {
    const ids = Object.keys(dungeonDefsById || {});
    dungeonId = ids[0] || (typeof dungeonId === 'string' ? dungeonId : '');
  }
  // dungeonType is vestigial post-REQ-0185 (the dungeonId names the def now); kept
  // on the seal doc / public meta only for the already-shipped ApiSeal* shape.
  const dungeonType = 'default';
  const level = Number.isFinite(o.level) ? Math.max(1, Math.floor(o.level)) : 1;
  // affixes (REQ-0055): frozen passthrough array. REQ-0055 (dungeon
  // weather) is still draft/unimplemented, so nothing derives gameplay
  // from this yet -- it exists so a seal minted today already carries the
  // tuple shape REQ-0055 will later populate, copied verbatim into every
  // recipient's room. Only a plain string[] is accepted; anything else is
  // coerced to []. [ORCH default, vetoable]
  const affixes = Array.isArray(o.affixes) ? o.affixes.filter((a) => typeof a === 'string') : [];
  const genSeed = crypto.randomBytes(16).toString('hex');
  const sealId = 'seal_' + crypto.randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const seal = {
    sealId,
    createdBy: creatorId,
    dungeonId,
    dungeonType,
    level,
    genSeed,
    affixes,
    createdAt: now,
    schema_version: SEAL_SCHEMA_VERSION,
  };
  storage.writeSeal(sealId, seal);
  return seal;
}

function getSeal(sealId) {
  const seal = storage.readSeal(sealId);
  if (!seal) throw err('sealed seed not found', 'NOT_FOUND');
  return seal;
}

// publicSealMeta: the seal fields safe to hand a recipient. genSeed is
// deliberately WITHHELD -- a recipient never needs it (createSealRoom
// copies it server-side into their room), and withholding it keeps
// REQ-0043's "no caller ever handles a raw seed" spirit intact. [vetoable]
function publicSealMeta(seal) {
  return {
    sealId: seal.sealId,
    createdBy: seal.createdBy,
    dungeonId: seal.dungeonId,
    dungeonType: seal.dungeonType,
    level: seal.level,
    affixes: Array.isArray(seal.affixes) ? seal.affixes : [],
    createdAt: seal.createdAt,
  };
}

// createSealRoom: a participant joins a sealed run. The recipient's room
// copies the frozen tuple VERBATIM (dungeonType/level/genSeed/affixes) and
// carries the sealId so its run is single-shot (runs.cjs's
// maybeAutoStartNextRun never restarts a sealed room). ONE room per
// (sealId, playerId): a second attempt is refused 409 -- the combat seed
// is re-rolled per run, so allowing a re-created room would let a
// participant re-roll the outcome and defeat the fair-benchmark point.
function createSealRoom(ownerId, sealId, opts) {
  const seal = getSeal(sealId);
  const existing = storage.readSealRun(sealId, ownerId);
  if (existing) throw err('you have already joined this sealed run (one run per participant)', 'CONFLICT', 'seal_already_joined');
  const o = opts || {};
  const room = createRoom(ownerId, {
    dungeonId: seal.dungeonId,
    dungeonType: seal.dungeonType,
    level: seal.level,
    genSeed: seal.genSeed,
    formationId: o.formationId,
    cancelPolicy: o.cancelPolicy,
  });
  room.sealId = sealId;
  room.affixes = Array.isArray(seal.affixes) ? seal.affixes : [];
  storage.writeRoom(room.id, room);
  storage.writeSealRun(sealId, ownerId, {
    sealId,
    playerId: ownerId,
    roomId: room.id,
    createdAt: new Date().toISOString(),
    schema_version: SEAL_SCHEMA_VERSION,
  });
  return room;
}

// buildTimeline: distills a persisted run doc into the comparison-view
// metrics the REQ calls for -- clear time, finishing H, per-encounter
// durations, damage taken, attachments resolved (REQ-0049). Everything is
// derived from the run's own persisted event log + summary fields, so it
// is deterministic and directly comparable across participants running the
// SAME sealed layout. Degrades gracefully (missing fields -> 0/[]).
function buildTimeline(run) {
  const events = Array.isArray(run.events) ? run.events : [];
  const runEnd = events.find((e) => e.ev === 'run_end');
  const endT = runEnd && typeof runEnd.t === 'number' ? runEnd.t : (typeof run.durationSecs === 'number' ? run.durationSecs : 0);

  // Per-encounter durations: bounded by consecutive encounter_start events
  // (last one runs to run_end / durationSecs). endPct is the highest
  // `progress` pct seen for that encounter index.
  const starts = events.filter((e) => e.ev === 'encounter_start');
  const encounters = starts.map((s, i) => {
    const startSecs = typeof s.t === 'number' ? s.t : 0;
    const next = starts[i + 1];
    const stopSecs = next && typeof next.t === 'number' ? next.t : endT;
    let endPct = 0;
    for (const e of events) {
      if (e.ev === 'progress' && e.enc === s.enc && typeof e.pct === 'number' && e.pct > endPct) endPct = e.pct;
    }
    return {
      enc: s.enc,
      kind: s.kind,
      startSecs,
      durationSecs: Math.max(0, stopSecs - startSecs),
      endPct,
    };
  });

  // Damage taken: hits resolved into the TROOP field. A ray_fire names its
  // TARGET field via `field` (sim/lib/skills.cjs: label 'player' for the
  // troop field, 'enemy' for the enemy field). We track the most recent
  // ray_fire's field and attribute the hits that follow it, until the next
  // ray_fire -- a deterministic, symmetric benchmark number across
  // participants. reflect_damage is skipped (its side is ambiguous). [vetoable]
  let curField = null;
  let damageTaken = 0;
  let attachmentsResolved = 0;
  for (const e of events) {
    switch (e.ev) {
      case 'ray_fire':
        curField = e.field;
        break;
      case 'ray_hit':
        if (curField === 'player' && typeof e.amount === 'number') damageTaken += e.amount;
        break;
      case 'ray_aoe':
      case 'ray_hit_all':
        if (curField === 'player' && Array.isArray(e.hits)) {
          for (const h of e.hits) if (h && typeof h.amount === 'number') damageTaken += h.amount;
        }
        break;
      case 'att_open':
      case 'att_disarm':
      case 'att_lost':
        attachmentsResolved += 1;
        break;
      default:
        break;
    }
  }

  return {
    result: run.result,
    // REQ-0240: a seal is a FAIR benchmark of the SAME layout, so clear time
    // must stay COMBAT TRUTH (sim seconds), not the paced presentation time
    // durationSecs now carries. simDurationSecs is the legacy max-`t` a
    // paced run stores; a legacy run (no simDurationSecs) keeps its old
    // durationSecs (which WAS max-`t`), so seal numbers are unchanged.
    clearTimeSecs: typeof run.simDurationSecs === 'number' ? run.simDurationSecs
      : (typeof run.durationSecs === 'number' ? run.durationSecs : endT),
    finishingH: typeof run.H === 'number' ? run.H : (runEnd && typeof runEnd.H === 'number' ? runEnd.H : null),
    levelAfter: typeof run.levelAfter === 'number' ? run.levelAfter : null,
    finalProgressPct: typeof run.finalProgressPct === 'number' ? run.finalProgressPct : null,
    damageTaken,
    attachmentsResolved,
    encounters,
  };
}

function loadRunForEntry(entry) {
  const room = storage.readRoom(entry.roomId);
  if (!room || !room.lastRunId) return { room: room || null, run: null };
  const run = storage.readRun(room.lastRunId);
  return { room, run: run || null };
}

function participantView(entry, callerId) {
  const { run } = loadRunForEntry(entry);
  return {
    playerId: entry.playerId,
    isSelf: entry.playerId === callerId,
    roomId: entry.roomId,
    hasRun: !!run,
    settled: !!(run && run.settled),
    runId: run ? run.id : null,
    timeline: run ? buildTimeline(run) : null,
  };
}

// buildSealComparison: the anti-spoiler-gated post-settle comparison.
// Consistent with the "?"-masking philosophy -- OTHER participants'
// results stay hidden until YOUR OWN run of this sealId settles, then
// everything unlocks. The caller MUST be a participant (have joined the
// seal); a stranger who merely knows the sealId gets 403. The caller can
// always see their OWN entry (even mid-run); other entries appear only
// once `unlocked` is true.
function buildSealComparison(sealId, callerId) {
  const seal = getSeal(sealId);
  const callerEntry = storage.readSealRun(sealId, callerId);
  if (!callerEntry) throw err('you are not a participant of this sealed run', 'FORBIDDEN', 'seal_not_participant');
  const self = participantView(callerEntry, callerId);
  const entries = storage.listSealRuns(sealId);
  const unlocked = self.settled;
  return {
    sealId,
    seal: publicSealMeta(seal),
    unlocked,
    participantCount: entries.length,
    self,
    // Anti-spoiler: withhold every OTHER participant until the caller's
    // own run has settled. `self` above is always present.
    participants: unlocked ? entries.map((e) => participantView(e, callerId)) : [],
  };
}

// buildSealReplay: the seal-scoped replay read backing the comparison
// view's "into replays" links. Returns a participant's FULL persisted
// event log (not the run route's time-gated visibleEvents -- the whole
// point of the unlocked comparison is to see everything). Own replay is
// always readable; ANOTHER participant's replay is gated on the caller's
// own run having settled (same anti-spoiler gate as the comparison).
function buildSealReplay(sealId, callerId, targetPlayerId) {
  getSeal(sealId);
  const callerEntry = storage.readSealRun(sealId, callerId);
  if (!callerEntry) throw err('you are not a participant of this sealed run', 'FORBIDDEN', 'seal_not_participant');
  if (targetPlayerId !== callerId) {
    const { run: callerRun } = loadRunForEntry(callerEntry);
    if (!callerRun || !callerRun.settled) {
      throw err('settle your own run before viewing another participant\'s replay', 'FORBIDDEN', 'seal_replay_locked');
    }
  }
  const targetEntry = storage.readSealRun(sealId, targetPlayerId);
  if (!targetEntry) throw err('that participant has not joined this sealed run', 'NOT_FOUND');
  const { run } = loadRunForEntry(targetEntry);
  if (!run) throw err('that participant has not started their run yet', 'NOT_FOUND');
  return {
    sealId,
    playerId: targetPlayerId,
    roomId: targetEntry.roomId,
    runId: run.id,
    result: run.result,
    durationSecs: run.durationSecs,
    finalProgressPct: run.finalProgressPct,
    H: run.H,
    levelAfter: run.levelAfter,
    settled: !!run.settled,
    events: Array.isArray(run.events) ? run.events : [],
    timeline: buildTimeline(run),
  };
}

module.exports = {
  SEAL_SCHEMA_VERSION,
  mintSeal,
  getSeal,
  publicSealMeta,
  createSealRoom,
  buildTimeline,
  buildSealComparison,
  buildSealReplay,
};
