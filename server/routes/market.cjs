'use strict';
// server/routes/market.cjs -- REQ-0064: the token-gated Market HTTP
// surface. One module, same shape as routes/schedule.cjs: every route
// resolves the CALLER's identity request-first (REQ-0199:
// admin.resolveAuthFromRequest() -- a Supabase Bearer JWT, else the
// REQ-0037 X-Auth-Token path + the dev_mode no-token fallback); a
// listing id is NEVER trusted as identity. All bodies are pure JSON,
// auth is header-only (bot-API-shaped, same REQ-0039 posture as the
// schedule routes). Returns false when not matched (router then 404s).
//
//   GET  /api/market/listings?filter=&q=   browse (active+suspended;
//                                          filter=mine -> own, all states)
//   POST /api/market/listings              {itemUid, price:{tm,qty}}
//   POST /api/market/listings/:id/withdraw owner-only, free
//   POST /api/market/listings/:id/buy      atomic settle (the only burn)
//   GET  /api/market/furnace               seasonal burn total (REQ-0066:
//                                          windowed from the current
//                                          season start via the ragnarok
//                                          registry; all-time fallback
//                                          when no seasons file exists)
//
// Idempotency: POST routes accept an OPTIONAL `Idempotency-Key` header
// (no house-wide pattern existed before this REQ -- prior mutations are
// state-machine-idempotent instead; see services/market.cjs's
// createListing doc). Replays return the original outcome with
// {replayed:true}; requests WITHOUT the header keep plain state-machine
// semantics (double-buy -> 409 already_settled, etc.).
// REQ-0349: the whole request preamble comes from lib/route_kit.cjs. The former
// private errToStatus/sendMarketError below were one of FOUR hand-maintained
// copies of the same code->status table, and this copy LACKED FORBIDDEN->403 (it
// answered 500). The kit's shared table has it. Inert today -- the only
// FORBIDDEN throwers in the server are services/seals.cjs, reached through the
// schedule family -- so no current market response changes; the value is that
// the divergence cannot come back.
const { sendJSON } = require('../lib/http_util.cjs');
const { resolveCallerOr401, methodGuard, withJsonBody, sendDomainError } = require('../lib/route_kit.cjs');
const storage = require('../storage.cjs');
const market = require('../market.cjs');
const ragnarok = require('../ragnarok.cjs'); // REQ-0066: furnace seasonal windowing

const MARKET_LISTINGS_RE = /^\/api\/market\/listings$/;
const MARKET_LISTING_WITHDRAW_RE = /^\/api\/market\/listings\/([^/]+)\/withdraw$/;
const MARKET_LISTING_BUY_RE = /^\/api\/market\/listings\/([^/]+)\/buy$/;
const MARKET_FURNACE_RE = /^\/api\/market\/furnace$/;
const MARKET_LISTINGS_DEV_CLEAR_RE = /^\/api\/market\/listings\/dev\/clear-all$/;
const MARKET_LISTINGS_FROM_WAREHOUSE_RE = /^\/api\/market\/listings\/from-warehouse$/; // REQ-0328

// Both body readers in this file used a BARE JSON.parse, so an empty body has
// always been a 400 here. Real behaviour, not a wording override -- it stays.
const BODY_WORDING = { allowEmpty: false };

function tryMarketRoutes(req, res, url, p) {
  const marketMatch = p.match(MARKET_LISTINGS_RE) || p.match(MARKET_LISTING_WITHDRAW_RE) ||
    p.match(MARKET_LISTING_BUY_RE) || p.match(MARKET_FURNACE_RE) || p.match(MARKET_LISTINGS_DEV_CLEAR_RE) ||
    p.match(MARKET_LISTINGS_FROM_WAREHOUSE_RE);
  if (!marketMatch) return false;

  // REQ-0199: resolve the caller EXACTLY like schedule/warehouse and profile/me
  // -- a Supabase Bearer JWT FIRST (REQ-0118c precedence), then the REQ-0037
  // X-Auth-Token path (+ the dev_mode no-token fallback). BEFORE that REQ this
  // route called admin.resolveAuth(getAuthToken(req)) -- the X-Auth-Token-ONLY
  // resolver -- so a JWT-authenticated player (Authorization: Bearer, NO
  // X-Auth-Token) resolved to token=null -> dev_mode fallback -> the route acted
  // as the WRONG player ('dev') and read the DEV player's inventory (live
  // symptom: every market sell 404'd "item not found in your inventory").
  // REQ-0349: the sentence above used to sit directly on top of an inline COPY of
  // lib/route_auth.cjs's resolveCallerOr401. It now calls it, so the next fix of
  // REQ-0199's kind lands in one file instead of four. callerIsDevFallback (the
  // REQ-0214 annotation-keyed dev_mode-no-token test, used ONLY to gate
  // /listings/dev/clear-all below) comes off the same context.
  const ctx = resolveCallerOr401(req, res);
  if (!ctx) return;
  const { callerId, callerIsDevFallback } = ctx;
  // Optional Idempotency-Key (node:http lowercases header names).
  const rawIdem = req.headers['idempotency-key'];
  const idemKey = typeof rawIdem === 'string' && rawIdem ? rawIdem : undefined;

  // ---- POST /api/market/listings/dev/clear-all (E2E hook, mirrors
  // routes/ragnarok.cjs's /order/dev/force-rebuild + /einherjar/dev/clear
  // exactly) ---- Force-withdraws EVERY active listing market-wide,
  // regardless of seller -- see services/market.cjs's
  // devClearAllListings() doc comment: nothing in market.spec.ts ever
  // withdraws what it seeds, so without this hook every suite run
  // permanently adds more active listings to the shared live market and
  // poisons any later exact-count browse assertion. GATED to the
  // dev_mode no-token fallback caller ONLY; a real guest token gets 403.
  if (p.match(MARKET_LISTINGS_DEV_CLEAR_RE)) {
    if (!methodGuard(req, res, 'POST')) return;
    if (!callerIsDevFallback) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: listings/dev/clear-all is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
      return;
    }
    try {
      const cleared = market.devClearAllListings();
      sendJSON(res, 200, { ok: true, cleared });
    } catch (e) { sendDomainError(res, e); }
    return;
  }

  // ---- POST /api/market/listings/from-warehouse (REQ-0328) ----
  // The DIRECT warehouse->market sell. Consumes a CLAIMABLE warehouse row
  // and creates an active listing WITHOUT routing through the seller's
  // canvas/inventory (the item is escrowed on the listing; withdraw/expiry
  // returns it to the warehouse, settlement delivers it to the buyer). Body:
  // {warehouseRowId, price:{tm,qty}}. Same Idempotency-Key posture as
  // POST /api/market/listings above.
  if (p.match(MARKET_LISTINGS_FROM_WAREHOUSE_RE)) {
    if (!methodGuard(req, res, 'POST')) return;
    withJsonBody(req, res, BODY_WORDING, (body) => {
      try {
        const { listing, replayed } = market.createListingFromWarehouse(callerId, body, idemKey);
        const view = market.deriveView(listing, market.sellerViewContext(callerId), Date.now());
        sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, listing: market.toListingDto(listing, view, null) });
      } catch (e) { sendDomainError(res, e); }
    });
    return;
  }

  // ---- GET/POST /api/market/listings ----
  if (p.match(MARKET_LISTINGS_RE)) {
    if (req.method === 'GET') {
      try {
        const listings = market.listListings(callerId, {
          filter: url.searchParams.get('filter') || undefined,
          q: url.searchParams.get('q') || undefined,
        });
        sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, tms: market.liveTmIds(), listings });
      } catch (e) { sendDomainError(res, e); }
      return;
    }
    if (req.method === 'POST') {
      withJsonBody(req, res, BODY_WORDING, (body) => {
        try {
          // Eligibility is validated against the caller's LAST-SAVED
          // canvas (same "read the saved profile" posture the gacha
          // roll uses) -- a player with no saved profile yet owns no
          // sellable inventory at all.
          const doc = storage.readProfile(callerId);
          const canvas = doc ? doc.canvas : null;
          const { listing, replayed } = market.createListing(callerId, body, canvas, idemKey);
          const view = market.deriveView(listing, market.sellerViewContext(callerId), Date.now());
          sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, listing: market.toListingDto(listing, view, null) });
        } catch (e) { sendDomainError(res, e); }
      });
      return;
    }
    methodGuard(req, res, ['GET', 'POST']); // neither matched above, so this sends the 405
    return;
  }

  // ---- POST /api/market/listings/:id/withdraw ----
  const withdrawMatch = p.match(MARKET_LISTING_WITHDRAW_RE);
  if (withdrawMatch) {
    if (!methodGuard(req, res, 'POST')) return;
    const listingId = decodeURIComponent(withdrawMatch[1]);
    try {
      const { listing, replayed } = market.withdrawListing(callerId, listingId, idemKey);
      sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, listing: market.toListingDto(listing, { state: listing.state, suspended: false }, null) });
    } catch (e) { sendDomainError(res, e); }
    return;
  }

  // ---- POST /api/market/listings/:id/buy ----
  const buyMatch = p.match(MARKET_LISTING_BUY_RE);
  if (buyMatch) {
    if (!methodGuard(req, res, 'POST')) return;
    const listingId = decodeURIComponent(buyMatch[1]);
    try {
      const { listing, receipt, replayed } = market.buyListing(callerId, listingId, idemKey);
      sendJSON(res, 200, {
        ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, receipt,
        listing: market.toListingDto(listing, { state: listing.state, suspended: false }, null),
      });
    } catch (e) { sendDomainError(res, e); }
    return;
  }

  // ---- GET /api/market/furnace ----
  if (p.match(MARKET_FURNACE_RE)) {
    if (!methodGuard(req, res, 'GET')) return;
    try {
      // REQ-0066: seasonal windowing -- the burn total is windowed from
      // the CURRENT season's start (content/live/seasons.json via the
      // ragnarok facade's lazy wall-clock derivation). All-time fallback
      // when no season registry exists / no season has started yet
      // (season null), preserving the pre-REQ-0066 behavior
      // byte-for-byte. An ENDED season with no successor keeps
      // windowing from its own start (see services/ragnarok.cjs's
      // currentSeason doc).
      const cs = ragnarok.currentSeason();
      const furnace = market.furnaceTotal(cs.season ? Date.parse(cs.season.startAt) : undefined);
      sendJSON(res, 200, {
        ok: true, dtoVersion: market.MARKET_DTO_VERSION,
        furnace: { totals: furnace.totals, since: furnace.since },
        season: cs.season ? { index: cs.season.index, name: cs.season.name } : null,
      });
    } catch (e) { sendDomainError(res, e); }
    return;
  }

  return false;
}
module.exports = { tryMarketRoutes };
