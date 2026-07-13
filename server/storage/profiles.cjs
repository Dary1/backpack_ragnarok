// backpack_ragnarok — server/storage/profiles.cjs
// REQ-0145a (sb): profile-document persistence extracted verbatim from
// the pre-split server/storage.cjs (origin lines 57-58, 63-71, 119-240
// @ commit fda9ffb). Files + pg backends and the backend-dispatching
// public fns kept adjacent, exactly as they sat in the monolith. See
// the server/storage.cjs facade header for the full profile-store
// design notes (REQ-0024/0037/0040).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const players = require('../players.cjs');
const { DATA_DIR, backendMode, namespacedId, ensureDataDir } = require('./lib.cjs');

const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 64 * 1024; // 64KB body size cap

// REQ-0037: the pre-existing fixed profile file, now treated as a
// migration source for the dev player's own profile (see readProfile()
// below) and as a dev_mode-only compat alias (server/api.cjs's route
// handler maps the literal URL segment "default" to the dev player's
// playerId when dev_mode is true -- that mapping lives in api.cjs, NOT
// here, since it is a request-routing concern; this module just needs to
// know the legacy path for the one-time fallback read). Kept as a real
// filesystem path in BOTH backends (see readProfile()'s pg branch).
const LEGACY_DEFAULT_PATH = path.join(DATA_DIR, 'default.json');

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
  const { querySync } = require('../pg_sync.cjs');
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
  const { querySync } = require('../pg_sync.cjs');
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
  LEGACY_DEFAULT_PATH,
  isAllowedProfileId,
  profilePath,
  readProfile,
  writeProfile,
};
