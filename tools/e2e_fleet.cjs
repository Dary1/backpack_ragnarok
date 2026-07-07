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
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const REPO = path.join(os.homedir(), 'backpack_ragnarok');
const ROOT = '/tmp/bp_e2e_workers';
const MANIFEST = path.join(ROOT, 'manifest.json');
const BASE_PORT = Number(process.env.E2E_FLEET_BASE_PORT || 8810);
const API_ENTRY = path.join(__dirname, '..', 'server', 'api.cjs'); // this worktree's api (PORT env-aware); content/data still sourced from REPO

function buildHome(i) {
  const dir = path.join(ROOT, 'w' + i);
  const bp = path.join(dir, 'home', 'backpack_ragnarok');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(bp, 'content'), { recursive: true });
  fs.mkdirSync(path.join(bp, 'data', 'profiles'), { recursive: true });
  for (const e of fs.readdirSync(path.join(REPO, 'content'))) {
    if (e === 'live') continue; // live/* is mutated -> per-worker copy below
    fs.symlinkSync(path.join(REPO, 'content', e), path.join(bp, 'content', e));
  }
  fs.cpSync(path.join(REPO, 'content', 'live'), path.join(bp, 'content', 'live'), { recursive: true });
  const cfg = path.join(REPO, 'data', 'config');
  if (fs.existsSync(cfg)) fs.cpSync(cfg, path.join(bp, 'data', 'config'), { recursive: true });
  const def = path.join(REPO, 'data', 'profiles', 'default.json');
  if (fs.existsSync(def)) fs.cpSync(def, path.join(bp, 'data', 'profiles', 'default.json'));
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
  killManifest(); // clean any stale fleet from a crashed prior run
  fs.mkdirSync(ROOT, { recursive: true });
  const workers = [];
  for (let i = 0; i < N; i++) {
    const home = buildHome(i);
    const port = BASE_PORT + i;
    const logFd = fs.openSync(path.join(ROOT, 'w' + i, 'api.log'), 'w');
    const child = spawn(process.execPath, [API_ENTRY], {
      env: { ...process.env, HOME: home, STORAGE_BACKEND: 'files', PORT: String(port), DATABASE_URL: '' },
      detached: true, stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    workers.push({ i, port, pid: child.pid, home });
  }
  for (const w of workers) await waitHealth(w.port, 20000);
  fs.writeFileSync(MANIFEST, JSON.stringify({ workers }, null, 2));
  console.log('[fleet] started ' + N + ' isolated api workers: ' + workers.map((w) => w.i + '->:' + w.port).join(' '));
}

function stop() {
  killManifest();
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log('[fleet] stopped + cleaned');
}

const cmd = process.argv[2];
if (cmd === 'start') start(Number(process.argv[3] || 4)).catch((e) => { console.error('[fleet] start failed:', e.message); process.exit(1); });
else if (cmd === 'stop') stop();
else { console.error('usage: node tools/e2e_fleet.cjs start <N> | stop'); process.exit(1); }
