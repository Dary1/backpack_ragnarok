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

T('api: GET /api/content serves monsters + monster_skills from the authority path (REQ-0208)', () => {
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.monsters, 'monsters section present');
  const slime = parsed.monsters.weak_slime;
  assert.ok(slime, 'fixture monster weak_slime served');
  assert.deepStrictEqual(slime.hp, [1, 1], 'hp band served verbatim');
  assert.deepStrictEqual(slime.footprint, [1, 1], 'footprint served verbatim');
  assert.deepStrictEqual(slime.skills, ['slime_bite'], 'skill ids served verbatim');
  // monster_skills: LIMITED to skills referenced by served monsters, reshaped
  // {name, name_ja} off core's skillNamesById display-name sibling map.
  assert.ok(parsed.monster_skills, 'monster_skills section present');
  assert.ok(parsed.monster_skills.slime_bite, 'referenced skill has a name entry');
  assert.strictEqual(parsed.monster_skills.slime_bite.name, 'Slime Bite');
});

T('api: GET /api/content serves gimics + gimic_skills from the authority path (REQ-0211)', () => {
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.gimics, 'gimics section present');
  const trap = parsed.gimics.trap_frost_deadfall;
  assert.ok(trap, 'fixture gimic trap_frost_deadfall served');
  assert.strictEqual(trap.behavior, 'trap', 'behavior discriminator served verbatim');
  assert.deepStrictEqual(trap.footprint, [1, 1], 'footprint served verbatim');
  assert.ok(parsed.gimics.chest_frostbound_cache, 'the treasure-box gimic is served');
  assert.strictEqual(parsed.gimics.chest_frostbound_cache.behavior, 'treasure');
  assert.ok(parsed.gimics.door_rimefast_stage1.behavior === 'hidden_door', 'hidden-door stage served');
  // gimic_skills: LIMITED to skills referenced by served gimics (a Dex lookup),
  // same posture as monster_skills. The fixture gimics carry no skills, so it is
  // present but empty -- the section shape is what matters here.
  assert.ok(parsed.gimic_skills && typeof parsed.gimic_skills === 'object', 'gimic_skills section present');
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

// REQ-0178: registry-first serving is byte-transparent under an EMPTY registry
// tier. On BOTH backends the api_test fixture seeds NO content_defs (files
// backend has no registry at all; the pg run's fixture namespace is empty), so
// every served item/si/tm must be the file entry and the payload must gain NO
// new fields (source accounting lives on the /api/content/dev/sources endpoint,
// never in the payload). This is the spec's files-backend byte-parity contract.
T('api: GET /api/content is byte-identical to the file payload under an empty registry (REQ-0178)', () => {
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  const parsed = JSON.parse(res.body);
  const file = require('../../lib/content.cjs').buildContentPayload();
  assert.strictEqual(JSON.stringify(parsed.items), JSON.stringify(file.items), 'items file-sourced (no registry override)');
  assert.strictEqual(JSON.stringify(parsed.sis), JSON.stringify(file.sis), 'sis file-sourced');
  assert.strictEqual(JSON.stringify(parsed.tms), JSON.stringify(file.tms), 'tms file-sourced');
  assert.strictEqual(parsed.content_sources, undefined, 'source accounting is NOT folded into the payload');
});
};
