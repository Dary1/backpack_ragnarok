'use strict';
// tools/e2e_fleet.cjs -- REQ-0083. Manage a fleet of ISOLATED backpack-api
// instances, one per Playwright worker, so the e2e suite can run in parallel
// without workers clobbering the single live profile/content.
//
// Each worker gets HOME=/tmp/bp_e2e_workers/w<i>/home containing a
// backpack_ragnarok/ whose read-only content is symlinked to the real repo and
// whose mutable state (content/live, data/) is a per-worker copy. server/api.cjs
// keys all storage off os.homedir() (server/storage.cjs REPO_ROOT/NAMESPACE), so
// a distinct HOME per process = fully isolated data + pg namespace. Files backend
// (STORAGE_BACKEND=files) keeps each worker self-contained on disk.
//
// The e2e proxy (client/e2e/local-proxy.cjs) routes /api by the X-E2E-Worker
// header to FLEET_BASE+index. Teardown kills ONLY the PIDs this script spawned
// (recorded in the manifest) -- never a broad pkill, which would take down the
// real backpack-api on :8802.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// REQ-0217 hermetic e2e: everything a worker home is built from comes from
// THIS WORKTREE (the code under test) plus committed fixtures -- never from
// the live checkout (~/backpack_ragnarok) and never from live data/.
const WT = path.join(__dirname, '..');
const FIXTURES = path.join(WT, 'client', 'e2e', 'fixtures');
// REQ-0217: overridable so concurrent sessions/worktrees can run fully
// disjoint fleets (dir + ports + proxy all scoped together via env).
const ROOT = process.env.E2E_FLEET_ROOT || '/tmp/bp_e2e_workers';
const MANIFEST = path.join(ROOT, 'manifest.json');
const BASE_PORT = Number(process.env.E2E_FLEET_BASE_PORT || 8810);
const API_ENTRY = path.join(__dirname, '..', 'server', 'api.cjs'); // this worktree's api (PORT env-aware); content/data still sourced from REPO

function buildHome(i) {
  const dir = path.join(ROOT, 'w' + i);
  const bp = path.join(dir, 'home', 'backpack_ragnarok');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(bp, 'content'), { recursive: true });
  fs.mkdirSync(path.join(bp, 'data', 'profiles'), { recursive: true });
  // Read-only content -> symlinks to the worktree; mutable content/live ->
  // a per-worker COPY of the worktree's own tree (admin-edit specs PUT real
  // edits, and the worktree IS the code+content under test -- the old
  // main-checkout sourcing plus per-file "not yet on master" overlays is
  // retired with it).
  for (const e of fs.readdirSync(path.join(WT, 'content'))) {
    if (e === 'live') continue;
    fs.symlinkSync(path.join(WT, 'content', e), path.join(bp, 'content', e));
  }
  fs.cpSync(path.join(WT, 'content', 'live'), path.join(bp, 'content', 'live'), { recursive: true });
  // Seeds come from COMMITTED fixtures only (client/e2e/fixtures/): a frozen
  // snapshot of the legacy files-backend dev state this suite has always
  // asserted against. Never sourced from the live checkout's data/.
  fs.cpSync(path.join(FIXTURES, 'config'), path.join(bp, 'data', 'config'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'profiles'), path.join(bp, 'data', 'profiles'), { recursive: true });
  return path.join(dir, 'home');
}

function waitHealth(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (r) => {
        r.resume();
        if (r.statusCode === 200) resolve(); else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
      function retry() { if (Date.now() > deadline) reject(new Error('health timeout on :' + port)); else setTimeout(poll, 200); }
    })();
  });
}

function killManifest() {
  if (!fs.existsSync(MANIFEST)) return;
  try {
    const { workers } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const w of workers) { try { process.kill(w.pid, 'SIGTERM'); } catch (e) {} }
  } catch (e) {}
}

async function start(N) {
  // REQ-0234 (F5): fail with the CAUSE, not a 20s health timeout, when the
  // worktree is under-provisioned. A fresh worktree needs pnpm install in
  // root, client/ AND server/ -- the workers ARE this worktree's api.
  try { require.resolve('pg', { paths: [path.join(WT, 'server')] }); }
  catch (e) {
    console.error('[fleet] server/node_modules is missing (cannot resolve "pg") -- run: cd server && pnpm install --frozen-lockfile');
    process.exit(1);
  }
  killManifest(); // clean any stale fleet from a crashed prior run
  // REQ-0083 G: also reclaim stale fleet PORTS (a crashed run can leave apis bound
  // with no manifest). Fleet range ONLY (BASE_PORT..BASE_PORT+N-1) -- NEVER live :8802.
  const stalePorts = Array.from({ length: N }, (_, i) => (BASE_PORT + i) + '/tcp').join(' ');
  try { spawnSync('bash', ['-c', 'fuser -k ' + stalePorts + ' 2>/dev/null']); } catch (e) {}
  fs.mkdirSync(ROOT, { recursive: true });
  const workers = [];
  for (let i = 0; i < N; i++) {
    const home = buildHome(i);
    const port = BASE_PORT + i;
    const logFd = fs.openSync(path.join(ROOT, 'w' + i, 'api.log'), 'w');
    const child = spawn(process.execPath, [API_ENTRY], {
      // REQ-0341: every fleet backend serves GET /api/config, so it needs the
      // public Supabase config in its env. SYNTHETIC values, set
      // unconditionally (never inherited from the ambient environment): the
      // run stays hermetic, no live credential is ever inside an e2e process,
      // and client/e2e/runtime-config.spec.ts can assert exact values that no
      // bundle could possibly have baked. Keep in sync with that spec.
      env: { ...process.env, HOME: home, STORAGE_BACKEND: 'files', PORT: String(port), DATABASE_URL: '',
             SUPABASE_URL: 'https://e2e-supabase.invalid', SUPABASE_ANON_KEY: 'e2e-fleet-anon-key' },
      detached: true, stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    workers.push({ i, port, pid: child.pid, home });
  }
  for (const w of workers) {
    try { await waitHealth(w.port, 20000); }
    catch (e) {
      // REQ-0234 (F5): a worker that never answered health almost always
      // crashed at require/boot time -- surface its own last words here
      // instead of leaving them in the archived log.
      try {
        const tail = fs.readFileSync(path.join(ROOT, 'w' + w.i, 'api.log'), 'utf8').trimEnd().split('\n').slice(-15);
        console.error('[fleet] worker ' + w.i + ' (:' + w.port + ') failed health -- last api.log lines:');
        for (const line of tail) console.error('  | ' + line);
      } catch (e2) { /* log unreadable -- the timeout error still names the port */ }
      throw e;
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify({ workers }, null, 2));
  console.log('[fleet] started ' + N + ' isolated api workers: ' + workers.map((w) => w.i + '->:' + w.port).join(' '));
}

function stop() {
  killManifest();
  // REQ-0217: archive per-worker api logs before wiping the tree, so a
  // worker crash mid-run stays diagnosable after teardown.
  // REQ-0234 (F4): scoped by the fleet root -- every run used to clobber one
  // global /tmp/bp_e2e_logs_last, so run B's teardown ate run A's crash
  // forensics (the default root now archives to /tmp/bp_e2e_workers_logs_last).
  const logDir = ROOT + '_logs_last';
  try {
    fs.rmSync(logDir, { recursive: true, force: true });
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(ROOT)) {
      for (const w of fs.readdirSync(ROOT)) {
        const lp = path.join(ROOT, w, 'api.log');
        if (fs.existsSync(lp)) fs.copyFileSync(lp, path.join(logDir, w + '-api.log'));
      }
    }
  } catch (e) { /* best-effort */ }
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log('[fleet] stopped + cleaned (logs archived to ' + logDir + ')');
}

const cmd = process.argv[2];
if (cmd === 'start') start(Number(process.argv[3] || 4)).catch((e) => { console.error('[fleet] start failed:', e.message); process.exit(1); });
else if (cmd === 'stop') stop();
else { console.error('usage: node tools/e2e_fleet.cjs start <N> | stop'); process.exit(1); }
