'use strict';
// server/services/warehouse.cjs -- REQ-0047 (c): warehouse rows (TTL /
// cap / lazy purge / normalize), grants, two-phase claim + finalize, and
// the dev-only backdate-claim seam, moved VERBATIM from
// server/schedule.cjs.
const storage = require('../storage.cjs');
const { WAREHOUSE_CAP, WAREHOUSE_TTL_MS, WAREHOUSE_CLAIM_TIMEOUT_MS, genId, getScheduleContent, makeEngine } = require('./core.cjs');

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
  // REQ-0063: yield grants are deferred to a SECOND pass, after this
  // loop finishes deleting/engraving against the SNAPSHOT `items` array.
  // REASON (a real reentrancy bug caught by this REQ's own test suite):
  // grantTmQty() -> addToWarehouse() -> purgeExpiredWarehouseItems()
  // (this SAME function, re-entrantly) -- calling it while still
  // iterating `items` would have a re-entrant inner call re-read
  // storage.listWarehouseItems() fresh from disk and ALSO see (and
  // double-engrave/double-delete) whichever expired rows the outer loop
  // has not reached yet. Collecting yield counts here and granting them
  // only after this loop's deletions are ALL committed makes any
  // re-entrant inner purge call see a warehouse with zero expired rows
  // left, so it is a safe no-op.
  let yieldCount = 0;
  let anyNonTmExpired = false;
  for (const item of items) {
    if (isExpired(item, now)) {
      if (item.kind === 'tm') {
        // Currency has no Dex entry -- nothing to engrave. Same plain
        // delete as before REQ-0063.
        storage.deleteWarehouseItem(playerId, item.itemUid);
      } else {
        anyNonTmExpired = true;
        storage.deleteWarehouseItem(playerId, item.itemUid);
      }
    } else {
      survivors.push(normalizeWarehouseStatus(playerId, item, now));
    }
  }
  // REQ-0063 §4: the TTL "soft landing" -- expiry auto-dismantles (full
  // engraving, 50%-chance yield) instead of vanishing with nothing.
  // These are WAREHOUSE rows, never placed on a canvas, so there is no
  // item-removal step (only claimed items live on a canvas) -- just the
  // ledger credit + probabilistic yield. A SINGLE `require('./dismantle.
  // cjs')` here (rather than one per expired item inside the loop above)
  // is both simpler and required for correctness: yield grants are
  // deferred to this SECOND pass, entirely AFTER the loop's deletions are
  // committed. REASON (a real reentrancy bug caught by this REQ's own
  // test suite): grantTmQty() -> addToWarehouse() -> THIS SAME FUNCTION,
  // re-entrantly -- calling it while still iterating `items` would have a
  // re-entrant inner call re-read storage.listWarehouseItems() fresh from
  // disk and ALSO see (and double-engrave/double-delete) whichever
  // expired rows the outer loop had not reached yet. By the time this
  // second pass runs, zero expired rows remain, so a re-entrant inner
  // purge call is a safe no-op.
  if (anyNonTmExpired) {
    const dismantle = require('./dismantle.cjs');
    for (const item of items) {
      if (!isExpired(item, now) || item.kind === 'tm') continue;
      dismantle.engrave(playerId, item.itemId);
      if (Math.random() < 0.5) yieldCount++;
    }
    for (let i = 0; i < yieldCount; i++) grantTmQty(playerId, dismantle.YIELD_TM_ID, dismantle.YIELD_QTY);
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
  const { rollQuality } = require('./dismantle.cjs');
  const doc = {
    itemUid, playerId, itemId,
    q: rollQuality(playerId, itemId), // REQ-0063: per-instance quality roll, minted once here
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


// ---------------------------------------------------------------------
// REQ-0215: claimSpotOr409 -- the server-side SINGLE-SPOT fit test.
//
// The user's spec: "the fit check is the CLIENT's job -- it receives the shape,
// returns the inventory index + position the shape fits at; the server tests
// ONLY that spot, and if OK the item moves warehouse -> inventory."
//
// So this is a VALIDATOR, not a search. It never scans for a free cell and never
// picks a spot: it takes the client's proposed {page, position} and asks the
// engine one question -- "is THIS legal?" -- because a client-computed placement
// is a client-supplied claim about the player's own canvas, and an unvalidated
// one would let a crafted request drop an item into an occupied/out-of-bounds
// cell. Cost is O(1) per claim rather than the O(64 x pages) the old server-side
// first-fit paid before REQ-0041 deleted it.
//
// WHAT IT TESTS AGAINST: the LAST-SAVED canvas -- the only canvas the server can
// legitimately see (design rule 5: the client's auto-save PUT is the one profile
// writer; nothing here writes). That makes the client's flushAutoSave() BEFORE
// claiming load-bearing, not cosmetic: an unsaved live state means the server is
// judging a spot on a stale board and can both false-reject a legal claim and
// pass an illegal one. The client owns that flush (see useWarehouseData.ts).
//
// It works on a DEEP COPY and throws instead of mutating: the placeholder record
// each engine canPlace* needs (invCanPlacePO/BP look their record up by uid for
// its shape/rot) must never touch the real saved canvas.
//
// `position` is the anchor in each engine call's OWN convention -- PO/SI/TM take
// an anchor cell, a BP takes its origin -- so one [row, col] pair covers all four
// kinds on the wire.
function claimSpotOr409(item, kind, spot, canvas) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) {
    const err = new Error('no saved canvas to place into -- save your inventory once before claiming');
    err.code = 'CONFLICT'; err.reason = 'no_canvas'; throw err;
  }
  const pg = spot.page;
  if (!Number.isInteger(pg) || pg < 0 || pg >= canvas.inv.pages.length) {
    const err = new Error('page must be an inventory page index in 0..' + (canvas.inv.pages.length - 1) + ' (got ' + JSON.stringify(spot.page) + ')');
    err.code = 'BAD_REQUEST'; throw err;
  }
  const at = spot.position;
  if (!Array.isArray(at) || at.length !== 2 || !Number.isInteger(at[0]) || !Number.isInteger(at[1])) {
    const err = new Error('position must be an integer [row, col] pair (got ' + JSON.stringify(spot.position) + ')');
    err.code = 'BAD_REQUEST'; throw err;
  }

  const { itemDefsById, unitDefsById, connShapes } = getScheduleContent();
  const engine = makeEngine(itemDefsById, unitDefsById, connShapes);
  const st = JSON.parse(JSON.stringify(canvas));
  const container = st.inv.pages[pg];
  const uid = item.itemUid;

  let chk;
  if (kind === 'tm') {
    // idIfNew: this uid has no stack of its own yet, so tmCanPlace cannot know
    // what id it would merge AS -- the grant/claim-merge shape its own doc
    // describes. Passing it is what lets a same-id stack read as a legal merge
    // target rather than an 'occupied' rejection, matching the client's
    // firstFitOrMergeTM merge path exactly.
    chk = engine.tmCanPlace(st, pg, uid, at, [uid], item.itemId);
  } else if (kind === 'bp') {
    container.bps.push({
      id: uid, name: (item.bp && item.bp.name) || 'BP', color: (item.bp && item.bp.color) || '#8a8a8a',
      shape: item.bp.shape, origin: at, unit: item.bp.unit, hpMax: item.bp.hpMax,
    });
    chk = engine.invCanPlaceBP(st, pg, uid, at);
  } else if (kind === 'si') {
    container.sis.push({ uid, id: item.itemId, host: 'inv' });
    chk = engine.invCanPlaceSI(st, pg, uid, at, [uid]);
  } else {
    container.pos.push({ uid, id: item.itemId, loc: 'grid', cell: [1, 1], rot: 0 });
    chk = engine.invCanPlacePO(st, pg, uid, 0, at);
  }

  if (!chk || !chk.ok) {
    const why = (chk && chk.why) || 'no room';
    const err = new Error('no room for this item at page ' + pg + ' ' + JSON.stringify(at) + ': ' + why);
    err.code = 'CONFLICT'; err.reason = 'no_space'; throw err;
  }
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
//
// REQ-0215 amends the two-phase design above in ONE place: the claim now carries
// the client's chosen {page, position} and is REJECTED (409 no_space) unless the
// engine agrees that exact spot is legal on the last-saved canvas -- see
// claimSpotOr409 directly above. Everything else here is untouched: the server
// still never writes a profile, the client still places and auto-saves, and that
// PUT still finalizes via finalizeClaimingItemsForCanvas's uid-membership check.
// The rule-5 posture and the BUG #3 fix are fully intact; only the "silently
// leave it claiming when nothing fits" behaviour is gone.
function claimWarehouseItem(playerId, itemUid, itemDefsById, tmDefsById, siDefsById, unitDefsById, spot, canvas) {
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
  } else if (item.kind === 'bp') {
    // REQ-0195d: a bought unit (BP) row -- validate the carried instance's
    // unit.id against unitDefsById and return the payload for the client to
    // place via firstFitPlaceBp (the Workshop's own claim path).
    const unitId = item.bp && item.bp.unit && item.bp.unit.id;
    if (!unitId || !(unitDefsById || {})[unitId]) { const err = new Error('claimed BP references an unknown unit id: ' + unitId); err.code = 'BAD_REQUEST'; throw err; }
  } else {
    // REQ-0115: a plain (non-tm) row is a PO *or* an SI -- accept an id
    // present in EITHER itemDefsById (PO + pilot overlay) OR siDefsById
    // (live_sis.json). Before REQ-0115 this checked itemDefsById alone, so
    // a warehouse row carrying an SI id (e.g. the dev "Acquire to
    // warehouse" grant of acc_gem) 400'd here as an "unknown content item
    // id" and could never be claimed onto the canvas -- even though the
    // client already resolves + places SIs (WarehousePage.itemKindOf).
    const itemDef = itemDefsById[item.itemId] || (siDefsById && siDefsById[item.itemId]);
    if (!itemDef) { const err = new Error('claimed item references an unknown content item id: ' + item.itemId); err.code = 'BAD_REQUEST'; throw err; }
  }

  // REQ-0215: validate the client's proposed spot BEFORE flipping the row.
  // Order matters -- a rejected claim must leave the row exactly 'claimable', so
  // a player whose inventory is full can simply free a cell and claim again
  // rather than waiting out a 120s lazy-revert on a row nothing ever moved.
  // Every kind goes through this (the user's spec item 4), which supersedes the
  // old "no space -> leave it 'claiming' and let it revert" posture: no space is
  // now an ERROR the caller sees, per spec item 2.
  const kind = item.kind === 'tm' ? 'tm'
    : item.kind === 'bp' ? 'bp'
    : (itemDefsById[item.itemId] ? 'po' : 'si');
  claimSpotOr409(item, kind, spot, canvas);

  item.status = 'claiming';
  item.claimedAt = new Date().toISOString();
  storage.writeWarehouseItem(playerId, itemUid, item);

  // The spot is echoed back so the client places at EXACTLY what was validated
  // rather than re-running its own search against a board that may have moved.
  return { itemUid, itemId: item.itemId, kind: item.kind, qty: item.qty, q: item.q, bp: item.bp, page: spot.page, position: spot.position };
}

// finalizeClaimingItemsForCanvas (REQ-0041): called by server/api.cjs's
// profile PUT handler AFTER a successful storage.writeProfile() (i.e.
// once the client's own auto-save has actually landed). Deletes every
// one of `playerId`'s CURRENTLY 'claiming' warehouse rows whose itemUid
// now appears anywhere in the just-saved `canvas` -- the client mints the
// claimed item's on-canvas uid by REUSING the warehouse row's own
// itemUid (see claimWarehouseItem's doc above), so this is an exact,
// unambiguous uid-membership scan, not a fuzzy itemId-based heuristic.
// Scans the active squad's top-level fields, every inactive squad's
// store[] snapshot, AND every inventory page (a claimed item's HOME
// always lands in st.inv per the reference model, REQ-0033, regardless
// of whether any squad happens to reference it yet) -- covers a PO's
// `pos[].uid`, a BP's `bps[].id`, and an SI's `sis[].uid` (a claimed
// warehouse item is always a PO or SI in practice -- see the REQ-0041
// outcome doc's note on why BPs are never claimable content -- but this
// scan checks all three arrays uniformly for robustness, matching
// engine.js's own squadUidSet()-style scans elsewhere in this file).
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
  collectFrom(canvas); // active squad's top-level fields
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
// detection/unlock-capable squad; unboundedly longer -- e.g. 999s -- for a
// squad that never clears a detection-mode encounter at all, per this
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
  claimSpotOr409, // REQ-0215
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
