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

console.log('\n== REQ-0161 dialect: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);
