// backpack_ragnarok — server/storage/dismantle.cjs
// REQ-0145a (sb): dismantle-ledger persistence extracted verbatim from
// the pre-split server/storage.cjs (origin lines 554-606 @ commit
// fda9ffb). REQ-0063 root: data/dismantle/<playerId>.json | pg:
// dismantle_ledger.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { backendMode, namespacedId, DISMANTLE_DIR } = require('./lib.cjs');

// ---------------------------------------------------------------------
// REQ-0063: dismantle ledger. One doc per player:
//   { playerId, updated_at, counts: { <itemId>: <int count> } }
// `counts` is the engraved-forever 分解値 per Dex entry (PO or SI id) --
// see server/services/dismantle.cjs for the suppression math that reads
// this. Same "one persistence root per concern, files+pg parity"
// convention as every other root in this file; shape-wise this is
// closest to readProfile/writeProfile (a single whole-doc blob keyed by
// playerId), not warehouse's per-item-file layout, since a player has
// exactly ONE ledger, not N.
// ---------------------------------------------------------------------

function dismantleLedgerPath(playerId) { return path.join(DISMANTLE_DIR, playerId + '.json'); }

function readDismantleLedgerFiles(playerId) {
  const p = dismantleLedgerPath(playerId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; } // a corrupt ledger reads as empty rather than crashing the caller
}
function writeDismantleLedgerFiles(playerId, doc) {
  fs.mkdirSync(DISMANTLE_DIR, { recursive: true });
  const tmpName = '.' + playerId + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(DISMANTLE_DIR, tmpName);
  fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 1), 'utf8');
  fs.renameSync(tmpPath, dismantleLedgerPath(playerId));
  return doc;
}

function readDismantleLedgerPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM dismantle_ledger WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeDismantleLedgerPg(playerId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO dismantle_ledger (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(playerId), JSON.stringify(doc)]
  );
  return doc;
}

// readDismantleLedger: returns null if the player has never dismantled
// anything (callers treat null the same as {counts:{}} -- see
// services/dismantle.cjs's dismantleCountFor).
function readDismantleLedger(playerId) {
  return backendMode() === 'pg' ? readDismantleLedgerPg(playerId) : readDismantleLedgerFiles(playerId);
}
function writeDismantleLedger(playerId, doc) {
  return backendMode() === 'pg' ? writeDismantleLedgerPg(playerId, doc) : writeDismantleLedgerFiles(playerId, doc);
}

module.exports = {
  dismantleLedgerPath,
  readDismantleLedger,
  writeDismantleLedger,
};
