'use strict';
// server/router.cjs -- REQ-0047 (c): THE dispatch order, extracted from
// server/api.cjs's former 680-line handle(). Route modules return false
// when they did not match; the first non-false result wins. THE ORDER IS
// LOAD-BEARING and byte-for-byte preserves the old if-chain:
//   public (health/content/dungeons -- dungeons MUST precede the schedule
//   auth gate, see routes/public.cjs) -> me -> admin -> profile ->
//   schedule -> market -> 404. (REQ-0064: market appended at the tail --
//   /api/market/* collides with nothing, so its position is the one
//   order-safe spot: after every pre-existing route, before the 404.)
const { sendJSON } = require('./lib/http_util.cjs');
const { tryPublicRoutes } = require('./routes/public.cjs');
const { tryMeRoute } = require('./routes/me.cjs');
const { tryAdminRoutes } = require('./routes/admin.cjs');
const { tryProfileRoutes } = require('./routes/profile.cjs');
const { tryScheduleRoutes } = require('./routes/schedule.cjs');
const { tryMarketRoutes } = require('./routes/market.cjs'); // REQ-0064

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (tryPublicRoutes(req, res, url, p) !== false) return;
  if (tryMeRoute(req, res, url, p) !== false) return;
  if (tryAdminRoutes(req, res, url, p) !== false) return;
  if (tryProfileRoutes(req, res, url, p) !== false) return;
  if (tryScheduleRoutes(req, res, url, p) !== false) return;
  if (tryMarketRoutes(req, res, url, p) !== false) return; // REQ-0064
  sendJSON(res, 404, { ok: false, error: 'not found' });
}
module.exports = { handle };
