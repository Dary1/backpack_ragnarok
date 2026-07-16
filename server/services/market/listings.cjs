// backpack_ragnarok -- server/services/market/listings.cjs
// REQ-0145a (sd): the listing state machine + seller-side mutations
// (create / withdraw / dev-clear) extracted verbatim from the pre-split
// services/market.cjs (origin lines 171-202, 364-495 @ commit 6eafed8).
'use strict';
const storage = require('../../storage.cjs');
const { getScheduleContent, genId } = require('../core.cjs');
const { deployedUidSet } = require('../squads.cjs');
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
    storage.writeMarketListing(raw.id, raw);
    cleared += 1;
  }
  return cleared;
}

module.exports = {
  normalizeListing,
  autoWithdrawItemGone,
  createListing,
  getOwnListingOr404,
  withdrawListing,
  devClearAllListings,
};
