'use strict';
// server/routes/me.cjs -- REQ-0047 (c): GET /api/me. Moved VERBATIM from
// server/api.cjs handle(). Returns false when not matched.
const { sendJSON, getAuthToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');

function tryMeRoute(req, res, url, p) {
  // REQ-0037: /api/me now resolves the caller via the X-Auth-Token
  // header (falling back to the dev player when dev_mode is true and no
  // token was sent at all). 401 for a present-but-unknown token, or an
  // absent token with dev_mode:false.
  if (p === '/api/me' && req.method === 'GET') {
    try {
      const resolved = admin.resolveAuth(getAuthToken(req));
      if (!resolved.ok) {
        sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
        return;
      }
      const player = resolved.player;
      sendJSON(res, 200, { playerId: player.playerId, name: player.name, roles: player.roles });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'me read failed: ' + e.message });
    }
    return;
  }


  return false;
}
module.exports = { tryMeRoute };
