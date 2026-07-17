'use strict';
// server/routes/workshop.cjs -- REQ-0145a (se): the token-gated
// Workshop gacha HTTP surface (REQ-0042), split out of the combined
// routes/schedule.cjs (origin lines 472-499 @ commit 9d4bc89, body
// verbatim). Shares the caller-resolution preamble via
// lib/route_auth.cjs; dispatched right after schedule -> warehouse in
// the exact slot the combined module occupied. Returns false when not
// matched.
const { sendJSON, readBody } = require('../lib/http_util.cjs');
const { resolveCallerOr401, loadOwnCanvas, sendScheduleError } = require('../lib/route_auth.cjs');
const schedule = require('../schedule.cjs');

const WORKSHOP_GACHA_RE = /^\/api\/workshop\/gacha$/; // REQ-0042

function tryWorkshopRoutes(req, res, url, p) {
  if (p.match(WORKSHOP_GACHA_RE)) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const { callerId } = ctx;

    // ---- POST /api/workshop/gacha {kind:'common_bp'} (REQ-0042, REWRITTEN
    // by REQ-0215) ----
    // No longer two-phase. schedule.startGachaRoll() now runs the WHOLE roll as
    // one synchronous transaction -- validate the LRDST balance + warehouse cap
    // off the last-saved canvas, roll the Unit, debit the cost server-side, and
    // deliver the Unit (+ any pack bonuses) to the caller's WAREHOUSE as normal
    // claimable rows. The player then claims it through the ordinary warehouse
    // UI, exactly like a dungeon reward or a market-bought Unit.
    //
    // This route therefore DOES cause a profile write (inside startGachaRoll),
    // which the pre-REQ-0215 version deliberately never did. That is the
    // market's sanctioned rule-5 divergence, reused: see services/gacha.cjs's
    // module header for why the old client-places-it-then-the-PUT-finalizes-it
    // design cannot survive the user's "the roll goes to the warehouse" spec.
    // The response shape is UNCHANGED ({ok, cost, rolled}); `rolled` is now a
    // receipt of what was delivered, not something the client must place.
    if (p.match(WORKSHOP_GACHA_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        }
        const kind = typeof body.kind === 'string' ? body.kind : 'common_bp';
        try {
          const canvas = loadOwnCanvas(callerId);
          const result = schedule.startGachaRoll(callerId, kind, canvas);
          sendJSON(res, 200, { ok: true, cost: result.cost, rolled: result.rolled });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }
  }

  return false;
}
module.exports = { tryWorkshopRoutes };
