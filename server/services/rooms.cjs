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

// createRoom: `opts.genSeed` (REQ-0043) is ONLY threaded through here --
// the ACTUAL privilege gate (dev fallback / item_admin token, same
// pattern as dev/backdate) lives in server/api.cjs's route handler,
// which strips genSeed from the body (and 403s) BEFORE this function is
// ever called for a non-privileged caller. This function itself has no
// auth context, so it trusts whatever genSeed it's handed -- same
// division of responsibility devBackdateActiveRun() already documents
// ("Caller gating... NOT here").
function createRoom(ownerId, opts) {
  const { dungeonId, level, genSeed, formationId, cancelPolicy } = opts || {};
  // REQ-0185: validates dungeonId names a live dungeon def (400 if not).
  const resolvedDungeonId = resolveDungeonDefId(dungeonId);
  const lvl = Number.isFinite(level) ? Math.max(DEFAULT_LEVEL_MIN, Math.floor(level)) : DEFAULT_LEVEL_MIN;
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
  validateCancelPolicy,
  createRoom,
  getRoomOr404,
  getOwnRoomOr404,
  listOwnRooms,
  cancelRoom,
  devClearRooms,
};
