'use strict';
// server/services/ragnarok.cjs -- REQ-0066: the Hall of Ragnarok service
// (server side; the client screen -- web/redesign/ragnarok.html -- is a
// separate, later squad that consumes the DTOs this module shapes, see
// shared/dto.ts's ApiRagnarok* types). Four concerns live here:
//
//   S1 SEASON REGISTRY -- seasons are CONTENT, not code: the registry
//      lives in content/live/seasons.json (one entry per season:
//      {index, name, nameEn, startAt, phaseDays, phasesPerSeason,
//      ragnarokAt}). The CURRENT season/phase/countdown is derived
//      LAZILY from the wall clock on every read -- no scheduler, same
//      poll-driven posture as services/runs.cjs's settleRoomIfDue. The
//      mock's season strip (第参季「狼の冬」・第九月相 / ラグナロクまで23日 /
//      the 12-wedge wheel) renders straight off these derived fields.
//   S2 THE ETERNAL ORDER (永劫の序列) -- the all-season standings table
//      (mock: 全季通算・消えぬ刻銘). Rebuilt LAZILY once per dawn (mock
//      copy: 「更新は毎暁」): the first order read past a dawn boundary
//      recomputes the standings from the einherjar records and caches
//      the result via storage.cjs's ragnarok order-cache root; every
//      later read that dawn-day serves the cache verbatim.
//   S3 EINHERJAR RECORDS -- one immutable record per completed Devotion
//      rite: who devoted what, when, plus a FROZEN deep-copy snapshot of
//      the devoted squad's resolved canvas + the content item defs it
//      referenced at rite time (same snapshot discipline as run copies:
//      services/runs.cjs's startRun deep-copies squad snapshots at start
//      so later edits never reach the in-flight run).
//   S4 THE DEVOTION RITE (献身の儀) -- the irreversible ceremony. THE
//      COST is the reference-model consequence (see applyDevotionToCanvas
//      below): every physical item the devoted squad references is
//      destroyed ACCOUNT-WIDE, and the squad slot itself is deleted.
//      Mock copy (frozen): 「献身は取り消せない。全ての鞄・物品・型は失われ、
//      名だけが永遠に刻まれる。」-- 鞄=BPs, 物品=POs, 型=SIs.
//
// RULE-5 DIVERGENCE (deliberate, documented): docs/architecture.md rule
// 5 says "the client's auto-save PUT is the ONE profile writer". The
// Devotion rite is the second sanctioned exception, citing the precedent
// services/market.cjs's header established for market settlement
// (REQ-0064): an irreversible, server-authoritative state change (here:
// account-wide item destruction) cannot be trusted to a client-side
// save -- a client that "forgot" to destroy the items after the server
// engraved the record would keep both the squad and the glory. So
// devote() writes the caller's canvas server-side, synchronously,
// inside the rite -- and the canvas only ever LOSES material, never
// gains (the same each-side-only-loses shape market settlement keeps).
// CLIENT GOTCHA (for the ragnarok screen squad): after a successful
// rite, re-GET your profile before the next auto-save PUT -- a stale
// in-flight auto-save can resurrect the destroyed items (the exact bug
// class REQ-0041 documented, same posture as market settlement).
//
// Persistence: exclusively via server/storage.cjs's ragnarok roots
// (ragnarok_einherjar / ragnarok_order_cache; files + pg parity,
// server/migrations/005_ragnarok.sql).
//
// REQ-0145a (sd): this file is now a pure FACADE. The four concerns live
// in server/services/ragnarok/ (lib, seasons, einherjar, order, snapshot,
// devotion). The public surface below re-exports the decomposed internals
// name-for-name (design rule 3); consumers -- routes, server/ragnarok.cjs,
// tests -- keep requiring THIS file, never services/ragnarok/ directly.
'use strict';
const lib = require('./ragnarok/lib.cjs');
const seasons = require('./ragnarok/seasons.cjs');
const einherjar = require('./ragnarok/einherjar.cjs');
const order = require('./ragnarok/order.cjs');
const snapshot = require('./ragnarok/snapshot.cjs');
const devotion = require('./ragnarok/devotion.cjs');

module.exports = {
  RAGNAROK_DTO_VERSION: lib.RAGNAROK_DTO_VERSION,
  RAGNAROK_DAWN_UTC_HOUR: lib.RAGNAROK_DAWN_UTC_HOUR,
  SCORE_WEIGHTS: lib.SCORE_WEIGHTS,
  SCORE_FORMULA_VERSION: lib.SCORE_FORMULA_VERSION,
  ORDER_TIERS: lib.ORDER_TIERS,
  ORDER_EMBLEM_PLACEHOLDER: lib.ORDER_EMBLEM_PLACEHOLDER,
  ORDER_TOP_DEFAULT: lib.ORDER_TOP_DEFAULT,
  ORDER_TOP_MAX: lib.ORDER_TOP_MAX,
  ORDER_AROUND_SPAN: lib.ORDER_AROUND_SPAN,
  RITE_LOCK_TIMEOUT_MS: lib.RITE_LOCK_TIMEOUT_MS,
  // S1 seasons
  listSeasons: seasons.listSeasons,
  currentSeason: seasons.currentSeason,
  deriveSeasonClock: seasons.deriveSeasonClock,
  // S2 the eternal order
  battleScoreOf: einherjar.battleScoreOf,
  scoreOfRecord: einherjar.scoreOfRecord,
  tierOf: order.tierOf,
  lastDawnMs: order.lastDawnMs,
  rebuildOrder: order.rebuildOrder,
  getOrderDoc: order.getOrderDoc,
  orderView: order.orderView,
  devForceRebuildOrder: order.devForceRebuildOrder,
  // S3 einherjar records
  listEinherjar: einherjar.listEinherjar,
  einherjarDto: einherjar.einherjarDto,
  normalizeRiteRecord: einherjar.normalizeRiteRecord,
  devClearEinherjarRecords: einherjar.devClearEinherjarRecords,
  // S4 the devotion rite
  devotionBlastRadius: devotion.devotionBlastRadius,
  stripDestroyedUids: devotion.stripDestroyedUids,
  applyDevotionToCanvas: devotion.applyDevotionToCanvas,
  buildFrozenSnapshot: snapshot.buildFrozenSnapshot,
  previewDevotion: devotion.previewDevotion,
  projectDevotionOrder: devotion.projectDevotionOrder,
  devote: devotion.devote,
};
