// backpack_ragnarok — server/storage.cjs
// THE repository module (REQ-0024). All persistence goes through this file.
// Postgres later = replace this module's internals; callers keep the same API.
//
// Data dir: ~/backpack_ragnarok/data/profiles/<id>.json (gitignored; created on demand)
// Write strategy: atomic (write to tmp file in the same dir, then fs.renameSync).
// Every stored document carries a schema_version field.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 64 * 1024; // 64KB body size cap
const PROFILE_ALLOWLIST = ['default']; // fixed allowlist; no user-controlled paths

const DATA_DIR = path.join(os.homedir(), 'backpack_ragnarok', 'data', 'profiles');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isAllowedProfileId(id) {
  return PROFILE_ALLOWLIST.includes(id);
}

function profilePath(id) {
  return path.join(DATA_DIR, id + '.json');
}

// Reads a profile's canvas document. Returns null if not found.
function readProfile(id) {
  if (!isAllowedProfileId(id)) {
    const err = new Error('unknown profile id');
    err.code = 'BAD_PROFILE_ID';
    throw err;
  }
  const p = profilePath(id);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
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
  PROFILE_ALLOWLIST,
  DATA_DIR,
  isAllowedProfileId,
  profilePath,
  readProfile,
  writeProfile,
};
