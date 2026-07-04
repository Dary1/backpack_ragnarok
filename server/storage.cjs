// backpack_ragnarok — server/storage.cjs
// THE repository module (REQ-0024). All persistence goes through this file.
// Postgres later = replace this module's internals; callers keep the same API.
//
// Data dir: ~/backpack_ragnarok/data/profiles/<id>.json (gitignored; created on demand)
// Write strategy: atomic (write to tmp file in the same dir, then fs.renameSync).
// Every stored document carries a schema_version field.
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
// know the legacy path for the one-time fallback read).
const LEGACY_DEFAULT_PATH = path.join(DATA_DIR, 'default.json');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

// Reads a profile's canvas document. Returns null if not found.
// REQ-0037 migration: if this is the dev player's OWN id, and their own
// profile file does not exist yet, but the legacy data/profiles/
// default.json does, fall back to reading that file's contents instead
// of returning null -- so a pre-REQ-0037 saved board is not lost the
// first time the dev player's real-id profile is read. This is a
// fallback READ only; default.json itself is left on disk untouched (no
// rename), matching docs/REQ/REQ-0037-guest-auth.md's migration note.
function readProfile(id) {
  if (!isAllowedProfileId(id)) {
    const err = new Error('unknown profile id');
    err.code = 'BAD_PROFILE_ID';
    throw err;
  }
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

// Writes a profile's canvas document atomically (tmp file + rename).
// `canvas` is the caller-supplied payload (already size-checked by the HTTP layer,
// but we re-check here too since storage.cjs is the sole chokepoint and must be
// safe to call from non-HTTP callers as well, e.g. future scripts/tests).
function writeProfile(id, canvas) {
  if (!isAllowedProfileId(id)) {
    const err = new Error('unknown profile id');
    err.code = 'BAD_PROFILE_ID';
    throw err;
  }
  const doc = {
    schema_version: SCHEMA_VERSION,
    profile_id: id,
    updated_at: new Date().toISOString(),
    canvas: canvas,
  };
  const json = JSON.stringify(doc, null, 1);
  if (Buffer.byteLength(json, 'utf8') > MAX_BODY_BYTES) {
    const err = new Error('profile document exceeds size cap');
    err.code = 'TOO_LARGE';
    throw err;
  }
  ensureDataDir();
  const tmpName = '.' + id + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(DATA_DIR, tmpName);
  fs.writeFileSync(tmpPath, json, 'utf8');
  fs.renameSync(tmpPath, profilePath(id));
  return doc;
}

module.exports = {
  SCHEMA_VERSION,
  MAX_BODY_BYTES,
  DATA_DIR,
  LEGACY_DEFAULT_PATH,
  isAllowedProfileId,
  profilePath,
  readProfile,
  writeProfile,
};
