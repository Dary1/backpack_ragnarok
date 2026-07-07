'use strict';
// backpack_ragnarok -- server/dismantle.cjs
// REQ-0063: the Dismantle FACADE. Same frozen-facade convention as
// server/market.cjs (docs/architecture.md rule 3): the implementation
// lives in server/services/dismantle.cjs; this file re-exports it
// name-for-name, and consumers (server/routes/dismantle.cjs, api_test,
// server/routes/dex.cjs for the REQ-0052 card's 分解値 section, future
// callers) require THIS file, never services/ directly. Add new exports
// here deliberately.
const dismantle = require('./services/dismantle.cjs');

module.exports = {
  SUPPRESSION_CAP: dismantle.SUPPRESSION_CAP,
  SUPPRESSION_DECAY: dismantle.SUPPRESSION_DECAY,
  suppressionFloor: dismantle.suppressionFloor,
  dismantleCountFor: dismantle.dismantleCountFor,
  currentSuppression: dismantle.currentSuppression,
  rollQuality: dismantle.rollQuality,
  engrave: dismantle.engrave,
  findInventoryItem: dismantle.findInventoryItem,
  stripItemFromCanvas: dismantle.stripItemFromCanvas,
  dismantleItem: dismantle.dismantleItem,
  YIELD_TM_ID: dismantle.YIELD_TM_ID,
  YIELD_QTY: dismantle.YIELD_QTY,
};
