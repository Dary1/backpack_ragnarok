'use strict';
// server/routes/market.cjs -- REQ-0064: the token-gated Market HTTP
// surface. One module, same shape as routes/schedule.cjs: every route
// resolves the CALLER's identity from the X-Auth-Token header FIRST
// (admin.resolveAuth(), incl. the dev_mode no-token fallback); a
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
const { sendJSON, readBody, getAuthToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const market = require('../market.cjs');
const ragnarok = require('../ragnarok.cjs'); // REQ-0066: furnace seasonal windowing

const MARKET_LISTINGS_RE = /^\/api\/market\/listings$/;
const MARKET_LISTING_WITHDRAW_RE = /^\/api\/market\/listings\/([^/]+)\/withdraw$/;
const MARKET_LISTING_BUY_RE = /^\/api\/market\/listings\/([^/]+)\/buy$/;
const MARKET_FURNACE_RE = /^\/api\/market\/furnace$/;
const MARKET_LISTINGS_DEV_CLEAR_RE = /^\/api\/market\/listings\/dev\/clear-all$/;

function tryMarketRoutes(req, res, url, p) {
  const marketMatch = p.match(MARKET_LISTINGS_RE) || p.match(MARKET_LISTING_WITHDRAW_RE) ||
    p.match(MARKET_LISTING_BUY_RE) || p.match(MARKET_FURNACE_RE) || p.match(MARKET_LISTINGS_DEV_CLEAR_RE);
  if (!marketMatch) return false;

  const token = getAuthToken(req);
  const resolved = admin.resolveAuth(token);
  if (!resolved.ok) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
    return;
  }
  const callerId = resolved.player.playerId;
  // REQ-0066/routes-ragnarok.cjs-style E2E hook gate: true only when
  // this request resolved via the dev_mode NO-TOKEN fallback -- same
  // computation as routes/schedule.cjs's and routes/ragnarok.cjs's own
  // callerIsDevFallback; used ONLY to gate /listings/dev/clear-all below.
  const devUserForGate = admin.readDevUser();
  const callerIsDevFallback = !token && devUserForGate.dev_mode === true && callerId === devUserForGate.playerId;
  // Optional Idempotency-Key (node:http lowercases header names).
  const rawIdem = req.headers['idempotency-key'];
  const idemKey = typeof rawIdem === 'string' && rawIdem ? rawIdem : undefined;

  // Same code->status mapping + structured-reason threading as
  // routes/schedule.cjs's sendScheduleError (REQ-0041 convention).
  function errToStatus(e) {
    if (e.code === 'NOT_FOUND') return 404;
    if (e.code === 'CONFLICT') return 409;
    if (e.code === 'BAD_REQUEST') return 400;
    return 500;
  }
  function sendMarketError(e) {
    const body = { ok: false, error: e.message };
    if (typeof e.reason === 'string') body.reason = e.reason;
    sendJSON(res, errToStatus(e), body);
  }

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
    if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    if (!callerIsDevFallback) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: listings/dev/clear-all is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
      return;
    }
    try {
      const cleared = market.devClearAllListings();
      sendJSON(res, 200, { ok: true, cleared });
    } catch (e) { sendMarketError(e); }
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
        sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, tm: market.MARKET_TM_ID, listings });
      } catch (e) { sendMarketError(e); }
      return;
    }
    if (req.method === 'POST') {
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
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
        } catch (e) { sendMarketError(e); }
      });
      return;
    }
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  // ---- POST /api/market/listings/:id/withdraw ----
  const withdrawMatch = p.match(MARKET_LISTING_WITHDRAW_RE);
  if (withdrawMatch) {
    if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    const listingId = decodeURIComponent(withdrawMatch[1]);
    try {
      const { listing, replayed } = market.withdrawListing(callerId, listingId, idemKey);
      sendJSON(res, 200, { ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, listing: market.toListingDto(listing, { state: listing.state, suspended: false }, null) });
    } catch (e) { sendMarketError(e); }
    return;
  }

  // ---- POST /api/market/listings/:id/buy ----
  const buyMatch = p.match(MARKET_LISTING_BUY_RE);
  if (buyMatch) {
    if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    const listingId = decodeURIComponent(buyMatch[1]);
    try {
      const { listing, receipt, replayed } = market.buyListing(callerId, listingId, idemKey);
      sendJSON(res, 200, {
        ok: true, dtoVersion: market.MARKET_DTO_VERSION, replayed, receipt,
        listing: market.toListingDto(listing, { state: listing.state, suspended: false }, null),
      });
    } catch (e) { sendMarketError(e); }
    return;
  }

  // ---- GET /api/market/furnace ----
  if (p.match(MARKET_FURNACE_RE)) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
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
        ok: true, dtoVersion: market.MARKET_DTO_VERSION, furnace,
        season: cs.season ? { index: cs.season.index, name: cs.season.name } : null,
      });
    } catch (e) { sendMarketError(e); }
    return;
  }

  return false;
}
module.exports = { tryMarketRoutes };
