'use strict';
// server/routes/warehouse.cjs -- REQ-0145a (se): the token-gated
// Warehouse HTTP surface (list, two-phase claim, dev backdate-claim /
// clear-debris seams), split out of the combined routes/schedule.cjs
// (origin lines 343-405, 432-470 @ commit 9d4bc89, bodies verbatim).
// Shares the whole request preamble via lib/route_kit.cjs (REQ-0349;
// replaced lib/route_auth.cjs); the router dispatches
// schedule -> warehouse -> workshop consecutively in the exact slot the
// combined module occupied. Returns false when not matched.
const { sendJSON } = require('../lib/http_util.cjs');
// sendScheduleError is the kit's sendDomainError: identical body, one shared
// code->status table instead of four hand-maintained copies.
const { resolveCallerOr401, methodGuard, withJsonBody, sendDomainError, requireString } = require('../lib/route_kit.cjs');
const schedule = require('../schedule.cjs');

const WAREHOUSE_RE = /^\/api\/warehouse$/;
const WAREHOUSE_CLAIM_RE = /^\/api\/warehouse\/claim$/;
const WAREHOUSE_DEV_BACKDATE_CLAIM_RE = /^\/api\/warehouse\/dev\/backdate-claim$/; // REQ-0041 E2E hook, dev-only
const WAREHOUSE_DEV_CLEAR_DEBRIS_RE = /^\/api\/warehouse\/dev\/clear-debris$/; // fix: e2e pg teardown -- E2E debris-cleanup hook, dev-only
const WAREHOUSE_DEV_BACKDATE_EXPIRY_RE = /^\/api\/warehouse\/dev\/backdate-expiry$/; // REQ-0368 E2E hook, dev-only

function tryWarehouseRoutes(req, res, url, p) {
  const warehouseMatch = p.match(WAREHOUSE_RE) || p.match(WAREHOUSE_CLAIM_RE) ||
    p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE) || p.match(WAREHOUSE_DEV_CLEAR_DEBRIS_RE) ||
    p.match(WAREHOUSE_DEV_BACKDATE_EXPIRY_RE);
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
      if (!methodGuard(req, res, 'POST')) return;
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/backdate-claim is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      withJsonBody(req, res, {}, (body) => {
        if (!body.itemUid) { sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return; }
        try {
          const item = schedule.devBackdateClaimedWarehouseItem(callerId, body.itemUid, body.extraSecsIntoPast);
          sendJSON(res, 200, { ok: true, itemUid: item.itemUid, claimedAt: item.claimedAt });
        } catch (e) { sendDomainError(res, e); }
      });
      return;
    }

    // ---- POST /api/warehouse/dev/backdate-expiry (REQ-0368 E2E hook,
    // dev-only) ----
    // Body: {itemUid, secsUntilExpiry?}. Moves a warehouse row's expiresAt to
    // `secsUntilExpiry` seconds from now (default 3600; negative = already
    // dead), so the e2e suite can observe both expiry edges -- the <24h
    // warning and the deletion -- without waiting out a 7-day TTL. Same
    // test-control-seam shape and gating as dev/backdate-claim above: the
    // dev_mode fallback caller ONLY, and always that caller's own id.
    if (p.match(WAREHOUSE_DEV_BACKDATE_EXPIRY_RE)) {
      if (!methodGuard(req, res, 'POST')) return;
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/backdate-expiry is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      withJsonBody(req, res, {}, (body) => {
        if (!body.itemUid) { sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return; }
        try {
          const item = schedule.devSetWarehouseExpiry(callerId, body.itemUid, body.secsUntilExpiry);
          sendJSON(res, 200, { ok: true, itemUid: item.itemUid, expiresAt: item.expiresAt });
        } catch (e) { sendDomainError(res, e); }
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
      if (!methodGuard(req, res, 'POST')) return;
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/clear-debris is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      try {
        const deleted = schedule.devClearWarehouse(callerId);
        sendJSON(res, 200, { ok: true, deleted });
      } catch (e) { sendDomainError(res, e); }
      return;
    }

    // ---- GET /api/warehouse (golden e/f) ----
    if (p.match(WAREHOUSE_RE)) {
      if (!methodGuard(req, res, 'GET')) return;
      try {
        sendJSON(res, 200, { ok: true, items: schedule.listWarehouse(callerId) });
      } catch (e) { sendDomainError(res, e); }
      return;
    }

    // ---- POST /api/warehouse/claim {itemUid} (golden f) ----
    if (p.match(WAREHOUSE_CLAIM_RE)) {
      if (!methodGuard(req, res, 'POST')) return;
      // allowEmpty:false -- this handler used a BARE JSON.parse(bodyStr), so an
      // empty body has always been a 400 here. Note dev/backdate-claim above
      // guarded with `if (bodyStr)` and so tolerates one: the two endpoints in
      // this same file genuinely differ, and REQ-0349 preserves both.
      withJsonBody(req, res, { allowEmpty: false }, (body) => {
        try {
          // REQ-0349 D3: wording preserved verbatim -- this route says 'itemUid is
          // required' where dismantle says 'itemUid (string) is required', and
          // validation text is domain text, which REQ-0349 does not rewrite.
          requireString(body.itemUid, 'itemUid', 'itemUid is required');
          // REQ-0041 two-phase claim: this route no longer touches
          // profileCanvas or calls storage.writeProfile AT ALL (see
          // schedule.cjs's claimWarehouseItem doc for the full BUG #3
          // root-cause writeup) -- it only flips the warehouse row to
          // 'claiming' and hands back the content itemId (+ the row's own
          // itemUid, which the client reuses as the new inventory
          // PO/SI's own uid) so the CLIENT can place it via the engine
          // itself, through the app's one auto-save choke point.
          const { itemDefsById, tmDefsById, siDefsById, unitDefsById } = schedule.getScheduleContent();
          const result = schedule.claimWarehouseItem(callerId, body.itemUid, itemDefsById, tmDefsById, siDefsById, unitDefsById);
          // REQ-0042: echo kind/qty too (undefined for a plain PO/SI row,
          // 'tm'/a number for a TM-kind row) so the client can dispatch
          // to the correct placement path (engine PO/SI first-fit vs.
          // TM place-or-merge).
          sendJSON(res, 200, { ok: true, itemUid: result.itemUid, itemId: result.itemId, kind: result.kind, qty: result.qty, bp: result.bp });
        } catch (e) { sendDomainError(res, e); }
      });
      return;
    }
  }

  return false;
}
module.exports = { tryWarehouseRoutes };
