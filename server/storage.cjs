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
};
