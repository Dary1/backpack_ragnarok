// backpack_ragnarok -- server/services/market/trade.cjs
// REQ-0145a (sd): THE atomic settlement (buyListing + its canvas write
// helpers + the receipt) extracted verbatim from the pre-split
// services/market.cjs (origin lines 497-696 @ commit 6eafed8). See the
// services/market.cjs facade header for the rule-5 divergence writeup.
'use strict';
const storage = require('../../storage.cjs');
const { WAREHOUSE_CAP, WAREHOUSE_TTL_MS, genId } = require('../core.cjs');
const { purgeExpiredWarehouseItems, addToWarehouse } = require('../warehouse.cjs');
const { deployedUidSet } = require('../squads.cjs');
const { burnOf, findInventoryPO, findInventorySI, findInventoryBP, readTmBalance, DEX_PRICE_HISTORY_MAX } = require('./lib.cjs');
const { normalizeListing, autoWithdrawItemGone } = require('./listings.cjs');

// stripPoFromCanvas: removes every pos[] entry with `uid` from the
// canvas -- inventory pages, the active squad's top-level pos[], and
// every stored squad snapshot (squads that merely REFERENCE the
// inventory-homed item; eligibility already guarantees none of them is
// deployed, but a stale un-deployed reference must not survive as a
// ghost). Same containers finalizeClaimingItemsForCanvas scans.
function stripPoFromCanvas(canvas, uid) {
  const strip = (container) => {
    if (!container) return;
    if (Array.isArray(container.pos)) {
      container.pos = container.pos.filter((p) => p.uid !== uid);
    }
    // REQ-0195c: a SURVIVING SI seated on the SOLD PO is re-homed to 'inv'
    // (the stowed sentinel) rather than keeping an orphaned host ref --
    // mirrors devotion.cjs stripDestroyedUids + engine unseatOrphans.
    if (Array.isArray(container.sis)) {
      for (const a of container.sis) {
        if (a.host && typeof a.host === 'object' && a.host.po === uid) a.host = 'inv';
      }
    }
  };
  strip(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg);
  }
}

// stripSiFromCanvas (REQ-0195c): removes every sis[] entry with `uid`
// from the canvas -- inventory pages (the SI home), the active squad's
// top-level sis[], and every stored squad snapshot. Same containers as
// stripPoFromCanvas / finalizeClaimingItemsForCanvas.
function stripSiFromCanvas(canvas, uid) {
  const strip = (container) => {
    if (container && Array.isArray(container.sis)) {
      container.sis = container.sis.filter((a) => a.uid !== uid);
    }
  };
  strip(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg);
  }
}

// stripBpFromCanvas (REQ-0195d): removes every bps[] entry with `id`
// (a BP keys on `id`) from the canvas -- inventory pages, the active
// squad's top-level bps[], and every stored squad snapshot.
function stripBpFromCanvas(canvas, uid) {
  const strip = (container) => {
    if (container && Array.isArray(container.bps)) {
      container.bps = container.bps.filter((b) => b.id !== uid);
    }
  };
  strip(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg);
  }
}

// debitTmFromCanvas: drains `qty` off the canvas's same-id TM stacks
// (inventory pages, in page order), deleting emptied stacks. Caller has
// already verified the total balance covers qty; throws (settle bug,
// never a user error) if it somehow cannot drain fully.
function debitTmFromCanvas(canvas, tmId, qty) {
  let remaining = qty;
  for (const pg of canvas.inv.pages) {
    if (!pg || !Array.isArray(pg.tms)) continue;
    for (const tm of pg.tms) {
      if (remaining <= 0) break;
      if (tm.id !== tmId) continue;
      const take = Math.min(Number(tm.qty) || 0, remaining);
      tm.qty = (Number(tm.qty) || 0) - take;
      remaining -= take;
    }
    pg.tms = pg.tms.filter((t) => t.id !== tmId || (Number(t.qty) || 0) > 0);
  }
  if (remaining > 0) throw new Error('debitTmFromCanvas: balance changed mid-settle (short by ' + remaining + ')');
}

// buyListing(buyerId, listingId, idemKey): POST .../buy -- THE atomic
// settlement (the only moment the furnace burns). Validation order:
//   404  unknown listing id
//   409  already_settled | not_active | expired  (state machine; an
//        Idempotency-Key replay by the SAME buyer of the SAME settled
//        trade returns the original receipt instead)
//   409  self_buy (your own cards render with buying closed)
//   409  item_gone (item vanished from the seller's inventory -- the
//        listing auto-withdraws right here, lazily)
//   409  suspended (Law of Possession: seller currently deploys it)
//   409  insufficient_balance (buyer's saved canvas holds < qty lrdst)
//   409  warehouse_full (buyer needs one free warehouse slot for the
//        item; checked BEFORE anything mutates -- no partial settle)
// then, in one synchronous pass (single-threaded; first write = the
// first-wins commit point):
//   1. listing -> settled (+receipt)          [concurrent buy now 409s]
//   2. buyer canvas: -qty lrdst               [rule-5 divergence, doc'd]
//   3. seller canvas: item removed everywhere [rule-5 divergence, doc'd]
//   4. buyer warehouse: claimable item row (fresh uid, sourceListingId)
//   5. seller warehouse: kind:'tm' proceeds row, qty-burn (grantTmQty
//      shape; CAP-EXEMPT -- see below)
//   6. furnace ledger: append-only {amount: burn, listingId, t}
//   7. dex price history: rolling last-DEX_PRICE_HISTORY_MAX for itemId
// Files mode has no cross-root transaction; each write is individually
// atomic and the sequence is ordered so a (process-death) truncation
// can only UNDER-deliver, never duplicate value -- the same
// non-transactional posture services/runs.cjs's settleRun already
// accepts across its run/room/warehouse roots.
function buyListing(buyerId, listingId, idemKey) {
  const listing = storage.readMarketListing(listingId);
  if (!listing) { const err = new Error('listing not found'); err.code = 'NOT_FOUND'; throw err; }
  const now = Date.now();
  normalizeListing(listing, now);
  if (listing.state === 'settled') {
    if (idemKey && listing.settlement && listing.settlement.idemKey === idemKey && listing.settlement.buyerId === buyerId) {
      return { listing, receipt: receiptOf(listing), replayed: true };
    }
    const err = new Error('listing already settled'); err.code = 'CONFLICT'; err.reason = 'already_settled'; throw err;
  }
  if (listing.state === 'expired') {
    const err = new Error('listing expired (7-day shelf life)'); err.code = 'CONFLICT'; err.reason = 'expired'; throw err;
  }
  if (listing.state !== 'active') {
    const err = new Error('listing is not active (state: ' + listing.state + ')'); err.code = 'CONFLICT'; err.reason = 'not_active'; throw err;
  }
  if (listing.sellerId === buyerId) {
    const err = new Error('you cannot buy your own listing'); err.code = 'CONFLICT'; err.reason = 'self_buy'; throw err;
  }

  // Seller-side eligibility, re-derived NOW (lazy, never trusted stale).
  const kind = listing.kind || 'po';
  const sellerDoc = storage.readProfile(listing.sellerId);
  const sellerCanvas = sellerDoc ? sellerDoc.canvas : null;
  let sellerInst = null;
  let sellerBp = null;
  if (kind === 'tm') {
    // REQ-0195b: tm stock is the live balance; a shortfall is a
    // (reversible) SUSPENSION re-check, never an item-gone auto-withdraw.
    const stock = sellerCanvas ? readTmBalance(sellerCanvas, listing.itemId) : 0;
    if (stock < listing.tmQty) {
      const err = new Error('listing suspended: the seller holds ' + stock + ' ' + String(listing.itemId).toUpperCase() + ', needs ' + listing.tmQty); err.code = 'CONFLICT'; err.reason = 'suspended'; throw err;
    }
  } else if (kind === 'unit') {
    const b = sellerCanvas ? findInventoryBP(sellerCanvas, listing.itemUid) : null;
    if (!sellerCanvas || !b) {
      autoWithdrawItemGone(listing, now);
      const err = new Error('the listed unit no longer exists; listing withdrawn'); err.code = 'CONFLICT'; err.reason = 'item_gone'; throw err;
    }
    if (deployedUidSet(listing.sellerId, sellerCanvas).has(listing.itemUid)) {
      const err = new Error('listing suspended: the seller currently deploys this unit (the Law of Possession)'); err.code = 'CONFLICT'; err.reason = 'suspended'; throw err;
    }
    sellerBp = b.bp;
  } else {
    sellerInst = sellerCanvas ? (kind === 'si' ? findInventorySI(sellerCanvas, listing.itemUid) : findInventoryPO(sellerCanvas, listing.itemUid)) : null;
    if (!sellerCanvas || !sellerInst) {
      autoWithdrawItemGone(listing, now);
      const err = new Error('the listed item no longer exists; listing withdrawn'); err.code = 'CONFLICT'; err.reason = 'item_gone'; throw err;
    }
    if (deployedUidSet(listing.sellerId, sellerCanvas).has(listing.itemUid)) {
      const err = new Error('listing suspended: the seller currently deploys this item (the Law of Possession)'); err.code = 'CONFLICT'; err.reason = 'suspended'; throw err;
    }
  }

  // Buyer-side funds + capacity, all BEFORE the commit point.
  const qty = listing.price.qty;
  const buyerDoc = storage.readProfile(buyerId);
  const buyerCanvas = buyerDoc ? buyerDoc.canvas : null;
  const balance = readTmBalance(buyerCanvas, listing.price.tm);
  if (balance < qty) {
    const err = new Error('insufficient ' + listing.price.tm.toUpperCase() + ' balance: have ' + balance + ', need ' + qty); err.code = 'CONFLICT'; err.reason = 'insufficient_balance'; throw err;
  }
  const buyerWarehouse = purgeExpiredWarehouseItems(buyerId);
  if (buyerWarehouse.length >= WAREHOUSE_CAP) {
    const err = new Error('your warehouse is full (' + WAREHOUSE_CAP + ' items); no partial settle'); err.code = 'CONFLICT'; err.reason = 'warehouse_full'; throw err;
  }

  const burn = burnOf(qty);
  const sellerReceives = qty - burn;
  const tIso = new Date(now).toISOString();

  // ---- COMMIT POINT (1/7): first-wins. A concurrent buy of the same
  // listing now reads state 'settled' and 409s (the whole function is
  // synchronous, so "concurrent" requests are strictly serialized by
  // the event loop -- there is no interleaving window at all).
  listing.state = 'settled';
  listing.settlement = { buyerId, t: tIso, burn, sellerReceives, idemKey: idemKey || null };
  storage.writeMarketListing(listing.id, listing);

  // (2/7) debit buyer -- value leaves the economy first.
  debitTmFromCanvas(buyerCanvas, listing.price.tm, qty);
  storage.writeProfile(buyerId, buyerCanvas);

  // (3/7) remove the sold value from the seller (kind-branched: strip the
  // PO instance everywhere, or debit tmQty off the seller's TM stacks).
  if (kind === 'tm') {
    debitTmFromCanvas(sellerCanvas, listing.itemId, listing.tmQty);
  } else if (kind === 'si') {
    stripSiFromCanvas(sellerCanvas, listing.itemUid);
  } else if (kind === 'unit') {
    stripBpFromCanvas(sellerCanvas, listing.itemUid);
  } else {
    stripPoFromCanvas(sellerCanvas, listing.itemUid); // also re-homes SIs seated on the sold PO (REQ-0195c)
  }
  storage.writeProfile(listing.sellerId, sellerCanvas);

  // (4/7) deliver the item to the buyer's WAREHOUSE as a normal
  // claimable row -- the buyer places it via the standard two-phase
  // warehouse claim, exactly like a dungeon reward. Fresh uid
  // (grantWarehouseItem convention); cap was pre-checked synchronously
  // above, so addToWarehouse cannot refuse here.
  // A bought TM arrives as a kind:'tm' stack row (grantTmQty shape, merged
  // on claim via firstFitOrMergeTM); a PO/SI as a plain row carrying its q.
  const itemRow = kind === 'tm'
    ? {
        itemUid: genId('wh'), playerId: buyerId, itemId: listing.itemId, qty: listing.tmQty,
        kind: 'tm',
        harvestedAt: tIso, expiresAt: new Date(now + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: null, sourceRunId: null, sourceListingId: listing.id,
        status: 'claimable',
      }
    : kind === 'unit'
    ? {
        itemUid: genId('wh'), playerId: buyerId, itemId: listing.itemId,
        kind: 'bp',
        bp: JSON.parse(JSON.stringify(sellerBp)), // REQ-0195d: full BP instance, verbatim (never re-rolled)
        harvestedAt: tIso, expiresAt: new Date(now + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: null, sourceRunId: null, sourceListingId: listing.id,
        status: 'claimable',
      }
    : {
        itemUid: genId('wh'), playerId: buyerId, itemId: listing.itemId,
        q: sellerInst.q, // REQ-0063: the SAME instance's quality roll travels with it, not re-rolled
        harvestedAt: tIso, expiresAt: new Date(now + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: null, sourceRunId: null, sourceListingId: listing.id,
        status: 'claimable',
      };
  const delivered = addToWarehouse(buyerId, itemRow);
  if (!delivered.ok) throw new Error('market settle: buyer warehouse refused delivery after pre-check (' + delivered.reason + ') -- this is a bug');

  // (5/7) seller proceeds as a kind:'tm' warehouse row (services/
  // warehouse.cjs grantTmQty shape, claimed via the normal warehouse
  // UI). CAP-EXEMPT deliberately: addToWarehouse's documented overflow
  // posture (silently drop) is fine for a re-earnable dungeon reward but
  // NOT for another player's money -- a full seller warehouse must never
  // vaporize settled proceeds, so this one row is written straight
  // through the storage chokepoint even at/over the 200 cap. A price of
  // 1 burns whole (burn floor: max(1, ...) -> sellerReceives 0); no
  // zero-qty TM row is written for it -- the receipt still records the
  // 0 honestly.
  const proceedsRow = {
    itemUid: genId('wh'), playerId: listing.sellerId, itemId: listing.price.tm, qty: sellerReceives,
    kind: 'tm',
    harvestedAt: tIso, expiresAt: new Date(now + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null, sourceListingId: listing.id,
    status: 'claimable',
  };
  if (sellerReceives > 0) storage.writeWarehouseItem(listing.sellerId, proceedsRow.itemUid, proceedsRow);

  // (6/7) the furnace ledger -- append-only, the burn's only record.
  storage.writeMarketFurnaceEntry({
    id: genId('furn'), amount: burn, tm: listing.price.tm, listingId: listing.id, t: tIso,
  });

  // (7/7) engrave the Dex price history (rolling last-5 settled per
  // itemId, newest first) -- the market's price anchor ("the dex is the
  // anchor of the market rate", sell-pane copy). Storage-side only for
  // now; the full REQ-0052 dex-card integration consumes this same root
  // later.
  const hist = storage.readMarketDexHistory(listing.itemId) || { itemId: listing.itemId, entries: [] };
  hist.entries.unshift({ qty, tm: listing.price.tm, t: tIso, listingId: listing.id });
  hist.entries = hist.entries.slice(0, DEX_PRICE_HISTORY_MAX);
  storage.writeMarketDexHistory(listing.itemId, hist);

  return { listing, receipt: receiptOf(listing), replayed: false };
}

function receiptOf(listing) {
  const s = listing.settlement;
  return {
    listingId: listing.id,
    itemId: listing.itemId,
    buyerId: s.buyerId,
    price: { tm: listing.price.tm, qty: listing.price.qty },
    burn: s.burn,
    sellerReceives: s.sellerReceives,
    settledAt: s.t,
  };
}

module.exports = {
  buyListing,
};
