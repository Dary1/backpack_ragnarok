// backpack_ragnarok — server/tests/api_test.cjs
// REQ-0024: storage round-trip + content endpoint shape + profile PUT/GET + oversized body.
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

// ---- storage.cjs tests: redirect os.homedir() before first require ----
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test-'));
const realHomedir = os.homedir;
os.homedir = () => tmpHome;
const storage = require('../storage.cjs');

T('storage: writeProfile is atomic (no leftover tmp file) and round-trips with schema_version', () => {
  const doc = storage.writeProfile('default', { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(doc.schema_version, storage.SCHEMA_VERSION, 'schema_version present');
  const entries = fs.readdirSync(storage.DATA_DIR);
  const tmpLeft = entries.filter((f) => f.includes('.tmp'));
  assert.strictEqual(tmpLeft.length, 0, 'no leftover tmp files: ' + JSON.stringify(entries));
  const read = storage.readProfile('default');
  assert.deepStrictEqual(read.canvas, { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(read.schema_version, storage.SCHEMA_VERSION);
});

T('storage: unknown profile id rejected on read and write (fixed allowlist)', () => {
  assert.throws(() => storage.readProfile('nope'), /unknown profile id/);
  assert.throws(() => storage.writeProfile('nope', {}), /unknown profile id/);
});

T('storage: oversized payload rejected before write (64KB cap)', () => {
  const big = { blob: 'x'.repeat(storage.MAX_BODY_BYTES + 1000) };
  assert.throws(() => storage.writeProfile('default', big), /size cap/);
});

T('storage: readProfile returns null when no file exists yet', () => {
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test2-'));
  os.homedir = () => otherHome;
  delete require.cache[require.resolve('../storage.cjs')];
  const storage2 = require('../storage.cjs');
  assert.strictEqual(storage2.readProfile('default'), null);
  os.homedir = () => tmpHome;
  delete require.cache[require.resolve('../storage.cjs')];
  require('../storage.cjs'); // restore module cache to the tmpHome-bound instance
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
delete require.cache[require.resolve('../storage.cjs')];
delete require.cache[require.resolve('../admin.cjs')];
delete require.cache[require.resolve('../api.cjs')];
const api = require('../api.cjs');
const admin = require('../admin.cjs');

// dev_user.json fixture (REQ-0035): a normal admin user, for /api/me and
// admin-auth happy-path tests below. A role-less variant is written
// on-demand inside the specific 403 test that needs it, then restored.
const configDir = path.join(repoRoot, 'data', 'config');
fs.mkdirSync(configDir, { recursive: true });
const devUserPath = path.join(configDir, 'dev_user.json');
fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));

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

// ---- REQ-0035: /api/me + admin write endpoint tests ----

T('api: GET /api/me returns the dev_user.json shape', () => {
  const req = mockReq('GET', '/api/me');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.playerId, 'dev');
  assert.strictEqual(parsed.name, 'Developer');
  assert.deepStrictEqual(parsed.roles, ['item_admin']);
});

T('admin: isItemAdmin true for the fixture dev user, false for unknown/missing ids', () => {
  assert.strictEqual(admin.isItemAdmin('dev'), true);
  assert.strictEqual(admin.isItemAdmin('nope'), false);
  assert.strictEqual(admin.isItemAdmin(undefined), false);
  assert.strictEqual(admin.isItemAdmin(''), false);
});

T('admin: findLiveEntry resolves POs and SIs, rejects unknown ids (draft/staging-equivalent)', () => {
  const foundItem = admin.findLiveEntry('blade');
  assert.ok(foundItem && foundItem.kind === 'item');
  const foundSi = admin.findLiveEntry('acc_gem');
  assert.ok(foundSi && foundSi.kind === 'si');
  assert.strictEqual(admin.findLiveEntry('not_a_real_id_and_not_staged'), null);
});

T('admin: applyAdminEdit rejects an id not found in live_items/live_sis (draft/staging-equivalent)', () => {
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
  await AT('api: PUT then GET /api/profile/default/canvas round-trips', async () => {
    await new Promise((resolve, reject) => {
      const putReq = mockReq('PUT', '/api/profile/default/canvas', JSON.stringify({ pos: [{ uid: 'y' }] }));
      const putRes = mockRes((body) => {
        try {
          assert.strictEqual(putRes.statusCode, 200, 'PUT status: ' + body);
        } catch (e) { reject(e); return; }
        const getReq = mockReq('GET', '/api/profile/default/canvas');
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
      const req = mockReq('PUT', '/api/profile/default/canvas', big);
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 413, 'expected 413 got ' + res.statusCode);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  // ---- REQ-0035: PUT /api/admin/item/:id via the real HTTP handler ----

  await AT('api: PUT /api/admin/item/:id returns 403 when X-Player-Id header is missing', async () => {
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
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when X-Player-Id references a non-admin user', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), { 'x-player-id': 'someone_else' });
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when the known user lacks the item_admin role', async () => {
    // Temporarily swap dev_user.json to a role-less variant, restore after.
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: [] }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), { 'x-player-id': 'dev' });
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

  await AT('api: PUT /api/admin/item/:id returns 404 for an id not in live_items/live_sis', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/nonexistent_item', JSON.stringify({ name: 'X' }), { 'x-player-id': 'dev' });
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 404, 'expected 404 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id happy path (200, persists, cache invalidates via mtime)', async () => {
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
        { 'x-player-id': 'dev' }
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

    delete require.cache[require.resolve('../admin.cjs')];
    delete require.cache[require.resolve('../storage.cjs')];
    delete require.cache[require.resolve('../api.cjs')];
    const realApi = require('../api.cjs');

    try {
      // Pick a real live item id and confirm current name via the real admin module.
      const realAdmin = require('../admin.cjs');
      const found = realAdmin.findLiveEntry('dagger');
      assert.ok(found, 'fixture item "dagger" must exist in the real content/live/live_items.json');
      const originalName = found.doc.entries[found.index].name;

      await new Promise((resolve, reject) => {
        const req = mockReq(
          'PUT',
          '/api/admin/item/dagger',
          JSON.stringify({ name: originalName + ' (test-edit)' }),
          { 'x-player-id': 'dev' }
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
