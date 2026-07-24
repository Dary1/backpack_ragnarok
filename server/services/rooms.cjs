'use strict';
// server/services/rooms.cjs -- REQ-0047 (c): room lifecycle (create /
// fetch+ownership / list / cancel policy validation / cancelRoom), moved
// VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const { SQUAD_SLOTS, DEFAULT_FORMATION_ID, DEFAULT_LEVEL_MIN, getScheduleContent, genId } = require('./core.cjs');

// REQ-0185: a room's `dungeonId` now names an AUTHORED dungeon DEF (dungeon/1);
// the dive is ROLLED from that def's weighted tables at start time. This
// resolves + validates the id against the live def map. An unknown id is a
// 400 (a caller mistake worth surfacing, same posture the old unknown-
// dungeonType did). A legacy `dungeonType` opt is ignored (the def IS the
// selection now). Absent dungeonId with EXACTLY one def falls back to that def
// (the single-dungeon dev/fixture convenience the old resolveDungeonType had).
function resolveDungeonDefId(dungeonId) {
  const { dungeonDefsById } = getScheduleContent();
  const ids = Object.keys(dungeonDefsById || {});
  if (typeof dungeonId === 'string' && dungeonId) {
    if (dungeonDefsById[dungeonId]) return dungeonId;
    const err = new Error('unknown dungeonId: ' + dungeonId + ' (known: ' + ids.join(', ') + ')');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  // REQ-0185: dungeonId is REQUIRED on create (the original contract; the client
  // always picks a DEF). No single-def fallback -- an absent id is a 400, exactly
  // as the pre-REQ createRoom required. (runs.cjs/seals.cjs keep their own defensive
  // first-def fallback for START/SEAL of a legacy room, a separate concern.)
  const err = new Error('dungeonId is required (known: ' + ids.join(', ') + ')');
  err.code = 'BAD_REQUEST';
  throw err;
}

function validateCancelPolicy(cancelPolicy) {
  if (!cancelPolicy || typeof cancelPolicy !== 'object') return { immediate: true };
  return { immediate: cancelPolicy.immediate !== false };
}

// REQ-0304: the dungeon DRAW. Given an attackLv, select UNIFORMLY at random from
// the eligible set { d in dungeonDefsById : d.levelMin <= attackLv }. levelMin is the
// ONLY appearance gate (levelMax is an authoring/recommendation band, NOT an
// eligibility bound). The pick is deterministic in `drawSeed` (djb2 -> mulberry32 via
// combat.makeRng -- the SAME seeded RNG the sim's determinism contract uses), and the
// eligible ids are sorted so the draw depends only on (seed, eligible-set), never on
// content authoring order. If NO dungeon is eligible (attackLv below every levelMin)
// this throws a clear 400 -- the ratified "no eligible dungeon" error. Weighting is
// uniform for v1 (a per-dungeon `drawWeight` field is a documented follow-up).
function drawDungeonId(dungeonDefsById, attackLv, drawSeed) {
  const lvl = Number.isFinite(attackLv) ? Math.floor(attackLv) : DEFAULT_LEVEL_MIN;
  const eligible = Object.keys(dungeonDefsById || {}).filter((id) => {
    const d = dungeonDefsById[id];
    const min = (d && Number.isFinite(d.levelMin)) ? d.levelMin : DEFAULT_LEVEL_MIN;
    return min <= lvl;
  }).sort();
  if (eligible.length === 0) {
    const known = Object.keys(dungeonDefsById || {})
      .map((id) => id + '(levelMin ' + ((dungeonDefsById[id] && dungeonDefsById[id].levelMin) ?? '?') + ')')
      .join(', ');
    const err = new Error('no eligible dungeon for attackLv ' + lvl + ' -- every dungeon.levelMin exceeds it (known: ' + known + ')');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const roll = combat.makeRng(String(drawSeed)).stream('dungeon_draw').next();
  const idx = Math.min(eligible.length - 1, Math.floor(roll * eligible.length));
  return eligible[idx];
}

// createRoom: `opts.genSeed` (REQ-0043) is ONLY threaded through here --
// the ACTUAL privilege gate (dev fallback / item_admin token, same
// pattern as dev/backdate) lives in server/api.cjs's route handler,
// which strips genSeed from the body (and 403s) BEFORE this function is
// ever called for a non-privileged caller. This function itself has no
// auth context, so it trusts whatever genSeed it's handed -- same
// division of responsibility devBackdateActiveRun() already documents
// ("Caller gating... NOT here").
function createRoom(ownerId, opts) {
  const { dungeonId, level, genSeed, drawSeed, formationId, cancelPolicy } = opts || {};
  const lvl = Number.isFinite(level) ? Math.max(DEFAULT_LEVEL_MIN, Math.floor(level)) : DEFAULT_LEVEL_MIN;
  // REQ-0304: drawSeed is stored verbatim (reproducible, EXACTLY like genSeed);
  // crypto-random by default. It seeds the dungeon DRAW below and is persisted so a
  // draw is replayable. A privileged caller may pin it (gated in the route, same
  // class as genSeed); an ungated room just gets an unpredictable one.
  const dSeed = (drawSeed !== undefined && drawSeed !== null && drawSeed !== '')
    ? String(drawSeed)
    : crypto.randomBytes(16).toString('hex');
  // REQ-0304: dungeonId is OPTIONAL on create. Present -> a validated,
  // privileged/test OVERRIDE of the draw (resolveDungeonDefId; 400 on unknown), so
  // legacy rooms + sealed runs that carry one start unchanged. Absent -> the server
  // RANDOM-DRAWS a dungeon uniformly among those whose levelMin <= attackLv (= lvl),
  // keyed off the stored drawSeed (the ratified REQ-0304 attackLv-only entry).
  const resolvedDungeonId = (typeof dungeonId === 'string' && dungeonId)
    ? resolveDungeonDefId(dungeonId)
    : drawDungeonId(getScheduleContent().dungeonDefsById, lvl, dSeed);
  const fId = (typeof formationId === 'string' && combat.FORMATIONS[formationId]) ? formationId : DEFAULT_FORMATION_ID;
  // genSeed: string or number accepted, coerced to a string (dungen.generate
  // stringifies internally anyway); random by default (crypto, same
  // "stored verbatim, never re-rolled" convention startRun's own combat
  // seed already follows) so an ungated room is still fully unpredictable.
  const seed = (genSeed !== undefined && genSeed !== null && genSeed !== '')
    ? String(genSeed)
    : crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const room = {
    id: genId('room'),
    ownerId,
    dungeonId: resolvedDungeonId,
    level: lvl,
    genSeed: seed,
    drawSeed: dSeed, // REQ-0304: the seed the dungeon was drawn with (reproducible, like genSeed)
    visibility: 'self', // golden c: P1-B rooms are always self-only (multi-visibility is P2)
    formationId: fId,
    cancelPolicy: validateCancelPolicy(cancelPolicy),
    slots: SQUAD_SLOTS.map(() => ({ squadIndex: null })),
    status: 'open',
    cancelRequested: false,
    pendingSwap: null,
    cooldownUntil: null,
    createdAt: now,
    updatedAt: now,
    lastRunId: null,
  };
  storage.writeRoom(room.id, room);
  return room;
}

function getRoomOr404(roomId) {
  const room = storage.readRoom(roomId);
  if (!room) { const err = new Error('room not found'); err.code = 'NOT_FOUND'; throw err; }
  return room;
}

// Ownership guard: every route handler resolves the CALLER's playerId
// from their auth token FIRST (never trusts a client-supplied id, same
// convention as api.cjs's profile routes), then calls this. A room that
// exists but belongs to someone else looks EXACTLY like a nonexistent
// one to the caller (404, not 403) -- this is the "player B cannot see/
// cancel A's room" isolation the REQ's test list calls for; leaking
// "yes this id exists, just not yours" via a 403 would itself be an
// information leak for a visibility:self room.
function getOwnRoomOr404(roomId, callerId) {
  const room = getRoomOr404(roomId);
  if (room.ownerId !== callerId) {
    const err = new Error('room not found'); err.code = 'NOT_FOUND'; throw err;
  }
  return room;
}

function listOwnRooms(callerId) {
  return storage.listRooms().filter((r) => r.ownerId === callerId);
}

// ---------------------------------------------------------------------
// Deploy gate (golden d): "a squad can only be assigned if
// isSquadIndependent AND its uids don't overlap other CURRENTLY-ACTIVE
// schedules' deployed squads of the same player" -- implemented by
// snapshotting deployed uid sets per active room.
// ---------------------------------------------------------------------

// squadCanvasOf(profileCanvas, idx): the SAME two-line lookup
// mock-src/engine.js's own (internal, unexported) squadCanvasOf uses --
// idx===active reads the top-level canvas fields directly, any other
// index reads that squad's store[] snapshot. Plain data read, no
// engine call needed (documented in engine.js's own header comment: "a
// squad's canvas" is just {bps,pos,sis} sitting at one of these two
// places). Returns null if idx is out of range (caller's job to 400).
function cancelRoom(room) {
  if (room.status === 'canceled') return room; // idempotent
  if (room.cancelPolicy.immediate || room.status !== 'active') {
    // Either the policy allows an immediate cancel, or there is no run
    // currently in flight to "finish first" -- cancel right now.
    room.status = 'canceled';
    room.cancelRequested = false;
    room.updatedAt = new Date().toISOString();
    storage.writeRoom(room.id, room);
    return room;
  }
  // Policy disallows immediate cancel AND a run is currently active:
  // flag "cancel after current run" -- honored by
  // maybeAutoStartNextRun() the moment the in-flight run settles.
  room.cancelRequested = true;
  room.updatedAt = new Date().toISOString();
  storage.writeRoom(room.id, room);
  return room;
}


// devClearRooms (REQ-0082): bulk-deletes every room owned by `callerId` through
// the storage chokepoint. Backs the dev-only POST /api/schedule/rooms/dev/clear
// hook (gated to the dev_mode no-token fallback caller in the route, exactly
// like devClearWarehouse) -- the E2E dev player's canceled rooms otherwise pile
// up every run and collapse the schedule create panel's zero-rooms auto-open.
function devClearRooms(callerId) {
  return storage.clearRoomsForOwner(callerId);
}

module.exports = {
  resolveDungeonDefId,
  drawDungeonId,
  validateCancelPolicy,
  createRoom,
  getRoomOr404,
  getOwnRoomOr404,
  listOwnRooms,
  cancelRoom,
  devClearRooms,
};
