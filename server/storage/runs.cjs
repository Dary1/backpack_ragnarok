// backpack_ragnarok — server/storage/runs.cjs
// REQ-0145a (sb): schedule-run persistence extracted verbatim from the
// pre-split server/storage.cjs (origin lines 281, 364-427 @ commit
// fda9ffb). REQ-0036 P1-B root: data/schedule/runs/<runId>.json | pg:
// schedule_runs.
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, RUNS_DIR, ensureScheduleDirs, atomicWriteJSON } = require('./lib.cjs');

function runPath(id) { return path.join(RUNS_DIR, id + '.json'); }

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
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM schedule_runs WHERE run_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeRunPg(id, roomId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO schedule_runs (run_id, room_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ' +
    'ON CONFLICT (run_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), namespacedId(roomId), JSON.stringify(doc)]
  );
  return doc;
}
function listRunsForRoomPg(roomId) {
  const { querySync } = require('../pg_sync.cjs');
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

module.exports = {
  runPath,
  readRun,
  writeRun,
  listRunsForRoom,
};
