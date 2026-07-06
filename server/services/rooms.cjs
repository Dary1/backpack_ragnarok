'use strict';
// server/services/rooms.cjs -- REQ-0047 (c): room lifecycle (create /
// fetch+ownership / list / cancel policy validation / cancelRoom), moved
// VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const dungen = require('../../sim/dungen.cjs');
const { UNIT_SLOTS, DEFAULT_FORMATION_ID, DEFAULT_LEVEL_MIN, getScheduleContent, genId } = require('./core.cjs');

function resolveDungeonType(dungeonType, dungeonId) {
  if (typeof dungeonType === 'string' && dungeonType) {
    if (!dungen.DUNGEON_TYPES.includes(dungeonType)) {
      const err = new Error('unknown dungeonType: ' + dungeonType + ' (known: ' + dungen.DUNGEON_TYPES.join(', ') + ')');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return dungeonType;
  }
  const { dungeonDef } = getScheduleContent();
  if (dungeonId === dungeonDef.id) return 'test_fixed';
  return 'default';
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
  const { dungeonId, dungeonType, level, genSeed, formationId, cancelPolicy } = opts || {};
  if (typeof dungeonId !== 'string' || !dungeonId) {
    const err = new Error('dungeonId is required'); err.code = 'BAD_REQUEST'; throw err;
  }
  const resolvedType = resolveDungeonType(dungeonType, dungeonId);
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
    dungeonId,
    dungeonType: resolvedType,
    level: lvl,
    genSeed: seed,
    visibility: 'self', // golden c: P1-B rooms are always self-only (multi-visibility is P2)
    formationId: fId,
    cancelPolicy: validateCancelPolicy(cancelPolicy),
    slots: UNIT_SLOTS.map(() => ({ presetIndex: null })),
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
// Deploy gate (golden d): "a preset can only be assigned if
// isUnitIndependent AND its uids don't overlap other CURRENTLY-ACTIVE
// schedules' deployed units of the same player" -- implemented by
// snapshotting deployed uid sets per active room.
// ---------------------------------------------------------------------

// presetCanvasOf(profileCanvas, idx): the SAME two-line lookup
// mock-src/engine.js's own (internal, unexported) presetCanvasOf uses --
// idx===active reads the top-level canvas fields directly, any other
// index reads that preset's store[] snapshot. Plain data read, no
// engine call needed (documented in engine.js's own header comment: "a
// preset's canvas" is just {bps,pos,sis} sitting at one of these two
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


module.exports = {
  resolveDungeonType,
  validateCancelPolicy,
  createRoom,
  getRoomOr404,
  getOwnRoomOr404,
  listOwnRooms,
  cancelRoom,
};
