'use strict';
// server/routes/warehouse.cjs -- REQ-0145a (se): the token-gated
// Warehouse HTTP surface (list, two-phase claim, dev backdate-claim /
// clear-debris seams), split out of the combined routes/schedule.cjs
// (origin lines 343-405, 432-470 @ commit 9d4bc89, bodies verbatim).
// Shares the caller-resolution preamble via lib/route_auth.cjs; the
// router dispatches schedule -> warehouse -> workshop consecutively in
// the exact slot the combined module occupied. Returns false when not
// matched.
const { sendJSON, readBody } = require('../lib/http_util.cjs');
const { resolveCallerOr401, loadOwnCanvas, sendScheduleError } = require('../lib/route_auth.cjs'); // REQ-0215: loadOwnCanvas -- the claim now validates the client's spot against the last-saved canvas
const schedule = require('../schedule.cjs');

const WAREHOUSE_RE = /^\/api\/warehouse$/;
const WAREHOUSE_CLAIM_RE = /^\/api\/warehouse\/claim$/;
const WAREHOUSE_DEV_BACKDATE_CLAIM_RE = /^\/api\/warehouse\/dev\/backdate-claim$/; // REQ-0041 E2E hook, dev-only
const WAREHOUSE_DEV_CLEAR_DEBRIS_RE = /^\/api\/warehouse\/dev\/clear-debris$/; // fix: e2e pg teardown -- E2E debris-cleanup hook, dev-only

function tryWarehouseRoutes(req, res, url, p) {
  const warehouseMatch = p.match(WAREHOUSE_RE) || p.match(WAREHOUSE_CLAIM_RE) ||
    p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE) || p.match(WAREHOUSE_DEV_CLEAR_DEBRIS_RE);
  if (warehouseMatch) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const { callerId, callerIsDevFallback } = ctx;

    // ---- POST /api/warehouse/dev/backdate-claim (REQ-0041 E2E hook,
    // dev-only) ----
    // Body: {itemUid, extraSecsIntoPast?}. Rewrites a 'claiming'
    // warehouse row's claimedAt further into the past so it reads as an
    // ABANDONED claim (older than WAREHOUSE_CLAIM_TIMEOUT_MS) on the very
    // next read, exactly mirroring the existing dev/backdate room route's
    // own test-control-seam shape/gating (schedule.cjs's
    // devBackdateClaimedWarehouseItem() doc) -- lets E2E cover the
    // "abandoned claim lazily reverts to claimable" path without waiting
    // out the real 120s timeout. GATED to the dev_mode fallback caller
    // ONLY, same as dev/backdate.
    if (p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/backdate-claim is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        }
        if (!body.itemUid) { sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return; }
        try {
          const item = schedule.devBackdateClaimedWarehouseItem(callerId, body.itemUid, body.extraSecsIntoPast);
          sendJSON(res, 200, { ok: true, itemUid: item.itemUid, claimedAt: item.claimedAt });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- POST /api/warehouse/dev/clear-debris (fix: e2e pg teardown --
    // E2E debris-cleanup hook, dev-only) ----
    // No body. Bulk-deletes EVERY warehouse row belonging to the CALLER
    // -- necessarily the dev_mode fallback player, the only caller that
    // can reach this -- and returns {ok:true, deleted:n}. Exists because
    // the Playwright suite's global setup/teardown safety net
    // (client/e2e/global-setup.ts) backs up + restores FILES only: with
    // the live API in STORAGE_BACKEND=pg mode, the rows the suite
    // grants/claims for the dev player survived every run (~55-60 each)
    // until the 200-row cap turned POST /api/admin/warehouse/grant into
    // 409 warehouse-full cascades. Goes through schedule.devClearWarehouse
    // -> storage.clearWarehouseForPlayer (the files/pg chokepoint), so
    // both backends clean identically. GATED to the dev_mode no-token
    // fallback caller ONLY (callerIsDevFallback), exactly like
    // dev/backdate and dev/backdate-claim above -- a real guest token,
    // even a valid one, gets 403; and the target is always the RESOLVED
    // caller's own warehouse (this route's shape carries no client-
    // supplied playerId at all), so no real player's rows are reachable
    // through it.
    if (p.match(WAREHOUSE_DEV_CLEAR_DEBRIS_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/clear-debris is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      try {
        const deleted = schedule.devClearWarehouse(callerId);
        sendJSON(res, 200, { ok: true, deleted });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- GET /api/warehouse (golden e/f) ----
    if (p.match(WAREHOUSE_RE)) {
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        sendJSON(res, 200, { ok: true, items: schedule.listWarehouse(callerId) });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- POST /api/warehouse/claim {itemUid, page, position} (golden f;
    // page/position added by REQ-0215) ----
    if (p.match(WAREHOUSE_CLAIM_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        if (typeof body.itemUid !== 'string' || !body.itemUid) {
          sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return;
        }
        // REQ-0215: the client did the fit SEARCH and tells us where it landed.
        // Both fields are REQUIRED -- there is no server-side fallback search to
        // degrade to, and silently guessing a spot is exactly the server-side
        // first-fit REQ-0041 deleted. A caller that omits them is a stale client;
        // 400 says so plainly rather than failing later inside the engine.
        if (!Number.isInteger(body.page) || body.page < 0) {
          sendJSON(res, 400, { ok: false, error: 'page is required: the inventory page index (0-based) the client fit this item into' }); return;
        }
        if (!Array.isArray(body.position) || body.position.length !== 2 ||
            !Number.isInteger(body.position[0]) || !Number.isInteger(body.position[1])) {
          sendJSON(res, 400, { ok: false, error: 'position is required: the [row, col] the client fit this item at (a BP\'s origin, otherwise the anchor cell)' }); return;
        }
        try {
          // REQ-0041 two-phase claim: this route no longer touches
          // profileCanvas or calls storage.writeProfile AT ALL (see
          // schedule.cjs's claimWarehouseItem doc for the full BUG #3
          // root-cause writeup) -- it only flips the warehouse row to
          // 'claiming' and hands back the content itemId (+ the row's own
          // itemUid, which the client reuses as the new inventory
          // PO/SI's own uid) so the CLIENT can place it via the engine
          // itself, through the app's one auto-save choke point.
          const { itemDefsById, tmDefsById, siDefsById, unitDefsById } = schedule.getScheduleContent();
          // REQ-0215: the LAST-SAVED canvas is what the spot is judged against
          // (this route still writes nothing -- design rule 5). The client is
          // required to flushAutoSave() before claiming so the board the server
          // judges IS the board the client searched.
          const result = schedule.claimWarehouseItem(
            callerId, body.itemUid, itemDefsById, tmDefsById, siDefsById, unitDefsById,
            { page: body.page, position: body.position }, loadOwnCanvas(callerId)
          );
          // REQ-0042: echo kind/qty too (undefined for a plain PO/SI row,
          // 'tm'/a number for a TM-kind row) so the client can dispatch
          // to the correct placement path (engine PO/SI first-fit vs.
          // TM place-or-merge).
          sendJSON(res, 200, { ok: true, itemUid: result.itemUid, itemId: result.itemId, kind: result.kind, qty: result.qty, bp: result.bp, page: result.page, position: result.position });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }
  }

  return false;
}
module.exports = { tryWarehouseRoutes };
