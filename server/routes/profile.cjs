'use strict';
// server/routes/profile.cjs -- REQ-0047 (c): profile canvas GET/PUT
// (ownership 401/403 matrix, REQ-0037 "default" dev alias, REQ-0041/42
// best-effort claim/gacha finalize on save). Moved VERBATIM from
// server/api.cjs handle(). Returns false when not matched.
const { sendJSON, readBody, MAX_BODY_BYTES } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const schedule = require('../schedule.cjs');

const PROFILE_CANVAS_RE = /^\/api\/profile\/([^/]+)\/canvas$/;

function tryProfileRoutes(req, res, url, p) {
  const m = PROFILE_CANVAS_RE.exec(p);
  if (m) {
    const urlPlayerId = m[1];
    const resolved = admin.resolveAuthFromRequest(req);
    if (!resolved.ok) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
      return;
    }
    const actualPlayer = resolved.player;
    // REQ-0037 compat alias: the literal URL segment "default" maps to
    // the dev player's OWN profile, but ONLY while dev_mode is true (see
    // docs/REQ/REQ-0037-guest-auth.md's "Compat alias" note). Outside of
    // that window "default" is just an unknown/mismatched id like any
    // other and falls through to the normal ownership check below.
    // REQ-0214: 'default' aliases WHATEVER identity the dev_mode NO-token
    // fallback resolved to -- the dev player for a human on the box, or
    // e2e_<suffix> when the request carries x-bpk-e2e-profile (e2e profile
    // isolation). Keyed off the resolver's own annotation, not a playerId
    // comparison, so the alias follows the redirect.
    const isDefaultAlias = urlPlayerId === 'default' && resolved.viaDevFallback === true;
    const effectivePlayerId = isDefaultAlias ? actualPlayer.playerId : urlPlayerId;

    if (!isDefaultAlias && effectivePlayerId !== actualPlayer.playerId) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: token does not authorize profile "' + urlPlayerId + '"' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const doc = storage.readProfile(effectivePlayerId);
        if (!doc) {
          sendJSON(res, 404, { ok: false, error: 'no saved canvas for this profile' });
          return;
        }
        sendJSON(res, 200, doc);
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'read failed: ' + e.message });
      }
      return;
    }

    if (req.method === 'PUT') {
      readBody(req, (err, bodyStr) => {
        if (err) {
          if (err.code === 'TOO_LARGE') {
            sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
          } else {
            sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
          }
          return;
        }
        let canvas;
        try {
          canvas = JSON.parse(bodyStr);
        } catch (e) {
          sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
          return;
        }
        try {
          const doc = storage.writeProfile(effectivePlayerId, canvas);
          // REQ-0041 two-phase claim: this is THE single writer for a
          // player's own profile again (see schedule.cjs's
          // claimWarehouseItem doc for bug #3's root cause) -- so THIS is
          // also the correct, single place to finalize any of the
          // caller's 'claiming' warehouse rows whose minted uid (reused
          // from the warehouse row's own itemUid, see that same doc)
          // just landed in the saved canvas. Best-effort: a failure here
          // must never fail the profile save itself (the save already
          // succeeded by this point) -- worst case a stale 'claiming' row
          // sits until its own lazy timeout reverts it, never a lost
          // profile write.
          try { schedule.finalizeClaimingItemsForCanvas(effectivePlayerId, canvas); } catch (e2) { /* best-effort, see comment above */ }
          // REQ-0042: same best-effort finalize pass for pending gacha
          // rolls -- see schedule.cjs's finalizeGachaForCanvas doc for
          // why its finalize condition (uid-presence AND balance-delta)
          // is stricter than the claim finalize above.
          try { schedule.finalizeGachaForCanvas(effectivePlayerId, canvas); } catch (e3) { /* best-effort, see comment above */ }
          sendJSON(res, 200, doc);
        } catch (e) {
          if (e.code === 'TOO_LARGE') {
            sendJSON(res, 413, { ok: false, error: e.message });
          } else {
            sendJSON(res, 500, { ok: false, error: 'write failed: ' + e.message });
          }
        }
      });
      return;
    }

    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }


  return false;
}
module.exports = { tryProfileRoutes };
