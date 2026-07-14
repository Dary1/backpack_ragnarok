'use strict';
// server/routes/me.cjs -- REQ-0047 (c): GET /api/me. REQ-0118c: /api/me now
// resolves through admin.resolveAuthFromRequest (Supabase JWT first, then
// the REQ-0037 X-Auth-Token path + dev_mode fallback), and this module also
// owns POST /api/auth/link -- attaching a verified Supabase identity to the
// caller's EXISTING invite/guest player WITHOUT losing their profile.
const { sendJSON, getAuthToken, getBearerToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const players = require('../players.cjs');
const supabaseAuth = require('../lib/supabase_auth.cjs');
const content = require('../lib/content.cjs'); // REQ-0180
const storage = require('../storage.cjs'); // REQ-0180

// REQ-0180: which unit_skin/1 SETS may this player choose from? Availability is
// PROFILE-scoped, but there is NO acquisition flow yet (user 2026-07-15: no
// funnel, all-available is fine). A profile MAY carry an optional `unit_skins`
// allowlist; absent -> every defined set. Never throws -- a read failure
// degrades to all-available, exactly as the client's allUnitSkinKeys() floor.
function allUnitSkinKeys() {
  try { const doc = content.getContent(); return ((doc.unit_skins && doc.unit_skins.entries) || []).map((e) => e && e.id).filter(Boolean); }
  catch (e) { return []; }
}
function availableUnitSkins(playerId) {
  const all = allUnitSkinKeys();
  try {
    const prof = storage.readProfile(playerId);
    const allow = prof && Array.isArray(prof.unit_skins) ? prof.unit_skins : null;
    return allow ? all.filter((k) => allow.includes(k)) : all;
  } catch (e) { return all; }
}

function tryMeRoute(req, res, url, p) {
  if (p === '/api/me' && req.method === 'GET') {
    try {
      const resolved = admin.resolveAuthFromRequest(req);
      if (!resolved.ok) {
        sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
        return;
      }
      const player = resolved.player;
      sendJSON(res, 200, { playerId: player.playerId, name: player.name, roles: player.roles, unitSkins: availableUnitSkins(player.playerId) });
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
