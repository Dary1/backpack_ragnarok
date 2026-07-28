'use strict';
// bot/lib/seller.cjs -- REQ-0330 AUTO-SELLER. On a troop_disbanded notification,
// an account lists EVERY sellable drop in its warehouse straight onto the market
// via POST /api/market/listings/from-warehouse (REQ-0328), then acks the
// notification. "All drops onto the market, straight from the warehouse."
//
// The row FILTER and the PRICE are pure/deterministic (unit-tested); sellAll is
// the thin async driver that lists each filtered row through the injected client
// (allowlist-guarded) and tolerates the benign races the endpoint documents.
const { priceForRow } = require('./price.cjs');

// isSellableRow(row) -> boolean. Sellable = a claimable drop the from-warehouse
// endpoint will accept: NOT a tm/currency row (rejected 400 unsellable_kind),
// and NOT a row already mid-claim (rejected 409). po/si (kind absent) and unit
// (kind 'bp') rows are sellable. Pure.
function isSellableRow(row) {
  if (!row || typeof row.itemUid !== 'string' || !row.itemUid) return false;
  if (row.kind === 'tm') return false;                    // currency -> unsellable_kind
  if (row.status && row.status !== 'claimable') return false; // 'claiming' -> 409
  return true;
}

// sellableRows(items) -> the subset to list, order preserved. Pure.
function sellableRows(items) {
  return (items || []).filter(isSellableRow);
}

// sellAll(deps) -> { listed:[uid...], skipped:[{uid,reason}], errors:[...] }.
// deps:
//   listWarehouse() -> Promise<{ items:[...] }>
//   createListingFromWarehouse(body, idemKey) -> Promise (POST from-warehouse)
//   log
async function sellAll(deps) {
  const log = deps.log || (() => {});
  const res = { listed: [], skipped: [], errors: [] };
  const wh = await deps.listWarehouse();
  const items = (wh && wh.items) || [];
  for (const row of items) {
    if (!isSellableRow(row)) {
      res.skipped.push({ uid: row && row.itemUid, reason: row && row.kind === 'tm' ? 'unsellable_kind' : 'not_claimable' });
      continue;
    }
    const price = priceForRow(row);
    // Idempotency-Key keyed off the row uid: a retried disband-sweep never
    // double-lists the same drop (the endpoint replays the existing listing).
    const idemKey = 'fleet-sell-' + row.itemUid;
    try {
      await deps.createListingFromWarehouse({ warehouseRowId: row.itemUid, price }, idemKey);
      res.listed.push(row.itemUid);
      log('listed drop ' + row.itemUid + ' @ ' + price.qty + ' ' + price.tm);
    } catch (e) {
      // A concurrent claim (409) or a kind we misjudged (400) is non-fatal --
      // skip that row, keep selling the rest.
      res.errors.push({ uid: row.itemUid, error: e.message, reason: e.reason || null });
      log('skip drop ' + row.itemUid + ' -- ' + e.message);
    }
  }
  return res;
}

module.exports = { isSellableRow, sellableRows, sellAll };
