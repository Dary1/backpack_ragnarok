// backpack_ragnarok — server/storage/warehouse.cjs
// REQ-0145a (sb): warehouse-item persistence extracted verbatim from the
// pre-split server/storage.cjs (origin lines 282-283, 429-552 @ commit
// fda9ffb). REQ-0036 P1-B root: data/warehouse/<playerId>/<itemUid>.json
// | pg: warehouse_items.
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, WAREHOUSE_DIR, atomicWriteJSON } = require('./lib.cjs');

function warehousePlayerDir(playerId) { return path.join(WAREHOUSE_DIR, playerId); }
function warehouseItemPath(playerId, itemUid) { return path.join(warehousePlayerDir(playerId), itemUid + '.json'); }

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
// clearWarehouseForPlayerFiles: bulk sibling of deleteWarehouseItemFiles
// -- unlinks every row file in the player's warehouse dir (same
// .json/dotfile filter listWarehouseItemsFiles uses, so it removes
// exactly the set a list would have returned) and reports how many. The
// (possibly now-empty) directory itself is left in place, matching
// deleteWarehouseItemFiles' own leave-the-dir behavior.
function clearWarehouseForPlayerFiles(playerId) {
  const dir = warehousePlayerDir(playerId);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  for (const f of files) fs.unlinkSync(path.join(dir, f));
  return files.length;
}

// ---- warehouse: pg backend ----

// REQ-0333: BOTH single-row accessors here take playerId and MUST use it. The
// files backend gets owner scoping for free -- its path is
// warehouse/<playerId>/<itemUid>.json, so naming another player's uid simply
// misses. The pg backend keyed on item_uid alone, which is GLOBALLY unique, so
// the same call answered whoever asked. Not a theoretical hole: REQ-0328's
// from-warehouse sell resolves its row through readWarehouseItem(callerId,
// rowId), so under pg -- the backend production runs -- one player could list
// ANOTHER player's warehouse drop on the market. server/tests/api/market.cjs's
// "from-warehouse validation" case already asserted the foreign row 404s; it
// passed on files and failed on pg, i.e. the gate was describing this bug
// correctly and only the pg stage ever saw it.
// Scoping is safe: a warehouse row never changes owner (see
// writeWarehouseItemPg's REQ-0041 note) and every caller already knows the
// owning player -- its own id, or a participant id from a run's reward split.
function readWarehouseItemPg(playerId, itemUid) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync(
    'SELECT doc FROM warehouse_items WHERE item_uid = $1 AND player_id = $2',
    [namespacedId(itemUid), namespacedId(playerId)]
  );
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeWarehouseItemPg(playerId, itemUid, doc) {
  const { querySync } = require('../pg_sync.cjs');
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
  const { querySync } = require('../pg_sync.cjs');
  // REQ-0333: owner-scoped, same reasoning as readWarehouseItemPg -- an
  // unscoped DELETE let a caller destroy another player's row by uid alone.
  querySync(
    'DELETE FROM warehouse_items WHERE item_uid = $1 AND player_id = $2',
    [namespacedId(itemUid), namespacedId(playerId)]
  );
}
function listWarehouseItemsPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM warehouse_items WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.map((r) => r.doc);
}
// clearWarehouseForPlayerPg: bulk sibling of deleteWarehouseItemPg --
// one DELETE scoped by the player_id column (namespaced like every other
// pg id, so a test run's synthetic namespace can never reach the live
// namespace's rows). RETURNING exists purely to COUNT the removed rows:
// pg_sync's querySync only surfaces `rows` (never pg's rowCount), see
// pg_sync_worker.cjs's `payload = { result: { rows: res.rows } }`.
function clearWarehouseForPlayerPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('DELETE FROM warehouse_items WHERE player_id = $1 RETURNING item_uid', [namespacedId(playerId)]);
  return res.rows.length;
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
// clearWarehouseForPlayer (fix: e2e pg teardown): deletes EVERY
// warehouse row belonging to `playerId` in one call, regardless of
// status/TTL, and returns the number of rows removed. Added for the
// dev-only E2E debris-cleanup hook (POST /api/warehouse/dev/
// clear-debris, server/routes/schedule.cjs): the Playwright suite's
// global setup/teardown restores backed-up FILES only, so with the live
// API in pg mode every full E2E run left its ~55-60 granted rows behind
// until the dev player hit the 200-row cap and the admin grant hook
// started 409ing. Living HERE (not as a delete loop in the service)
// keeps it a single backend-dispatch chokepoint like every other
// warehouse accessor: both backends remove exactly the set a
// listWarehouseItems(playerId) would have returned.
function clearWarehouseForPlayer(playerId) {
  return backendMode() === 'pg' ? clearWarehouseForPlayerPg(playerId) : clearWarehouseForPlayerFiles(playerId);
}

module.exports = {
  warehousePlayerDir,
  warehouseItemPath,
  readWarehouseItem,
  writeWarehouseItem,
  deleteWarehouseItem,
  listWarehouseItems,
  clearWarehouseForPlayer,
};
