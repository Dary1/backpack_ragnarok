// backpack_ragnarok — server/storage/gacha.cjs
// REQ-0145a (sb): gacha pending-roll persistence extracted verbatim from
// the pre-split server/storage.cjs (origin lines 284-285, 621-691 @
// commit fda9ffb). REQ-0042 root: data/gacha_pending/<playerId>/
// <rollUid>.json | pg: gacha_pending.
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, GACHA_PENDING_DIR, atomicWriteJSON } = require('./lib.cjs');

function gachaPendingPlayerDir(playerId) { return path.join(GACHA_PENDING_DIR, playerId); }
function gachaPendingItemPath(playerId, rollUid) { return path.join(gachaPendingPlayerDir(playerId), rollUid + '.json'); }

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

// REQ-0333: the same owner-scoping hole the warehouse store had, in the same
// shape -- the files backend partitions by
// gacha_pending/<playerId>/<rollUid>.json while these two keyed on roll_uid
// alone. Fixed alongside it because a pending roll is finalized or dropped BY
// UID, so an unscoped read/delete let one caller inspect or destroy another
// player's pending roll. No gate caught this one -- it is the sibling the
// warehouse failure pointed at, found by grepping for the same signature.
function readGachaPendingPg(playerId, rollUid) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync(
    'SELECT doc FROM gacha_pending WHERE roll_uid = $1 AND player_id = $2',
    [namespacedId(rollUid), namespacedId(playerId)]
  );
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeGachaPendingPg(playerId, rollUid, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO gacha_pending (roll_uid, player_id, doc, rolled_at, updated_at) ' +
    'VALUES ($1, $2, $3::jsonb, $4, now()) ' +
    'ON CONFLICT (roll_uid) DO UPDATE SET player_id = EXCLUDED.player_id, doc = EXCLUDED.doc, rolled_at = EXCLUDED.rolled_at, updated_at = EXCLUDED.updated_at',
    [namespacedId(rollUid), namespacedId(playerId), JSON.stringify(doc), doc.rolledAt]
  );
  return doc;
}
function deleteGachaPendingPg(playerId, rollUid) {
  const { querySync } = require('../pg_sync.cjs');
  // REQ-0333: owner-scoped, see readGachaPendingPg.
  querySync(
    'DELETE FROM gacha_pending WHERE roll_uid = $1 AND player_id = $2',
    [namespacedId(rollUid), namespacedId(playerId)]
  );
}
function listGachaPendingPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
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
  gachaPendingPlayerDir,
  gachaPendingItemPath,
  readGachaPending,
  writeGachaPending,
  deleteGachaPending,
  listGachaPending,
};
