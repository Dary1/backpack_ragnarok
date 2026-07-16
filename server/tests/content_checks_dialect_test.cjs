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
// REQ-0184: monster_pack/1 is the FOURTH dialect -- a composition of monsters and
// WHERE each stands. Its rules are geometry + references, not vocab words.
const monsterPacks = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'packs.json'), 'utf8'));
const PACK_SCHEMA = monsterPacks.schema;        // 'monster_pack/1'
const GOOD_MPACK = monsterPacks.entries[0]; // NOT GOOD_PACK -- that is REQ-0171's GACHA pack fixture below
const mpackClone = () => JSON.parse(JSON.stringify(GOOD_MPACK));
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



// =====================================================================
// REQ-0171: gacha_pack -- the checks that make a pool trustworthy.
//
// A pack's closed vocabulary is not vocab.json, it is THE LIVE UNIT ROSTER. The
// single most dangerous thing a pack can contain is a pool row naming a unit that
// does not exist: the roll would either crash or silently drop it, and no other
// check in the chain would ever say so. These pin that, plus the runtime field
// types gacha.cjs actually dereferences.
// =====================================================================
const GOOD_PACK = {
  id: 'test_pack',
  name: 'Test Pack',
  cost: 10,
  cost_tm: 'lrdst',
  cells: [6, 8],
  hp_per_cell: 15,
  pool: [{ unit: 'elf', weight: 1 }, { unit: 'dwarf', weight: 3 }],
  i18n: { ja: { name: 'テストパック' } },
};

T('REQ-0171 gacha_pack: a well-formed pack PASSES all applicable checks', () => {
  const r = checks.runChecks('gacha_pack', 'gacha_pack/1', clone(GOOD_PACK));
  assert.strictEqual(r.overall, 'PASS', JSON.stringify(r.checks));
  const integrate = r.checks.find((c) => c.name === 'integrate');
  assert.strictEqual(integrate.applicable, false, 'a pack places nothing on a canvas -- integrate is honestly not applicable');
  const et = r.checks.find((c) => c.name === 'engine_types');
  assert.strictEqual(et.applicable !== false, true, 'engine_types DOES apply: gacha.cjs consumes cost/cells/hp_per_cell/pool');
});

T('REQ-0171 gacha_pack: a pool row naming a unit with NO live def FAILS (the whole point of the kind)', () => {
  const bad = clone(GOOD_PACK);
  bad.pool.push({ unit: 'necromancer', weight: 1 }); // cut from the roster (REQ-0149 G7)
  const r = checks.runChecks('gacha_pack', 'gacha_pack/1', bad);
  assert.strictEqual(r.overall, 'FAIL');
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(/necromancer/.test(sv.detail), 'the failure names the unit that does not exist: ' + sv.detail);
});

T('REQ-0171 gacha_pack: a non-positive weight FAILS (a zero-weight row can never drop, and pretending otherwise is the lie)', () => {
  const bad = clone(GOOD_PACK);
  bad.pool[0].weight = 0;
  const r = checks.runChecks('gacha_pack', 'gacha_pack/1', bad);
  assert.strictEqual(r.overall, 'FAIL');
});

T('REQ-0171 gacha_pack: cost as a STRING fails engine_types (gacha.cjs would price the roll with "10")', () => {
  const bad = clone(GOOD_PACK);
  bad.cost = '10';
  const r = checks.runChecks('gacha_pack', 'gacha_pack/1', bad);
  const et = r.checks.find((c) => c.name === 'engine_types');
  assert.strictEqual(et.ok, false, et.detail);
});

T('REQ-0171 gacha_pack: an unknown cost_tm FAILS -- a pack priced in a currency that does not exist is unbuyable', () => {
  const bad = clone(GOOD_PACK);
  bad.cost_tm = 'gold';
  const r = checks.runChecks('gacha_pack', 'gacha_pack/1', bad);
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.strictEqual(sv.ok, false, sv.detail);
});

T('REQ-0171 gacha_pack: the THREE LIVE packs pass -- the measured basis for putting them in the ledger', () => {
  const packs = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_packs.json'), 'utf8'));
  for (const e of packs.entries) {
    const r = checks.runChecks('gacha_pack', 'gacha_pack/1', clone(e));
    assert.strictEqual(r.overall, 'PASS', e.id + ': ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  }
  assert.ok(packs.entries.length >= 1);
});

T('REQ-0171 unit_def: the 12 LIVE roster defs pass all applicable checks', () => {
  const units = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_units.json'), 'utf8'));
  assert.strictEqual(units.entries.length, 12, 'roster 001 is 12 units');
  for (const e of units.entries) {
    const r = checks.runChecks('unit_def', 'unit/1', clone(e));
    assert.strictEqual(r.overall, 'PASS', e.id + ': ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  }
});

// =====================================================================
// REQ-0184 gate G2: the monster_pack/1 machine checks.
//
// A pack's closed vocabulary is the LIVE MONSTER ROSTER plus the field's own
// geometry, and BOTH rules are the ones sim/lib/packs.cjs actually places from
// (shared/content_validate.cjs validateMonsterPackEntry, reused not re-copied).
// So these tests pin something sharper than "the checker is strict": they pin
// that the checker and the PLACER agree. A layout the admin blesses is a layout
// the sim will honour, cell for cell.
// =====================================================================

T('REQ-0184 positive: every live monster_pack/1 entry PASSes with its data untouched', () => {
  for (const pack of monsterPacks.entries) {
    const r = checks.runChecks('monster_pack', PACK_SCHEMA, pack);
    assert.strictEqual(r.overall, 'PASS', pack.id + ' must PASS, got ' + r.overall + ': ' + JSON.stringify(r.checks));
  }
});

T('REQ-0184 honesty: an anchor in the MARGIN fails schema_vocab BY NAME (the bug this REQ found)', () => {
  const p = mpackClone();
  p.members[0].at = 'A1'; // exactly where every pack stood before this REQ
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  assert.strictEqual(r.overall, 'FAIL', 'a margin anchor must FAIL');
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(!sv.ok, 'schema_vocab is the check that must own this');
  assert.ok(/outside the placeable area B2:Y17/.test(sv.detail), 'the error must name the placeable area, got: ' + sv.detail);
});

T('REQ-0184 honesty: a footprint that OVERRUNS the edge fails, not just the anchor', () => {
  const p = mpackClone();
  p.members = [{ enemy: 'frostback_bear', at: 'Y17' }]; // anchor is legal; its 2x2 is not
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  assert.strictEqual(r.overall, 'FAIL', 'an overrunning footprint must FAIL');
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(/outside the placeable area/.test(sv.detail), 'must name the bound, got: ' + sv.detail);
});

T('REQ-0184 honesty: two members on one cell FAIL, and the error names BOTH', () => {
  const p = mpackClone();
  p.members = [{ enemy: 'frostback_bear', at: 'B2' }, { enemy: 'frost_gnoll', at: 'C3' }]; // inside the bear 2x2
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  assert.strictEqual(r.overall, 'FAIL', 'overlap must FAIL');
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(/overlaps/.test(sv.detail), 'must say overlaps: ' + sv.detail);
  assert.ok(/frostback_bear/.test(sv.detail) && /frost_gnoll/.test(sv.detail), 'must name BOTH sides: ' + sv.detail);
});

T('REQ-0184 honesty: a member naming a monster with no live def FAILs by name', () => {
  const p = mpackClone();
  p.members[0].enemy = 'no_such_monster';
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  assert.strictEqual(r.overall, 'FAIL', 'a dangling monster reference must FAIL');
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(/no_such_monster/.test(sv.detail) && /no live def/.test(sv.detail), 'must name it: ' + sv.detail);
});

T('REQ-0184 honesty: a malformed A1 token FAILs (never silently parsed)', () => {
  for (const bad of ['AA1', 'B0', '5', 'b2', '']) {
    const p = mpackClone();
    p.members[0].at = bad;
    const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
    assert.strictEqual(r.overall, 'FAIL', JSON.stringify(bad) + ' must FAIL');
  }
});

T('REQ-0184 engine_types APPLIES to monster_pack (packs.cjs really dereferences the layout)', () => {
  const p = mpackClone();
  p.members[0].at = 42; // a number where the placer calls parseA1
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  const et = r.checks.find((c) => c.name === 'engine_types');
  assert.notStrictEqual(et.applicable, false, 'engine_types must APPLY to monster_pack, unlike skill_def');
  assert.ok(!et.ok, 'a non-string `at` must fail engine_types');
});

T('REQ-0184 honesty: gen_data/integrate are applicable:false for monster_pack, not a free PASS', () => {
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, mpackClone());
  for (const name of ['gen_data', 'integrate']) {
    const c = r.checks.find((x) => x.name === name);
    assert.strictEqual(c.applicable, false, name + ' must be recorded as not-applicable, not as a green PASS');
  }
});

T('REQ-0184 the CHECKER and the PLACER agree: blessed layout == where the sim puts them', () => {
  // The whole point of reusing validateMonsterPackEntry. If these two ever
  // disagree, the admin blesses one board and the player fights another.
  const combat = require('../../sim/combat.cjs');
  const { compileEnemyPack } = require('../../sim/lib/packs.cjs');
  const v = require('../../shared/content_validate.cjs');
  const enemyDefs = {};
  for (const e of enemies.entries) enemyDefs[e.id] = e;
  const skillDefs = {};
  for (const sk of skills.entries) skillDefs[sk.id] = { trigger: sk.trigger, verb: sk.verb, attack_profile: sk.attack_profile, modes: sk.modes };
  for (const pack of monsterPacks.entries) {
    const r = checks.runChecks('monster_pack', PACK_SCHEMA, pack);
    assert.strictEqual(r.overall, 'PASS', pack.id + ' precondition');
    const compiled = compileEnemyPack(pack, enemyDefs, skillDefs, combat.makeRng('agree'), { rowMin: 2, colMin: 2, rowMax: 17, colMax: 25 });
    pack.members.forEach((m, i) => {
      const expected = v.cellsFor(v.parseA1(m.at), enemyDefs[m.enemy].footprint || [1, 1]);
      assert.deepStrictEqual(compiled[i].fieldCells, expected,
        pack.id + ' member ' + i + ' (' + m.enemy + '@' + m.at + '): the sim placed it somewhere the validator did not bless');
    });
  }
});

T('REQ-0184 the monster_pack dialect does NOT leak: po/si keep their own rules', () => {
  const r = checks.runChecks('po_def', PO_SCHEMA, GOOD_PO);
  assert.strictEqual(r.overall, 'PASS', 'a good po/2 must still PASS after the monster_pack dialect landed');
});

console.log('\n== REQ-0161/0160 dialect: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);
