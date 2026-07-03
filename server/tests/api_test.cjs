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
  version: 1, po_tags: { Weapon: null }, socket_tags: { gem: null },
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
delete require.cache[require.resolve('../api.cjs')];
const api = require('../api.cjs');

function mockReq(method, url, body) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
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
  assert.deepStrictEqual(parsed.trees.po, { Weapon: null });
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

  os.homedir = realHomedir;
  console.log('---');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
