#!/usr/bin/env node
// backpack_ragnarok -- tools/fleet_pool_provision.cjs
// REQ-0329: re-runnable provisioning tool that mints ~50 human-equivalent
// guest players (roles:[], ordinary human-plausible names -- NOT bot_01) and
// seeds EACH account's profile canvas with the DEFAULT STARTER PLACEMENT
// (shared/player_actions.mjs buildStarterUnitsState -> engine.migrateState),
// so squad 0 -- the first squad the reactive fleet (REQ-0330) joins with -- is
// immediately deployable. Each {playerId, token, name} is written to a 0600
// vault OUTSIDE the repo (~/backpack_fleet/agents/<playerId>/token). Tokens are
// NEVER printed, logged, or committed (PROJECT.md confidential-handling rules).
//
// PERSISTENCE. Player records are minted in-process via server/players.cjs --
// the files-backend registry the live server also reads (registry stays on the
// files backend in both storage modes, see server/storage.cjs). The starter
// canvas is persisted by the SAME path a real client uses -- PUT
// /api/profile/:id/canvas with X-Auth-Token -- so it lands in whatever backend
// the live server runs (pg on this box) and is byte-indistinguishable from a
// fresh human's first save. The tool therefore never needs DATABASE_URL and
// never handles a backend secret.
//
// IDEMPOTENT / RE-RUNNABLE. The vault is the source of truth for "already
// provisioned": a re-run counts existing agents and tops the pool UP to the
// target, never duplicating a name or minting past the target.
//
// Usage:
//   node tools/fleet_pool_provision.cjs [--count N] [--dry-run]
//                                       [--api http://127.0.0.1:8802]
//                                       [--locale en]
//
//   --count N   target pool size (default 50).
//   --dry-run   mint nothing; build+validate the seed and print the plan.
//   --api URL   base URL of the live API (default env BPK_API_BASE or
//               http://127.0.0.1:8802).
//   --locale L  starter-unit name locale for the seed (default 'en').
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');

const SHARED_DIR = path.join(__dirname, '..', 'shared');
// shared/engine.js is a framework-free UMD factory (require-able from CJS, the
// same way server/services/core.cjs consumes it). Side-effect-free at require.
const Engine = require(path.join(SHARED_DIR, 'engine.js'));

const DEFAULT_COUNT = 50;
const DEFAULT_API = process.env.BPK_API_BASE || 'http://127.0.0.1:8802';
const VAULT_ROOT = path.join(os.homedir(), 'backpack_fleet', 'agents');

// ---- human-plausible name pool -------------------------------------------
// Ordinary given + family names (deliberately NOT bot_01: item 2 requires the
// pool be indistinguishable from humans). The first x last product yields far
// more unique "First Last" display names than any realistic target, so a
// top-up run can always find fresh, non-duplicated names. A fixed-seed shuffle
// gives a stable-but-varied order (consecutive names differ in both parts).
const FIRST_NAMES = [
  'Alice', 'Marcus', 'Yuki', 'Sofia', 'Liam', 'Priya', 'Chen', 'Amara', 'Noah',
  'Elena', 'Diego', 'Hana', 'Omar', 'Freya', 'Kenji', 'Ingrid', 'Tomas', 'Nadia',
  'Ravi', 'Clara', 'Mateo', 'Aisha', 'Lukas', 'Mei', 'Aaron', 'Bianca', 'Felix',
  'Zara', 'Oskar', 'Lena',
];
const LAST_NAMES = [
  'Carter', 'Nakamura', 'Rossi', 'Larsson', 'Okafor', 'Patel', 'Silva', 'Muller',
  'Ivanov', 'Costa', 'Haddad', 'Tanaka', 'Novak', 'Reyes', 'Fischer', 'Andersson',
  'Kowalski', 'Bauer', 'Moreau', 'Dubois', 'Weber', 'Sato', 'Vargas', 'Lindqvist',
  'Cohen', 'Nguyen', 'Adeyemi', 'Romano', 'Hansen', 'Wallace',
];

function namePool() {
  const prod = [];
  for (const f of FIRST_NAMES) for (const l of LAST_NAMES) prod.push(f + ' ' + l);
  // Deterministic LCG Fisher-Yates -- stable order across runs, varied output.
  let s = 0x9e3779b9 >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  for (let i = prod.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = prod[i]; prod[i] = prod[j]; prod[j] = t;
  }
  return prod;
}

/** Picks `need` names from the pool, skipping any already used. Returns fewer
 * than `need` only if the (900-entry) pool is exhausted. */
function chooseNames(need, usedNames) {
  const used = new Set(usedNames || []);
  const chosen = [];
  for (const nm of namePool()) {
    if (chosen.length >= need) break;
    if (used.has(nm)) continue;
    used.add(nm);
    chosen.push(nm);
  }
  return chosen;
}

// ---- the SEED (pure; the unit-tested core) --------------------------------
/**
 * Builds the default starter canvas exactly as the client boot does for a
 * genuinely fresh profile: buildStarterUnitsState(gameData, locale) ->
 * engine.migrateState(). Asserts the two acceptance invariants before
 * returning: the canvas satisfies checkUidInvariant and squad 0 is deployable.
 * Throws (never returns a bad canvas) if content carries no starterUnits or an
 * invariant fails. Async because shared/player_actions.mjs is an ES module.
 */
async function buildSeededCanvas(gameData, locale) {
  if (!gameData || !gameData.LAYOUT) throw new Error('gameData missing LAYOUT');
  const engine = Engine.create(
    gameData.ITEMS || {},
    gameData.SI_DEFS || {},
    gameData.LAYOUT,
    gameData.TREES || { po: {}, socket: {} },
    gameData.UNITS || {},
    gameData.CONN_SHAPES || {}
  );
  const PA = await import(pathToFileURL(path.join(SHARED_DIR, 'player_actions.mjs')).href);
  const seed = PA.buildStarterUnitsState(gameData, locale || 'en');
  if (!seed) {
    throw new Error('content has no starterUnits -- refusing to seed an empty/undeployable canvas');
  }
  const state = engine.migrateState(seed);
  const audit = engine.checkUidInvariant(state);
  if (!audit.ok) {
    throw new Error('seeded canvas violates the uid invariant: ' + JSON.stringify(audit));
  }
  if (!engine.isSquadDeployable(state, 0)) {
    throw new Error('seeded canvas squad 0 is not deployable (no BP in slot 0)');
  }
  return state;
}

// ---- HTTP (framework-free) ------------------------------------------------
function httpRequest(method, url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: Object.assign({}, opts.headers || {}),
    };
    const data = opts.body != null ? Buffer.from(opts.body) : null;
    if (data) reqOpts.headers['Content-Length'] = data.length;
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out after 15s')));
    if (data) req.write(data);
    req.end();
  });
}

async function httpJson(method, url, opts) {
  const res = await httpRequest(method, url, opts);
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch (e) { /* non-JSON body */ }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(method + ' ' + url + ' -> HTTP ' + res.status +
      (json && json.error ? ' (' + json.error + ')' : ''));
    err.status = res.status;
    throw err;
  }
  return json;
}

/** GET /api/content and map it to the engine-ready gameData shape (the same
 * fields client/src/api/content.ts's gameDataFromApiContent produces). */
async function loadGameDataFromApi(baseUrl) {
  const payload = await httpJson('GET', baseUrl + '/api/content');
  return {
    ITEMS: payload.items || {},
    SI_DEFS: payload.sis || {},
    LAYOUT: payload.layout || (payload.scenario && payload.scenario.layout),
    TREES: payload.trees || { po: {}, socket: {} },
    UNITS: payload.units || {},
    CONN_SHAPES: payload.connection_shapes || {},
    starterUnits: payload.starterUnits || null,
  };
}

/** Persist a player's canvas exactly as a real client PUT does. */
async function putCanvas(baseUrl, playerId, token, canvas) {
  return httpJson('PUT', baseUrl + '/api/profile/' + encodeURIComponent(playerId) + '/canvas', {
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify(canvas),
  });
}

// ---- vault (0600, outside the repo) ---------------------------------------
function readVault() {
  const out = [];
  if (!fs.existsSync(VAULT_ROOT)) return out;
  for (const id of fs.readdirSync(VAULT_ROOT)) {
    const tf = path.join(VAULT_ROOT, id, 'token');
    if (!fs.existsSync(tf)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(tf, 'utf8'));
      if (rec && rec.playerId && rec.name) out.push({ playerId: rec.playerId, name: rec.name });
    } catch (e) { /* skip unreadable/corrupt entry */ }
  }
  return out;
}

function writeVault(record) {
  const parent = path.dirname(VAULT_ROOT); // ~/backpack_fleet
  fs.mkdirSync(VAULT_ROOT, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(parent, 0o700); } catch (e) { /* best-effort */ }
  fs.chmodSync(VAULT_ROOT, 0o700);
  const dir = path.join(VAULT_ROOT, record.playerId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tf = path.join(dir, 'token');
  const json = JSON.stringify({ playerId: record.playerId, token: record.token, name: record.name }, null, 2) + '\n';
  fs.writeFileSync(tf, json, { mode: 0o600 });
  fs.chmodSync(tf, 0o600);
  return tf;
}

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  const out = { count: DEFAULT_COUNT, dryRun: false, api: null, locale: 'en', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--count') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) return { error: '--count requires a positive integer' };
      out.count = v;
    } else if (a === '--api') {
      out.api = argv[++i];
      if (!out.api) return { error: '--api requires a URL' };
    } else if (a === '--locale') {
      out.locale = argv[++i];
      if (!out.locale) return { error: '--locale requires a value' };
    } else {
      return { error: 'unknown argument "' + a + '"' };
    }
  }
  return out;
}

function printUsage() {
  console.log('usage: node tools/fleet_pool_provision.cjs [--count N] [--dry-run] [--api URL] [--locale L]');
}

async function main(argv) {
  const args = parseArgs(argv || []);
  if (args.error) { console.error(args.error); printUsage(); return 1; }
  if (args.help) { printUsage(); return 0; }
  const baseUrl = args.api || DEFAULT_API;

  // 1) fetch content + build/validate the seed (fails loudly on bad content).
  const gameData = await loadGameDataFromApi(baseUrl);
  const seededCanvas = await buildSeededCanvas(gameData, args.locale);
  const canvasBytes = Buffer.byteLength(JSON.stringify(seededCanvas), 'utf8');
  const squadCount = seededCanvas.presets && Array.isArray(seededCanvas.presets.store)
    ? seededCanvas.presets.store.length : 0;

  // 2) survey the vault (source of truth for what's already provisioned).
  const existing = readVault();
  const usedNames = existing.map((e) => e.name);
  const need = Math.max(0, args.count - existing.length);
  const chosen = chooseNames(need, usedNames);

  console.log('fleet_pool_provision (REQ-0329)');
  console.log('  api base       : ' + baseUrl);
  console.log('  vault          : ' + VAULT_ROOT);
  console.log('  target pool    : ' + args.count);
  console.log('  already in pool: ' + existing.length);
  console.log('  to provision   : ' + chosen.length +
    (chosen.length < need ? ' (name pool exhausted; wanted ' + need + ')' : ''));
  console.log('  seed canvas    : squads=' + squadCount +
    ', squad0Deployable=true, uidInvariant=ok, bytes=' + canvasBytes);
  if (chosen.length) {
    console.log('  sample names   : ' + chosen.slice(0, 5).join(', ') + (chosen.length > 5 ? ', ...' : ''));
  }

  if (args.dryRun) {
    console.log('  DRY RUN -- nothing minted; no account created, no canvas written, no vault touched.');
    return 0;
  }
  if (chosen.length === 0) {
    console.log('  pool already at/above target -- nothing to do.');
    return 0;
  }

  // 3) mint (in-process registry) + seed (HTTP PUT) + vault. The vault entry is
  //    written ONLY after a fully-seeded account, so "vault entry" always means
  //    "minted AND canvas-seeded" -- the fleet reads the vault, never orphans.
  const players = require(path.join(__dirname, '..', 'server', 'players.cjs'));
  let minted = 0, failed = 0;
  for (const name of chosen) {
    let player;
    try {
      player = players.createPlayer(name, []); // roles:[] -- never item_admin
    } catch (e) {
      failed++; console.error('  MINT FAIL (' + name + '): ' + e.message); continue;
    }
    try {
      await putCanvas(baseUrl, player.playerId, player.token, JSON.parse(JSON.stringify(seededCanvas)));
    } catch (e) {
      failed++;
      console.error('  SEED FAIL (' + player.playerId + '): ' + e.message +
        ' -- account minted but canvas not seeded; NOT added to vault.');
      continue;
    }
    writeVault(player); // token lands in the 0600 vault (never printed to stdout)
    minted++;
    console.log('  provisioned ' + player.playerId + ' (' + name + ')');
  }
  console.log('done: minted+seeded ' + minted + ', failed ' + failed +
    ', pool now ' + (existing.length + minted) + '/' + args.count);
  return failed ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}

module.exports = {
  buildSeededCanvas,
  loadGameDataFromApi,
  putCanvas,
  namePool,
  chooseNames,
  readVault,
  writeVault,
  parseArgs,
  VAULT_ROOT,
  main,
};
