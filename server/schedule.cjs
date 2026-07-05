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
const dungen = require('../sim/dungen.cjs');
const Engine = require('../mock-src/engine.js');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const LIVE_DIR = path.join(CONTENT_DIR, 'live');
const ITEMS_PATH = path.join(LIVE_DIR, 'live_items.json');
const TMS_PATH = path.join(LIVE_DIR, 'live_tms.json'); // REQ-0042: Transmutator content defs
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
// REQ-0041 (P1 UX round 1): two-phase warehouse claim. A row transitions
// claimable -> claiming (server, on POST /api/warehouse/claim) -> deleted
// (server, on the NEXT successful profile PUT that contains the minted
// uid anywhere in the saved canvas -- see finalizeClaimingItemsForCanvas()
// below, called from server/api.cjs's profile PUT handler). A `claiming`
// row older than this timeout lazily reverts to `claimable` the next time
// warehouse rows are read (purgeExpiredWarehouseItems), so a crashed/
// abandoned client claim never permanently strands the item -- "no item
// loss on crash" per the REQ's own design note.
const WAREHOUSE_CLAIM_TIMEOUT_MS = 120 * 1000; // 120s
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
    tms: statMtimeMs(TMS_PATH), // REQ-0042
    dungeon: statMtimeMs(DUNGEON_PATH),
    enemies: statMtimeMs(ENEMIES_PATH),
    skills: statMtimeMs(SKILLS_PATH),
    pilotItems: statMtimeMs(ITEMS_PILOT_PATH),
    formations: statMtimeMs(FORMATIONS_PATH), // REQ-0036 P1-C
  };
  const stale = !contentCache || Object.keys(mtimes).some((k) => mtimes[k] !== contentCache.mtimes[k]);
  if (!stale) return contentCache.payload;

  const liveItems = loadJSON(ITEMS_PATH);
  const liveTms = loadJSON(TMS_PATH); // REQ-0042
  const pilotItems = loadJSON(ITEMS_PILOT_PATH);
  const dungeonDef = loadJSON(DUNGEON_PATH);
  const enemies = loadJSON(ENEMIES_PATH);
  const skills = loadJSON(SKILLS_PATH);
  const formationsDoc = loadJSON(FORMATIONS_PATH); // REQ-0036 P1-C

  const itemDefsById = {};
  for (const e of liveItems.entries) itemDefsById[e.id] = e;
  for (const e of pilotItems.entries) itemDefsById[e.id] = e; // pilot items overlay live (batch-002 demo modes)

  // REQ-0042: TM (Transmutator) defs, same id-keyed map shape as
  // itemDefsById above -- used by the admin grant route's tm+qty branch
  // to validate a granted tm id against real content (same "400 for an
  // unknown id, never a silent dangling reference" convention).
  const tmDefsById = {};
  for (const e of liveTms.entries) tmDefsById[e.id] = e;

  const enemyDefsById = {};
  for (const e of enemies.entries) enemyDefsById[e.id] = e;

  const skillDefsById = {};
  for (const s of skills.entries) {
    skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
  }

  const payload = { itemDefsById, tmDefsById, dungeonDef, enemyDefsById, skillDefsById, formationsDoc };
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
//
// REQ-0043: rooms now create against a GENERATED dungeon (dungeonType +
// level + optional genSeed), not just the one static pilot dungeon --
// this payload gains a `types` list (sim/dungen.cjs's DUNGEON_TYPES:
// 'default' generated, 'test_fixed' the hand-authored batch-002 sequence
// verbatim) with a short i18n label + level-hint note per type, so the
// client's create-room form can offer a real type selector instead of
// hardcoding the two known ids. The original `dungeons` array is KEPT
// byte-for-byte (still lists the static niflheim_depths entry) for
// backward compat with any existing caller/E2E assertion that reads
// `dungeons[0].id === 'niflheim_depths'` -- additive only, nothing
// removed.
// ---------------------------------------------------------------------
const DUNGEON_TYPE_I18N = {
  default: {
    en: { name: 'Auto-Generated', note: 'Encounter count/composition scales with the room level you pick.' },
    ja: { name: '自動生成', note: '選択したレベルに応じてエンカウント数・構成がスケールします。' },
  },
  test_fixed: {
    en: { name: 'Niflheim Depths (fixed)', note: 'The hand-authored batch-002 encounter sequence, unaffected by level or seed.' },
    ja: { name: 'ニヴルヘイムの深層（固定）', note: 'batch-002の手作りエンカウント順。レベルやシードの影響を受けません。' },
  },
};

function listDungeonsAndFormations() {
  const { dungeonDef, formationsDoc } = getScheduleContent();
  const dungeons = [{ id: dungeonDef.id, name: dungeonDef.name, i18n: dungeonDef.i18n || {} }];
  const types = dungen.DUNGEON_TYPES.map((id) => ({
    id,
    name: (DUNGEON_TYPE_I18N[id] && DUNGEON_TYPE_I18N[id].en.name) || id,
    i18n: DUNGEON_TYPE_I18N[id] || {},
  }));
  const formations = (formationsDoc.entries || []).map((f) => ({
    id: f.id,
    name: (f.i18n && f.i18n.en && f.i18n.en.name) || f.id,
    i18n: f.i18n || {},
    canvases: f.canvases,
  }));
  return { dungeons, types, formations };
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
// invCanPlacePO/invMovePO (warehouse claim first-fit) and isUnitDeployable
// (empty-unit gate) -- never sockets/combos/beams -- so a minimal 8x8-
// layout instance bound to the CURRENT item defs is enough. (REQ-0045:
// isUnitIndependent is no longer part of the deploy gate -- see
// deployedUidSetsForGate's doc -- but this engine instance is still used
// for it where callers want the static display/tint concept.)
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
//   id, ownerId, dungeonId, dungeonType, level, genSeed, visibility: 'self', formationId,
//   cancelPolicy: { immediate: bool },
//   slots: [ { presetIndex: number|null } x4 ],  // golden b/d: this player's own preset per slot
//   status: 'open' | 'active' | 'canceled',
//   cancelRequested: bool,   // golden g: non-immediate cancel flag ("cancel after current run")
//   pendingSwap: { slot, presetIndex } | null,  // golden j: queued, applies after current run
//   cooldownUntil: iso string | null,
//   createdAt, updatedAt,
//   lastRunId: string | null,
// }
//
// REQ-0043: dungeonType/level/genSeed drive sim/dungen.cjs's generate()
// at run-start time (see startRun() below) rather than every run always
// loading the one static batch-002 dungeon.json. `dungeonId` is KEPT on
// the room doc (backward compat with the ApiRoom client type + any
// existing caller reading it) but is no longer the sole run-selection
// key -- see resolveDungeonType() for the derivation/back-compat rule.

// resolveDungeonType: derives the room's dungeonType from create-room
// opts. Explicit `dungeonType` wins (validated against dungen's own
// DUNGEON_TYPES list -- unknown value is a 400, same convention as an
// unknown formationId silently falling back would NOT be -- a bad
// dungeonType is a caller mistake worth surfacing, not silently
// swallowed, since picking the WRONG generator silently would be
// confusing). Absent an explicit dungeonType, back-compat: a
// `dungeonId` equal to the static pilot dungeon's own id
// ('niflheim_depths') maps to 'test_fixed' (that IS the same hand-
// authored content dungen.generateTestFixed() returns verbatim, so this
// preserves every existing caller's observed behavior byte-for-byte);
// any other/absent dungeonId defaults to 'default' (the generator).
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
  const { itemDefsById, enemyDefsById, skillDefsById } = getScheduleContent();
  // REQ-0043: the dungeon def now comes from sim/dungen.cjs's generator,
  // keyed off the room's OWN dungeonType/level/genSeed (stored at
  // create-room time, see createRoom()/resolveDungeonType()) -- no
  // longer always the one static batch-002 dungeon.json. A room created
  // before this REQ landed carries neither field (pre-existing on-disk
  // room docs, files-mode dev data) -- resolveDungeonType()'s own
  // back-compat rule derives a type from the legacy dungeonId, and a
  // fresh random seed is rolled here (once) for a legacy room that never
  // had a genSeed persisted, exactly mirroring how the run's OWN combat
  // seed below is freshly rolled per-run rather than reused.
  const dungeonType = room.dungeonType || resolveDungeonType(undefined, room.dungeonId);
  const genSeed = room.genSeed || crypto.randomBytes(16).toString('hex');
  const dungeonDef = dungen.generate(dungeonType, room.level, genSeed);
  const seed = crypto.randomBytes(16).toString('hex'); // crypto random, stored (per task brief) -- combat RNG, INDEPENDENT of genSeed (layout vs combat outcome stay separate seeds, see sim/dungen.cjs's own header comment)
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
    lrdstReward: result.lrdstReward || 0, // REQ-0042: total LRDST rolled this run (0 on wipe)
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
    // REQ-0042: LRDST reward -- lands in the warehouse as ONE qty-bearing
    // TM row for the room owner (solo scope: the sole participant is
    // always room.ownerId, same as the item-reward loop above uses
    // assignment.owner per-item; LRDST is a single aggregate drop for
    // the whole run rather than a per-encounter warehouse row, since
    // stacking multiple tiny qty rows would just immediately merge on
    // claim anyway -- see the TM claim-merge behavior below). Skipped
    // entirely when lrdstReward is 0 (a wipe, or -- defensively -- an
    // older run doc from before this field existed).
    if (run.lrdstReward > 0) {
      const itemUid = genId('wh');
      const doc = {
        itemUid, playerId: room.ownerId, itemId: 'lrdst', qty: run.lrdstReward,
        kind: 'tm',
        harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: room.id, sourceRunId: run.id,
      };
      addToWarehouse(room.ownerId, doc);
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
// normalizeWarehouseStatus: rows written before REQ-0041 have no `status`
// field at all -- treated as 'claimable' (the only status that existed
// implicitly before this REQ). Also lazily reverts a `claiming` row whose
// claimedAt is older than WAREHOUSE_CLAIM_TIMEOUT_MS back to 'claimable'
// (clearing claimedAt), persisting the reversion immediately so every
// OTHER concurrent reader converges on the same state. Returns the
// (possibly mutated + re-persisted) item.
function normalizeWarehouseStatus(playerId, item, nowMs) {
  if (item.status !== 'claiming') {
    if (item.status !== 'claimable') {
      item.status = 'claimable'; // migrate a pre-REQ-0041 row missing `status`
      storage.writeWarehouseItem(playerId, item.itemUid, item);
    }
    return item;
  }
  const claimedAtMs = item.claimedAt ? Date.parse(item.claimedAt) : 0;
  if (!claimedAtMs || (nowMs - claimedAtMs) >= WAREHOUSE_CLAIM_TIMEOUT_MS) {
    item.status = 'claimable';
    item.claimedAt = null;
    storage.writeWarehouseItem(playerId, item.itemUid, item);
  }
  return item;
}

function purgeExpiredWarehouseItems(playerId) {
  const now = Date.now();
  const items = storage.listWarehouseItems(playerId);
  const survivors = [];
  for (const item of items) {
    if (isExpired(item, now)) {
      storage.deleteWarehouseItem(playerId, item.itemUid);
    } else {
      survivors.push(normalizeWarehouseStatus(playerId, item, now));
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
  // REQ-0041: every warehouse row now carries a claim-state `status`
  // ('claimable' | 'claiming') -- new rows (reward accrual via settleRun,
  // or the new dev-grant path) always start 'claimable'. Callers that
  // don't pass one (pre-REQ-0041 call sites) get it defaulted here rather
  // than at every call site individually.
  const withStatus = doc.status ? doc : Object.assign({}, doc, { status: 'claimable' });
  storage.writeWarehouseItem(playerId, withStatus.itemUid, withStatus);
  return { ok: true, item: withStatus };
}

// grantWarehouseItem (REQ-0041 feedback 1 -- dev grant): inserts a
// warehouse row for `playerId` referencing content item `itemId`, subject
// to the SAME cap/TTL rules every other warehouse insertion goes through
// (addToWarehouse above -- no special-cased dev path for the cap). Caller
// (server/api.cjs's POST /api/admin/warehouse/grant route) is responsible
// for the item_admin auth gate and for validating `itemId` against the
// combined item defs BEFORE calling this (this function itself does not
// re-validate itemId against content -- see the route handler).
function grantWarehouseItem(playerId, itemId) {
  const now = new Date().toISOString();
  const itemUid = genId('wh');
  const doc = {
    itemUid, playerId, itemId,
    harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null, // dev grant -- no originating run
    status: 'claimable',
  };
  return addToWarehouse(playerId, doc);
}

// grantTmQty (REQ-0042): the TM (Transmutator)-kind sibling of
// grantWarehouseItem above -- inserts a WAREHOUSE row carrying a `qty`
// field (this is the reason warehouse rows gain a qty field at all: a
// single PO/SI grant is always qty-less/singular, but a TM grant is
// inherently a STACK of some quantity). Goes through the exact SAME
// addToWarehouse() cap/TTL chokepoint as every other warehouse
// insertion -- no special-cased dev path for the 200-item cap. Landing
// in the WAREHOUSE (not directly into the target player's live
// canvas/inventory) is deliberate, same reasoning as every other grant/
// reward path in this file: avoids a dual-writer clobber of the live
// client's in-memory state (see claimWarehouseItem's doc for the
// original bug this convention prevents) -- the player claims it via the
// normal warehouse-claim UI, same as any other warehouse row. Claiming a
// TM row (see the claim-side handling in server/api.cjs / the client's
// WarehouseTab-equivalent for TM kinds) merges into an existing
// matching-id inventory stack if one exists in the destination page,
// otherwise first-fit-places a new stack -- reusing engine.js's
// tmMove/tmCanPlace (REQ-0042 (b)), exactly like grantWarehouseItem's
// rows reuse invMovePO/invCanPlacePO on the claim side.
function grantTmQty(playerId, tmId, qty) {
  const now = new Date().toISOString();
  const itemUid = genId('wh');
  const doc = {
    itemUid, playerId, itemId: tmId, qty,
    kind: 'tm', // distinguishes a TM-stack warehouse row from a plain PO/SI row on the claim side
    harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null,
    status: 'claimable',
  };
  return addToWarehouse(playerId, doc);
}

function listWarehouse(playerId) {
  return purgeExpiredWarehouseItems(playerId);
}

// claimWarehouseItem (golden f, REWRITTEN by REQ-0041 -- two-phase
// claim). BUG #3 ROOT CAUSE (CONFIRMED by live reproduction against the
// running dev server -- see the REQ-0041 outcome doc for the exact
// repro/observation): the OLD version of this function did server-side
// first-fit placement into `profileCanvas` IN PLACE, and server/api.cjs's
// route handler then called storage.writeProfile() with that mutated
// canvas -- a SECOND, server-side writer racing the client's own
// 800ms-debounced auto-save PUT (client/src/store.ts's scheduleAutoSave/
// flushAutoSave via notifyStateChanged(), the app's ONE auto-save choke
// point). The client's in-memory canvas never learned about the server's
// insertion; whichever PUT physically lands last at the storage layer
// wins, so a stale client-side auto-save (already in flight, or
// triggered by the claim response handler's own subsequent state churn)
// can overwrite the server's just-written inventory placement with the
// client's OLD copy -- the claimed item vanishes from the persisted
// profile even though the HTTP response reported success.
//
// FIX (two-phase claim, per the REQ's own design): the server no longer
// EVER writes a profile on claim -- claiming a row here only flips its
// `status` to 'claiming' (+ claimedAt) and returns the item's CONTENT DEF
// id (`itemId`) plus the row's own `itemUid`. The CLIENT then performs
// the first-fit placement itself (client/src/schedule/WarehouseTab.tsx),
// reusing `itemUid` AS the new inventory PO/SI's own uid (a deliberate
// interpretation change from the old server-side version, which minted a
// SEPARATE fresh uid -- reusing itemUid instead makes server-side
// finalization an exact, unambiguous uid-membership check, see
// finalizeClaimingItemsForCanvas() below, rather than a fuzzier
// itemId-based heuristic), then calls the SAME notifyStateChanged() every
// other board mutation already goes through -- restoring "one writer"
// (the client's own auto-save is once again the only path that ever
// writes this player's profile). The server finalizes (deletes the
// warehouse row) the moment a profile PUT arrives whose saved canvas
// actually contains `itemUid` anywhere (see finalizeClaimingItemsForCanvas,
// called from server/api.cjs's profile PUT handler) -- and lazily reverts
// an abandoned `claiming` row back to `claimable` after
// WAREHOUSE_CLAIM_TIMEOUT_MS elapses uncommitted (see
// normalizeWarehouseStatus() above), so a client crash/tab-close mid-claim
// never permanently strands the item.
//
// NO inventory->warehouse path exists anywhere in this module (golden r's
// reverse-direction ban, generalized here even ahead of P3 trade -- there
// is simply no function that moves an item from a home back into a
// warehouse row).
function claimWarehouseItem(playerId, itemUid, itemDefsById, tmDefsById) {
  purgeExpiredWarehouseItems(playerId); // also normalizes/reverts stale 'claiming' rows (see normalizeWarehouseStatus above)
  const item = storage.readWarehouseItem(playerId, itemUid);
  if (!item) { const err = new Error('warehouse item not found (or expired)'); err.code = 'NOT_FOUND'; throw err; }
  if (item.status && item.status !== 'claimable') {
    const err = new Error('warehouse item is already being claimed'); err.code = 'CONFLICT'; throw err;
  }

  // REQ-0042: a TM-kind row (kind:'tm', e.g. an LRDST reward/grant)
  // validates against tmDefsById instead of itemDefsById -- everything
  // else about the two-phase claim mechanism (mark 'claiming', return
  // WITHOUT touching the profile, finalize on the next PUT containing
  // the reused uid) is identical between kinds.
  if (item.kind === 'tm') {
    const tmDef = (tmDefsById || {})[item.itemId];
    if (!tmDef) { const err = new Error('claimed item references an unknown tm id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }
  } else {
    const itemDef = itemDefsById[item.itemId];
    if (!itemDef) { const err = new Error('claimed item references an unknown content item id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }
  }

  item.status = 'claiming';
  item.claimedAt = new Date().toISOString();
  storage.writeWarehouseItem(playerId, itemUid, item);

  return { itemUid, itemId: item.itemId, kind: item.kind, qty: item.qty };
}

// finalizeClaimingItemsForCanvas (REQ-0041): called by server/api.cjs's
// profile PUT handler AFTER a successful storage.writeProfile() (i.e.
// once the client's own auto-save has actually landed). Deletes every
// one of `playerId`'s CURRENTLY 'claiming' warehouse rows whose itemUid
// now appears anywhere in the just-saved `canvas` -- the client mints the
// claimed item's on-canvas uid by REUSING the warehouse row's own
// itemUid (see claimWarehouseItem's doc above), so this is an exact,
// unambiguous uid-membership scan, not a fuzzy itemId-based heuristic.
// Scans the active preset's top-level fields, every inactive preset's
// store[] snapshot, AND every inventory page (a claimed item's HOME
// always lands in st.inv per the reference model, REQ-0033, regardless
// of whether any preset happens to reference it yet) -- covers a PO's
// `pos[].uid`, a BP's `bps[].id`, and an SI's `sis[].uid` (a claimed
// warehouse item is always a PO or SI in practice -- see the REQ-0041
// outcome doc's note on why BPs are never claimable content -- but this
// scan checks all three arrays uniformly for robustness, matching
// engine.js's own presetUidSet()-style scans elsewhere in this file).
// A simple O(claiming rows + canvas items) scan -- comfortably
// sub-millisecond at this project's scale (a handful of claiming rows, a
// few dozen placed items per canvas), no index/cache warranted, matching
// the perf posture engine.js's own tintSets()/usageOf() already accept
// for a similarly-shaped full scan.
function finalizeClaimingItemsForCanvas(playerId, canvas) {
  if (!canvas) return;
  const claimingItems = storage.listWarehouseItems(playerId).filter((i) => i.status === 'claiming');
  if (!claimingItems.length) return;

  const presentUids = new Set();
  // REQ-0042: also track which TM ids exist anywhere in the canvas at
  // all -- a TM-kind claim that MERGES into an existing same-id stack
  // (firstFitOrMergeTM's mergeInto path, client/src/schedule/
  // WarehouseTab.tsx) intentionally DISCARDS the claimed row's own uid
  // (the destination stack's uid survives, see mock-src/engine.js's
  // tmMove doc comment) -- so a pure uid-membership check like the one
  // POs/SIs/BPs use below can never finalize a merged TM claim; it would
  // sit in 'claiming' forever (and eventually lazy-revert on timeout,
  // silently handing the qty back for reclaiming -- a real duplication
  // bug caught by E2E coverage of the TM-claim-merge flow). A same-id TM
  // stack existing ANYWHERE in the just-saved canvas is sufficient
  // finalize evidence: the claim flow always calls tmMove (merge or
  // fresh-place) as part of the SAME mutation that precedes this very
  // auto-save, so if a matching-id stack exists at all, this row's own
  // qty is either sitting in it (merged) or in its own fresh stack
  // (unmerged) -- either way, the claim landed.
  const presentTmIds = new Set();
  const collectFrom = (container) => {
    if (!container) return;
    for (const p of container.pos || []) presentUids.add(p.uid);
    for (const b of container.bps || []) presentUids.add(b.id);
    for (const a of container.sis || []) presentUids.add(a.uid);
    for (const t of container.tms || []) { presentUids.add(t.uid); presentTmIds.add(t.id); }
  };
  collectFrom(canvas); // active preset's top-level fields
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) collectFrom(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) collectFrom(pg);
  }

  for (const item of claimingItems) {
    const finalized = item.kind === 'tm'
      ? (presentUids.has(item.itemUid) || presentTmIds.has(item.itemId))
      : presentUids.has(item.itemUid);
    if (finalized) {
      storage.deleteWarehouseItem(playerId, item.itemUid);
    }
  }
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

// devBackdateClaimedWarehouseItem (REQ-0041 E2E hook, mirrors
// devBackdateActiveRun's own test-control-seam shape exactly): rewrites a
// 'claiming' warehouse row's claimedAt further into the past so
// normalizeWarehouseStatus's own WAREHOUSE_CLAIM_TIMEOUT_MS lazy-revert
// logic treats it as abandoned on the very next read -- without making
// any E2E test actually wait out the real 120s timeout. Gated to the
// dev_mode fallback caller only by the route handler (server/api.cjs),
// same as dev/backdate; never touches a row's itemId/harvestedAt/
// expiresAt, only claimedAt (a test-control seam, not a gameplay
// feature). Throws NOT_FOUND if the row doesn't exist, BAD_REQUEST if it
// isn't currently 'claiming' (nothing to backdate).
function devBackdateClaimedWarehouseItem(playerId, itemUid, extraSecsIntoPast) {
  const item = storage.readWarehouseItem(playerId, itemUid);
  if (!item) { const err = new Error('warehouse item not found'); err.code = 'NOT_FOUND'; throw err; }
  if (item.status !== 'claiming') {
    const err = new Error('warehouse item is not currently claiming'); err.code = 'BAD_REQUEST'; throw err;
  }
  const pastMs = Date.now() - (WAREHOUSE_CLAIM_TIMEOUT_MS + Math.max(0, Number(extraSecsIntoPast) || 5) * 1000);
  item.claimedAt = new Date(pastMs).toISOString();
  storage.writeWarehouseItem(playerId, itemUid, item);
  return item;
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

// ---------------------------------------------------------------------
// REQ-0042: Workshop gacha (Common BP roll). Two-phase, MIRRORS the
// warehouse claim pattern (see claimWarehouseItem/finalizeClaimingItems
// ForCanvas/normalizeWarehouseStatus above) but against its OWN store
// (storage.cjs's gacha_pending, server/migrations/003_gacha.sql) since
// the finalize condition is STRICTER than a claim's: a claim finalizes
// on uid-presence alone (no currency changes hands), whereas a gacha
// roll must finalize on BOTH the minted BP uid being present in the
// saved canvas AND the player's LRDST balance having actually dropped by
// the roll's cost -- see finalizeGachaForCanvas() below.
// ---------------------------------------------------------------------
const GACHA_COMMON_BP_COST = 10; // LRDST cost of one common_bp roll (REQ doc: "costs 10x LRDST")
const GACHA_PENDING_TIMEOUT_MS = 120 * 1000; // same 120s lazy-revert window as warehouse claim
const GACHA_MIN_CELLS = 4;
const GACHA_MAX_CELLS = 6;
const GACHA_HP_PER_CELL = 15; // hpMax = 15 x cellCount
const GACHA_MIN_LINKER_DIRS = 1;
const GACHA_MAX_LINKER_DIRS = 3;
const GACHA_WALK_RETRY_CAP = 2000; // generous cap -- see rollPolyomino()'s own comment for why this can never realistically be hit for 4-6 cells

// Reads a player's CURRENT LRDST balance from their LAST-SAVED profile
// canvas (the gacha roll itself never mutates the profile -- balance is
// derived read-only, same "read the saved canvas" pattern
// finalizeClaimingItemsForCanvas uses, just summing tms[] qty for id
// 'lrdst' across every inventory page instead of scanning for a uid).
// A player with no saved profile yet (brand new, never PUT once) reads
// as balance 0 -- they cannot roll until their first save has landed
// (matches how a claim/finalize also requires a real saved canvas to
// exist; there is nothing to finalize against otherwise).
function readLrdstBalance(profileCanvas) {
  if (!profileCanvas || !profileCanvas.inv || !Array.isArray(profileCanvas.inv.pages)) return 0;
  let total = 0;
  for (const pg of profileCanvas.inv.pages) {
    for (const tm of (pg.tms || [])) {
      if (tm.id === 'lrdst') total += (Number(tm.qty) || 0);
    }
  }
  return total;
}

// rollPolyomino(rngStream, minCells, maxCells): random walk starting at
// [0,0] -- repeatedly picks a uniformly-random cell ALREADY in the
// current shape, then a uniformly-random ORTHOGONAL neighbor of that
// cell not yet in the shape, and adds it, until `cellCount` (itself
// randomly chosen in [minCells,maxCells]) cells have been placed.
// Connectivity is guaranteed BY CONSTRUCTION (every newly-added cell is
// orthogonally adjacent to a cell already in the shape -- there is no
// code path that can ever produce a disconnected shape, since a cell is
// only ever added as literally a neighbor-of-an-existing-cell). Retries
// (re-picking a different existing cell + neighbor) only happen when the
// randomly chosen existing cell happens to have ALL 4 orthogonal
// neighbors already occupied -- capped at GACHA_WALK_RETRY_CAP total
// attempts across the whole walk to make a hang structurally impossible;
// in practice this cap can never bind for cellCount in [4,6] (a shape
// that small can have at most a handful of fully-surrounded interior
// cells, and the walk only needs `cellCount-1` successful growth steps
// total), so hitting the cap would indicate a real bug, not a plausible
// runtime event -- if it IS ever hit, the function throws rather than
// silently returning a too-small shape.
function rollPolyomino(rngStream, minCells, maxCells) {
  const cellCount = minCells + Math.floor(rngStream.next() * (maxCells - minCells + 1));
  const cells = [[0, 0]];
  const inShape = new Set(['0,0']);
  const neighborsOf = ([r, c]) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  let attempts = 0;
  while (cells.length < cellCount) {
    attempts++;
    if (attempts > GACHA_WALK_RETRY_CAP) {
      throw new Error('rollPolyomino: exceeded retry cap (' + GACHA_WALK_RETRY_CAP + ') growing a ' + cellCount + '-cell shape -- this should be structurally unreachable, see the function comment');
    }
    const fromIdx = Math.floor(rngStream.next() * cells.length);
    const from = cells[fromIdx];
    const candidates = neighborsOf(from).filter(([r, c]) => !inShape.has(r + ',' + c));
    if (candidates.length === 0) continue; // this cell is fully surrounded -- retry with a (possibly different) random existing cell
    const pick = candidates[Math.floor(rngStream.next() * candidates.length)];
    cells.push(pick);
    inShape.add(pick[0] + ',' + pick[1]);
  }
  // Normalize so min row/col = 0 -- same convention engine.js's rotOffsets
  // uses for every shape it produces (shape offsets are always
  // top-left-normalized, never negative).
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

// rollCommonBp(masterSeed): the full common_bp roll -- polyomino shape,
// linker cell (uniformly chosen FROM the polyomino's own cells, per the
// REQ doc), 1-3 random distinct linker directions (0-7, matching
// engine.js's DIRS numeric convention), hpMax = 15 x cellCount, and a
// freshly minted uid for the BP instance. Uses sim/combat.cjs's existing
// makeRng() seeded-RNG helper (already required at the top of this file
// as `combat`) rather than Math.random(), so a given masterSeed always
// reproduces the exact same roll -- same reproducibility property every
// other seeded roll in this codebase (dungeon runs, reward distribution)
// already has, and the same reason: deterministic, testable, auditable.
function rollCommonBp(masterSeed) {
  const rng = combat.makeRng(masterSeed);
  const shapeStream = rng.stream('gacha/common_bp/shape');
  const linkerStream = rng.stream('gacha/common_bp/linker');
  const shape = rollPolyomino(shapeStream, GACHA_MIN_CELLS, GACHA_MAX_CELLS);
  const linkerIdx = Math.floor(linkerStream.next() * shape.length);
  const linkerOff = shape[linkerIdx];
  const dirCount = GACHA_MIN_LINKER_DIRS + Math.floor(linkerStream.next() * (GACHA_MAX_LINKER_DIRS - GACHA_MIN_LINKER_DIRS + 1));
  const availableDirs = [0, 1, 2, 3, 4, 5, 6, 7];
  const dirs = [];
  for (let i = 0; i < dirCount; i++) {
    const idx = Math.floor(linkerStream.next() * availableDirs.length);
    dirs.push(availableDirs.splice(idx, 1)[0]);
  }
  const hpMax = GACHA_HP_PER_CELL * shape.length;
  const uid = genId('bp');
  return {
    uid,
    shape,
    linker: { off: linkerOff, dirs },
    hpMax,
    cellCount: shape.length,
  };
}

// startGachaRoll(playerId, kind, profileCanvas): verifies balance >=
// GACHA_COMMON_BP_COST against the LAST-SAVED profile (read-only -- see
// readLrdstBalance above), rolls a fresh BP instance with a
// crypto-random master seed (stored verbatim on the pending doc, same
// "store the seed, never re-roll" convention startRun() already uses),
// records a PENDING roll in the gacha_pending store keyed by the
// MINTED BP UID (reusing that uid as the pending row's own key --
// exactly the same "reuse the content uid as the row key" interpretation
// claimWarehouseItem made for warehouse claims, so finalization is an
// unambiguous uid-membership check here too), and returns the rolled BP
// definition to the caller WITHOUT deducting anything server-side yet.
function startGachaRoll(playerId, kind, profileCanvas) {
  if (kind !== 'common_bp') {
    const err = new Error('unknown gacha kind: ' + kind); err.code = 'BAD_REQUEST'; throw err;
  }
  const cost = GACHA_COMMON_BP_COST;
  const balance = readLrdstBalance(profileCanvas);
  if (balance < cost) {
    const err = new Error('insufficient LRDST balance: have ' + balance + ', need ' + cost); err.code = 'CONFLICT'; throw err;
  }
  const seed = crypto.randomBytes(16).toString('hex');
  const rolled = rollCommonBp(seed);
  const now = new Date().toISOString();
  const doc = {
    rollUid: rolled.uid,
    playerId,
    kind,
    cost,
    seed,
    rolled,
    balanceBeforeRoll: balance,
    status: 'pending',
    rolledAt: now,
  };
  storage.writeGachaPending(playerId, rolled.uid, doc);
  return { cost, rolled };
}

// normalizeGachaPendingStatus / purgeExpiredGachaPending: lazy-revert
// mechanism for abandoned rolls, BYTE-FOR-BYTE mirroring
// normalizeWarehouseStatus/purgeExpiredWarehouseItems's own lazy-check-
// on-every-read pattern (no setInterval/cron -- reverting an abandoned
// roll just means DELETING the pending doc, since a gacha roll -- unlike
// a warehouse row -- has no "goes back to being claimable" state; an
// abandoned roll's BP definition is simply discarded, the player can
// roll again).
function normalizeGachaPendingStatus(playerId, item, nowMs) {
  const rolledAtMs = item.rolledAt ? Date.parse(item.rolledAt) : 0;
  if (!rolledAtMs || (nowMs - rolledAtMs) >= GACHA_PENDING_TIMEOUT_MS) {
    storage.deleteGachaPending(playerId, item.rollUid);
    return null; // reverted/expired -- caller must drop it from any in-progress list
  }
  return item;
}
function purgeExpiredGachaPending(playerId) {
  const now = Date.now();
  const items = storage.listGachaPending(playerId);
  const survivors = [];
  for (const item of items) {
    const kept = normalizeGachaPendingStatus(playerId, item, now);
    if (kept) survivors.push(kept);
  }
  return survivors;
}

// finalizeGachaForCanvas (REQ-0042): called by server/api.cjs's profile
// PUT handler, alongside (not instead of) finalizeClaimingItemsForCanvas
// -- AFTER a successful storage.writeProfile(). A pending roll finalizes
// (its gacha_pending doc is deleted) iff BOTH:
//   (1) the minted BP uid (rollUid) now appears in the just-saved canvas
//       (bps[].id, scanned the SAME way finalizeClaimingItemsForCanvas
//       scans -- active preset + every inactive preset snapshot + every
//       inventory page), AND
//   (2) the player's LRDST balance in the just-saved canvas is <= the
//       pre-roll balance MINUS the roll's cost (strictly, the client is
//       expected to deduct EXACTLY `cost`, but "<=" tolerates the client
//       having ALSO spent LRDST on something else in the same save
//       without falsely blocking finalization -- the important
//       invariant is "at least `cost` left this player's balance since
//       the roll", not "balance decreased by EXACTLY cost and nothing
//       else happened in the interim").
// This is deliberately STRICTER than claimWarehouseItem's uid-only check
// (see the module comment above) because a gacha roll, unlike a
// warehouse claim, involves a real currency deduction that must not be
// forgeable by placing the BP without ever paying for it.
function finalizeGachaForCanvas(playerId, canvas) {
  if (!canvas) return;
  const pending = purgeExpiredGachaPending(playerId).filter((i) => i.status === 'pending');
  if (!pending.length) return;

  const presentBpUids = new Set();
  const collectBps = (container) => {
    if (!container) return;
    for (const b of container.bps || []) presentBpUids.add(b.id);
  };
  collectBps(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) collectBps(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) collectBps(pg);
  }
  const balanceNow = readLrdstBalance(canvas);

  for (const item of pending) {
    const uidPresent = presentBpUids.has(item.rollUid);
    const balanceDropped = balanceNow <= (item.balanceBeforeRoll - item.cost);
    if (uidPresent && balanceDropped) {
      storage.deleteGachaPending(playerId, item.rollUid);
    }
  }
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
  deployedUidSetsForGate,
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
  grantWarehouseItem,
  grantTmQty,
  devBackdateClaimedWarehouseItem,
  listWarehouse,
  claimWarehouseItem,
  finalizeClaimingItemsForCanvas,
  cancelRoom,
  listDungeonsAndFormations,
  devBackdateActiveRun,
  WAREHOUSE_CLAIM_TIMEOUT_MS,
  // REQ-0042: Workshop gacha
  GACHA_COMMON_BP_COST,
  GACHA_PENDING_TIMEOUT_MS,
  readLrdstBalance,
  rollPolyomino,
  rollCommonBp,
  startGachaRoll,
  purgeExpiredGachaPending,
  finalizeGachaForCanvas,
};
