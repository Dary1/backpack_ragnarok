'use strict';
// server/routes/notifications.cjs -- REQ-0327: the per-player notification
// feed read/ack surface. ONE mechanism a human DEVICE and a bot PROGRAM
// consume identically -- auth is the standard admin.resolveAuthFromRequest
// (a Supabase Bearer JWT first, then the REQ-0037 X-Auth-Token path + the
// dev_mode fallback), so a bot account reads its OWN feed exactly the way a
// human does (owner spec item 7 falls out for free). Poll transport only:
// a real SSE/WS push is explicitly out of scope for v1. The feed logic
// lives in server/services/notifications.cjs; this module is the thin HTTP
// adapter, mirroring server/routes/bio.cjs's shape.
//   GET  /api/notifications?since=<id>   -> { ok, notifications:[...], cursor }
//   POST /api/notifications/ack {ids:[]} -> { ok, acked }
const { sendJSON, readBody } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const notifications = require('../services/notifications.cjs');

function tryNotificationsRoutes(req, res, url, p) {
  if (p === '/api/notifications') {
    if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    const resolved = admin.resolveAuthFromRequest(req);
    if (!resolved.ok) { sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason }); return; }
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : null;
    const { notifications: entries, cursor } = notifications.list(resolved.player.playerId, since);
    sendJSON(res, 200, { ok: true, notifications: entries, cursor });
    return;
  }
  if (p === '/api/notifications/ack') {
    if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
    const resolved = admin.resolveAuthFromRequest(req);
    if (!resolved.ok) { sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason }); return; }
    readBody(req, (err, bodyStr) => {
      if (err) { sendJSON(res, 400, { ok: false, error: 'bad body' }); return; }
      let body;
      try { body = JSON.parse(bodyStr || '{}'); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid json' }); return; }
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const acked = notifications.ack(resolved.player.playerId, ids);
      sendJSON(res, 200, { ok: true, acked });
    });
    return;
  }
  return false;
}
module.exports = { tryNotificationsRoutes };
