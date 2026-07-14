// backpack_ragnarok -- server/tests/content_checks_dialect_test.cjs
// REQ-0161 gates G1/G2: the machine checks speak each schema's OWN dialect
// (ruling Q1 = Option A -- validators learn the dialect, live content/ is
// never edited to please a validator).
//
// The 2026-07-14c backfill left all 7 live monster_defs at overall FAIL:
// schema_vocab rejected enemy/1's lowercase rarity words and engine_types
// rejected its [lo,hi] hp ROLL RANGE -- both are enemy/1's documented
// conventions (monster_content_pipeline.md), so the checks were wrong, not the
// data. This file pins BOTH halves of the fix:
//   POSITIVE -- the 7 live enemy/1 entries now PASS with their data untouched.
//   HONESTY  -- a dialect is a spelling, never an excuse: unknown rarity words
//               and malformed/inverted/non-int/scalar-where-ranged fields STILL
//               FAIL, each naming its own check; and the enemy/1 dialect does
//               NOT leak into po/si/tm (which keep the verbatim vocab token and
//               scalar stats).
// DB-free (no storage, no DATABASE_URL): runChecks is a pure function of
// (kind, schema_ref, data).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const checks = require('../services/content_checks.cjs');

const REPO = path.join(__dirname, '..', '..');
const enemies = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'enemies.json'), 'utf8'));
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
// REQ-0160: skill/1 is the THIRD dialect, and dungeon/items.json is a second po/2 corpus.
const skills = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'skills.json'), 'utf8'));
const dungeonItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'items.json'), 'utf8'));
const SKILL_SCHEMA = skills.schema;             // 'skill/1'
const ENEMY_SCHEMA = enemies.schema;            // 'enemy/1' -- the def's schema_ref (set by the backfill)
const GOOD_ENEMY = enemies.entries[0];
const GOOD_PO = liveItems.entries.find((e) => e.effects && e.effects.length);
const PO_SCHEMA = liveItems.schema;             // 'po/2'

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function checkOf(r, name) { return r.checks.find((c) => c.name === name); }
/** the checks that actually ran and failed */
function failedNames(r) { return r.checks.filter((c) => c.applicable !== false && !c.ok).map((c) => c.name); }

console.log('== REQ-0161 content-check dialect tests ==');

// ---- dialect resolution -------------------------------------------------

T('dialect is keyed by schema_ref: enemy/1 -> enemy/1 dialect, anything else -> default', () => {
  assert.strictEqual(checks._dialectFor('enemy/1').name, 'enemy/1');
  assert.strictEqual(checks._dialectFor('po/2').name, 'default');
  assert.strictEqual(checks._dialectFor('content/vocab.json').name, 'default');
  assert.strictEqual(checks._dialectFor(undefined).name, 'default');
  assert.deepStrictEqual(checks._dialectFor('enemy/1').range_fields, ['hp']);
});

// ---- POSITIVE: the live corpus, data untouched ---------------------------

T('G2 all 7 live enemy/1 monster_defs PASS (lowercase rarity + [lo,hi] hp accepted, data as-shipped)', () => {
  assert.strictEqual(enemies.entries.length, 7, 'the live pilot batch is still 7 entries');
  for (const e of enemies.entries) {
    const r = checks.runChecks('monster_def', ENEMY_SCHEMA, e);
    assert.strictEqual(r.overall, 'PASS', e.id + ' -> ' + r.overall + ' (' + failedNames(r).join(',') + ': '
      + r.checks.filter((c) => !c.ok && c.applicable !== false).map((c) => c.detail).join(' | ') + ')');
    assert.strictEqual(r.dialect, 'enemy/1', e.id + ' checked under the enemy/1 dialect');
    assert.strictEqual(checkOf(r, 'integrate').applicable, false, 'integrate stays n/a for monsters (no canvas placement)');
  }
});

T('G2 the live corpus really does speak the dialect (lowercase rarity, ranged hp) -- the fix is not vacuous', () => {
  const rarities = new Set(enemies.entries.map((e) => e.rarity));
  assert.ok([...rarities].every((r) => typeof r === 'string' && r === r.toLowerCase()), 'every live rarity is lowercase');
  assert.ok(enemies.entries.every((e) => Array.isArray(e.hp) && e.hp.length === 2), 'every live hp is a [lo,hi] pair');
});

// ---- HONESTY: real breakage still FAILs, naming its own check ------------

T('G2 negative: an unknown rarity word still FAILs schema_vocab (enemy/1)', () => {
  const bad = clone(GOOD_ENEMY);
  bad.rarity = 'legendary'; // lowercase, but no such rarity in any dialect
  const r = checks.runChecks('monster_def', ENEMY_SCHEMA, bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab'], 'only schema_vocab flags it');
  assert.ok(/legendary/.test(checkOf(r, 'schema_vocab').detail), 'schema_vocab names the offending token');
});

T('G2 negative: a capitalized rarity in enemy/1 still FAILs (one spelling per schema; no mixed dialect)', () => {
  const bad = clone(GOOD_ENEMY);
  bad.rarity = 'Common'; // the po/si spelling, wrong for enemy/1
  const r = checks.runChecks('monster_def', ENEMY_SCHEMA, bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab']);
  assert.ok(/lowercase/.test(checkOf(r, 'schema_vocab').detail), 'the detail says which spelling enemy/1 expects');
});

T('G2 negative: an INVERTED hp range (lo>hi) still FAILs engine_types', () => {
  const bad = clone(GOOD_ENEMY);
  bad.hp = [45, 30];
  const r = checks.runChecks('monster_def', ENEMY_SCHEMA, bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['engine_types'], 'only engine_types flags it');
  assert.ok(/hp/.test(checkOf(r, 'engine_types').detail) && /lo<=hi/.test(checkOf(r, 'engine_types').detail));
});

T('G2 negative: a NON-INTEGER hp range still FAILs engine_types', () => {
  const bad = clone(GOOD_ENEMY);
  bad.hp = [30.5, 45];
  const r = checks.runChecks('monster_def', ENEMY_SCHEMA, bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['engine_types']);
  assert.ok(/integer range/.test(checkOf(r, 'engine_types').detail));
});

T('G2 negative: a MALFORMED hp (scalar / wrong arity / non-array) still FAILs engine_types in enemy/1', () => {
  for (const hp of [30, [30], [30, 40, 50], 'lots', null]) {
    const bad = clone(GOOD_ENEMY);
    bad.hp = hp;
    const r = checks.runChecks('monster_def', ENEMY_SCHEMA, bad);
    assert.strictEqual(r.overall, 'FAIL', 'hp=' + JSON.stringify(hp) + ' must FAIL under enemy/1');
    assert.deepStrictEqual(failedNames(r), ['engine_types'], 'hp=' + JSON.stringify(hp) + ' -> engine_types');
  }
});

// ---- NO LEAKAGE: the other dialects are exactly as they were -------------

T('G1 po/2 is untouched: the live po still PASSes under the default dialect', () => {
  const r = checks.runChecks('po_def', PO_SCHEMA, GOOD_PO);
  assert.strictEqual(r.overall, 'PASS', 'known-good po_def still PASSes (' + failedNames(r).join(',') + ')');
  assert.strictEqual(r.dialect, 'default');
});

T('G1 the enemy/1 spelling does NOT leak: a lowercase rarity on a po_def still FAILs schema_vocab', () => {
  const bad = clone(GOOD_PO);
  bad.rarity = 'common'; // legal in enemy/1, illegal in po/2
  const r = checks.runChecks('po_def', PO_SCHEMA, bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(!checkOf(r, 'schema_vocab').ok, 'schema_vocab flags the wrong-dialect token');
  assert.ok(/verbatim/.test(checkOf(r, 'schema_vocab').detail), 'the detail says po/2 wants the verbatim token');
});

T('G1 the dialect follows schema_ref, not kind: a monster_def declared under a non-enemy schema keeps scalar hp', () => {
  const rangeHp = checks.runChecks('monster_def', 'content/vocab.json', clone(GOOD_ENEMY));
  assert.strictEqual(rangeHp.dialect, 'default');
  assert.ok(!checkOf(rangeHp, 'engine_types').ok, '[lo,hi] hp is NOT valid outside the enemy/1 dialect');
  const scalar = clone(GOOD_ENEMY);
  scalar.hp = 30;
  scalar.rarity = 'Common'; // default dialect -> verbatim vocab token
  const r = checks.runChecks('monster_def', 'content/vocab.json', scalar);
  assert.strictEqual(r.overall, 'PASS', 'scalar hp + verbatim rarity PASS under the default dialect');
});

// ---- REQ-0160: the skill/1 dialect + skill_def applicability ------------
//
// Ruling Q2-sub (user, 2026-07-14): skill_def is NOT waved through. schema_vocab
// APPLIES to it (checkEffects reused via a single pseudo-effect, domain
// EnemySkill); engine_types / gen_data / integrate are recorded honestly as
// applicable:false. Same honesty doctrine as REQ-0161: a dialect is a spelling,
// never an excuse -- a skill that names a verb the vocab does not have still FAILs.

console.log('== REQ-0160 skill/1 dialect + skill_def applicability ==');

T('dialect resolution: skill/1 -> skill/1 dialect (name spelled name_en); po/2 is untouched', () => {
  assert.strictEqual(checks._dialectFor(SKILL_SCHEMA).name, 'skill/1');
  assert.strictEqual(checks._dialectFor(SKILL_SCHEMA).name_field, 'name_en');
  assert.strictEqual(checks._dialectFor('po/2').name, 'default', 'skill/1 must not leak into po/2');
});

T('POSITIVE: all 14 live skill/1 entries PASS with their data untouched', () => {
  assert.strictEqual(skills.entries.length, 14, 'the live skill corpus is 14 entries');
  for (const s of skills.entries) {
    const r = checks.runChecks('skill_def', SKILL_SCHEMA, clone(s));
    assert.strictEqual(r.dialect, 'skill/1');
    assert.deepStrictEqual(failedNames(r), [], s.id + ' must PASS (failed: ' + failedNames(r).join(',') + ')');
    assert.strictEqual(r.overall, 'PASS', s.id + ' overall PASS');
  }
});

T('APPLICABILITY: schema_vocab RUNS on skill_def; engine_types/gen_data/integrate are honestly n/a', () => {
  const r = checks.runChecks('skill_def', SKILL_SCHEMA, clone(skills.entries[0]));
  const sv = checkOf(r, 'schema_vocab');
  assert.strictEqual(sv.applicable, true, 'schema_vocab APPLIES -- the ruling refused a fake applicable:false');
  assert.strictEqual(sv.ok, true);
  for (const n of ['engine_types', 'gen_data', 'integrate']) {
    assert.strictEqual(checkOf(r, n).applicable, false, n + ' is not applicable to skill/1');
    assert.ok(/not applicable/.test(checkOf(r, n).detail), n + ' says WHY it is n/a');
  }
  assert.strictEqual(r.overall, 'PASS', 'PASS = the one applicable check passed (n/a checks never fake a pass)');
});

T('HONESTY: a skill naming a verb/status/trigger the vocab lacks still FAILs schema_vocab', () => {
  const badVerb = clone(skills.entries[0]);
  badVerb.verb = { t: 'obliterate', n: [1, 2] };
  assert.deepStrictEqual(failedNames(checks.runChecks('skill_def', SKILL_SCHEMA, badVerb)), ['schema_vocab'],
    'an invented verb FAILs, and it is schema_vocab that says so');

  const badDomain = clone(skills.entries[0]);
  badDomain.trigger = { t: 'adjacent' }; // vocab.trigger_domains: PO only, never EnemySkill
  assert.deepStrictEqual(failedNames(checks.runChecks('skill_def', SKILL_SCHEMA, badDomain)), ['schema_vocab'],
    'a trigger illegal in the EnemySkill domain FAILs');

  const noName = clone(skills.entries[0]);
  delete noName.name_en;
  const r = checks.runChecks('skill_def', SKILL_SCHEMA, noName);
  assert.deepStrictEqual(failedNames(r), ['schema_vocab']);
  assert.ok(/name_en/.test(checkOf(r, 'schema_vocab').detail), 'the error names the field the DIALECT expects');

  const noVerb = clone(skills.entries[0]);
  delete noVerb.verb;
  assert.deepStrictEqual(failedNames(checks.runChecks('skill_def', SKILL_SCHEMA, noVerb)), ['schema_vocab'],
    'a skill with no verb at all FAILs');
});

T('NO LEAK: skill/1 name_en spelling does not leak into po/2 (a PO still needs `name`)', () => {
  const po = clone(GOOD_PO);
  delete po.name;
  po.name_en = 'Longsword Blade';
  const r = checks.runChecks('po_def', PO_SCHEMA, po);
  assert.ok(!checkOf(r, 'schema_vocab').ok, 'po/2 keeps `name`; name_en is no substitute');
  assert.ok(/name \(non-empty string\) required/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0160 Q1: the 2 live dungeon-mode POs PASS all four checks as po_def (the measured basis of the ruling)', () => {
  assert.strictEqual(dungeonItems.entries.length, 2, 'the dungeon PO corpus is 2 entries');
  assert.strictEqual(dungeonItems.schema, 'po/2', 'same schema as live_items.json -- the whole reason they are po_defs');
  for (const it of dungeonItems.entries) {
    const r = checks.runChecks('po_def', dungeonItems.schema, clone(it));
    assert.deepStrictEqual(failedNames(r), [], it.id + ' must PASS (failed: ' + failedNames(r).join(',') + ')');
    assert.strictEqual(r.overall, 'PASS', it.id + ' overall PASS -- importing it adds no red FAIL to the admin');
  }
});

console.log('\n== REQ-0161/0160 dialect: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);
