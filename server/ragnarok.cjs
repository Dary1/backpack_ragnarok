'use strict';
// backpack_ragnarok -- server/ragnarok.cjs
// REQ-0066: the Hall of Ragnarok FACADE. Same frozen-facade convention
// as server/schedule.cjs and server/market.cjs (docs/architecture.md
// rule 3): the implementation lives in server/services/ragnarok.cjs;
// this file re-exports it name-for-name, and consumers
// (server/routes/ragnarok.cjs, server/routes/market.cjs's furnace
// windowing, api_test, future callers -- notably REQ-0068's season-end
// battles) require THIS file, never services/ directly. Add new exports
// here deliberately.
const ragnarok = require('./services/ragnarok.cjs');

module.exports = {
  RAGNAROK_DTO_VERSION: ragnarok.RAGNAROK_DTO_VERSION,
  RAGNAROK_DAWN_UTC_HOUR: ragnarok.RAGNAROK_DAWN_UTC_HOUR,
  SCORE_WEIGHTS: ragnarok.SCORE_WEIGHTS,
  SCORE_FORMULA_VERSION: ragnarok.SCORE_FORMULA_VERSION,
  ORDER_TIERS: ragnarok.ORDER_TIERS,
  ORDER_EMBLEM_PLACEHOLDER: ragnarok.ORDER_EMBLEM_PLACEHOLDER,
  ORDER_TOP_DEFAULT: ragnarok.ORDER_TOP_DEFAULT,
  ORDER_TOP_MAX: ragnarok.ORDER_TOP_MAX,
  ORDER_AROUND_SPAN: ragnarok.ORDER_AROUND_SPAN,
  RITE_LOCK_TIMEOUT_MS: ragnarok.RITE_LOCK_TIMEOUT_MS,
  listSeasons: ragnarok.listSeasons,
  currentSeason: ragnarok.currentSeason,
  deriveSeasonClock: ragnarok.deriveSeasonClock,
  battleScoreOf: ragnarok.battleScoreOf,
  scoreOfRecord: ragnarok.scoreOfRecord,
  tierOf: ragnarok.tierOf,
  lastDawnMs: ragnarok.lastDawnMs,
  rebuildOrder: ragnarok.rebuildOrder,
  getOrderDoc: ragnarok.getOrderDoc,
  orderView: ragnarok.orderView,
  devForceRebuildOrder: ragnarok.devForceRebuildOrder,
  listEinherjar: ragnarok.listEinherjar,
  einherjarDto: ragnarok.einherjarDto,
  normalizeRiteRecord: ragnarok.normalizeRiteRecord,
  devClearEinherjarRecords: ragnarok.devClearEinherjarRecords,
  devotionBlastRadius: ragnarok.devotionBlastRadius,
  stripDestroyedUids: ragnarok.stripDestroyedUids,
  applyDevotionToCanvas: ragnarok.applyDevotionToCanvas,
  buildFrozenSnapshot: ragnarok.buildFrozenSnapshot,
  previewDevotion: ragnarok.previewDevotion,
  projectDevotionOrder: ragnarok.projectDevotionOrder,
  devote: ragnarok.devote,
};
