'use strict';
// server/services/core.cjs -- REQ-0047 (c): shared foundation of the
// schedule services, moved VERBATIM from server/schedule.cjs: tunable
// constants (warehouse cap/TTL, squad slots, level min), content paths,
// the mtime-cached content loader (getScheduleContent), dungeon/formation
// listing + i18n labels, reward-roll mapping, engine factory, id minting.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const combat = require('../../sim/combat.cjs');
const dungen = require('../../sim/dungen.cjs');
const Engine = require('../../mock-src/engine.js');


// REQ-0145a (sc): content paths resolve through the ONE content-file
// loader (lib/content_files.cjs; CONTENT_ROOT env override honored,
// default byte-equivalent to the old os.homedir() anchoring). REPO_ROOT
// is kept for export-surface compatibility only.
const { CONTENT_ROOT, contentPath } = require('../lib/content_files.cjs');
const REPO_ROOT = path.dirname(CONTENT_ROOT);
const CONTENT_DIR = CONTENT_ROOT;
const LIVE_DIR = contentPath('live');
const ITEMS_PATH = contentPath('live', 'live_items.json');
const SIS_PATH = contentPath('live', 'live_sis.json'); // REQ-0115: SI (accessory) content defs
const TMS_PATH = contentPath('live', 'live_tms.json'); // REQ-0042: Transmutator content defs
const UNITS_PATH = contentPath('live', 'live_units.json'); // REQ-0170: unit/1 defs (the Unit a BP carries)
const PACKS_PATH = contentPath('live', 'live_packs.json'); // REQ-0170: gacha_pack/1 defs (what the Workshop emits)
const VOCAB_PATH = contentPath('vocab.json'); // REQ-0170: connection_shapes lives here
// REQ-0122: the dungeon domain reads from content/live/dungeon/ -- the
// promoted live copy (tools/promote_dungeon_batch.cjs), NOT a hardcoded
// batch dir. The path comes from sim/dungen.cjs's liveDungeonDir() so
// this module and the generator can never drift onto different sources
// (they read the same conceptual "active dungeon domain").
const LIVE_DUNGEON_DIR = dungen.liveDungeonDir();
const BATCH_DIR = LIVE_DUNGEON_DIR; // deprecated alias (pre-REQ-0122 name; no live consumer, kept for any stale script)
const DUNGEON_PATH = path.join(LIVE_DUNGEON_DIR, 'dungeon.json');
const ENEMIES_PATH = path.join(LIVE_DUNGEON_DIR, 'enemies.json');
const SKILLS_PATH = path.join(LIVE_DUNGEON_DIR, 'skills.json');
const ITEMS_PILOT_PATH = path.join(LIVE_DUNGEON_DIR, 'items.json');
const FORMATIONS_PATH = path.join(LIVE_DUNGEON_DIR, 'formations.json'); // REQ-0036 P1-C: GET /api/schedule/dungeons

// ---------------------------------------------------------------------
// Tunables (this REQ's own; distinct from sim/combat.cjs's TUNABLES,
// which govern in-run combat math -- these govern schedule-service-level
// policy). All [TUNABLE] / documented interpretations, called out in the
// final report's "Interpretations" list.
// ---------------------------------------------------------------------
const { WAREHOUSE_CAP } = require('../../shared/constants.json'); // golden e: "max 200 items" -- single source shared w/ client display mirror (REQ-0145b)
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
const SQUAD_SLOTS = ['unit1', 'unit2', 'unit3', 'unit4']; // golden b: troop = 4 Squads
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
    sis: statMtimeMs(SIS_PATH), // REQ-0115
    tms: statMtimeMs(TMS_PATH), // REQ-0042
    units: statMtimeMs(UNITS_PATH), // REQ-0170
    packs: statMtimeMs(PACKS_PATH), // REQ-0170
    vocab: statMtimeMs(VOCAB_PATH), // REQ-0170 (connection_shapes)
    dungeon: statMtimeMs(DUNGEON_PATH),
    enemies: statMtimeMs(ENEMIES_PATH),
    skills: statMtimeMs(SKILLS_PATH),
    pilotItems: statMtimeMs(ITEMS_PILOT_PATH),
    formations: statMtimeMs(FORMATIONS_PATH), // REQ-0036 P1-C
  };
  const stale = !contentCache || Object.keys(mtimes).some((k) => mtimes[k] !== contentCache.mtimes[k]);
  if (!stale) return contentCache.payload;

  const liveItems = loadJSON(ITEMS_PATH);
  const liveSis = loadJSON(SIS_PATH); // REQ-0115
  const liveTms = loadJSON(TMS_PATH); // REQ-0042
  const liveUnits = loadJSON(UNITS_PATH); // REQ-0170
  const livePacks = loadJSON(PACKS_PATH); // REQ-0170
  const vocab = loadJSON(VOCAB_PATH); // REQ-0170 (connection_shapes)
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

  // REQ-0115: SI (accessory) defs -- same id-keyed map shape as
  // itemDefsById/tmDefsById above, but a DELIBERATELY SEPARATE sibling
  // map (NOT merged into itemDefsById, which stays PO-only: the engine
  // and settle paths treat SIs as a distinct kind -- see services/
  // ragnarok.cjs). Consumed by the admin warehouse-grant route and by
  // claimWarehouseItem so an SI id (a real live_sis.json entry, e.g.
  // acc_gem) is accepted as valid warehouse content, mirroring how
  // REQ-0042 added tmDefsById for TM ids.
  const siDefsById = {};
  for (const e of liveSis.entries) siDefsById[e.id] = e;

  // REQ-0170: Unit defs (unit/1) + the ratified connection_shapes table. Same
  // id-keyed map convention as every other def map above. These two are what
  // turn a BP's `unit.id` into rays -- the engine and the sim both resolve
  // through them, so the board and the battle can never disagree.
  const unitDefsById = {};
  for (const e of (liveUnits.entries || [])) unitDefsById[e.id] = e;
  const connShapes = vocab.connection_shapes || {};

  // REQ-0170: gacha pack defs (gacha_pack/1) -- WHICH Units a pack can emit, at
  // what weight and cost. Data, not code: REQ-0171 puts the content-admin screen
  // on top of this table.
  const packDefsById = {};
  for (const e of (livePacks.entries || [])) packDefsById[e.id] = e;

  const enemyDefsById = {};
  for (const e of enemies.entries) enemyDefsById[e.id] = e;

  const skillDefsById = {};
  for (const s of skills.entries) {
    skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
  }

  // REQ-0057: skillDefsById is deliberately kept MECHANICS-ONLY (it is the
  // map handed straight to sim/lib/packs.cjs's compileEnemyPack, where
  // REQ-0121's buff_self fold mutates the objects in place -- the fewer
  // fields riding along in there, the smaller the blast radius). Display
  // names for the forecast tooltip therefore live in a SIBLING map rather
  // than being bolted onto the mechanics defs. skills.json carries flat
  // name_en/name_ja (schema skill/1), not the live_items.json `i18n` map,
  // so this normalises to the i18n shape every client-facing payload uses.
  const skillNamesById = {};
  for (const s of skills.entries) {
    skillNamesById[s.id] = {
      en: { name: s.name_en || s.id },
      ja: { name: s.name_ja || s.name_en || s.id },
    };
  }

  const payload = { itemDefsById, siDefsById, tmDefsById, unitDefsById, packDefsById, connShapes, dungeonDef, enemyDefsById, skillDefsById, skillNamesById, formationsDoc };
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
    // REQ-0049: scouting preview -- expected trap/chest/door counts at sample levels.
    scout: { 1: dungen.scoutingReport(id, 1), 5: dungen.scoutingReport(id, 5), 10: dungen.scoutingReport(id, 10) },
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
// invCanPlacePO/invMovePO (warehouse claim first-fit) and isSquadDeployable
// (empty-squad gate) -- never sockets/combos/beams -- so a minimal 8x8-
// layout instance bound to the CURRENT item defs is enough. (REQ-0045:
// isSquadIndependent is no longer part of the deploy gate -- see
// deployedUidSetsForGate's doc -- but this engine instance is still used
// for it where callers want the static display/tint concept.)
// A fresh instance per call is cheap (no heavy setup in Engine.create)
// and safest against itemDefsById changing between calls (content hot-
// reload, same mtime-cache convention as api.cjs's own content path).
function makeEngine(itemDefsById, unitDefsById, connShapes) {
  return Engine.create(itemDefsById, {}, { ROWS: 8, COLS: 8 }, { po_tags: {}, socket_tags: {} }, unitDefsById, connShapes);
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
//   slots: [ { squadIndex: number|null } x4 ],  // golden b/d: this player's own squad per slot
//   status: 'open' | 'active' | 'canceled',
//   cancelRequested: bool,   // golden g: non-immediate cancel flag ("cancel after current run")
//   pendingSwap: { slot, squadIndex } | null,  // golden j: queued, applies after current run
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

module.exports = {
  REPO_ROOT,
  CONTENT_DIR,
  LIVE_DIR,
  ITEMS_PATH,
  TMS_PATH,
  LIVE_DUNGEON_DIR, // REQ-0122
  BATCH_DIR,
  DUNGEON_PATH,
  ENEMIES_PATH,
  SKILLS_PATH,
  ITEMS_PILOT_PATH,
  FORMATIONS_PATH,
  UNITS_PATH, // REQ-0170
  PACKS_PATH, // REQ-0170
  VOCAB_PATH, // REQ-0170
  WAREHOUSE_CAP,
  WAREHOUSE_TTL_MS,
  WAREHOUSE_CLAIM_TIMEOUT_MS,
  SQUAD_SLOTS,
  DEFAULT_FORMATION_ID,
  DEFAULT_FAILURE_STEP,
  DEFAULT_LEVEL_MIN,
  contentCache,
  statMtimeMs,
  loadJSON,
  getScheduleContent,
  DUNGEON_TYPE_I18N,
  listDungeonsAndFormations,
  REWARD_ROLL_TO_ITEM_ID,
  resolveRewardItemId,
  makeEngine,
  genId,
};
