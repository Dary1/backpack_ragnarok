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
  assert.strictEqual(Object.keys(parsed.items).length, 2, 'two items in fixture (blade + fx_dagger)');
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
