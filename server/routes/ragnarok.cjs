'use strict';
// server/routes/ragnarok.cjs -- REQ-0066: the token-gated Hall of
// Ragnarok HTTP surface. One module, same shape as routes/market.cjs:
// every route resolves the CALLER's identity from the X-Auth-Token
// header FIRST (admin.resolveAuth(), incl. the dev_mode no-token
// fallback); a preset index in the URL is NEVER trusted as identity --
// it is resolved against the CALLER's own canvas only, so a foreign
// preset is structurally unaddressable (404 no-leak). Returns false
// when not matched (router then 404s).
//
//   GET  /api/ragnarok/season                    registry + derived
//                                                phase/countdown (S1)
//   GET  /api/ragnarok/order?top=&around=me&q=   the Eternal Order,
//                                                dawn-cached (S2)
//   GET  /api/ragnarok/einherjar?player=         devoted records (S3;
//                                                default: the caller)
//   GET  /api/ragnarok/devotion/preview/:presetIndex   blast radius +
//                                                eligibility+projection
//   POST /api/ragnarok/devotion/:presetIndex     THE rite (S4;
//                                                Idempotency-Key
//                                                supported, replayed
//                                                outcomes marked)
//
// 409 reason vocabulary (POST devotion): mid_rite / last_preset /
// empty_unit / deployed -- see services/ragnarok.cjs's
// riteEligibilityReasons. Auth note: /season is technically public-ish
// content, but S5's "resolveAuth everywhere" wins -- ALL ragnarok
// routes are token-gated uniformly (the season strip only renders
// inside the authenticated shell anyway).
const { sendJSON, getAuthToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const ragnarok = require('../ragnarok.cjs');

const RAGNAROK_SEASON_RE = /^\/api\/ragnarok\/season$/;
const RAGNAROK_ORDER_RE = /^\/api\/ragnarok\/order$/;
const RAGNAROK_EINHERJAR_RE = /^\/api\/ragnarok\/einherjar$/;
const RAGNAROK_DEVOTION_PREVIEW_RE = /^\/api\/ragnarok\/devotion\/preview\/([^/]+)$/;
const RAGNAROK_DEVOTION_RE = /^\/api\/ragnarok\/devotion\/([^/]+)$/;

// parsePresetIndex: the :presetIndex URL segment. Anything that is not
// a plain non-negative integer resolves to -1, which presetMetaOr404
// then answers with the same 404 as an out-of-range index -- a
// malformed id is indistinguishable from an unknown one (no-leak).
function parsePresetIndex(seg) {
  const s = decodeURIComponent(seg);
  if (!/^\d+$/.test(s)) return -1;
  return parseInt(s, 10);
}

function tryRagnarokRoutes(req, res, url, p) {
  const matched = p.match(RAGNAROK_SEASON_RE) || p.match(RAGNAROK_ORDER_RE)
    || p.match(RAGNAROK_EINHERJAR_RE) || p.match(RAGNAROK_DEVOTION_PREVIEW_RE)
    || p.match(RAGNAROK_DEVOTION_RE);
  if (!matched) return false;

  const token = getAuthToken(req);
  const resolved = admin.resolveAuth(token);
  if (!resolved.ok) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
    return;
  }
  const callerId = resolved.player.playerId;
  // Optional Idempotency-Key (node:http lowercases header names) --
  // same minimal pattern routes/market.cjs introduced.
  const rawIdem = req.headers['idempotency-key'];
  const idemKey = typeof rawIdem === 'string' && rawIdem ? rawIdem : undefined;

  // Same code->status mapping + structured-reason threading as
  // routes/market.cjs (REQ-0041 convention).
  function errToStatus(e) {
    if (e.code === 'NOT_FOUND') return 404;
    if (e.code === 'CONFLICT') return 409;
    if (e.code === 'BAD_REQUEST') return 400;
    return 500;
  }
  function sendRagnarokError(e) {
    const body = { ok: false, error: e.message };
    if (typeof e.reason === 'string') body.reason = e.reason;
    sendJSON(res, errToStatus(e), body);
  }

  // ---- GET /api/ragnarok/season ----
  if (p.match(RAGNAROK_SEASON_RE)) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    try {
      const cs = ragnarok.currentSeason();
      sendJSON(res, 200, {
        ok: true,
        dtoVersion: ragnarok.RAGNAROK_DTO_VERSION,
        seasons: ragnarok.listSeasons(),
        season: cs.season,
        derived: cs.derived,
      });
    } catch (e) { sendRagnarokError(e); }
    return;
  }

  // ---- GET /api/ragnarok/order ----
  if (p.match(RAGNAROK_ORDER_RE)) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    try {
      const view = ragnarok.orderView(callerId, {
        top: url.searchParams.get('top') || undefined,
        around: url.searchParams.get('around') || undefined,
        q: url.searchParams.get('q') || undefined,
      });
      sendJSON(res, 200, Object.assign({ ok: true, dtoVersion: ragnarok.RAGNAROK_DTO_VERSION }, view));
    } catch (e) { sendRagnarokError(e); }
    return;
  }

  // ---- GET /api/ragnarok/einherjar?player= ----
  if (p.match(RAGNAROK_EINHERJAR_RE)) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    try {
      // ?player= defaults to the caller. Any REGISTERED player may be
      // queried (hall records are public data, same visibility as the
      // order's own name column); an unknown id is a plain 404.
      const playerId = url.searchParams.get('player') || callerId;
      const players = require('../players.cjs');
      if (!players.readPlayer(playerId)) {
        sendJSON(res, 404, { ok: false, error: 'player not found' });
        return;
      }
      sendJSON(res, 200, {
        ok: true,
        dtoVersion: ragnarok.RAGNAROK_DTO_VERSION,
        playerId,
        einherjar: ragnarok.listEinherjar(playerId),
      });
    } catch (e) { sendRagnarokError(e); }
    return;
  }

  // ---- GET /api/ragnarok/devotion/preview/:presetIndex ----
  const previewMatch = p.match(RAGNAROK_DEVOTION_PREVIEW_RE);
  if (previewMatch) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    try {
      const preview = ragnarok.previewDevotion(callerId, parsePresetIndex(previewMatch[1]));
      sendJSON(res, 200, Object.assign({ ok: true, dtoVersion: ragnarok.RAGNAROK_DTO_VERSION }, preview));
    } catch (e) { sendRagnarokError(e); }
    return;
  }

  // ---- POST /api/ragnarok/devotion/:presetIndex ----
  const devoteMatch = p.match(RAGNAROK_DEVOTION_RE);
  if (devoteMatch) {
    if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    try {
      // No request body: the preset index + Idempotency-Key header are
      // the entire input (the rite has no parameters -- the mock's
      // final modal is a bare 誓う/退く choice).
      const { record, replayed } = ragnarok.devote(callerId, parsePresetIndex(devoteMatch[1]), idemKey);
      sendJSON(res, 200, {
        ok: true,
        dtoVersion: ragnarok.RAGNAROK_DTO_VERSION,
        replayed,
        einherjar: ragnarok.einherjarDto(record),
        blast: record.blast,
      });
    } catch (e) { sendRagnarokError(e); }
    return;
  }

  return false;
}
module.exports = { tryRagnarokRoutes };
