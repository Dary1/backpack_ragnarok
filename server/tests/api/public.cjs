'use strict';
// server/tests/api/public.cjs -- REQ-0145a (sf): the public no-auth
// surface (GET /api/health, GET /api/content shape + server-side
// eff_en/eff_ja rendering). Cut VERBATIM from server/tests/api_test.cjs
// origin lines 341-398 @ commit 46cd881. Synchronous tests; runs right
// after harness.boot(), exactly where they sat in the monolith.
module.exports.runSync = function runSync(h) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { T, AT, api, admin, playersFixture, players, storage, mockReq, mockRes,
    authHeaders, guestA, guestB, adminGuest, devPlayer, devUserPath, configDir,
    evictServerModuleTree, evictStorageAndPlayers, tmpHome, realHomedir,
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir, fixtureLiveDungeonDir } = h;

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
  const { render } = require('../../../tools/eff_render.cjs');
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
};
