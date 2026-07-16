// backpack_ragnarok -- server/services/market/furnace.cjs
// REQ-0145a (sd): the furnace-ledger read model extracted verbatim from
// the pre-split services/market.cjs (origin lines 698-711 @ commit
// 6eafed8).
'use strict';
const storage = require('../../storage.cjs');
const { MARKET_TM_ID, liveTmIds } = require('./lib.cjs');

// furnaceTotal(sinceMs?): sums the append-only burn ledger. `sinceMs` is
// the REQ-0066 seasonal-windowing hook -- no season registry exists yet,
// so the route passes undefined (all-time; the mock's "this season the
// furnace burned N" footer becomes truly seasonal the moment REQ-0066
// supplies a season start timestamp to this same function).
function furnaceTotal(sinceMs) {
  // REQ-0195a: per-tm rows -- burns denominated in different TMs never
  // mix. `totals` is one {tm,total,count} row per TM that burned in the
  // window, ordered by the live registry then any legacy extras. Grand
  // `total`/`count` are an internal convenience for white-box callers;
  // the route ships only {totals, since}. Legacy rows lacking tm = lrdst.
  const byTm = new Map();
  let total = 0, count = 0;
  for (const e of storage.listMarketFurnaceEntries()) {
    if (sinceMs != null && Date.parse(e.t) < sinceMs) continue;
    const tm = (typeof e.tm === 'string' && e.tm) ? e.tm : MARKET_TM_ID;
    const row = byTm.get(tm) || { tm, total: 0, count: 0 };
    row.total += Number(e.amount) || 0;
    row.count += 1;
    byTm.set(tm, row);
    total += Number(e.amount) || 0;
    count += 1;
  }
  const totals = [];
  for (const tm of liveTmIds()) if (byTm.has(tm)) { totals.push(byTm.get(tm)); byTm.delete(tm); }
  for (const row of byTm.values()) totals.push(row); // non-registry legacy tms, stable order
  return { totals, total, count, since: sinceMs != null ? new Date(sinceMs).toISOString() : null };
}

module.exports = {
  furnaceTotal,
};
