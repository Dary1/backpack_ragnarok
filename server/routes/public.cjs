'use strict';
// server/routes/public.cjs -- REQ-0047 (c): the three no-auth reads
// (/api/health, /api/content, /api/schedule/dungeons). Bodies moved
// VERBATIM from server/api.cjs handle(). Contract: returns false when no
// route here matched (router falls through), anything else = handled.
const { sendJSON } = require('../lib/http_util.cjs');
const { getContent } = require('../lib/content.cjs');
const { VERSION } = require('../lib/meta.cjs');
const schedule = require('../schedule.cjs');

function tryPublicRoutes(req, res, url, p) {
  if (p === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, version: VERSION });
    return;
  }

  if (p === '/api/content' && req.method === 'GET') {
    try {
      const payload = getContent();
      sendJSON(res, 200, payload);
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'content read failed: ' + e.message });
    }
    return;
  }

  // REQ-0036 P1-C: GET /api/schedule/dungeons -- public read data (the
  // pilot batch's one dungeon def + its 4 formation defs), matching
  // /api/content's own no-auth convention. Deliberately special-cased
  // HERE, BEFORE the schedule auth gate further down (scheduleMatch's
  // resolveAuth() call) -- this route needs no caller identity at all
  // (unlike every other /api/schedule/* route, which always operates on
  // "the caller's own rooms/warehouse"), so forcing it through
  // resolveAuth() would require a token (or a dev_mode fallback) for no
  // reason. Read-only, no body.
  if (p === '/api/schedule/dungeons' && req.method === 'GET') {
    try {
      const payload = schedule.listDungeonsAndFormations();
      // REQ-0043: `types` (sim/dungen.cjs's DUNGEON_TYPES + i18n label/
      // note) is additive -- `dungeons`/`formations` are unchanged so any
      // existing caller reading only those two fields keeps working
      // byte-for-byte.
      sendJSON(res, 200, { ok: true, dungeons: payload.dungeons, types: payload.types, formations: payload.formations });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'dungeons read failed: ' + e.message });
    }
    return;
  }


  return false;
}
module.exports = { tryPublicRoutes };
