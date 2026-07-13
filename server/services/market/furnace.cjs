// backpack_ragnarok -- server/services/market/furnace.cjs
// REQ-0145a (sd): the furnace-ledger read model extracted verbatim from
// the pre-split services/market.cjs (origin lines 698-711 @ commit
// 6eafed8).
'use strict';
const storage = require('../../storage.cjs');
const { MARKET_TM_ID } = require('./lib.cjs');

// furnaceTotal(sinceMs?): sums the append-only burn ledger. `sinceMs` is
// the REQ-0066 seasonal-windowing hook -- no season registry exists yet,
// so the route passes undefined (all-time; the mock's "this season the
// furnace burned N" footer becomes truly seasonal the moment REQ-0066
// supplies a season start timestamp to this same function).
function furnaceTotal(sinceMs) {
  let total = 0, count = 0;
  for (const e of storage.listMarketFurnaceEntries()) {
    if (sinceMs != null && Date.parse(e.t) < sinceMs) continue;
    total += Number(e.amount) || 0;
    count++;
  }
  return { tm: MARKET_TM_ID, total, count, since: sinceMs != null ? new Date(sinceMs).toISOString() : null };
}

module.exports = {
  furnaceTotal,
};
