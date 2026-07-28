// backpack_ragnarok -- server/services/market/listings.cjs
// REQ-0145a (sd): the listing state machine + seller-side mutations
// (create / withdraw / dev-clear) extracted verbatim from the pre-split
// services/market.cjs (origin lines 171-202, 364-495 @ commit 6eafed8).
'use strict';
const storage = require('../../storage.cjs');
const { getScheduleContent, genId, WAREHOUSE_TTL_MS } = require('../core.cjs');
const { deployedUidSet, referencedUidSet } = require('../squads.cjs');
const {
  MARKET_TM_ID, MARKET_PRICE_MIN, MARKET_PRICE_MAX, MARKET_LISTING_TTL_MS,
  findInventoryPO, findInventorySI, findInventoryBP, bpHasContents, isLiveTm,
} = require('./lib.cjs');

// ---------------------------------------------------------------------
// Listing state machine. STORED state: 'active' -> 'settled' |
// 'withdrawn' | 'expired' (terminal). 'suspended' is NEVER stored -- it
// is derived at read time (item deployed while the stored state is
// still 'active') and reverts by itself when the deploy ends.
// ---------------------------------------------------------------------

// normalizeListing: lazy TTL expiry, the market's analogue of
// normalizeWarehouseStatus -- an 'active' listing past its expiresAt
// flips to 'expired' and is persisted immediately so every concurrent
// reader converges. No penalty; relisting is a fresh listing. Returns
// the (possibly mutated + re-persisted) listing.
function normalizeListing(listing, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  // REQ-0195a: legacy listings predate the `kind` field; they can only
  // be POs. Default in-memory so every read path converges (persisted on
  // the next write the doc takes, e.g. a state transition below).
  if (!listing.kind) listing.kind = 'po';
  if (listing.state === 'active' && Date.parse(listing.expiresAt) <= now) {
    listing.state = 'expired';
    listing.expiredAt = new Date(now).toISOString();
    // REQ-0328: a warehouse-sourced listing escrows its item ON the listing,
    // so expiry must hand the item back to the SELLER's warehouse (never
    // silently lost) -- same invariant a canvas-sourced listing gets for
    // free (its item never left the seller's canvas).
    if (listing.source === 'warehouse') returnEscrowToWarehouse(listing, now);
    storage.writeMarketListing(listing.id, listing);
  }
  return listing;
}

// autoWithdrawItemGone: the listed item no longer exists in the seller's
// inventory (consumed / vanished) -> the listing self-withdraws (spec:
// "item consumed/vanished -> auto-withdraw"; free, no burn). Persisted
// so every reader converges, same as normalizeListing.
function autoWithdrawItemGone(listing, nowMs) {
  listing.state = 'withdrawn';
  listing.withdrawal = { t: new Date(nowMs != null ? nowMs : Date.now()).toISOString(), reason: 'item_gone', idemKey: null };
  storage.writeMarketListing(listing.id, listing);
  return listing;
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

// createListing(sellerId, body, canvas, idemKey): POST /api/market/
// listings. Listing is FREE (law 2 burns only on settlement). Validates
// ownership + eligibility against the seller's LAST-SAVED canvas:
//   - itemUid must be one of the seller's own INVENTORY POs. A uid that
//     is not (including any other player's uid -- we only ever look at
//     the caller's own canvas) is a plain 404, indistinguishable from a
//     typo: the no-leak convention (same posture as getOwnRoomOr404).
//   - the item must not be deployed (Law of Possession) -> 409
//     {reason:'deployed'}.
//   - one live listing per item instance: an existing active listing by
//     this seller for the same itemUid -> 409 {reason:'already_listed'}.
//   - price: {tm: MARKET_TM_ID, qty: integer in [1,999]} -> else 400.
// Idempotency: no house-wide Idempotency-Key pattern exists (REQ-0036/
// 0041/0042 mutations are state-machine-idempotent instead), so market
// adds a minimal one: an optional Idempotency-Key header stored on the
// doc; re-POSTing the same (seller, key) returns the original listing
// instead of double-listing. See routes/market.cjs.
function createListing(sellerId, body, canvas, idemKey) {
  if (idemKey) {
    for (const raw of storage.listMarketListings()) {
      if (raw.sellerId === sellerId && raw.idemKey === idemKey) {
        return { listing: normalizeListing(raw, Date.now()), replayed: true };
      }
    }
  }
  // REQ-0195a/b: `kind` selects the tradeable content kind (absent -> 'po').
  // tm listings (currency-for-currency) have no itemUid and branch before
  // the PO-specific inventory checks; si/unit arrive in REQ-0195c-d.
  const kind = (body && typeof body.kind === 'string' && body.kind) ? body.kind : 'po';
  if (kind !== 'po' && kind !== 'tm' && kind !== 'si' && kind !== 'unit') {
    const err = new Error('unsupported listing kind: ' + kind); err.code = 'BAD_REQUEST'; throw err;
  }
  const price = body && body.price;
  if (!price || typeof price.tm !== 'string' || !isLiveTm(price.tm)) {
    const err = new Error('price.tm must be a live TM registry id (content/live/live_tms.json)'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (!Number.isInteger(price.qty) || price.qty < MARKET_PRICE_MIN || price.qty > MARKET_PRICE_MAX) {
    const err = new Error('price.qty must be an integer between ' + MARKET_PRICE_MIN + ' and ' + MARKET_PRICE_MAX); err.code = 'BAD_REQUEST'; throw err;
  }
  if (kind === 'tm') return createTmListing(sellerId, body, price, idemKey);
  // ---- kind 'po' | 'si' | 'unit' (inventory instance path; all have itemUid) ----
  if (typeof body.itemUid !== 'string' || !body.itemUid) {
    const err = new Error('itemUid is required'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (kind === 'unit') return createUnitListing(sellerId, body, price, canvas, idemKey);
  const { itemDefsById, siDefsById } = getScheduleContent();
  const entry = kind === 'si' ? findInventorySI(canvas, body.itemUid) : findInventoryPO(canvas, body.itemUid);
  if (!entry) {
    const err = new Error('item not found in your inventory'); err.code = 'NOT_FOUND'; throw err;
  }
  const defOk = kind === 'si' ? !!siDefsById[entry.id] : !!itemDefsById[entry.id];
  if (!defOk) {
    const err = new Error('item references an unknown content id: ' + entry.id); err.code = 'BAD_REQUEST'; throw err;
  }
  if (deployedUidSet(sellerId, canvas).has(body.itemUid)) {
    const err = new Error('deployed items cannot go to market (the Law of Possession)'); err.code = 'CONFLICT'; err.reason = 'deployed'; throw err;
  }
  // REQ-0198 (C): a board-/preset-REFERENCED instance is "in use, not in
  // my inventory" -- ineligible even when no ROOM deploys it. Checked
  // AFTER deployed (deployedUidSet is a strict subset), so the room case
  // keeps its own 'deployed' reason and this narrower-copy 'in_use' reason
  // covers a plain board placement or a saved squad-preset reference.
  if (referencedUidSet(canvas).has(body.itemUid)) {
    const err = new Error('this item is in use (placed on the board or held by a squad) and cannot go to market'); err.code = 'CONFLICT'; err.reason = 'in_use'; throw err;
  }
  const now = Date.now();
  for (const raw of storage.listMarketListings()) {
    if (raw.sellerId !== sellerId || raw.itemUid !== body.itemUid) continue;
    if (normalizeListing(raw, now).state === 'active') {
      const err = new Error('this item is already listed'); err.code = 'CONFLICT'; err.reason = 'already_listed'; throw err;
    }
  }
  const listing = {
    id: genId('mkt'),
    sellerId,
    kind,
    itemUid: body.itemUid,
    itemId: entry.id,
    price: { tm: price.tm, qty: price.qty },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MARKET_LISTING_TTL_MS).toISOString(),
    state: 'active',
    idemKey: idemKey || null,
  };
  storage.writeMarketListing(listing.id, listing);
  return { listing, replayed: false };
}

// createTmListing (REQ-0195b): currency-for-currency listing. No uid --
// the "stock" is the seller's live balance of `itemId` (a live TM), and a
// short balance derives SUSPENSION (never auto-withdraw; balances refill).
// price.tm must be a DIFFERENT live TM than the one sold (same_tm 400,
// user ruling 2026-07-16). Multiple concurrent tm listings by one seller
// are legal -- each is balance-checked independently, so there is no
// already_listed dup gate (that is a per-instance-uid rule; tm has no uid).
function createTmListing(sellerId, body, price, idemKey) {
  const itemId = body.itemId;
  if (typeof itemId !== 'string' || !isLiveTm(itemId)) {
    const err = new Error('itemId must be a live TM registry id for a tm listing'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (price.tm === itemId) {
    const err = new Error('a TM cannot be priced in itself'); err.code = 'BAD_REQUEST'; err.reason = 'same_tm'; throw err;
  }
  const tmQty = body.tmQty;
  if (!Number.isInteger(tmQty) || tmQty < MARKET_PRICE_MIN || tmQty > MARKET_PRICE_MAX) {
    const err = new Error('tmQty must be an integer between ' + MARKET_PRICE_MIN + ' and ' + MARKET_PRICE_MAX); err.code = 'BAD_REQUEST'; throw err;
  }
  const now = Date.now();
  const listing = {
    id: genId('mkt'),
    sellerId,
    kind: 'tm',
    itemUid: null,
    itemId,
    tmQty,
    price: { tm: price.tm, qty: price.qty },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MARKET_LISTING_TTL_MS).toISOString(),
    state: 'active',
    idemKey: idemKey || null,
  };
  storage.writeMarketListing(listing.id, listing);
  return { listing, replayed: false };
}

// createUnitListing (REQ-0195d): list an EMPTY inventory BP (unit). No
// nested pos[]/sis[] may sit in the BP's footprint (nested content does
// not travel -> 409 {reason:'not_empty'}); the BP's unit.id must be a
// live unit def; deployed -> 409 {reason:'deployed'}; one live listing
// per BP uid (already_listed).
function createUnitListing(sellerId, body, price, canvas, idemKey) {
  const found = findInventoryBP(canvas, body.itemUid);
  if (!found) {
    const err = new Error('unit (BP) not found in your inventory'); err.code = 'NOT_FOUND'; throw err;
  }
  const { bp, page } = found;
  const { unitDefsById } = getScheduleContent();
  const unitId = bp.unit && bp.unit.id;
  if (!unitId || !unitDefsById[unitId]) {
    const err = new Error('BP references an unknown unit id: ' + unitId); err.code = 'BAD_REQUEST'; throw err;
  }
  if (bpHasContents(page, bp)) {
    const err = new Error('the BP is not empty -- nested items do not travel; empty it first'); err.code = 'CONFLICT'; err.reason = 'not_empty'; throw err;
  }
  if (deployedUidSet(sellerId, canvas).has(body.itemUid)) {
    const err = new Error('deployed units cannot go to market (the Law of Possession)'); err.code = 'CONFLICT'; err.reason = 'deployed'; throw err;
  }
  // REQ-0198 (C): same in_use gate as the po/si path -- a BP referenced by
  // the active board or any squad preset is in use, not sellable.
  if (referencedUidSet(canvas).has(body.itemUid)) {
    const err = new Error('this unit is in use (placed on the board or held by a squad) and cannot go to market'); err.code = 'CONFLICT'; err.reason = 'in_use'; throw err;
  }
  const now = Date.now();
  for (const raw of storage.listMarketListings()) {
    if (raw.sellerId !== sellerId || raw.itemUid !== body.itemUid) continue;
    if (normalizeListing(raw, now).state === 'active') {
      const err = new Error('this unit is already listed'); err.code = 'CONFLICT'; err.reason = 'already_listed'; throw err;
    }
  }
  const listing = {
    id: genId('mkt'), sellerId, kind: 'unit', itemUid: body.itemUid, itemId: unitId,
    price: { tm: price.tm, qty: price.qty },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MARKET_LISTING_TTL_MS).toISOString(),
    state: 'active', idemKey: idemKey || null,
  };
  storage.writeMarketListing(listing.id, listing);
  return { listing, replayed: false };
}

// createListingFromWarehouse (REQ-0328): POST /api/market/listings/from-
// warehouse {warehouseRowId, price}. The DIRECT warehouse->market path --
// a CLAIMABLE warehouse row (an unclaimed dungeon drop / market delivery)
// becomes an active listing WITHOUT ever routing through the seller's
// canvas/inventory. Contrast createListing above, whose provenance is a
// canvas cell the item keeps LIVING IN while listed: here the item is
// ESCROWED on the listing itself. The warehouse row is consumed (deleted)
// here; its content travels on the listing (kind/itemId + q for a po/si,
// bp for a unit); settlement (trade.cjs) delivers it to the buyer's
// warehouse, and withdraw/expiry (returnEscrowToWarehouse below) hands it
// back to the seller's warehouse -- so the item is never silently lost.
// Reuses createListing's exact price validation + Idempotency-Key replay +
// 7-day TTL; reuses warehouse.cjs's peekClaimableRow for the row lookup.
// A tm/currency row is not a drop and has no direct-sell path (a tm
// listing needs a DIFFERENT price TM + tmQty -- see createTmListing), so it
// is rejected plainly (400 unsellable_kind) and the fleet (REQ-0330) simply
// skips currency rows.
function createListingFromWarehouse(sellerId, body, idemKey) {
  if (idemKey) {
    for (const raw of storage.listMarketListings()) {
      if (raw.sellerId === sellerId && raw.idemKey === idemKey) {
        return { listing: normalizeListing(raw, Date.now()), replayed: true };
      }
    }
  }
  const price = body && body.price;
  if (!price || typeof price.tm !== 'string' || !isLiveTm(price.tm)) {
    const err = new Error('price.tm must be a live TM registry id (content/live/live_tms.json)'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (!Number.isInteger(price.qty) || price.qty < MARKET_PRICE_MIN || price.qty > MARKET_PRICE_MAX) {
    const err = new Error('price.qty must be an integer between ' + MARKET_PRICE_MIN + ' and ' + MARKET_PRICE_MAX); err.code = 'BAD_REQUEST'; throw err;
  }
  const warehouseRowId = body && body.warehouseRowId;
  if (typeof warehouseRowId !== 'string' || !warehouseRowId) {
    const err = new Error('warehouseRowId is required'); err.code = 'BAD_REQUEST'; throw err;
  }
  const warehouse = require('../warehouse.cjs'); // lazy: avoids a load-time cycle
  // Peek + validate BEFORE consuming so a content/kind rejection never
  // deletes the row -- 404 (missing/expired) / 409 (being claimed).
  const row = warehouse.peekClaimableRow(sellerId, warehouseRowId);
  const { itemDefsById, siDefsById, unitDefsById } = getScheduleContent();
  let kind;
  let bp = null;
  if (row.kind === 'tm') {
    const err = new Error('a currency (TM) warehouse row cannot be direct-sold'); err.code = 'BAD_REQUEST'; err.reason = 'unsellable_kind'; throw err;
  } else if (row.kind === 'bp') {
    const unitId = row.bp && row.bp.unit && row.bp.unit.id;
    if (!unitId || !unitDefsById[unitId]) {
      const err = new Error('warehouse BP row references an unknown unit id: ' + unitId); err.code = 'BAD_REQUEST'; throw err;
    }
    kind = 'unit';
    bp = JSON.parse(JSON.stringify(row.bp)); // verbatim BP, never re-rolled (REQ-0195d shape)
  } else {
    // Plain po/si row -- disambiguate by content registry (same posture as
    // warehouse.cjs claimWarehouseItem's itemDefsById || siDefsById check).
    if (itemDefsById[row.itemId]) kind = 'po';
    else if (siDefsById[row.itemId]) kind = 'si';
    else { const err = new Error('warehouse row references an unknown content id: ' + row.itemId); err.code = 'BAD_REQUEST'; throw err; }
  }
  // Consume the row -- atomic first-wins. All validation has passed, so no
  // late failure can strand the item.
  storage.deleteWarehouseItem(sellerId, warehouseRowId);
  const now = Date.now();
  const listing = {
    id: genId('mkt'),
    sellerId,
    kind,
    source: 'warehouse', // REQ-0328: provenance is the warehouse row, not a canvas cell
    itemUid: row.itemUid, // the consumed row's uid, kept for display/dedup
    itemId: kind === 'unit' ? bp.unit.id : row.itemId,
    price: { tm: price.tm, qty: price.qty },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MARKET_LISTING_TTL_MS).toISOString(),
    state: 'active',
    idemKey: idemKey || null,
  };
  if (kind === 'unit') listing.bp = bp; // the escrowed BP instance
  else if (typeof row.q === 'number') listing.q = row.q; // escrowed instance quality (REQ-0063)
  storage.writeMarketListing(listing.id, listing);
  return { listing, replayed: false };
}

// returnEscrowToWarehouse (REQ-0328): a warehouse-sourced listing escrows
// its item ON the listing (createListingFromWarehouse). When such a listing
// leaves the market by WITHDRAWAL or EXPIRY (never by settlement -- that
// delivers to the BUYER), the item returns to the SELLER's warehouse as a
// fresh claimable row (fresh uid + fresh TTL; sourceListingId set for the
// market provenance chip). CAP-EXEMPT deliberately -- written straight
// through the storage chokepoint, bypassing addToWarehouse's 200-row cap
// refusal, exactly the reasoning trade.cjs documents for seller proceeds:
// a full warehouse must never vaporize an item the player still owns.
// Called once per listing, guarded by the terminal state transition that
// invokes it (active->withdrawn / active->expired each happen once).
function returnEscrowToWarehouse(listing, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const kind = listing.kind || 'po';
  const itemUid = genId('wh');
  const row = {
    itemUid, playerId: listing.sellerId, itemId: listing.itemId,
    harvestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + WAREHOUSE_TTL_MS).toISOString(),
    sourceRoomId: null, sourceRunId: null, sourceListingId: listing.id,
    status: 'claimable',
  };
  if (kind === 'unit') { row.kind = 'bp'; row.bp = JSON.parse(JSON.stringify(listing.bp)); }
  else if (typeof listing.q === 'number') row.q = listing.q;
  storage.writeWarehouseItem(listing.sellerId, itemUid, row);
  listing.returnedWhUid = itemUid; // provenance of the returned row
  return itemUid;
}

// getOwnListingOr404: no-leak ownership check, mirroring services/
// rooms.cjs's getOwnRoomOr404 -- a listing that exists but belongs to
// someone else answers with the SAME 404 as one that does not exist.
function getOwnListingOr404(listingId, callerId) {
  const listing = storage.readMarketListing(listingId);
  if (!listing || listing.sellerId !== callerId) {
    const err = new Error('listing not found'); err.code = 'NOT_FOUND'; throw err;
  }
  return listing;
}

// withdrawListing: owner-only (404 no-leak otherwise), FREE (no burn --
// law 2 / FROZEN copy). Allowed while the stored state is 'active'
// (including a derived-suspended listing -- pulling a suspended card off
// the shelf is fine); terminal states 409 {reason:'not_active'} except
// an Idempotency-Key replay of the SAME withdrawal, which returns the
// already-withdrawn listing again.
function withdrawListing(callerId, listingId, idemKey) {
  const listing = getOwnListingOr404(listingId, callerId);
  normalizeListing(listing, Date.now());
  if (listing.state === 'withdrawn' && idemKey && listing.withdrawal && listing.withdrawal.idemKey === idemKey) {
    return { listing, replayed: true };
  }
  if (listing.state !== 'active') {
    const err = new Error('listing is not active (state: ' + listing.state + ')'); err.code = 'CONFLICT'; err.reason = 'not_active'; throw err;
  }
  listing.state = 'withdrawn';
  listing.withdrawal = { t: new Date().toISOString(), reason: 'owner', idemKey: idemKey || null };
  // REQ-0328: warehouse-sourced -> return the escrowed item to the seller's
  // warehouse (a canvas-sourced withdrawal has nothing to return -- its item
  // stayed in the seller's inventory the whole time).
  if (listing.source === 'warehouse') returnEscrowToWarehouse(listing, Date.now());
  storage.writeMarketListing(listing.id, listing);
  return { listing, replayed: false };
}

// devClearAllListings (E2E hook, mirrors services/ragnarok.cjs's
// devClearEinherjarRecords shape): force-withdraws EVERY currently-active
// listing regardless of seller (real withdrawListing is owner-only, and
// this suite's sellers are freshly-minted random players every run, so
// there is no single owner token that could ever clear them all).
// Exists because nothing in market.spec.ts ever withdraws the listings
// it seeds (seedSellerListing creates, several tests never buy/withdraw
// what they created) -- every run of the suite permanently adds more
// active listings to the shared live market, and the exact-count
// assertions in tests like BUY: browse renders listing cards can only
// ever pass against a browse view with nothing ELSE already on the
// shelf. Same shape as autoWithdrawItemGone's mutate+persist, just
// unconditional and market-wide rather than gated on the item being
// gone. Gated to the dev_mode fallback caller only by the route handler
// (routes/market.cjs).
function devClearAllListings(nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  let cleared = 0;
  for (const raw of storage.listMarketListings()) {
    normalizeListing(raw, now);
    if (raw.state !== 'active') continue;
    raw.state = 'withdrawn';
    raw.withdrawal = { t: new Date(now).toISOString(), reason: 'e2e_dev_reset', idemKey: null };
    if (raw.source === 'warehouse') returnEscrowToWarehouse(raw, now); // REQ-0328: never lose an escrowed item
    storage.writeMarketListing(raw.id, raw);
    cleared += 1;
  }
  return cleared;
}

module.exports = {
  normalizeListing,
  autoWithdrawItemGone,
  createListing,
  createListingFromWarehouse,
  getOwnListingOr404,
  withdrawListing,
  devClearAllListings,
};
