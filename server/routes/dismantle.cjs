'use strict';
// server/routes/dismantle.cjs -- REQ-0063: the token-gated Dismantle
// HTTP surface. Same shape as routes/market.cjs: caller identity is
// resolved request-first (REQ-0199: admin.resolveAuthFromRequest() --
// a Supabase Bearer JWT, else the REQ-0037 X-Auth-Token path + the
// dev_mode no-token fallback); a request body's itemUid is
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
// REQ-0349: the whole request preamble -- caller resolution, the 405 guard,
// the JSON body read, and the domain-error mapping -- comes from
// lib/route_kit.cjs. This file's former private errToStatus/sendDismantleError
// were one of FOUR hand-maintained copies of the same code->status table; the
// kit's copy also maps FORBIDDEN->403, which this one did not. Inert here
// (nothing reachable from /api/dismantle throws FORBIDDEN -- the only throwers
// are services/seals.cjs, on the schedule family), see the kit's CODE_TO_STATUS
// note. sendJSON is still needed directly for this file's own 400 validation
// replies until REQ-0349's validator commit.
const { sendJSON } = require('../lib/http_util.cjs');
const { resolveCallerOr401, methodGuard, withJsonBody, sendDomainError } = require('../lib/route_kit.cjs');
const storage = require('../storage.cjs');
const dismantle = require('../dismantle.cjs');

const DISMANTLE_RE = /^\/api\/dismantle$/;
const DISMANTLE_LEDGER_RE = /^\/api\/dismantle\/ledger$/;

function tryDismantleRoutes(req, res, url, p) {
  const dismantleMatch = p.match(DISMANTLE_RE);
  const ledgerMatch = p.match(DISMANTLE_LEDGER_RE);
  if (!dismantleMatch && !ledgerMatch) return false;

  // REQ-0199: JWT-first caller resolution (a Supabase Bearer JWT, else the
  // REQ-0037 X-Auth-Token path + dev_mode fallback) -- was
  // admin.resolveAuth(getAuthToken(req)), the X-Auth-Token-ONLY resolver, which
  // mis-resolved a Bearer-JWT-only player to the dev_mode fallback and
  // dismantled from the WRONG (dev) canvas. REQ-0349: that resolution is now
  // the kit's, shared with every family, so the next fix of its kind lands
  // once. dismantle has no dev-only test hook, so it reads only callerId off
  // the returned context (callerIsDevFallback/callerCanSetGenSeed unused).
  const ctx = resolveCallerOr401(req, res);
  if (!ctx) return;
  const callerId = ctx.callerId;

  // ---- GET /api/dismantle/ledger ----
  if (ledgerMatch) {
    if (!methodGuard(req, res, 'GET')) return;
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
  if (!methodGuard(req, res, 'POST')) return;
  withJsonBody(req, res, {}, (body) => {
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
    } catch (e) { sendDomainError(res, e); }
  });
}

module.exports = { tryDismantleRoutes };
