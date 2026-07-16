// backpack_ragnarok -- server/services/market/views.cjs
// REQ-0145a (sd): read models -- lazy suspension derivation, DTO
// assembly, filter/query, the browse surface (listListings) --
// extracted verbatim from the pre-split services/market.cjs (origin
// lines 204-230, 232-362 @ commit 6eafed8).
'use strict';
const storage = require('../../storage.cjs');
const players = require('../../players.cjs');
const { getScheduleContent } = require('../core.cjs');
const { deployedUidSet, referencedUidSet } = require('../squads.cjs');
const { burnOf, getDexNoById, findInventoryPO, findInventorySI, findInventoryBP, readTmBalance, MARKET_TM_ID } = require('./lib.cjs');
const { normalizeListing, autoWithdrawItemGone } = require('./listings.cjs');

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
  // REQ-0198 (C): `referenced` = board + preset references (a strict
  // superset of `deployed`); a listed instance that becomes referenced
  // derives SUSPENDED, reversibly, the same lazy law as deploy-suspension.
  return { canvas, deployed: deployedUidSet(sellerId, canvas), referenced: referencedUidSet(canvas) };
}

// deriveView: classifies one ALREADY-normalized listing against its
// seller's context. Returns { state, suspended } where `state` is the
// DTO-facing state ('suspended' overlays a stored 'active') -- or
// mutates + persists the listing when the item is simply gone.
function deriveView(listing, ctx, nowMs) {
  if (listing.state !== 'active') return { state: listing.state, suspended: false };
  const kind = listing.kind || 'po';
  if (kind === 'tm') {
    // REQ-0195b: tm "stock" is the live balance; short -> SUSPENDED
    // (reversible, never auto-withdrawn -- balances refill).
    const stock = ctx.canvas ? readTmBalance(ctx.canvas, listing.itemId) : 0;
    if (stock < listing.tmQty) return { state: 'suspended', suspended: true };
    return { state: 'active', suspended: false };
  }
  const found = ctx.canvas ? (kind === 'si' ? findInventorySI(ctx.canvas, listing.itemUid) : kind === 'unit' ? findInventoryBP(ctx.canvas, listing.itemUid) : findInventoryPO(ctx.canvas, listing.itemUid)) : null;
  if (!found) {
    autoWithdrawItemGone(listing, nowMs);
    return { state: 'withdrawn', suspended: false };
  }
  if (ctx.deployed.has(listing.itemUid)) return { state: 'suspended', suspended: true };
  // REQ-0198 (C): referenced (board/preset) -> SUSPENDED too (reversible).
  if (ctx.referenced && ctx.referenced.has(listing.itemUid)) return { state: 'suspended', suspended: true };
  return { state: 'active', suspended: false };
}

// ---------------------------------------------------------------------
// DTO assembly (wire shapes: shared/dto.ts ApiMarketListing et al;
// dtoVersion MARKET_DTO_VERSION on every response envelope).
// ---------------------------------------------------------------------

function priceHistoryFor(itemId, cache) {
  if (cache && cache.has(itemId)) return cache.get(itemId);
  const doc = storage.readMarketDexHistory(itemId);
  const entries = (doc && Array.isArray(doc.entries) ? doc.entries : []).map((e) => ({ qty: e.qty, tm: (typeof e.tm === 'string' && e.tm) ? e.tm : MARKET_TM_ID, t: e.t }));
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

// rollPctOf (REQ-0195e): the roll-fulfillment fraction rendered as the
// market roll bar (min=0, max=1). po/si -> the live instance q
// (REQ-0063); unit -> bp.roll?.pct (the REQ-0196 container) else null
// (the client shows the "unmeasured" badge, never a 0% bar); tm -> null.
// A SETTLED listing reads the value FROZEN on its settlement record (its
// instance no longer lives on the seller canvas by then) -- MinePane
// history honesty. Live derivation reuses the per-request seller-canvas
// cache listListings fills; the route callers pass caches=null, so it
// lazily loads the single seller it needs (a create/withdraw/buy
// response is one listing).
function rollPctOf(listing, kind, caches) {
  if (kind === 'tm') return null;
  if (listing.state === 'settled' && listing.settlement && typeof listing.settlement.rollPct !== 'undefined') {
    return listing.settlement.rollPct;
  }
  let ctx = caches && caches.sellers ? caches.sellers.get(listing.sellerId) : null;
  if (!ctx) { ctx = sellerViewContext(listing.sellerId); if (caches && caches.sellers) caches.sellers.set(listing.sellerId, ctx); }
  const canvas = ctx.canvas;
  if (!canvas) return null;
  if (kind === 'unit') {
    const b = findInventoryBP(canvas, listing.itemUid);
    return b && b.bp && b.bp.roll && typeof b.bp.roll.pct === 'number' ? b.bp.roll.pct : null;
  }
  const inst = kind === 'si' ? findInventorySI(canvas, listing.itemUid) : findInventoryPO(canvas, listing.itemUid);
  return inst && typeof inst.q === 'number' ? inst.q : null;
}

function toListingDto(listing, view, caches) {
  const kind = listing.kind || 'po';
  const content = getScheduleContent();
  const def = kind === 'tm' ? (content.tmDefsById[listing.itemId] || null)
    : kind === 'si' ? (content.siDefsById[listing.itemId] || null)
    : kind === 'unit' ? (content.unitDefsById[listing.itemId] || null)
    : (content.itemDefsById[listing.itemId] || null);
  const ja = def && def.i18n && def.i18n.ja;
  const dexNo = (kind === 'tm' || kind === 'si' || kind === 'unit') ? null : getDexNoById()[listing.itemId];
  const qty = listing.price.qty;
  const burn = burnOf(qty);
  /** @type {any} */
  const dto = {
    id: listing.id,
    sellerId: listing.sellerId,
    sellerName: sellerNameOf(listing.sellerId, caches && caches.names),
    itemUid: listing.itemUid != null ? listing.itemUid : null,
    kind,
    itemId: listing.itemId,
    itemName: def ? def.name : listing.itemId,
    itemNameJa: (ja && ja.name) || (def && def.name_ja) || null,
    rarity: def ? (def.rarity || null) : null,
    tags: def ? (def.tags || []) : [],
    dexNo: dexNo != null ? dexNo : null,
    rollPct: rollPctOf(listing, kind, caches),
    price: { tm: listing.price.tm, qty },
    burn,
    sellerReceives: qty - burn,
    createdAt: listing.createdAt,
    expiresAt: listing.expiresAt,
    state: view.state,
    suspended: view.suspended,
    priceHistory: priceHistoryFor(listing.itemId, caches && caches.history),
  };
  if (kind === 'tm') dto.tmQty = listing.tmQty;
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

// matchesFilter: the chip row is two-layered. A KIND filter ('po' | 'si'
// | 'unit' | 'tm', case-insensitive) matches the LISTING KIND itself --
// REQ-0195a made the market multi-kind, so browse can be narrowed to one
// kind. (si/unit/tm cards carry no tag/rarity a chip could hit, so before
// this they were unreachable by every chip but 'all'.) Any OTHER filter
// value stays tag-driven, per the mock's chip row (all / weapons / frost /
// ember / relic -- chips map to content vocabulary values client-side): it
// matches an item def when it equals (case-insensitively) any of the def's
// tags[] OR its rarity. Empty/absent/'all' = no filter.
const KIND_FILTERS = new Set(['po', 'si', 'unit', 'tm']);
function matchesFilter(def, kind, filter) {
  if (!filter || filter === 'all') return true;
  const f = String(filter).toLowerCase();
  if (KIND_FILTERS.has(f)) return String(kind || 'po').toLowerCase() === f;
  if (!def) return false;
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
  const { itemDefsById, siDefsById, unitDefsById, tmDefsById } = getScheduleContent();
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
      // Resolve the def by the listing's OWN kind (mirrors toListingDto's
      // dispatch) so si/unit/tm listings match a name query too -- before
      // this every non-po listing resolved to a missing po def and could
      // only ever surface under a no-filter browse (review fix F1).
      const kind = listing.kind || 'po';
      const def = kind === 'tm' ? (tmDefsById[listing.itemId] || null)
        : kind === 'si' ? (siDefsById[listing.itemId] || null)
        : kind === 'unit' ? (unitDefsById[listing.itemId] || null)
        : (itemDefsById[listing.itemId] || null);
      // dexNo stays po-only (si/unit/tm carry none): a bare-digit query
      // deep-links a po exactly as the DTO's own dexNo does.
      const dexNo = kind === 'po' && dexNos[listing.itemId] != null ? dexNos[listing.itemId] : null;
      if (!matchesFilter(def, kind, filter)) continue;
      if (!matchesQuery(def, dexNo, q)) continue;
    }
    out.push(toListingDto(listing, view, caches));
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

module.exports = {
  sellerViewContext,
  deriveView,
  toListingDto,
  listListings,
};
