// backpack_ragnarok -- server/schedule.cjs
// REQ-0036 P1-B: the Dungeon Schedule SERVICE (server-side, solo scope --
// rooms are self-only per the P1 split; multi-player joins are P2).
// Business logic sits here; server/api.cjs wires HTTP routes to these
// functions; server/storage.cjs is the sole persistence chokepoint
// (rooms/runs/warehouse), same convention as every other server module.
//
// Scope note: this module implements golden a-q (see docs/REQ/
// REQ-0036-dungeon-schedule.md) for the SOLO room case -- a single
// player fills all 4 squad slots of their own room (golden b: "a sortie
// Troop = 4 Squads (any number of players)" -- P1-B covers the "1 player,
// 4 squads" corner of that space; multi-player joins are a P2 concern and
// intentionally not built here). golden r (warehouse-scoped trade
// between players of the same schedule) is explicitly P3 -- not built.
// golden c's public/friends/friends-of-friends/group visibility levels
// are likewise a P2+ concern once real multi-player matching exists --
// P1-B's rooms are always created with visibility:"self" (only the
// owner can ever see/list/act on their own rooms; enforced both by the
// data model -- a room always carries its ownerId -- and by every route
// handler in api.cjs re-checking the caller's resolved token identity
// against that ownerId, never trusting a client-supplied id).
'use strict';
// REQ-0047 (c): this file is now a FACADE. The implementation was
// decomposed VERBATIM into server/services/{core,rooms,squads,runs,
// warehouse,gacha}.cjs -- the exported surface below is name-for-name
// identical to the pre-split module.exports, so every consumer
// (server/routes/*, api_test, future callers) keeps working unchanged.
'use strict';
const core = require('./services/core.cjs');
const squads = require('./services/squads.cjs');
const rooms = require('./services/rooms.cjs');
const warehouse = require('./services/warehouse.cjs');
const runs = require('./services/runs.cjs');
const gacha = require('./services/gacha.cjs');
const seals = require('./services/seals.cjs'); // REQ-0058

module.exports = {
  WAREHOUSE_CAP: core.WAREHOUSE_CAP,
  WAREHOUSE_TTL_MS: core.WAREHOUSE_TTL_MS,
  SQUAD_SLOTS: core.SQUAD_SLOTS,
  DEFAULT_FORMATION_ID: core.DEFAULT_FORMATION_ID,
  DEFAULT_FAILURE_STEP: core.DEFAULT_FAILURE_STEP,
  getScheduleContent: core.getScheduleContent,
  resolveRewardItemId: core.resolveRewardItemId,
  makeEngine: core.makeEngine,
  squadCanvasOf: squads.squadCanvasOf,
  squadUidSet: squads.squadUidSet,
  isSquadIndependent: squads.isSquadIndependent,
  deployedUidSetsForGate: squads.deployedUidSetsForGate,
  createRoom: rooms.createRoom,
  getRoomOr404: rooms.getRoomOr404,
  getOwnRoomOr404: rooms.getOwnRoomOr404,
  listOwnRooms: rooms.listOwnRooms,
  assignSlot: squads.assignSlot,
  swapSquad: squads.swapSquad,
  applyPendingSwapIfAny: squads.applyPendingSwapIfAny,
  computeDurationSecs: runs.computeDurationSecs,
  runClock: runs.runClock,
  visibleEvents: runs.visibleEvents,
  buildSquadSnapshots: runs.buildSquadSnapshots,
  startRun: runs.startRun,
  settleRun: runs.settleRun,
  settleRoomIfDue: runs.settleRoomIfDue,
  maybeAutoStartNextRun: runs.maybeAutoStartNextRun,
  isExpired: warehouse.isExpired,
  purgeExpiredWarehouseItems: warehouse.purgeExpiredWarehouseItems,
  addToWarehouse: warehouse.addToWarehouse,
  grantWarehouseItem: warehouse.grantWarehouseItem,
  grantTmQty: warehouse.grantTmQty,
  devBackdateClaimedWarehouseItem: warehouse.devBackdateClaimedWarehouseItem,
  devClearWarehouse: warehouse.devClearWarehouse,
  listWarehouse: warehouse.listWarehouse,
  claimWarehouseItem: warehouse.claimWarehouseItem,
  finalizeClaimingItemsForCanvas: warehouse.finalizeClaimingItemsForCanvas,
  cancelRoom: rooms.cancelRoom,
  devClearRooms: rooms.devClearRooms,
  listDungeonsAndFormations: core.listDungeonsAndFormations,
  devBackdateActiveRun: runs.devBackdateActiveRun,
  WAREHOUSE_CLAIM_TIMEOUT_MS: core.WAREHOUSE_CLAIM_TIMEOUT_MS,
  GACHA_COMMON_BP_COST: gacha.GACHA_COMMON_BP_COST,
  GACHA_PENDING_TIMEOUT_MS: gacha.GACHA_PENDING_TIMEOUT_MS,
  readLrdstBalance: gacha.readLrdstBalance,
  rollPolyomino: gacha.rollPolyomino,
  rollCommonBp: gacha.rollCommonBp,
  startGachaRoll: gacha.startGachaRoll,
  purgeExpiredGachaPending: gacha.purgeExpiredGachaPending,
  finalizeGachaForCanvas: gacha.finalizeGachaForCanvas,
  // REQ-0058: sealed seed share
  mintSeal: seals.mintSeal,
  getSeal: seals.getSeal,
  publicSealMeta: seals.publicSealMeta,
  createSealRoom: seals.createSealRoom,
  buildSealComparison: seals.buildSealComparison,
  buildSealReplay: seals.buildSealReplay,
};
