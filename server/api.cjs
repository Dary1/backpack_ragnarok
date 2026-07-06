#!/usr/bin/env node
// backpack_ragnarok — server/api.cjs
// REQ-0024: Node API service, node:http only (no framework deps).
// Listens on 127.0.0.1:8802. Endpoints:
//   GET  /api/health
//   GET  /api/content (items+sis+tms, REQ-0042)
//   GET  /api/me
//   PUT  /api/admin/item/:id
//   POST /api/admin/warehouse/grant                      (REQ-0041 feedback 1, dev grant)
//   GET  /api/profile/:playerId/canvas
//   PUT  /api/profile/:playerId/canvas
//   POST   /api/schedule/rooms                          (REQ-0036 P1-B; REQ-0043: dungeonType + dev/item_admin-only genSeed)
//   GET    /api/schedule/rooms
//   GET    /api/schedule/rooms/:id
//   DELETE /api/schedule/rooms/:id
//   PUT    /api/schedule/rooms/:id/slots/:slotIndex
//   PUT    /api/schedule/rooms/:id/swap
//   GET    /api/schedule/rooms/:id/run
//   GET    /api/schedule/dungeons                        (REQ-0036 P1-C, no auth; REQ-0043: now also lists generator `types`)
//   POST   /api/schedule/rooms/:id/dev/backdate           (REQ-0036 P1-C, dev-only)
//   GET    /api/warehouse
//   POST   /api/warehouse/claim
//   POST   /api/workshop/gacha                        (REQ-0042)
//
// REQ-0037: auth is now token-based (X-Auth-Token header), resolved via
// admin.cjs's resolveAuth()/isItemAdminToken(). See
// docs/REQ/REQ-0037-guest-auth.md for the full design:
//   - /api/me: 200 {playerId,name,roles} for the resolved player (valid
//     token, or no-token+dev_mode fallback to the dev player); 401 if a
//     token is present but unknown, or absent with dev_mode:false.
//   - /api/profile/:playerId/canvas: the URL's :playerId is NEVER trusted
//     as auth -- the ACTUAL player is resolved from the token, and the
//     request is rejected (403) if that player's own id doesn't match
//     the URL. The literal id "default" is a dev_mode-only compat alias
//     for the dev player (old E2E specs / hardcoded call sites).
//   - PUT /api/admin/item/:id: same token resolution, then an
//     item_admin role check -- unchanged 403 status convention from
//     REQ-0035, mechanism replaced.
'use strict';
// REQ-0047 (c): this file is now the thin service entry point. The former
// single-file implementation was decomposed VERBATIM into lib/ (content
// cache, http plumbing, humanize, meta), routes/ (public, me, admin,
// profile, schedule) and router.cjs (the load-bearing dispatch order).
// Exported surface ({handle, buildContentPayload, getContent, VERSION})
// and the systemd entry command (node server/api.cjs) are unchanged.
const http = require('http');
const admin = require('./admin.cjs');
const schedule = require('./schedule.cjs');
const { handle } = require('./router.cjs');
const { buildContentPayload, getContent } = require('./lib/content.cjs');
const { sendJSON } = require('./lib/http_util.cjs');
const { HOST, PORT, VERSION } = require('./lib/meta.cjs');

const WAREHOUSE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
function sweepAllWarehouses() {
  const players = require('./players.cjs');
  for (const player of players.listPlayers()) {
    try { schedule.purgeExpiredWarehouseItems(player.playerId); } catch (e) { /* best-effort */ }
  }
}

function main() {
  admin.ensureDevUser(); // REQ-0035: create data/config/dev_user.json with defaults if missing
  admin.ensureDevPlayer(); // REQ-0037: create/refresh data/players/dev.json, log the token once on first creation
  const sweepTimer = setInterval(sweepAllWarehouses, WAREHOUSE_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'internal error: ' + e.message });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log('backpack-api listening on http://' + HOST + ':' + PORT + ' (v' + VERSION + ')');
  });
}

if (require.main === module) {
  main();
}

module.exports = { handle, buildContentPayload, getContent, VERSION };
