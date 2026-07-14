// backpack_ragnarok — server/storage/lib.cjs
// REQ-0145a (sb): shared storage plumbing extracted verbatim from the
// pre-split server/storage.cjs (origin lines 57-117, 243-294 @ commit
// fda9ffb): backend switch, pg namespace, data-dir roots + eager mkdir,
// atomic JSON write. Consumers outside server/storage/ must keep
// requiring the server/storage.cjs facade (design rule 4), never this
// file directly.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const DATA_DIR = path.join(REPO_ROOT, 'data', 'profiles');

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
// REQ-0063: dismantle ledger. One doc per player (same shape as
// profiles/einherjar records -- a single JSON blob keyed by playerId,
// not a per-item file the way warehouse rows are), so it rides the same
// eager-mkdir chokepoint as every other root below.
const DISMANTLE_DIR = path.join(REPO_ROOT, 'data', 'dismantle');

// REQ-0058: sealed-seed share roots (files backend). Same SCHEDULE_DIR
// parent + eager-mkdir chokepoint as rooms/runs above; pg-mode isolation
// reuses the same NAMESPACE prefix (see storage/seals.cjs).
//   sealed_seeds: data/schedule/sealed_seeds/<sealId>.json          | pg: sealed_seeds
//   seal_runs:    data/schedule/seal_runs/<sealId>__<playerId>.json | pg: seal_runs
const SEALED_SEEDS_DIR = path.join(SCHEDULE_DIR, 'sealed_seeds');
const SEAL_RUNS_DIR = path.join(SCHEDULE_DIR, 'seal_runs');

function ensureScheduleDirs() {
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(WAREHOUSE_DIR, { recursive: true });
  fs.mkdirSync(GACHA_PENDING_DIR, { recursive: true });
  fs.mkdirSync(DISMANTLE_DIR, { recursive: true });
  fs.mkdirSync(SEALED_SEEDS_DIR, { recursive: true }); // REQ-0058
  fs.mkdirSync(SEAL_RUNS_DIR, { recursive: true }); // REQ-0058
}
ensureScheduleDirs();

function atomicWriteJSON(dir, filePath, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(obj, null, 1);
  const tmpName = '.' + path.basename(filePath) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, json, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = {
  REPO_ROOT,
  NAMESPACE,
  DATA_DIR,
  backendMode,
  namespacedId,
  ensureDataDir,
  SCHEDULE_DIR,
  ROOMS_DIR,
  RUNS_DIR,
  WAREHOUSE_DIR,
  GACHA_PENDING_DIR,
  DISMANTLE_DIR,
  SEALED_SEEDS_DIR,
  SEAL_RUNS_DIR,
  ensureScheduleDirs,
  atomicWriteJSON,
};
