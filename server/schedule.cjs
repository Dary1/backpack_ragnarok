// backpack_ragnarok -- server/schedule.cjs
// REQ-0036 P1-B: the Dungeon Schedule SERVICE (server-side, solo scope --
// rooms are self-only per the P1 split; multi-player joins are P2).
// Business logic sits here; server/api.cjs wires HTTP routes to these
// functions; server/storage.cjs is the sole persistence chokepoint
// (rooms/runs/warehouse), same convention as every other server module.
//
// Scope note: this module implements golden a-q (see docs/REQ/
// REQ-0036-dungeon-schedule.md) for the SOLO room case -- a single
// player fills all 4 unit slots of their own room (golden b: "a sortie
// Party = 4 Units (any number of players)" -- P1-B covers the "1 player,
// 4 units" corner of that space; multi-player joins are a P2 concern and
// intentionally not built here). golden r (warehouse-scoped trade
// between players of the same schedule) is explicitly P3 -- not built.
// golden c's public/friends/friends-of-friends/group visibility levels
// are likewise a P2+ concern once real multi-player matching exists --
// P1-B's rooms are always created with visibility:"self" (only the
// owner can ever see/list/act on their own rooms; enforced both by the
// data model -- a room always carries its ownerId -- and by every route
// handler in api.cjs re-checking the caller's resolved token identity
// against that ownerId, never trusting a client-supplied id).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('./storage.cjs');
const combat = require('../sim/combat.cjs');
const Engine = require('../mock-src/engine.js');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const LIVE_DIR = path.join(CONTENT_DIR, 'live');
const ITEMS_PATH = path.join(LIVE_DIR, 'live_items.json');
const BATCH_DIR = path.join(CONTENT_DIR, 'batches', 'batch-002-dungeon-pilot');
const DUNGEON_PATH = path.join(BATCH_DIR, 'dungeon.json');
const ENEMIES_PATH = path.join(BATCH_DIR, 'enemies.json');
const SKILLS_PATH = path.join(BATCH_DIR, 'skills.json');
const ITEMS_PILOT_PATH = path.join(BATCH_DIR, 'items.json');
const FORMATIONS_PATH = path.join(BATCH_DIR, 'formations.json'); // REQ-0036 P1-C: GET /api/schedule/dungeons

// ---------------------------------------------------------------------
// Tunables (this REQ's own; distinct from sim/combat.cjs's TUNABLES,
// which govern in-run combat math -- these govern schedule-service-level
// policy). All [TUNABLE] / documented interpretations, called out in the
// final report's "Interpretations" list.
// ---------------------------------------------------------------------
const WAREHOUSE_CAP = 200; // golden e: "max 200 items"
const WAREHOUSE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // golden e: "kept up to one week"
const UNIT_SLOTS = ['unit1', 'unit2', 'unit3', 'unit4']; // golden b: party = 4 Units
const DEFAULT_FORMATION_ID = 'formation1';
const DEFAULT_FAILURE_STEP = 1; // golden i default, matches sim TUNABLES.FAILURE_STEP
const DEFAULT_LEVEL_MIN = combat.TUNABLES.LEVEL_MIN;

// ---------------------------------------------------------------------
// Content loading (mtime-cached, mirrors api.cjs's getContent() pattern).
// ---------------------------------------------------------------------
let contentCache = null; // { mtimes, payload }

function statMtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return null; }
}
function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getScheduleContent() {
  const mtimes = {
    items: statMtimeMs(ITEMS_PATH),
    dungeon: statMtimeMs(DUNGEON_PATH),
    enemies: statMtimeMs(ENEMIES_PATH),
    skills: statMtimeMs(SKILLS_PATH),
    pilotItems: statMtimeMs(ITEMS_PILOT_PATH),
    formations: statMtimeMs(FORMATIONS_PATH), // REQ-0036 P1-C
  };
  const stale = !contentCache || Object.keys(mtimes).some((k) => mtimes[k] !== contentCache.mtimes[k]);
  if (!stale) return contentCache.payload;

  const liveItems = loadJSON(ITEMS_PATH);
  const pilotItems = loadJSON(ITEMS_PILOT_PATH);
  const dungeonDef = loadJSON(DUNGEON_PATH);
  const enemies = loadJSON(ENEMIES_PATH);
  const skills = loadJSON(SKILLS_PATH);
  const formationsDoc = loadJSON(FORMATIONS_PATH); // REQ-0036 P1-C

  const itemDefsById = {};
  for (const e of liveItems.entries) itemDefsById[e.id] = e;
  for (const e of pilotItems.entries) itemDefsById[e.id] = e; // pilot items overlay live (batch-002 demo modes)

  const enemyDefsById = {};
  for (const e of enemies.entries) enemyDefsById[e.id] = e;

  const skillDefsById = {};
  for (const s of skills.entries) {
    skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
  }

  const payload = { itemDefsById, dungeonDef, enemyDefsById, skillDefsById, formationsDoc };
  contentCache = { mtimes, payload };
  return payload;
}

// ---------------------------------------------------------------------
// REQ-0036 P1-C: GET /api/schedule/dungeons support. The rooms API never
// exposed a dungeon/formation LIST endpoint (P1-B only ever consumed a
// caller-supplied dungeonId/formationId at room-create time) -- the
// client's create-room form needs somewhere to fetch the pilot batch's
// one dungeon def + 4 formation defs from, rather than hardcoding them.
// Reuses getScheduleContent()'s own mtime-cache (dungeonDef +
// formationsDoc are already loaded there) -- no second cache/read path.
// Public, read-only, matches /api/content's own no-auth convention (see
// server/api.cjs's route dispatch -- this route is special-cased BEFORE
// the schedule auth gate for exactly this reason).
// ---------------------------------------------------------------------
function listDungeonsAndFormations() {
  const { dungeonDef, formationsDoc } = getScheduleContent();
  const dungeons = [{ id: dungeonDef.id, name: dungeonDef.name, i18n: dungeonDef.i18n || {} }];
  const formations = (formationsDoc.entries || []).map((f) => ({
    id: f.id,
    name: (f.i18n && f.i18n.en && f.i18n.en.name) || f.id,
    i18n: f.i18n || {},
    canvases: f.canvases,
  }));
  return { dungeons, formations };
}

// Reward-roll id -> real content item id resolution table. batch-002's
// dungeon.json rewardItems reference abstract roll ids
// (reward_frost_shard_common etc.) rather than real live_items.json ids,
// since S5 icon art + S7 user review for that batch's own items hasn't
// happened yet (see content/batches/batch-002-dungeon-pilot/notes.md).
// Documented interpretation: resolve each roll id through this table to
// a REAL, already-live content item id so warehouse claim -> inventory
// first-fit has a genuine placeable item to work with end-to-end; a roll
// id absent from this table (e.g. once batch-002 content goes live and
// dungeon.json is updated to reference real ids directly) falls back to
// treating the roll id AS the item id unchanged, so this table becomes a
// no-op shim the day real content replaces the placeholders.
const REWARD_ROLL_TO_ITEM_ID = {
  reward_frost_shard_common: 'oil_flask',
  reward_frost_shard_uncommon: 'herb_pouch',
  reward_frostbound_cache_roll: 'hilt',
  reward_boss_relic_roll: 'tower_shield',
};
function resolveRewardItemId(rollId) {
  return REWARD_ROLL_TO_ITEM_ID[rollId] || rollId;
}

// Engine instance factory. schedule.cjs only ever needs shapeInfo/
// invCanPlacePO/invMovePO (warehouse claim first-fit) and
// isUnitIndependent (deploy gate) -- never sockets/combos/beams -- so a
// minimal 8x8-layout instance bound to the CURRENT item defs is enough.
// A fresh instance per call is cheap (no heavy setup in Engine.create)
// and safest against itemDefsById changing between calls (content hot-
// reload, same mtime-cache convention as api.cjs's own content path).
function makeEngine(itemDefsById) {
  return Engine.create(itemDefsById, {}, { ROWS: 8, COLS: 8 }, { po_tags: {}, socket_tags: {} });
}

// ---------------------------------------------------------------------
// Room id / uid generation (mirrors players.cjs's generatePlayerId style:
// not secret, just unique + filesystem/key-safe).
// ---------------------------------------------------------------------
function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------
// Room CRUD
// ---------------------------------------------------------------------

// A room document's shape:
// {
//   id, ownerId, dungeonId, level, visibility: 'self', formationId,
//   cancelPolicy: { immediate: bool },
//   slots: [ { presetIndex: number|null } x4 ],  // golden b/d: this player's own preset per slot
//   status: 'open' | 'active' | 'canceled',
//   cancelRequested: bool,   // golden g: non-immediate cancel flag ("cancel after current run")
//   pendingSwap: { slot, presetIndex } | null,  // golden j: queued, applies after current run
//   cooldownUntil: iso string | null,
//   createdAt, updatedAt,
//   lastRunId: string | null,
// }

function validateCancelPolicy(cancelPolicy) {
  if (!cancelPolicy || typeof cancelPolicy !== 'object') return { immediate: true };
  return { immediate: cancelPolicy.immediate !== false };
}

function createRoom(ownerId, opts) {
  const { dungeonId, level, formationId, cancelPolicy } = opts || {};
  if (typeof dungeonId !== 'string' || !dungeonId) {
    const err = new Error('dungeonId is required'); err.code = 'BAD_REQUEST'; throw err;
  }
  const lvl = Number.isFinite(level) ? Math.max(DEFAULT_LEVEL_MIN, Math.floor(level)) : DEFAULT_LEVEL_MIN;
  const fId = (typeof formationId === 'string' && combat.FORMATIONS[formationId]) ? formationId : DEFAULT_FORMATION_ID;
  const now = new Date().toISOString();
  const room = {
    id: genId('room'),
    ownerId,
    dungeonId,
    level: lvl,
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

// Every uid deployed by `playerId` across every OTHER currently-ACTIVE
// room (status 'active', i.e. mid-run or awaiting its next auto-run) --
// the cross-room half of golden d's gate. `excludeRoomId` lets a check
// against the room being acted on itself skip its own already-recorded
// deployment (re-assigning a slot within the SAME room is a same-room
// concern, not a cross-room overlap).
function deployedUidsForOtherActiveRooms(playerId, excludeRoomId, profileCanvas) {
  const out = new Set();
  const rooms = storage.listRooms();
  for (const room of rooms) {
    if (room.id === excludeRoomId) continue;
    if (room.ownerId !== playerId) continue;
    if (room.status !== 'active') continue; // only CURRENTLY-ACTIVE schedules gate (golden d)
    for (const slot of room.slots) {
      if (slot.presetIndex == null) continue;
      const presetCanvas = presetCanvasOf(profileCanvas, slot.presetIndex);
      for (const uid of presetUidSet(presetCanvas)) out.add(uid);
    }
  }
  return out;
}

// assignSlot: golden b/d. `presetIndex` picks one of the CALLER's OWN
// presets (0-based) to fill room slot `slotIndex`. Enforces the full
// deploy gate: (1) isUnitIndependent for that preset against the
// player's OTHER presets, (2) no uid overlap with the player's OWN
// deployed units in any other CURRENTLY-ACTIVE room. Throws
// {code:'CONFLICT'} (mapped to 409 by api.cjs) on either violation.
function assignSlot(room, callerId, slotIndex, presetIndex, profileCanvas, itemDefsById) {
  if (slotIndex < 0 || slotIndex >= UNIT_SLOTS.length) {
    const err = new Error('slotIndex out of range'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (!profileCanvas || !profileCanvas.presets || presetIndex < 0 || presetIndex >= profileCanvas.presets.store.length) {
    const err = new Error('presetIndex out of range for this player'); err.code = 'BAD_REQUEST'; throw err;
  }
  const engine = makeEngine(itemDefsById);
  if (!isUnitIndependent(engine, profileCanvas, presetIndex)) {
    const err = new Error('preset is not independent: it shares an item with another of your presets');
    err.code = 'CONFLICT'; throw err;
  }
  const myPresetUids = presetUidSet(presetCanvasOf(profileCanvas, presetIndex));
  const otherActiveUids = deployedUidsForOtherActiveRooms(callerId, room.id, profileCanvas);
  for (const uid of myPresetUids) {
    if (otherActiveUids.has(uid)) {
      const err = new Error('preset overlaps a unit already deployed in another active schedule');
      err.code = 'CONFLICT'; throw err;
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

function computeDurationSecs(events) {
  let maxT = 0;
  for (const e of events) if (typeof e.t === 'number' && e.t > maxT) maxT = e.t;
  return maxT;
}

function runClock(run) {
  const startedMs = Date.parse(run.startedAt);
  const elapsedSecs = Math.max(0, (Date.now() - startedMs) / 1000);
  const isSettled = elapsedSecs >= run.durationSecs;
  return { elapsedSecs, durationSecs: run.durationSecs, isSettled, pct: run.durationSecs > 0 ? Math.min(100, (elapsedSecs / run.durationSecs) * 100) : 100 };
}

function visibleEvents(run) {
  const clock = runClock(run);
  return run.events.filter((ev) => typeof ev.t === 'number' && ev.t <= clock.elapsedSecs);
}

// Builds the unitSnapshots[4] array runDungeon expects, one per slot, by
// reading the OWNER's own profile presets (solo scope: every slot in a
// P1-B room belongs to the same player). A slot with no assigned preset
// (presetIndex===null) is illegal at start time (caller must fill all 4
// slots first, per golden b "party = 4 Units" -- a partial party cannot
// sortie).
function buildUnitSnapshots(room, profileCanvas) {
  return room.slots.map((slot, i) => {
    if (slot.presetIndex == null) {
      const err = new Error('slot ' + i + ' (' + UNIT_SLOTS[i] + ') has no assigned unit'); err.code = 'BAD_REQUEST'; throw err;
    }
    const canvas = presetCanvasOf(profileCanvas, slot.presetIndex);
    if (!canvas) { const err = new Error('slot ' + i + ' preset snapshot not found'); err.code = 'BAD_REQUEST'; throw err; }
    return canvas;
  });
}

// startRun: golden b/j. Compiles UNIT COPIES (deep-copied snapshots,
// taken NOW, at start -- sim/combat.cjs's own compileUnitSnapshot deep-
// copies again internally too, so a unit edited by its owner mid-run
// never affects the in-flight run; golden j "runs execute on a copy of
// the unit"). Seed is crypto-random, generated here and STORED verbatim
// on the run document (never re-rolled), so the run is independently
// re-derivable/auditable from its own record.
function startRun(room, profileCanvas) {
  if (room.status === 'active') {
    const err = new Error('room already has an active run'); err.code = 'CONFLICT'; throw err;
  }
  if (room.status === 'canceled') {
    const err = new Error('room is canceled'); err.code = 'CONFLICT'; throw err;
  }
  const unitSnapshots = buildUnitSnapshots(room, profileCanvas);
  const { itemDefsById, dungeonDef, enemyDefsById, skillDefsById } = getScheduleContent();
  if (room.dungeonId !== dungeonDef.id) {
    const err = new Error('unknown or unsupported dungeonId: ' + room.dungeonId); err.code = 'BAD_REQUEST'; throw err;
  }
  const seed = crypto.randomBytes(16).toString('hex'); // crypto random, stored (per task brief)
  const participants = [room.ownerId]; // solo scope: the room owner is the sole participant/reward recipient

  const result = combat.runDungeon({
    masterSeed: seed, dungeonDef, unitSnapshots, itemDefsById, enemyDefsById, skillDefsById,
    formationId: room.formationId, level: room.level, participants,
  });

  const runId = genId('run');
  const startedAt = new Date().toISOString();
  const runDoc = {
    id: runId,
    roomId: room.id,
    seed,
    startedAt,
    durationSecs: computeDurationSecs(result.events),
    events: result.events,
    result: result.result, // 'victory' | 'wipe' | 'incomplete'
    finalProgressPct: result.finalProgressPct,
    rewards: result.rewards, // [{item, participant}] per distributeRewardsUniform
    cooldownSecs: result.cooldownSecs,
    levelAfter: result.level, // wipe -> level-1 (floored); else unchanged
    H: result.H,
    settled: false,
  };
  storage.writeRun(runId, runDoc);

  room.status = 'active';
  room.lastRunId = runId;
  room.updatedAt = startedAt;
  storage.writeRoom(room.id, room);
  return runDoc;
}

// settleRun: applies a completed (run-clock-elapsed) run's EFFECTS
// exactly once -- rewards -> warehouse, cooldown, level change on wipe
// (golden i), pending-swap application (golden j), then AUTO-SCHEDULEs
// the next run after the cooldown window unless the room was canceled
// (golden g) or flagged cancel-after-current-run. Idempotent via
// run.settled -- safe to call from multiple readers racing to observe
// isSettled===true (files-mode has no cross-request lock, so this
// module accepts a benign double-apply race in that mode as an accepted
// dev-grade risk, same class of risk server/README.md already documents
// for storage.cjs profile writes; a real production hardening pass would
// add a compare-and-swap or DB-level row lock).
function settleRun(room, run, profileCanvas, itemDefsById) {
  if (run.settled) return { room, run };

  const now = new Date().toISOString();

  if (run.result !== 'wipe') {
    // distributeRewardsUniform's assignment shape is {item, owner,
    // destination} (sim/combat.cjs) -- `owner` is the participant id the
    // uniform-random draw picked (golden p: "distribution fully RANDOM").
    for (const assignment of run.rewards) {
      const itemUid = genId('wh');
      const itemId = resolveRewardItemId(assignment.item);
      const doc = {
        itemUid, playerId: assignment.owner, itemId,
        harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: room.id, sourceRunId: run.id,
      };
      addToWarehouse(assignment.owner, doc);
    }
  }
  // wipe: golden i "nothing else" -- no rewards, no other side effect
  // beyond the level-down + cooldown already computed by runDungeon.

  room.level = run.levelAfter;
  room.cooldownUntil = new Date(Date.now() + run.cooldownSecs * 1000).toISOString();
  room.status = 'open'; // no run currently in flight; auto-schedule (below) will flip it back once cooldown clears
  room.updatedAt = now;

  const swapped = applyPendingSwapIfAny(room, profileCanvas, itemDefsById);

  run.settled = true;
  storage.writeRun(run.id, run);
  storage.writeRoom(swapped.id, swapped);

  return { room: swapped, run };
}

// settleRoomIfDue: the lazy-settlement entry point every route handler
// that touches a room calls first. If the room's lastRunId points at a
// run whose clock has elapsed and hasn't been settled yet, settle it
// (applying rewards/cooldown/swap/auto-schedule) before doing anything
// else with the room. This is what makes "scheduled auto-runs" a real,
// observable design fact without a background scheduler process: the
// NEXT run auto-starts (see maybeAutoStartNextRun below) the next time
// ANYONE looks at this room after its cooldown has elapsed -- a purely
// lazy, poll-driven scheduler, consistent with this service's overall
// "compute instantly, reveal/react lazily" philosophy.
function settleRoomIfDue(room, profileCanvas, itemDefsById) {
  if (room.status === 'active' && room.lastRunId) {
    const run = storage.readRun(room.lastRunId);
    if (run) {
      const clock = runClock(run);
      if (clock.isSettled) {
        const { room: settledRoom } = settleRun(room, run, profileCanvas, itemDefsById);
        return maybeAutoStartNextRun(settledRoom, profileCanvas);
      }
    }
    return room; // still mid-run (clock not yet elapsed)
  }
  // Not currently active: this covers BOTH "the very first run, once all
  // 4 slots just got filled" (status is 'open', cooldownUntil is still
  // null) AND "a later cooldown window that has now cleared" -- either
  // way, maybeAutoStartNextRun's own guards (cancelRequested, cooldown
  // not yet elapsed, incomplete slots) decide whether anything actually
  // happens.
  if (room.status === 'open') return maybeAutoStartNextRun(room, profileCanvas);
  return room;
}

// maybeAutoStartNextRun (golden i "then AUTO-SCHEDULE the next run after
// cooldown unless canceled" -- "scheduled auto-runs = core design fact").
// Fires the moment the room's cooldownUntil has passed, UNLESS the room
// was canceled outright, or flagged cancelRequested (golden g: "cancel
// after current run" -- the run that just settled WAS that "current
// run", so a pending cancelRequested is honored here by canceling the
// room instead of auto-starting the next one).
function maybeAutoStartNextRun(room, profileCanvas) {
  if (room.status !== 'open') return room; // already active, or canceled
  if (room.cancelRequested) {
    room.status = 'canceled';
    room.updatedAt = new Date().toISOString();
    storage.writeRoom(room.id, room);
    return room;
  }
  if (room.cooldownUntil && Date.now() < Date.parse(room.cooldownUntil)) return room; // still cooling down
  // All 4 slots still need a live assignment (a swap could have cleared
  // one -- defensive; assignSlot never actually clears a slot today, but
  // this guards any future path that could).
  if (room.slots.some((s) => s.presetIndex == null)) return room;
  // startRun() returns the RUN document (its own persisted record), not
  // the room -- but it mutates `room` in place (status/lastRunId/
  // updatedAt) before persisting it via storage.writeRoom, so the SAME
  // `room` object reference is already up to date by the time it
  // returns. Returning `room` here (not startRun's return value) is what
  // callers of maybeAutoStartNextRun/settleRoomIfDue actually expect
  // (they operate on rooms throughout, never runs).
  startRun(room, profileCanvas);
  return room;
}

// ---------------------------------------------------------------------
// Warehouse (golden e/f). Cap 200 items/player, 7-day TTL from harvest,
// expired items purge LAZILY on read + a scheduled sweep.
// ---------------------------------------------------------------------

function isExpired(item, nowMs) {
  return Date.parse(item.expiresAt) <= (nowMs != null ? nowMs : Date.now());
}

// purgeExpiredWarehouseItems: lazy sweep, called by every warehouse read
// AND exposed standalone for a periodic scheduled sweep (see
// server/api.cjs's boot-time setInterval). Deletes every expired row for
// `playerId` and returns the surviving (unexpired) list -- callers never
// see an expired item, whether they triggered the purge themselves or a
// previous sweep already caught it.
function purgeExpiredWarehouseItems(playerId) {
  const now = Date.now();
  const items = storage.listWarehouseItems(playerId);
  const survivors = [];
  for (const item of items) {
    if (isExpired(item, now)) {
      storage.deleteWarehouseItem(playerId, item.itemUid);
    } else {
      survivors.push(item);
    }
  }
  return survivors;
}

// addToWarehouse: enforces the 200-item cap (golden e) at INSERT time.
// Purges expired items first (an expired slot must not count against the
// cap), then refuses if still at cap. Documented interpretation: a
// dungeon reward that arrives when the warehouse is already full is
// SILENTLY DROPPED (not queued, not bounced back to the run) -- the REQ
// doesn't specify overflow behavior for reward accrual specifically
// (only the general "max 200 items" cap), and a hard drop is safer than
// either blocking run settlement on warehouse space or silently
// exceeding the cap; flagged in the final report's interpretations list.
function addToWarehouse(playerId, doc) {
  const survivors = purgeExpiredWarehouseItems(playerId);
  if (survivors.length >= WAREHOUSE_CAP) return { ok: false, reason: 'warehouse full' };
  storage.writeWarehouseItem(playerId, doc.itemUid, doc);
  return { ok: true, item: doc };
}

function listWarehouse(playerId) {
  return purgeExpiredWarehouseItems(playerId);
}

// claimWarehouseItem (golden f): "Warehouse -> inventory transfer any
// time." FIRST-FIT engine home placement (per task brief); refuses (no
// mutation) if there is no space anywhere across the player's 5
// inventory pages. NO inventory->warehouse path exists anywhere in this
// module (golden r's reverse-direction ban, generalized here even ahead
// of P3 trade -- there is simply no function that moves an item from a
// home back into a warehouse row).
//
// Item identity (per task brief): a warehouse row is a REFERENCE to a
// content item id (`itemId`) with its own uid (`itemUid`, minted at
// harvest time by settleRun). Claiming does not reuse `itemUid` as the
// new inventory PO's uid -- a FRESH inventory uid is minted here, since
// `itemUid` names the warehouse-row instance (which is deleted on
// claim), not the eventual on-canvas PO instance; this keeps warehouse
// uids and inventory/engine uids in visibly separate id spaces (matches
// the existing convention of every uid-minting call site in this repo
// using a distinguishing prefix, e.g. players.cjs's 'p_', this module's
// own 'room_'/'run_'/'wh_').
function claimWarehouseItem(playerId, itemUid, profileCanvas, itemDefsById) {
  purgeExpiredWarehouseItems(playerId);
  const item = storage.readWarehouseItem(playerId, itemUid);
  if (!item) { const err = new Error('warehouse item not found (or expired)'); err.code = 'NOT_FOUND'; throw err; }

  const itemDef = itemDefsById[item.itemId];
  if (!itemDef) { const err = new Error('claimed item references an unknown content item id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }

  const engine = makeEngine(itemDefsById);
  if (!profileCanvas.inv) profileCanvas.inv = engine.emptyInventory();

  const newUid = genId('po');
  let placed = null;
  for (let pg = 0; pg < profileCanvas.inv.pages.length && !placed; pg++) {
    const container = profileCanvas.inv.pages[pg];
    container.pos.push({ uid: newUid, id: item.itemId, loc: 'grid', cell: [1, 1], rot: 0 });
    let cell = null;
    outer:
    for (let r = 1; r <= 8 && !cell; r++) {
      for (let c = 1; c <= 8 && !cell; c++) {
        const chk = engine.invCanPlacePO(profileCanvas, pg, newUid, 0, [r, c]);
        if (chk.ok) cell = [r, c];
      }
    }
    if (cell) {
      engine.invMovePO(profileCanvas, pg, newUid, cell);
      placed = { page: pg, cell };
    } else {
      container.pos.pop(); // no room on this page -- roll back, try next page
    }
  }
  if (!placed) {
    const err = new Error('no space in inventory (all pages full) -- claim refused, warehouse item retained');
    err.code = 'CONFLICT'; throw err;
  }

  storage.deleteWarehouseItem(playerId, itemUid);
  return { profileCanvas, placed, newUid };
}

// ---------------------------------------------------------------------
// Cancel (golden g). "Any participating player canceling cancels the
// schedule; room settings may disallow IMMEDIATE cancel." Solo scope:
// the only participating player IS the owner, so this is a straight
// policy check against the room's OWN cancelPolicy.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// REQ-0036 P1-C: dev-only run-clock backdate hook, for E2E "run settles"
// coverage without burning real wall-clock time. See server/README.md's
// "E2E time-control (dev-only backdate hook)" section for the full
// rationale/gating writeup. THIS IS A TEST-CONTROL SEAM, NOT A GAMEPLAY
// FEATURE: it never touches the SEED (a caller cannot bias reward RNG --
// startRun()'s crypto.randomBytes(16) seed generation is completely
// untouched by this function), it only rewrites the ALREADY-COMPUTED
// run's own `startedAt` timestamp further into the past so its run-clock
// (elapsedSecs = (Date.now()-startedAt)/1000) reads as already elapsed on
// the very next read -- exactly mirroring what server/tests/api_test.cjs's
// own forceRunElapsed() test helper has done (server-internally) since
// P1-B. This is the same idea, exposed as a real HTTP route so E2E specs
// (which only have HTTP access, no direct require() of schedule.cjs) can
// do the equivalent without waiting out a real dungeon run's full
// durationSecs (~20s+ for the real niflheim_depths content with a
// detection/unlock-capable unit; unboundedly longer -- e.g. 999s -- for a
// unit that never clears a detection-mode encounter at all, per this
// REQ's own P1-C measurement).
//
// Caller gating (server/api.cjs's route handler, NOT here): only
// reachable when the RESOLVED caller is the dev_mode fallback player
// (no token sent, dev_mode:true) -- see admin.cjs's resolveAuth()/
// readDevUser(). A real guest token (even a valid one) is REFUSED
// (403) by api.cjs before this function is ever called, so no ordinary
// authenticated player can fast-forward their own or anyone else's run.
function devBackdateActiveRun(room, extraSecsIntoPast) {
  if (!room.lastRunId) {
    const err = new Error('room has no run to backdate'); err.code = 'BAD_REQUEST'; throw err;
  }
  const run = storage.readRun(room.lastRunId);
  if (!run) { const err = new Error('run record not found'); err.code = 'NOT_FOUND'; throw err; }
  const pastMs = Date.now() - (run.durationSecs + Math.max(0, Number(extraSecsIntoPast) || 5)) * 1000;
  run.startedAt = new Date(pastMs).toISOString();
  storage.writeRun(run.id, run);
  return run;
}

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
  WAREHOUSE_CAP,
  WAREHOUSE_TTL_MS,
  UNIT_SLOTS,
  DEFAULT_FORMATION_ID,
  DEFAULT_FAILURE_STEP,
  getScheduleContent,
  resolveRewardItemId,
  makeEngine,
  presetCanvasOf,
  presetUidSet,
  isUnitIndependent,
  deployedUidsForOtherActiveRooms,
  createRoom,
  getRoomOr404,
  getOwnRoomOr404,
  listOwnRooms,
  assignSlot,
  swapUnit,
  applyPendingSwapIfAny,
  computeDurationSecs,
  runClock,
  visibleEvents,
  buildUnitSnapshots,
  startRun,
  settleRun,
  settleRoomIfDue,
  maybeAutoStartNextRun,
  isExpired,
  purgeExpiredWarehouseItems,
  addToWarehouse,
  listWarehouse,
  claimWarehouseItem,
  cancelRoom,
  listDungeonsAndFormations,
  devBackdateActiveRun,
};
