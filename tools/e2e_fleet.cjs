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
  // REQ-0062: overlay THIS worktree's live_packs.json (themed pack catalog --
  // clockwork/ember -- not yet on master) so the isolated e2e backend serves it,
  // exactly like the REQ-0051 starter-content overlay just below. __dirname is the
  // worktree's tools/, so this reads the worktree copy (with the new packs), not REPO.
  { const _wtPacks = path.join(__dirname, '..', 'content', 'live', 'live_packs.json');
    if (fs.existsSync(_wtPacks)) fs.copyFileSync(_wtPacks, path.join(bp, 'content', 'live', 'live_packs.json')); }
  // REQ-0204: overlay THIS worktree's live_tms.json (the 4 placeholder TM
  // currencies -- ember/frost/verdant/void -- not yet on master) onto the isolated
  // e2e backend's content/live, so the market regression exercises the real 5-TM
  // registry instead of master's lrdst-only fixture. Same overlay idiom + guard as
  // the REQ-0062 live_packs.json copy just above.
  { const _wtTms = path.join(__dirname, '..', 'content', 'live', 'live_tms.json');
    if (fs.existsSync(_wtTms)) fs.copyFileSync(_wtTms, path.join(bp, 'content', 'live', 'live_tms.json')); }
  // REQ-0051: overlay this worktree's starter content (not yet on master)
  // so the e2e backend serves it. Additive + guarded -- only files present in
  // the worktree are copied; nothing about the REPO copy above changes.
  {
    const wtLive = path.join(__dirname, "..", "content", "live");
    for (const f of ["starter_items.json", "starter_units.json"]) {
      const src = path.join(wtLive, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bp, "content", "live", f));
    }
  }
  // REQ-0211: overlay THIS worktree's dungeon domain (content/live/dungeon) so the
  // isolated e2e backend serves gimics.json -- the trap / treasure box / hidden door
  // interactables (the gimic content kind) that REPLACED entities.json and are not yet
  // on master. The bulk cpSync above copied REPO's dungeon dir (still entities.json), so
  // WITHOUT this the worktree's api.cjs (whose dungen/core now read gimics.json) would
  // ENOENT on the missing file and 500 /api/content. Same "worktree overlay, not yet on
  // master" idiom as the live_packs.json copy above; replaces the whole dir so the stale
  // entities.json does not linger beside the new gimics.json.
  {
    const _wtDungeon = path.join(__dirname, "..", "content", "live", "dungeon");
    if (fs.existsSync(_wtDungeon)) {
      fs.rmSync(path.join(bp, "content", "live", "dungeon"), { recursive: true, force: true });
      fs.cpSync(_wtDungeon, path.join(bp, "content", "live", "dungeon"), { recursive: true });
    }
  }
  const cfg = path.join(REPO, 'data', 'config');
  if (fs.existsSync(cfg)) fs.cpSync(cfg, path.join(bp, 'data', 'config'), { recursive: true });
  // REQ-0083 F: seed the WHOLE profiles dir -- the dev player uses data/profiles/dev.json
  // (default.json is only a legacy migration seed); copying just default.json under-seeds it.
  const profs = path.join(REPO, 'data', 'profiles');
  if (fs.existsSync(profs)) fs.cpSync(profs, path.join(bp, 'data', 'profiles'), { recursive: true });
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
