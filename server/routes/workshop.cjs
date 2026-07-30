'use strict';
// server/routes/workshop.cjs -- REQ-0145a (se): the token-gated
// Workshop gacha HTTP surface (REQ-0042), split out of the combined
// routes/schedule.cjs (origin lines 472-499 @ commit 9d4bc89, body
// verbatim). Shares the whole request preamble via lib/route_kit.cjs
// (REQ-0349; was lib/route_auth.cjs, now a shim over it); dispatched
// right after schedule -> warehouse in the exact slot the combined
// module occupied. Returns false when not matched.
const { sendJSON } = require('../lib/http_util.cjs');
// sendScheduleError is the kit's sendDomainError: identical body, one shared
// code->status table instead of four hand-maintained copies.
const { resolveCallerOr401, loadOwnCanvas, methodGuard, withJsonBody, sendDomainError } = require('../lib/route_kit.cjs');
const schedule = require('../schedule.cjs');

const WORKSHOP_GACHA_RE = /^\/api\/workshop\/gacha$/; // REQ-0042

function tryWorkshopRoutes(req, res, url, p) {
  if (p.match(WORKSHOP_GACHA_RE)) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const { callerId } = ctx;

    // ---- POST /api/workshop/gacha {kind:'common_bp'} (REQ-0042) ----
    // Two-phase, mirrors POST /api/warehouse/claim immediately above:
    // this route NEVER writes the caller's profile -- it only reads the
    // LAST-SAVED canvas (loadOwnCanvas(callerId)) to check the LRDST balance,
    // rolls a fresh UNIT server-side -- a character drawn from the pack's
    // pool, plus the BP that is its inventory (seeded RNG, see
    // schedule.cjs's rollPackBp; REQ-0170) -- records a pending row, and
    // returns the rolled definition. The CLIENT deducts the cost from its own
    // LRDST stack, first-fit-places the BP, and auto-saves -- THAT PUT
    // is what finalizes the roll (see finalizeGachaForCanvas, wired into
    // the profile PUT handler above alongside
    // finalizeClaimingItemsForCanvas).
    if (p.match(WORKSHOP_GACHA_RE)) {
      if (!methodGuard(req, res, 'POST')) return;
      withJsonBody(req, res, {}, (body) => {
        const kind = typeof body.kind === 'string' ? body.kind : 'common_bp';
        try {
          const canvas = loadOwnCanvas(callerId);
          const result = schedule.startGachaRoll(callerId, kind, canvas);
          sendJSON(res, 200, { ok: true, cost: result.cost, rolled: result.rolled });
        } catch (e) { sendDomainError(res, e); }
      });
      return;
    }
  }

  return false;
}
module.exports = { tryWorkshopRoutes };
