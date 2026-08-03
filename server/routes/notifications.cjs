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
// REQ-0349: the request preamble (caller resolution, the 405 guard, the JSON
// body read) comes from lib/route_kit.cjs instead of being open-coded here.
const { sendJSON } = require('../lib/http_util.cjs');
const { resolveCallerOr401, methodGuard, withJsonBody } = require('../lib/route_kit.cjs');
const notifications = require('../services/notifications.cjs');

function tryNotificationsRoutes(req, res, url, p) {
  if (p === '/api/notifications') {
    if (!methodGuard(req, res, 'GET')) return;
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : null;
    const { notifications: entries, cursor } = notifications.list(ctx.callerId, since);
    sendJSON(res, 200, { ok: true, notifications: entries, cursor });
    return;
  }
  if (p === '/api/notifications/ack') {
    if (!methodGuard(req, res, 'POST')) return;
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    withJsonBody(req, res, {}, (body) => {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const acked = notifications.ack(ctx.callerId, ids);
      sendJSON(res, 200, { ok: true, acked });
    });
    return;
  }
  return false;
}
module.exports = { tryNotificationsRoutes };
