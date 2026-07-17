'use strict';
// server/routes/admin.cjs -- REQ-0047 (c): the two item_admin-gated
// routes (PUT /api/admin/item/:id, POST /api/admin/warehouse/grant).
// Moved VERBATIM from server/api.cjs handle(); the only edit is
// contentCache = null -> invalidateContentCache() (same effect, the
// cache is module-private in lib/content.cjs now). Returns false when
// not matched.
const { sendJSON, readBody, getAuthToken, MAX_BODY_BYTES } = require('../lib/http_util.cjs');
const { invalidateContentCache, registryServedKindFor } = require('../lib/content.cjs');
const admin = require('../admin.cjs');
const schedule = require('../schedule.cjs');

const ADMIN_ITEM_RE = /^\/api\/admin\/item\/([^/]+)$/;
const ADMIN_WAREHOUSE_GRANT_RE = /^\/api\/admin\/warehouse\/grant$/; // REQ-0041 feedback 1: dev grant

function tryAdminRoutes(req, res, url, p) {
  const adminItemMatch = ADMIN_ITEM_RE.exec(p);
  if (adminItemMatch && req.method === 'PUT') {
    const itemId = decodeURIComponent(adminItemMatch[1]);
    const token = getAuthToken(req);
    if (!admin.isItemAdminToken(token)) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
      return;
    }
    // REQ-0182b: this route writes content/live/*.json directly, bypassing the
    // ledger. For an id the registry SERVES (an adopted variant of a covered
    // kind) that write reaches nothing -- REQ-0178 made the display registry-
    // first and REQ-0176 made the roll and the simulation registry-first too --
    // so a 200 here would be a lie: the operator would see "saved" and the game
    // would not change. Worse, it leaves the live file diverged from the ledger,
    // which is the parity DRIFT this route has already caused on live twice
    // (a stray `dagger.stretch`, restored by hand both times).
    //
    // Refuse with a pointer to where the edit DOES reach the game. Deliberately
    // AFTER the item_admin gate: a role-less caller must still get 403, never a
    // 409 that would leak which ids are adopted. Kept as a 409 (not 410): the
    // route is alive and still correct for content the registry does not serve.
    const servedKind = registryServedKindFor(itemId);
    if (servedKind) {
      sendJSON(res, 409, {
        ok: false,
        error: 'this entity is registry-served (' + servedKind + '); edit it in the content admin, where adoption is what changes the game',
        registry_kind: servedKind,
        edit_at: '#/contentadmin/' + itemId,
      });
      return;
    }
    readBody(req, (err, bodyStr) => {
      if (err) {
        if (err.code === 'TOO_LARGE') {
          sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
        } else {
          sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
        }
        return;
      }
      let body;
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      try {
        const merged = admin.applyAdminEdit(itemId, body);
        invalidateContentCache(); // force a fresh read on the next /api/content (mtime already changed too)
        sendJSON(res, 200, { ok: true, id: itemId, item: merged });
      } catch (e) {
        const code = e.code === 'NOT_FOUND' ? 404 : 400;
        sendJSON(res, code, { ok: false, error: e.message });
      }
    });
    return;
  }
  if (adminItemMatch) {
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  // REQ-0041 feedback 1: POST /api/admin/warehouse/grant {itemId} -- dev
  // grant, gated EXACTLY like PUT /api/admin/item/:id above (same
  // admin.isItemAdminToken(token) guard, same 403 body shape/wording) --
  // mirrors that route's auth-gate style deliberately (per the task: "the
  // existing PUT /api/admin/item/:id route is presumably the sibling
  // pattern... find it and mirror its auth-gate style exactly"). Inserts
  // a warehouse row for the CALLER (the resolved item_admin themselves --
  // there is no "grant to a different player" concept here, matching
  // every other schedule/warehouse route's "always operates on the
  // caller's own data" convention), subject to the SAME cap/TTL rules
  // every other warehouse insertion goes through (schedule.cjs's
  // addToWarehouse, via grantWarehouseItem). Validates itemId against the
  // PO defs (schedule.getScheduleContent().itemDefsById) OR the SI defs
  // (siDefsById) -- REQ-0115 -- so both a PO and an SI (a live_sis.json
  // entry, e.g. acc_gem) are acceptable warehouse content; the claim path
  // (services/warehouse.cjs claimWarehouseItem) was widened to match in
  // the same REQ. 400 only for an id that is in NEITHER map, never a
  // silent insert of a dangling reference.
  const adminWarehouseGrantMatch = ADMIN_WAREHOUSE_GRANT_RE.exec(p);
  if (adminWarehouseGrantMatch && req.method === 'POST') {
    const token = getAuthToken(req);
    if (!admin.isItemAdminToken(token)) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
      return;
    }
    readBody(req, (err, bodyStr) => {
      if (err) {
        if (err.code === 'TOO_LARGE') {
          sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
        } else {
          sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
        }
        return;
      }
      let body;
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      // REQ-0042: this route now supports a 2nd grant shape --
      // {tm:'lrdst', qty:999} -- alongside the original {itemId:'blade'}
      // shape, dispatching on which field is present rather than forking
      // a new endpoint (per the REQ's own "extend it... don't fork a new
      // endpoint if extending is clean" guidance). Both branches share
      // the SAME auth gate above and the SAME addToWarehouse() cap/TTL
      // chokepoint underneath (via grantTmQty for the tm branch).
      if (typeof body.tm === 'string' && body.tm) {
        if (!Number.isFinite(body.qty) || body.qty <= 0) {
          sendJSON(res, 400, { ok: false, error: 'qty must be a positive number when granting a tm' });
          return;
        }
        try {
          const { tmDefsById } = schedule.getScheduleContent();
          if (!tmDefsById || !tmDefsById[body.tm]) {
            sendJSON(res, 400, { ok: false, error: 'unknown tm id "' + body.tm + '"' });
            return;
          }
          const resolved = admin.resolveAuthFromRequest(req); // REQ-0217: honor the e2e profile redirect (x-bpk-e2e-profile), never grant to the live dev profile from a test run
          const targetPlayerId = resolved.ok ? resolved.player.playerId : admin.readDevUser().playerId;
          const result = schedule.grantTmQty(targetPlayerId, body.tm, body.qty);
          if (!result.ok) {
            sendJSON(res, 409, { ok: false, error: 'warehouse full' });
            return;
          }
          sendJSON(res, 200, { ok: true, item: result.item });
        } catch (e) {
          sendJSON(res, 500, { ok: false, error: 'grant failed: ' + e.message });
        }
        return;
      }
      if (typeof body.itemId !== 'string' || !body.itemId) {
        sendJSON(res, 400, { ok: false, error: 'itemId (or tm+qty) is required' });
        return;
      }
      try {
        // REQ-0115: accept a PO id (itemDefsById) OR an SI id (siDefsById).
        // Before REQ-0115 this validated against itemDefsById alone (PO +
        // pilot overlay only), so EVERY SI id (acc_gem, acc_frost, ...) was
        // rejected here as "unknown item id" even though it is a valid
        // live_sis.json entry -- the reported dex Edit-Mode bug.
        const { itemDefsById, siDefsById } = schedule.getScheduleContent();
        if (!itemDefsById[body.itemId] && !siDefsById[body.itemId]) {
          sendJSON(res, 400, { ok: false, error: 'unknown item id "' + body.itemId + '"' });
          return;
        }
        // The caller's OWN playerId (resolved from the token, same as
        // every other authenticated route -- never trusts a client-
        // supplied id) is who the grant lands in the warehouse for.
        const resolved = admin.resolveAuthFromRequest(req); // REQ-0217: honor the e2e profile redirect (x-bpk-e2e-profile), never grant to the live dev profile from a test run
        const targetPlayerId = resolved.ok ? resolved.player.playerId : admin.readDevUser().playerId;
        const result = schedule.grantWarehouseItem(targetPlayerId, body.itemId);
        if (!result.ok) {
          sendJSON(res, 409, { ok: false, error: 'warehouse full' });
          return;
        }
        sendJSON(res, 200, { ok: true, item: result.item });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'grant failed: ' + e.message });
      }
    });
    return;
  }
  if (adminWarehouseGrantMatch) {
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }


  return false;
}
module.exports = { tryAdminRoutes };
