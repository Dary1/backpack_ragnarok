// backpack_ragnarok — server/storage.cjs
// THE repository module (REQ-0024). All persistence goes through this file.
// REQ-0040: gained a Postgres backend for profile documents. Backend
// selected via the STORAGE_BACKEND env var ('files' | 'pg'), default
// 'files'. server/players.cjs's own registry (tokens, roles) stays on
// the files backend in both modes -- see server/README.md's "Postgres
// backend" section for the scope note (profiles is the one high-churn,
// user-facing data root this REQ targets; the registry is small,
// low-frequency, and its own sync API is deeply embedded in
// server/admin.cjs's auth-resolution chain, which is out of scope here).
//
// PUBLIC API IS IDENTICAL ACROSS BOTH BACKENDS: readProfile()/
// writeProfile() are still fully SYNCHRONOUS (return the doc directly,
// throw synchronously on error) in both modes -- callers (server/api.cjs,
// the test suite) need zero changes. Postgres access is itself
// necessarily async (pg talks to a real socket), so pg mode bridges the
// gap via server/pg_sync.cjs's Atomics.wait()-based synchronous query
// helper -- see that file's header comment for the full rationale/
// trade-offs.
//
// Data dir (files backend): ~/backpack_ragnarok/data/profiles/<id>.json
// (gitignored; created on demand). Write strategy: atomic (write to tmp
// file in the same dir, then fs.renameSync). Every stored document
// carries a schema_version field.
//
// Data table (pg backend): profiles(player_id text primary key, doc
// jsonb not null, updated_at timestamptz) -- see
// server/migrations/001_init.sql. `doc` holds the EXACT same JSON shape
// writeProfile() has always produced ({schema_version, profile_id,
// updated_at, canvas}); upsert (INSERT ... ON CONFLICT ... DO UPDATE) is
// pg's equivalent of the files backend's atomic tmp+rename swap -- both
// are all-or-nothing, no reader ever observes a half-written document.
//
// REQ-0037 update: the old fixed PROFILE_ALLOWLIST=['default'] is gone.
// Profile ids are now "any known player id" -- isAllowedProfileId() looks
// up server/players.cjs's registry (any playerId with a registry entry is
// a valid profile id). AUTHORIZATION (which caller may read/write which
// id) is a SEPARATE concern, enforced by server/api.cjs's route handler
// via server/admin.cjs's resolveAuth() -- this module only answers "does
// this id exist as a known player", never "is the current caller allowed
// to touch it". See docs/REQ/REQ-0037-guest-auth.md.
//
// REQ-0145a (sb): this file is now a pure FACADE. The eight entity
// families live in server/storage/ (lib, profiles, rooms, runs,
// warehouse, gacha, dismantle, market, ragnarok), each keeping its
// files-backend, pg-backend and dispatching public fns adjacent. The
// public surface below re-exports the decomposed internals name-for-name
// (design rule 3); the storage chokepoint (design rule 4) IS this facade
// -- consumers keep requiring server/storage.cjs and nothing else.
'use strict';
const lib = require('./storage/lib.cjs');
const profiles = require('./storage/profiles.cjs');
const rooms = require('./storage/rooms.cjs');
const runs = require('./storage/runs.cjs');
const warehouse = require('./storage/warehouse.cjs');
const gacha = require('./storage/gacha.cjs');
const dismantle = require('./storage/dismantle.cjs');
const starter = require('./storage/starter.cjs'); // REQ-0051
const market = require('./storage/market.cjs');
const ragnarok = require('./storage/ragnarok.cjs');
// REQ-0058: sealed-seed + participant-run registry storage subsystem.
const seals = require('./storage/seals.cjs');
// REQ-0060: pack biography (per-BP-instance ledger).
const bioStore = require('./storage/bio.cjs');
const bpskinStore = require('./storage/bpskin_slot.cjs'); // REQ-0126: per-BP-instance cosmetic skin slot
const skinPrefsStore = require('./storage/skin_prefs.cjs'); // REQ-0266: per-PLAYER unit_skin selection
// REQ-0151: artwork registry lives in a sibling storage-subsystem file
// (owns its own async pg pool for BYTEA image blobs). Re-exported below so
// storage.cjs stays THE single persistence chokepoint every caller imports.
const artStore = require('./storage_art.cjs');
// REQ-0155: content-data registry lives in its own sibling storage-
// subsystem file (async pg pool, same pattern as storage_art). Re-exported
// below so storage.cjs stays THE single persistence chokepoint.
const contentStore = require('./storage_content.cjs');
const moderationStore = require('./storage_moderation.cjs'); // REQ-0144: UGC skin moderation persistence

module.exports = {
  SCHEMA_VERSION: profiles.SCHEMA_VERSION,
  MAX_BODY_BYTES: profiles.MAX_BODY_BYTES,
  DATA_DIR: lib.DATA_DIR,
  LEGACY_DEFAULT_PATH: profiles.LEGACY_DEFAULT_PATH,
  isAllowedProfileId: profiles.isAllowedProfileId,
  profilePath: profiles.profilePath,
  ensureDataDir: lib.ensureDataDir,
  backendMode: lib.backendMode,
  namespacedId: lib.namespacedId,
  readProfile: profiles.readProfile,
  writeProfile: profiles.writeProfile,
  // REQ-0036 P1-B: schedule (rooms/runs) + warehouse persistence
  ROOMS_DIR: lib.ROOMS_DIR,
  RUNS_DIR: lib.RUNS_DIR,
  WAREHOUSE_DIR: lib.WAREHOUSE_DIR,
  ensureScheduleDirs: lib.ensureScheduleDirs,
  roomPath: rooms.roomPath,
  runPath: runs.runPath,
  warehousePlayerDir: warehouse.warehousePlayerDir,
  warehouseItemPath: warehouse.warehouseItemPath,
  readRoom: rooms.readRoom,
  writeRoom: rooms.writeRoom,
  deleteRoom: rooms.deleteRoom,
  listRooms: rooms.listRooms,
  readRun: runs.readRun,
  writeRun: runs.writeRun,
  listRunsForRoom: runs.listRunsForRoom,
  // REQ-0058: sealed-seed + participant-run registry persistence
  // REQ-0060: pack biography (per-BP-instance ledger; storage.cjs stays
  // the sole persistence chokepoint -- from storage/bio.cjs).
  BIO_DIR: bioStore.BIO_DIR,
  readBio: bioStore.readBio,
  writeBio: bioStore.writeBio,
  listBios: bioStore.listBios,
  // REQ-0126: per-BP-instance cosmetic skin slot (storage.cjs stays THE sole
  // persistence chokepoint -- from storage/bpskin_slot.cjs).
  SKIN_DIR: bpskinStore.SKIN_DIR,
  skinSlotPath: bpskinStore.skinSlotPath,
  readSkinSlot: bpskinStore.readSkinSlot,
  writeSkinSlot: bpskinStore.writeSkinSlot,
  deleteSkinSlot: bpskinStore.deleteSkinSlot,
  listSkinSlots: bpskinStore.listSkinSlots,
  setBpSkin: bpskinStore.setBpSkin,
  getBpSkinId: bpskinStore.getBpSkinId,
  // REQ-0266: per-PLAYER skin selection (storage.cjs stays THE sole persistence
  // chokepoint -- from storage/skin_prefs.cjs; no consumer requires that module
  // directly). validateSkinPrefsPatch/resolveSkinPrefs are PURE (the skin corpus
  // is passed in) and ride along here so the route has one import, not two.
  SKIN_PREFS_DIR: skinPrefsStore.SKIN_PREFS_DIR,
  skinPrefsPath: skinPrefsStore.skinPrefsPath,
  readSkinPrefs: skinPrefsStore.readSkinPrefs,
  writeSkinPrefs: skinPrefsStore.writeSkinPrefs,
  deleteSkinPrefs: skinPrefsStore.deleteSkinPrefs,
  getSkinPrefs: skinPrefsStore.getSkinPrefs,
  mergeSkinPrefs: skinPrefsStore.mergeSkinPrefs,
  emptySkinPrefs: skinPrefsStore.emptySkinPrefs,
  prefsFromDoc: skinPrefsStore.prefsFromDoc,
  validateSkinPrefsPatch: skinPrefsStore.validateSkinPrefsPatch,
  resolveSkinPrefs: skinPrefsStore.resolveSkinPrefs,
  sealPath: seals.sealPath,
  sealRunPath: seals.sealRunPath,
  readSeal: seals.readSeal,
  writeSeal: seals.writeSeal,
  readSealRun: seals.readSealRun,
  writeSealRun: seals.writeSealRun,
  listSealRuns: seals.listSealRuns,
  readWarehouseItem: warehouse.readWarehouseItem,
  writeWarehouseItem: warehouse.writeWarehouseItem,
  deleteWarehouseItem: warehouse.deleteWarehouseItem,
  listWarehouseItems: warehouse.listWarehouseItems,
  clearWarehouseForPlayer: warehouse.clearWarehouseForPlayer,
  clearRoomsForOwner: rooms.clearRoomsForOwner,
  readDismantleLedger: dismantle.readDismantleLedger,
  writeDismantleLedger: dismantle.writeDismantleLedger,
  // REQ-0051: starter-unit claim ledger (regrant once-per-starter-unit gate)
  STARTER_CLAIMS_DIR: lib.STARTER_CLAIMS_DIR,
  starterClaimsPath: starter.starterClaimsPath,
  readStarterClaims: starter.readStarterClaims,
  writeStarterClaims: starter.writeStarterClaims,
  // REQ-0042: gacha pending-roll persistence
  GACHA_PENDING_DIR: lib.GACHA_PENDING_DIR,
  gachaPendingPlayerDir: gacha.gachaPendingPlayerDir,
  gachaPendingItemPath: gacha.gachaPendingItemPath,
  readGachaPending: gacha.readGachaPending,
  writeGachaPending: gacha.writeGachaPending,
  deleteGachaPending: gacha.deleteGachaPending,
  listGachaPending: gacha.listGachaPending,
  // REQ-0064: market persistence (listings / furnace ledger / dex history)
  MARKET_LISTINGS_DIR: market.MARKET_LISTINGS_DIR,
  MARKET_FURNACE_DIR: market.MARKET_FURNACE_DIR,
  MARKET_DEX_HISTORY_DIR: market.MARKET_DEX_HISTORY_DIR,
  marketListingPath: market.marketListingPath,
  readMarketListing: market.readMarketListing,
  writeMarketListing: market.writeMarketListing,
  listMarketListings: market.listMarketListings,
  writeMarketFurnaceEntry: market.writeMarketFurnaceEntry,
  listMarketFurnaceEntries: market.listMarketFurnaceEntries,
  readMarketDexHistory: market.readMarketDexHistory,
  writeMarketDexHistory: market.writeMarketDexHistory,
  // REQ-0066: ragnarok persistence (einherjar records / eternal-order cache)
  EINHERJAR_DIR: ragnarok.EINHERJAR_DIR,
  RAGNAROK_ORDER_CACHE_PATH: ragnarok.RAGNAROK_ORDER_CACHE_PATH,
  einherjarPath: ragnarok.einherjarPath,
  readEinherjarRecord: ragnarok.readEinherjarRecord,
  writeEinherjarRecord: ragnarok.writeEinherjarRecord,
  deleteEinherjarRecord: ragnarok.deleteEinherjarRecord,
  listEinherjarRecords: ragnarok.listEinherjarRecords,
  readRagnarokOrderCache: ragnarok.readRagnarokOrderCache,
  writeRagnarokOrderCache: ragnarok.writeRagnarokOrderCache,
  // REQ-0151: artwork registry (async pg artwork/render ops; storage.cjs
  // remains the sole chokepoint -- these come from storage_art.cjs).
  ...artStore,
  // REQ-0155: content-data registry (async pg content_def/variant ops;
  // storage.cjs remains the sole chokepoint -- from storage_content.cjs).
  ...contentStore,
  ...moderationStore,
};
