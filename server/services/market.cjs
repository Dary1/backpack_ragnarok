'use strict';
// server/services/market.cjs -- REQ-0064: the player-to-player Market
// service (server side; the client screen is a separate, later squad that
// consumes the DTOs this module shapes -- see shared/dto.ts's ApiMarket*
// types). Business rules are frozen by the design mock
// web/redesign/market.html ("three laws" + copy deck, REQ-0065 embedded
// spec comments):
//
//   1. "Barter in kind" -- there is no abstract currency. A price is an
//      integer quantity of ONE Transmutator content item. The engine /
//      content id of that TM is `lrdst` (content/live/live_tms.json's
//      single entry, "UnitRandomDirectionShuffleTransmutator"; the
//      same id server/services/gacha.cjs's readLrdstBalance() already
//      sums for the Workshop). The mock renders it as the fehu rune;
//      the WIRE id stays lrdst everywhere.
//   2. "The furnace tithe" -- 8% of every SETTLED trade is burned:
//      burn = max(1, ceil(qty * 0.08)), byte-for-byte the mock's own
//      `const burnOf = q => Math.max(1, Math.ceil(q * 0.08))`
//      (web/redesign/market.html ~line 930; verified against every
//      rendered burn line: 46->4, 120->10, 12->1, 3->1, 1420->114).
//      The burn happens ONLY at settlement -- listing and withdrawal
//      are free (FROZEN copy: "withdrawal bears no penalty -- the
//      furnace burns only when a trade settles").
//   3. "No living prices" -- no market maker, no auction. Sellers carve
//      an integer price; the Dex records the last few settled prices as
//      the only anchor (see dex price history below).
//
// The listed item is NOT escrowed (mock: suspended cards): it stays in
// the seller's inventory while listed. Deploying it to a schedule room
// SUSPENDS the listing (unbuyable, still browsable); undeploying
// reverts it to active. Suspension is DERIVED LAZILY at read time from
// the seller's current deploy state (house style -- same lazy,
// poll-driven posture as services/runs.cjs's settleRoomIfDue and
// services/warehouse.cjs's normalizeWarehouseStatus; no scheduler,
// nothing persisted for it).
//
// Persistence: exclusively via server/storage.cjs's market roots
// (market_listings / market_furnace / market_dex_history; files + pg
// parity, server/migrations/004_market.sql). Every read/write below
// goes through that chokepoint, same as every other service.
//
// RULE-5 DIVERGENCE (deliberate, documented): docs/architecture.md rule
// 5 says "the client's auto-save PUT is the ONE profile writer" and
// grants use the two-phase warehouse pattern. Market SETTLEMENT is the
// one sanctioned exception: an atomic exchange between TWO players
// cannot be client-two-phased -- the seller's client may be offline at
// the moment a buyer buys, and the buyer's debit must land in the same
// synchronous transaction that flips the listing to settled (first-wins)
// or a malicious client could take delivery without paying. So
// buyListing() writes BOTH canvases server-side (buyer: TM debit;
// seller: item removal), synchronously, inside one settle. Deliveries
// still follow the house grant pattern: the ITEM reaches the buyer as a
// normal claimable WAREHOUSE row, and the seller's PROCEEDS arrive as a
// kind:'tm' warehouse row (services/warehouse.cjs's grantTmQty shape) --
// neither side's canvas ever GAINS anything server-side, each only
// loses exactly what the trade consumed. The whole settle runs
// synchronously on the single-threaded server (pg_sync's querySync
// blocks too), so two concurrent buys can never interleave mid-settle:
// the second request finds state==='settled' and 409s (first-wins).
// CLIENT GOTCHA (for the market screen squad): after a successful buy /
// after one of your listings settles, re-GET your profile before the
// next auto-save PUT -- a stale in-flight auto-save can resurrect the
// pre-trade canvas (the exact bug class REQ-0041 documented). Same
// known auto-save race posture, now applying to market settlement too.
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../storage.cjs');
const players = require('../players.cjs');
const { WAREHOUSE_CAP, WAREHOUSE_TTL_MS, getScheduleContent, genId } = require('./core.cjs');
const { squadCanvasOf, squadUidSet } = require('./squads.cjs');
const { purgeExpiredWarehouseItems, addToWarehouse } = require('./warehouse.cjs');

// Same repo-root resolution convention as services/core.cjs (computed at
// module load from os.homedir(); tests remap homedir + evict the module
// tree, so this rebinds exactly like core's own content paths do).
const ITEMS_PATH = path.join(os.homedir(), 'backpack_ragnarok', 'content', 'live', 'live_items.json');

// ---------------------------------------------------------------------
// Tunables ([TUNABLE] -- market-policy level, same posture as
// services/core.cjs's own tunables block).
// ---------------------------------------------------------------------
// The ONE trade TM (law 1). Engine/content id `lrdst` -- cited from
// content/live/live_tms.json (sole entry) and services/gacha.cjs's
// readLrdstBalance(). If a dedicated trade TM ships later, this constant
// (and the content) is the only place to touch.
const MARKET_TM_ID = 'lrdst';
const MARKET_BURN_RATE = 0.08; // law 2 -- the furnace tithe
const MARKET_PRICE_MIN = 1; // mock stepper: integer, min 1
const MARKET_PRICE_MAX = 999; // mock stepper: cap 999
const MARKET_LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // [TUNABLE] 7d shelf life, lazy expiry (mock: "counted out its seven days")
const DEX_PRICE_HISTORY_MAX = 5; // rolling last-5 settled prices per itemId (storage side; full REQ-0052 dex-card integration deferred)
const MARKET_DTO_VERSION = 1; // wire-shape version stamped on every /api/market response (shared/dto.ts ApiMarket*)

// burnOf: THE burn function (law 2). Byte-identical math to the mock's
// own burnOf (web/redesign/market.html ~line 930). Settlement-only --
// no other code path may ever burn.
function burnOf(qty) {
  return Math.max(1, Math.ceil(qty * MARKET_BURN_RATE));
}

// ---------------------------------------------------------------------
// Dex numbering (mock: "No.061" chips; q= search accepts a Dex No.).
// No dex-number registry exists in content yet (REQ-0052's dex cards
// are a later squad) -- v1 interpretation: dexNo = 1-based position of
// the item's entry in content/live/live_items.json's entries array (the
// exact order /api/content serves). Pilot-batch overlay items absent
// from live_items.json get dexNo null ("not in the dex yet").
// mtime-cached, mirroring services/core.cjs's getScheduleContent().
// ---------------------------------------------------------------------
let dexNoCache = null; // { mtime, byId }

function getDexNoById() {
  let mtime = null;
  try { mtime = fs.statSync(ITEMS_PATH).mtimeMs; } catch (e) { mtime = null; }
  if (dexNoCache && dexNoCache.mtime === mtime) return dexNoCache.byId;
  /** @type {Record<string, number>} */
  const byId = {};
  try {
    const doc = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
    (doc.entries || []).forEach((e, i) => { byId[e.id] = i + 1; });
  } catch (e) { /* no live items -> empty map; listings then carry dexNo null */ }
  dexNoCache = { mtime, byId };
  return byId;
}

// ---------------------------------------------------------------------
// Canvas helpers (read-only unless explicitly part of a settle write).
// ---------------------------------------------------------------------

// findInventoryPO: locates itemUid among the seller's INVENTORY pages'
// pos[] entries. v1 sells POs only: every listing card in the mock is a
// PO, and the buyer-side delivery is a plain warehouse row claimed via
// services/warehouse.cjs claimWarehouseItem. NOTE (REQ-0115): that claim
// path now also accepts SI ids (itemDefsById OR siDefsById), so an SI row
// IS claimable -- market still lists POs only as a v1 scope choice, not a
// claim-path limitation. BP listings remain a later squad.
// No "fixed starter PO" concept exists in the codebase today (grep for
// 'starter' across mock-src/engine.js, shared/engine.d.ts and
// server/services/ comes back empty), so there is no starter-item
// exclusion to enforce yet -- revisit when that concept ships.
function findInventoryPO(canvas, itemUid) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) return null;
  for (const pg of canvas.inv.pages) {
    for (const p of (pg && pg.pos) || []) {
      if (p.uid === itemUid) return p;
    }
  }
  return null;
}

// readTmBalance: sums qty across every same-id TM stack in the canvas's
// inventory pages. Generalized (tmId parameter) from services/
// gacha.cjs's readLrdstBalance() -- same "read the last-saved canvas"
// posture: no profile is ever mutated by a balance READ.
function readTmBalance(canvas, tmId) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) return 0;
  let total = 0;
  for (const pg of canvas.inv.pages) {
    for (const tm of (pg && pg.tms) || []) {
      if (tm.id === tmId) total += (Number(tm.qty) || 0);
    }
  }
  return total;
}

// deployedUidSet: every uid the player currently has "deployed" -- i.e.
// referenced by a squad assigned to any slot of any of their own
// schedule rooms whose status is 'open' or 'active' (an 'open' room
// with filled slots auto-starts its next run on the next poll --
// services/runs.cjs's maybeAutoStartNextRun -- so its squads are
// "standing ready for war" per the mock's own empty-state copy; only
// 'canceled' rooms release their uids). This is the market's Law of
// Possession gate and the lazy suspension source. Reuses services/
// squads.cjs's squadCanvasOf/squadUidSet -- the same uid-set scan the
// deploy gate itself uses (deployedUidSetsForGate).
function deployedUidSet(playerId, canvas) {
  const out = new Set();
  if (!canvas) return out;
  for (const room of storage.listRooms()) {
    if (room.ownerId !== playerId) continue;
    if (room.status !== 'open' && room.status !== 'active') continue;
    for (const slot of room.slots || []) {
      if (slot.squadIndex == null) continue;
      for (const uid of squadUidSet(squadCanvasOf(canvas, slot.squadIndex))) out.add(uid);
    }
  }
  return out;
}

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

// sellerViewContext: one seller's canvas + deployed-uid set, loaded ONCE
// per (request, seller) -- listListings groups by seller, so a browse
// over N listings from K sellers costs K profile reads + one
// listRooms() scan, comfortably cheap at this project's scale (same
// perf posture services/warehouse.cjs documents for its own full
// scans). readProfile can only throw for an id with no registry entry;
// sellers are always registered players, so no BAD_PROFILE_ID handling
// is needed here.
function sellerViewContext(sellerId) {
  const doc = storage.readProfile(sellerId);
  const canvas = doc ? doc.canvas : null;
  return { canvas, deployed: deployedUidSet(sellerId, canvas) };
}

// deriveView: classifies one ALREADY-normalized listing against its
// seller's context. Returns { state, suspended } where `state` is the
// DTO-facing state ('suspended' overlays a stored 'active') -- or
// mutates + persists the listing when the item is simply gone.
function deriveView(listing, ctx, nowMs) {
  if (listing.state !== 'active') return { state: listing.state, suspended: false };
  if (!ctx.canvas || !findInventoryPO(ctx.canvas, listing.itemUid)) {
    autoWithdrawItemGone(listing, nowMs);
    return { state: 'withdrawn', suspended: false };
  }
  if (ctx.deployed.has(listing.itemUid)) return { state: 'suspended', suspended: true };
  return { state: 'active', suspended: false };
}

// ---------------------------------------------------------------------
// DTO assembly (wire shapes: shared/dto.ts ApiMarketListing et al;
// dtoVersion MARKET_DTO_VERSION on every response envelope).
// ---------------------------------------------------------------------

function priceHistoryFor(itemId, cache) {
  if (cache && cache.has(itemId)) return cache.get(itemId);
  const doc = storage.readMarketDexHistory(itemId);
  const entries = (doc && Array.isArray(doc.entries) ? doc.entries : []).map((e) => ({ qty: e.qty, t: e.t }));
  if (cache) cache.set(itemId, entries);
  return entries;
}

function sellerNameOf(sellerId, cache) {
  if (cache && cache.has(sellerId)) return cache.get(sellerId);
  const rec = players.readPlayer(sellerId);
  const name = rec ? rec.name : sellerId;
  if (cache) cache.set(sellerId, name);
  return name;
}

function toListingDto(listing, view, caches) {
  const { itemDefsById } = getScheduleContent();
  const def = itemDefsById[listing.itemId] || null;
  const ja = def && def.i18n && def.i18n.ja;
  const dexNo = getDexNoById()[listing.itemId];
  const qty = listing.price.qty;
  const burn = burnOf(qty);
  /** @type {any} */
  const dto = {
    id: listing.id,
    sellerId: listing.sellerId,
    sellerName: sellerNameOf(listing.sellerId, caches && caches.names),
    itemUid: listing.itemUid,
    itemId: listing.itemId,
    itemName: def ? def.name : listing.itemId,
    itemNameJa: (ja && ja.name) || (def && def.name_ja) || null,
    rarity: def ? (def.rarity || null) : null,
    tags: def ? (def.tags || []) : [],
    dexNo: dexNo != null ? dexNo : null,
    price: { tm: listing.price.tm, qty },
    burn,
    sellerReceives: qty - burn,
    createdAt: listing.createdAt,
    expiresAt: listing.expiresAt,
    state: view.state,
    suspended: view.suspended,
    priceHistory: priceHistoryFor(listing.itemId, caches && caches.history),
  };
  if (listing.settlement) {
    dto.settledAt = listing.settlement.t;
    dto.buyerId = listing.settlement.buyerId;
  }
  if (listing.withdrawal) {
    dto.withdrawnAt = listing.withdrawal.t;
    dto.withdrawnReason = listing.withdrawal.reason;
  }
  if (listing.expiredAt) dto.expiredAt = listing.expiredAt;
  return dto;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

// matchesFilter: tag-driven, per the mock's chip row (all / weapons /
// frost / ember / unit / relic -- chips map to content vocabulary
// values client-side). A filter value matches an item def when it
// equals (case-insensitively) any of the def's tags[] OR its rarity.
// Empty/absent/'all' = no filter.
function matchesFilter(def, filter) {
  if (!filter || filter === 'all') return true;
  if (!def) return false;
  const f = String(filter).toLowerCase();
  if ((def.tags || []).some((t) => String(t).toLowerCase() === f)) return true;
  return typeof def.rarity === 'string' && def.rarity.toLowerCase() === f;
}

// matchesQuery: q is either a Dex No. ("61" / "061" / "No.61" -- mock
// search placeholder: "find by Dex No. or name") or a case-insensitive
// substring of the item's EN or JA name.
function matchesQuery(def, dexNo, q) {
  if (!q) return true;
  const raw = String(q).trim();
  const noMatch = raw.match(/^(?:no\.?\s*)?0*(\d+)$/i);
  if (noMatch) return dexNo != null && dexNo === parseInt(noMatch[1], 10);
  if (!def) return false;
  const needle = raw.toLowerCase();
  if (typeof def.name === 'string' && def.name.toLowerCase().includes(needle)) return true;
  const ja = (def.i18n && def.i18n.ja && def.i18n.ja.name) || def.name_ja;
  return typeof ja === 'string' && ja.toLowerCase().includes(needle);
}

// listListings(callerId, {filter, q}): the browse surface.
//   default: every ACTIVE + SUSPENDED listing, market-wide (suspended
//     cards stay browsable with buying closed). Settled / withdrawn /
//     expired never appear here.
//   filter='mine': the CALLER's own listings in EVERY state (the mock's
//     "your listings" pane shows active/suspended/expired/settled rows)
//     -- tag/q filtering intentionally does not apply to 'mine'.
// Lazy normalization happens for every listing touched (TTL expiry +
// item-gone auto-withdraw persist; suspension derived only).
function listListings(callerId, opts) {
  const filter = opts && opts.filter;
  const q = opts && opts.q;
  const now = Date.now();
  const { itemDefsById } = getScheduleContent();
  const dexNos = getDexNoById();
  const caches = { history: new Map(), names: new Map(), sellers: new Map() };
  const mine = filter === 'mine';
  const out = [];
  for (const raw of storage.listMarketListings()) {
    const listing = normalizeListing(raw, now);
    if (mine && listing.sellerId !== callerId) continue;
    let view = { state: listing.state, suspended: false };
    if (listing.state === 'active') {
      let ctx = caches.sellers.get(listing.sellerId);
      if (!ctx) { ctx = sellerViewContext(listing.sellerId); caches.sellers.set(listing.sellerId, ctx); }
      view = deriveView(listing, ctx, now);
    }
    if (!mine) {
      if (view.state !== 'active' && view.state !== 'suspended') continue;
      const def = itemDefsById[listing.itemId];
      if (!matchesFilter(def, filter)) continue;
      if (!matchesQuery(def, dexNos[listing.itemId] != null ? dexNos[listing.itemId] : null, q)) continue;
    }
    out.push(toListingDto(listing, view, caches));
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
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
  if (!body || typeof body.itemUid !== 'string' || !body.itemUid) {
    const err = new Error('itemUid is required'); err.code = 'BAD_REQUEST'; throw err;
  }
  const price = body.price;
  if (!price || price.tm !== MARKET_TM_ID) {
    const err = new Error('price.tm must be "' + MARKET_TM_ID + '" (barter in kind: the market trades in exactly one TM)'); err.code = 'BAD_REQUEST'; throw err;
  }
  if (!Number.isInteger(price.qty) || price.qty < MARKET_PRICE_MIN || price.qty > MARKET_PRICE_MAX) {
    const err = new Error('price.qty must be an integer between ' + MARKET_PRICE_MIN + ' and ' + MARKET_PRICE_MAX); err.code = 'BAD_REQUEST'; throw err;
  }
  const entry = findInventoryPO(canvas, body.itemUid);
  if (!entry) {
    const err = new Error('item not found in your inventory'); err.code = 'NOT_FOUND'; throw err;
  }
  const { itemDefsById } = getScheduleContent();
  if (!itemDefsById[entry.id]) {
    const err = new Error('item references an unknown content item id: ' + entry.id); err.code = 'BAD_REQUEST'; throw err;
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
    itemUid: body.itemUid,
    itemId: entry.id,
    price: { tm: MARKET_TM_ID, qty: price.qty },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MARKET_LISTING_TTL_MS).toISOString(),
    state: 'active',
    idemKey: idemKey || null,
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

// stripPoFromCanvas: removes every pos[] entry with `uid` from the
// canvas -- inventory pages, the active squad's top-level pos[], and
// every stored squad snapshot (squads that merely REFERENCE the
// inventory-homed item; eligibility already guarantees none of them is
// deployed, but a stale un-deployed reference must not survive as a
// ghost). Same containers finalizeClaimingItemsForCanvas scans.
function stripPoFromCanvas(canvas, uid) {
  const strip = (container) => {
    if (container && Array.isArray(container.pos)) {
      container.pos = container.pos.filter((p) => p.uid !== uid);
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
  const sellerDoc = storage.readProfile(listing.sellerId);
  const sellerCanvas = sellerDoc ? sellerDoc.canvas : null;
  const sellerPo = sellerCanvas ? findInventoryPO(sellerCanvas, listing.itemUid) : null;
  if (!sellerCanvas || !sellerPo) {
    autoWithdrawItemGone(listing, now);
    const err = new Error('the listed item no longer exists; listing withdrawn'); err.code = 'CONFLICT'; err.reason = 'item_gone'; throw err;
  }
  if (deployedUidSet(listing.sellerId, sellerCanvas).has(listing.itemUid)) {
    const err = new Error('listing suspended: the seller currently deploys this item (the Law of Possession)'); err.code = 'CONFLICT'; err.reason = 'suspended'; throw err;
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

  // (3/7) remove the item from the seller (inventory + every
  // non-deployed squad reference).
  stripPoFromCanvas(sellerCanvas, listing.itemUid);
  storage.writeProfile(listing.sellerId, sellerCanvas);

  // (4/7) deliver the item to the buyer's WAREHOUSE as a normal
  // claimable row -- the buyer places it via the standard two-phase
  // warehouse claim, exactly like a dungeon reward. Fresh uid
  // (grantWarehouseItem convention); cap was pre-checked synchronously
  // above, so addToWarehouse cannot refuse here.
  const itemRow = {
    itemUid: genId('wh'), playerId: buyerId, itemId: listing.itemId,
    q: sellerPo.q, // REQ-0063: the SAME instance's quality roll travels with it, not re-rolled
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
  hist.entries.unshift({ qty, t: tIso, listingId: listing.id });
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

// furnaceTotal(sinceMs?): sums the append-only burn ledger. `sinceMs` is
// the REQ-0066 seasonal-windowing hook -- no season registry exists yet,
// so the route passes undefined (all-time; the mock's "this season the
// furnace burned N" footer becomes truly seasonal the moment REQ-0066
// supplies a season start timestamp to this same function).
function furnaceTotal(sinceMs) {
  let total = 0, count = 0;
  for (const e of storage.listMarketFurnaceEntries()) {
    if (sinceMs != null && Date.parse(e.t) < sinceMs) continue;
    total += Number(e.amount) || 0;
    count++;
  }
  return { tm: MARKET_TM_ID, total, count, since: sinceMs != null ? new Date(sinceMs).toISOString() : null };
}

module.exports = {
  MARKET_TM_ID,
  MARKET_BURN_RATE,
  MARKET_PRICE_MIN,
  MARKET_PRICE_MAX,
  MARKET_LISTING_TTL_MS,
  DEX_PRICE_HISTORY_MAX,
  MARKET_DTO_VERSION,
  burnOf,
  readTmBalance,
  findInventoryPO,
  deployedUidSet,
  normalizeListing,
  listListings,
  createListing,
  withdrawListing,
  devClearAllListings,
  buyListing,
  furnaceTotal,
  toListingDto,
  deriveView,
  sellerViewContext,
  getOwnListingOr404,
};
