'use strict';
// server/routes/skins.cjs -- REQ-0266: the PER-PROFILE skin selection surface.
// Profile-scoped and AUTH'd, modelled on routes/bio.cjs:
//   GET  /api/profile/:id/skins  -> { ok, skins: { unit:{}, bpskin:{} } }
//   PUT  /api/profile/:id/skins  -> body { unit?:{}, bpskin?:{} }, MERGE semantics
//
// It is a SEPARATE route (and a separate storage root) from the canvas because
// writeProfile() replaces `canvas` wholesale on every PUT -- see
// server/storage/skin_prefs.cjs's header for the full argument. routes/profile.cjs
// matches ONLY /api/profile/:id/canvas, so this path falls through to here at the
// router tail and collides with nothing.
//
// SEMANTICS (REQ-0266 D-B):
//   * MERGE, not replace. A slot map absent from the body is untouched; a unit key
//     absent from a supplied map is untouched.
//   * `null` CLEARS a key back to the def-declared default. That is the only way
//     back to the default, and it is why absence and null are NOT the same thing
//     in the body (they are the same thing in the STORE).
//   * Absence at every level -- no row, no map, no key -- resolves to the default.
//   * A pick whose skin id no longer exists in the corpus reads as ABSENT. A
//     deleted skin must never blank a unit.
// Every skin id in a PUT is validated against the LIVE corpus: it must exist, its
// `slot` must match the map it was written to, and it must list the unit in units[].
const { sendJSON, readBody } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const content = require('../lib/content.cjs');

const SKINS_RE = /^\/api\/profile\/([^/]+)\/skins$/;
// A selection is a few dozen short strings; 64 KB is already absurdly generous.
// Deliberately TIGHTER than the shared MAX_BODY_BYTES readBody enforces (which
// exists for canvases), so a runaway client cannot park a megabyte of junk in a
// preference row.
const MAX_SKINS_BODY_BYTES = 64 * 1024;

/** The live unit_skin corpus (id -> def) as /api/content serves it -- the SAME
 * registry-first payload the client's resolution chains read, so a pick this
 * route accepts is a pick the renderer can actually resolve. Never throws: a
 * content read failure degrades to shape-only validation rather than 500ing a
 * cosmetic preference. */
function skinDefsById() {
  try { return content.unitSkinsFromCore().unit_skins || null; }
  catch (e) { return null; }
}

function trySkinsRoutes(req, res, url, p) {
  const m = SKINS_RE.exec(p);
  if (!m) return false;
  const urlPlayerId = decodeURIComponent(m[1]);
  const resolved = admin.resolveAuthFromRequest(req);
  if (!resolved.ok) { sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason }); return; }
  const actualPlayer = resolved.player;
  // REQ-0037 compat alias + REQ-0214 e2e identity, reproduced from
  // routes/profile.cjs:33-34 VERBATIM in intent: the literal segment "default"
  // aliases WHATEVER identity the dev_mode NO-token fallback resolved to (the dev
  // player for a human on the box, or e2e_<suffix> when the request carries
  // x-bpk-e2e-profile). Keyed off the resolver's own annotation, not a playerId
  // comparison, so the alias follows the redirect -- the e2e suite reaches its own
  // profile's skins through /api/profile/default/skins exactly as it does for the canvas.
  const isDefaultAlias = urlPlayerId === 'default' && resolved.viaDevFallback === true;
  const effectivePlayerId = isDefaultAlias ? actualPlayer.playerId : urlPlayerId;
  if (!isDefaultAlias && effectivePlayerId !== actualPlayer.playerId) {
    sendJSON(res, 403, { ok: false, error: 'forbidden: token does not authorize profile "' + urlPlayerId + '"' });
    return;
  }

  if (req.method === 'GET') {
    try {
      // Filtered through the corpus on the way out: an unknown/deleted skin id
      // reads as absent, so the unit falls back to its default instead of blanking.
      const skins = storage.resolveSkinPrefs(storage.readSkinPrefs(effectivePlayerId), skinDefsById());
      sendJSON(res, 200, { ok: true, skins: skins });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'read failed: ' + e.message });
    }
    return;
  }

  if (req.method === 'PUT') {
    readBody(req, (err, bodyStr) => {
      if (err) {
        if (err.code === 'TOO_LARGE') { sendJSON(res, 413, { ok: false, error: 'request body too large' }); }
        else { sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message }); }
        return;
      }
      if (Buffer.byteLength(bodyStr || '') > MAX_SKINS_BODY_BYTES) {
        sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_SKINS_BODY_BYTES + ' bytes' });
        return;
      }
      let patch;
      try { patch = JSON.parse(bodyStr || '{}'); }
      catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
      try { storage.validateSkinPrefsPatch(patch, skinDefsById()); }
      catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
      try {
        storage.mergeSkinPrefs(effectivePlayerId, patch);
        const skins = storage.resolveSkinPrefs(storage.readSkinPrefs(effectivePlayerId), skinDefsById());
        sendJSON(res, 200, { ok: true, skins: skins });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'write failed: ' + e.message });
      }
    });
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'method not allowed' });
}
module.exports = { trySkinsRoutes, MAX_SKINS_BODY_BYTES };
