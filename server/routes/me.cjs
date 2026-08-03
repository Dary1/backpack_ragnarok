'use strict';
// server/routes/me.cjs -- REQ-0047 (c): GET /api/me. REQ-0118c: /api/me now
// resolves through admin.resolveAuthFromRequest (Supabase JWT first, then
// the REQ-0037 X-Auth-Token path + dev_mode fallback), and this module also
// owns POST /api/auth/link -- attaching a verified Supabase identity to the
// caller's EXISTING invite/guest player WITHOUT losing their profile.
// REQ-0349: GET /api/me resolves through the kit. POST /api/auth/link keeps
// admin.resolveAuth(xToken) DELIBERATELY -- a link must prove ownership of the
// EXISTING player via the X-Auth-Token specifically, so the kit's JWT-first
// resolveCallerOr401 would be the wrong resolver there. That asymmetry is the
// point of the endpoint, not an oversight.
const { sendJSON, getAuthToken, getBearerToken } = require('../lib/http_util.cjs');
const { resolveCallerOr401 } = require('../lib/route_kit.cjs');
const admin = require('../admin.cjs');
const players = require('../players.cjs');
const supabaseAuth = require('../lib/supabase_auth.cjs');

function tryMeRoute(req, res, url, p) {
  if (p === '/api/me' && req.method === 'GET') {
    try {
      const ctx = resolveCallerOr401(req, res);
      if (!ctx) return;
      const player = ctx.player;
      sendJSON(res, 200, { playerId: player.playerId, name: player.name, roles: player.roles });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'me read failed: ' + e.message });
    }
    return;
  }

  // REQ-0118c: link a verified Supabase identity to the caller's EXISTING
  // player (invite-token, or a previously-provisioned guest), so upgrading
  // to Discord keeps the whole profile (data/profiles/ is never touched).
  // Requires BOTH an X-Auth-Token (proves ownership of the existing player)
  // AND Authorization: Bearer <supabase jwt> (the identity to attach).
  // 401 if either is missing/invalid; 409 on a link conflict.
  if (p === '/api/auth/link' && req.method === 'POST') {
    const xToken = getAuthToken(req);
    if (!xToken) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: link requires an existing session token' });
      return;
    }
    const existing = admin.resolveAuth(xToken);
    if (!existing.ok) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + existing.reason });
      return;
    }
    const v = supabaseAuth.verifySupabaseJwt(getBearerToken(req));
    if (!v.ok) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + (v.reason || 'invalid_jwt') });
      return;
    }
    try {
      const linked = players.linkAuthId(existing.player.playerId, v.claims.sub);
      sendJSON(res, 200, { ok: true, playerId: linked.playerId, name: linked.name, roles: linked.roles });
    } catch (e) {
      if (e.code === 'CONFLICT') { sendJSON(res, 409, { ok: false, error: e.message, reason: e.reason }); return; }
      if (e.code === 'BAD_REQUEST') { sendJSON(res, 400, { ok: false, error: e.message }); return; }
      sendJSON(res, 500, { ok: false, error: 'link failed: ' + e.message });
    }
    return;
  }

  return false;
}
module.exports = { tryMeRoute };
