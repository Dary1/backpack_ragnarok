// backpack_ragnarok — server/storage/seals.cjs
// REQ-0058: Sealed Seed Share persistence. Two roots, same "one
// persistence root per concern, files+pg parity" convention every other
// storage/ entity family uses (see storage/rooms.cjs / runs.cjs, which
// this file mirrors line-for-line):
//   sealed_seeds:  data/schedule/sealed_seeds/<sealId>.json        | pg: sealed_seeds
//   seal_runs:     data/schedule/seal_runs/<sealId>__<playerId>.json | pg: seal_runs
// The seal_runs registry is keyed (sealId, playerId) -- one row per
// participant per seal (the "each participant runs a given sealId once"
// invariant, enforced at the service layer via readSealRun-before-write,
// and structurally at the pg layer via the composite PRIMARY KEY in
// server/migrations/011_sealed_seeds.sql). pg-mode test isolation reuses
// the SAME NAMESPACE prefix (sha256(REPO_ROOT).slice(0,16)) every other
// schedule table already namespaces by, so a homedir-remapped test run
// gets its own throwaway rows automatically.
// Consumers outside server/storage/ keep requiring the server/storage.cjs
// facade (design rule 4), never this file directly.
'use strict';
const fs = require('fs');
const path = require('path');
const { NAMESPACE, backendMode, namespacedId, SEALED_SEEDS_DIR, SEAL_RUNS_DIR, ensureScheduleDirs, atomicWriteJSON } = require('./lib.cjs');

function sealPath(sealId) { return path.join(SEALED_SEEDS_DIR, sealId + '.json'); }
// Composite (sealId, playerId) filename. sealIds are crypto-hex tokens
// and playerIds are the registry's own 'plr_<hex>'/'dev' ids -- both are
// filesystem-safe (no path separators), so a plain '__' join is
// unambiguous for listSealRuns()'s prefix scan below.
function sealRunPath(sealId, playerId) { return path.join(SEAL_RUNS_DIR, sealId + '__' + playerId + '.json'); }

// ---- sealed_seeds: files backend ----

function readSealFiles(sealId) {
  const p = sealPath(sealId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeSealFiles(sealId, doc) {
  atomicWriteJSON(SEALED_SEEDS_DIR, sealPath(sealId), doc);
  return doc;
}

// ---- sealed_seeds: pg backend ----

function readSealPg(sealId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM sealed_seeds WHERE seal_id = $1', [namespacedId(sealId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeSealPg(sealId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO sealed_seeds (seal_id, doc, created_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (seal_id) DO UPDATE SET doc = EXCLUDED.doc',
    [namespacedId(sealId), JSON.stringify(doc)]
  );
  return doc;
}

// ---- sealed_seeds: public API ----

function readSeal(sealId) {
  return backendMode() === 'pg' ? readSealPg(sealId) : readSealFiles(sealId);
}
function writeSeal(sealId, doc) {
  return backendMode() === 'pg' ? writeSealPg(sealId, doc) : writeSealFiles(sealId, doc);
}

// ---- seal_runs registry: files backend ----

function readSealRunFiles(sealId, playerId) {
  const p = sealRunPath(sealId, playerId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeSealRunFiles(sealId, playerId, doc) {
  atomicWriteJSON(SEAL_RUNS_DIR, sealRunPath(sealId, playerId), doc);
  return doc;
}
function listSealRunsFiles(sealId) {
  ensureScheduleDirs();
  const prefix = sealId + '__';
  const files = fs.readdirSync(SEAL_RUNS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.') && f.startsWith(prefix));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(SEAL_RUNS_DIR, f), 'utf8'))); }
    catch (e) { /* skip unreadable/corrupt */ }
  }
  return out;
}

// ---- seal_runs registry: pg backend ----

function readSealRunPg(sealId, playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM seal_runs WHERE seal_id = $1 AND player_id = $2', [namespacedId(sealId), namespacedId(playerId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeSealRunPg(sealId, playerId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO seal_runs (seal_id, player_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ' +
    'ON CONFLICT (seal_id, player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(sealId), namespacedId(playerId), JSON.stringify(doc)]
  );
  return doc;
}
function listSealRunsPg(sealId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM seal_runs WHERE seal_id = $1', [namespacedId(sealId)]);
  return res.rows.map((r) => r.doc);
}

// ---- seal_runs registry: public API ----

function readSealRun(sealId, playerId) {
  return backendMode() === 'pg' ? readSealRunPg(sealId, playerId) : readSealRunFiles(sealId, playerId);
}
function writeSealRun(sealId, playerId, doc) {
  return backendMode() === 'pg' ? writeSealRunPg(sealId, playerId, doc) : writeSealRunFiles(sealId, playerId, doc);
}
function listSealRuns(sealId) {
  return backendMode() === 'pg' ? listSealRunsPg(sealId) : listSealRunsFiles(sealId);
}

module.exports = {
  sealPath,
  sealRunPath,
  readSeal,
  writeSeal,
  readSealRun,
  writeSealRun,
  listSealRuns,
};
