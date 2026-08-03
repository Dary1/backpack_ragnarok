'use strict';
// server/router.cjs -- REQ-0047 (c): THE dispatch order, extracted from
// server/api.cjs's former 680-line handle(). Route modules return false
// when they did not match; the first non-false result wins. THE ORDER IS
// LOAD-BEARING and byte-for-byte preserves the old if-chain:
//   public (health/content/dungeons -- dungeons MUST precede the schedule
//   auth gate, see routes/public.cjs) -> me -> admin -> profile ->
//   schedule -> market -> ragnarok -> dex -> dismantle -> 404. (REQ-0064:
//   market appended at the tail -- /api/market/* collides with nothing, so
//   its position is the one order-safe spot: after every pre-existing
//   route, before the 404. REQ-0066: ragnarok appended after market for
//   the identical reason -- /api/ragnarok/* collides with nothing.
//   REQ-0052: dex appended after ragnarok for the identical reason --
//   /api/dex/* collides with nothing. REQ-0063: dismantle appended last,
//   identical reason -- /api/dismantle* collides with nothing. REQ-0266:
//   skins appended at the very tail -- routes/profile.cjs matches ONLY
//   /api/profile/:id/canvas, so /api/profile/:id/skins falls through to it.)
const { sendJSON } = require('./lib/http_util.cjs');
const { tryPublicRoutes } = require('./routes/public.cjs');
const { tryMeRoute } = require('./routes/me.cjs');
const { tryAdminRoutes } = require('./routes/admin.cjs');
const { tryProfileRoutes } = require('./routes/profile.cjs');
const { tryScheduleRoutes } = require('./routes/schedule.cjs');
const { tryWarehouseRoutes } = require('./routes/warehouse.cjs'); // REQ-0145a (se)
const { tryWorkshopRoutes } = require('./routes/workshop.cjs'); // REQ-0145a (se)
const { tryMarketRoutes } = require('./routes/market.cjs'); // REQ-0064
const { tryRagnarokRoutes } = require('./routes/ragnarok.cjs'); // REQ-0066
const { tryDexRoutes } = require('./routes/dex.cjs'); // REQ-0052
const { tryDismantleRoutes } = require('./routes/dismantle.cjs'); // REQ-0063
const { tryArtRoutes } = require('./routes/art.cjs'); // REQ-0151
const { tryContentRoutes } = require('./routes/content.cjs'); // REQ-0155
const { tryStarterRoutes } = require('./routes/starter.cjs'); // REQ-0051
const { tryBioRoutes } = require('./routes/bio.cjs'); // REQ-0060
const { trySkinsRoutes } = require('./routes/skins.cjs'); // REQ-0266
const { tryNotificationsRoutes } = require('./routes/notifications.cjs'); // REQ-0327: per-player notification feed (device + bot)

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (tryPublicRoutes(req, res, url, p) !== false) return;
  if (tryMeRoute(req, res, url, p) !== false) return;
  if (tryAdminRoutes(req, res, url, p) !== false) return;
  if (tryProfileRoutes(req, res, url, p) !== false) return;
  if (tryScheduleRoutes(req, res, url, p) !== false) return;
  if (tryWarehouseRoutes(req, res, url, p) !== false) return; // REQ-0145a (se): schedule -> warehouse -> workshop dispatch consecutively in the exact slot the combined module occupied (identical match set)
  if (tryWorkshopRoutes(req, res, url, p) !== false) return; // REQ-0145a (se)
  if (tryMarketRoutes(req, res, url, p) !== false) return; // REQ-0064
  if (tryRagnarokRoutes(req, res, url, p) !== false) return; // REQ-0066
  if (tryDexRoutes(req, res, url, p) !== false) return; // REQ-0052
  if (tryDismantleRoutes(req, res, url, p) !== false) return; // REQ-0063: /api/dismantle* collides with nothing, appended at the tail
  if (tryArtRoutes(req, res, url, p) !== false) return; // REQ-0151: /api/art/* collides with nothing, appended at the tail
  if (tryContentRoutes(req, res, url, p) !== false) return; // REQ-0155: /api/content/defs/* + /api/content/<name>[/meta] collide with nothing (public.cjs owns the exact /api/content payload), appended at the tail
  if (tryStarterRoutes(req, res, url, p) !== false) return; // REQ-0051: /api/starter/* collides with nothing, appended at the tail
  if (tryBioRoutes(req, res, url, p) !== false) return; // REQ-0060: /api/bio/* appended at the tail, collides with nothing
  if (trySkinsRoutes(req, res, url, p) !== false) return; // REQ-0266: /api/profile/:id/skins appended at the tail -- routes/profile.cjs matches ONLY .../canvas, so this collides with nothing
  if (tryNotificationsRoutes(req, res, url, p) !== false) return; // REQ-0327: /api/notifications* appended at the tail, collides with nothing
  sendJSON(res, 404, { ok: false, error: 'not found' });
}
module.exports = { handle };
