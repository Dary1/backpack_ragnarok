'use strict';
// server/services/units.cjs -- REQ-0047 (c): preset canvases, uid sets,
// the deploy gate (isUnitIndependent / isUnitDeployable /
// deployedUidSetsForGate) and slot assignment/swap, moved VERBATIM from
// server/schedule.cjs.
const storage = require('../storage.cjs');
const { UNIT_SLOTS, makeEngine } = require('./core.cjs');

function presetCanvasOf(canvas, idx) {
  if (!canvas || !canvas.presets) return null;
  if (idx === canvas.presets.active) return { bps: canvas.bps, pos: canvas.pos, sis: canvas.sis };
  const stored = canvas.presets.store[idx];
  return stored || null;
}

function presetUidSet(presetCanvas) {
  const s = new Set();
  if (!presetCanvas) return s;
  for (const p of presetCanvas.pos || []) s.add(p.uid);
  for (const b of presetCanvas.bps || []) s.add(b.id);
  for (const a of presetCanvas.sis || []) s.add(a.uid);
  return s;
}

// isUnitIndependent(canvas, presetIndex) -- delegates to
// mock-src/engine.js's OWN exported isUnitIndependent (golden d cites
// REQ-0033 independence data as the enforcement source; this is that
// exact function, not a reimplementation). Needs an engine instance
// bound to some itemDefsById -- isUnitIndependent never actually
// dereferences item defs (it only compares uid sets), so any bound
// instance works; callers pass the schedule content's itemDefsById for
// consistency/cache reuse.
function isUnitIndependent(engine, canvas, presetIndex) {
  return engine.isUnitIndependent(canvas, presetIndex);
}

// isUnitDeployable(engine, canvas, presetIndex) -- REQ-0041 feedback 5
// server-side half of the deploy gate ("presets WITHOUT any BP must NOT
// be deployable" -- Backpack-as-HP, zero BP = dead on arrival).
// Delegates to mock-src/engine.js's OWN exported isUnitDeployable (same
// "delegate, don't reimplement" convention as isUnitIndependent just
// above -- this is the actual golden predicate, not a server-side
// reimplementation of the bps.length check).
function isUnitDeployable(engine, canvas, presetIndex) {
  return engine.isUnitDeployable(canvas, presetIndex);
}

// REQ-0045 (b)+(c) deploy gate v2 -- DEPLOYED-OVERLAP, replacing
// isUnitIndependent-as-gate entirely.
//
// Root cause of bug (b): the OLD gate called isUnitIndependent (engine.js)
// as a hard blocker. isUnitIndependent is a STATIC, EDIT-TIME predicate --
// "does this preset share ANY uid with ANY OTHER preset in the player's
// OWN warehouse" (REQ-0033's yellow-tint concept) -- completely unrelated
// to whether that OTHER preset's unit is actually DEPLOYED anywhere. A
// player routinely has presets that share a spare/backup item (e.g. two
// presets both referencing the same off-duty SI sitting unused in
// inventory) with NO intention of ever running them simultaneously --
// the old gate blocked deployment of EITHER preset unconditionally the
// moment such sharing existed, regardless of whether the other preset
// was deployed anywhere at all. Root cause of bug (c): duplicate-preset
// detection was an ACCIDENT of the same broken check, not a real rule --
// assigning the SAME presetIndex to two slots of the SAME room never
// intersects that preset against "OTHER presets" (it IS the other slot's
// preset, i==i is always skipped), so isUnitIndependent trivially passed
// for a duplicate; conversely, 4 GENUINELY unique presets could still
// each independently fail isUnitIndependent's check against unrelated
// OTHER presets in the player's warehouse (e.g. preset 5, not even
// involved in this room, sharing an item with preset 3) -- explaining
// the exact "unique-4 refuses to start; duplicate reuse starts fine"
// inversion the user reported: the gate was checking a completely
// different, WRONG set (global warehouse-wide preset-vs-preset sharing)
// instead of the only set that actually matters for a deploy decision
// (uids currently ACTUALLY deployed elsewhere).
//
// New rule: a preset is assignable to a room slot iff its own uid set
// does not intersect the uid sets of every OTHER unit CURRENTLY DEPLOYED
// -- meaning assigned to a slot of (a) any of the player's OTHER
// currently-ACTIVE rooms, OR (b) any OTHER slot of THIS SAME room being
// edited, checked REGARDLESS of this room's own status (a room being
// filled slot-by-slot is not yet 'active', but two of its OWN slots
// pointing at the same uids -- e.g. the same presetIndex assigned twice,
// or two different presets sharing a uid -- is exactly the "same units
// deployed twice" case golden d's "no overlap" rule was always meant to
// forbid, active-room-only or not). isUnitIndependent is UNCHANGED and
// stays exactly what it always was -- the static "yellow" independence
// concept, still used for pure display/tint purposes -- it is simply no
// longer consulted anywhere in this deploy gate.
//
// deployedUidSetsForGate(playerId, room, profileCanvas): every uid
// currently assigned to (a) this SAME room's OTHR slots (any status --
// checked unconditionally, since duplicate-within-this-room is always
// illegal regardless of whether the room has gone active yet) plus (b)
// every OTHER room of this player with status==='active'. `room` is the
// room being edited (already loaded by the caller) -- its OWN slots are
// read directly from it rather than re-fetched from storage, so a
// same-request check sees the room's CURRENT in-memory slot state
// (including any slot the caller is in the middle of assigning via a
// prior call in the same request, though assignSlot is only ever called
// once per HTTP request today).
function deployedUidSetsForGate(playerId, room, profileCanvas, excludeSlotIndex) {
  const out = new Set();
  // (a) this room's OWN other slots, regardless of the room's own status.
  room.slots.forEach((slot, i) => {
    if (i === excludeSlotIndex) return; // the slot being assigned right now never counts against itself
    if (slot.presetIndex == null) return;
    const presetCanvas = presetCanvasOf(profileCanvas, slot.presetIndex);
    for (const uid of presetUidSet(presetCanvas)) out.add(uid);
  });
  // (b) every OTHER active room this player owns.
  const rooms = storage.listRooms();
  for (const otherRoom of rooms) {
    if (otherRoom.id === room.id) continue; // this room's own slots already covered by (a) above
    if (otherRoom.ownerId !== playerId) continue;
    if (otherRoom.status !== 'active') continue; // only CURRENTLY-ACTIVE schedules gate (golden d)
    for (const slot of otherRoom.slots) {
      if (slot.presetIndex == null) continue;
      const presetCanvas = presetCanvasOf(profileCanvas, slot.presetIndex);
      for (const uid of presetUidSet(presetCanvas)) out.add(uid);
    }
  }
  return out;
}

// assignSlot: golden b/d. `presetIndex` picks one of the CALLER's OWN
// presets (0-based) to fill room slot `slotIndex`. Enforces the deploy
// gate: DEPLOYED-OVERLAP only (see deployedUidSetsForGate's doc above) --
// isUnitIndependent is intentionally NOT consulted here (REQ-0045 v2).
// Throws {code:'CONFLICT'} (mapped to 409 by api.cjs) on a violation.
function assignSlot(room, callerId, slotIndex, presetIndex, profileCanvas, itemDefsById) {
  if (slotIndex < 0 || slotIndex >= UNIT_SLOTS.length) {
    const err = new Error('slotIndex out of range'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (!profileCanvas || !profileCanvas.presets || presetIndex < 0 || presetIndex >= profileCanvas.presets.store.length) {
    const err = new Error('presetIndex out of range for this player'); err.code = 'BAD_REQUEST'; throw err;
  }
  const engine = makeEngine(itemDefsById);
  if (!isUnitDeployable(engine, profileCanvas, presetIndex)) {
    // REQ-0041 feedback 5: a preset with zero BP has no HP pool at all --
    // "dead on arrival" -- and must never be assignable to a room slot.
    // This is the server-authoritative half of the deploy gate (the
    // client also disables the slot-picker option pre-emptively, but the
    // server is the one that actually enforces it). err.reason is a
    // STRUCTURED, machine-readable tag (distinct from err.message, which
    // stays a human string) -- threaded through by sendScheduleError
    // (api.cjs) as a `reason` field on the JSON error body, read by the
    // client's ApiError.reason / friendlyScheduleError (schedule/errors.ts).
    const err = new Error('empty unit: preset has no Backpack (BP) and cannot be deployed');
    err.code = 'CONFLICT'; err.reason = 'empty_unit'; throw err;
  }
  const myPresetUids = presetUidSet(presetCanvasOf(profileCanvas, presetIndex));
  const deployedElsewhere = deployedUidSetsForGate(callerId, room, profileCanvas, slotIndex);
  for (const uid of myPresetUids) {
    if (deployedElsewhere.has(uid)) {
      // Same {code,reason} shape golden d's overlap rejection has always
      // used -- reason is intentionally the SAME 'deployed_overlap' tag
      // regardless of whether the overlap came from this room's own
      // other slots (duplicate preset, bug c) or another active room
      // (cross-room overlap, bug b's correct remaining half) -- both are
      // the exact same underlying violation ("this uid is already
      // deployed somewhere"), not two different error classes.
      const err = new Error('preset overlaps a unit already deployed in an active schedule (this room\'s other slots, or another active room)');
      err.code = 'CONFLICT'; err.reason = 'deployed_overlap'; throw err;
    }
  }
  room.slots[slotIndex] = { presetIndex };
  room.updatedAt = new Date().toISOString();
  storage.writeRoom(room.id, room);
  return room;
}

// swapUnit (golden j): "applies AFTER current run (queued; notification
// field for future multi)". Solo-scope: only one pending swap slot is
// needed (no concurrent-swap-request queue across players -- that's a
// P2 concern once multiple real players can each own a swap request).
// If the room has NO run currently in flight (status !== 'active'), the
// swap can apply immediately -- there is no "current run" to wait out.
function swapUnit(room, slotIndex, presetIndex, profileCanvas, itemDefsById) {
  if (slotIndex < 0 || slotIndex >= UNIT_SLOTS.length) {
    const err = new Error('slotIndex out of range'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (room.status === 'active') {
    // Queued -- a run is currently executing (or about to auto-start);
    // applied by settleRun() the moment the in-flight run finishes.
    room.pendingSwap = { slot: slotIndex, presetIndex, notify: true, queuedAt: new Date().toISOString() };
    room.updatedAt = new Date().toISOString();
    storage.writeRoom(room.id, room);
    return { room, applied: false };
  }
  // No run in flight: validate + apply immediately via the same gate
  // assignSlot already enforces (independence + cross-room overlap).
  const updated = assignSlot(room, room.ownerId, slotIndex, presetIndex, profileCanvas, itemDefsById);
  return { room: updated, applied: true };
}

// applyPendingSwapIfAny: called right after a run settles (golden j:
// "swap applies after the current RUN ends"). Best-effort -- if the
// queued preset is no longer legal (e.g. the player broke its
// independence in the meantime), the swap is silently dropped rather
// than crashing run settlement; a client can re-request it.
function applyPendingSwapIfAny(room, profileCanvas, itemDefsById) {
  if (!room.pendingSwap) return room;
  const { slot, presetIndex } = room.pendingSwap;
  room.pendingSwap = null;
  try {
    return assignSlot(room, room.ownerId, slot, presetIndex, profileCanvas, itemDefsById);
  } catch (e) {
    storage.writeRoom(room.id, room); // persist pendingSwap:null even if the swap itself failed legality
    return room;
  }
}

// ---------------------------------------------------------------------
// Run lifecycle (server-authoritative). Run clock design (documented
// per the task brief -- see server/README.md's Schedule section for the
// user-facing writeup too):
//
// The ENTIRE run is simulated INSTANTLY at start time via
// sim/combat.cjs's runDungeon (event-driven continuous-time sim, not a
// realtime loop) -- there is no sleep-block, no setTimeout chain, no
// background timer thread. Every event in the resulting log already
// carries its own `t` (seconds-since-run-start) field (sim/combat.cjs's
// own event schema). What we ADD at persistence time is exactly two
// wall-clock fields on the run document: `startedAt` (ISO timestamp,
// captured once, at run creation) and `durationSecs` (= the run's LAST
// event's `t`, i.e. how long a real-time playback would take to reach
// run_end). A "run clock" is then just: `elapsedSecs = (Date.now() -
// Date.parse(startedAt)) / 1000`, and `isSettled = elapsedSecs >=
// durationSecs`. `visibleEvents(run)` filters the (already-fully-
// computed) event array down to `ev.t <= elapsedSecs` -- this is a PURE
// read-time computation, needs no stored mutable "progress" field, and
// is safe to call from any number of concurrent spectators/polls without
// any synchronization at all (every caller independently derives the
// same elapsedSecs from the same two stored numbers + the wall clock).
// A client monitor polling this (or a future SSE/WS push of the same
// computation) sees events "arrive" at the same pace they would have in
// a live-ticking sim, without the server ever having blocked a thread or
// held a timer open for the run's duration.
//
// This is deliberately NOT "the sim runs in real time" -- it is "the sim
// runs instantly, the REVEAL is paced to real time." Rationale (per the
// task brief): (1) offline-first friendly -- a room's outcome exists
// complete and durable the instant the run starts, so a client that goes
// offline mid-"broadcast" and reconnects later just resumes reading from
// wherever elapsedSecs now points, no lost state, no reconnect protocol;
// (2) cheap -- the server holds no per-run timer/interval/worker for the
// run's duration, however many runs are "in flight" from a spectating
// point of view; a wiped or victorious run's rewards/cooldown/next-
// schedule are computed and applied ONCE, lazily, the first time any
// caller's read (or the next room action) observes isSettled===true --
// see settleRoomIfDue() below.
// ---------------------------------------------------------------------


module.exports = {
  presetCanvasOf,
  presetUidSet,
  isUnitIndependent,
  isUnitDeployable,
  deployedUidSetsForGate,
  assignSlot,
  swapUnit,
  applyPendingSwapIfAny,
};
