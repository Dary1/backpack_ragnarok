"use strict";
// server/services/troops.cjs -- REQ-0324: the co-operative Troop service. A
// player OPENS a public recruiting Troop (a visibility:'public' room, host
// seated in slot 0, state:'recruiting'); OTHER players -- human or bot,
// indistinguishably -- BROWSE the open Troops and JOIN one with a squad of
// their own, and may LEAVE their seat before departure. This is the
// foundation the reactive fleet (REQ-0325+) rests on. Departure/rewards
// (REQ-0325) and cancel/disband (REQ-0326) are NOT built here; filling the
// last seat merely leaves the Troop ready for REQ-0325 -- it never starts a run.
//
// Persistence is server/storage.cjs (the one chokepoint), same as every other
// schedule service. The deploy gate (services/squads.cjs assertSeatAllowed)
// runs against the JOINER's own canvas, unchanged.
"use strict";
const storage = require("../storage.cjs");
const { SQUAD_SLOTS, normalizeSlot, slotIsFilled } = require("./core.cjs");
const rooms = require("./rooms.cjs");
const squads = require("./squads.cjs");
const runs = require("./runs.cjs"); // REQ-0325: shared run engine (auto-depart start + settle)

// A Troop is a room with visibility:'public'. loadTroopRaw returns the RAW
// stored doc (slots in whatever shape they were persisted) or 404s. A solo
// (visibility:'self') room is INVISIBLE on the troop surface -- it 404s here
// exactly like a nonexistent id, keeping the solo /rooms* surface separate.
function loadTroopRaw(roomId) {
  const room = storage.readRoom(roomId);
  if (!room || room.visibility !== "public") {
    const err = new Error("troop not found"); err.code = "NOT_FOUND"; throw err;
  }
  return room;
}

// A room's seats normalized for a RESPONSE (migration on read): each filled
// slot becomes { ownerId, squadIndex, joinedAt } (a legacy ownerless slot is
// attributed to the room's ownerId), each empty slot is null. Never mutates
// storage.
function troopView(room) {
  return Object.assign({}, room, {
    slots: (room.slots || []).map((s) => normalizeSlot(s, room)),
  });
}

function freeSeatCount(room) {
  return (room.slots || []).reduce((n, s) => n + (slotIsFilled(s) ? 0 : 1), 0);
}
function filledSeatCount(room) {
  return (room.slots || []).reduce((n, s) => n + (slotIsFilled(s) ? 1 : 0), 0);
}

// seatMember: run the SHARED deploy gate (squads.assertSeatAllowed -- slot/squad
// range + empty-squad + same-room/cross-room overlap, all against the CALLER's
// canvas) then write the co-op slot { ownerId, squadIndex, joinedAt }. This is
// the troop analogue of assignSlot; it differs ONLY in the slot shape written.
function seatMember(room, callerId, slotIndex, squadIndex, profileCanvas, itemDefsById) {
  squads.assertSeatAllowed(room, callerId, slotIndex, squadIndex, profileCanvas, itemDefsById);
  const now = new Date().toISOString();
  room.slots[slotIndex] = { ownerId: callerId, squadIndex, joinedAt: now };
  room.updatedAt = now;
  storage.writeRoom(room.id, room);
  return room;
}

// createTroop(hostId, opts, profileCanvas, itemDefsById)
//   opts: { dungeonId, level, formationId?, squadIndex }
// Opens a public recruiting Troop and seats the host in slot 0. dungeonId/
// level/formationId are validated + the dungeon drawn by rooms.createRoom
// (reused verbatim); level (attackLv) is host-set here and immutable for the
// Troop (REQ-0325 relies on one troop-level attackLv). Atomic: a rejected host
// seating deletes the freshly-created room so a bad open leaves no idle Troop.
function createTroop(hostId, opts, profileCanvas, itemDefsById) {
  const squadIndex = opts ? opts.squadIndex : undefined;
  if (!Number.isInteger(squadIndex)) {
    const err = new Error("squadIndex is required (the host seats slot 0 with one of their own squads)");
    err.code = "BAD_REQUEST"; throw err;
  }
  // createRoom validates dungeonId/level/formationId/cancelPolicy and persists
  // an OPEN self-room with four empty solo slots; we reshape it into a public
  // recruiting Troop before seating the host.
  const room = rooms.createRoom(hostId, opts);
  room.visibility = "public";
  room.hostId = hostId;        // == ownerId (kept as an alias, never removed)
  room.state = "recruiting";
  // Keep `status` off the solo 'open'/'active' lanes so the lazy run-scheduler
  // (services/runs.cjs) and the market Law-of-Possession gate treat a Troop
  // inertly -- a Troop never auto-starts a run in this REQ (REQ-0325).
  room.status = "recruiting";
  room.slots = SQUAD_SLOTS.map(() => null); // a Troop's empty seats are null; host seated next
  try {
    seatMember(room, hostId, 0, squadIndex, profileCanvas, itemDefsById);
  } catch (e) {
    try { storage.deleteRoom(room.id); } catch (_) { /* best-effort rollback */ }
    throw e;
  }
  return troopView(room);
}

// joinTroop: take the LOWEST free seat with the caller's own squad. Only a
// recruiting Troop with a free seat is joinable; the deploy gate is enforced
// against the joiner's canvas exactly as for the host.
function joinTroop(roomId, callerId, squadIndex, profileCanvas, itemDefsById) {
  const room = loadTroopRaw(roomId);
  if (room.state !== "recruiting") {
    const err = new Error("troop is not recruiting (it has departed or been canceled)");
    err.code = "CONFLICT"; throw err;
  }
  let seat = -1;
  for (let i = 0; i < room.slots.length; i++) {
    if (!slotIsFilled(room.slots[i])) { seat = i; break; }
  }
  if (seat < 0) {
    const err = new Error("troop is full"); err.code = "CONFLICT"; throw err;
  }
  seatMember(room, callerId, seat, squadIndex, profileCanvas, itemDefsById);
  // REQ-0325: filling the LAST free seat AUTO-DEPARTS the Troop -- transition
  // recruiting -> active and start the first run immediately, atomic with this
  // join (no separate client action). The other three seats' snapshots are
  // re-read from storage inside the run engine, so this join's caller need only
  // supply their OWN canvas.
  if (freeSeatCount(room) === 0) departTroop(room);
  return troopView(room);
}

// departTroop: REQ-0325. The Troop is full -- flip its troop-level lifecycle to
// 'active' (departed) and start its first run through the SHARED run engine
// (services/runs.cjs), which snapshots all four seats' owners and fans rewards
// uniformly. startRun mutates+persists `room` (status:'active', lastRunId), so
// troopView(room) after this reflects the departed, in-flight Troop. If startRun
// throws (defensive -- every seat passed the deploy gate at join, so this is a
// last-resort guard), the Troop is reverted to a consistent recruiting-full
// state rather than left half-departed.
function departTroop(room) {
  const prevState = room.state;
  const prevStatus = room.status;
  room.state = "active";
  try {
    runs.startRun(room, null); // troop path re-reads each owner's canvas from storage; profileCanvas unused
  } catch (e) {
    room.state = prevState;
    room.status = prevStatus;
    room.updatedAt = new Date().toISOString();
    try { storage.writeRoom(room.id, room); } catch (_) { /* best-effort revert */ }
    throw e;
  }
  return room;
}

// leaveTroop: free the caller's seat(s) before departure. Any seated member
// (host included) may leave while the Troop is still recruiting. A caller who
// holds no seat 409s.
function leaveTroop(roomId, callerId) {
  const room = loadTroopRaw(roomId);
  if (room.state !== "recruiting") {
    const err = new Error("cannot leave: troop is no longer recruiting (departure/cancel is server-authoritative)");
    err.code = "CONFLICT"; throw err;
  }
  let freed = 0;
  for (let i = 0; i < room.slots.length; i++) {
    const slot = normalizeSlot(room.slots[i], room);
    if (slot && slot.ownerId === callerId) { room.slots[i] = null; freed += 1; }
  }
  if (freed === 0) {
    const err = new Error("you do not hold a seat in this troop"); err.code = "CONFLICT"; throw err;
  }
  room.updatedAt = new Date().toISOString();
  storage.writeRoom(room.id, room);
  return troopView(room);
}

// settleTroopIfDue: REQ-0325. The poll-driven settle/auto-restart entry point
// for a Troop, mirroring the solo scheduler's settleRoomIfDue: load the RAW
// troop room and hand it to the shared run engine, which (for a DEPARTED troop
// with an elapsed run) applies rewards, drops the troop level on a wipe, then
// auto-starts the next run once the cooldown clears. A still-recruiting troop is
// inert here (its status is off the run lanes) so this is a safe no-op poll. The
// per-owner canvases are re-read inside runs.cjs, so no caller canvas is needed.
function settleTroopIfDue(roomId, itemDefsById) {
  const room = loadTroopRaw(roomId);
  const settled = runs.settleRoomIfDue(room, null, itemDefsById);
  return troopView(settled);
}

// getTroopOr404: full troop state (slots normalized, migration on read).
function getTroopOr404(roomId) {
  return troopView(loadTroopRaw(roomId));
}

// listRecruitingTroops({ state, attackLv }): the browse signal the fleet polls.
// Returns only PUBLIC, recruiting Troops with >=1 free seat, each as the compact
// { roomId, seats:"k/4", attackLv, hostId, ageSec }. attackLv, when a finite
// number, filters to Troops whose (immutable, host-set) level equals it.
function listRecruitingTroops(opts) {
  const wantState = (opts && opts.state) ? opts.state : "recruiting";
  const attackLv = (opts && Number.isFinite(opts.attackLv)) ? opts.attackLv : null;
  const now = Date.now();
  const out = [];
  // No other state yields results yet (departure is REQ-0325); a non-recruiting
  // browse request is answered with an empty list rather than an error.
  if (wantState !== "recruiting") return out;
  for (const room of storage.listRooms()) {
    if (room.visibility !== "public") continue;
    if (room.state !== "recruiting") continue;
    if (freeSeatCount(room) < 1) continue;   // a full Troop offers no seat
    if (attackLv !== null && room.level !== attackLv) continue;
    out.push({
      roomId: room.id,
      seats: filledSeatCount(room) + "/" + (room.slots ? room.slots.length : SQUAD_SLOTS.length),
      attackLv: room.level,
      hostId: room.hostId || room.ownerId,
      ageSec: Math.max(0, Math.floor((now - Date.parse(room.createdAt)) / 1000)),
    });
  }
  return out;
}

module.exports = {
  createTroop,
  joinTroop,
  leaveTroop,
  getTroopOr404,
  settleTroopIfDue, // REQ-0325: poll-driven departed-troop settle/auto-restart
  listRecruitingTroops,
};
