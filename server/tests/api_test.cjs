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
fs.writeFileSync(path.join(liveDir, 'scenario.json'), JSON.stringify({
  layout: { ROWS: 6, COLS: 6 }, linked: true, bps: [], pos: [], sis: [],
}));

// REQ-0036 P1-B: minimal batch-002-dungeon-pilot-SHAPED fixture content
// (schedule.cjs's getScheduleContent() reads these exact paths). A tiny,
// fast, deterministic dungeon: one pack encounter (a single very-weak
// enemy so a real unit reliably wins in well under a second of sim-time,
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

os.homedir = () => fakeRepoHome;
delete require.cache[require.resolve('../players.cjs')];
delete require.cache[require.resolve('../storage.cjs')];
delete require.cache[require.resolve('../admin.cjs')];
delete require.cache[require.resolve('../api.cjs')];
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

  // Builds a fresh, internally-independent profile canvas: 4 presets
  // (indices 0-3), each with ITS OWN uniquely-tagged BP + a placed
  // 'test_sword' PO wired to attack (every_secs strike, see the
  // live_items.json fixture above) so a real sim run reliably kills the
  // 1hp weak_slime fixture enemy fast. Every uid across all 4 presets is
  // globally unique (tagged by preset index) so isUnitIndependent() is
  // true for every one of them against each other -- tests that need an
  // independence VIOLATION deliberately clone one preset's uids into
  // another below.
  function makeTestCanvas() {
    function presetCanvas(tag) {
      return {
        linked: true,
        bps: [{ id: 'bp_' + tag, name: 'BP ' + tag, color: '#888888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], linker: { off: [0, 0], dirs: [] }, hpMax: 40 }],
        pos: [{ uid: 'po_' + tag, id: 'test_sword', loc: 'grid', cell: [1, 1], rot: 0 }],
        sis: [],
      };
    }
    const p0 = presetCanvas('t0'), p1 = presetCanvas('t1'), p2 = presetCanvas('t2'), p3 = presetCanvas('t3');
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

  await AT('schedule: deploy gate -- assigning a preset that shares a uid with another of the caller\'s OWN presets is refused 409', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    // Make preset index 4 an EXACT duplicate of preset 0 -- guaranteed uid overlap.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const preset0Snapshot = { bps: doc.canvas.bps, pos: doc.canvas.pos, sis: doc.canvas.sis };
    doc.canvas.presets.store[4] = JSON.parse(JSON.stringify(preset0Snapshot));
    scheduleStorage.writeProfile(scheduleP1.playerId, doc.canvas);

    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { presetIndex: 0 });
    assert.strictEqual(res.status, 409, 'independence violation must be 409: ' + JSON.stringify(res.body));
    assert.ok(/independent/i.test(res.body.error));

    // Clean up: clear the duplicate so later tests' independence holds.
    const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
    doc2.canvas.presets.store[4] = null;
    scheduleStorage.writeProfile(scheduleP1.playerId, doc2.canvas);
  });

  await AT('schedule: deploy gate -- a preset already deployed in another of the caller\'s ACTIVE rooms is refused 409 on cross-room overlap', async () => {
    // Room X: fill all 4 slots with presets 0-3 and start its run (-> status 'active').
    const roomXRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomXId = roomXRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomXId + '/slots/' + i, scheduleP1.token, { presetIndex: i });
      assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign: ' + JSON.stringify(assignRes.body));
    }
    const roomXAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomXId, scheduleP1.token);
    assert.strictEqual(roomXAfter.body.room.status, 'active', 'room X must auto-start its first run once all 4 slots are filled');

    // Room Y: try to also deploy preset 0 (already active in room X) -> 409.
    const roomYRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomYId = roomYRes.body.room.id;
    const overlapRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomYId + '/slots/0', scheduleP1.token, { presetIndex: 0 });
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
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { presetIndex: i });

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
    // seed + same unit snapshots must reproduce the identical event log
    // (sim/combat.cjs's own documented determinism guarantee, exercised
    // here through the schedule service's actual persisted seed).
    const combat = require('../../sim/combat.cjs');
    const { itemDefsById, dungeonDef, enemyDefsById, skillDefsById } = schedule.getScheduleContent();
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const unitSnapshots = fillAllSlotsSnapshotsFrom(doc.canvas);
    const replay = combat.runDungeon({
      masterSeed: runRaw.seed, dungeonDef, unitSnapshots, itemDefsById, enemyDefsById, skillDefsById,
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
    assert.deepStrictEqual(replay.events, runRaw.events, 'same seed + same unit snapshots must reproduce a semantically-identical replay log');
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

  await AT('schedule: victory rewards land in the warehouse with a harvestedAt + 7-day expiresAt (golden e)', async () => {
    // Defensive: clear any warehouse items left by earlier tests in this
    // group (each of which is supposed to clean up after itself, but this
    // assertion cares about an EXACT count, so start from a known-empty slate).
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { presetIndex: i });
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
    assert.strictEqual(wh.body.items.length, 2, 'both encounters (pack + boss) award one reward item each in this fixture dungeon');
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

    // Wipe level-down: build a room whose units have ZERO attack (no
    // every_secs effect) against the same weak_slime -- with no damage
    // output, the pack's own deadline_secs will elapse into a wipe.
    // (weak_slime itself has no offense with s:[5,5] cadence and 1hp, so
    // this deliberately uses a non-attacking 'blade' preset instead of
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
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP2.token, { presetIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    const runRaw = scheduleStorage.readRun(roomAfter.body.room.lastRunId);
    assert.notStrictEqual(runRaw.result, 'victory', 'a zero-damage party must not win: got ' + runRaw.result);

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
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { presetIndex: i });
      assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign must succeed: ' + JSON.stringify(assignRes.body));
    }
    const active = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(active.body.room.status, 'active', 'precondition: room has a run in flight');

    const swapWhileActive = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 0, presetIndex: 1 });
    assert.strictEqual(swapWhileActive.status, 200);
    assert.strictEqual(swapWhileActive.body.applied, false, 'a swap requested mid-run must be QUEUED, not applied immediately');
    assert.ok(swapWhileActive.body.room.pendingSwap, 'pendingSwap must be recorded on the room');
    assert.strictEqual(swapWhileActive.body.room.slots[0].presetIndex, 0, 'the slot itself must NOT change yet');

    forceRunElapsed(active.body.room.lastRunId);
    const settled = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle + pending-swap application
    assert.strictEqual(settled.body.room.pendingSwap, null, 'pendingSwap must be cleared once applied');
    // Note: preset 1 shares NO uid with preset 0 in this fixture (both
    // independently tagged), so applying the swap must succeed legally.
    assert.strictEqual(settled.body.room.slots[0].presetIndex, 1, 'golden j: the swap applies AFTER the run ends');

    // Swap with NO run active applies immediately.
    const swapNow = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 1, presetIndex: 2 });
    assert.strictEqual(swapNow.body.applied, true, 'a swap requested with no active run must apply immediately');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: cancel policy -- immediate:true cancels right away; immediate:false with an active run only flags cancelRequested until settle (golden g)', async () => {
    // immediate: true
    const roomA = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: true } });
    const cancelA = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomA.body.room.id, scheduleP1.token);
    assert.strictEqual(cancelA.body.room.status, 'canceled', 'immediate:true must cancel right away');

    // immediate: false, WITH an active run -> flagged, not canceled yet.
    const roomB = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    const roomBId = roomB.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomBId + '/slots/' + i, scheduleP1.token, { presetIndex: i });
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

  await AT('schedule: assigning an out-of-range slot index or an out-of-range presetIndex is a 400, not a crash', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const badSlot = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/99', scheduleP1.token, { presetIndex: 0 });
    assert.strictEqual(badSlot.status, 400);
    const badPreset = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { presetIndex: 99 });
    assert.strictEqual(badPreset.status, 400);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: starting a run with an incomplete party (not all 4 slots filled) is refused, never silently runs a partial party', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { presetIndex: 0 });
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/1', scheduleP1.token, { presetIndex: 1 });
    // Only 2 of 4 slots filled -- room must stay 'open', no run started.
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'open', 'a room with an incomplete party must never auto-start a run');
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
    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 99, presetIndex: 0 });
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
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { presetIndex: i });
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
    // presets; reuse the exact same makeTestCanvas() shape scheduleP1/P2
    // already use, written directly to the dev player's own profile).
    scheduleStorage.writeProfile(devPlayer.playerId, makeTestCanvas());
    const devRoomRes = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(devRoomRes.status, 200, 'dev fallback must be able to create its own room: ' + JSON.stringify(devRoomRes.body));
    const devRoomId = devRoomRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const slotRes = await scheduleReq('PUT', '/api/schedule/rooms/' + devRoomId + '/slots/' + i, undefined, { presetIndex: i });
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

  os.homedir = realHomedir;

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

    delete require.cache[require.resolve('../players.cjs')];
    delete require.cache[require.resolve('../admin.cjs')];
    delete require.cache[require.resolve('../storage.cjs')];
    delete require.cache[require.resolve('../api.cjs')];
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

  console.log('---');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
