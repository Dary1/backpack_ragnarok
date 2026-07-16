'use strict';
// backpack_ragnarok -- server/market.cjs
// REQ-0064: the Market FACADE. Same frozen-facade convention as
// server/schedule.cjs (docs/architecture.md rule 3): the implementation
// lives in server/services/market.cjs; this file re-exports it
// name-for-name, and consumers (server/routes/market.cjs, api_test,
// future callers) require THIS file, never services/ directly. Add new
// exports here deliberately.
const market = require('./services/market.cjs');

module.exports = {
  MARKET_TM_ID: market.MARKET_TM_ID,
  MARKET_BURN_RATE: market.MARKET_BURN_RATE,
  MARKET_PRICE_MIN: market.MARKET_PRICE_MIN,
  MARKET_PRICE_MAX: market.MARKET_PRICE_MAX,
  MARKET_LISTING_TTL_MS: market.MARKET_LISTING_TTL_MS,
  DEX_PRICE_HISTORY_MAX: market.DEX_PRICE_HISTORY_MAX,
  MARKET_DTO_VERSION: market.MARKET_DTO_VERSION,
  burnOf: market.burnOf,
  readTmBalance: market.readTmBalance,
  liveTmIds: market.liveTmIds,
  isLiveTm: market.isLiveTm,
  findInventoryPO: market.findInventoryPO,
  findInventorySI: market.findInventorySI,
  findInventoryBP: market.findInventoryBP,
  deployedUidSet: market.deployedUidSet,
  normalizeListing: market.normalizeListing,
  listListings: market.listListings,
  createListing: market.createListing,
  withdrawListing: market.withdrawListing,
  devClearAllListings: market.devClearAllListings,
  buyListing: market.buyListing,
  furnaceTotal: market.furnaceTotal,
  toListingDto: market.toListingDto,
  deriveView: market.deriveView,
  sellerViewContext: market.sellerViewContext,
  getOwnListingOr404: market.getOwnListingOr404,
};
