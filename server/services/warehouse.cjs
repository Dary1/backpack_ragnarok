'use strict';
// server/services/warehouse.cjs -- REQ-0047 (c): warehouse rows (TTL /
// cap / lazy purge / normalize), grants, two-phase claim + finalize, and
// the dev-only backdate-claim seam, moved VERBATIM from
// server/schedule.cjs.
const storage = require('../storage.cjs');
const { WAREHOUSE_CAP, WAREHOUSE_TTL_MS, WAREHOUSE_CLAIM_TIMEOUT_MS, genId } = require('./core.cjs');

function isExpired(item, nowMs) {
  return Date.parse(item.expiresAt) <= (nowMs != null ? nowMs : Date.now());
}

// purgeExpiredWarehouseItems: lazy sweep, called by every warehouse read
// AND exposed standalone for a periodic scheduled sweep (see
// server/api.cjs's boot-time setInterval). Deletes every expired row for
// `playerId` and returns the surviving (unexpired) list -- callers never
// see an expired item, whether they triggered the purge themselves or a
// previous sweep already caught it.
// normalizeWarehouseStatus: rows written before REQ-0041 have no `status`
// field at all -- treated as 'claimable' (the only status that existed
// implicitly before this REQ). Also lazily reverts a `claiming` row whose
// claimedAt is older than WAREHOUSE_CLAIM_TIMEOUT_MS back to 'claimable'
// (clearing claimedAt), persisting the reversion immediately so every
// OTHER concurrent reader converges on the same state. Returns the
// (possibly mutated + re-persisted) item.
function normalizeWarehouseStatus(playerId, item, nowMs) {
  if (item.status !== 'claiming') {
    if (item.status !== 'claimable') {
      item.status = 'claimable'; // migrate a pre-REQ-0041 row missing `status`
      storage.writeWarehouseItem(playerId, item.itemUid, item);
    }
    return item;
  }
  const claimedAtMs = item.claimedAt ? Date.parse(item.claimedAt) : 0;
  if (!claimedAtMs || (nowMs - claimedAtMs) >= WAREHOUSE_CLAIM_TIMEOUT_MS) {
    item.status = 'claimable';
    item.claimedAt = null;
    storage.writeWarehouseItem(playerId, item.itemUid, item);
  }
  return item;
}

function purgeExpiredWarehouseItems(playerId) {
  const now = Date.now();
  const items = storage.listWarehouseItems(playerId);
  const survivors = [];
  for (const item of items) {
    if (isExpired(item, now)) {
      storage.deleteWarehouseItem(playerId, item.itemUid);
    } else {
      survivors.push(normalizeWarehouseStatus(playerId, item, now));
    }
  }
  return survivors;
}

// addToWarehouse: enforces the 200-item cap (golden e) at INSERT time.
// Purges expired items first (an expired slot must not count against the
// cap), then refuses if still at cap. Documented interpretation: a
// dungeon reward that arrives when the warehouse is already full is
// SILENTLY DROPPED (not queued, not bounced back to the run) -- the REQ
// doesn't specify overflow behavior for reward accrual specifically
// (only the general "max 200 items" cap), and a hard drop is safer than
// either blocking run settlement on warehouse space or silently
// exceeding the cap; flagged in the final report's interpretations list.
function addToWarehouse(playerId, doc) {
  const survivors = purgeExpiredWarehouseItems(playerId);
  if (survivors.length >= WAREHOUSE_CAP) return { ok: false, reason: 'warehouse full' };
  // REQ-0041: every warehouse row now carries a claim-state `status`
  // ('claimable' | 'claiming') -- new rows (reward accrual via settleRun,
  // or the new dev-grant path) always start 'claimable'. Callers that
  // don't pass one (pre-REQ-0041 call sites) get it defaulted here rather
  // than at every call site individually.
  const withStatus = doc.status ? doc : Object.assign({}, doc, { status: 'claimable' });
  storage.writeWarehouseItem(playerId, withStatus.itemUid, withStatus);
  return { ok: true, item: withStatus };
}

// grantWarehouseItem (REQ-0041 feedback 1 -- dev grant): inserts a
// warehouse row for `playerId` referencing content item `itemId`, subject
// to the SAME cap/TTL rules every other warehouse insertion goes through
// (addToWarehouse above -- no special-cased dev path for the cap). Caller
// (server/api.cjs's POST /api/admin/warehouse/grant route) is responsible
// for the item_admin auth gate and for validating `itemId` against the
// combined item defs BEFORE calling this (this function itself does not
// re-validate itemId against content -- see the route handler).
function grantWarehouseItem(playerId, itemId) {
  const now = new Date().toISOString();
  const itemUid = genId('wh');
  const doc = {
    itemUid, playerId, itemId,
    harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null, // dev grant -- no originating run
    status: 'claimable',
  };
  return addToWarehouse(playerId, doc);
}

// grantTmQty (REQ-0042): the TM (Transmutator)-kind sibling of
// grantWarehouseItem above -- inserts a WAREHOUSE row carrying a `qty`
// field (this is the reason warehouse rows gain a qty field at all: a
// single PO/SI grant is always qty-less/singular, but a TM grant is
// inherently a STACK of some quantity). Goes through the exact SAME
// addToWarehouse() cap/TTL chokepoint as every other warehouse
// insertion -- no special-cased dev path for the 200-item cap. Landing
// in the WAREHOUSE (not directly into the target player's live
// canvas/inventory) is deliberate, same reasoning as every other grant/
// reward path in this file: avoids a dual-writer clobber of the live
// client's in-memory state (see claimWarehouseItem's doc for the
// original bug this convention prevents) -- the player claims it via the
// normal warehouse-claim UI, same as any other warehouse row. Claiming a
// TM row (see the claim-side handling in server/api.cjs / the client's
// WarehouseTab-equivalent for TM kinds) merges into an existing
// matching-id inventory stack if one exists in the destination page,
// otherwise first-fit-places a new stack -- reusing engine.js's
// tmMove/tmCanPlace (REQ-0042 (b)), exactly like grantWarehouseItem's
// rows reuse invMovePO/invCanPlacePO on the claim side.
function grantTmQty(playerId, tmId, qty) {
  const now = new Date().toISOString();
  const itemUid = genId('wh');
  const doc = {
    itemUid, playerId, itemId: tmId, qty,
    kind: 'tm', // distinguishes a TM-stack warehouse row from a plain PO/SI row on the claim side
    harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null,
    status: 'claimable',
  };
  return addToWarehouse(playerId, doc);
}

function listWarehouse(playerId) {
  return purgeExpiredWarehouseItems(playerId);
}

// claimWarehouseItem (golden f, REWRITTEN by REQ-0041 -- two-phase
// claim). BUG #3 ROOT CAUSE (CONFIRMED by live reproduction against the
// running dev server -- see the REQ-0041 outcome doc for the exact
// repro/observation): the OLD version of this function did server-side
// first-fit placement into `profileCanvas` IN PLACE, and server/api.cjs's
// route handler then called storage.writeProfile() with that mutated
// canvas -- a SECOND, server-side writer racing the client's own
// 800ms-debounced auto-save PUT (client/src/store.ts's scheduleAutoSave/
// flushAutoSave via notifyStateChanged(), the app's ONE auto-save choke
// point). The client's in-memory canvas never learned about the server's
// insertion; whichever PUT physically lands last at the storage layer
// wins, so a stale client-side auto-save (already in flight, or
// triggered by the claim response handler's own subsequent state churn)
// can overwrite the server's just-written inventory placement with the
// client's OLD copy -- the claimed item vanishes from the persisted
// profile even though the HTTP response reported success.
//
// FIX (two-phase claim, per the REQ's own design): the server no longer
// EVER writes a profile on claim -- claiming a row here only flips its
// `status` to 'claiming' (+ claimedAt) and returns the item's CONTENT DEF
// id (`itemId`) plus the row's own `itemUid`. The CLIENT then performs
// the first-fit placement itself (client/src/schedule/WarehouseTab.tsx),
// reusing `itemUid` AS the new inventory PO/SI's own uid (a deliberate
// interpretation change from the old server-side version, which minted a
// SEPARATE fresh uid -- reusing itemUid instead makes server-side
// finalization an exact, unambiguous uid-membership check, see
// finalizeClaimingItemsForCanvas() below, rather than a fuzzier
// itemId-based heuristic), then calls the SAME notifyStateChanged() every
// other board mutation already goes through -- restoring "one writer"
// (the client's own auto-save is once again the only path that ever
// writes this player's profile). The server finalizes (deletes the
// warehouse row) the moment a profile PUT arrives whose saved canvas
// actually contains `itemUid` anywhere (see finalizeClaimingItemsForCanvas,
// called from server/api.cjs's profile PUT handler) -- and lazily reverts
// an abandoned `claiming` row back to `claimable` after
// WAREHOUSE_CLAIM_TIMEOUT_MS elapses uncommitted (see
// normalizeWarehouseStatus() above), so a client crash/tab-close mid-claim
// never permanently strands the item.
//
// NO inventory->warehouse path exists anywhere in this module (golden r's
// reverse-direction ban, generalized here even ahead of P3 trade -- there
// is simply no function that moves an item from a home back into a
// warehouse row).
function claimWarehouseItem(playerId, itemUid, itemDefsById, tmDefsById) {
  purgeExpiredWarehouseItems(playerId); // also normalizes/reverts stale 'claiming' rows (see normalizeWarehouseStatus above)
  const item = storage.readWarehouseItem(playerId, itemUid);
  if (!item) { const err = new Error('warehouse item not found (or expired)'); err.code = 'NOT_FOUND'; throw err; }
  if (item.status && item.status !== 'claimable') {
    const err = new Error('warehouse item is already being claimed'); err.code = 'CONFLICT'; throw err;
  }

  // REQ-0042: a TM-kind row (kind:'tm', e.g. an LRDST reward/grant)
  // validates against tmDefsById instead of itemDefsById -- everything
  // else about the two-phase claim mechanism (mark 'claiming', return
  // WITHOUT touching the profile, finalize on the next PUT containing
  // the reused uid) is identical between kinds.
  if (item.kind === 'tm') {
    const tmDef = (tmDefsById || {})[item.itemId];
    if (!tmDef) { const err = new Error('claimed item references an unknown tm id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }
  } else {
    const itemDef = itemDefsById[item.itemId];
    if (!itemDef) { const err = new Error('claimed item references an unknown content item id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }
  }

  item.status = 'claiming';
  item.claimedAt = new Date().toISOString();
  storage.writeWarehouseItem(playerId, itemUid, item);

  return { itemUid, itemId: item.itemId, kind: item.kind, qty: item.qty };
}

// finalizeClaimingItemsForCanvas (REQ-0041): called by server/api.cjs's
// profile PUT handler AFTER a successful storage.writeProfile() (i.e.
// once the client's own auto-save has actually landed). Deletes every
// one of `playerId`'s CURRENTLY 'claiming' warehouse rows whose itemUid
// now appears anywhere in the just-saved `canvas` -- the client mints the
// claimed item's on-canvas uid by REUSING the warehouse row's own
// itemUid (see claimWarehouseItem's doc above), so this is an exact,
// unambiguous uid-membership scan, not a fuzzy itemId-based heuristic.
// Scans the active preset's top-level fields, every inactive preset's
// store[] snapshot, AND every inventory page (a claimed item's HOME
// always lands in st.inv per the reference model, REQ-0033, regardless
// of whether any preset happens to reference it yet) -- covers a PO's
// `pos[].uid`, a BP's `bps[].id`, and an SI's `sis[].uid` (a claimed
// warehouse item is always a PO or SI in practice -- see the REQ-0041
// outcome doc's note on why BPs are never claimable content -- but this
// scan checks all three arrays uniformly for robustness, matching
// engine.js's own presetUidSet()-style scans elsewhere in this file).
// A simple O(claiming rows + canvas items) scan -- comfortably
// sub-millisecond at this project's scale (a handful of claiming rows, a
// few dozen placed items per canvas), no index/cache warranted, matching
// the perf posture engine.js's own tintSets()/usageOf() already accept
// for a similarly-shaped full scan.
function finalizeClaimingItemsForCanvas(playerId, canvas) {
  if (!canvas) return;
  const claimingItems = storage.listWarehouseItems(playerId).filter((i) => i.status === 'claiming');
  if (!claimingItems.length) return;

  const presentUids = new Set();
  // REQ-0042: also track which TM ids exist anywhere in the canvas at
  // all -- a TM-kind claim that MERGES into an existing same-id stack
  // (firstFitOrMergeTM's mergeInto path, client/src/schedule/
  // WarehouseTab.tsx) intentionally DISCARDS the claimed row's own uid
  // (the destination stack's uid survives, see mock-src/engine.js's
  // tmMove doc comment) -- so a pure uid-membership check like the one
  // POs/SIs/BPs use below can never finalize a merged TM claim; it would
  // sit in 'claiming' forever (and eventually lazy-revert on timeout,
  // silently handing the qty back for reclaiming -- a real duplication
  // bug caught by E2E coverage of the TM-claim-merge flow). A same-id TM
  // stack existing ANYWHERE in the just-saved canvas is sufficient
  // finalize evidence: the claim flow always calls tmMove (merge or
  // fresh-place) as part of the SAME mutation that precedes this very
  // auto-save, so if a matching-id stack exists at all, this row's own
  // qty is either sitting in it (merged) or in its own fresh stack
  // (unmerged) -- either way, the claim landed.
  const presentTmIds = new Set();
  const collectFrom = (container) => {
    if (!container) return;
    for (const p of container.pos || []) presentUids.add(p.uid);
    for (const b of container.bps || []) presentUids.add(b.id);
    for (const a of container.sis || []) presentUids.add(a.uid);
    for (const t of container.tms || []) { presentUids.add(t.uid); presentTmIds.add(t.id); }
  };
  collectFrom(canvas); // active preset's top-level fields
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) collectFrom(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) collectFrom(pg);
  }

  for (const item of claimingItems) {
    const finalized = item.kind === 'tm'
      ? (presentUids.has(item.itemUid) || presentTmIds.has(item.itemId))
      : presentUids.has(item.itemUid);
    if (finalized) {
      storage.deleteWarehouseItem(playerId, item.itemUid);
    }
  }
}

// ---------------------------------------------------------------------
// Cancel (golden g). "Any participating player canceling cancels the
// schedule; room settings may disallow IMMEDIATE cancel." Solo scope:
// the only participating player IS the owner, so this is a straight
// policy check against the room's OWN cancelPolicy.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// REQ-0036 P1-C: dev-only run-clock backdate hook, for E2E "run settles"
// coverage without burning real wall-clock time. See server/README.md's
// "E2E time-control (dev-only backdate hook)" section for the full
// rationale/gating writeup. THIS IS A TEST-CONTROL SEAM, NOT A GAMEPLAY
// FEATURE: it never touches the SEED (a caller cannot bias reward RNG --
// startRun()'s crypto.randomBytes(16) seed generation is completely
// untouched by this function), it only rewrites the ALREADY-COMPUTED
// run's own `startedAt` timestamp further into the past so its run-clock
// (elapsedSecs = (Date.now()-startedAt)/1000) reads as already elapsed on
// the very next read -- exactly mirroring what server/tests/api_test.cjs's
// own forceRunElapsed() test helper has done (server-internally) since
// P1-B. This is the same idea, exposed as a real HTTP route so E2E specs
// (which only have HTTP access, no direct require() of schedule.cjs) can
// do the equivalent without waiting out a real dungeon run's full
// durationSecs (~20s+ for the real niflheim_depths content with a
// detection/unlock-capable unit; unboundedly longer -- e.g. 999s -- for a
// unit that never clears a detection-mode encounter at all, per this
// REQ's own P1-C measurement).
//
// Caller gating (server/api.cjs's route handler, NOT here): only
// reachable when the RESOLVED caller is the dev_mode fallback player
// (no token sent, dev_mode:true) -- see admin.cjs's resolveAuth()/
// readDevUser(). A real guest token (even a valid one) is REFUSED
// (403) by api.cjs before this function is ever called, so no ordinary
// authenticated player can fast-forward their own or anyone else's run.
function devBackdateClaimedWarehouseItem(playerId, itemUid, extraSecsIntoPast) {
  const item = storage.readWarehouseItem(playerId, itemUid);
  if (!item) { const err = new Error('warehouse item not found'); err.code = 'NOT_FOUND'; throw err; }
  if (item.status !== 'claiming') {
    const err = new Error('warehouse item is not currently claiming'); err.code = 'BAD_REQUEST'; throw err;
  }
  const pastMs = Date.now() - (WAREHOUSE_CLAIM_TIMEOUT_MS + Math.max(0, Number(extraSecsIntoPast) || 5) * 1000);
  item.claimedAt = new Date(pastMs).toISOString();
  storage.writeWarehouseItem(playerId, itemUid, item);
  return item;
}

// devClearWarehouse (fix: e2e pg teardown): bulk-deletes EVERY warehouse
// row belonging to `playerId` (any status, expired or not) and returns
// the number of rows removed. Exists for exactly one caller: the
// dev-only POST /api/warehouse/dev/clear-debris route (server/routes/
// schedule.cjs), which the Playwright suite's global setup/teardown hit
// so E2E-granted rows stop accumulating against WAREHOUSE_CAP when the
// live API runs STORAGE_BACKEND=pg (the suite's file backup/restore
// safety net never covered pg rows). Delegates to storage.cjs's
// clearWarehouseForPlayer chokepoint so files and pg behave identically.
//
// Caller gating (route handler, NOT here): dev_mode no-token fallback
// caller ONLY, exactly like devBackdateClaimedWarehouseItem above -- and
// the route always passes the RESOLVED caller's own id, never a client-
// supplied one, so no real player's warehouse is reachable through this.
function devClearWarehouse(playerId) {
  return storage.clearWarehouseForPlayer(playerId);
}


module.exports = {
  isExpired,
  normalizeWarehouseStatus,
  purgeExpiredWarehouseItems,
  addToWarehouse,
  grantWarehouseItem,
  grantTmQty,
  listWarehouse,
  claimWarehouseItem,
  finalizeClaimingItemsForCanvas,
  devBackdateClaimedWarehouseItem,
  devClearWarehouse,
};
