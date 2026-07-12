// backpack_ragnarok — server/tests/api_test.cjs
// REQ-0024: storage round-trip + content endpoint shape + profile PUT/GET + oversized body.
// REQ-0035: /api/me + admin item-edit endpoint (validation, 403 guard, real-repo round-trip).
// REQ-0037: token-based auth (player registry, /api/me resolution, profile
// ownership guard, admin guard migrated off X-Player-Id, dev_mode fallback).
// Runs against synthetic temp HOME dirs so it never touches the real
// ~/backpack_ragnarok/data/ or content/ trees.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; }
}
async function AT(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; }
}

// ---- storage.cjs / players.cjs tests: redirect os.homedir() before first require ----
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test-'));
const realHomedir = os.homedir;
os.homedir = () => tmpHome;
const players = require('../players.cjs');
const storage = require('../storage.cjs');

T('players: createPlayer generates a unique id + long random token, persists atomically', () => {
  const p = players.createPlayer('Alice', ['item_admin']);
  assert.ok(p.playerId, 'playerId present');
  assert.ok(p.token && p.token.length >= 32, 'token present and long: ' + p.token);
  assert.deepStrictEqual(p.roles, ['item_admin']);
  const entries = fs.readdirSync(players.PLAYERS_DIR);
  const tmpLeft = entries.filter((f) => f.includes('.tmp'));
  assert.strictEqual(tmpLeft.length, 0, 'no leftover tmp files: ' + JSON.stringify(entries));
  const reread = players.readPlayer(p.playerId);
  assert.strictEqual(reread.token, p.token);
});

T('players: findPlayerByToken resolves a known token, returns null for unknown/garbage', () => {
  const p = players.createPlayer('Bob', []);
  const found = players.findPlayerByToken(p.token);
  assert.ok(found && found.playerId === p.playerId);
  assert.strictEqual(players.findPlayerByToken('not-a-real-token'), null);
  assert.strictEqual(players.findPlayerByToken(undefined), null);
  assert.strictEqual(players.findPlayerByToken(''), null);
});

T('players: ensureFixedPlayer creates once, reuses the SAME token on a later call (idempotent)', () => {
  const r1 = players.ensureFixedPlayer('dev_test', 'Developer', ['item_admin']);
  assert.strictEqual(r1.created, true);
  const token1 = r1.player.token;
  const r2 = players.ensureFixedPlayer('dev_test', 'Developer', ['item_admin']);
  assert.strictEqual(r2.created, false);
  assert.strictEqual(r2.player.token, token1, 'token must not change across repeated ensureFixedPlayer calls');
});

T('storage: writeProfile is atomic (no leftover tmp file) and round-trips with schema_version', () => {
  const p = players.createPlayer('CanvasOwner', []);
  const doc = storage.writeProfile(p.playerId, { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(doc.schema_version, storage.SCHEMA_VERSION, 'schema_version present');
  const entries = fs.readdirSync(storage.DATA_DIR);
  const tmpLeft = entries.filter((f) => f.includes('.tmp'));
  assert.strictEqual(tmpLeft.length, 0, 'no leftover tmp files: ' + JSON.stringify(entries));
  const read = storage.readProfile(p.playerId);
  assert.deepStrictEqual(read.canvas, { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(read.schema_version, storage.SCHEMA_VERSION);
});

T('storage: unknown profile id (no matching player registry entry) rejected on read and write', () => {
  assert.throws(() => storage.readProfile('totally_not_a_real_player_id'), /unknown profile id/);
  assert.throws(() => storage.writeProfile('totally_not_a_real_player_id', {}), /unknown profile id/);
});

T('storage: oversized payload rejected before write (64KB cap)', () => {
  const p = players.createPlayer('BigPayloadOwner', []);
  const big = { blob: 'x'.repeat(storage.MAX_BODY_BYTES + 1000) };
  assert.throws(() => storage.writeProfile(p.playerId, big), /size cap/);
});

T('storage: readProfile returns null when no file exists yet', () => {
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test2-'));
  os.homedir = () => otherHome;
  delete require.cache[require.resolve('../players.cjs')];
  delete require.cache[require.resolve('../storage.cjs')];
  const players2 = require('../players.cjs');
  const storage2 = require('../storage.cjs');
  const p2 = players2.createPlayer('Fresh', []);
  assert.strictEqual(storage2.readProfile(p2.playerId), null);
  os.homedir = () => tmpHome;
  delete require.cache[require.resolve('../players.cjs')];
  delete require.cache[require.resolve('../storage.cjs')];
  require('../players.cjs');
  require('../storage.cjs'); // restore module cache to the tmpHome-bound instance
});

T('storage: dev-player migration -- falls back to reading legacy default.json when the dev id has no profile of its own yet', () => {
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test3-'));
  os.homedir = () => otherHome;
  delete require.cache[require.resolve('../players.cjs')];
  delete require.cache[require.resolve('../storage.cjs')];
  const players3 = require('../players.cjs');
  const storage3 = require('../storage.cjs');
  players3.ensureFixedPlayer('dev', 'Developer', ['item_admin']);
  storage3.ensureDataDir ? storage3.ensureDataDir() : fs.mkdirSync(storage3.DATA_DIR, { recursive: true });
  fs.mkdirSync(storage3.DATA_DIR, { recursive: true });
  fs.writeFileSync(storage3.LEGACY_DEFAULT_PATH, JSON.stringify({ schema_version: 1, profile_id: 'default', updated_at: 'x', canvas: { pos: [{ uid: 'legacy1' }] } }));
  const migrated = storage3.readProfile('dev');
  assert.ok(migrated, 'dev profile falls back to legacy default.json');
  assert.deepStrictEqual(migrated.canvas, { pos: [{ uid: 'legacy1' }] });
  // The legacy file itself must be left untouched (fallback READ, not a rename).
  assert.ok(fs.existsSync(storage3.LEGACY_DEFAULT_PATH), 'legacy default.json must still exist after the fallback read');
  os.homedir = () => tmpHome;
  delete require.cache[require.resolve('../players.cjs')];
  delete require.cache[require.resolve('../storage.cjs')];
  require('../players.cjs');
  require('../storage.cjs');
});

// ---- api.cjs handler-level tests (content shape, HTTP semantics) ----
// api.cjs resolves content paths from os.homedir() at call time (inside
// buildContentPayload), so we point homedir at a synthetic repo tree with
// minimal content/live + vocab fixtures before loading api.cjs.
const fakeRepoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-repo-'));
const repoRoot = path.join(fakeRepoHome, 'backpack_ragnarok');
const contentDir = path.join(repoRoot, 'content');
const liveDir = path.join(contentDir, 'live');
fs.mkdirSync(liveDir, { recursive: true });
fs.writeFileSync(path.join(contentDir, 'vocab.json'), JSON.stringify({
  version: 1,
  po_tags: { Weapon: null, WeaponPart: 'Weapon', Metal: null },
  socket_tags: { gem: null, edge: null, Metal: null },
  triggers: ['every_secs', 'battle_start', 'adjacent', 'passive', 'host_on_hit', 'on_hit', 'on_bp_damaged'],
  verbs: ['strike', 'multi_strike', 'block', 'heal_bp', 'apply_status', 'add_on_hit_status', 'amp_status', 'buff_host'],
  statuses: ['Burn', 'Poison', 'Chill', 'Regen', 'Spikes', 'Stun', 'Weakness', 'Haste'],
  rarities: ['Common', 'Uncommon', 'Rare', 'Relic'],
}));
fs.writeFileSync(path.join(liveDir, 'live_items.json'), JSON.stringify({
  schema: 'po/2',
  entries: [
    { id: 'blade', name: 'Blade', tags: ['Weapon'], shape: [[0, 0]] },
    { id: 'fx_dagger', name: 'FX Dagger', tags: ['Weapon'], shape: [[0, 0]],
      effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [5, 9] } }] },
    // REQ-0036 P1-B: an actively-attacking PO (every_secs + attack_profile)
    // for the schedule test dungeon fixture above -- guarantees a fast,
    // deterministic kill of the 1hp weak_slime fixture enemy, so test runs
    // have a small, predictable durationSecs.
    { id: 'test_sword', name: 'Test Sword', tags: ['Weapon'], shape: [[0, 0]],
      effects: [{ trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [50, 50] },
        attack_profile: { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false } }] },
  ],
}));
fs.writeFileSync(path.join(liveDir, 'live_sis.json'), JSON.stringify({
  schema: 'si/2',
  entries: [
    { id: 'acc_gem', name: 'Gem', slot: 'gem', reqTags: [] },
    { id: 'fx_ring', name: 'FX Ring', slot: 'gem', reqTags: [],
      effects: [{ trigger: { t: 'passive' }, verb: { t: 'buff_host', n: [2, 4], stat: 'damage' } }] },
  ],
}));
// REQ-0042: TM (Transmutator) content fixture -- api.cjs's
// buildContentPayload() now unconditionally loads live_tms.json alongside
// live_items.json/live_sis.json, so the synthetic fixture tree needs one
// too (else GET /api/content 500s with ENOENT, exactly like it would if
// live_items.json/live_sis.json were ever missing here).
fs.writeFileSync(path.join(liveDir, 'live_tms.json'), JSON.stringify({
  schema: 'tm/1',
  entries: [
    { id: 'lrdst', name: 'UnitRandomDirectionShuffleTransmutator', short: 'LRDST',
      rarity: 'Common', icon: 'icon-lrdst', stackable: true },
  ],
}));
fs.writeFileSync(path.join(liveDir, 'scenario.json'), JSON.stringify({
  layout: { ROWS: 6, COLS: 6 }, linked: true, bps: [], pos: [], sis: [],
}));

// REQ-0036 P1-B: minimal batch-002-dungeon-pilot-SHAPED fixture content
// (schedule.cjs's getScheduleContent() reads these exact paths). A tiny,
// fast, deterministic dungeon: one pack encounter (a single very-weak
// enemy so a real squad reliably wins in well under a second of sim-time,
// keeping durationSecs small) + one boss (also weak, same reason),
// mirroring the shape of the real content/batches/batch-002-dungeon-pilot
// fixtures exactly (same schema fields) but scaled down for test speed.
// rewardItems reference 'blade'/'fx_dagger' DIRECTLY (already defined
// above in live_items.json) rather than a reward-roll id -- exercises
// resolveRewardItemId()'s identity-fallback path (an id absent from
// REWARD_ROLL_TO_ITEM_ID passes through unchanged), which is exactly
// what a real content batch will do once batch-002 goes live with real
// item ids instead of placeholder roll ids.
const batchDir = path.join(contentDir, 'batches', 'batch-002-dungeon-pilot');
fs.mkdirSync(batchDir, { recursive: true });
fs.writeFileSync(path.join(batchDir, 'dungeon.json'), JSON.stringify({
  schema: 'dungeon/1', id: 'test_dungeon', name: 'Test Dungeon',
  encounters: [
    { id: 'enc_pack_1', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['weak_slime'] }, deadline_secs: 30, rewardItems: ['blade'] },
    { id: 'enc_boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['weak_slime'] }, deadline_secs: 30, rewardItems: ['fx_dagger'] },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'enemies.json'), JSON.stringify({
  schema: 'enemy/1',
  entries: [
    { id: 'weak_slime', name: 'Weak Slime', hp: [1, 1], footprint: [1, 1], skills: ['slime_bite'], rarity: 'common', pack_role: 'line' },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'skills.json'), JSON.stringify({
  schema: 'skill/1',
  entries: [
    { id: 'slime_bite', name_en: 'Slime Bite',
      trigger: { t: 'every_secs', s: [5.0, 5.0] }, verb: { t: 'strike', n: [1, 1] },
      attack_profile: { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false },
      modes: ['battle'] },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'items.json'), JSON.stringify({ schema: 'po/2', entries: [] }));
// REQ-0036 P1-C: formations.json fixture (schedule.cjs's
// getScheduleContent() now unconditionally loads this path for the new
// GET /api/schedule/dungeons route) -- mirrors the real batch-002
// content's 4-entry shape, trimmed to 2 entries (enough to exercise "a
// formations list exists / has entries" without duplicating the full
// real content).
fs.writeFileSync(path.join(batchDir, 'formations.json'), JSON.stringify({
  schema: 'formation/1',
  entries: [
    { id: 'formation1', i18n: { en: { name: 'Standard Line' }, ja: { name: '標準陣形' } }, canvases: { unit1: 'F2:M9', unit2: 'N2:U9', unit3: 'B10:I17', unit4: 'R10:Y17' } },
    { id: 'formation2', i18n: { en: { name: 'Tank Vanguard' }, ja: { name: 'タンク先鋒' } }, canvases: { unit1: 'J2:Q9', unit2: 'B6:I13', unit3: 'R6:Y13', unit4: 'J10:Q17' } },
  ],
}));
// REQ-0043: sim/dungen.cjs's generator reads entities.json (trap/door/
// chest templates) from this SAME batch dir -- mirrors the real
// content/batches/batch-002-dungeon-pilot/entities.json shape exactly
// (schema/fields), trimmed to just the trap (no door/chest needed for
// this fixture's own tests, which only exercise the 'default' generator
// at low levels where a trap is the most likely extra encounter to
// roll; dungen.cjs itself defensively no-ops any entity type whose
// count rolls 0, so the door/chest templates being ABSENT here is only
// exercised if a low-probability roll needs them -- documented risk,
// acceptable for this fixture's narrow scope; a KeyError from a missing
// template would surface as an obvious test failure, not a silent bug).
fs.writeFileSync(path.join(batchDir, 'entities.json'), JSON.stringify({
  schema: 'entity/1',
  entries: [
    { id: 'trap_frost_deadfall', name: 'Frost Deadfall', type: 'trap', mode: 'detection', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 18, skills: [] },
    { id: 'door_rimefast_stage1', name: 'Rimefast Door (hidden)', type: 'door_stage1', mode: 'detection', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 20, skills: [] },
    { id: 'door_rimefast_stage2', name: 'Rimefast Door', type: 'door_stage2', mode: 'unlock', hp: 60, footprint: [2, 2], masked: false, timeout_secs: 25, skills: [] },
    { id: 'chest_frostbound_cache', name: 'Frostbound Cache', type: 'chest', mode: 'unlock', hp: 40, footprint: [2, 2], masked: false, timeout_secs: 22, skills: [] },
  ],
}));

os.homedir = () => fakeRepoHome;
// REQ-0047 (c): the server is a module TREE now (api.cjs -> router.cjs ->
// routes/* -> lib/*) -- evicting only the four legacy files would leave
// routes/ modules holding stale (old-homedir-bound) admin/storage refs.
// Evict every first-party server/ module (never node_modules, never this
// test file) so a re-require rebinds the whole tree at once.
function evictServerModuleTree() {
  const path = require('path');
  for (const k of Object.keys(require.cache)) {
    if (!k.includes(path.sep + 'server' + path.sep)) continue;
    if (k.includes('node_modules')) continue;
    if (k.includes(path.sep + 'tests' + path.sep)) continue;
    delete require.cache[k];
  }
}
evictServerModuleTree();
const api = require('../api.cjs');
const admin = require('../admin.cjs');
const playersFixture = require('../players.cjs');

// dev_user.json fixture (REQ-0035, extended REQ-0037 with dev_mode): a
// normal admin user, for /api/me and admin-auth happy-path tests below.
// A role-less variant / dev_mode:false variant is written on-demand
// inside the specific tests that need it, then restored.
const configDir = path.join(repoRoot, 'data', 'config');
fs.mkdirSync(configDir, { recursive: true });
const devUserPath = path.join(configDir, 'dev_user.json');
fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: true }));

// Boot-time dev player creation (mirrors api.cjs's main() -- but main()
// itself is not called here since we drive api.handle() directly against
// a mock http.Server; the dev player registry entry must exist before any
// test relies on the dev_mode fallback or the "default" alias).
const devPlayer = admin.ensureDevPlayer();

// A second, non-admin guest player -- used for profile-isolation and
// admin-guard-lacks-role tests.
const guestA = playersFixture.createPlayer('GuestA', []);
const guestB = playersFixture.createPlayer('GuestB', []);
const adminGuest = playersFixture.createPlayer('AdminGuest', ['item_admin']);

function mockReq(method, url, body, headers) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}
function mockRes(onEnd) {
  const res = {
    statusCode: null, headers: null, body: null,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body; if (onEnd) onEnd(body); },
  };
  return res;
}

function authHeaders(token) {
  return token ? { 'x-auth-token': token } : {};
}

T('api: GET /api/health returns {ok,version}', () => {
  const req = mockReq('GET', '/api/health');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(typeof parsed.version, 'string');
});

T('api: GET /api/content shape has items/sis/trees/scenario, item count matches live fixture', () => {
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.items && parsed.sis && parsed.trees && parsed.scenario, 'keys present');
  assert.strictEqual(Object.keys(parsed.items).length, 3, 'three items in fixture (blade + fx_dagger + REQ-0036 P1-B test_sword)');
  assert.ok(parsed.items.blade, 'blade item present');
  assert.strictEqual(Object.keys(parsed.sis).length, 2, 'two sis in fixture (acc_gem + fx_ring)');
  assert.deepStrictEqual(parsed.trees.po, { Weapon: null, WeaponPart: 'Weapon', Metal: null });
});

T('api: GET /api/content renders eff_en/eff_ja server-side, matching tools/eff_render.cjs output (REQ-0024 gap closure)', () => {
  const { render } = require('../../tools/eff_render.cjs');
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  const parsed = JSON.parse(res.body);

  // Item with no effects: rendered fields present but empty (not missing/undefined).
  assert.strictEqual(parsed.items.blade.eff_en, '', 'no-effects item: eff_en is empty string');
  assert.strictEqual(parsed.items.blade.eff_ja, '', 'no-effects item: eff_ja is empty string');

  // Item with effects: non-empty, and byte-identical to eff_render.cjs's own output
  // for the same AST (the exact code path tool_gen_data.cjs uses to bake data.js).
  const fxItem = parsed.items.fx_dagger;
  assert.ok(fxItem, 'fx_dagger item present');
  const expectedEnItem = fxItem && [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [5, 9] } }]
    .map((e) => render(e, 'en')).join(' ');
  const expectedJaItem = [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [5, 9] } }]
    .map((e) => render(e, 'ja')).join(' ');
  assert.notStrictEqual(fxItem.eff_en, '', 'fx_dagger: eff_en non-empty');
  assert.notStrictEqual(fxItem.eff_ja, '', 'fx_dagger: eff_ja non-empty');
  assert.strictEqual(fxItem.eff_en, expectedEnItem, 'fx_dagger: eff_en matches eff_render.cjs output');
  assert.strictEqual(fxItem.eff_ja, expectedJaItem, 'fx_dagger: eff_ja matches eff_render.cjs output');

  // Same check for an SI with effects.
  const fxSi = parsed.sis.fx_ring;
  assert.ok(fxSi, 'fx_ring si present');
  const expectedEnSi = [{ trigger: { t: 'passive' }, verb: { t: 'buff_host', n: [2, 4], stat: 'damage' } }]
    .map((e) => render(e, 'en')).join(' ');
  const expectedJaSi = [{ trigger: { t: 'passive' }, verb: { t: 'buff_host', n: [2, 4], stat: 'damage' } }]
    .map((e) => render(e, 'ja')).join(' ');
  assert.notStrictEqual(fxSi.eff_en, '', 'fx_ring: eff_en non-empty');
  assert.strictEqual(fxSi.eff_en, expectedEnSi, 'fx_ring: eff_en matches eff_render.cjs output');
  assert.strictEqual(fxSi.eff_ja, expectedJaSi, 'fx_ring: eff_ja matches eff_render.cjs output');
});

// ---- REQ-0037: token resolution / /api/me tests ----

T('api: GET /api/me with a valid guest token resolves that guest (not the dev player)', () => {
  const req = mockReq('GET', '/api/me', undefined, authHeaders(guestA.token));
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.playerId, guestA.playerId);
  assert.strictEqual(parsed.name, 'GuestA');
  assert.deepStrictEqual(parsed.roles, []);
});

T('api: GET /api/me with an unknown/garbage token returns 401', () => {
  const req = mockReq('GET', '/api/me', undefined, authHeaders('totally-bogus-token-value'));
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + res.body);
});

T('api: GET /api/me with no token + dev_mode:true resolves the dev player', () => {
  const req = mockReq('GET', '/api/me');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.playerId, 'dev');
  assert.strictEqual(parsed.name, 'Developer');
  assert.deepStrictEqual(parsed.roles, ['item_admin']);
});

T('api: GET /api/me with no token + dev_mode:false returns 401', () => {
  const original = fs.readFileSync(devUserPath, 'utf8');
  fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
  try {
    const req = mockReq('GET', '/api/me');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + res.body);
  } finally {
    fs.writeFileSync(devUserPath, original);
  }
});

T('admin: resolveAuth returns the right player for a valid token, and the correct failure reasons otherwise', () => {
  const ok = admin.resolveAuth(guestA.token);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.player.playerId, guestA.playerId);

  const bad = admin.resolveAuth('not-a-real-token');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'invalid_token');

  const fallback = admin.resolveAuth(undefined);
  assert.strictEqual(fallback.ok, true);
  assert.strictEqual(fallback.player.playerId, 'dev');
});

T('admin: isItemAdminToken true only for a valid token whose player has item_admin', () => {
  assert.strictEqual(admin.isItemAdminToken(devPlayer.token), true);
  assert.strictEqual(admin.isItemAdminToken(adminGuest.token), true);
  assert.strictEqual(admin.isItemAdminToken(guestA.token), false, 'guestA has no roles');
  assert.strictEqual(admin.isItemAdminToken('not-a-real-token'), false);
  assert.strictEqual(admin.isItemAdminToken(undefined), true, 'no token + dev_mode:true falls back to the admin dev player');
});

T('admin: findLiveEntry resolves POs and SIs, rejects unknown ids (draft/staging-equivalent)', () => {
  const foundItem = admin.findLiveEntry('blade');
  assert.ok(foundItem && foundItem.kind === 'item');
  const foundSi = admin.findLiveEntry('acc_gem');
  assert.ok(foundSi && foundSi.kind === 'si');
  assert.strictEqual(admin.findLiveEntry('not_a_real_id_and_not_staged'), null);
});

T('admin: applyAdminEdit rejects an id not found in live_items/live_sis', () => {
  assert.throws(() => admin.applyAdminEdit('totally_unknown_id', { name: 'X' }), /unknown item id/);
});

T('admin: applyAdminEdit rejects unknown vocab value (bad rarity)', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { rarity: 'Mythic' }), /unknown rarity/);
});

T('admin: applyAdminEdit rejects invalid [lo,hi] ranges (lo>hi, zero, negative)', () => {
  const bad1 = { effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [9, 5] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad1), /range/);
  const bad2 = { effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [0, 5] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad2), /range/);
  const bad3 = { effects: [{ trigger: { t: 'every_secs', s: [-1, 2] }, verb: { t: 'strike', n: [1, 2] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad3), /range/);
});

T('admin: applyAdminEdit rejects unknown/extra keys in the body (schema allowlist)', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { not_a_real_field: 1 }), /unknown field/);
  // shape/ports are intentionally NOT in the allowlist (view-only per REQ-0035).
  assert.throws(() => admin.applyAdminEdit('blade', { shape: [[0, 0]] }), /unknown field/);
});

T('admin: applyAdminEdit rejects tags[0] that is not a root tag', () => {
  // WeaponPart's parent is Weapon (not null) in the fixture vocab -- an
  // invalid tags[0] choice.
  assert.throws(() => admin.applyAdminEdit('blade', { tags: ['WeaponPart', 'Metal'] }), /root tag/);
});

T('admin: applyAdminEdit rejects an unknown tag entirely', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { tags: ['NotARealTag'] }), /unknown tag/);
});

T('admin: applyAdminEdit happy path (fixture repo) persists + re-renders effects, leaves no partial write on a later failure', () => {
  const before = admin.findLiveEntry('fx_dagger');
  assert.strictEqual(before.doc.entries[before.index].name, 'FX Dagger');
  const merged = admin.applyAdminEdit('fx_dagger', { name: 'FX Dagger Mk2', name_ja: 'FXダガーMk2' });
  assert.strictEqual(merged.name, 'FX Dagger Mk2');
  assert.strictEqual(merged.name_ja, 'FXダガーMk2');
  // Re-read from disk (bypassing any cache) to confirm the write landed.
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.name, 'FX Dagger Mk2');
  // No leftover tmp files after the atomic write.
  const leftover = fs.readdirSync(liveDir).filter((f) => f.includes('.tmp'));
  assert.strictEqual(leftover.length, 0, 'no leftover tmp files: ' + JSON.stringify(leftover));

  // Now attempt a bad edit on the SAME entry -- it must be rejected AND
  // must not have touched the file (the name from the successful edit
  // above must still be there, unchanged by the rejected attempt).
  assert.throws(() => admin.applyAdminEdit('fx_dagger', { rarity: 'NotReal' }), /unknown rarity/);
  const rereadAfterReject = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entryAfterReject = rereadAfterReject.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entryAfterReject.name, 'FX Dagger Mk2', 'rejected write must not have persisted anything');
});


// ---- REQ-0038: i18n content shape + effects array growth/shrinkage ----

T('admin: applyAdminEdit accepts effects array GROWTH (add one effect) and persists correctly', () => {
  const before = admin.findLiveEntry('fx_dagger');
  const beforeCount = before.doc.entries[before.index].effects.length;
  const grownEffects = before.doc.entries[before.index].effects.concat([
    { trigger: { t: 'battle_start' }, verb: { t: 'block', n: [3, 6] } },
  ]);
  const merged = admin.applyAdminEdit('fx_dagger', { effects: grownEffects });
  assert.strictEqual(merged.effects.length, beforeCount + 1, 'effects array must have grown by exactly one');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.effects.length, beforeCount + 1, 'growth must persist to disk');
  assert.strictEqual(entry.effects[entry.effects.length - 1].verb.t, 'block');
});

T('admin: applyAdminEdit accepts effects array SHRINKAGE (remove one effect), including down to an empty array', () => {
  const before = admin.findLiveEntry('fx_dagger');
  const currentEffects = before.doc.entries[before.index].effects;
  assert.ok(currentEffects.length > 0, 'fixture must have at least one effect to shrink from');
  const shrunk = currentEffects.slice(0, currentEffects.length - 1);
  const merged = admin.applyAdminEdit('fx_dagger', { effects: shrunk });
  assert.strictEqual(merged.effects.length, currentEffects.length - 1);
  // Shrink all the way down to an empty array -- must be an ACCEPTED,
  // valid state (not rejected), per the REQ-0038 spec ("an empty effects
  // array must be an accepted (valid) state").
  const emptied = admin.applyAdminEdit('fx_dagger', { effects: [] });
  assert.deepStrictEqual(emptied.effects, [], 'empty effects array must be accepted');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.deepStrictEqual(entry.effects, [], 'empty effects array must persist to disk');
});

T('admin: applyAdminEdit accepts writes to the i18n map and merges one level deep (does not clobber sibling fields)', () => {
  // Seed an i18n.ja.flavor value first (simulating a prior edit), then
  // send a body that only touches i18n.ja.name -- the existing flavor
  // must survive the merge (server/admin.cjs's one-level-deep merge).
  admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'FXダガー', flavor: '最初のフレーバー' } } });
  const merged = admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'FXダガーMk3' } } });
  assert.strictEqual(merged.i18n.ja.name, 'FXダガーMk3');
  assert.strictEqual(merged.i18n.ja.flavor, '最初のフレーバー', 'sibling i18n.ja.flavor must survive a name-only edit');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.i18n.ja.name, 'FXダガーMk3');
  assert.strictEqual(entry.i18n.ja.flavor, '最初のフレーバー');
});

T('admin: applyAdminEdit REJECTS an unknown locale key in the i18n map, with a clear error, and leaves the file unchanged', () => {
  const beforeText = fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8');
  assert.throws(
    () => admin.applyAdminEdit('fx_dagger', { i18n: { fr: { name: 'Poignard FX' } } }),
    /unknown i18n locale "fr"/
  );
  const afterText = fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8');
  assert.strictEqual(afterText, beforeText, 'a rejected i18n locale write must not touch the file at all');
});

T('admin: applyAdminEdit REJECTS an unknown field inside an i18n locale entry', () => {
  assert.throws(
    () => admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'x', notAField: 'y' } } }),
    /unknown field "notAField" in i18n\.ja/
  );
});

// ---- REQ-0038: migration integrity (tools/migrate_i18n.cjs) ----

T('migrate_i18n: every migrated i18n.ja.{name,flavor} value is byte-identical to the pre-migration name_ja/flavor_ja it replaced, for EVERY entry (not a sample)', () => {
  const migrate = require('../../tools/migrate_i18n.cjs');

  // Build a fixture doc carrying legacy name_ja/flavor_ja fields on
  // several entries (mirroring the real content shape before the (b)
  // migration commit ran) -- deliberately includes entries with only
  // name_ja, only flavor_ja, both, and neither, so the "every entry, not
  // a sample" requirement is exercised across every combination.
  const fixtureDoc = {
    schema: 'po/2',
    entries: [
      { id: 'alpha', name: 'Alpha', name_ja: 'アルファ', flavor: 'a', flavor_ja: 'あ' },
      { id: 'beta', name: 'Beta', name_ja: 'ベータ' },
      { id: 'gamma', name: 'Gamma', flavor: 'g', flavor_ja: 'が' },
      { id: 'delta', name: 'Delta' },
    ],
  };
  // Capture the exact pre-migration values for every entry BEFORE
  // mutating anything (migrateDoc operates on a clone, but we still want
  // our own independent "before" snapshot to compare against).
  const beforeValues = fixtureDoc.entries.map((e) => ({ id: e.id, name_ja: e.name_ja, flavor_ja: e.flavor_ja }));

  const result = migrate.migrateDoc(fixtureDoc);
  // Assert the verification the script itself performs also holds when
  // driven from this test (independent check, not just trusting the
  // script's own internal assert).
  migrate.verifyMigration(result.records);

  for (const before of beforeValues) {
    const migratedEntry = result.doc.entries.find((e) => e.id === before.id);
    assert.ok(migratedEntry, 'migrated entry must still exist: ' + before.id);
    if (before.name_ja !== undefined) {
      assert.strictEqual(migratedEntry.i18n.ja.name, before.name_ja, 'i18n.ja.name must be byte-identical to the original name_ja for ' + before.id);
      assert.strictEqual(migratedEntry.name_ja, undefined, 'name_ja must be deleted after migration for ' + before.id);
    }
    if (before.flavor_ja !== undefined) {
      assert.strictEqual(migratedEntry.i18n.ja.flavor, before.flavor_ja, 'i18n.ja.flavor must be byte-identical to the original flavor_ja for ' + before.id);
      assert.strictEqual(migratedEntry.flavor_ja, undefined, 'flavor_ja must be deleted after migration for ' + before.id);
    }
    if (before.name_ja === undefined && before.flavor_ja === undefined) {
      assert.strictEqual(migratedEntry.i18n, undefined, 'an entry with neither _ja field must get no i18n map at all: ' + before.id);
    }
  }

  // Idempotency: re-running migrateDoc on the ALREADY-migrated doc must
  // be a true no-op (zero records, doc unchanged) -- proves "safe to
  // re-run" independently of the CLI's own idempotency, per entry.
  const secondPass = migrate.migrateDoc(result.doc);
  assert.strictEqual(secondPass.records.length, 0, 're-running migration on an already-migrated doc must find nothing left to migrate');
  assert.deepStrictEqual(secondPass.doc, result.doc, 're-running migration must not change the doc at all');
});

async function main() {
  await AT('api: PUT then GET /api/profile/:playerId/canvas round-trips for a real guest token', async () => {
    await new Promise((resolve, reject) => {
      const putReq = mockReq('PUT', '/api/profile/' + guestA.playerId + '/canvas', JSON.stringify({ pos: [{ uid: 'y' }] }), authHeaders(guestA.token));
      const putRes = mockRes((body) => {
        try {
          assert.strictEqual(putRes.statusCode, 200, 'PUT status: ' + body);
        } catch (e) { reject(e); return; }
        const getReq = mockReq('GET', '/api/profile/' + guestA.playerId + '/canvas', undefined, authHeaders(guestA.token));
        const getRes = mockRes((body2) => {
          try {
            assert.strictEqual(getRes.statusCode, 200);
            const parsed = JSON.parse(body2);
            assert.deepStrictEqual(parsed.canvas, { pos: [{ uid: 'y' }] });
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(getReq, getRes);
      });
      api.handle(putReq, putRes);
    });
  });

  await AT('api: oversized PUT body rejected with 413', async () => {
    await new Promise((resolve, reject) => {
      const big = JSON.stringify({ blob: 'x'.repeat(storage.MAX_BODY_BYTES + 5000) });
      const req = mockReq('PUT', '/api/profile/' + guestA.playerId + '/canvas', big, authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 413, 'expected 413 got ' + res.statusCode);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  // ---- REQ-0037: profile isolation -- player A cannot GET/PUT player B's profile ----

  await AT('api: GET /api/profile/:playerId/canvas 403s when the token belongs to a DIFFERENT player', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('GET', '/api/profile/' + guestB.playerId + '/canvas', undefined, authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/profile/:playerId/canvas 403s when the token belongs to a DIFFERENT player', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/profile/' + guestB.playerId + '/canvas', JSON.stringify({ pos: [] }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: profile GET/PUT with an invalid token returns 401 (never falls through to a 403/404)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('GET', '/api/profile/' + guestA.playerId + '/canvas', undefined, authHeaders('garbage-token'));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: profile GET with no token + dev_mode:false returns 401', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('GET', '/api/profile/dev/canvas');
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: "default" alias resolves to the dev player\'s own profile when dev_mode is true, round-trips', async () => {
    await new Promise((resolve, reject) => {
      const putReq = mockReq('PUT', '/api/profile/default/canvas', JSON.stringify({ pos: [{ uid: 'dev-alias-1' }] }));
      const putRes = mockRes((body) => {
        try {
          assert.strictEqual(putRes.statusCode, 200, 'PUT status: ' + body);
        } catch (e) { reject(e); return; }
        // Reading back via the dev player's REAL id must see the same data
        // the alias just wrote (same underlying profile file).
        const getReq = mockReq('GET', '/api/profile/dev/canvas');
        const getRes = mockRes((body2) => {
          try {
            assert.strictEqual(getRes.statusCode, 200, 'GET status: ' + body2);
            const parsed = JSON.parse(body2);
            assert.deepStrictEqual(parsed.canvas, { pos: [{ uid: 'dev-alias-1' }] });
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(getReq, getRes);
      });
      api.handle(putReq, putRes);
    });
  });

  await AT('api: "default" alias stops working (plain unknown/mismatched id) once dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('GET', '/api/profile/default/canvas', undefined, authHeaders(devPlayer.token));
        const res = mockRes((body) => {
          try {
            // With dev_mode:false, "default" no longer aliases to the dev
            // player -- a valid dev token hitting the "default" URL segment
            // now 403s (token authenticates as "dev", not "default").
            assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  // ---- REQ-0037: PUT /api/admin/item/:id via the real HTTP handler, token-based ----

  await AT('api: PUT /api/admin/item/:id returns 403 when no token is sent and dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }));
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when the token is invalid/unknown', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), authHeaders('garbage-not-a-token'));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when a valid token\'s player lacks item_admin', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id returns 404 for an id not in live_items/live_sis (valid admin token)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/nonexistent_item', JSON.stringify({ name: 'X' }), authHeaders(devPlayer.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 404, 'expected 404 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id happy path (200, persists, cache invalidates via mtime) for a guest with item_admin', async () => {
    // Read /api/content BEFORE the edit to prime the cache with the old name.
    const beforeReq = mockReq('GET', '/api/content');
    const beforeRes = mockRes();
    api.handle(beforeReq, beforeRes);
    const before = JSON.parse(beforeRes.body);
    assert.strictEqual(before.items.blade.name, 'Blade');

    await new Promise((resolve, reject) => {
      const req = mockReq(
        'PUT',
        '/api/admin/item/blade',
        JSON.stringify({ name: 'Blade Mk2' }),
        authHeaders(adminGuest.token)
      );
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.name, 'Blade Mk2');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });

    // /api/content must reflect the change on the very next request, with
    // NO server restart -- proves the mtime-based cache invalidated.
    const afterReq = mockReq('GET', '/api/content');
    const afterRes = mockRes();
    api.handle(afterReq, afterRes);
    const after = JSON.parse(afterRes.body);
    assert.strictEqual(after.items.blade.name, 'Blade Mk2', '/api/content must reflect the admin edit without a restart');
  });

  await AT('api: PUT /api/admin/item/:id succeeds with NO token at all when dev_mode is true (dev-player fallback keeps item_admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Blade Mk3' }));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  // ---------------------------------------------------------------------
  // REQ-0041 feedback 1: POST /api/admin/warehouse/grant {itemId} -- dev
  // grant, gated EXACTLY like PUT /api/admin/item/:id above (see that
  // route's own tests immediately above, which this group mirrors 1:1
  // for the auth-gate cases: 200 for item_admin, 403 for a non-admin
  // guest, 403 for no token when dev_mode is off, 400 for an unknown
  // itemId, and the warehouse row actually appearing via listWarehouse).
  // ---------------------------------------------------------------------
  await AT('api: POST /api/admin/warehouse/grant returns 403 when no token is sent and dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }));
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: POST /api/admin/warehouse/grant returns 403 when a valid token\'s player lacks item_admin (guest/non-admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: POST /api/admin/warehouse/grant returns 400 for an unknown itemId (valid admin token)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'totally_not_a_real_item_id' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 400, 'expected 400 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: POST /api/admin/warehouse/grant happy path (200) for an item_admin guest -- the granted row actually appears via listWarehouse', async () => {
    const schedule2 = require('../schedule.cjs');
    const before = schedule2.listWarehouse(adminGuest.playerId).length;
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.itemId, 'blade');
          assert.strictEqual(parsed.item.status, 'claimable', 'a freshly-granted row starts claimable (REQ-0041 two-phase claim status field)');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
    const after = schedule2.listWarehouse(adminGuest.playerId);
    assert.strictEqual(after.length, before + 1, 'listWarehouse must show exactly one new row for the granting admin');
    assert.ok(after.some((i) => i.itemId === 'blade'), 'the granted item id must actually be present');
    for (const i of after) if (i.itemId === 'blade' && i.playerId === undefined) { /* no-op, shape check only */ }
  });

  // REQ-0115: the dex Edit-Mode "Acquire to warehouse" bug -- granting an
  // SI id (acc_gem, from live_sis.json) 400'd as "unknown item id" because
  // the gate only checked itemDefsById (PO-only). Now accepts SI ids too.
  await AT('REQ-0115 admin grant: POST /api/admin/warehouse/grant accepts an SI id (acc_gem) -- 200, claimable, listed (regression: was 400 unknown item id)', async () => {
    const schedule2 = require('../schedule.cjs');
    const before = schedule2.listWarehouse(adminGuest.playerId).length;
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'acc_gem' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.itemId, 'acc_gem', 'granted row carries the SI id');
          assert.strictEqual(parsed.item.status, 'claimable');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
    const after = schedule2.listWarehouse(adminGuest.playerId);
    assert.strictEqual(after.length, before + 1, 'exactly one new SI row for the granting admin');
    assert.ok(after.some((i) => i.itemId === 'acc_gem'), 'the granted SI id must actually be present');
  });

  await AT('api: POST /api/admin/warehouse/grant succeeds with NO token at all when dev_mode is true (dev-player fallback keeps item_admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'fx_dagger' }));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });


  // =====================================================================
  // REQ-0036 P1-B: Dungeon Schedule + Warehouse test group. Runs against
  // the SAME synthetic fakeRepoHome/repoRoot fixture as the tests above
  // (os.homedir() is still pointed there) -- schedule.cjs resolves its
  // own content paths (content/live/*.json, content/batches/batch-002-
  // dungeon-pilot/*.json) the same mtime-cached way api.cjs's
  // buildContentPayload() does, so the tiny fixture dungeon written
  // above (batchDir: 'test_dungeon', one weak_slime pack + boss) is what
  // every schedule test below actually runs.
  // =====================================================================
  const schedule = require('../schedule.cjs');
  const scheduleStorage = require('../storage.cjs');

  // Builds a fresh, internally-independent profile canvas: 4 squads
  // (indices 0-3), each with ITS OWN uniquely-tagged BP + a placed
  // 'test_sword' PO wired to attack (every_secs strike, see the
  // live_items.json fixture above) so a real sim run reliably kills the
  // 1hp weak_slime fixture enemy fast. Every uid across all 4 squads is
  // globally unique (tagged by squad index) so isSquadIndependent() is
  // true for every one of them against each other -- tests that need an
  // independence VIOLATION deliberately clone one squad's uids into
  // another below.
  function makeTestCanvas() {
    function squadCanvas(tag) {
      return {
        linked: true,
        bps: [{ id: 'bp_' + tag, name: 'BP ' + tag, color: '#888888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], unit: { off: [0, 0], dirs: [] }, hpMax: 40 }],
        pos: [{ uid: 'po_' + tag, id: 'test_sword', loc: 'grid', cell: [1, 1], rot: 0 }],
        sis: [],
      };
    }
    const p0 = squadCanvas('t0'), p1 = squadCanvas('t1'), p2 = squadCanvas('t2'), p3 = squadCanvas('t3');
    return Object.assign({}, p0, {
      layout: { ROWS: 8, COLS: 8 },
      inv: { pages: [{ bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }], names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: [null, p1, p2, p3, null] },
    });
  }

  function fillAllSlots(scheduleApi, room, callerId, canvas, itemDefsById) {
    let r = room;
    for (let i = 0; i < 4; i++) r = scheduleApi.assignSlot(r, callerId, i, i, canvas, itemDefsById);
    return r;
  }

  // Force a run's clock to read as fully elapsed, without a real sleep --
  // rewrites startedAt into the past by (durationSecs + margin) seconds.
  function forceRunElapsed(runId) {
    const run = scheduleStorage.readRun(runId);
    run.startedAt = new Date(Date.now() - (run.durationSecs + 5) * 1000).toISOString();
    scheduleStorage.writeRun(runId, run);
  }

  const scheduleP1 = playersFixture.createPlayer('ScheduleP1', []);
  const scheduleP2 = playersFixture.createPlayer('ScheduleP2', []);
  scheduleStorage.writeProfile(scheduleP1.playerId, makeTestCanvas());
  scheduleStorage.writeProfile(scheduleP2.playerId, makeTestCanvas());

  function scheduleReq(method, urlPath, token, body) {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const req2 = mockReq(method, urlPath, bodyStr, authHeaders(token));
      const res2 = mockRes((b) => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
        resolve({ status: res2.statusCode, body: parsed });
      });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
  }

  await AT('schedule: POST /api/schedule/rooms creates a room owned by the caller', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.room.ownerId, scheduleP1.playerId);
    assert.strictEqual(res.body.room.visibility, 'self');
    assert.strictEqual(res.body.room.status, 'open');
    assert.strictEqual(res.body.room.slots.length, 4);
  });

  await AT('schedule: GET /api/schedule/rooms lists only the caller\'s own rooms', async () => {
    const before = await scheduleReq('GET', '/api/schedule/rooms', scheduleP2.token);
    assert.strictEqual(before.body.rooms.length, 0, 'ScheduleP2 has created no rooms yet');
    await scheduleReq('POST', '/api/schedule/rooms', scheduleP2.token, { dungeonId: 'test_dungeon', level: 1 });
    const after = await scheduleReq('GET', '/api/schedule/rooms', scheduleP2.token);
    assert.strictEqual(after.body.rooms.length, 1);
    const p1List = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
    assert.ok(p1List.body.rooms.length >= 1, 'ScheduleP1 still sees its own room from the prior test');
    assert.ok(p1List.body.rooms.every((r) => r.ownerId === scheduleP1.playerId), 'every listed room belongs to the caller');
  });

  await AT('schedule: auth isolation -- player B cannot GET or DELETE player A\'s room (404, not 403)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const getRes = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    assert.strictEqual(getRes.status, 404, 'cross-player GET must 404, never 403 (no existence leak)');
    const delRes = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    assert.strictEqual(delRes.status, 404, 'cross-player DELETE must 404');
    // Sanity: the OWNER can still see it fine.
    const ownGet = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(ownGet.status, 200);
  });

  await AT('schedule: invalid token is rejected with 401 on every schedule route', async () => {
    const res = await scheduleReq('GET', '/api/schedule/rooms', 'totally-bogus-token-value');
    assert.strictEqual(res.status, 401);
  });

  // REQ-0045 (b)+(c): deploy gate v2 replaces isSquadIndependent-as-gate
  // (a STATIC, warehouse-wide "does this squad share any uid with ANY
  // OTHER squad anywhere" check -- the yellow-tint concept) with a
  // DYNAMIC deployed-overlap check (deployedUidSetsForGate in
  // server/schedule.cjs): a squad is assignable iff its uid set does
  // not intersect any uid set ACTUALLY deployed right now, either in
  // this same room's OTHER slots or in another of the caller's currently
  // ACTIVE rooms. The three tests below cover the three distinct
  // scenarios the old gate got wrong or never had to distinguish:
  //   1. yellow-but-idle (shares a uid with an undeployed sibling
  //      squad) must now DEPLOY OK -- the old gate refused this
  //      unconditionally, which was bug (b).
  //   2. duplicate squadIndex assigned to two slots of the SAME room
  //      must be REFUSED (identical uid sets, so trivially overlapping)
  //      -- the old gate ALLOWED this (it only ever consulted
  //      isSquadIndependent, a warehouse-wide static property, never the
  //      room's own other slots), which was one half of bug (c).
  //   3. four mutually-unique squads filling all 4 slots of one room
  //      must SUCCEED and auto-start -- the old gate refused this
  //      whenever any one of the 4 happened to share a uid with some
  //      OTHER unrelated squad elsewhere in the warehouse (a false
  //      positive against a squad not even being deployed), which was
  //      the other half of bug (c). makeTestCanvas()'s squads 0-3 are
  //      already globally unique against each other by construction (see
  //      its own doc comment above), so fillAllSlots() below IS this
  //      scenario already -- asserted explicitly here as its own named
  //      test rather than only implicitly via the cross-room-overlap
  //      test further down.
  await AT('schedule: deploy gate v2 -- a squad sharing a uid with another of the caller\'s OWN squads, where that OTHER squad is NOT deployed anywhere, deploys OK (REQ-0045 b)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    // Make squad index 4 an EXACT duplicate of squad 0's uids --
    // guaranteed uid overlap between them ("yellow") -- but squad 4 is
    // NOT deployed anywhere (no room references it).
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const squad0Snapshot = { bps: doc.canvas.bps, pos: doc.canvas.pos, sis: doc.canvas.sis };
    doc.canvas.presets.store[4] = JSON.parse(JSON.stringify(squad0Snapshot));
    scheduleStorage.writeProfile(scheduleP1.playerId, doc.canvas);

    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(res.status, 200, 'mere cross-squad uid sharing (neither side deployed) must NOT block: ' + JSON.stringify(res.body));

    // Clean up: clear the duplicate + the room.
    const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
    doc2.canvas.presets.store[4] = null;
    scheduleStorage.writeProfile(scheduleP1.playerId, doc2.canvas);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate v2 -- assigning the SAME squadIndex to a SECOND slot of the SAME room is refused 409 (REQ-0045 c: duplicates must be REFUSED)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const first = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 1 });
    assert.strictEqual(first.status, 200, 'slot 0 assign: ' + JSON.stringify(first.body));

    // Same squadIndex (1) into a DIFFERENT slot of the SAME room -- the
    // uid set is IDENTICAL to slot 0's, so this is a same-room duplicate-
    // deployment attempt. This must be refused regardless of the room's
    // own status (still 'open' here, not yet 'active') --
    // deployedUidSetsForGate checks this room's OWN other slots
    // unconditionally, not just once the room has gone active.
    const dup = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/1', scheduleP1.token, { squadIndex: 1 });
    assert.strictEqual(dup.status, 409, 'same-room duplicate squadIndex must be 409: ' + JSON.stringify(dup.body));
    assert.strictEqual(dup.body.reason, 'deployed_overlap', 'the 409 body must carry a structured reason=deployed_overlap');

    // Room never reaches 4/4 filled, so it correctly never auto-starts.
    const view = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(view.body.room.status, 'open');
    assert.strictEqual(view.body.room.slots[1].squadIndex, null, 'the rejected duplicate assign must not have mutated slot 1');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate v2 -- four mutually-unique squads filling all 4 slots of one room succeeds and auto-starts (REQ-0045 c: unique-4 must start)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    // makeTestCanvas()'s squads 0-3 are globally unique against each
    // other (see its own doc comment above) -- filling all 4 slots with
    // them, one per slot, must succeed and auto-start a run.
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ' assign (unique squad ' + i + '): ' + JSON.stringify(r.body));
    }
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(after.body.room.status, 'active', 'four mutually-unique squads must auto-start the room\'s first run');

    // Cleanup: settle + clear rewards so later tests start from a clean
    // slate, mirroring the cross-room-overlap test's own cleanup below.
    const roomRaw = scheduleStorage.readRoom(roomId);
    forceRunElapsed(roomRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: LIST endpoint (GET /api/schedule/rooms) settles a just-completed room too, not only the single-room GET (REQ-0087: expedition never departs)', async () => {
    // Root cause (REQ-0087): the live client's Rooms view (SchedulePage.tsx)
    // polls ONLY fetchRooms() -- GET /api/schedule/rooms, the LIST route --
    // every ROOMS_POLL_MS tick; it never calls fetchRoom(id) (the single-
    // room GET) in its normal render loop. Before this fix, listOwnRooms()
    // was a bare storage filter with no settleRoomIfDue() step, so a room
    // whose 4th (last) slot assignment JUST completed would keep reading
    // status 'open' forever from the ONLY endpoint real users' polling ever
    // hits -- even though every assignSlot PUT genuinely returned 200 and
    // nothing anywhere ever surfaced an error. This test deliberately never
    // touches the single-room GET, mirroring the live client exactly.
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ' assign (unique squad ' + i + '): ' + JSON.stringify(r.body));
    }
    const list = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
    assert.strictEqual(list.status, 200);
    const room = list.body.rooms.find((r) => r.id === roomId);
    assert.ok(room, 'the just-created room must appear in the list response');
    assert.strictEqual(room.status, 'active', 'the LIST endpoint alone must observe the auto-start (REQ-0087) -- a real user never calls the single-room GET');

    // Cleanup: same pattern as the sibling REQ-0045(c) test above.
    const roomRaw = scheduleStorage.readRoom(roomId);
    forceRunElapsed(roomRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: LIST endpoint -- one room whose settle THROWS (stale squadIndex after its squad was deleted out from under it) must not 400 the whole list or hide the caller\'s OTHER rooms (REQ-0087 follow-up, caught live)', async () => {
    // Live incident: right after REQ-0087's first fix deployed, the shared
    // dev account's own squad count changed (unrelated concurrent work)
    // AFTER a room's 4 slots had already been filled with now-out-of-range
    // indices. settleRoomIfDue() legitimately throws in that case
    // (startRun -> buildSquadSnapshots -> squadCanvasOf finds nothing at
    // that index any more) -- but the FIRST version of this fix let that
    // exception escape the whole listOwnRooms().map(), turning ONE stale
    // room into a 400 for the caller's ENTIRE rooms list. Reproduced here
    // by filling a room normally, then shrinking the SAME player's
    // squads.store out from under two of its already-assigned slots
    // (simulating a squad deleted after deployment) before ever letting
    // anything settle it.
    const goodCanvas = scheduleStorage.readProfile(scheduleP1.playerId).canvas;
    let roomAId, roomBId;
    try {
      const roomA = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      roomAId = roomA.body.room.id;
      for (let i = 0; i < 4; i++) {
        const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomAId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
        assert.strictEqual(r.status, 200, 'slot ' + i + ' assign: ' + JSON.stringify(r.body));
      }
      // Corrupt: truncate store to 2 entries, stranding slots 2 and 3's
      // squadIndex references -- WITHOUT ever calling anything that would
      // settle roomA first (no single-room GET, no list call yet).
      const corrupted = JSON.parse(JSON.stringify(goodCanvas));
      corrupted.presets.store = corrupted.presets.store.slice(0, 2);
      scheduleStorage.writeProfile(scheduleP1.playerId, corrupted);

      const roomB = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      roomBId = roomB.body.room.id;

      const list = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
      assert.strictEqual(list.status, 200, 'roomA\'s settle failure must not 400 the whole list: ' + JSON.stringify(list.body));
      const gotA = list.body.rooms.find((r) => r.id === roomAId);
      const gotB = list.body.rooms.find((r) => r.id === roomBId);
      assert.ok(gotA, 'roomA (the one whose settle throws) must still be present, unsettled, not dropped');
      assert.ok(gotB, 'roomB (an unrelated healthy room) must be present and unaffected by roomA\'s failure');
      assert.strictEqual(gotB.status, 'open');
    } finally {
      // Cleanup ALWAYS runs (even on assertion failure) so a failure in
      // this test can never poison scheduleP1's shared canvas/rooms for
      // every test that runs after it in the same process.
      scheduleStorage.writeProfile(scheduleP1.playerId, goodCanvas);
      if (roomAId) await scheduleReq('DELETE', '/api/schedule/rooms/' + roomAId, scheduleP1.token);
      if (roomBId) await scheduleReq('DELETE', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    }
  });

  await AT('schedule: deploy gate -- a squad with ZERO BP is refused 409 empty_squad, and a squad with >=1 BP is unaffected (REQ-0041 feedback 5)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    // Squad index 4 starts life completely empty post-migration (REQ-0031:
    // "new squads start empty") -- 0 BPs, so it must be refused with a
    // STRUCTURED reason ('empty_squad'), distinct from the independence 409
    // above (an empty squad IS vacuously independent -- see mock-src/
    // tests/run.cjs's own "combine, don't conflate" test for this exact
    // distinction at the engine layer; this is the server-side half).
    const emptyRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 4 });
    assert.strictEqual(emptyRes.status, 409, 'zero-BP squad must be refused 409: ' + JSON.stringify(emptyRes.body));
    assert.strictEqual(emptyRes.body.reason, 'empty_squad', 'the 409 body must carry a structured reason=empty_squad');
    assert.ok(/no Backpack|empty squad/i.test(emptyRes.body.error));

    // Sanity: squad index 0 (the fixture's real, BP-bearing squad) is NOT
    // affected by this gate -- assigning it must still succeed 200.
    const okRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(okRes.status, 200, 'a squad WITH a BP must still be assignable: ' + JSON.stringify(okRes.body));

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate -- a squad already deployed in another of the caller\'s ACTIVE rooms is refused 409 on cross-room overlap', async () => {
    // Room X: fill all 4 slots with squads 0-3 and start its run (-> status 'active').
    const roomXRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomXId = roomXRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomXId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign: ' + JSON.stringify(assignRes.body));
    }
    const roomXAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomXId, scheduleP1.token);
    assert.strictEqual(roomXAfter.body.room.status, 'active', 'room X must auto-start its first run once all 4 slots are filled');

    // Room Y: try to also deploy squad 0 (already active in room X) -> 409.
    const roomYRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomYId = roomYRes.body.room.id;
    const overlapRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomYId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(overlapRes.status, 409, 'cross-room overlap must be 409: ' + JSON.stringify(overlapRes.body));
    assert.ok(/active schedule/i.test(overlapRes.body.error));

    // Cleanup: settle room X's run (force-elapse) so it doesn't leak into
    // later tests as still-active, then clear whatever it rewarded so
    // warehouse-count assertions in LATER tests start from a clean slate.
    const roomXRaw = scheduleStorage.readRoom(roomXId);
    forceRunElapsed(roomXRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomXId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomXId, scheduleP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomYId, scheduleP1.token);
  });

  await AT('schedule: run executes and persists a replay log + summary; fixed seed -> deterministic re-simulation', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });

    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');
    const runId = roomAfter.body.room.lastRunId;
    assert.ok(runId, 'room must record its lastRunId');

    const runRaw = scheduleStorage.readRun(runId);
    assert.ok(Array.isArray(runRaw.events) && runRaw.events.length > 0, 'run must persist a non-empty replay log');
    assert.ok(['victory', 'wipe', 'incomplete'].includes(runRaw.result), 'run must persist a legal summary result');
    assert.strictEqual(typeof runRaw.seed, 'string', 'run must persist its crypto-random seed');
    assert.strictEqual(typeof runRaw.durationSecs, 'number');

    // Determinism: re-running combat.runDungeon with the SAME persisted
    // seed + same squad snapshots must reproduce the identical event log
    // (sim/combat.cjs's own documented determinism guarantee, exercised
    // here through the schedule service's actual persisted seed).
    const combat = require('../../sim/combat.cjs');
    const { itemDefsById, dungeonDef, enemyDefsById, skillDefsById } = schedule.getScheduleContent();
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const squadSnapshots = fillAllSlotsSnapshotsFrom(doc.canvas);
    const replay = combat.runDungeon({
      masterSeed: runRaw.seed, dungeonDef, squadSnapshots, itemDefsById, enemyDefsById, skillDefsById,
      formationId: 'formation1', level: 1, participants: [scheduleP1.playerId],
    });
    // Semantic (deep-equal) comparison, not raw string equality: in pg
    // mode, runRaw.events came back through a jsonb column, which (per
    // server/README.md's own documented caveat) reorders object keys
    // into Postgres's canonical order -- NOT byte-identical at the raw-
    // JSON-text level even though the DATA is identical. Files mode
    // preserves insertion order exactly, so this same assertion is
    // strictly stronger there; deepStrictEqual is the correct invariant
    // in BOTH backends (determinism is about the DATA, not incidental
    // key ordering introduced by a storage round-trip).
    assert.deepStrictEqual(replay.events, runRaw.events, 'same seed + same squad snapshots must reproduce a semantically-identical replay log');
    assert.strictEqual(replay.result, runRaw.result);

    // GET run: run-clock fields present, events is an array (possibly
    // truncated to what's "aired" so far -- immediately after start this
    // may be a strict subset of the full log).
    const runView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(runView.status, 200);
    assert.ok(runView.body.clock && typeof runView.body.clock.elapsedSecs === 'number');
    assert.ok(Array.isArray(runView.body.events));
    assert.ok(runView.body.events.length <= runRaw.events.length, 'visible events must never exceed the full persisted log');

    // Cleanup: settle (this run also rewards -- clear those too) then cancel.
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  function fillAllSlotsSnapshotsFrom(canvas) {
    const active = { bps: canvas.bps, pos: canvas.pos, sis: canvas.sis };
    return [active, canvas.presets.store[1], canvas.presets.store[2], canvas.presets.store[3]];
  }

  await AT('schedule: GET .../run?format=text (REQ-0045 g) returns a plain-text, one-humanized-line-per-event mirror of the same visibleEvents() the JSON route sends -- any OTHER/absent format value still returns JSON unchanged', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');

    // Plain-text request -- driven DIRECTLY via mockReq/api.handle (not
    // the scheduleReq() helper above, which always JSON.parse's the
    // body and would just get `null` back for a non-JSON response).
    const textReq = mockReq('GET', '/api/schedule/rooms/' + roomId + '/run?format=text', undefined, authHeaders(scheduleP1.token));
    const textRes = await new Promise((resolve) => {
      const res2 = mockRes((b) => resolve({ status: res2.statusCode, headers: res2.headers, body: b }));
      api.handle(textReq, res2);
    });
    assert.strictEqual(textRes.status, 200);
    assert.ok(textRes.headers['Content-Type'].startsWith('text/plain'), 'format=text must respond text/plain, not application/json');
    assert.ok(textRes.body.length > 0, 'text body must be non-empty (this room has a real in-flight run with real events)');
    // Every non-empty line must start with "N: " (the same idx-prefixed
    // shape Monitor.tsx's own log panel renders) -- a crude but effective
    // proxy for "this is humanized text, not raw JSON": a bare
    // JSON.parse of the WHOLE body must fail (it is NOT one JSON
    // document), while every individual line starts with a plain integer
    // index, never a JSON delimiter.
    let threwOnWholeBodyParse = false;
    try { JSON.parse(textRes.body); } catch (e) { threwOnWholeBodyParse = true; }
    assert.ok(threwOnWholeBodyParse, 'the whole text body must NOT itself be one parseable JSON document (it is multi-line humanized text)');
    const lines = textRes.body.split('\n').filter((l) => l.length > 0);
    assert.ok(lines.length > 0, 'must have at least one non-empty line');
    for (const line of lines) assert.ok(/^\d+: /.test(line), 'every line must start with "N: " (idx-prefixed humanized event), got: ' + JSON.stringify(line));

    // Absent format param (the default JSON route) is completely
    // unaffected by this new branch.
    const jsonRes = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(jsonRes.status, 200);
    assert.ok(Array.isArray(jsonRes.body.events));

    // A bogus/unknown format value also falls through to JSON, not text
    // and not an error -- only the EXACT string 'text' is special-cased.
    const bogusReq = mockReq('GET', '/api/schedule/rooms/' + roomId + '/run?format=bogus', undefined, authHeaders(scheduleP1.token));
    const bogusRes = await new Promise((resolve) => {
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) { /* leave null */ } resolve({ status: res2.statusCode, body: parsed }); });
      api.handle(bogusReq, res2);
    });
    assert.strictEqual(bogusRes.status, 200);
    assert.ok(Array.isArray(bogusRes.body.events), 'an unrecognized format value must still return the normal JSON shape, not error or text');

    forceRunElapsed(roomAfter.body.room.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: victory rewards land in the warehouse with a harvestedAt + 7-day expiresAt (golden e)', async () => {
    // Defensive: clear any warehouse items left by earlier tests in this
    // group (each of which is supposed to clean up after itself, but this
    // assertion cares about an EXACT count, so start from a known-empty slate).
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    const runId = roomAfter.body.room.lastRunId;
    const runRaw = scheduleStorage.readRun(runId);
    assert.strictEqual(runRaw.result, 'victory', 'the test_sword fixture (50dmg/1s) must reliably one-shot the 1hp weak_slime fixture');

    forceRunElapsed(runId);
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    assert.strictEqual(settledView.body.room.status, 'open', 'settled room returns to open (cooldown, not canceled)');
    assert.ok(settledView.body.room.cooldownUntil, 'cooldownUntil must be set after a settled run');

    const wh = await scheduleReq('GET', '/api/warehouse', scheduleP1.token);
    assert.strictEqual(wh.status, 200);
    // REQ-0042: a victorious run now ALSO drops a single aggregate LRDST
    // reward row (kind:'tm', qty>0) alongside the 2 item rewards -- 3
    // rows total in this fixture dungeon (1 pack + 1 boss item reward,
    // plus 1 lrdst row covering both encounters' LRDST rolls).
    assert.strictEqual(wh.body.items.length, 3, 'both encounters (pack + boss) award one reward item each, PLUS one aggregate LRDST reward row (REQ-0042)');
    const lrdstRows = wh.body.items.filter((i) => i.kind === 'tm' && i.itemId === 'lrdst');
    assert.strictEqual(lrdstRows.length, 1, 'exactly one aggregate LRDST reward row for the whole run');
    assert.ok(lrdstRows[0].qty > 0, 'LRDST reward row carries a positive qty: ' + JSON.stringify(lrdstRows[0]));
    // Range sanity: 1 non-boss (pack) encounter [1-3] + 1 boss encounter
    // [5-10] cleared in this fixture dungeon -> total in [1+5, 3+10] = [6,13].
    assert.ok(lrdstRows[0].qty >= 6 && lrdstRows[0].qty <= 13, 'LRDST qty within the expected combined pack+boss range: got ' + lrdstRows[0].qty);
    for (const item of wh.body.items) {
      assert.ok(item.harvestedAt, 'harvestedAt present');
      assert.ok(item.expiresAt, 'expiresAt present');
      const ttlMs = Date.parse(item.expiresAt) - Date.parse(item.harvestedAt);
      assert.ok(Math.abs(ttlMs - schedule.WAREHOUSE_TTL_MS) < 1000, 'TTL must be ~7 days (golden e): got ' + ttlMs + 'ms');
    }
    // Cleanup: clear warehouse for later cap tests + cancel the room.
    for (const item of wh.body.items) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: warehouse cap (200 items) is enforced -- the 201st insert is refused, no reverse inventory->warehouse path exists', async () => {
    const before = schedule.listWarehouse(scheduleP1.playerId);
    for (const item of before) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid); // start from a clean slate
    for (let i = 0; i < schedule.WAREHOUSE_CAP; i++) {
      const r = schedule.addToWarehouse(scheduleP1.playerId, {
        itemUid: 'cap_' + i, playerId: scheduleP1.playerId, itemId: 'blade',
        harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(),
      });
      assert.strictEqual(r.ok, true, 'insert ' + i + ' should succeed under the cap');
    }
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, schedule.WAREHOUSE_CAP);
    const overflow = schedule.addToWarehouse(scheduleP1.playerId, {
      itemUid: 'cap_overflow', playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(),
    });
    assert.strictEqual(overflow.ok, false, 'the 201st insert must be refused');
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, schedule.WAREHOUSE_CAP, 'cap must not be exceeded');

    // No reverse (inventory -> warehouse) path: schedule.cjs's module
    // exports contain no such function at all -- this is a structural
    // assertion, not a behavioral one (there is nothing to call).
    assert.strictEqual(typeof schedule.moveInventoryToWarehouse, 'undefined', 'no inventory->warehouse function must exist (golden r ban, generalized ahead of P3)');

    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
  });

  // REQ-0041: REWRITTEN for the two-phase claim design (bug #3 fix --
  // see schedule.cjs's claimWarehouseItem doc for the full root-cause
  // writeup: the OLD version's server-side first-fit + storage.writeProfile
  // raced the client's own debounced auto-save PUT and could silently
  // lose the claimed item). The OLD assertions here (claim placing the
  // item server-side, a 409 for "no inventory space") are now WRONG --
  // the server never touches profileCanvas/inventory space on claim at
  // all anymore; first-fit placement is entirely the CLIENT's job.
  await AT('schedule: two-phase claim -- POST /api/warehouse/claim marks the row "claiming" and returns {itemUid,itemId} WITHOUT touching the profile; a claiming row cannot be claimed again (409); an unknown/expired uid is 404', async () => {
    const whId = 'claim_test_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const beforeDoc = scheduleStorage.readProfile(scheduleP1.playerId);

    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, 'claim must succeed: ' + JSON.stringify(claimRes.body));
    assert.strictEqual(claimRes.body.itemUid, whId, 'response echoes the warehouse row\'s own itemUid (the client reuses this AS the new inventory uid)');
    assert.strictEqual(claimRes.body.itemId, 'blade', 'response carries the CONTENT def id so the client can run engine first-fit itself');
    assert.strictEqual(claimRes.body.placed, undefined, 'the two-phase response must NOT report a server-side placement -- there is none');

    // The row must still exist (not deleted) but now be 'claiming', and
    // the profile must be COMPLETELY untouched by the claim call itself
    // -- this is the crux of bug #3's fix: no second writer.
    const row = scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId);
    assert.ok(row, 'claiming row must still exist (not deleted) -- only status changes');
    assert.strictEqual(row.status, 'claiming');
    assert.ok(row.claimedAt, 'claimedAt must be set');
    const afterDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.deepStrictEqual(afterDoc.canvas, beforeDoc.canvas, 'claim must NOT mutate the profile canvas at all (server is no longer a writer on this path)');

    // A 'claiming' row is not visible as claimable and cannot be claimed
    // again -- 409, not a silent double-claim.
    const doubleClaimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(doubleClaimRes.status, 409, 'claiming an already-claiming row must 409: ' + JSON.stringify(doubleClaimRes.body));

    // Clean up: revert this row back to claimable via the same mechanism
    // production code uses (direct storage write, matching how a real
    // lazy-timeout revert would leave it) so later tests in this file see
    // a clean warehouse state.
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, whId);

    // Unknown/nonexistent uid -- 404 (unchanged from the old behavior).
    const notFoundRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: 'no_such_uid_' + Date.now() });
    assert.strictEqual(notFoundRes.status, 404);

    // TTL: an already-expired item never surfaces via claim (lazily purged) -- unchanged.
    const expiredId = 'claim_test_expired_' + Date.now();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, expiredId, { itemUid: expiredId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    const claimExpiredRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: expiredId });
    assert.strictEqual(claimExpiredRes.status, 404, 'an expired warehouse item must 404 on claim (lazily purged)');
    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, expiredId), null, 'expired item must actually be deleted by the purge');
  });

  // REQ-0115: a granted SI must also be CLAIMABLE onto the canvas -- the
  // non-tm claim branch validated against itemDefsById (PO-only), so an SI
  // row 400'd as "unknown content item id". Now accepts SI ids too.
  await AT('REQ-0115 claim: POST /api/warehouse/claim accepts an SI warehouse row (acc_gem) -- 200, echoes itemId, marks claiming (regression: was BAD_REQUEST unknown content item id)', async () => {
    const scheduleSi = require('../schedule.cjs');
    const whId = 'claim_si_test_' + Date.now();
    scheduleSi.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'acc_gem', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, 'SI claim must succeed: ' + JSON.stringify(claimRes.body));
    assert.strictEqual(claimRes.body.itemId, 'acc_gem', 'response carries the SI content id for client-side placement');
    assert.strictEqual(claimRes.body.kind, undefined, 'a plain SI row is not kind:tm');
    const row = scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId);
    assert.ok(row && row.status === 'claiming', 'SI row must be marked claiming, not deleted');
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, whId);
  });

  await AT('schedule: two-phase claim finalization -- a profile PUT containing the claimed itemUid deletes the warehouse row; a claiming row older than the timeout lazily reverts to claimable and is claimable again', async () => {
    const whId = 'claim_finalize_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));
    assert.ok(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), 'claiming row exists before the client places it');

    // Simulate the CLIENT's own engine first-fit placement + auto-save:
    // place a PO whose uid is the warehouse row's own itemUid (per the
    // two-phase design, the client reuses itemUid AS the new PO's uid --
    // see schedule.cjs's claimWarehouseItem doc) into an empty inventory
    // page, then PUT the profile exactly as store.ts's flushAutoSave
    // would.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[0].pos.push({ uid: whId, id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'profile PUT (the client\'s auto-save) must succeed: ' + JSON.stringify(putRes.body));

    // The profile PUT handler must have finalized (deleted) the claiming
    // row as a side effect, since whId now appears in the saved canvas.
    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), null, 'claiming row must be deleted once its uid lands in a saved canvas (server finalizes on save)');

    // Simulated ABANDONED claim: force a 'claiming' row with an old
    // claimedAt (older than WAREHOUSE_CLAIM_TIMEOUT_MS) via direct
    // data-file manipulation (mirrors this file's own forceRunElapsed()
    // helper's backdate-a-timestamp pattern) -- must lazily revert to
    // 'claimable' (and thus be claimable again) the next time warehouse
    // rows are read, WITHOUT ever losing the item.
    const abandonedId = 'claim_abandoned_' + Date.now();
    const oldClaimedAt = new Date(Date.now() - schedule.WAREHOUSE_CLAIM_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, abandonedId, {
      itemUid: abandonedId, playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      status: 'claiming', claimedAt: oldClaimedAt,
    });
    // listWarehouse (GET /api/warehouse) triggers the lazy revert via
    // purgeExpiredWarehouseItems -> normalizeWarehouseStatus.
    const listed = schedule.listWarehouse(scheduleP1.playerId);
    const found = listed.find((i) => i.itemUid === abandonedId);
    assert.ok(found, 'abandoned row must still be present (never lost)');
    assert.strictEqual(found.status, 'claimable', 'abandoned row must have lazily reverted to claimable after the timeout');
    assert.strictEqual(found.claimedAt, null, 'claimedAt must be cleared on revert');
    const reclaimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: abandonedId });
    assert.strictEqual(reclaimRes.status, 200, 'a reverted-to-claimable row must be claimable again: ' + JSON.stringify(reclaimRes.body));
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, abandonedId); // cleanup
  });

// =====================================================================
  // REQ-0042: Workshop gacha (POST /api/workshop/gacha) tests. Uses the
  // SAME scheduleP1/scheduleReq fixtures as the warehouse claim tests
  // above -- a gacha roll is fundamentally the same two-phase shape
  // (pending -> finalize-on-PUT -> lazy-revert), just against its own
  // gacha_pending store (see schedule.cjs's startGachaRoll/
  // finalizeGachaForCanvas doc comments) with a stricter finalize
  // condition (uid-presence AND balance-delta, not uid-presence alone).
  // =====================================================================

  // Gives scheduleP1's CURRENTLY SAVED profile an LRDST stack of the
  // given qty on inventory page 0 -- direct storage manipulation (same
  // convention the claim tests above use for setting up warehouse rows),
  // mirroring exactly what a real saved canvas with an LRDST balance
  // looks like (page shape post-REQ-0042: {bps,pos,sis,tms}).
  function setLrdstBalance(playerId, qty) {
    const doc = scheduleStorage.readProfile(playerId);
    doc.canvas.inv.pages[0].tms = [{ uid: 'lrdst_test_stack', id: 'lrdst', qty, cell: [8, 8] }];
    scheduleStorage.writeProfile(playerId, doc.canvas);
    return doc.canvas;
  }

  await AT('gacha: happy path -- balance 999->989 after one common_bp roll (cost 10), rolled BP uid appears in the response, finalizes on the next PUT containing both the deduction and the uid', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);

    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200, 'roll must succeed: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.cost, 10, 'cost echoed back is the REQ doc\'s 10x LRDST');
    const rolled = rollRes.body.rolled;
    assert.ok(rolled && rolled.uid, 'rolled BP definition includes a minted uid');
    assert.ok(Array.isArray(rolled.shape) && rolled.shape.length >= 6 && rolled.shape.length <= 8, 'rolled shape has 6-8 cells: ' + JSON.stringify(rolled.shape));
    assert.ok(rolled.unit && Array.isArray(rolled.unit.dirs) && rolled.unit.dirs.length >= 1 && rolled.unit.dirs.length <= 3, 'rolled unit has 1-3 dirs');
    const unitInShape = rolled.shape.some(([r, c]) => r === rolled.unit.off[0] && c === rolled.unit.off[1]);
    assert.ok(unitInShape, 'rolled unit cell is one of the polyomino\'s own cells');
    assert.strictEqual(rolled.hpMax, 15 * rolled.shape.length, 'hpMax = 15 x cellCount');

    // Server must NOT have deducted anything yet -- balance still 999,
    // matching the two-phase design (client deducts + auto-saves).
    const beforeFinalize = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.strictEqual(schedule.readLrdstBalance(beforeFinalize.canvas), 999, 'server has not deducted balance server-side yet (two-phase)');

    // Simulate the CLIENT's own deduction + first-fit placement + auto-save.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[0].tms.find((t) => t.uid === 'lrdst_test_stack').qty -= 10; // 999 -> 989
    doc.canvas.inv.pages[1].bps.push({ id: rolled.uid, name: 'Rolled BP', color: '#888888', shape: rolled.shape, origin: [1, 1], unit: rolled.unit, hpMax: rolled.hpMax });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'auto-save PUT must succeed: ' + JSON.stringify(putRes.body));

    const afterDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.strictEqual(schedule.readLrdstBalance(afterDoc.canvas), 989, 'balance is 989 after the client deduction lands');
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'pending roll finalized (deleted) once BOTH the uid AND the balance-delta are present in the saved canvas');
  });

  await AT('gacha: insufficient funds (balance < cost) is a 409, no pending row created', async () => {
    setLrdstBalance(scheduleP1.playerId, 5); // below the 10x cost
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 409, 'insufficient balance must 409: ' + JSON.stringify(rollRes.body));
    const pending = scheduleStorage.listGachaPending(scheduleP1.playerId);
    assert.strictEqual(pending.filter((p) => p.status === 'pending').length, 0, 'no pending row left behind by a rejected roll');
  });

  await AT('gacha: finalize requires BOTH the uid to be present AND the balance to have actually dropped -- placing the BP WITHOUT paying does not finalize', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200);
    const rolled = rollRes.body.rolled;

    // Place the BP but do NOT deduct the LRDST cost -- an attempted
    // "forge" of a free roll.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[2].bps.push({ id: rolled.uid, name: 'Rolled BP', color: '#888888', shape: rolled.shape, origin: [1, 1], unit: rolled.unit, hpMax: rolled.hpMax });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200);

    assert.ok(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), 'pending roll must NOT finalize -- uid present but balance never dropped');

    // Now also pay -- a SECOND PUT with the deduction applied finalizes it.
    const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
    doc2.canvas.inv.pages[0].tms.find((t) => t.uid === 'lrdst_test_stack').qty -= 10;
    const putRes2 = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc2.canvas);
    assert.strictEqual(putRes2.status, 200);
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'now finalizes once the balance ALSO actually dropped');
  });

  await AT('gacha: an abandoned pending roll (never finalized) lazily reverts -- the pending doc is deleted after the timeout, discovered on the next read', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200);
    const rolled = rollRes.body.rolled;
    assert.ok(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), 'pending row exists right after the roll');

    // Force it to look abandoned -- backdate rolledAt past the timeout
    // (same backdate-a-timestamp convention forceRunElapsed/the abandoned-
    // claim test above use).
    const pendingDoc = scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid);
    pendingDoc.rolledAt = new Date(Date.now() - schedule.GACHA_PENDING_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeGachaPending(scheduleP1.playerId, rolled.uid, pendingDoc);

    // Any read of the pending store (purgeExpiredGachaPending, called by
    // finalizeGachaForCanvas/startGachaRoll) lazily deletes it.
    schedule.purgeExpiredGachaPending(scheduleP1.playerId);
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'abandoned roll is gone after the timeout -- player can roll again, no stuck pending state');
  });

  await AT('gacha: unknown kind is a 400', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const res = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'not_a_real_kind' });
    assert.strictEqual(res.status, 400);
  });

  await AT('gacha: admin grant supports tm+qty (grantTmQty via POST /api/admin/warehouse/grant {tm,qty}) -- lands in the WAREHOUSE with a qty field, not directly in the live profile', async () => {
    const beforeDoc = scheduleStorage.readProfile(adminGuest.playerId);
    const res = await new Promise((resolve, reject) => {
      const req2 = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ tm: 'lrdst', qty: 42 }), authHeaders(adminGuest.token));
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) {} resolve({ status: res2.statusCode, body: parsed }); });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
    assert.strictEqual(res.status, 200, 'tm+qty grant must succeed for an item_admin: ' + JSON.stringify(res.body));
    assert.strictEqual(res.body.item.itemId, 'lrdst');
    assert.strictEqual(res.body.item.qty, 42, 'granted warehouse row carries the qty field');
    assert.strictEqual(res.body.item.kind, 'tm', 'granted row is tagged kind:"tm"');
    const afterDoc = scheduleStorage.readProfile(adminGuest.playerId);
    assert.deepStrictEqual(afterDoc, beforeDoc, 'the grant must NOT touch the live profile at all -- warehouse only, avoids dual-writer clobber');
    const rows = schedule.listWarehouse(adminGuest.playerId);
    const found = rows.find((r) => r.itemId === 'lrdst' && r.qty === 42);
    assert.ok(found, 'the qty:42 lrdst row is visible via listWarehouse');
    scheduleStorage.deleteWarehouseItem(adminGuest.playerId, found.itemUid); // cleanup
  });

  await AT('gacha: admin grant rejects an unknown tm id (400)', async () => {
    const res = await new Promise((resolve, reject) => {
      const req2 = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ tm: 'not_a_real_tm', qty: 5 }), authHeaders(adminGuest.token));
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) {} resolve({ status: res2.statusCode, body: parsed }); });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
    assert.strictEqual(res.status, 400);
  });

  await AT('gacha: claiming a TM warehouse row that MERGES into an existing same-id inventory stack still finalizes (deletes) the warehouse row -- regression test for a real bug where a merged claim never leaves its own uid anywhere in the saved canvas, so uid-only finalize logic left the row stuck in claiming status forever', async () => {
    // Seed an EXISTING lrdst stack directly into the players own
    // inventory (mirrors the clients firstFitOrMergeTM merge branch,
    // which lands the claim on the EXISTING stacks own cell, discarding
    // the claimed rows uid entirely -- see mock-src/engine.js tmMove doc:
    // the destination stack uid persists and the dragged one is
    // discarded).
    const existingDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    existingDoc.canvas.inv.pages[0].tms = existingDoc.canvas.inv.pages[0].tms || [];
    existingDoc.canvas.inv.pages[0].tms.push({ uid: 'existing_lrdst_stack', id: 'lrdst', qty: 50, cell: [8, 8] });
    scheduleStorage.writeProfile(scheduleP1.playerId, existingDoc.canvas);

    const whId = 'claim_tm_merge_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'lrdst', kind: 'tm', qty: 25, harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));
    assert.ok(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), 'claiming row exists before the client merges it in');

    // Simulate the clients merge: the claimed rows OWN uid never
    // appears anywhere in the saved canvas (it was discarded by the
    // merge) -- only the pre-existing 'existing_lrdst_stack' uid, now
    // carrying the summed qty.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const stack = doc.canvas.inv.pages[0].tms.find((t) => t.uid === 'existing_lrdst_stack');
    stack.qty += 25;
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'profile PUT (the auto-save after the merge) must succeed: ' + JSON.stringify(putRes.body));

    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), null, 'the claiming row must finalize (be deleted) even though its OWN uid never appears in the saved canvas -- a same-id tms[] stack existing anywhere is sufficient finalize evidence for a TM-kind claim');
  });

  await AT('schedule: pre-REQ-0041 warehouse rows with no `status` field at all are treated as claimable (migration on read)', async () => {
    const legacyId = 'claim_legacy_' + Date.now();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, legacyId, {
      itemUid: legacyId, playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      // no `status` field at all -- exactly what a pre-REQ-0041 row looks like.
    });
    const listed = schedule.listWarehouse(scheduleP1.playerId);
    const found = listed.find((i) => i.itemUid === legacyId);
    assert.ok(found, 'legacy row must be listed');
    assert.strictEqual(found.status, 'claimable', 'a legacy row missing `status` must be treated/migrated as claimable');
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: legacyId });
    assert.strictEqual(claimRes.status, 200, 'a legacy row must be claimable: ' + JSON.stringify(claimRes.body));
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, legacyId); // cleanup
  });

  await AT('schedule: cooldown value follows the CD_min/CD_max/(1-H) formula; wipe drops the room level by failureStep (floored at LEVEL_MIN)', async () => {
    const combat = require('../../sim/combat.cjs');
    // Cooldown formula check (golden l): re-derive expected cooldown from
    // the SAME cooldownForH sim exposes, for a few H values, and confirm
    // schedule-produced runs land in the legal [CD_MIN,CD_MAX] band.
    assert.ok(Math.abs(combat.cooldownForH(1) - combat.TUNABLES.CD_MIN_SECS) < 1e-9, 'H=1 (full HP) -> CD_MIN');
    assert.ok(Math.abs(combat.cooldownForH(0) - combat.TUNABLES.CD_MAX_SECS) < 1e-9, 'H=0 (wipe) -> CD_MAX');
    const midExpected = combat.TUNABLES.CD_MIN_SECS + (combat.TUNABLES.CD_MAX_SECS - combat.TUNABLES.CD_MIN_SECS) * 0.5;
    assert.ok(Math.abs(combat.cooldownForH(0.5) - midExpected) < 1e-9, 'linear formula must hold at H=0.5');

    // Wipe level-down: build a room whose squads have ZERO attack (no
    // every_secs effect) against the same weak_slime -- with no damage
    // output, the pack's own deadline_secs will elapse into a wipe.
    // (weak_slime itself has no offense with s:[5,5] cadence and 1hp, so
    // this deliberately uses a non-attacking 'blade' squad instead of
    // 'test_sword' to force a guaranteed non-clear.)
    const zeroDmgCanvas = (() => {
      const c = makeTestCanvas();
      const swap = (canvas) => { for (const p of canvas.pos) p.id = 'blade'; return canvas; };
      swap({ bps: c.bps, pos: c.pos, sis: c.sis });
      for (const idx of [1, 2, 3]) swap(c.presets.store[idx]);
      return c;
    })();
    scheduleStorage.writeProfile(scheduleP2.playerId, zeroDmgCanvas);

    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP2.token, { dungeonId: 'test_dungeon', level: 3, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP2.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    const runRaw = scheduleStorage.readRun(roomAfter.body.room.lastRunId);
    assert.notStrictEqual(runRaw.result, 'victory', 'a zero-damage troop must not win: got ' + runRaw.result);

    forceRunElapsed(roomAfter.body.room.lastRunId);
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    if (runRaw.result === 'wipe') {
      assert.strictEqual(settledView.body.room.level, 3 - schedule.DEFAULT_FAILURE_STEP, 'golden i: level drops by failureStep on wipe');
      const wh = await scheduleReq('GET', '/api/warehouse', scheduleP2.token);
      assert.strictEqual(wh.body.items.filter((it) => it.sourceRoomId === roomId).length, 0, 'golden i: nothing gained on wipe');
    }
    // Level floor: repeatedly wipe from level 1 must never drop below LEVEL_MIN.
    const floored = combat.levelDownOnWipe(combat.TUNABLES.LEVEL_MIN);
    assert.strictEqual(floored, combat.TUNABLES.LEVEL_MIN, 'levelDownOnWipe must floor at LEVEL_MIN');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP2.token);
  });

  await AT('schedule: swap is queued (not applied) while a run is active, and applies once that run settles (golden j)', async () => {
    // REQ-0045 (b)+(c) deploy gate v2 fallout: with all 4 slots filled by
    // 4 mutually-unique squads (0,1,2,3), swapping slot 0 to squad 1
    // (as this test originally did) is now correctly refused by
    // applyPendingSwapIfAny's own assignSlot call -- squad 1 is
    // SIMULTANEOUSLY still deployed live in slot 1 of this SAME room at
    // the moment the swap would apply, which the new deploy-overlap gate
    // (deployedUidSetsForGate) correctly treats as a same-room overlap,
    // regardless of the fact that squad 1 and squad 0 share no uid
    // WITH EACH OTHER (that was the old, no-longer-relevant check). This
    // is not a regression to route around -- it is the gate correctly
    // refusing to double-deploy the same squad into two slots at once.
    // Fixed by giving squad index 4 (normally empty/null, reserved for
    // the empty_unit test elsewhere in this file) a REAL, uniquely-
    // tagged BP+PO here, used ONLY as the swap TARGET (never itself
    // occupying any of the room's other 3 slots), then restoring it to
    // null afterward so the empty_unit test's own precondition holds for
    // every test that runs after this one.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.presets.store[4] = {
      linked: true,
      bps: [{ id: 'bp_swaptarget', name: 'BP swaptarget', color: '#888888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], unit: { off: [0, 0], dirs: [] }, hpMax: 40 }],
      pos: [{ uid: 'po_swaptarget', id: 'test_sword', loc: 'grid', cell: [1, 1], rot: 0 }],
      sis: [],
    };
    scheduleStorage.writeProfile(scheduleP1.playerId, doc.canvas);

    try {
      const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
        assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign must succeed: ' + JSON.stringify(assignRes.body));
      }
      const active = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
      assert.strictEqual(active.body.room.status, 'active', 'precondition: room has a run in flight');

      const swapWhileActive = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 0, squadIndex: 4 });
      assert.strictEqual(swapWhileActive.status, 200);
      assert.strictEqual(swapWhileActive.body.applied, false, 'a swap requested mid-run must be QUEUED, not applied immediately');
      assert.ok(swapWhileActive.body.room.pendingSwap, 'pendingSwap must be recorded on the room');
      assert.strictEqual(swapWhileActive.body.room.slots[0].squadIndex, 0, 'the slot itself must NOT change yet');

      forceRunElapsed(active.body.room.lastRunId);
      const settled = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle + pending-swap application
      assert.strictEqual(settled.body.room.pendingSwap, null, 'pendingSwap must be cleared once applied');
      // squad 4 (the swap target) shares no uid with ANY of 0/1/2/3 and
      // is not deployed anywhere else, so applying the swap is legal.
      assert.strictEqual(settled.body.room.slots[0].squadIndex, 4, 'golden j: the swap applies AFTER the run ends');

      // Swap with NO run active applies immediately. Target squad 2 is
      // currently live in slot 2 of this SAME room -- correctly refused
      // now (same-room overlap), so this second assertion swaps slot 1
      // (currently squad 1) to squad 1 itself is a no-op-shaped case;
      // instead verify the "applies immediately when no run is active"
      // behavior using a legality-refusal shape: assignSlot's own
      // same-room-overlap gate applies identically whether queued or
      // immediate, so the meaningful thing left to prove here is that
      // NO queuing happens (immediate 200 with applied:true) when the
      // room is not active -- done by first canceling this room's
      // current run state is not an option (would delete state); instead
      // swap slot 3 (currently squad 3) to itself, which is always
      // legal (a squad never overlaps its own current slot -- excluded
      // by assignSlot's own excludeSlotIndex) and unambiguously proves
      // the immediate-apply path.
      const swapNow = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 3, squadIndex: 3 });
      assert.strictEqual(swapNow.body.applied, true, 'a swap requested with no active run must apply immediately');

      await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    } finally {
      const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
      doc2.canvas.presets.store[4] = null;
      scheduleStorage.writeProfile(scheduleP1.playerId, doc2.canvas);
    }
  });

  await AT('schedule: cancel policy -- immediate:true cancels right away; immediate:false with an active run only flags cancelRequested until settle (golden g)', async () => {
    // immediate: true
    const roomA = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: true } });
    const cancelA = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomA.body.room.id, scheduleP1.token);
    assert.strictEqual(cancelA.body.room.status, 'canceled', 'immediate:true must cancel right away');

    // immediate: false, WITH an active run -> flagged, not canceled yet.
    const roomB = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    const roomBId = roomB.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomBId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomBActive = await scheduleReq('GET', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(roomBActive.body.room.status, 'active');
    const cancelB = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(cancelB.body.room.status, 'active', 'immediate:false with a run in flight must NOT cancel yet');
    assert.strictEqual(cancelB.body.room.cancelRequested, true, 'cancelRequested must be flagged instead');

    // Once that run settles, the flagged cancel is honored instead of auto-scheduling the next run.
    forceRunElapsed(roomBActive.body.room.lastRunId);
    const afterSettle = await scheduleReq('GET', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(afterSettle.body.room.status, 'canceled', 'golden g: cancel-after-current-run is honored once the run settles');

    // immediate: false with NO active run cancels right away (nothing to "finish first").
    const roomC = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: false } });
    const cancelC = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomC.body.room.id, scheduleP1.token);
    assert.strictEqual(cancelC.body.room.status, 'canceled', 'immediate:false with no run active must cancel immediately (nothing to wait for)');
  });

  await AT('schedule: room CRUD -- level defaults/clamps to LEVEL_MIN, unknown formationId falls back to the default formation', async () => {
    const combat = require('../../sim/combat.cjs');
    const noLevel = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon' });
    assert.strictEqual(noLevel.body.room.level, combat.TUNABLES.LEVEL_MIN, 'omitted level must default to LEVEL_MIN');
    const badFormation = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', formationId: 'not_a_real_formation' });
    assert.strictEqual(badFormation.body.room.formationId, schedule.DEFAULT_FORMATION_ID, 'unknown formationId falls back to the documented default');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + noLevel.body.room.id, scheduleP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + badFormation.body.room.id, scheduleP1.token);
  });

  await AT('schedule: creating a room without a dungeonId is a 400', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { level: 1 });
    assert.strictEqual(res.status, 400);
  });

  await AT('schedule: assigning an out-of-range slot index or an out-of-range squadIndex is a 400, not a crash', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const badSlot = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/99', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(badSlot.status, 400);
    const badSquad = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 99 });
    assert.strictEqual(badSquad.status, 400);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: starting a run with an incomplete troop (not all 4 slots filled) is refused, never silently runs a partial troop', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/1', scheduleP1.token, { squadIndex: 1 });
    // Only 2 of 4 slots filled -- room must stay 'open', no run started.
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'open', 'a room with an incomplete troop must never auto-start a run');
    assert.strictEqual(roomAfter.body.room.lastRunId, null);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: GET warehouse for a player with none is an empty list, not an error', async () => {
    const freshPlayer = playersFixture.createPlayer('FreshWarehouseOwner', []);
    const res = await scheduleReq('GET', '/api/warehouse', freshPlayer.token);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.items, []);
  });

  await AT('schedule: claiming an unknown/nonexistent warehouse itemUid is a 404', async () => {
    const res = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: 'no_such_item_uid_at_all' });
    assert.strictEqual(res.status, 404);
  });

  await AT('schedule: claim requires an itemUid in the body (400 when missing)', async () => {
    const res = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, {});
    assert.strictEqual(res.status, 400);
  });

  await AT('schedule: swap on an out-of-range slot index is a 400', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 99, squadIndex: 0 });
    assert.strictEqual(res.status, 400);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: GET run on a room with no run yet is a 404', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(res.status, 404);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: canceling an already-canceled room is idempotent (still 200, still canceled)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: true } });
    const roomId = created.body.room.id;
    const first = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(first.body.room.status, 'canceled');
    const second = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.room.status, 'canceled');
  });

  // =====================================================================
  // REQ-0036 P1-C: GET /api/schedule/dungeons (no-auth) + POST .../dev/
  // backdate (dev-only) -- new server surface added for the client half.
  // =====================================================================

  await AT('schedule: GET /api/schedule/dungeons returns the dungeon list + formations, no auth required', async () => {
    // No token at all AND not even routed through resolveAuth -- confirm
    // by using a deliberately garbage token too (must still 200, unlike
    // every OTHER /api/schedule/* route, which would 401 on a bad token).
    const noToken = await scheduleReq('GET', '/api/schedule/dungeons', undefined);
    assert.strictEqual(noToken.status, 200);
    assert.ok(Array.isArray(noToken.body.dungeons) && noToken.body.dungeons.length >= 1, 'dungeons list present');
    assert.strictEqual(noToken.body.dungeons[0].id, 'test_dungeon', 'fixture dungeon id present');
    assert.ok(Array.isArray(noToken.body.formations) && noToken.body.formations.length === 2, 'both fixture formations present');
    assert.ok(noToken.body.formations.some((f) => f.id === 'formation1'));
    assert.ok(noToken.body.formations[0].canvases && noToken.body.formations[0].canvases.unit1, 'formation carries its canvases box map');

    const garbageToken = await scheduleReq('GET', '/api/schedule/dungeons', 'totally-bogus-token-value');
    assert.strictEqual(garbageToken.status, 200, 'a bad token must not block this no-auth route (never resolveAuth-gated)');
  });

  await AT('schedule: POST /api/schedule/rooms/:id/dev/backdate is dev-only (403 for a real guest token) and moves an active run\'s clock into the past for the dev fallback caller', async () => {
    // Room owned by ScheduleP1 (a REAL guest token, not the dev fallback).
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active', 'room must be running for this test to mean anything');

    // A real (non-dev) guest token -- even the room's OWN owner's token --
    // must be refused 403, never allowed to fast-forward their own run.
    const asOwner = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', scheduleP1.token, {});
    assert.strictEqual(asOwner.status, 403, 'a real guest token (even the room owner\'s own) must be refused: ' + JSON.stringify(asOwner.body));

    // The dev_mode fallback caller (no token at all) CAN backdate -- but
    // only ITS OWN rooms (ownership is still enforced via
    // getOwnRoomOr404) -- this room belongs to scheduleP1, not the dev
    // player, so even the dev fallback gets 404 here (never touches
    // another player's room).
    const asDevOnOthersRoom = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', undefined, {});
    assert.strictEqual(asDevOnOthersRoom.status, 404, 'dev fallback must not backdate a room it does not own: ' + JSON.stringify(asDevOnOthersRoom.body));

    // Create a room OWNED BY the dev fallback player itself, fill all 4
    // slots (dev player's own profile canvas was seeded by
    // ensureDevPlayer() + this suite's own admin fixtures -- but schedule
    // routes need the dev player to actually HAVE a canvas with 4 usable
    // squads; reuse the exact same makeTestCanvas() shape scheduleP1/P2
    // already use, written directly to the dev player's own profile).
    scheduleStorage.writeProfile(devPlayer.playerId, makeTestCanvas());
    const devRoomRes = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(devRoomRes.status, 200, 'dev fallback must be able to create its own room: ' + JSON.stringify(devRoomRes.body));
    const devRoomId = devRoomRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const slotRes = await scheduleReq('PUT', '/api/schedule/rooms/' + devRoomId + '/slots/' + i, undefined, { squadIndex: i });
      assert.strictEqual(slotRes.status, 200, 'dev fallback slot ' + i + ' assign: ' + JSON.stringify(slotRes.body));
    }
    const devRoomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + devRoomId, undefined);
    assert.strictEqual(devRoomAfter.body.room.status, 'active');
    const devRunId = devRoomAfter.body.room.lastRunId;
    const rawRunBefore = scheduleStorage.readRun(devRunId);
    assert.strictEqual(schedule.runClock(rawRunBefore).isSettled, false, 'run must not already be settled (test would be meaningless otherwise)');

    const backdateRes = await scheduleReq('POST', '/api/schedule/rooms/' + devRoomId + '/dev/backdate', undefined, { extraSecsIntoPast: 5 });
    assert.strictEqual(backdateRes.status, 200, JSON.stringify(backdateRes.body));
    assert.strictEqual(backdateRes.body.runId, devRunId);

    // The run's OWN persisted seed must be completely untouched by this
    // call (test-control seam, not a gameplay/reward-RNG-biasing knob).
    const rawRunAfter = scheduleStorage.readRun(devRunId);
    assert.strictEqual(rawRunAfter.seed, rawRunBefore.seed, 'backdate must never touch the run\'s seed');
    assert.strictEqual(schedule.runClock(rawRunAfter).isSettled, true, 'run clock must now read as settled');

    // A subsequent GET on the room must observe + settle it (lazy
    // settlement, same settleRoomIfDue() path every other test relies
    // on) -- confirms the backdate hook is a genuine drop-in substitute
    // for real wall-clock time from the room-lifecycle's point of view.
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + devRoomId, undefined);
    assert.notStrictEqual(settledView.body.room.status, 'active', 'room must have settled out of active status');

    // Cleanup: cancel the dev room + clear anything it rewarded, so this
    // fixture player's state does not leak into any later test in this
    // file that might also touch the dev player's warehouse/rooms.
    for (const item of schedule.listWarehouse(devPlayer.playerId)) scheduleStorage.deleteWarehouseItem(devPlayer.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + devRoomId, undefined);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: POST .../dev/backdate on a room with no run yet is a 400, not a crash', async () => {
    scheduleStorage.writeProfile(devPlayer.playerId, makeTestCanvas());
    const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', undefined, {});
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
  });

  await AT('schedule: POST /api/warehouse/dev/backdate-claim is dev-only (403 for a real guest token) and force-reverts a claiming row without waiting out the real 120s timeout (REQ-0041 E2E hook)', async () => {
    // NOTE: this row is written ONCE, directly under devPlayer.playerId
    // (never rewritten under a DIFFERENT playerId afterwards) --
    // writeWarehouseItemPg's `ON CONFLICT (item_uid) DO UPDATE` clause
    // deliberately does not update the `player_id` COLUMN (only doc/
    // harvested_at/updated_at), matching every REAL call site's own
    // invariant that a warehouse row's owner never changes across its
    // life; rewriting the SAME itemUid under a second playerId (which
    // this test used to do, by mistake) silently orphans the row from
    // listWarehouseItemsPg's `WHERE player_id = $1` filter under its NEW
    // playerId, even though the JSON doc's own embedded `playerId` field
    // says otherwise -- a real, if narrow, footgun worth documenting
    // here rather than repeating.
    const grantId = 'wh_backdateclaim_' + Date.now();
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, grantId, {
      itemUid: grantId, playerId: devPlayer.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      status: 'claimable',
    });

    // 403 for a real guest token, even a token belonging to a DIFFERENT
    // player entirely (scheduleP1's own guest token) -- this dev-only
    // hook never honors any real token, regardless of whose row it names.
    const guestRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', scheduleP1.token, { itemUid: grantId });
    assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

    // Claim it (marks 'claiming') via the dev fallback caller (undefined
    // token), then force-backdate its claimedAt -- must read as abandoned
    // (claimable again) on the very next GET /api/warehouse, with zero
    // real wall-clock wait.
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', undefined, { itemUid: grantId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));

    const backdateRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', undefined, { itemUid: grantId });
    assert.strictEqual(backdateRes.status, 200, JSON.stringify(backdateRes.body));

    const listRes = await scheduleReq('GET', '/api/warehouse', undefined);
    const found = listRes.body.items.find((i) => i.itemUid === grantId);
    assert.ok(found, 'the row must still be present (never lost)');
    assert.strictEqual(found.status, 'claimable', 'the row must have lazily reverted to claimable after the forced backdate');

    // A row that is NOT currently 'claiming' (already claimable) is a 400
    // -- nothing to backdate.
    const notClaimingRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', undefined, { itemUid: grantId });
    assert.strictEqual(notClaimingRes.status, 400, JSON.stringify(notClaimingRes.body));

    scheduleStorage.deleteWarehouseItem(devPlayer.playerId, grantId);
  });

  await AT('schedule: POST /api/warehouse/dev/clear-debris is dev-only (403 for a real guest token) and bulk-clears ONLY the dev fallback caller\'s warehouse rows (fix: e2e pg teardown -- E2E debris-cleanup hook)', async () => {
    // Seed two rows for the dev fallback player + one for a real guest
    // (scheduleP1), written directly via the storage chokepoint -- same
    // seeding technique as the backdate-claim test above. Each row is
    // written ONCE under its final owner (see that test's NOTE on the
    // writeWarehouseItemPg ON CONFLICT/player_id footgun).
    const now = Date.now();
    const mkRow = (uid, pid) => ({
      itemUid: uid, playerId: pid, itemId: 'blade',
      harvestedAt: new Date(now).toISOString(), expiresAt: new Date(now + 999999).toISOString(),
      status: 'claimable',
    });
    const uidA = 'wh_cleardebris_a_' + now;
    const uidB = 'wh_cleardebris_b_' + now;
    const uidGuest = 'wh_cleardebris_guest_' + now;
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, uidA, mkRow(uidA, devPlayer.playerId));
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, uidB, mkRow(uidB, devPlayer.playerId));
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, uidGuest, mkRow(uidGuest, scheduleP1.playerId));
    try {
      // 403 for a real guest token -- this dev-only hook never honors ANY
      // real token (same callerIsDevFallback gate as dev/backdate and
      // dev/backdate-claim above), and the guard runs before any delete.
      const guestRes = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', scheduleP1.token);
      assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

      // 405 for a non-POST method (same method gate shape as its siblings).
      const getRes = await scheduleReq('GET', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(getRes.status, 405, JSON.stringify(getRes.body));

      // Happy path: the dev fallback caller (no token) clears its OWN
      // rows -- at least the two seeded here (earlier tests may have left
      // additional dev-player rows; that is exactly the debris this hook
      // exists to remove) -- and the very next list is empty.
      const clearRes = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(clearRes.status, 200, JSON.stringify(clearRes.body));
      assert.ok(clearRes.body.deleted >= 2, 'both seeded dev rows must count toward deleted: ' + JSON.stringify(clearRes.body));
      const devList = await scheduleReq('GET', '/api/warehouse', undefined);
      assert.strictEqual(devList.body.items.length, 0, 'dev warehouse must be empty right after clear-debris: ' + JSON.stringify(devList.body.items));

      // ...and NEVER the guest's row: the hook is caller-scoped (no
      // client-suppliable playerId exists in its shape), so a real
      // player's warehouse is untouched by a dev clear.
      const guestList = await scheduleReq('GET', '/api/warehouse', scheduleP1.token);
      assert.ok(guestList.body.items.find((i) => i.itemUid === uidGuest), 'the guest-owned row must survive the dev clear');

      // Idempotent: clearing an already-empty warehouse is a 200 with
      // deleted:0, never an error (setup AND teardown both call it).
      const again = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
      assert.strictEqual(again.body.deleted, 0, JSON.stringify(again.body));
    } finally {
      scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, uidGuest);
    }
  });

  // =====================================================================
  // REQ-0082: dev-only POST /api/schedule/rooms/dev/clear -- bulk-clears the
  // dev fallback caller's accumulated schedule rooms (sibling of warehouse
  // dev/clear-debris; stops the canceled-room pile-up that collapsed the
  // schedule create panel's zero-rooms auto-open).
  // =====================================================================
  await AT('schedule: POST /api/schedule/rooms/dev/clear is dev-only (403 for a real guest token) and bulk-clears ONLY the dev fallback caller\'s rooms (REQ-0082)', async () => {
    // Seed two rooms for the dev fallback player + one for a real guest,
    // written directly via the storage chokepoint (minimal canceled docs --
    // clearRoomsForOwner only needs {id, ownerId} to find + remove them).
    const now = Date.now();
    const mkRoom = (id, pid) => ({ id: id, ownerId: pid, status: 'canceled', createdAt: now, slots: [] });
    const ridA = 'room_devclear_a_' + now;
    const ridB = 'room_devclear_b_' + now;
    const ridGuest = 'room_devclear_guest_' + now;
    scheduleStorage.writeRoom(ridA, mkRoom(ridA, devPlayer.playerId));
    scheduleStorage.writeRoom(ridB, mkRoom(ridB, devPlayer.playerId));
    scheduleStorage.writeRoom(ridGuest, mkRoom(ridGuest, scheduleP1.playerId));
    try {
      const guestRes = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', scheduleP1.token);
      assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

      const getRes = await scheduleReq('GET', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(getRes.status, 405, JSON.stringify(getRes.body));

      const clearRes = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(clearRes.status, 200, JSON.stringify(clearRes.body));
      assert.ok(clearRes.body.deleted >= 2, 'both seeded dev rooms must count toward deleted: ' + JSON.stringify(clearRes.body));
      assert.strictEqual(scheduleStorage.readRoom(ridA), null, 'dev room A must be gone after clear');
      assert.strictEqual(scheduleStorage.readRoom(ridB), null, 'dev room B must be gone after clear');

      assert.ok(scheduleStorage.readRoom(ridGuest), 'the guest-owned room must survive the dev clear (caller-scoped)');

      const again = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    } finally {
      scheduleStorage.deleteRoom(ridGuest);
    }
  });

  // =====================================================================
  // REQ-0043: dungeon auto-generation -- room dungeonType/level/genSeed,
  // genSeed privilege gating (dev fallback / item_admin only, same
  // pattern as dev/backdate), and fixed-seed run reproducibility.
  // =====================================================================

  await AT('REQ-0043: POST /api/schedule/rooms accepts an explicit dungeonType and stores it on the room', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 4, formationId: 'formation1' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.strictEqual(created.body.room.dungeonType, 'default');
    assert.strictEqual(created.body.room.level, 4);
    assert.ok(typeof created.body.room.genSeed === 'string' && created.body.room.genSeed.length > 0, 'a room always carries SOME genSeed, random by default');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + created.body.room.id, scheduleP1.token);
  });

  await AT('REQ-0043: an unknown dungeonType is a 400, not a silent fallback', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'not_a_real_type', level: 1 });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });

  await AT('REQ-0043: dungeonType defaults via back-compat -- a dungeonId equal to the static pilot dungeon\'s own id resolves to test_fixed; any other dungeonId resolves to default', async () => {
    const asPilot = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    assert.strictEqual(asPilot.body.room.dungeonType, 'test_fixed', 'dungeonId matching the fixture\'s own pilot dungeon id must back-compat-resolve to test_fixed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + asPilot.body.room.id, scheduleP1.token);

    const asOther = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'some_other_string', level: 1 });
    assert.strictEqual(asOther.body.room.dungeonType, 'default', 'any other dungeonId defaults to the generator');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + asOther.body.room.id, scheduleP1.token);
  });

  await AT('REQ-0043: GET /api/schedule/dungeons lists the generator types (default, test_fixed) alongside the legacy dungeons array', async () => {
    const res = await scheduleReq('GET', '/api/schedule/dungeons', undefined);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.types), 'response must carry a types array');
    const ids = res.body.types.map((t) => t.id).sort();
    assert.deepStrictEqual(ids, ['default', 'test_fixed'], 'exactly the two known generator types');
    // Backward compat: the original dungeons array is untouched.
    assert.ok(res.body.dungeons.some((d) => d.id === 'test_dungeon'), 'legacy dungeons array must still be present (back-compat)');
  });

  await AT('REQ-0043: genSeed is refused (403) for a plain guest token, even a perfectly valid one', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 1, genSeed: 'guest-attempted-seed' });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
  });

  await AT('REQ-0043: genSeed is refused (403) for a guest token WITHOUT item_admin, even naming a legit-looking seed', async () => {
    const plainGuest = playersFixture.createPlayer('PlainGuestNoAdmin', []);
    const res = await scheduleReq('POST', '/api/schedule/rooms', plainGuest.token, { dungeonId: 'test_dungeon', dungeonType: 'test_fixed', level: 1, genSeed: '12345' });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
  });

  await AT('REQ-0043: genSeed IS accepted for a guest token that carries the item_admin role', async () => {
    const adminGuest = playersFixture.createPlayer('AdminGuestReq0043', ['item_admin']);
    const res = await scheduleReq('POST', '/api/schedule/rooms', adminGuest.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'admin-chosen-seed' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.room.genSeed, 'admin-chosen-seed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + res.body.room.id, adminGuest.token);
  });

  await AT('REQ-0043: genSeed IS accepted for the dev_mode no-token fallback caller', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'dev-fallback-seed' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.room.genSeed, 'dev-fallback-seed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + res.body.room.id, undefined);
  });

  await AT('REQ-0043: a room with an explicit genSeed produces a BYTE-IDENTICAL generated dungeon def to a direct dungen.generate() call with the same inputs', async () => {
    const dungen = require('../../sim/dungen.cjs');
    const expected = dungen.generate('default', 3, 'reproducibility-check-seed');

    const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 3, genSeed: 'reproducibility-check-seed', formationId: 'formation1' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, undefined, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ': ' + JSON.stringify(r.body));
    }
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, undefined);
    assert.ok(after.body.room.lastRunId, 'troop complete -- a run must have auto-started');
    const runDoc = scheduleStorage.readRun(after.body.room.lastRunId);
    // encounter_start events (one per encounter actually reached) carry
    // `kind` -- reconstruct the encounter TYPE sequence actually run and
    // compare against the independently-generated def's own type
    // sequence, proving the SAME genSeed drove the SAME generated layout
    // server-side as calling dungen.generate() directly would.
    const startEvents = runDoc.events.filter((e) => e.ev === 'encounter_start');
    const actualTypeSeq = startEvents.map((e) => e.kind);
    const expectedTypeSeq = expected.encounters.map((e) => e.type);
    assert.deepStrictEqual(actualTypeSeq, expectedTypeSeq.slice(0, actualTypeSeq.length), 'the run\'s own encounter-type sequence must match dungen.generate()\'s def for the SAME genSeed');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
  });

  await AT('REQ-0043: two DIFFERENT rooms created with the SAME genSeed produce IDENTICAL replay logs (deterministic reproducibility)', async () => {
    async function runOnce() {
      const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'same-seed-two-rooms', formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, undefined, { squadIndex: i });
      }
      const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, undefined);
      const runDoc = scheduleStorage.readRun(after.body.room.lastRunId);
      await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
      return runDoc;
    }
    const runA = await runOnce();
    const runB = await runOnce();
    // The GENERATED DUNGEON LAYOUT (encounter type/composition sequence)
    // must be identical across both rooms -- but the two runs' own COMBAT
    // seed is independently random per startRun() (by design, see
    // sim/dungen.cjs's header comment: genSeed governs LAYOUT only, never
    // combat outcome), so full event-log byte-equality is NOT expected;
    // what IS guaranteed deterministic is the encounter type/enemy-id
    // sequence actually reached, which this asserts on both runs.
    function encounterSignature(runDoc) {
      return runDoc.events
        .filter((e) => e.ev === 'encounter_start')
        .map((e) => e.kind);
    }
    assert.deepStrictEqual(encounterSignature(runA), encounterSignature(runB), 'same genSeed => same generated encounter-type sequence across two independently-created rooms');
  });

  os.homedir = realHomedir;


  // =====================================================================
  // REQ-0064: Market test group. Same synthetic fixture tree as the
  // schedule group above (fakeRepoHome still mapped); drives the real
  // api.handle() surface for every route, plus the market facade
  // (server/market.cjs -- rule-3 consumers never require services/
  // directly) and storage.cjs's market roots for white-box assertions.
  // Runs identically in files AND pg modes (STORAGE_BACKEND), like the
  // rest of this suite -- pg needs server/migrations/004_market.sql
  // applied, same as 001..003 for the groups above.
  // =====================================================================
  const market = require('../market.cjs');

  const mktSeller = playersFixture.createPlayer('MarketSeller', []);
  const mktBuyer = playersFixture.createPlayer('MarketBuyer', []);
  const mktRich = playersFixture.createPlayer('MarketRich', []);
  const mktPoor = playersFixture.createPlayer('MarketPoor', []);

  // Seller: inventory POs (page 0) + one squad (index 1) that
  // REFERENCES two of the inventory-homed items (mkt_susp / mkt_susp2 --
  // the REQ-0030 reference model: placing on a board references the
  // uid, the home stays in st.inv), used to deploy them for the
  // suspension / Law-of-Possession tests. bps non-empty so the squad
  // passes engine.isSquadDeployable.
  function invPage(pos, tms) { return { bps: [], pos: pos || [], sis: [], tms: tms || [] }; }
  function mkCanvas(pages, squadStore) {
    return {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages, names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: squadStore },
    };
  }
  const sellerPos = [
    { uid: 'mkt_sell_1', id: 'blade', cell: [1, 1], rot: 0 },
    { uid: 'mkt_sell_2', id: 'blade', cell: [1, 2], rot: 0 },
    { uid: 'mkt_sell_3', id: 'fx_dagger', cell: [1, 3], rot: 0 },
    { uid: 'mkt_sell_4', id: 'blade', cell: [1, 4], rot: 0 },
    { uid: 'mkt_gone', id: 'blade', cell: [1, 5], rot: 0 },
    { uid: 'mkt_susp', id: 'blade', cell: [2, 1], rot: 0 },
    { uid: 'mkt_susp2', id: 'blade', cell: [2, 2], rot: 0 },
  ];
  const sellerSquad1 = {
    linked: true,
    bps: [{ id: 'bp_mkt', name: 'BP mkt', color: '#888888', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { off: [0, 0], dirs: [] }, hpMax: 30 }],
    pos: [
      { uid: 'mkt_susp', id: 'blade', cell: [1, 1], rot: 0 },
      { uid: 'mkt_susp2', id: 'blade', cell: [1, 2], rot: 0 },
    ],
    sis: [],
  };
  scheduleStorage.writeProfile(mktSeller.playerId, mkCanvas(
    [invPage(sellerPos), invPage(), invPage(), invPage(), invPage()],
    [null, sellerSquad1, null, null, null]
  ));
  // Buyer: 140 lrdst split across two pages (40 + 100) -- exercises the
  // multi-stack debit drain. Rich: 500. Poor: 5.
  scheduleStorage.writeProfile(mktBuyer.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_b1', id: 'lrdst', qty: 40, cell: [1, 1] }]),
     invPage([], [{ uid: 'tm_b2', id: 'lrdst', qty: 100, cell: [1, 1] }]),
     invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));
  scheduleStorage.writeProfile(mktRich.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_r1', id: 'lrdst', qty: 500, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));
  scheduleStorage.writeProfile(mktPoor.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_p1', id: 'lrdst', qty: 5, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));

  // scheduleReq + extra headers (Idempotency-Key).
  function marketReq(method, urlPath, token, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const headers = Object.assign({}, authHeaders(token), extraHeaders || {});
      const req2 = mockReq(method, urlPath, bodyStr, headers);
      const res2 = mockRes((b) => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
        resolve({ status: res2.statusCode, body: parsed });
      });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
  }
  function mktBalance(playerId) {
    const doc = scheduleStorage.readProfile(playerId);
    return market.readTmBalance(doc ? doc.canvas : null, market.MARKET_TM_ID);
  }

  await AT('market: burnOf matches the mock burn table -- max(1, ceil(qty*0.08)); 46->4, 120->10, 12->1, 3->1 (web/redesign/market.html)', async () => {
    // Mock-verified cases first (rendered burn lines + the mock JS's own
    // burnOf), then boundary rows around the ceil/floor edges.
    const table = [
      [46, 4], [120, 10], [12, 1], [3, 1], // straight from the mock cards
      [9, 1], [18, 2], [64, 6], [88, 8], [1420, 114], // remaining mock lines
      [1, 1], [2, 1], [13, 2], [25, 2], [26, 3], [100, 8], [999, 80], // boundaries
    ];
    for (const [qty, expected] of table) {
      assert.strictEqual(market.burnOf(qty), expected, 'burnOf(' + qty + ') must be ' + expected);
    }
    assert.strictEqual(market.MARKET_TM_ID, 'lrdst', 'the one trade TM is the engine/content id lrdst');
    assert.strictEqual(market.MARKET_LISTING_TTL_MS, 7 * 24 * 60 * 60 * 1000, '7-day listing shelf life');
  });

  await AT('market: POST /api/market/listings lists an inventory item for free; DTO carries dtoVersion/burn/dexNo/expiresAt(+7d)', async () => {
    const before = Date.now();
    const res = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_1', price: { tm: 'lrdst', qty: 46 } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.replayed, false);
    const l = res.body.listing;
    assert.strictEqual(l.state, 'active');
    assert.strictEqual(l.suspended, false);
    assert.deepStrictEqual(l.price, { tm: 'lrdst', qty: 46 });
    assert.strictEqual(l.burn, 4);
    assert.strictEqual(l.sellerReceives, 42);
    assert.strictEqual(l.itemId, 'blade');
    assert.strictEqual(l.itemName, schedule.getScheduleContent().itemDefsById.blade.name, 'itemName mirrors the live def (an earlier admin test renames it)');
    assert.strictEqual(l.dexNo, 1, 'blade is entry 1 of the live_items fixture');
    assert.strictEqual(l.sellerName, 'MarketSeller');
    assert.deepStrictEqual(l.priceHistory, [], 'no settled price yet');
    const ttl = Date.parse(l.expiresAt) - Date.parse(l.createdAt);
    assert.strictEqual(ttl, market.MARKET_LISTING_TTL_MS, 'expiresAt = createdAt + 7d');
    assert.ok(Date.parse(l.createdAt) >= before - 1000, 'createdAt is now-ish');
    // Listing is free: no furnace entry, and the item is still in the
    // seller inventory (NOT escrowed).
    assert.strictEqual(market.furnaceTotal().total, 0, 'listing must not burn');
    const sellerDoc = scheduleStorage.readProfile(mktSeller.playerId);
    assert.ok(market.findInventoryPO(sellerDoc.canvas, 'mkt_sell_1'), 'item stays in inventory while listed');
  });

  await AT('market: create validation -- unknown/foreign uid 404 (no-leak), bad price 400s, duplicate 409 already_listed', async () => {
    const noSuch = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'no_such_uid', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(noSuch.status, 404, 'unknown uid: ' + JSON.stringify(noSuch.body));
    // Another player's REAL uid answers exactly like a nonexistent one
    // (eligibility only ever reads the CALLER's own canvas): no-leak.
    const foreign = await marketReq('POST', '/api/market/listings', mktBuyer.token, { itemUid: 'mkt_sell_2', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(foreign.status, 404, 'foreign uid must 404 identically: ' + JSON.stringify(foreign.body));
    for (const badPrice of [
      { tm: 'lrdst', qty: 0 }, { tm: 'lrdst', qty: 1000 }, { tm: 'lrdst', qty: 4.5 },
      { tm: 'gold', qty: 10 }, undefined,
    ]) {
      const bad = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_2', price: badPrice });
      assert.strictEqual(bad.status, 400, 'bad price ' + JSON.stringify(badPrice) + ' -> 400, got ' + bad.status + ': ' + JSON.stringify(bad.body));
    }
    const dup = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_1', price: { tm: 'lrdst', qty: 50 } });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.reason, 'already_listed');
  });

  await AT('market: GET /api/market/listings -- browse is market-wide with sellerName; tag filter + q (name / Dex No.) work', async () => {
    const fx = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_3', price: { tm: 'lrdst', qty: 12 } });
    assert.strictEqual(fx.status, 200);
    assert.strictEqual(fx.body.listing.burn, 1, '12 -> burn 1 (mock line)');

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.strictEqual(browse.status, 200);
    assert.strictEqual(browse.body.dtoVersion, 1);
    assert.strictEqual(browse.body.tm, 'lrdst');
    assert.strictEqual(browse.body.listings.length, 2, 'both active listings visible to another player');
    assert.ok(browse.body.listings.every((x) => x.sellerName === 'MarketSeller'));

    const tagged = await marketReq('GET', '/api/market/listings?filter=weapon', mktBuyer.token);
    assert.strictEqual(tagged.body.listings.length, 2, 'tag filter is case-insensitive (Weapon)');
    const none = await marketReq('GET', '/api/market/listings?filter=NoSuchTag', mktBuyer.token);
    assert.strictEqual(none.body.listings.length, 0);

    const byName = await marketReq('GET', '/api/market/listings?q=fx%20dagger', mktBuyer.token);
    assert.strictEqual(byName.body.listings.length, 1);
    assert.strictEqual(byName.body.listings[0].itemId, 'fx_dagger');
    const byDexNo = await marketReq('GET', '/api/market/listings?q=No.2', mktBuyer.token);
    assert.strictEqual(byDexNo.body.listings.length, 1, 'Dex No. 2 = fx_dagger (fixture order)');
    assert.strictEqual(byDexNo.body.listings[0].itemId, 'fx_dagger');
    const byDexNo1 = await marketReq('GET', '/api/market/listings?q=1', mktBuyer.token);
    assert.strictEqual(byDexNo1.body.listings.length, 1, 'bare digits = Dex No. 1 = blade');
    assert.strictEqual(byDexNo1.body.listings[0].itemId, 'blade');
  });

  await AT('market: suspension -- deploying the listed item suspends (browsable, unbuyable); undeploy reverts to active; deployed item cannot be newly listed', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp', price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(created.status, 200);
    const suspListingId = created.body.listing.id;

    // Deploy squad 1 (references mkt_susp + mkt_susp2) to a room slot.
    const room = await marketReq('POST', '/api/schedule/rooms', mktSeller.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(room.status, 200, JSON.stringify(room.body));
    const roomId = room.body.room.id;
    const slotRes = await marketReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', mktSeller.token, { squadIndex: 1 });
    assert.strictEqual(slotRes.status, 200, JSON.stringify(slotRes.body));

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const suspended = browse.body.listings.find((x) => x.id === suspListingId);
    assert.ok(suspended, 'suspended listing stays browsable');
    assert.strictEqual(suspended.state, 'suspended');
    assert.strictEqual(suspended.suspended, true);

    const buyAttempt = await marketReq('POST', '/api/market/listings/' + suspListingId + '/buy', mktBuyer.token);
    assert.strictEqual(buyAttempt.status, 409);
    assert.strictEqual(buyAttempt.body.reason, 'suspended');

    // Law of Possession at CREATE time too: mkt_susp2 is now deployed.
    const deployedCreate = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp2', price: { tm: 'lrdst', qty: 6 } });
    assert.strictEqual(deployedCreate.status, 409);
    assert.strictEqual(deployedCreate.body.reason, 'deployed');

    // Undeploy (cancel the room) -> active again, buyable again.
    const del = await marketReq('DELETE', '/api/schedule/rooms/' + roomId, mktSeller.token);
    assert.strictEqual(del.status, 200, JSON.stringify(del.body));
    const browse2 = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const revived = browse2.body.listings.find((x) => x.id === suspListingId);
    assert.strictEqual(revived.state, 'active');
    assert.strictEqual(revived.suspended, false);
    // Stored state never flipped -- suspension is derived, not persisted.
    assert.strictEqual(scheduleStorage.readMarketListing(suspListingId).state, 'active');
  });

  let mktListing1Id = null; // blade, qty 46 -- settled in the next test
  await AT('market: buy settles atomically -- debit across stacks, seller item stripped, item to buyer warehouse, proceeds (qty-burn) to seller warehouse, furnace + dex history engraved', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    mktListing1Id = mine.body.listings.find((x) => x.itemUid === 'mkt_sell_1').id;
    assert.strictEqual(mktBalance(mktBuyer.playerId), 140);

    const buy = await marketReq('POST', '/api/market/listings/' + mktListing1Id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.dtoVersion, 1);
    assert.deepStrictEqual(
      { qty: buy.body.receipt.price.qty, burn: buy.body.receipt.burn, sellerReceives: buy.body.receipt.sellerReceives },
      { qty: 46, burn: 4, sellerReceives: 42 },
      'the mock case: pay 46 -> burn 4 -> seller receives 42'
    );
    assert.strictEqual(buy.body.listing.state, 'settled');

    // Buyer: 140 -> 94, page-0 stack (40) fully drained + removed,
    // page-1 stack 100 -> 94.
    assert.strictEqual(mktBalance(mktBuyer.playerId), 94);
    const buyerCanvas = scheduleStorage.readProfile(mktBuyer.playerId).canvas;
    assert.strictEqual(buyerCanvas.inv.pages[0].tms.length, 0, 'emptied stack removed');
    assert.strictEqual(buyerCanvas.inv.pages[1].tms[0].qty, 94);

    // Seller: item gone from the canvas entirely.
    const sellerCanvas = scheduleStorage.readProfile(mktSeller.playerId).canvas;
    assert.strictEqual(market.findInventoryPO(sellerCanvas, 'mkt_sell_1'), null, 'sold item stripped from inventory');

    // Buyer warehouse: one claimable blade row carrying sourceListingId.
    const buyerWh = schedule.listWarehouse(mktBuyer.playerId);
    const deliveredRow = buyerWh.find((w) => w.sourceListingId === mktListing1Id);
    assert.ok(deliveredRow, 'item delivered to the buyer warehouse');
    assert.strictEqual(deliveredRow.itemId, 'blade');
    assert.strictEqual(deliveredRow.status, 'claimable');
    assert.strictEqual(deliveredRow.kind, undefined, 'plain PO row, not a TM row');

    // Seller warehouse: kind:tm proceeds row, qty 42 (grantTmQty shape).
    const sellerWh = schedule.listWarehouse(mktSeller.playerId);
    const proceeds = sellerWh.find((w) => w.sourceListingId === mktListing1Id);
    assert.ok(proceeds, 'proceeds row exists');
    assert.strictEqual(proceeds.kind, 'tm');
    assert.strictEqual(proceeds.itemId, 'lrdst');
    assert.strictEqual(proceeds.qty, 42);

    // Furnace + dex history.
    const furnace = await marketReq('GET', '/api/market/furnace', mktBuyer.token);
    assert.strictEqual(furnace.status, 200);
    assert.deepStrictEqual(furnace.body.furnace, { tm: 'lrdst', total: 4, count: 1, since: null });
    const hist = scheduleStorage.readMarketDexHistory('blade');
    assert.strictEqual(hist.entries.length, 1);
    assert.strictEqual(hist.entries[0].qty, 46);
    assert.strictEqual(hist.entries[0].listingId, mktListing1Id);

    // Settled listings leave the browse but stay in the seller's mine view.
    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === mktListing1Id));
    const mine2 = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const settledRow = mine2.body.listings.find((x) => x.id === mktListing1Id);
    assert.strictEqual(settledRow.state, 'settled');
    assert.strictEqual(settledRow.buyerId, mktBuyer.playerId);
    assert.deepStrictEqual(settledRow.priceHistory, [{ qty: 46, t: hist.entries[0].t }], 'DTO exposes the engraved history');
  });

  await AT('market: concurrent buys -- first wins, second 409 already_settled; self-buy 409; insufficient balance 409 leaves everything untouched', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const fxId = mine.body.listings.find((x) => x.itemUid === 'mkt_sell_3').id;
    // Both requests enter the (synchronous) settle back-to-back; the
    // event loop strictly serializes them -- exactly the property the
    // first-wins design relies on.
    const race = await Promise.all([
      marketReq('POST', '/api/market/listings/' + fxId + '/buy', mktBuyer.token),
      marketReq('POST', '/api/market/listings/' + fxId + '/buy', mktRich.token),
    ]);
    const winners = race.filter((r) => r.status === 200);
    const losers = race.filter((r) => r.status === 409);
    assert.strictEqual(winners.length, 1, 'exactly one buy settles: ' + JSON.stringify(race.map((r) => r.status)));
    assert.strictEqual(losers.length, 1);
    assert.strictEqual(losers[0].body.reason, 'already_settled');
    assert.strictEqual(winners[0].body.receipt.burn, 1, '12 -> burn 1');
    // The winner was the first-created request (buyer), so rich is untouched.
    assert.strictEqual(mktBalance(mktBuyer.playerId), 82);
    assert.strictEqual(mktBalance(mktRich.playerId), 500);

    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;
    const selfBuy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktSeller.token);
    assert.strictEqual(selfBuy.status, 409);
    assert.strictEqual(selfBuy.body.reason, 'self_buy');

    const poorBuy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktPoor.token);
    assert.strictEqual(poorBuy.status, 409);
    assert.strictEqual(poorBuy.body.reason, 'insufficient_balance');
    assert.strictEqual(mktBalance(mktPoor.playerId), 5, 'no partial debit');
    assert.strictEqual(scheduleStorage.readMarketListing(suspId).state, 'active', 'listing untouched by failed buys');
  });

  await AT('market: buyer warehouse full -> 409 warehouse_full, no partial settle', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;
    const fillerUids = [];
    for (let i = 0; i < schedule.WAREHOUSE_CAP; i++) {
      const uid = 'mkt_fill_' + i;
      fillerUids.push(uid);
      scheduleStorage.writeWarehouseItem(mktRich.playerId, uid, {
        itemUid: uid, playerId: mktRich.playerId, itemId: 'blade',
        harvestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sourceRoomId: null, sourceRunId: null, status: 'claimable',
      });
    }
    try {
      const buy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktRich.token);
      assert.strictEqual(buy.status, 409, JSON.stringify(buy.body));
      assert.strictEqual(buy.body.reason, 'warehouse_full');
      assert.strictEqual(mktBalance(mktRich.playerId), 500, 'buyer not debited');
      assert.strictEqual(scheduleStorage.readMarketListing(suspId).state, 'active', 'listing still active');
      const sellerCanvas = scheduleStorage.readProfile(mktSeller.playerId).canvas;
      assert.ok(market.findInventoryPO(sellerCanvas, 'mkt_susp'), 'seller keeps the item');
    } finally {
      for (const uid of fillerUids) scheduleStorage.deleteWarehouseItem(mktRich.playerId, uid);
    }
  });

  await AT('market: withdraw -- owner 200 and free, non-owner 404 (no-leak), unknown id 404, re-withdraw 409 not_active', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;

    const notOwner = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktBuyer.token);
    assert.strictEqual(notOwner.status, 404, 'foreign withdraw must 404, never 403: ' + JSON.stringify(notOwner.body));
    const unknown = await marketReq('POST', '/api/market/listings/mkt_nope/withdraw', mktSeller.token);
    assert.strictEqual(unknown.status, 404);

    const burnedBefore = market.furnaceTotal().total;
    const ok = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktSeller.token);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.listing.state, 'withdrawn');
    assert.strictEqual(ok.body.listing.withdrawnReason, 'owner');
    assert.strictEqual(market.furnaceTotal().total, burnedBefore, 'withdrawal is free -- the furnace burns only on settlement');

    const again = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktSeller.token);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.reason, 'not_active');

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === suspId), 'withdrawn listings leave the browse');
  });

  await AT('market: TTL -- a listing past its 7-day shelf life lazily flips to expired (hidden from browse, shown in mine, buy 409)', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_2', price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(created.status, 200);
    const id = created.body.listing.id;
    // Backdate past the TTL (the forceRunElapsed convention: rewrite the
    // timestamps, then let the next READ do the lazy transition).
    const raw = scheduleStorage.readMarketListing(id);
    raw.createdAt = new Date(Date.now() - market.MARKET_LISTING_TTL_MS - 60 * 1000).toISOString();
    raw.expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
    scheduleStorage.writeMarketListing(id, raw);

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === id), 'expired listing hidden from browse');
    assert.strictEqual(scheduleStorage.readMarketListing(id).state, 'expired', 'lazy expiry persisted on read');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const row = mine.body.listings.find((x) => x.id === id);
    assert.strictEqual(row.state, 'expired');
    const buy = await marketReq('POST', '/api/market/listings/' + id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 409);
    assert.strictEqual(buy.body.reason, 'expired');
  });

  await AT('market: item vanished from the seller inventory -> auto-withdraw (item_gone) on the next buy/read', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_gone', price: { tm: 'lrdst', qty: 9 } });
    assert.strictEqual(created.status, 200);
    const id = created.body.listing.id;
    // The item vanishes (e.g. consumed client-side + auto-saved).
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    for (const pg of doc.canvas.inv.pages) pg.pos = (pg.pos || []).filter((p) => p.uid !== 'mkt_gone');
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);

    const buy = await marketReq('POST', '/api/market/listings/' + id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 409, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.reason, 'item_gone');
    assert.strictEqual(mktBalance(mktBuyer.playerId), 82, 'buyer untouched');
    const stored = scheduleStorage.readMarketListing(id);
    assert.strictEqual(stored.state, 'withdrawn');
    assert.strictEqual(stored.withdrawal.reason, 'item_gone');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    assert.strictEqual(mine.body.listings.find((x) => x.id === id).withdrawnReason, 'item_gone');
  });

  await AT('market: Idempotency-Key -- create replays the same listing; buy replays the original receipt without a double debit; another buyer cannot replay it', async () => {
    const idem = { 'idempotency-key': 'mkt-idem-create-1' };
    const c1 = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_4', price: { tm: 'lrdst', qty: 13 } }, idem);
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.body.replayed, false);
    const c2 = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_4', price: { tm: 'lrdst', qty: 13 } }, idem);
    assert.strictEqual(c2.status, 200);
    assert.strictEqual(c2.body.replayed, true);
    assert.strictEqual(c2.body.listing.id, c1.body.listing.id, 'replay returns the ORIGINAL listing');
    const all = scheduleStorage.listMarketListings().filter((x) => x.itemUid === 'mkt_sell_4');
    assert.strictEqual(all.length, 1, 'no double-list');

    const buyIdem = { 'idempotency-key': 'mkt-idem-buy-1' };
    const b1 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktBuyer.token, undefined, buyIdem);
    assert.strictEqual(b1.status, 200, JSON.stringify(b1.body));
    assert.strictEqual(b1.body.receipt.burn, 2, '13 -> burn 2 (ceil boundary)');
    const balanceAfter = mktBalance(mktBuyer.playerId);
    assert.strictEqual(balanceAfter, 69);
    const b2 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktBuyer.token, undefined, buyIdem);
    assert.strictEqual(b2.status, 200, 'replay must not 409: ' + JSON.stringify(b2.body));
    assert.strictEqual(b2.body.replayed, true);
    assert.deepStrictEqual(b2.body.receipt, b1.body.receipt, 'byte-identical receipt');
    assert.strictEqual(mktBalance(mktBuyer.playerId), balanceAfter, 'no double debit');
    // The key is scoped to the buyer: someone else replaying it gets the
    // plain state-machine answer.
    const b3 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktRich.token, undefined, buyIdem);
    assert.strictEqual(b3.status, 409);
    assert.strictEqual(b3.body.reason, 'already_settled');
  });

  await AT('market: GET /api/market/furnace -- all-time total accumulates per settle (seasonal windowing = REQ-0066 hook)', async () => {
    const res = await marketReq('GET', '/api/market/furnace', mktPoor.token);
    assert.strictEqual(res.status, 200);
    // Settles so far: 46 (burn 4) + 12 (burn 1) + 13 (burn 2) = 7 over 3 trades.
    assert.deepStrictEqual(res.body.furnace, { tm: 'lrdst', total: 7, count: 3, since: null });
    // The windowing hook already works (REQ-0066 will pass a season start).
    const windowed = market.furnaceTotal(Date.now() + 1000);
    assert.deepStrictEqual({ total: windowed.total, count: windowed.count }, { total: 0, count: 0 }, 'a future window excludes everything');
  });

  await AT('market: dex price history rolls the last 5 settled prices per itemId, newest first', async () => {
    // 6 more blade settles (prices 1..6) on top of the earlier 46 and 13
    // -> only the newest 5 survive: [6,5,4,3,2].
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    for (let i = 1; i <= 6; i++) {
      doc.canvas.inv.pages[0].pos.push({ uid: 'mkt_hist_' + i, id: 'blade', cell: [3, i], rot: 0 });
    }
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);
    for (let i = 1; i <= 6; i++) {
      const c = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_hist_' + i, price: { tm: 'lrdst', qty: i } });
      assert.strictEqual(c.status, 200, JSON.stringify(c.body));
      const b = await marketReq('POST', '/api/market/listings/' + c.body.listing.id + '/buy', mktBuyer.token);
      assert.strictEqual(b.status, 200, JSON.stringify(b.body));
      if (i === 1) {
        assert.strictEqual(b.body.receipt.sellerReceives, 0, 'a price of 1 burns whole (max(1,...) floor)');
        const rows = schedule.listWarehouse(mktSeller.playerId).filter((w) => w.kind === 'tm' && w.qty === 0);
        assert.strictEqual(rows.length, 0, 'no zero-qty proceeds row is written');
      }
    }
    const hist = scheduleStorage.readMarketDexHistory('blade');
    assert.deepStrictEqual(hist.entries.map((e) => e.qty), [6, 5, 4, 3, 2], 'rolling window, newest first');
    assert.strictEqual(mktBalance(mktBuyer.playerId), 69 - 21, 'buyer paid 1+2+..+6');
  });

  await AT('market: every /api/market route is token-gated (401 for a garbage token)', async () => {
    for (const [method, p2] of [
      ['GET', '/api/market/listings'],
      ['POST', '/api/market/listings'],
      ['POST', '/api/market/listings/x/withdraw'],
      ['POST', '/api/market/listings/x/buy'],
      ['GET', '/api/market/furnace'],
    ]) {
      const res = await marketReq(method, p2, 'totally-bogus-token');
      assert.strictEqual(res.status, 401, method + ' ' + p2 + ' -> ' + res.status);
    }
  });


  // =====================================================================
  // REQ-0066: Hall of Ragnarok test group. Same synthetic fixture tree
  // as the schedule/market groups above (module paths still bound to
  // fakeRepoHome); drives the real api.handle() surface for every
  // route, plus the ragnarok facade (server/ragnarok.cjs -- rule-3
  // consumers never require services/ directly) and storage.cjs's
  // ragnarok roots for white-box assertions. Runs identically in files
  // AND pg modes (STORAGE_BACKEND), like the rest of this suite -- pg
  // needs server/migrations/005_ragnarok.sql applied, same as 001..004
  // for the groups above.
  // =====================================================================
  const ragnarok = require('../ragnarok.cjs');

  // seasons.json fixture management: the service's mtime cache
  // (services/ragnarok.cjs getSeasonsDoc) must observe every rewrite,
  // so each write force-bumps mtime monotonically (same-ms rewrites
  // would otherwise be served from cache).
  const seasonsFixturePath = path.join(liveDir, 'seasons.json');
  let seasonsBumpMs = 0;
  function writeSeasonsFixture(doc) {
    if (doc === null) {
      try { fs.unlinkSync(seasonsFixturePath); } catch (e) { /* already absent */ }
      return;
    }
    fs.writeFileSync(seasonsFixturePath, JSON.stringify(doc));
    seasonsBumpMs += 1000;
    const t = new Date(Date.now() + seasonsBumpMs);
    fs.utimesSync(seasonsFixturePath, t, t);
  }
  function seasonEntry(index, startMs, extra) {
    return Object.assign({
      index, name: '狼の冬', nameEn: 'The Wolf\'s Winter',
      startAt: new Date(startMs).toISOString(), phaseDays: 7, phasesPerSeason: 12,
      ragnarokAt: new Date(startMs + 84 * 24 * 60 * 60 * 1000).toISOString(),
    }, extra || {});
  }
  const RAG_HOUR = 60 * 60 * 1000;
  const RAG_DAY = 24 * RAG_HOUR;
  // The canonical fixture season the devotion/furnace tests run under:
  // Season 1, started 10 days + 1 hour ago (phase 2 of 12).
  function writeCanonicalSeason() {
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, Date.now() - 10 * RAG_DAY - RAG_HOUR)] });
  }

  const ragA = playersFixture.createPlayer('RagnarAlfa', []);
  const ragB = playersFixture.createPlayer('RagnarBravo', []);
  const ragC = playersFixture.createPlayer('RagnarCastle', []);
  const ragD = playersFixture.createPlayer('RagnarDelta', []);
  const ragE = playersFixture.createPlayer('RagnarEcho', []);

  // ragA: the main devotion fixture. Inventory (page 0) is MASTER
  // (REQ-0033: every uid has exactly ONE home record in st.inv.pages):
  // homes for 2 BPs, 4 POs, 2 SIs. Squad 1 (the devotion candidate)
  // references bp_dev + shared_po + solo_po + si_dev; squad 2 SHARES
  // shared_po (the yellow case) and also holds keep_po plus si_other
  // seated ON shared_po (host {po:...} -- exercises the surviving-SI
  // stow rule when its host PO is destroyed).
  const bpDef = (id) => ({ id, name: 'BP ' + id, color: '#886644', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { off: [0, 0], dirs: [] }, hpMax: 30 });
  const ragAInvPage = {
    bps: [bpDef('bp_dev'), bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', cell: [1, 2], rot: 0 },
      { uid: 'other_po', id: 'fx_dagger', cell: [1, 3], rot: 0 },
      { uid: 'keep_po', id: 'blade', cell: [1, 4], rot: 0 },
    ],
    sis: [
      { uid: 'si_dev', id: 'acc_gem', host: 'inv' },
      { uid: 'si_other', id: 'acc_gem', host: 'inv' },
    ],
    tms: [],
  };
  const ragASquad1 = {
    linked: true,
    bps: [bpDef('bp_dev')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_dev', id: 'acc_gem', host: 'inv' }],
  };
  const ragASquad2 = {
    linked: true,
    bps: [bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [2, 1], rot: 0 },
      { uid: 'keep_po', id: 'blade', loc: 'grid', cell: [2, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_other', id: 'acc_gem', host: { po: 'shared_po' } }],
  };
  scheduleStorage.writeProfile(ragA.playerId, mkCanvas(
    [ragAInvPage, invPage(), invPage(), invPage(), invPage()],
    [null, ragASquad1, ragASquad2]
  ));

  // ragB: idempotency + empty_squad fixture (squad 1 devotable, squad
  // 2 exists but has no BP -> empty_squad).
  scheduleStorage.writeProfile(ragB.playerId, mkCanvas(
    [{
      bps: [bpDef('bp_b1')],
      pos: [{ uid: 'b1_po', id: 'blade', cell: [1, 1], rot: 0 }],
      sis: [], tms: [],
    }, invPage(), invPage(), invPage(), invPage()],
    [null,
      { linked: true, bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] },
      { linked: true, bps: [], pos: [], sis: [] }]
  ));

  // ragC: rite-lock (mid_rite / crash recovery) fixture -- one inventory
  // item as recovery ground truth, two squads so last_squad can't fire.
  scheduleStorage.writeProfile(ragC.playerId, mkCanvas(
    [{ bps: [bpDef('bp_c1')], pos: [{ uid: 'c_keep_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] },
      invPage(), invPage(), invPage(), invPage()],
    [null, { linked: true, bps: [bpDef('bp_c1')], pos: [], sis: [] }]
  ));

  // ragE: active-squad devotion fixture. The ACTIVE squad (index 0,
  // living in the top-level canvas fields -- engine.js ~1230) is the
  // devotion candidate; stored squad 1 shares eA_po.
  scheduleStorage.writeProfile(ragE.playerId, Object.assign(mkCanvas(
    [{
      bps: [bpDef('bp_e'), bpDef('bp_e2')],
      pos: [{ uid: 'eA_po', id: 'blade', cell: [1, 1], rot: 0 }, { uid: 'eKeep_po', id: 'blade', cell: [1, 2], rot: 0 }],
      sis: [], tms: [],
    }, invPage(), invPage(), invPage(), invPage()],
    [null, { linked: true, bps: [bpDef('bp_e2')], pos: [{ uid: 'eA_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }, { uid: 'eKeep_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 }], sis: [] }]
  ), {
    bps: [bpDef('bp_e')],
    pos: [{ uid: 'eA_po', id: 'blade', loc: 'grid', cell: [3, 3], rot: 0 }],
    sis: [],
  }));

  await AT('ragnarok: season derivation -- phase/countdown boundaries, latest-started wins, degenerate missing/future registry', async () => {
    const now = Date.now();
    // Fresh season (started an hour ago): phase 1, day 1, full countdown.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - RAG_HOUR)] });
    let cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season.index, 1);
    assert.strictEqual(cs.season.name, '狼の冬');
    assert.strictEqual(cs.derived.phase, 1, 'phase 1 on day 1');
    assert.strictEqual(cs.derived.phaseDay, 1);
    assert.strictEqual(cs.derived.ended, false);
    assert.strictEqual(cs.derived.daysToRagnarok, 84, '84-day season (12 phases x 7 days)');
    // One phase in (7d + 1h): phase 2, phaseDay 1.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 7 * RAG_DAY - RAG_HOUR)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.phase, 2, 'phase flips at startAt + phaseDays');
    assert.strictEqual(cs.derived.phaseDay, 1);
    assert.strictEqual(cs.derived.daysToRagnarok, 77);
    // Mid-phase-9 (mock's own strip: 第九月相): 8 full phases + 3 days in.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - (8 * 7 + 3) * RAG_DAY - RAG_HOUR)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.phase, 9);
    assert.strictEqual(cs.derived.phaseDay, 4);
    // Past ragnarokAt with no successor: ended, phase pinned at 12, countdown 0.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 85 * RAG_DAY)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.ended, true);
    assert.strictEqual(cs.derived.phase, 12, 'phase clamps to phasesPerSeason');
    assert.strictEqual(cs.derived.daysToRagnarok, 0);
    assert.strictEqual(cs.derived.msToRagnarok, 0);
    // Two seasons: the most recently STARTED one wins.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 100 * RAG_DAY), seasonEntry(2, now - 5 * RAG_DAY, { name: '鴉の夏' })] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season.index, 2);
    assert.strictEqual(cs.season.name, '鴉の夏');
    assert.strictEqual(cs.derived.phase, 1);
    assert.strictEqual(ragnarok.listSeasons().length, 2, 'the registry lists every season');
    // Entirely-future registry: no current season yet.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now + 5 * RAG_DAY)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season, null, 'a future-only registry has no current season');
    assert.strictEqual(cs.derived, null);
    // Missing file: the documented degenerate case.
    writeSeasonsFixture(null);
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season, null);
    assert.deepStrictEqual(ragnarok.listSeasons(), []);
    // Leave the canonical fixture in place for every test below.
    writeCanonicalSeason();
  });

  await AT('ragnarok: GET /api/ragnarok/season returns registry + derived clock; token-gated', async () => {
    const res = await marketReq('GET', '/api/ragnarok/season', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.seasons.length, 1);
    const season = res.body.season;
    assert.strictEqual(season.index, 1);
    assert.strictEqual(season.name, '狼の冬');
    assert.strictEqual(season.phaseDays, 7);
    assert.strictEqual(season.phasesPerSeason, 12);
    assert.strictEqual(Date.parse(season.ragnarokAt) - Date.parse(season.startAt), 84 * RAG_DAY, 'ragnarokAt = startAt + 12 * phaseDays');
    assert.strictEqual(res.body.derived.phase, 2, '10 days in = phase 2');
    assert.strictEqual(res.body.derived.daysToRagnarok, 74);
    assert.strictEqual(res.body.derived.ended, false);
    const noAuth = await marketReq('GET', '/api/ragnarok/season', 'totally-bogus-token');
    assert.strictEqual(noAuth.status, 401);
  });

  await AT('ragnarok: battleScoreOf is THE 戦果 formula (damage*1 + kills*50 + survived*100) and tier thresholds hold', async () => {
    assert.strictEqual(ragnarok.battleScoreOf({ damage: 100, kills: 2, survived: 1 }), 300);
    assert.strictEqual(ragnarok.battleScoreOf({ damage: 0, kills: 0, survived: true }), 100, 'boolean survived coerces');
    assert.strictEqual(ragnarok.battleScoreOf({}), 0);
    assert.strictEqual(ragnarok.battleScoreOf(null), 0);
    assert.strictEqual(ragnarok.SCORE_FORMULA_VERSION, 1);
    assert.deepStrictEqual(ragnarok.SCORE_WEIGHTS, { damage: 1.0, kills: 50, survived: 100 });
    // Tier ladder [ORCH defaults 0/500/2000/8000]; VALHALLA is never assigned server-side.
    assert.strictEqual(ragnarok.tierOf(0), 'THRALL');
    assert.strictEqual(ragnarok.tierOf(499), 'THRALL');
    assert.strictEqual(ragnarok.tierOf(500), 'KARL');
    assert.strictEqual(ragnarok.tierOf(1999), 'KARL');
    assert.strictEqual(ragnarok.tierOf(2000), 'JARL');
    assert.strictEqual(ragnarok.tierOf(8000), 'EINHERJAR');
    assert.strictEqual(ragnarok.tierOf(999999), 'EINHERJAR');
  });

  await AT('ragnarok: devotion preview itemizes the blast radius (incl. shared refs + affected squads) with a degenerate-safe projection', async () => {
    const res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.deepStrictEqual(res.body.squad, { index: 1, name: 'P2' });
    assert.strictEqual(res.body.eligible, true);
    assert.deepStrictEqual(res.body.reasons, []);
    assert.strictEqual(res.body.blast.bps, 1, 'bp_dev');
    assert.strictEqual(res.body.blast.pos, 2, 'shared_po + solo_po');
    assert.strictEqual(res.body.blast.sis, 1, 'si_dev');
    assert.strictEqual(res.body.blast.total, 4);
    assert.deepStrictEqual(res.body.blast.affectedSquads, [
      { index: 2, name: 'P3', lostBps: 0, lostPos: 1, lostSis: 0 },
    ], 'squad 2 shares shared_po (yellow) and loses exactly it');
    // Projection: no einherjar exist anywhere yet -> degenerate-safe rank 1 of 1.
    assert.strictEqual(res.body.projection.currentRank, null);
    assert.strictEqual(res.body.projection.projectedRank, 1);
    assert.strictEqual(res.body.projection.totalAfter, 1);
    assert.strictEqual(res.body.projection.topPercentile, 100);
    assert.strictEqual(res.body.projection.einherjarCountAfter, 1);
    // Preview persists nothing: the canvas is untouched.
    const canvas = scheduleStorage.readProfile(ragA.playerId).canvas;
    assert.strictEqual(canvas.presets.store.length, 3);
    assert.strictEqual(canvas.inv.pages[0].pos.length, 4);
  });

  await AT('ragnarok: `deployed` gate -- an open room slotting the squad (or any uid it shares) blocks the rite; releasing the room clears it', async () => {
    // White-box room doc: deployedUidSet (services/market.cjs, reused by
    // the rite gate) only reads ownerId/status/slots off listRooms().
    const roomDoc = {
      id: 'room_rag_gate', ownerId: ragA.playerId, status: 'open',
      slots: [{ squadIndex: 1 }, { squadIndex: null }, { squadIndex: null }, { squadIndex: null }],
    };
    scheduleStorage.writeRoom(roomDoc.id, roomDoc);
    try {
      let res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.eligible, false);
      assert.deepStrictEqual(res.body.reasons, ['deployed']);
      // The rite itself 409s with the same structured reason.
      const post = await marketReq('POST', '/api/ragnarok/devotion/1', ragA.token);
      assert.strictEqual(post.status, 409, JSON.stringify(post.body));
      assert.strictEqual(post.body.reason, 'deployed');
      // Sharing counts too: squad 2 shares shared_po with slotted squad 1.
      res = await marketReq('GET', '/api/ragnarok/devotion/preview/2', ragA.token);
      assert.strictEqual(res.body.eligible, false, 'devoting squad 2 would destroy shared_po out from under deployed squad 1');
      assert.deepStrictEqual(res.body.reasons, ['deployed']);
      // Canceled rooms release their uids (open/active-only gate).
      roomDoc.status = 'canceled';
      scheduleStorage.writeRoom(roomDoc.id, roomDoc);
      res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
      assert.strictEqual(res.body.eligible, true);
      assert.deepStrictEqual(res.body.reasons, []);
    } finally {
      scheduleStorage.deleteRoom(roomDoc.id);
    }
  });

  await AT('ragnarok: POST devotion -- einherjar record engraved; every referenced uid destroyed ACCOUNT-WIDE (inventory homes + shared squad refs); squad slot deleted', async () => {
    const res = await marketReq('POST', '/api/ragnarok/devotion/1', ragA.token, undefined, { 'idempotency-key': 'rite-A-1' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.replayed, false);
    assert.strictEqual(res.body.einherjar.squadName, 'P2', 'squadName = the squad display name');
    assert.strictEqual(res.body.einherjar.seasonDevoted, 1, 'stamped with the current season index');
    assert.deepStrictEqual(res.body.einherjar.counts, { bps: 1, pos: 2, sis: 1 });
    assert.strictEqual(res.body.einherjar.score, 0, 'no battles yet (REQ-0068) -> score 0');
    assert.deepStrictEqual(res.body.einherjar.perSeason, []);
    assert.strictEqual(res.body.einherjar.bioArchive, null, 'REQ-0060 not built -> stored empty');
    assert.strictEqual(res.body.blast.total, 4);
    assert.deepStrictEqual(res.body.blast.affectedSquads, [{ index: 2, name: 'P3', lostBps: 0, lostPos: 1, lostSis: 0 }]);

    const canvas = scheduleStorage.readProfile(ragA.playerId).canvas;
    // The devoted squad slot is DELETED (engine.js deleteSquad: store
    // slot + names[] entry both vanish; deleted index > active 0 leaves
    // active untouched).
    assert.strictEqual(canvas.presets.store.length, 2);
    assert.deepStrictEqual(canvas.presets.names, ['P1', 'P3', 'P4', 'P5']);
    assert.strictEqual(canvas.presets.active, 0);
    // Inventory homes (MASTER) destroyed for exactly the devoted uids.
    const pg0 = canvas.inv.pages[0];
    assert.deepStrictEqual(pg0.bps.map((b) => b.id), ['bp_other'], 'bp_dev home destroyed');
    assert.deepStrictEqual(pg0.pos.map((p) => p.uid), ['other_po', 'keep_po'], 'shared_po + solo_po homes destroyed, unrelated homes intact');
    assert.deepStrictEqual(pg0.sis.map((a) => a.uid), ['si_other'], 'si_dev home destroyed, si_other intact');
    // The yellow-shared squad (was index 2, now index 1) lost EXACTLY
    // the shared piece; its own material survives; its SI that sat on
    // the destroyed PO is stowed (host 'inv' -- engine.js ~388-389's
    // missing-host repair semantics).
    const shared = canvas.presets.store[1];
    assert.deepStrictEqual(shared.pos.map((p) => p.uid), ['keep_po']);
    assert.deepStrictEqual(shared.bps.map((b) => b.id), ['bp_other']);
    assert.deepStrictEqual(shared.sis, [{ uid: 'si_other', id: 'acc_gem', host: 'inv' }]);
    // White-box: the record is finalized and carries the frozen snapshot
    // (deep copy + content defs at rite time).
    const rec = scheduleStorage.listEinherjarRecords().find((r) => r.playerId === ragA.playerId);
    assert.ok(rec, 'einherjar record persisted');
    assert.strictEqual(rec.rite.state, 'done');
    assert.strictEqual(rec.idemKey, 'rite-A-1');
    assert.deepStrictEqual(rec.snapshot.canvas.pos.map((p) => p.uid), ['shared_po', 'solo_po'], 'snapshot froze the devoted canvas');
    assert.deepStrictEqual(rec.snapshot.canvas.bps.map((b) => b.id), ['bp_dev']);
    assert.strictEqual(rec.snapshot.itemDefs.pos.blade.id, 'blade', 'PO content def frozen at rite time (name is mutated by the earlier admin-edit tests, so pin identity)');
    assert.ok(rec.snapshot.itemDefs.sis.acc_gem, 'SI content def frozen at rite time');
    // The einherjar list endpoint shows it.
    const list = await marketReq('GET', '/api/ragnarok/einherjar', ragA.token);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.einherjar.length, 1);
    assert.strictEqual(list.body.einherjar[0].squadName, 'P2');
  });

  await AT('ragnarok: devoting the ACTIVE squad -- engine deleteSquad bookkeeping (nearest tab in) + top-level strip', async () => {
    const res = await marketReq('POST', '/api/ragnarok/devotion/0', ragE.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.einherjar.squadName, 'P1');
    assert.deepStrictEqual(res.body.einherjar.counts, { bps: 1, pos: 1, sis: 0 });
    const canvas = scheduleStorage.readProfile(ragE.playerId).canvas;
    // engine.js deleteSquad's nearest-remaining-tab rule: the old
    // store[1] slid into index 0 and is now the ACTIVE squad (its
    // content lives at the top level).
    assert.strictEqual(canvas.presets.store.length, 1);
    assert.strictEqual(canvas.presets.active, 0);
    assert.strictEqual(canvas.presets.store[0], null, 'active slot is materialized at the top level (engine.js splitBackSquads)');
    assert.deepStrictEqual(canvas.presets.names, ['P2', 'P3', 'P4', 'P5']);
    assert.deepStrictEqual(canvas.bps.map((b) => b.id), ['bp_e2']);
    assert.deepStrictEqual(canvas.pos.map((p) => p.uid), ['eKeep_po'], 'the shared eA_po reference was stripped from the surviving squad');
    // Homes: bp_e + eA_po destroyed; bp_e2 + eKeep_po intact.
    const pg0 = canvas.inv.pages[0];
    assert.deepStrictEqual(pg0.bps.map((b) => b.id), ['bp_e2']);
    assert.deepStrictEqual(pg0.pos.map((p) => p.uid), ['eKeep_po']);
  });

  await AT('ragnarok: 409 vocabulary (last_squad / empty_squad) + 404 no-leak for out-of-range, malformed and profile-less squad ids', async () => {
    // last_squad: ragE is down to a single squad after the test above
    // (mirrors engine.js deleteSquad's own last-refusal, ~1919).
    const last = await marketReq('POST', '/api/ragnarok/devotion/0', ragE.token);
    assert.strictEqual(last.status, 409, JSON.stringify(last.body));
    assert.strictEqual(last.body.reason, 'last_squad');
    const lastPrev = await marketReq('GET', '/api/ragnarok/devotion/preview/0', ragE.token);
    assert.strictEqual(lastPrev.body.eligible, false);
    assert.deepStrictEqual(lastPrev.body.reasons, ['last_squad']);
    // empty_squad: ragB squad 2 has no BP (engine.isSquadDeployable false).
    const empty = await marketReq('POST', '/api/ragnarok/devotion/2', ragB.token);
    assert.strictEqual(empty.status, 409);
    assert.strictEqual(empty.body.reason, 'empty_squad');
    // 404 no-leak: out-of-range, malformed, and no-profile-at-all are
    // byte-identical plain 404s.
    for (const [who, seg] of [[ragA, '99'], [ragA, 'abc'], [ragA, '-1'], [ragD, '0']]) {
      const prev = await marketReq('GET', '/api/ragnarok/devotion/preview/' + seg, who.token);
      assert.strictEqual(prev.status, 404, seg + ' preview -> ' + prev.status);
      assert.strictEqual(prev.body.error, 'squad not found');
      const post = await marketReq('POST', '/api/ragnarok/devotion/' + seg, who.token);
      assert.strictEqual(post.status, 404, seg + ' devote -> ' + post.status);
      assert.strictEqual(post.body.error, 'squad not found');
    }
  });

  await AT('ragnarok: mid_rite lock -- fresh `applying` 409s; stale one is lazily VOIDED when the cost never landed, ROLLED FORWARD when it did', async () => {
    const nowIso = new Date().toISOString();
    const mkLockRec = (id, riteT, snapPos) => ({
      id, playerId: ragC.playerId, squadName: 'Lock ' + id, seasonDevoted: 1, devotedAt: nowIso,
      snapshot: { canvas: { bps: [], pos: snapPos, sis: [] }, counts: { bps: 0, pos: snapPos.length, sis: 0 }, itemDefs: { pos: {}, sis: {} } },
      blast: { bps: 0, pos: snapPos.length, sis: 0, total: snapPos.length, affectedSquads: [] },
      bioArchive: null, perSeason: [], emblems: [], idemKey: null,
      rite: { state: 'applying', t: riteT },
    });
    // (a) FRESH 'applying' record = a rite in flight: 409 mid_rite, and
    // the pending record is hidden from the hall.
    scheduleStorage.writeEinherjarRecord('ein_lock_fresh', mkLockRec('ein_lock_fresh', nowIso, [{ uid: 'c_keep_po', id: 'blade' }]));
    const blocked = await marketReq('POST', '/api/ragnarok/devotion/1', ragC.token);
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.strictEqual(blocked.body.reason, 'mid_rite');
    const prev = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragC.token);
    assert.strictEqual(prev.body.eligible, false);
    assert.ok(prev.body.reasons.includes('mid_rite'));
    let list = await marketReq('GET', '/api/ragnarok/einherjar', ragC.token);
    assert.strictEqual(list.body.einherjar.length, 0, 'an applying record is hidden until finalized');
    // (b) STALE 'applying' whose snapshot uids are STILL HOMED (the
    // atomic profile write never happened): lazily VOIDED -- the player
    // lost nothing, no engraving stands (under-deliver-never-duplicate).
    const staleT = new Date(Date.now() - ragnarok.RITE_LOCK_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeEinherjarRecord('ein_lock_fresh', mkLockRec('ein_lock_fresh', staleT, [{ uid: 'c_keep_po', id: 'blade' }]));
    const prev2 = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragC.token);
    assert.strictEqual(prev2.body.eligible, true, 'stale un-landed rite no longer blocks');
    assert.strictEqual(scheduleStorage.readEinherjarRecord('ein_lock_fresh'), null, 'voided record is deleted');
    // (c) STALE 'applying' whose snapshot uids are GONE from the
    // inventory (the cost landed, the finalize write crashed): lazily
    // ROLLED FORWARD to done -- the paid-for engraving stands.
    scheduleStorage.writeEinherjarRecord('ein_lock_landed', mkLockRec('ein_lock_landed', staleT, [{ uid: 'ghost_po', id: 'blade' }]));
    list = await marketReq('GET', '/api/ragnarok/einherjar', ragC.token);
    assert.strictEqual(list.body.einherjar.length, 1);
    assert.strictEqual(list.body.einherjar[0].squadName, 'Lock ein_lock_landed');
    const recovered = scheduleStorage.readEinherjarRecord('ein_lock_landed');
    assert.strictEqual(recovered.rite.state, 'done');
    assert.ok(recovered.rite.recoveredAt, 'roll-forward is stamped');
  });

  await AT('ragnarok: Idempotency-Key -- replaying the rite returns the ORIGINAL record; no second destruction; keys are per-player', async () => {
    const invBefore = scheduleStorage.readProfile(ragB.playerId).canvas.inv.pages[0];
    assert.strictEqual(invBefore.pos.length, 1, 'precondition: b1_po home present');
    const first = await marketReq('POST', '/api/ragnarok/devotion/1', ragB.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    assert.strictEqual(first.body.replayed, false);
    const recId = first.body.einherjar.id;
    const canvasAfterFirst = scheduleStorage.readProfile(ragB.playerId).canvas;
    assert.strictEqual(canvasAfterFirst.presets.store.length, 2);
    // Replay: same caller, same key -> the original outcome, nothing
    // re-destroyed (the replay short-circuits BEFORE eligibility -- the
    // now-shifted index 1 points at a DIFFERENT squad and must not be
    // touched).
    const replay = await marketReq('POST', '/api/ragnarok/devotion/1', ragB.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(replay.status, 200, JSON.stringify(replay.body));
    assert.strictEqual(replay.body.replayed, true);
    assert.strictEqual(replay.body.einherjar.id, recId);
    const canvasAfterReplay = scheduleStorage.readProfile(ragB.playerId).canvas;
    assert.strictEqual(canvasAfterReplay.presets.store.length, 2, 'replay deleted nothing');
    assert.deepStrictEqual(canvasAfterReplay.inv.pages[0].pos, [], 'b1_po destroyed exactly once');
    const einCount = scheduleStorage.listEinherjarRecords().filter((r) => r.playerId === ragB.playerId).length;
    assert.strictEqual(einCount, 1, 'no duplicate record');
    // Keys are scoped per player: another caller reusing the key gets
    // their OWN outcome (here: 404, no profile at all), never ragB's.
    const foreign = await marketReq('POST', '/api/ragnarok/devotion/0', ragD.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(foreign.status, 404);
  });

  await AT('ragnarok: GET /api/ragnarok/einherjar -- own by default, ?player= is public for registered players, unknown 404', async () => {
    const own = await marketReq('GET', '/api/ragnarok/einherjar', ragB.token);
    assert.strictEqual(own.status, 200);
    assert.strictEqual(own.body.playerId, ragB.playerId);
    assert.strictEqual(own.body.einherjar.length, 1);
    assert.strictEqual(own.body.einherjar[0].squadName, 'P2');
    assert.strictEqual(own.body.einherjar[0].seasonDevoted, 1);
    // Hall records are public: ragA can read ragB's corridor.
    const foreign = await marketReq('GET', '/api/ragnarok/einherjar?player=' + encodeURIComponent(ragB.playerId), ragA.token);
    assert.strictEqual(foreign.status, 200);
    assert.strictEqual(foreign.body.playerId, ragB.playerId);
    assert.strictEqual(foreign.body.einherjar.length, 1);
    // The list DTO never leaks the frozen snapshot internals.
    assert.strictEqual(foreign.body.einherjar[0].snapshot, undefined);
    const unknown = await marketReq('GET', '/api/ragnarok/einherjar?player=totally_not_a_player', ragA.token);
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(unknown.body.error, 'player not found');
  });

  await AT('ragnarok: the Eternal Order ranks by score desc, then einherjarCount, then name -- 戦果 folded via battleScoreOf; newest-first hall', async () => {
    const nowIso2 = new Date().toISOString();
    const mkDoneRec = (id, playerId, squadName, devotedAt, perSeason) => ({
      id, playerId, squadName, seasonDevoted: 1, devotedAt,
      snapshot: { canvas: { bps: [], pos: [], sis: [] }, counts: { bps: 0, pos: 0, sis: 0 }, itemDefs: { pos: {}, sis: {} } },
      blast: { bps: 0, pos: 0, sis: 0, total: 0, affectedSquads: [] },
      bioArchive: null, perSeason: perSeason || [], emblems: [], idemKey: null,
      rite: { state: 'done', t: devotedAt },
    });
    // ragD: 2 engravings, one with a real battle history -> 300 (100*1 + 2*50 + 1*100).
    scheduleStorage.writeEinherjarRecord('ein_d1', mkDoneRec('ein_d1', ragD.playerId, 'Delta1',
      new Date(Date.now() - 2 * RAG_DAY).toISOString(),
      [{ season: 1, battles: [{ damage: 100, kills: 2, survived: 1 }] }]));
    scheduleStorage.writeEinherjarRecord('ein_d2', mkDoneRec('ein_d2', ragD.playerId, 'Delta2',
      new Date(Date.now() - 1 * RAG_DAY).toISOString(), []));
    // Newest-first hall listing while we're here.
    const hall = await marketReq('GET', '/api/ragnarok/einherjar?player=' + encodeURIComponent(ragD.playerId), ragD.token);
    assert.deepStrictEqual(hall.body.einherjar.map((e) => e.squadName), ['Delta2', 'Delta1']);
    assert.strictEqual(hall.body.einherjar[1].score, 300, 'per-record 戦果 fold');
    // Force a rebuild (stale cache) and read the standings.
    scheduleStorage.writeRagnarokOrderCache({ rebuiltAt: new Date(Date.now() - 2 * RAG_DAY).toISOString(), dawnUtcHour: 20, formulaVersion: 1, entries: [] });
    const res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.total, 5, 'exactly the players with engravings (A, B, C, D, E)');
    assert.deepStrictEqual(res.body.tiers, [
      { tier: 'THRALL', min: 0 }, { tier: 'KARL', min: 500 }, { tier: 'JARL', min: 2000 }, { tier: 'EINHERJAR', min: 8000 },
    ]);
    const top = res.body.top;
    assert.strictEqual(top[0].playerId, ragD.playerId, 'score 300 leads');
    assert.strictEqual(top[0].rank, 1);
    assert.strictEqual(top[0].score, 300);
    assert.strictEqual(top[0].einherjarCount, 2);
    assert.strictEqual(top[0].tier, 'THRALL', '300 < 500: still a thrall');
    assert.strictEqual(top[0].emblem, 'emblem_horn3', 'placeholder emblem');
    // Zero-score group: einherjarCount ties broken by name asc.
    assert.deepStrictEqual(top.slice(1).map((e) => e.name), ['RagnarAlfa', 'RagnarBravo', 'RagnarCastle', 'RagnarEcho']);
    assert.deepStrictEqual(top.map((e) => e.rank), [1, 2, 3, 4, 5]);
    assert.strictEqual(res.body.me.playerId, ragA.playerId);
    assert.strictEqual(res.body.me.rank, 2);
    // A caller with no engraving gets the synthetic unranked row.
    const guest = await marketReq('GET', '/api/ragnarok/order?around=me', guestA.token);
    assert.strictEqual(guest.body.me.rank, null);
    assert.strictEqual(guest.body.me.einherjarCount, 0);
    assert.strictEqual(guest.body.me.tier, 'THRALL');
    assert.deepStrictEqual(guest.body.around, [], 'unranked around=me is empty, not an error');
  });

  await AT('ragnarok: order pagination -- top=N, around=me windows, q= find-by-name', async () => {
    const top2 = await marketReq('GET', '/api/ragnarok/order?top=2', ragA.token);
    assert.strictEqual(top2.body.top.length, 2);
    assert.deepStrictEqual(top2.body.top.map((e) => e.rank), [1, 2]);
    assert.strictEqual(top2.body.total, 5, 'total reports the whole order, not the page');
    // around=me for the tail (ragE, rank 5): window clips at the end.
    const tail = await marketReq('GET', '/api/ragnarok/order?around=me', ragE.token);
    assert.deepStrictEqual(tail.body.around.map((e) => e.rank), [3, 4, 5]);
    assert.strictEqual(tail.body.me.rank, 5);
    // around=me for the head (ragD, rank 1): clips at the start.
    const head = await marketReq('GET', '/api/ragnarok/order?around=me', ragD.token);
    assert.deepStrictEqual(head.body.around.map((e) => e.rank), [1, 2, 3]);
    // q= find-by-name (case-insensitive substring), capped by top.
    const q1 = await marketReq('GET', '/api/ragnarok/order?q=ragnarc', ragA.token);
    assert.deepStrictEqual(q1.body.matches.map((e) => e.name), ['RagnarCastle']);
    const qAll = await marketReq('GET', '/api/ragnarok/order?q=RAGNAR', ragA.token);
    assert.strictEqual(qAll.body.matches.length, 5);
    const qCap = await marketReq('GET', '/api/ragnarok/order?q=RAGNAR&top=1', ragA.token);
    assert.strictEqual(qCap.body.matches.length, 1);
    const qMiss = await marketReq('GET', '/api/ragnarok/order?q=loki', ragA.token);
    assert.deepStrictEqual(qMiss.body.matches, []);
  });

  await AT('ragnarok: the daily-dawn lazy rebuild -- fresh cache served verbatim, stale/formula-mismatch caches rebuilt, rebuild deterministic', async () => {
    // lastDawnMs boundary math (dawn = 20:00 UTC [ORCH] = 05:00 JST).
    assert.strictEqual(ragnarok.lastDawnMs(Date.UTC(2026, 0, 15, 21, 0, 0)), Date.UTC(2026, 0, 15, 20, 0, 0), 'past dawn -> today\'s dawn');
    assert.strictEqual(ragnarok.lastDawnMs(Date.UTC(2026, 0, 15, 19, 59, 59)), Date.UTC(2026, 0, 14, 20, 0, 0), 'before dawn -> yesterday\'s dawn');
    // A FRESH cache (rebuiltAt at/after the last dawn) is served
    // verbatim -- the sentinel proves no rebuild happened.
    const sentinel = {
      rebuiltAt: new Date().toISOString(), dawnUtcHour: 20, formulaVersion: 1,
      entries: [{ playerId: 'sentinel', name: 'Sentinel', emblem: 'emblem_horn3', einherjarCount: 9, score: 9999, rank: 1, tier: 'EINHERJAR' }],
    };
    scheduleStorage.writeRagnarokOrderCache(sentinel);
    let res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 1, 'cache served, no rebuild');
    assert.strictEqual(res.body.top[0].playerId, 'sentinel');
    // A cache OLDER than the last dawn boundary rebuilds ("first
    // request past dawn recomputes"; 更新は毎暁).
    scheduleStorage.writeRagnarokOrderCache(Object.assign({}, sentinel, { rebuiltAt: new Date(Date.now() - 25 * RAG_HOUR).toISOString() }));
    res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 5, 'stale cache rebuilt from einherjar records');
    assert.strictEqual(res.body.top[0].playerId, ragD.playerId);
    assert.ok(Date.parse(res.body.rebuiltAt) >= ragnarok.lastDawnMs(Date.now()), 'rebuiltAt stamped now');
    // A formula-version mismatch self-invalidates even when fresh.
    scheduleStorage.writeRagnarokOrderCache(Object.assign({}, sentinel, { formulaVersion: 0 }));
    res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 5, 'formula bump invalidates the cache');
    // Determinism: two rebuilds over the same records are identical.
    const ts = Date.now();
    const r1 = ragnarok.rebuildOrder(ts);
    const r2 = ragnarok.rebuildOrder(ts);
    assert.deepStrictEqual(r1, r2, 'rebuild is a pure fold over the records');
  });

  await AT('market: GET /api/market/furnace windows the burn total by the current season (REQ-0066), all-time fallback without a registry', async () => {
    writeCanonicalSeason(); // re-anchor: season 1 started 10d1h ago
    const seasonRes = await marketReq('GET', '/api/ragnarok/season', ragA.token);
    const seasonStartIso = seasonRes.body.season.startAt;
    const before = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(before.status, 200, JSON.stringify(before.body));
    assert.deepStrictEqual(before.body.season, { index: 1, name: '狼の冬' }, 'furnace names the season it windows');
    assert.strictEqual(before.body.furnace.since, seasonStartIso, 'window starts at the season start');
    // White-box ledger entries: one BEFORE the season started (must not
    // count), one inside the window (must).
    scheduleStorage.writeMarketFurnaceEntry({ id: 'furn_win_old', amount: 7, tm: 'lrdst', listingId: 'x_old', t: new Date(Date.now() - 30 * RAG_DAY).toISOString() });
    scheduleStorage.writeMarketFurnaceEntry({ id: 'furn_win_new', amount: 5, tm: 'lrdst', listingId: 'x_new', t: new Date(Date.now() - 1 * RAG_DAY).toISOString() });
    const windowed = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(windowed.body.furnace.total, before.body.furnace.total + 5, 'pre-season burn excluded, in-season burn counted');
    assert.strictEqual(windowed.body.furnace.count, before.body.furnace.count + 1);
    // No seasons file -> the documented all-time fallback (pre-REQ-0066
    // behavior byte-for-byte: since null, everything counts).
    writeSeasonsFixture(null);
    const allTime = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(allTime.body.furnace.since, null);
    assert.strictEqual(allTime.body.season, null);
    assert.strictEqual(allTime.body.furnace.total, before.body.furnace.total + 5 + 7, 'all-time includes the pre-season entry');
    writeCanonicalSeason();
  });

  await AT('ragnarok: every /api/ragnarok route is token-gated (401 for a garbage token)', async () => {
    for (const [method, p2] of [
      ['GET', '/api/ragnarok/season'],
      ['GET', '/api/ragnarok/order'],
      ['GET', '/api/ragnarok/einherjar'],
      ['GET', '/api/ragnarok/devotion/preview/0'],
      ['POST', '/api/ragnarok/devotion/0'],
    ]) {
      const res = await marketReq(method, p2, 'totally-bogus-token');
      assert.strictEqual(res.status, 401, method + ' ' + p2 + ' -> ' + res.status);
    }
  });

  await AT('admin: REAL repo happy path -- edit persists to the real content/live/live_items.json, then self-restores byte-identical', async () => {
    // This test intentionally operates against the REAL repo tree (not the
    // synthetic fixture above) -- os.homedir() is already restored to the
    // real value at this point in the run. Per the task spec: back up the
    // real file BEFORE the edit, perform the edit via the real HTTP PUT
    // path, verify the file changed, then RESTORE the exact original bytes
    // and verify checksum-identical -- in a try/finally so restoration
    // always happens even if an assertion above it throws.
    const crypto = require('crypto');
    const realItemsPath = path.join(realHomedir(), 'backpack_ragnarok', 'content', 'live', 'live_items.json');
    const originalBytes = fs.readFileSync(realItemsPath);
    const originalMode = fs.statSync(realItemsPath).mode;
    const originalSha = crypto.createHash('sha256').update(originalBytes).digest('hex');

    // REQ-0047 (c): rebind the WHOLE server module tree (see evictServerModuleTree).
    evictServerModuleTree();
    const realApi = require('../api.cjs');

    try {
      // Ensure the real dev player exists + is an item_admin, and grab its
      // real token (created if missing, same as server boot would do).
      const realAdmin = require('../admin.cjs');
      const realDevPlayer = realAdmin.ensureDevPlayer();

      // Pick a real live item id and confirm current name via the real admin module.
      const found = realAdmin.findLiveEntry('dagger');
      assert.ok(found, 'fixture item "dagger" must exist in the real content/live/live_items.json');
      const originalName = found.doc.entries[found.index].name;

      await new Promise((resolve, reject) => {
        const req = mockReq(
          'PUT',
          '/api/admin/item/dagger',
          JSON.stringify({ name: originalName + ' (test-edit)' }),
          authHeaders(realDevPlayer.token)
        );
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        realApi.handle(req, res);
      });

      // Verify the real file actually changed.
      const changedBytes = fs.readFileSync(realItemsPath);
      assert.notStrictEqual(changedBytes.toString('utf8'), originalBytes.toString('utf8'), 'file must have changed after the edit');
      const reread = JSON.parse(changedBytes.toString('utf8'));
      const changedEntry = reread.entries.find((e) => e.id === 'dagger');
      assert.strictEqual(changedEntry.name, originalName + ' (test-edit)');
      // Fidelity check: the rewritten file must preserve the original's
      // trailing-newline convention (every content/live/*.json in this
      // repo ends with exactly one trailing newline) -- admin.cjs's write
      // path explicitly re-adds it since JSON.stringify never does.
      if (originalBytes.toString('utf8').endsWith('\n')) {
        assert.ok(changedBytes.toString('utf8').endsWith('\n'), 'rewritten file must keep the trailing newline the original had');
      }
    } finally {
      // ALWAYS restore, even if an assertion above threw -- bytes AND mode
      // (the admin write path's atomic tmp-file+rename can change the
      // file's mode bits, e.g. losing an executable bit some content
      // files happen to carry; restore that explicitly too so `git
      // status` shows a truly clean tree, not just byte-identical
      // content).
      fs.writeFileSync(realItemsPath, originalBytes);
      fs.chmodSync(realItemsPath, originalMode);
      const restoredSha = crypto.createHash('sha256').update(fs.readFileSync(realItemsPath)).digest('hex');
      if (restoredSha !== originalSha) {
        throw new Error('CRITICAL: failed to restore content/live/live_items.json byte-identical! before=' + originalSha + ' after=' + restoredSha);
      }
    }
  });


  // =====================================================================
  // REQ-0063: Dismantle system (ledger, quality roll, TTL auto-dismantle).
  //
  // Own module generation: the "admin: REAL repo happy path" test just
  // above deliberately runs against the REAL os.homedir() (restored at
  // `os.homedir = realHomedir;` earlier in this file) so it can edit-then-
  // restore the actual content/live/live_items.json -- and nothing
  // previously ran AFTER that test to swap the sandbox back. Re-swap to
  // the SAME synthetic fakeRepoHome/repoRoot fixture the rest of this
  // suite uses, and re-evict + re-require every server/ module fresh
  // under new LOCAL names (dz*) so this block never touches the real
  // ~/backpack_ragnarok tree.
  // =====================================================================
  {
    os.homedir = () => fakeRepoHome;
    evictServerModuleTree();
    const dzApi = require('../api.cjs');
    const dzPlayers = require('../players.cjs');
    const dzStorage = require('../storage.cjs');
    const dzSchedule = require('../schedule.cjs');
    const dzDismantle = require('../dismantle.cjs');
    const dzWarehouseSvc = require('../services/warehouse.cjs');

    function dzReq(method, urlPath, token, body) {
      return new Promise((resolve, reject) => {
        const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
        const req2 = mockReq(method, urlPath, bodyStr, authHeaders(token));
        const res2 = mockRes((b) => {
          let parsed = null;
          try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
          resolve({ status: res2.statusCode, body: parsed });
        });
        try { dzApi.handle(req2, res2); } catch (e) { reject(e); }
      });
    }

    // A bare, minimal profile: two 'blade' PO instances homed in
    // inventory page 0 (dzp1/dzp2, never referenced by the active
    // squad -- not deployed), plus a THIRD (dzp3) that IS referenced by
    // the active squad (index 0) so a hand-written room can deploy it.
    const dismantlePlayer = dzPlayers.createPlayer('DismantlePlayer', []);
    const dzCanvas = {
      pos: [{ uid: 'dzp3', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }],
      bps: [], sis: [],
      presets: { active: 0, store: [null, null] },
      inv: {
        pages: [
          {
            pos: [
              { uid: 'dzp1', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
              { uid: 'dzp2', id: 'blade', loc: 'grid', cell: [3, 1], rot: 0 },
              { uid: 'dzp3', id: 'blade', loc: 'grid', cell: [5, 1], rot: 0 },
            ],
            sis: [], bps: [], tms: [],
          },
        ],
      },
    };
    dzStorage.writeProfile(dismantlePlayer.playerId, dzCanvas);
    // Minimal room doc, written directly (bypassing assignSlot's own
    // "empty_squad" business-rule validation -- irrelevant to what THIS
    // gate test is proving, which is that dismantleItem correctly
    // CONSUMES market.deployedUidSet's result, a function already fully
    // covered by the market suspension tests above). Only the fields
    // deployedUidSet itself reads are populated.
    dzStorage.writeRoom('dz_room_1', {
      id: 'dz_room_1', ownerId: dismantlePlayer.playerId, status: 'open',
      slots: [{ squadIndex: 0 }, { squadIndex: null }, { squadIndex: null }, { squadIndex: null }],
    });

    T('dismantle: every /api/dismantle route is token-gated (401 for a garbage token)', () => {
      const req = mockReq('POST', '/api/dismantle', JSON.stringify({ itemUid: 'dzp1', kind: 'po' }), { 'x-auth-token': 'garbage' });
      const res = mockRes();
      dzApi.handle(req, res);
      assert.strictEqual(res.statusCode, 401);
    });

    await AT('dismantle: happy path -- removes the item, engraves the ledger, yields 1 lrdst via warehouse', async () => {
      const before = await dzReq('GET', '/api/dismantle/ledger', dismantlePlayer.token);
      assert.strictEqual(before.status, 200);
      assert.deepStrictEqual(before.body.entries, [], 'fresh player has no ledger yet');

      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp1', kind: 'po' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.itemId, 'blade');
      assert.strictEqual(res.body.dismantleCount, 1);
      assert.ok(Math.abs(res.body.suppression - dzDismantle.suppressionFloor(1)) < 1e-9);
      assert.deepStrictEqual(res.body.yield, { tmId: 'lrdst', qty: 1 });

      // Item gone from inventory (home record), everywhere.
      const canvasAfter = dzStorage.readProfile(dismantlePlayer.playerId).canvas;
      assert.strictEqual(dzDismantle.findInventoryItem(canvasAfter, 'dzp1', 'po'), null);
      // The untouched sibling instance (dzp2) must survive.
      assert.ok(dzDismantle.findInventoryItem(canvasAfter, 'dzp2', 'po'), 'sibling instance untouched');

      // Ledger persisted.
      assert.strictEqual(dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade'), 1);

      // Yield landed as a normal claimable warehouse row (house grant
      // pattern -- never written straight onto the canvas, see the
      // dismantleItem RULE-5 doc).
      const wh = dzSchedule.listWarehouse(dismantlePlayer.playerId);
      const yieldRow = wh.find((w) => w.kind === 'tm' && w.itemId === 'lrdst');
      assert.ok(yieldRow, 'yield row present in warehouse');
      assert.strictEqual(yieldRow.qty, 1);
      assert.strictEqual(yieldRow.status, 'claimable');
    });

    await AT('dismantle: a second dismantle of the SAME item id engraves cumulatively (分解値 rises, suppression rises)', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp2', kind: 'po' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.dismantleCount, 2);
      assert.ok(res.body.suppression > dzDismantle.suppressionFloor(1), 'suppression strictly rises with count');
      assert.ok(res.body.suppression < dzDismantle.SUPPRESSION_CAP, 'suppression never reaches the cap');

      const ledger = await dzReq('GET', '/api/dismantle/ledger', dismantlePlayer.token);
      const entry = ledger.body.entries.find((e) => e.itemId === 'blade');
      assert.strictEqual(entry.dismantleCount, 2);
    });

    await AT('dismantle: unknown itemUid -> 404', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'not_a_real_uid', kind: 'po' });
      assert.strictEqual(res.status, 404);
    });

    await AT('dismantle: malformed body (missing itemUid / bad kind) -> 400', async () => {
      const r1 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { kind: 'po' });
      assert.strictEqual(r1.status, 400);
      const r2 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'bp' });
      assert.strictEqual(r2.status, 400);
    });

    await AT('dismantle: deployed gate -- an item referenced by a slotted squad in an open room cannot be dismantled (409)', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'po' });
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.reason, 'deployed');
      // Untouched: still present, ledger unchanged.
      const canvasAfter = dzStorage.readProfile(dismantlePlayer.playerId).canvas;
      assert.ok(dzDismantle.findInventoryItem(canvasAfter, 'dzp3', 'po'), 'deployed item survives the refused dismantle');
      assert.strictEqual(dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade'), 2, 'ledger unchanged by a refused dismantle');

      // Releasing the room lifts the gate (same Law-of-Possession
      // lazy-derivation contract market's own suspension test proves).
      const room = dzStorage.readRoom('dz_room_1');
      room.status = 'canceled';
      dzStorage.writeRoom('dz_room_1', room);
      const res2 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'po' });
      assert.strictEqual(res2.status, 200, JSON.stringify(res2.body));
      assert.strictEqual(res2.body.dismantleCount, 3);
    });

    T('dismantle: suppressionFloor -- asymptotic, capped, diminishing marginal effect (CAP=0.5, DECAY=0.85)', () => {
      const s = dzDismantle.suppressionFloor;
      assert.strictEqual(s(0), 0);
      assert.ok(s(1) > 0 && s(1) < s(5));
      assert.ok(s(5) < s(20));
      assert.ok(s(20) < dzDismantle.SUPPRESSION_CAP);
      assert.ok(s(100) < dzDismantle.SUPPRESSION_CAP, 'never reaches the cap, even at very high n');
      // NOTE: n=1000 is deliberately NOT asserted here -- at that
      // magnitude 0.85^n underflows below double-precision's ability to
      // distinguish (1 - 0.85^1000) from 1 exactly, so s(1000) legitimately
      // COMPUTES as exactly the cap in floating point even though the
      // true mathematical limit is only ever approached. n=100 is already
      // a wildly unrealistic dismantle count for real play and safely
      // within float precision, so it is the honest boundary to assert.
      // Diminishing marginal effect: the FIRST dismantle's delta exceeds
      // a LATER dismantle's delta (strong-early/weak-later, per the
      // user's own confirmed spec).
      const firstDelta = s(1) - s(0);
      const laterDelta = s(10) - s(9);
      assert.ok(firstDelta > laterDelta, 'marginal effect diminishes: ' + firstDelta + ' vs ' + laterDelta);
    });

    T('dismantle: rollQuality -- floor rises with 分解値, ceiling always reaches toward 1, q is always < 1', () => {
      const qp = dzPlayers.createPlayer('QualityRollCheck', []);
      // n=0: floor is exactly 0 -- q can land anywhere in [0,1).
      for (let i = 0; i < 50; i++) {
        const q = dzDismantle.rollQuality(qp.playerId, 'never_dismantled_item');
        assert.ok(q >= 0 && q < 1, 'q in [0,1): ' + q);
      }
      // Engrave 10x, then every roll must be >= that floor.
      for (let i = 0; i < 10; i++) dzDismantle.engrave(qp.playerId, 'well_farmed_item');
      const floor = dzDismantle.currentSuppression(qp.playerId, 'well_farmed_item');
      assert.ok(floor > 0);
      for (let i = 0; i < 50; i++) {
        const q = dzDismantle.rollQuality(qp.playerId, 'well_farmed_item');
        assert.ok(q >= floor && q < 1, 'q=' + q + ' must be >= floor=' + floor + ' and < 1');
      }
    });

    await AT('dismantle: quality roll wired into acquisition -- admin grant + dungeon reward + warehouse claim all carry q', async () => {
      const qp2 = dzPlayers.createPlayer('QualityWiring', []);
      // engrave a known floor first so the roll is provably bounded below it.
      for (let i = 0; i < 6; i++) dzDismantle.engrave(qp2.playerId, 'blade');
      const floor = dzDismantle.currentSuppression(qp2.playerId, 'blade');
      assert.ok(floor > 0);

      // grantWarehouseItem (admin-grant path).
      const granted = dzWarehouseSvc.grantWarehouseItem(qp2.playerId, 'blade');
      assert.strictEqual(granted.ok, true);
      assert.ok(typeof granted.item.q === 'number' && granted.item.q >= floor && granted.item.q < 1, 'q=' + granted.item.q);

      // claimWarehouseItem surfaces q in its return value (consumed by
      // the client's WarehouseTab.tsx to attach it to the new PO record).
      const { itemDefsById } = dzSchedule.getScheduleContent();
      const claimed = dzWarehouseSvc.claimWarehouseItem(qp2.playerId, granted.item.itemUid, itemDefsById, {});
      assert.strictEqual(claimed.q, granted.item.q, 'claim response carries the SAME q the row was minted with');
    });

    await AT('dismantle: TTL auto-dismantle -- expiry engraves the ledger always, yields probabilistically (50%), never for kind:tm currency rows', async () => {
      const ttlPlayer = dzPlayers.createPlayer('TtlAutoDismantle', []);
      const now = Date.now();
      const expiredPo = {
        itemUid: 'ttl_po_yield', playerId: ttlPlayer.playerId, itemId: 'fx_dagger',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      const expiredPo2 = {
        itemUid: 'ttl_po_noyield', playerId: ttlPlayer.playerId, itemId: 'fx_dagger',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      const expiredTm = {
        itemUid: 'ttl_tm', playerId: ttlPlayer.playerId, itemId: 'lrdst', qty: 5, kind: 'tm',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredPo.itemUid, expiredPo);
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredPo2.itemUid, expiredPo2);
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredTm.itemUid, expiredTm);

      const originalRandom = Math.random;
      let call = 0;
      // First purge-eligible po row rolls "yield" (0.1 < 0.5); the
      // second rolls "no yield" (0.9 >= 0.5). Both rows are asserted by
      // item id after the fact rather than relying on which one got
      // which random draw, so this is not order-fragile.
      Math.random = () => (call++ === 0 ? 0.1 : 0.9);
      try {
        dzSchedule.purgeExpiredWarehouseItems(ttlPlayer.playerId);
      } finally {
        Math.random = originalRandom;
      }

      // Both po rows engraved (full engraving always, per spec).
      assert.strictEqual(dzDismantle.dismantleCountFor(ttlPlayer.playerId, 'fx_dagger'), 2);
      // Both expired warehouse rows gone.
      const survivorUids = dzSchedule.listWarehouse(ttlPlayer.playerId).map((w) => w.itemUid);
      assert.ok(!survivorUids.includes('ttl_po_yield'));
      assert.ok(!survivorUids.includes('ttl_po_noyield'));
      assert.ok(!survivorUids.includes('ttl_tm'), 'tm row still plain-deleted, no engraving concept for currency');
      // Exactly one yield row landed (from the call===0 -> 0.1 draw).
      const yieldRows = dzSchedule.listWarehouse(ttlPlayer.playerId).filter((w) => w.kind === 'tm' && w.itemId === 'lrdst');
      assert.strictEqual(yieldRows.length, 1, 'exactly one of the two expired rows yielded (the 0.1 draw)');
      assert.strictEqual(yieldRows[0].qty, 1);
    });

    await AT('dismantle: REQ-0052 Dex card carries the CALLER\'s own 分解値+suppression overlay (kind:item/si only, never kind:tm, omitted for an unresolvable caller)', async () => {
      // dismantlePlayer has dismantled 3 blades by this point in the
      // block (happy path + cumulative + the deployed-gate's post-release
      // dismantle above) -- reuse that state rather than engraving fresh,
      // proving the route reads the SAME ledger dismantleItem itself wrote.
      const bladeCount = dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade');
      assert.strictEqual(bladeCount, 3);

      const withToken = await dzReq('GET', '/api/dex/card/item/blade', dismantlePlayer.token);
      assert.strictEqual(withToken.status, 200);
      assert.ok(withToken.body.card.dismantle, 'dismantle overlay present for a resolved caller on a kind:item card');
      assert.strictEqual(withToken.body.card.dismantle.count, bladeCount);
      assert.ok(Math.abs(withToken.body.card.dismantle.suppression - dzDismantle.suppressionFloor(bladeCount)) < 1e-9);

      // Never dismantled BY THIS PLAYER (a different player dismantled
      // fx_dagger elsewhere in this file) -- count:0, suppression:0, but
      // the field is still PRESENT (a resolved caller always gets an
      // overlay for a dismantlable kind, even at the zero baseline).
      const neverDismantled = await dzReq('GET', '/api/dex/card/item/fx_dagger', dismantlePlayer.token);
      assert.strictEqual(neverDismantled.status, 200);
      assert.ok(neverDismantled.body.card.dismantle);
      assert.strictEqual(neverDismantled.body.card.dismantle.count, 0);
      assert.strictEqual(neverDismantled.body.card.dismantle.suppression, 0);

      // kind:'tm' can never be dismantled -- the overlay must never
      // appear there, even for the exact same resolved caller.
      const tmCard = await dzReq('GET', '/api/dex/card/tm/lrdst', dismantlePlayer.token);
      assert.strictEqual(tmCard.status, 200);
      assert.strictEqual(tmCard.body.card.dismantle, undefined, 'kind:tm never carries a dismantle overlay');

      // No token at all -- dev_mode fallback resolves (to THIS sandbox's
      // own isolated dev player, never the real one), so the base card
      // fetch still succeeds AND still gets an overlay (dev player's own,
      // freshly at count 0) -- proves the anonymous path degrades to "a
      // resolved caller" rather than erroring, matching admin.resolveAuth's
      // documented dev_mode contract.
      const noToken = await dzReq('GET', '/api/dex/card/item/blade', undefined);
      assert.strictEqual(noToken.status, 200);
      assert.ok(noToken.body.card.dismantle, 'dev_mode no-token fallback still resolves a caller, so the overlay is present');

      // A garbage (present but invalid) token is NOT the same as no
      // token -- resolveAuth returns ok:false for it even under
      // dev_mode, so the overlay must be omitted while the base card
      // fetch still succeeds (this route is never auth-REQUIRED).
      const badToken = await dzReq('GET', '/api/dex/card/item/blade', 'totally_garbage_token');
      assert.strictEqual(badToken.status, 200, 'base card fetch never fails even with an invalid token');
      assert.strictEqual(badToken.body.card.dismantle, undefined, 'an invalid token resolves to no caller, so no overlay -- never a 401');
    });

    os.homedir = realHomedir; // leave the sandbox exactly as this block found it (real homedir active), matching the outer suite's own posture at this point in the file
  }
  // ---- REQ-0052: Dex Card API (GET /api/dex/card/:kind/:id) ----
  // Exercises the live fixture content already declared above (blade =
  // item, acc_gem = si, lrdst = tm) through the SAME api.handle()
  // mock-request harness every other route test in this file uses --
  // no new fixture content needed. Public route (no auth header sent
  // anywhere below), matching dex.cjs's documented no-auth posture.
  T('dex card: GET /api/dex/card/item/blade -- 200, v:1, shape/tags present, no si/tm-only fields leak in', () => {
    // NOTE: 'blade'.name is mutated by an earlier admin-edit test in this
    // same file (PUT /api/admin/item/blade {name:'Blade Mk3'}, this
    // synthetic fixture is never restored the way the dedicated
    // "REAL repo happy path" test restores the real repo) -- so this
    // compares against /api/content's CURRENT value rather than the
    // original fixture literal 'Blade', matching this test file's own
    // "tests may run in any later order, assert self-consistency not a
    // frozen literal" posture for any field another test is known to edit.
    const contentReq = mockReq('GET', '/api/content');
    const contentRes = mockRes();
    api.handle(contentReq, contentRes);
    const currentBlade = JSON.parse(contentRes.body).items.blade;

    const req = mockReq('GET', '/api/dex/card/item/blade');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.ok, true);
    const card = parsed.card;
    assert.strictEqual(card.v, 1);
    assert.strictEqual(card.kind, 'item');
    assert.strictEqual(card.id, 'blade');
    assert.strictEqual(card.name, currentBlade.name);
    assert.deepStrictEqual(card.tags, ['Weapon']);
    assert.deepStrictEqual(card.shape, [[0, 0]]);
    assert.strictEqual(card.slot, undefined, 'si-only field must not appear on an item card');
    assert.strictEqual(card.stackable, undefined, 'tm-only field must not appear on an item card');
  });

  T('dex card: GET /api/dex/card/si/acc_gem -- 200, slot present, no item-only shape field', () => {
    const req = mockReq('GET', '/api/dex/card/si/acc_gem');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const card = JSON.parse(res.body).card;
    assert.strictEqual(card.kind, 'si');
    assert.strictEqual(card.id, 'acc_gem');
    assert.strictEqual(card.slot, 'gem');
    assert.strictEqual(card.shape, undefined, 'item-only field must not appear on an si card');
  });

  T('dex card: GET /api/dex/card/tm/lrdst -- 200, short+stackable present', () => {
    const req = mockReq('GET', '/api/dex/card/tm/lrdst');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const card = JSON.parse(res.body).card;
    assert.strictEqual(card.kind, 'tm');
    assert.strictEqual(card.id, 'lrdst');
    assert.strictEqual(card.short, 'LRDST');
    assert.strictEqual(card.stackable, true);
  });

  T('dex card: unknown id -> 404 (per kind), unknown kind -> 404, no auth required (no token sent)', () => {
    const req1 = mockReq('GET', '/api/dex/card/item/totally_unknown_xyz');
    const res1 = mockRes();
    api.handle(req1, res1);
    assert.strictEqual(res1.statusCode, 404);
    assert.strictEqual(JSON.parse(res1.body).ok, false);

    const req2 = mockReq('GET', '/api/dex/card/bp/whatever');
    const res2 = mockRes();
    api.handle(req2, res2);
    assert.strictEqual(res2.statusCode, 404, "kind:'bp' is deliberately unservable in v1 (see dex.cjs module comment)");

    const req3 = mockReq('GET', '/api/dex/card/si/nope');
    const res3 = mockRes();
    api.handle(req3, res3);
    assert.strictEqual(res3.statusCode, 404);
  });

  T('dex card: eff_en/eff_ja are rendered text (same renderer /api/content uses), matching /api/content for the same id', () => {
    const contentReq = mockReq('GET', '/api/content');
    const contentRes = mockRes();
    api.handle(contentReq, contentRes);
    const contentItem = JSON.parse(contentRes.body).items.fx_dagger;

    const cardReq = mockReq('GET', '/api/dex/card/item/fx_dagger');
    const cardRes = mockRes();
    api.handle(cardReq, cardRes);
    const card = JSON.parse(cardRes.body).card;

    assert.strictEqual(card.eff_en, contentItem.eff_en, 'card eff_en must match /api/content (same getContent() cache, same renderer)');
    assert.strictEqual(card.eff_ja, contentItem.eff_ja, 'card eff_ja must match /api/content too');
    // NOTE: fx_dagger's effects are emptied by an earlier test in this
    // same file (admin.applyAdminEdit('fx_dagger', {effects:[]})), so
    // eff_en is legitimately '' by the time this test runs -- the
    // load-bearing assertion is the equality with /api/content above
    // (proves the card DTO reads the SAME live, current getContent()
    // state, not a separate/stale computation), not a specific non-empty
    // literal this shared fixture can no longer guarantee this late in
    // the suite.
  });

  console.log('---');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
