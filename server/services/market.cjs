'use strict';
// server/services/market.cjs -- REQ-0064: the player-to-player Market
// service (server side; the client screen is a separate, later squad that
// consumes the DTOs this module shapes -- see shared/dto.ts's ApiMarket*
// types). Business rules are frozen by the design mock
// web/redesign/market.html ("three laws" + copy deck, REQ-0065 embedded
// spec comments):
//
//   1. "Barter in kind" -- there is no abstract currency. A price is an
//      integer quantity of ONE Transmutator content item. The engine /
//      content id of that TM is `lrdst` (content/live/live_tms.json's
//      single entry, "UnitRandomDirectionShuffleTransmutator"; the
//      same id server/services/gacha.cjs's readLrdstBalance() already
//      sums for the Workshop). The mock renders it as the fehu rune;
//      the WIRE id stays lrdst everywhere.
//   2. "The furnace tithe" -- 8% of every SETTLED trade is burned:
//      burn = max(1, ceil(qty * 0.08)), byte-for-byte the mock's own
//      `const burnOf = q => Math.max(1, Math.ceil(q * 0.08))`
//      (web/redesign/market.html ~line 930; verified against every
//      rendered burn line: 46->4, 120->10, 12->1, 3->1, 1420->114).
//      The burn happens ONLY at settlement -- listing and withdrawal
//      are free (FROZEN copy: "withdrawal bears no penalty -- the
//      furnace burns only when a trade settles").
//   3. "No living prices" -- no market maker, no auction. Sellers carve
//      an integer price; the Dex records the last few settled prices as
//      the only anchor (see dex price history below).
//
// The listed item is NOT escrowed (mock: suspended cards): it stays in
// the seller's inventory while listed. Deploying it to a schedule room
// SUSPENDS the listing (unbuyable, still browsable); undeploying
// reverts it to active. Suspension is DERIVED LAZILY at read time from
// the seller's current deploy state (house style -- same lazy,
// poll-driven posture as services/runs.cjs's settleRoomIfDue and
// services/warehouse.cjs's normalizeWarehouseStatus; no scheduler,
// nothing persisted for it).
//
// Persistence: exclusively via server/storage.cjs's market roots
// (market_listings / market_furnace / market_dex_history; files + pg
// parity, server/migrations/004_market.sql). Every read/write below
// goes through that chokepoint, same as every other service.
//
// RULE-5 DIVERGENCE (deliberate, documented): docs/architecture.md rule
// 5 says "the client's auto-save PUT is the ONE profile writer" and
// grants use the two-phase warehouse pattern. Market SETTLEMENT is the
// one sanctioned exception: an atomic exchange between TWO players
// cannot be client-two-phased -- the seller's client may be offline at
// the moment a buyer buys, and the buyer's debit must land in the same
// synchronous transaction that flips the listing to settled (first-wins)
// or a malicious client could take delivery without paying. So
// buyListing() writes BOTH canvases server-side (buyer: TM debit;
// seller: item removal), synchronously, inside one settle. Deliveries
// still follow the house grant pattern: the ITEM reaches the buyer as a
// normal claimable WAREHOUSE row, and the seller's PROCEEDS arrive as a
// kind:'tm' warehouse row (services/warehouse.cjs's grantTmQty shape) --
// neither side's canvas ever GAINS anything server-side, each only
// loses exactly what the trade consumed. The whole settle runs
// synchronously on the single-threaded server (pg_sync's querySync
// blocks too), so two concurrent buys can never interleave mid-settle:
// the second request finds state==='settled' and 409s (first-wins).
// CLIENT GOTCHA (for the market screen squad): after a successful buy /
// after one of your listings settles, re-GET your profile before the
// next auto-save PUT -- a stale in-flight auto-save can resurrect the
// pre-trade canvas (the exact bug class REQ-0041 documented). Same
// known auto-save race posture, now applying to market settlement too.
//
// REQ-0145a (sd): this file is now a pure FACADE. The concerns live in
// server/services/market/ (lib, listings, views, trade, furnace). The
// public surface below re-exports the decomposed internals name-for-name
// (design rule 3) -- including deployedUidSet, which now lives in
// services/squads.cjs (its true domain, REQ-0145a sd) but stays on this
// facade so rule-3 consumers keep working unchanged. Consumers --
// routes, server/market.cjs, tests -- keep requiring THIS file, never
// services/market/ directly.
'use strict';
const lib = require('./market/lib.cjs');
const listings = require('./market/listings.cjs');
const views = require('./market/views.cjs');
const trade = require('./market/trade.cjs');
const furnace = require('./market/furnace.cjs');
const { deployedUidSet } = require('./squads.cjs');

module.exports = {
  MARKET_TM_ID: lib.MARKET_TM_ID,
  MARKET_BURN_RATE: lib.MARKET_BURN_RATE,
  MARKET_PRICE_MIN: lib.MARKET_PRICE_MIN,
  MARKET_PRICE_MAX: lib.MARKET_PRICE_MAX,
  MARKET_LISTING_TTL_MS: lib.MARKET_LISTING_TTL_MS,
  DEX_PRICE_HISTORY_MAX: lib.DEX_PRICE_HISTORY_MAX,
  MARKET_DTO_VERSION: lib.MARKET_DTO_VERSION,
  burnOf: lib.burnOf,
  readTmBalance: lib.readTmBalance,
  liveTmIds: lib.liveTmIds,
  isLiveTm: lib.isLiveTm,
  findInventoryPO: lib.findInventoryPO,
  findInventorySI: lib.findInventorySI,
  deployedUidSet,
  normalizeListing: listings.normalizeListing,
  listListings: views.listListings,
  createListing: listings.createListing,
  withdrawListing: listings.withdrawListing,
  devClearAllListings: listings.devClearAllListings,
  buyListing: trade.buyListing,
  furnaceTotal: furnace.furnaceTotal,
  toListingDto: views.toListingDto,
  deriveView: views.deriveView,
  sellerViewContext: views.sellerViewContext,
  getOwnListingOr404: listings.getOwnListingOr404,
};
