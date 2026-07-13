// backpack_ragnarok — server/storage/ragnarok.cjs
// REQ-0145a (sb): ragnarok persistence (einherjar records / eternal-order
// cache) extracted verbatim from the pre-split server/storage.cjs (origin
// lines 877-1024 @ commit fda9ffb). REQ-0066 roots -- see the section
// comment below.
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, NAMESPACE, backendMode, namespacedId, atomicWriteJSON } = require('./lib.cjs');

// ---- REQ-0066: Ragnarok persistence (einherjar records / eternal-order cache) ----
// Same "one persistence root per concern, files+pg parity" convention as
// every root above. Two new roots (server/migrations/005_ragnarok.sql):
//   einherjar:   data/ragnarok/einherjar/<einherjarId>.json | pg: ragnarok_einherjar
//     -- one doc per Devotion rite (services/ragnarok.cjs devote()).
//     IMMUTABLE once finalized (rite.state 'done'); the only later
//     writes are REQ-0068's perSeason 戦果 appends and the lazy crash
//     recovery in normalizeRiteRecord (finalize/void of an 'applying'
//     doc). Global-root listing like market listings: listEinherjarRecords()
//     returns every record in the namespace; per-player filtering is the
//     service's job at today's scale (the pg table already carries an
//     indexed player_id column for the day volume warrants pushing it
//     into SQL).
//   order cache: data/ragnarok/order_cache.json | pg: ragnarok_order_cache
//     -- ONE doc per namespace: the Eternal Order standings, lazily
//     rebuilt at dawn (services/ragnarok.cjs getOrderDoc). A cache, not
//     a source of truth -- deleting it just costs the next reader a
//     rebuild.
// pg-mode test isolation reuses the SAME NAMESPACE prefix as everything
// else (the order cache's pg key is namespacedId('order')).

const RAGNAROK_DIR = path.join(REPO_ROOT, 'data', 'ragnarok');
const EINHERJAR_DIR = path.join(RAGNAROK_DIR, 'einherjar');
const RAGNAROK_ORDER_CACHE_PATH = path.join(RAGNAROK_DIR, 'order_cache.json');

function ensureRagnarokDirs() {
  fs.mkdirSync(EINHERJAR_DIR, { recursive: true });
}
ensureRagnarokDirs();

function einherjarPath(id) { return path.join(EINHERJAR_DIR, id + '.json'); }

// ---- einherjar records: files backend ----

function readEinherjarRecordFiles(id) {
  const p = einherjarPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeEinherjarRecordFiles(id, doc) {
  atomicWriteJSON(EINHERJAR_DIR, einherjarPath(id), doc);
  return doc;
}
function deleteEinherjarRecordFiles(id) {
  const p = einherjarPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function listEinherjarRecordsFiles() {
  ensureRagnarokDirs();
  const files = fs.readdirSync(EINHERJAR_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(EINHERJAR_DIR, f), 'utf8'))); }
    catch (e) { /* skip unreadable/corrupt */ }
  }
  return out;
}

// ---- einherjar records: pg backend ----

function readEinherjarRecordPg(id) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM ragnarok_einherjar WHERE einherjar_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeEinherjarRecordPg(id, doc) {
  const { querySync } = require('../pg_sync.cjs');
  // player_id/devoted_at are always derived from the doc itself
  // (writeEinherjarRecord's contract), so the columns can never drift
  // from the document -- same doc-is-truth posture as writeRun /
  // writeMarketListing above.
  querySync(
    'INSERT INTO ragnarok_einherjar (einherjar_id, player_id, doc, devoted_at, updated_at) ' +
    'VALUES ($1, $2, $3::jsonb, $4, now()) ' +
    'ON CONFLICT (einherjar_id) DO UPDATE SET player_id = EXCLUDED.player_id, doc = EXCLUDED.doc, devoted_at = EXCLUDED.devoted_at, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), namespacedId(doc.playerId), JSON.stringify(doc), doc.devotedAt]
  );
  return doc;
}
function deleteEinherjarRecordPg(id) {
  const { querySync } = require('../pg_sync.cjs');
  querySync('DELETE FROM ragnarok_einherjar WHERE einherjar_id = $1', [namespacedId(id)]);
}
function listEinherjarRecordsPg() {
  const { querySync } = require('../pg_sync.cjs');
  const prefix = NAMESPACE + ':';
  const res = querySync('SELECT doc FROM ragnarok_einherjar WHERE einherjar_id LIKE $1', [prefix + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- einherjar records: public API ----
// `doc` must carry playerId/devotedAt (the pg backend derives its real
// columns from them; the files backend stores the doc verbatim).
// deleteEinherjarRecord exists ONLY for the rite's lazy crash recovery
// (voiding an 'applying' record whose cost never landed -- see
// services/ragnarok.cjs normalizeRiteRecord); finalized records are
// never deleted.

function readEinherjarRecord(id) {
  return backendMode() === 'pg' ? readEinherjarRecordPg(id) : readEinherjarRecordFiles(id);
}
function writeEinherjarRecord(id, doc) {
  if (!doc || typeof doc.playerId !== 'string' || !doc.playerId || typeof doc.devotedAt !== 'string' || !doc.devotedAt) {
    throw new Error('writeEinherjarRecord: doc.playerId and doc.devotedAt are required');
  }
  return backendMode() === 'pg' ? writeEinherjarRecordPg(id, doc) : writeEinherjarRecordFiles(id, doc);
}
function deleteEinherjarRecord(id) {
  return backendMode() === 'pg' ? deleteEinherjarRecordPg(id) : deleteEinherjarRecordFiles(id);
}
function listEinherjarRecords() {
  return backendMode() === 'pg' ? listEinherjarRecordsPg() : listEinherjarRecordsFiles();
}

// ---- eternal-order cache (single doc per namespace): files + pg backends ----

function readRagnarokOrderCacheFiles() {
  if (!fs.existsSync(RAGNAROK_ORDER_CACHE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(RAGNAROK_ORDER_CACHE_PATH, 'utf8')); }
  catch (e) { return null; } // a corrupt cache is just a cache miss (next read rebuilds)
}
function writeRagnarokOrderCacheFiles(doc) {
  atomicWriteJSON(RAGNAROK_DIR, RAGNAROK_ORDER_CACHE_PATH, doc);
  return doc;
}
function readRagnarokOrderCachePg() {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM ragnarok_order_cache WHERE cache_id = $1', [namespacedId('order')]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeRagnarokOrderCachePg(doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO ragnarok_order_cache (cache_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (cache_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId('order'), JSON.stringify(doc)]
  );
  return doc;
}

// ---- eternal-order cache: public API ----

function readRagnarokOrderCache() {
  return backendMode() === 'pg' ? readRagnarokOrderCachePg() : readRagnarokOrderCacheFiles();
}
function writeRagnarokOrderCache(doc) {
  return backendMode() === 'pg' ? writeRagnarokOrderCachePg(doc) : writeRagnarokOrderCacheFiles(doc);
}

module.exports = {
  EINHERJAR_DIR,
  RAGNAROK_ORDER_CACHE_PATH,
  einherjarPath,
  readEinherjarRecord,
  writeEinherjarRecord,
  deleteEinherjarRecord,
  listEinherjarRecords,
  readRagnarokOrderCache,
  writeRagnarokOrderCache,
};
