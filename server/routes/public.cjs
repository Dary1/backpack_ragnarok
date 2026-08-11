'use strict';
// server/routes/public.cjs -- REQ-0047 (c): the no-auth reads
// (/api/health, /api/content, /api/schedule/dungeons). Bodies moved
// VERBATIM from server/api.cjs
// handle(). Contract: returns false when no route here matched (router
// falls through), anything else = handled.
const { sendJSON } = require('../lib/http_util.cjs');
const { getContent } = require('../lib/content.cjs');
const { VERSION, BUILD_SHA } = require('../lib/meta.cjs');
const schedule = require('../schedule.cjs');

// REQ-0341: the PUBLIC client config the browser needs before it can build
// its Supabase client. Read from THIS process's environment on every request
// (server/.env via the systemd unit's EnvironmentFile), never from a file
// this repo tracks, and never logged.
//
// Absent or blank => null, with a 200. A 500 here would be wrong: the client
// must degrade to the REQ-0118c "not configured" sign-in note exactly as it
// did when the values were missing from the build, not crash boot.
function envOrNull(name) {
  const v = process.env[name];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// REQ-0344: an e2e-only speed knob for the artwork admin console, and the ONE
// place its production value cannot be reached from.
//
// ArtAdminPage polls the queue and the selected artwork's detail every 2000 ms
// and the registry list every 10000 ms. tools/artadmin_e2e.sh holds each mock
// job ART_MOCK_DELAY_MS in flight so the queue states stay observable, and its
// 1500 ms was chosen AGAINST that 2000 ms poll -- the two are one setting wearing
// two names. Shortening the poll lets the delay shrink with it, so both live in
// that harness's single env block and can never drift apart.
//
// Served, not built in. web/app is a TRACKED build artifact; REQ-0341 exists
// because making its bytes depend on env is how sign-in shipped broken TWICE.
// A Vite-inlined `import.meta.env.VITE_ART_POLL_MS` would re-arm exactly that,
// and would additionally make the tracked bundle differ between a run that set
// the knob and one that did not.
//
// The key is OMITTED (not null) when the env is absent, so an ordinary server's
// /api/config body is byte-for-byte the one REQ-0341 shipped -- which the three
// deepStrictEqual cases in server/tests/api/public.cjs already assert, and which
// therefore now double as the regression guard for THIS field.
function positiveIntOrNull(name) {
  const v = process.env[name];
  if (typeof v !== 'string') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function publicClientConfig() {
  const cfg = {
    supabaseUrl: envOrNull('SUPABASE_URL'),
    supabaseAnonKey: envOrNull('SUPABASE_ANON_KEY'),
  };
  const pollMs = positiveIntOrNull('ART_ADMIN_POLL_MS');
  if (pollMs !== null) cfg.artAdminPollMs = pollMs;
  return cfg;
}

function tryPublicRoutes(req, res, url, p) {
  // REQ-0377 item 2: `build` is the short commit sha of the tree THIS
  // process is running from (lib/meta.cjs, resolved once at load), so a bug
  // report can name a build. It rides /api/health rather than /api/config
  // deliberately: health is already the service-IDENTITY endpoint, and
  // /api/config's body is asserted with deepStrictEqual in three places
  // (server/tests/api/public.cjs) precisely so it stays byte-for-byte what
  // REQ-0341 shipped -- REQ-0344 leaned on that guard, and an always-present
  // field there would spend it. Never absent: 'unknown' is the floor.
  if (p === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, version: VERSION, build: BUILD_SHA });
    return;
  }

  // REQ-0341: GET /api/config -- no auth, same posture as /api/health and
  // /api/content above. Both values are PUBLIC client credentials (the anon
  // key is designed to live in a browser); this endpoint exposes nothing a
  // downloaded bundle did not already expose. no-store because the point of
  // serving them at runtime is that a rotation needs no client rebuild.
  if (p === '/api/config' && req.method === 'GET') {
    sendJSON(res, 200, publicClientConfig(), { 'Cache-Control': 'no-store' });
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

  return false;
}
module.exports = { tryPublicRoutes, publicClientConfig };
