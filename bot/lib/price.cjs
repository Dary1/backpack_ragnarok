'use strict';
// bot/lib/price.cjs -- REQ-0330 auto-seller PRICE POLICY.
//
// The owner spec ("All drops onto the market, straight from the warehouse")
// does not care what the price IS -- only that every drop gets listed. So the
// policy is deliberately DUMB and DETERMINISTIC (the spec: "a simple
// deterministic price ... NOT anything clever"): a trivial per-kind flat
// constant in the canonical market TM (`lrdst`, content/live/live_tms.json's
// weathervane -- server/services/market/lib.cjs's MARKET_TM_ID). No appraisal,
// no market-scan, no rarity math. A pure function of the warehouse row's own
// `kind` field, keyed off nothing else:
//
//   * a BP / unit drop  (row.kind === 'bp')  -> UNIT_PRICE  lrdst
//   * any PO / SI drop  (row.kind absent)    -> ITEM_PRICE  lrdst
//
// (A tm/currency row is never priced here -- lib/seller.cjs filters it out
// before pricing, because the from-warehouse endpoint rejects it as
// unsellable_kind.) Both constants sit inside the server's [1..999] price band
// (MARKET_PRICE_MIN/MAX). Env overrides exist only to retune the two floors
// without a code change; the FLAT-per-kind policy itself is compiled in.
const { intEnv, strEnv } = require('./config.cjs');

const PRICE_TM = strEnv('BOT_SELL_PRICE_TM', 'lrdst');
const ITEM_PRICE = intEnv('BOT_SELL_PRICE_ITEM', 5); // po / si flat floor
const UNIT_PRICE = intEnv('BOT_SELL_PRICE_UNIT', 25); // bp / unit flat floor

// priceForRow(row) -> { tm, qty }. Pure; deterministic; depends ONLY on
// row.kind. Never throws (a tm row would be filtered upstream, but if one
// reaches here it still yields the item floor rather than crashing the seller).
function priceForRow(row) {
  const kind = row && row.kind;
  const qty = kind === 'bp' ? UNIT_PRICE : ITEM_PRICE;
  return { tm: PRICE_TM, qty };
}

module.exports = { priceForRow, PRICE_TM, ITEM_PRICE, UNIT_PRICE };
