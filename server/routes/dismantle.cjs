'use strict';
// server/routes/dismantle.cjs -- REQ-0063: the token-gated Dismantle
// HTTP surface. Same shape as routes/market.cjs: caller identity is
// resolved from the X-Auth-Token header FIRST (admin.resolveAuth(),
// incl. the dev_mode no-token fallback); a request body's itemUid is
// NEVER trusted as identity -- dismantleItem always operates on the
// RESOLVED caller's own canvas. Returns false when not matched (router
// then 404s).
//
//   POST /api/dismantle        {itemUid, kind:'po'|'si'} -> atomic dismantle
//   GET  /api/dismantle/ledger -> the caller's own full 分解値 ledger
//                                 (counts + current suppression per item
//                                 id) -- backs the Workshop panel and any
//                                 client-side summary; the REQ-0052 Dex
//                                 card reads the dismantle facade
//                                 directly server-side rather than
//                                 round-tripping through this route.
const { sendJSON, readBody, getAuthToken, MAX_BODY_BYTES } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const dismantle = require('../dismantle.cjs');

const DISMANTLE_RE = /^\/api\/dismantle$/;
const DISMANTLE_LEDGER_RE = /^\/api\/dismantle\/ledger$/;

function errToStatus(e) {
  if (e.code === 'NOT_FOUND') return 404;
  if (e.code === 'CONFLICT') return 409;
  if (e.code === 'BAD_REQUEST') return 400;
  return 500;
}
function sendDismantleError(res, e) {
  const body = { ok: false, error: e.message };
  if (typeof e.reason === 'string') body.reason = e.reason;
  sendJSON(res, errToStatus(e), body);
}

function tryDismantleRoutes(req, res, url, p) {
  const dismantleMatch = p.match(DISMANTLE_RE);
  const ledgerMatch = p.match(DISMANTLE_LEDGER_RE);
  if (!dismantleMatch && !ledgerMatch) return false;

  const token = getAuthToken(req);
  const resolved = admin.resolveAuth(token);
  if (!resolved.ok) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
    return;
  }
  const callerId = resolved.player.playerId;

  // ---- GET /api/dismantle/ledger ----
  if (ledgerMatch) {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    const doc = storage.readDismantleLedger(callerId);
    const rawCounts = (doc && doc.counts) || {};
    const entries = Object.keys(rawCounts).map((itemId) => ({
      itemId,
      dismantleCount: rawCounts[itemId],
      suppression: dismantle.suppressionFloor(rawCounts[itemId]),
    }));
    sendJSON(res, 200, { ok: true, entries });
    return;
  }

  // ---- POST /api/dismantle ----
  if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
  readBody(req, (err, bodyStr) => {
    if (err) {
      if (err.code === 'TOO_LARGE') {
        sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
        return;
      }
      sendJSON(res, 400, { ok: false, error: 'invalid request body' });
      return;
    }
    let body;
    try { body = bodyStr ? JSON.parse(bodyStr) : {}; }
    catch (e) { sendJSON(res, 400, { ok: false, error: 'malformed JSON body' }); return; }

    const itemUid = body && body.itemUid;
    const kind = body && body.kind;
    if (typeof itemUid !== 'string' || !itemUid) {
      sendJSON(res, 400, { ok: false, error: 'itemUid (string) is required' });
      return;
    }
    if (kind !== 'po' && kind !== 'si') {
      sendJSON(res, 400, { ok: false, error: "kind must be 'po' or 'si'" });
      return;
    }
    try {
      const result = dismantle.dismantleItem(callerId, itemUid, kind);
      sendJSON(res, 200, result);
    } catch (e) { sendDismantleError(res, e); }
  });
}

module.exports = { tryDismantleRoutes };
