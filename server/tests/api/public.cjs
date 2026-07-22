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

T('api: GET /api/content serves unit_skins from the authority path, keyed by SKIN id (REQ-0266)', () => {
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.unit_skins, 'unit_skins section present');
  const portrait = parsed.unit_skins.uskin_test_queen;
  const bp = parsed.unit_skins.uskin_bp_test_queen;
  assert.ok(portrait && bp, 'both fixture skins served');
  // D1: ONE kind, and `slot` is what makes it mean two things. Both live in the
  // same section, keyed by their own id -- never by unit id, and never by
  // <unit>@<skin> (D-A: /api/content is public and warm-cached, so it can carry
  // no per-player state at all).
  assert.strictEqual(portrait.slot, 'unit', 'the portrait skin declares slot=unit');
  assert.strictEqual(bp.slot, 'bpskin', 'the BP skin declares slot=bpskin');
  assert.deepStrictEqual(portrait.units, ['test_queen'], 'units[] served verbatim (an ARRAY, D3)');
  assert.strictEqual(portrait.art_ref, 'art:test_queen', 'art_ref served verbatim (a FREE artwork reference)');
  assert.strictEqual(portrait.default, true, 'the default flag is what the fall-back rung reads');
  assert.strictEqual(portrait.name_ja, '\u30c6\u30b9\u30c8\u30af\u30a4\u30fc\u30f3 \u2014 \u8096\u50cf',
    'withBackCompatI18n applied at the display seam, exactly as for every other section');
  assert.strictEqual(parsed.units.test_queen && parsed.units.test_queen.id, 'test_queen',
    'the unit defs section is untouched -- a skin REFERENCES a unit, it does not replace one');
});

T('api: /api/content art_urls -- unit_skin ids join the batch, unit ids do NOT (REQ-0266 D-A / REQ-0226 stays closed)', () => {
  const content = require('../../lib/content.cjs');
  // artUrlNameBatch() is the PURE half of computeArtUrls: which ids are offered
  // to the resolver. That is the whole of the D-A wiring, and it is observable
  // without a database -- unlike WHETHER an id resolves, which is pg-only (see
  // tools/ci.sh's SERVING-MODE COVERAGE MAP: in files mode the registry is empty
  // BY DESIGN, so art_urls is {} and a "resolves" assertion here would be vacuous).
  const batch = content.artUrlNameBatch();
  assert.ok(batch.includes('uskin_test_queen'), 'the portrait skin id is offered to the art resolver');
  assert.ok(batch.includes('uskin_bp_test_queen'), 'the BP skin id is offered to the art resolver');
  assert.ok(!batch.includes('test_queen'), 'UNIT ids stay absent from art_urls -- REQ-0226 is a separate, still-open change');
  assert.ok(batch.includes('blade'), 'the pre-existing po/si/tm batch is unchanged');
  // REQ-0280 / REQ-0264 s11.5: a vfx asset has NO content def and NO id namespace,
  // so it is NEVER offered to the art resolver -- it is served DIRECTLY at
  // /api/art/<system_name>.png. Adopting vfx_* can therefore never leak into art_urls.
  assert.ok(!batch.some((n) => String(n).startsWith('vfx_')), 'vfx names never enter the art_urls batch (direct-serve only)');
  // The omission half of the contract, which files mode CAN prove: a skin whose
  // artwork has no adopted render is simply not in the map. The client then falls
  // back -- an unresolved skin never blanks anything.
  const req = mockReq('GET', '/api/content');
  const res = mockRes();
  api.handle(req, res);
  const parsed = JSON.parse(res.body);
  const urls = parsed.art_urls || {};
  assert.strictEqual(urls.uskin_test_queen, undefined, 'no adopted artwork -> the skin id is OMITTED from art_urls');
  assert.strictEqual(urls.uskin_bp_test_queen, undefined, 'same for the BP skin');
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
