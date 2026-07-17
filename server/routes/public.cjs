'use strict';
// server/routes/public.cjs -- REQ-0047 (c): the no-auth reads
// (/api/health, /api/content, /api/schedule/dungeons; REQ-0057 adds
// /api/schedule/forecast). Bodies moved VERBATIM from server/api.cjs
// handle(). Contract: returns false when no route here matched (router
// falls through), anything else = handled.
const { sendJSON } = require('../lib/http_util.cjs');
const { getContent } = require('../lib/content.cjs');
const { getForecast } = require('../lib/forecast.cjs'); // REQ-0057
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
      // REQ-0185: `types` (the retired sim/dungen.cjs generator list) is gone; the
      // client now picks an authored dungeon DEF from `dungeons` (each carrying theme,
      // levelMin/Max and an encounterSummary -- design D2/D3).
      sendJSON(res, 200, { ok: true, dungeons: payload.dungeons, formations: payload.formations });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'dungeons read failed: ' + e.message });
    }
    return;
  }

  // REQ-0057: GET /api/schedule/forecast?dungeonType=&level= -- the Ray
  // Forecast Overlay's content feed: every (enemy, skill) attack profile a
  // level-L <type> dungeon can throw at the player field, with the entry
  // centroid and the presence weight the client needs to walk the rays
  // itself (server/lib/forecast.cjs explains the fold).
  //
  // Public + no-auth for the same reason /api/content and
  // /api/schedule/dungeons are: this is CONTENT (enemy DEFs), not run
  // state. It is derived from no room, no profile and no live seed, so
  // there is no caller identity for it to be scoped to -- and, per
  // REQ-0057's "forecast != spoiler" rule, nothing here can reveal a
  // specific run's hidden placements because it never reads one.
  // Deliberately a SEPARATE route rather than more fields on
  // /api/schedule/dungeons: that payload is (dungeonType, level)-free and
  // is fetched on every schedule page load, and bloating it with a
  // per-level fold nobody asked for would make the common path pay for the
  // rare one.
  if (p === '/api/schedule/forecast' && req.method === 'GET') {
    try {
      // REQ-0185: the forecast is keyed by a dungeon DEF id now; accept `dungeonId`
      // (new) and fall back to the legacy `dungeonType` param (server resolves either
      // to a def, defaulting to the first live def -- see lib/forecast.cjs).
      const dungeonRef = url.searchParams.get('dungeonId') || url.searchParams.get('dungeonType') || '';
      const levelRaw = url.searchParams.get('level');
      const level = levelRaw == null ? 1 : Number(levelRaw);
      if (levelRaw != null && !Number.isFinite(level)) {
        sendJSON(res, 400, { ok: false, error: 'level must be a number' });
        return;
      }
      const payload = getForecast(dungeonRef, level);
      sendJSON(res, 200, Object.assign({ ok: true }, payload));
    } catch (e) {
      if (e.code === 'BAD_REQUEST') {
        sendJSON(res, 400, { ok: false, error: e.message });
        return;
      }
      sendJSON(res, 500, { ok: false, error: 'forecast build failed: ' + e.message });
    }
    return;
  }

  return false;
}
module.exports = { tryPublicRoutes };
