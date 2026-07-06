'use strict';
// server/routes/admin.cjs -- REQ-0047 (c): the two item_admin-gated
// routes (PUT /api/admin/item/:id, POST /api/admin/warehouse/grant).
// Moved VERBATIM from server/api.cjs handle(); the only edit is
// contentCache = null -> invalidateContentCache() (same effect, the
// cache is module-private in lib/content.cjs now). Returns false when
// not matched.
const { sendJSON, readBody, getAuthToken, MAX_BODY_BYTES } = require('../lib/http_util.cjs');
const { invalidateContentCache } = require('../lib/content.cjs');
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
  // COMBINED item defs (schedule.getScheduleContent().itemDefsById, the
  // same map claimWarehouseItem/settleRun already trust) before inserting
  // -- 400 for an unknown id, never a silent insert of a dangling
  // reference.
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
          const resolved = admin.resolveAuth(token);
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
        const { itemDefsById } = schedule.getScheduleContent();
        if (!itemDefsById[body.itemId]) {
          sendJSON(res, 400, { ok: false, error: 'unknown item id "' + body.itemId + '"' });
          return;
        }
        // The caller's OWN playerId (resolved from the token, same as
        // every other authenticated route -- never trusts a client-
        // supplied id) is who the grant lands in the warehouse for.
        const resolved = admin.resolveAuth(token);
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
