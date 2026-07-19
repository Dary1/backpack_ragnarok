'use strict';
// server/services/sorties.cjs -- REQ-0239 (design D1): the ATOMIC sortie
// endpoint's business logic. A sortie is "create a room + fill all four squad
// slots + launch" as ONE server-side transaction, replacing the client's
// former 5-request choreography (POST /rooms then 4x PUT /slots) and its
// partial-failure states. All create/assign work runs under the SAME deploy
// gate assignSlot already enforces (golden b/d), so the shared-unit collision
// backstop (409 same_room_duplicate / deployed_overlap / empty_squad) is
// preserved verbatim -- this module adds NO new rule, only atomicity + the
// golden-g deferred-cancel default.
const storage = require('../storage.cjs');
const { SQUAD_SLOTS } = require('./core.cjs');
const { createRoom } = require('./rooms.cjs');
const { assignSlot } = require('./squads.cjs');

// createSortie(callerId, opts, profileCanvas, itemDefsById)
//   opts: { dungeonId, level, formationId, cancelPolicy?, genSeed?,
//           squadIndices:[a,b,c,d] }
// Returns the created room with all four slots filled (status still 'open';
// the caller settles it to auto-start the run, exactly as the PUT-slots path
// relies on the GET /rooms poll to do). Atomic: any refusal deletes the
// freshly-created room and re-throws, so a rejected sortie never orphans an
// idle room.
function createSortie(callerId, opts, profileCanvas, itemDefsById) {
  const { squadIndices } = opts || {};
  if (!Array.isArray(squadIndices) || squadIndices.length !== SQUAD_SLOTS.length) {
    const err = new Error('squadIndices must be an array of ' + SQUAD_SLOTS.length + ' squad indices');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  // REQ-0239 (golden g / bug #6): the sortie flow's DEFAULT cancel policy is
  // DEFERRED ({immediate:false}) -- a cancel is honored when the CURRENT run
  // ends, never disbanding an in-flight expedition the instant the player
  // presses cancel. That instant-disband was the user-reported bug; its root
  // cause was the old CreateRoomForm defaulting its toggle to immediate. The
  // sortie IS the golden-g entry point, so an omitted policy defaults here;
  // immediate is an opt-in, destructive choice surfaced only in the sortie
  // AdvancedFold. (The legacy POST /rooms path keeps its own historical
  // default untouched -- it is deprecated from the UI in favour of /sorties.)
  const sortieOpts = Object.assign({}, opts, {
    cancelPolicy: (opts && opts.cancelPolicy) ? opts.cancelPolicy : { immediate: false },
  });
  // createRoom validates dungeonId / level / formationId / cancelPolicy /
  // genSeed and persists an OPEN room with four empty slots.
  const room = createRoom(callerId, sortieOpts);
  try {
    for (let i = 0; i < SQUAD_SLOTS.length; i++) {
      // assignSlot mutates + persists `room` per slot and throws CONFLICT on a
      // deploy-gate violation. Because each call sees the slots filled by the
      // previous iterations of THIS same room object, an in-troop duplicate
      // (same squadIndex twice) surfaces as same_room_duplicate exactly as the
      // sequential PUT path does.
      assignSlot(room, callerId, i, squadIndices[i], profileCanvas, itemDefsById);
    }
  } catch (e) {
    // Atomic rollback: drop the half-filled room so a rejected sortie leaves no
    // trace. The client shows the 409 reason and lets the player resolve the
    // conflict, then re-order -- never a silent orphan (design 01 sec 8).
    try { storage.deleteRoom(room.id); } catch (_) { /* best-effort cleanup */ }
    throw e;
  }
  return room;
}

module.exports = { createSortie };
