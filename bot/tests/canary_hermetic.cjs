#!/usr/bin/env node
'use strict';
// bot/tests/canary_hermetic.cjs -- REQ-0330 END-TO-END CANARY against a HERMETIC
// live-shaped API (never the real :8802, never live data). It:
//   1. builds an isolated HOME (content symlinked read-only, content/live COPIED,
//      fresh data) and boots server/api.cjs on a port-desk port (files backend);
//   2. provisions a throwaway pool (tools/fleet_pool_provision.cjs) into a
//      TEMP vault under that HOME -- real starter canvases, deployable squad 0;
//   3. one provisioned account HOSTS a recruiting troop (the "human" -- the bot
//      program itself can never host);
//   4. the FLEET drip-joins one account per tick through the real allowlisted,
//      rate-limited client + identity guard, and we ASSERT: one seat per tick,
//      NEVER a burst, the troop departs when its 4th seat fills;
//   5. tears the whole thing down (kill api, rm HOME+vault).
// Uses a SHORT join interval so the run is fast; the no-burst property is proven
// by the inter-join spacing, which the 30s production cadence only widens.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const WT = path.join(__dirname, '..', '..');            // worktree root
const API_ENTRY = path.join(WT, 'server', 'api.cjs');
const PROVISION = path.join(WT, 'tools', 'fleet_pool_provision.cjs');
const NODE = process.execPath;

const JOIN_INTERVAL_MS = 1500; // short canary cadence (production is 30000)
const FLEET_SEATS = 3;         // host holds seat 0; fleet fills seats 1..3

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(...a) { console.log('[canary]', ...a); }

function httpJson(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'Accept': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = http.request(u, { method, headers, timeout: 15000 }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => d += c);
      res.on('end', () => { let j = null; try { j = d ? JSON.parse(d) : null; } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    if (payload) req.write(payload); req.end();
  });
}

function waitHealth(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (r) => {
        r.resume(); if (r.statusCode === 200) resolve(); else retry();
      });
      req.on('error', retry); req.on('timeout', () => { req.destroy(); retry(); });
      function retry() { if (Date.now() > deadline) reject(new Error('health timeout :' + port)); else setTimeout(poll, 200); }
    })();
  });
}

function buildHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-canary-'));
  const bp = path.join(home, 'backpack_ragnarok');
  fs.mkdirSync(path.join(bp, 'content'), { recursive: true });
  fs.mkdirSync(path.join(bp, 'data', 'profiles'), { recursive: true });
  for (const e of fs.readdirSync(path.join(WT, 'content'))) {
    if (e === 'live') continue;
    fs.symlinkSync(path.join(WT, 'content', e), path.join(bp, 'content', e));
  }
  fs.cpSync(path.join(WT, 'content', 'live'), path.join(bp, 'content', 'live'), { recursive: true });
  return home;
}

async function main() {
  const port = String(execFileSync('bash', [path.join(WT, 'tools', 'port_desk.sh')]).toString().trim());
  const base = 'http://127.0.0.1:' + port;
  const home = buildHome();
  const vaultRoot = path.join(home, 'backpack_fleet', 'agents');
  log('hermetic HOME=' + home + ' port=' + port);

  let api;
  const failures = [];
  const T = (name, cond) => { if (cond) { console.log('PASS  ' + name); } else { console.log('FAIL  ' + name); failures.push(name); } };

  try {
    api = spawn(NODE, [API_ENTRY], {
      env: { ...process.env, HOME: home, STORAGE_BACKEND: 'files', PORT: port, DATABASE_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let apiLog = '';
    api.stdout.on('data', (c) => { apiLog += c; });
    api.stderr.on('data', (c) => { apiLog += c; });
    await waitHealth(port, 20000);
    log('hermetic API up');

    // Provision a throwaway pool of 5 into the temp vault (real starter canvas).
    log('provisioning throwaway pool (5) ...');
    execFileSync(NODE, [PROVISION, '--count', '5', '--api', base], {
      env: { ...process.env, HOME: home }, stdio: 'inherit',
    });

    const { loadAccounts } = require('../lib/vault.cjs');
    const accounts = loadAccounts(vaultRoot);
    T('provisioned >=4 pool accounts', accounts.length >= 4);
    const host = accounts[0];
    const fleet = accounts.slice(1, 1 + FLEET_SEATS);

    // (3) HOST a recruiting troop as the "human" (plain client -- the bot's
    // allowlisted client would refuse to host).
    const hostRes = await httpJson('POST', base + '/api/schedule/troops', host.token, { level: 1, squadIndex: 0 });
    T('host opened a recruiting troop', hostRes.status === 200 && hostRes.body && hostRes.body.troop);
    const roomId = hostRes.body.troop.id;
    log('hosted troop ' + roomId + ' (host holds seat 0)');

    // (4) build fleet clients + identity guard, then drip-join.
    const { makeClient } = require('../lib/client.cjs');
    const { assertHumanEquivalent } = require('../lib/identity.cjs');
    const { selectFirstAvailable } = require('../lib/pool.cjs');
    const { driveDripJoin } = require('../lib/joiner.cjs');
    const { config } = require('../lib/config.cjs');

    const clients = new Map();
    for (const a of fleet) {
      const c = makeClient({ apiBase: base, token: a.token, playerId: a.playerId, name: a.name });
      const me = await c.get('/api/me');
      assertHumanEquivalent(me.body); // throws if dev/roled -> canary fails closed
      clients.set(a.playerId, c);
    }
    T('identity guard cleared all fleet accounts', clients.size === FLEET_SEATS);

    const used = new Set();
    const orderedIds = fleet.map((a) => a.playerId);
    const result = await driveDripJoin({
      now: () => Date.now(),
      sleep,
      intervalMs: JOIN_INTERVAL_MS,
      pollMs: 300,
      deadlineMs: 60000,
      readTroop: async () => {
        const r = await clients.get(orderedIds[0]).get('/api/schedule/troops/' + encodeURIComponent(roomId));
        if (r.status !== 200 || !r.body || !r.body.troop) return null;
        const t = r.body.troop;
        return { recruiting: t.state === 'recruiting', full: t.state !== 'recruiting' };
      },
      pickAccount: () => selectFirstAvailable(orderedIds, used),
      join: async (id) => {
        const r = await clients.get(id).post('/api/schedule/troops/' + encodeURIComponent(roomId) + '/join', { squadIndex: config.joinSquadIndex });
        if (r.status === 200) used.add(id);
        else log('join ' + id + ' -> ' + r.status + ' ' + JSON.stringify(r.body && (r.body.reason || r.body.error)));
        return r.body || {};
      },
      log: (m) => log(m),
    });

    // ---- assertions --------------------------------------------------------
    T('fleet filled exactly ' + FLEET_SEATS + ' seats (one per tick)', result.joins.length === FLEET_SEATS);
    T('drip stopped because the troop departed', result.stopReason === 'troop_departed' || result.stopReason === 'not_recruiting' || result.stopReason === 'troop_gone');
    let noBurst = true, minGap = Infinity;
    for (let i = 1; i < result.joins.length; i++) {
      const gap = result.joins[i].atMs - result.joins[i - 1].atMs;
      minGap = Math.min(minGap, gap);
      if (gap < JOIN_INTERVAL_MS - 100) noBurst = false;
    }
    T('NO BURST: every join spaced >= interval (' + JOIN_INTERVAL_MS + 'ms, min observed ' + (isFinite(minGap) ? minGap : 'n/a') + 'ms)', noBurst);

    const finalView = await httpJson('GET', base + '/api/schedule/troops/' + roomId, host.token);
    const t = finalView.body.troop;
    const filled = (t.slots || []).filter((s) => s != null).length;
    T('troop is departed (state=active) with all 4 seats filled', t.state === 'active' && filled === 4);
    log('final troop state=' + t.state + ' seatsFilled=' + filled);

    log('join timeline (ms from first): ' + result.joins.map((j, i) => (j.atMs - result.joins[0].atMs)).join(', '));
  } catch (e) {
    console.log('FAIL  canary threw: ' + (e && e.stack || e));
    failures.push('exception');
  } finally {
    if (api) { try { api.kill('SIGTERM'); } catch (e) {} }
    await sleep(300);
    try { fs.rmSync(home, { recursive: true, force: true }); log('torn down (HOME + temp vault removed)'); } catch (e) {}
  }

  console.log('\nCANARY: ' + (failures.length ? 'FAIL (' + failures.join('; ') + ')' : 'PASS'));
  process.exit(failures.length ? 1 : 0);
}

main();
