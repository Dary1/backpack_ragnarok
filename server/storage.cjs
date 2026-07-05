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
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const players = require('./players.cjs');

const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 64 * 1024; // 64KB body size cap

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const DATA_DIR = path.join(REPO_ROOT, 'data', 'profiles');

// REQ-0037: the pre-existing fixed profile file, now treated as a
// migration source for the dev player's own profile (see readProfile()
// below) and as a dev_mode-only compat alias (server/api.cjs's route
// handler maps the literal URL segment "default" to the dev player's
// playerId when dev_mode is true -- that mapping lives in api.cjs, NOT
// here, since it is a request-routing concern; this module just needs to
// know the legacy path for the one-time fallback read). Kept as a real
// filesystem path in BOTH backends (see readProfile()'s pg branch).
const LEGACY_DEFAULT_PATH = path.join(DATA_DIR, 'default.json');

// REQ-0040: backend switch. Re-read at call time (not cached at module
// load) so tests that set process.env.STORAGE_BACKEND right before
// require()'ing (and delete require.cache between runs, matching the
// existing os.homedir()-remap test pattern) get the backend they asked
// for. Defaults to 'files' -- pg is opt-in, never a silent default.
function backendMode() {
  const b = (process.env.STORAGE_BACKEND || 'files').toLowerCase();
  if (b !== 'files' && b !== 'pg') {
    throw new Error('unknown STORAGE_BACKEND: ' + b + ' (must be "files" or "pg")');
  }
  return b;
}

// REQ-0040 pg-mode test isolation: every profile key stored in Postgres
// is prefixed with a short hash of the CURRENT repo-root path (computed
// from os.homedir(), same input DATA_DIR itself is derived from). Tests
// remap os.homedir() before each require() (see
// server/tests/api_test.cjs) -- since REPO_ROOT is captured once at
// require time, a fresh require() after a homedir remap naturally picks
// up a fresh namespace, exactly mirroring how the files backend gets a
// fresh DATA_DIR. Two different test runs (or a test run vs. the real
// deployment, whose repo root is the real ~/backpack_ragnarok) never see
// each other's rows, and a real single production repo root always gets
// the SAME prefix across restarts (pure function of the path, no
// randomness) -- so a deployed box's data survives a service restart
// untouched.
const NAMESPACE = crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 16);

function namespacedId(id) {
  return NAMESPACE + ':' + id;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// REQ-0040: DATA_DIR is created eagerly at module load regardless of
// backend (cheap -- an empty directory costs nothing) so it always
// exists for (a) the pg backend's legacy default.json fallback read
// (readProfilePg() checks LEGACY_DEFAULT_PATH under this same dir), and
// (b) filesystem-observing tests that check "no leftover tmp files" via
// fs.readdirSync(storage.DATA_DIR) -- that assertion is trivially true
// (empty directory) in pg mode, where nothing is ever written here, but
// the directory must still exist for readdirSync to succeed at all.
ensureDataDir();

/** REQ-0037: "any known player id" replaces the old fixed allowlist.
 * A profile id is allowed if server/players.cjs's registry has a record
 * for it (this includes the dev player, once ensureDevPlayer() has run
 * at boot). This function does NOT check whether the CURRENT caller is
 * authorized to use this id for THIS request -- that is server/api.cjs's
 * job (compare the resolved-from-token player's own id against the URL's
 * :playerId). This function only answers "does this id exist at all". */
function isAllowedProfileId(id) {
  if (typeof id !== 'string' || !id) return false;
  return players.readPlayer(id) !== null;
}

function profilePath(id) {
  return path.join(DATA_DIR, id + '.json');
}

function makeDoc(id, canvas) {
  return {
    schema_version: SCHEMA_VERSION,
    profile_id: id,
    updated_at: new Date().toISOString(),
    canvas: canvas,
  };
}

function checkSize(doc) {
  const json = JSON.stringify(doc, null, 1);
  if (Buffer.byteLength(json, 'utf8') > MAX_BODY_BYTES) {
    const err = new Error('profile document exceeds size cap');
    err.code = 'TOO_LARGE';
    throw err;
  }
  return json;
}

// ---- files backend (original REQ-0024/REQ-0037 implementation) ----

function readProfileFiles(id) {
  const p = profilePath(id);
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  }
  if (id === 'dev' && p !== LEGACY_DEFAULT_PATH && fs.existsSync(LEGACY_DEFAULT_PATH)) {
    const raw = fs.readFileSync(LEGACY_DEFAULT_PATH, 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

function writeProfileFiles(id, canvas) {
  const doc = makeDoc(id, canvas);
  const json = checkSize(doc);
  ensureDataDir();
  const tmpName = '.' + id + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(DATA_DIR, tmpName);
  fs.writeFileSync(tmpPath, json, 'utf8');
  fs.renameSync(tmpPath, profilePath(id));
  return doc;
}

// ---- pg backend (REQ-0040) ----

function readProfilePg(id) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM profiles WHERE player_id = $1', [namespacedId(id)]);
  if (res.rows.length > 0) return res.rows[0].doc;
  // Same legacy dev/default.json fallback the files backend has always
  // had (REQ-0037 migration note) -- deliberately files-based even in pg
  // mode: a one-time, read-only compatibility path for boxes that still
  // carry a pre-REQ-0037 data/profiles/default.json on disk, not a pg
  // concern, and costs nothing to keep.
  if (id === 'dev' && fs.existsSync(LEGACY_DEFAULT_PATH)) {
    const raw = fs.readFileSync(LEGACY_DEFAULT_PATH, 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

function writeProfilePg(id, canvas) {
  const doc = makeDoc(id, canvas);
  checkSize(doc); // throws TOO_LARGE before touching the DB, same as files mode
  const { querySync } = require('./pg_sync.cjs');
  // Upsert = pg's atomic all-or-nothing write, the same guarantee the
  // files backend gets from tmp-file + fs.renameSync (no reader ever
  // observes a partial document).
  querySync(
    'INSERT INTO profiles (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), JSON.stringify(doc)]
  );
  return doc;
}

// ---- public API (backend-dispatching; fully synchronous in both modes) ----

// Reads a profile's canvas document. Returns null if not found. Throws
// synchronously ({code: 'BAD_PROFILE_ID'}) for an unknown profile id.
function readProfile(id) {
  if (!isAllowedProfileId(id)) {
    const err = new Error('unknown profile id');
    err.code = 'BAD_PROFILE_ID';
    throw err;
  }
  if (backendMode() === 'pg') return readProfilePg(id);
  return readProfileFiles(id);
}

// Writes a profile's canvas document atomically (tmp file + rename in
// files mode, upsert in pg mode). `canvas` is the caller-supplied
// payload (already size-checked by the HTTP layer, but re-checked here
// too since storage.cjs is the sole chokepoint and must be safe to call
// from non-HTTP callers as well, e.g. scripts/tests).
function writeProfile(id, canvas) {
  if (!isAllowedProfileId(id)) {
    const err = new Error('unknown profile id');
    err.code = 'BAD_PROFILE_ID';
    throw err;
  }
  if (backendMode() === 'pg') return writeProfilePg(id, canvas);
  return writeProfileFiles(id, canvas);
}


// ---- REQ-0036 P1-B: schedule (rooms/runs) + warehouse persistence ----
// Same "one persistence root per concern, files+pg parity" convention as
// readProfile/writeProfile above. Three new roots:
//   rooms:     data/schedule/rooms/<roomId>.json      | pg: schedule_rooms
//   runs:      data/schedule/runs/<runId>.json         | pg: schedule_runs
//   warehouse: data/warehouse/<playerId>/<itemUid>.json | pg: warehouse_items
// pg-mode test isolation reuses the SAME NAMESPACE prefix already computed
// above from REPO_ROOT (sha256(REPO_ROOT).slice(0,16)) -- every id below is
// namespaced the same way namespacedId() already does for profiles, so a
// test run against a remapped os.homedir() gets its own throwaway rows
// automatically, with zero test-file-specific pg setup.

const SCHEDULE_DIR = path.join(REPO_ROOT, 'data', 'schedule');
const ROOMS_DIR = path.join(SCHEDULE_DIR, 'rooms');
const RUNS_DIR = path.join(SCHEDULE_DIR, 'runs');
const WAREHOUSE_DIR = path.join(REPO_ROOT, 'data', 'warehouse');
// REQ-0042: gacha pending-roll store. Kept as its OWN root (separate from
// WAREHOUSE_DIR) since a pending gacha roll's shape genuinely differs
// from a warehouse row (cost + full rolled BP def, no TTL/harvestedAt
// semantics) -- see server/schedule.cjs's grantGachaPending() module
// comment and server/migrations/003_gacha.sql.
const GACHA_PENDING_DIR = path.join(REPO_ROOT, 'data', 'gacha_pending');

function ensureScheduleDirs() {
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(WAREHOUSE_DIR, { recursive: true });
  fs.mkdirSync(GACHA_PENDING_DIR, { recursive: true });
}
ensureScheduleDirs();

function roomPath(id) { return path.join(ROOMS_DIR, id + '.json'); }
function runPath(id) { return path.join(RUNS_DIR, id + '.json'); }
function warehousePlayerDir(playerId) { return path.join(WAREHOUSE_DIR, playerId); }
function warehouseItemPath(playerId, itemUid) { return path.join(warehousePlayerDir(playerId), itemUid + '.json'); }
function gachaPendingPlayerDir(playerId) { return path.join(GACHA_PENDING_DIR, playerId); }
function gachaPendingItemPath(playerId, rollUid) { return path.join(gachaPendingPlayerDir(playerId), rollUid + '.json'); }

function atomicWriteJSON(dir, filePath, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(obj, null, 1);
  const tmpName = '.' + path.basename(filePath) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, json, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---- rooms: files backend ----

function readRoomFiles(id) {
  const p = roomPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeRoomFiles(id, doc) {
  atomicWriteJSON(ROOMS_DIR, roomPath(id), doc);
  return doc;
}
function deleteRoomFiles(id) {
  const p = roomPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function listRoomsFiles() {
  ensureScheduleDirs();
  const files = fs.readdirSync(ROOMS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8'))); }
    catch (e) { /* skip unreadable/corrupt */ }
  }
  return out;
}

// ---- rooms: pg backend ----

function readRoomPg(id) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM schedule_rooms WHERE room_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeRoomPg(id, doc) {
  const { querySync } = require('./pg_sync.cjs');
  querySync(
    'INSERT INTO schedule_rooms (room_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (room_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), JSON.stringify(doc)]
  );
  return doc;
}
function deleteRoomPg(id) {
  const { querySync } = require('./pg_sync.cjs');
  querySync('DELETE FROM schedule_rooms WHERE room_id = $1', [namespacedId(id)]);
}
function listRoomsPg() {
  const { querySync } = require('./pg_sync.cjs');
  const prefix = NAMESPACE + ':';
  const res = querySync('SELECT doc FROM schedule_rooms WHERE room_id LIKE $1', [prefix + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- rooms: public API ----

function readRoom(id) {
  return backendMode() === 'pg' ? readRoomPg(id) : readRoomFiles(id);
}
function writeRoom(id, doc) {
  return backendMode() === 'pg' ? writeRoomPg(id, doc) : writeRoomFiles(id, doc);
}
function deleteRoom(id) {
  return backendMode() === 'pg' ? deleteRoomPg(id) : deleteRoomFiles(id);
}
function listRooms() {
  return backendMode() === 'pg' ? listRoomsPg() : listRoomsFiles();
}

// ---- runs: files backend ----

function readRunFiles(id) {
  const p = runPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeRunFiles(id, doc) {
  atomicWriteJSON(RUNS_DIR, runPath(id), doc);
  return doc;
}
function listRunsForRoomFiles(roomId) {
  ensureScheduleDirs();
  const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
      if (doc.roomId === roomId) out.push(doc);
    } catch (e) { /* skip */ }
  }
  return out;
}

// ---- runs: pg backend ----

function readRunPg(id) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM schedule_runs WHERE run_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeRunPg(id, roomId, doc) {
  const { querySync } = require('./pg_sync.cjs');
  querySync(
    'INSERT INTO schedule_runs (run_id, room_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ' +
    'ON CONFLICT (run_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), namespacedId(roomId), JSON.stringify(doc)]
  );
  return doc;
}
function listRunsForRoomPg(roomId) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM schedule_runs WHERE room_id = $1', [namespacedId(roomId)]);
  return res.rows.map((r) => r.doc);
}

// ---- runs: public API ----

function readRun(id) {
  return backendMode() === 'pg' ? readRunPg(id) : readRunFiles(id);
}
// `doc` must carry its own `roomId` field (both backends key runs by
// run_id alone; pg also stores room_id in its own column for the indexed
// per-room listing query -- writeRun always derives that column from
// doc.roomId, so callers never pass it as a separate parameter).
function writeRun(id, doc) {
  if (!doc || typeof doc.roomId !== 'string' || !doc.roomId) {
    throw new Error('writeRun: doc.roomId is required');
  }
  return backendMode() === 'pg' ? writeRunPg(id, doc.roomId, doc) : writeRunFiles(id, doc);
}
function listRunsForRoom(roomId) {
  return backendMode() === 'pg' ? listRunsForRoomPg(roomId) : listRunsForRoomFiles(roomId);
}

// ---- warehouse: files backend ----

function readWarehouseItemFiles(playerId, itemUid) {
  const p = warehouseItemPath(playerId, itemUid);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeWarehouseItemFiles(playerId, itemUid, doc) {
  atomicWriteJSON(warehousePlayerDir(playerId), warehouseItemPath(playerId, itemUid), doc);
  return doc;
}
function deleteWarehouseItemFiles(playerId, itemUid) {
  const p = warehouseItemPath(playerId, itemUid);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function listWarehouseItemsFiles(playerId) {
  const dir = warehousePlayerDir(playerId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
    catch (e) { /* skip */ }
  }
  return out;
}

// ---- warehouse: pg backend ----

function readWarehouseItemPg(playerId, itemUid) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM warehouse_items WHERE item_uid = $1', [namespacedId(itemUid)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeWarehouseItemPg(playerId, itemUid, doc) {
  const { querySync } = require('./pg_sync.cjs');
  // REQ-0041 hardening: the ON CONFLICT clause now also updates
  // player_id (previously it did not -- only doc/harvested_at/
  // updated_at were refreshed on conflict). Every REAL call site writes
  // a given itemUid under the SAME playerId for its whole life (a
  // warehouse row's owner never legitimately changes), so this was
  // unreachable via normal app behavior, but leaving the player_id
  // COLUMN stale relative to a freshly-written doc.playerId (had a
  // caller ever rewritten under a different playerId) would silently
  // orphan the row from listWarehouseItemsPg's own `WHERE player_id =
  // $1` filter -- discovered via this REQ's own E2E-support test
  // tooling, not a live-traffic bug, but cheap defense-in-depth to close
  // now that it is understood.
  querySync(
    'INSERT INTO warehouse_items (item_uid, player_id, doc, harvested_at, updated_at) ' +
    'VALUES ($1, $2, $3::jsonb, $4, now()) ' +
    'ON CONFLICT (item_uid) DO UPDATE SET player_id = EXCLUDED.player_id, doc = EXCLUDED.doc, harvested_at = EXCLUDED.harvested_at, updated_at = EXCLUDED.updated_at',
    [namespacedId(itemUid), namespacedId(playerId), JSON.stringify(doc), doc.harvestedAt]
  );
  return doc;
}
function deleteWarehouseItemPg(playerId, itemUid) {
  const { querySync } = require('./pg_sync.cjs');
  querySync('DELETE FROM warehouse_items WHERE item_uid = $1', [namespacedId(itemUid)]);
}
function listWarehouseItemsPg(playerId) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM warehouse_items WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.map((r) => r.doc);
}

// ---- warehouse: public API ----
// Every function takes playerId explicitly (rather than deriving it from
// itemUid) because the files backend partitions its directory tree by
// player and the pg backend needs it for the player_id column -- callers
// (schedule.cjs) always know the owning player already (it's the caller's
// OWN warehouse, or a participant id from a run's reward assignment).

function readWarehouseItem(playerId, itemUid) {
  return backendMode() === 'pg' ? readWarehouseItemPg(playerId, itemUid) : readWarehouseItemFiles(playerId, itemUid);
}
function writeWarehouseItem(playerId, itemUid, doc) {
  return backendMode() === 'pg' ? writeWarehouseItemPg(playerId, itemUid, doc) : writeWarehouseItemFiles(playerId, itemUid, doc);
}
function deleteWarehouseItem(playerId, itemUid) {
  return backendMode() === 'pg' ? deleteWarehouseItemPg(playerId, itemUid) : deleteWarehouseItemFiles(playerId, itemUid);
}
function listWarehouseItems(playerId) {
  return backendMode() === 'pg' ? listWarehouseItemsPg(playerId) : listWarehouseItemsFiles(playerId);
}

// ---- gacha pending-roll store: files backend (REQ-0042) ----
// Byte-for-byte the same shape as the warehouse files backend above --
// one JSON doc per (playerId, rollUid), atomic write, directory-per-
// player partitioning.

function readGachaPendingFiles(playerId, rollUid) {
  const p = gachaPendingItemPath(playerId, rollUid);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeGachaPendingFiles(playerId, rollUid, doc) {
  atomicWriteJSON(gachaPendingPlayerDir(playerId), gachaPendingItemPath(playerId, rollUid), doc);
  return doc;
}
function deleteGachaPendingFiles(playerId, rollUid) {
  const p = gachaPendingItemPath(playerId, rollUid);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function listGachaPendingFiles(playerId) {
  const dir = gachaPendingPlayerDir(playerId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
    catch (e) { /* skip */ }
  }
  return out;
}

// ---- gacha pending-roll store: pg backend (REQ-0042) ----

function readGachaPendingPg(playerId, rollUid) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM gacha_pending WHERE roll_uid = $1', [namespacedId(rollUid)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeGachaPendingPg(playerId, rollUid, doc) {
  const { querySync } = require('./pg_sync.cjs');
  querySync(
    'INSERT INTO gacha_pending (roll_uid, player_id, doc, rolled_at, updated_at) ' +
    'VALUES ($1, $2, $3::jsonb, $4, now()) ' +
    'ON CONFLICT (roll_uid) DO UPDATE SET player_id = EXCLUDED.player_id, doc = EXCLUDED.doc, rolled_at = EXCLUDED.rolled_at, updated_at = EXCLUDED.updated_at',
    [namespacedId(rollUid), namespacedId(playerId), JSON.stringify(doc), doc.rolledAt]
  );
  return doc;
}
function deleteGachaPendingPg(playerId, rollUid) {
  const { querySync } = require('./pg_sync.cjs');
  querySync('DELETE FROM gacha_pending WHERE roll_uid = $1', [namespacedId(rollUid)]);
}
function listGachaPendingPg(playerId) {
  const { querySync } = require('./pg_sync.cjs');
  const res = querySync('SELECT doc FROM gacha_pending WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.map((r) => r.doc);
}

// ---- gacha pending-roll store: public API (REQ-0042) ----

function readGachaPending(playerId, rollUid) {
  return backendMode() === 'pg' ? readGachaPendingPg(playerId, rollUid) : readGachaPendingFiles(playerId, rollUid);
}
function writeGachaPending(playerId, rollUid, doc) {
  return backendMode() === 'pg' ? writeGachaPendingPg(playerId, rollUid, doc) : writeGachaPendingFiles(playerId, rollUid, doc);
}
function deleteGachaPending(playerId, rollUid) {
  return backendMode() === 'pg' ? deleteGachaPendingPg(playerId, rollUid) : deleteGachaPendingFiles(playerId, rollUid);
}
function listGachaPending(playerId) {
  return backendMode() === 'pg' ? listGachaPendingPg(playerId) : listGachaPendingFiles(playerId);
}

module.exports = {
  SCHEMA_VERSION,
  MAX_BODY_BYTES,
  DATA_DIR,
  LEGACY_DEFAULT_PATH,
  isAllowedProfileId,
  profilePath,
  ensureDataDir,
  backendMode,
  namespacedId,
  readProfile,
  writeProfile,
  // REQ-0036 P1-B: schedule (rooms/runs) + warehouse persistence
  ROOMS_DIR,
  RUNS_DIR,
  WAREHOUSE_DIR,
  ensureScheduleDirs,
  roomPath,
  runPath,
  warehousePlayerDir,
  warehouseItemPath,
  readRoom,
  writeRoom,
  deleteRoom,
  listRooms,
  readRun,
  writeRun,
  listRunsForRoom,
  readWarehouseItem,
  writeWarehouseItem,
  deleteWarehouseItem,
  listWarehouseItems,
  // REQ-0042: gacha pending-roll persistence
  GACHA_PENDING_DIR,
  gachaPendingPlayerDir,
  gachaPendingItemPath,
  readGachaPending,
  writeGachaPending,
  deleteGachaPending,
  listGachaPending,
};
