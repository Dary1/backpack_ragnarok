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
// REQ-0352 section 5: a VARIANT is the AUTHORED view -- powerLevel is derived
// (autobalance-owned, file-side only) and schema_vocab rejects a variant that
// carries it. Every variant-shaped fixture therefore starts authored; the raw
// file shape (with powerLevel) has its own dedicated REQ-0352 pin below.
const mpackClone = () => { const p = JSON.parse(JSON.stringify(GOOD_MPACK)); delete p.powerLevel; return p; };
const PO_SCHEMA = liveItems.schema;             // 'po/2'

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now();
  try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; }
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
  assert.ok(enemies.entries.length >= 7, 'the live pilot batch has at least its original 7 entries (REQ-0207: the live roster GROWS with additive deploys, e.g. batch-005)');
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
  assert.ok(skills.entries.length >= 14, 'the live skill corpus has at least its original 14 entries (REQ-0207: GROWS with additive deploys, e.g. batch-005)');
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
  assert.ok(units.entries.length >= 12, 'roster 001 has at least its original 12 units (REQ-0207: GROWS with roster deploys, e.g. units003)');
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

T('REQ-0184 positive: every live monster_pack/1 entry passes its schema_vocab + engine_types checks, data untouched (REQ-0300: overall may now be lowered by the SEPARATE formation_fill row -- pinned in the REQ-0300 block below)', () => {
  for (const pack of monsterPacks.entries) {
    // REQ-0352: the live FILE entry legitimately carries the derived
    // powerLevel; a VARIANT is the authored view. What this test guarantees is
    // that every live pack's AUTHORED CONTENT passes -- the shape the
    // reconcile re-port actually stores.
    const authored = Object.assign({}, pack); delete authored.powerLevel;
    const r = checks.runChecks('monster_pack', PACK_SCHEMA, authored);
    // REQ-0300 made `overall` additionally reflect the 30% formation-fill rule, so
    // a geometrically-perfect but sparse live pack now FAILs overall on fill. The
    // REQ-0184 guarantee is unchanged and pinned here AT THE CHECK LEVEL: the
    // geometry (schema_vocab) and member field types (engine_types) still pass for
    // every live pack with its data untouched.
    for (const name of ['schema_vocab', 'engine_types']) {
      const c = checkOf(r, name);
      assert.ok(c && c.ok, pack.id + ' -> ' + name + ' must PASS, got: ' + (c && c.detail));
    }
  }
});

T('REQ-0352 authorship: a variant carrying the derived powerLevel FAILs schema_vocab by name', () => {
  const p = mpackClone();
  p.powerLevel = 4.5769; // the raw live-file shape -- legal in the file, illegal in a variant
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, p);
  const sv = r.checks.find((c) => c.name === 'schema_vocab');
  assert.ok(sv && !sv.ok, 'an authored powerLevel must FAIL schema_vocab');
  assert.ok(/powerLevel must not be authored/.test(sv.detail), 'the error must name the rule, got: ' + sv.detail);
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
    const authored = Object.assign({}, pack); delete authored.powerLevel; // REQ-0352: check the variant shape
    const r = checks.runChecks('monster_pack', PACK_SCHEMA, authored);
    // REQ-0300: overall may be lowered by the formation_fill row; the placer
    // agreement depends only on the geometry being blessed, so pin schema_vocab.
    const sv = checkOf(r, 'schema_vocab');
    assert.ok(sv && sv.ok, pack.id + ' precondition: schema_vocab (the geometry the placer honours) must be valid; got ' + (sv && sv.detail));
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

// ============================================================
// REQ-0300: the 30% formation-fill rule as a live admincontent WARNING.
// A monster_pack whose formation fills < FILL_MIN (30%) of the placeable area
// gets a not-ok `formation_fill` runChecks row that LOWERS overall -- the same
// row the contentadmin UI already renders (no new UI). ADDITIVE: schema_vocab
// (geometry) and engine_types (member types) are untouched. gimic is a different
// KIND and never gets the row (naturally exempt, no per-pack flag). All DB-free.
// ============================================================

T('REQ-0300 a sparse monster_pack (< 30% fill) gets a not-ok formation_fill row that lowers overall', () => {
  // Synthetic and independent of any single live pack (robust to the pack-fix
  // REQ that will later fill the live packs): two 1x1 members = 2 of 384
  // placeable cells = 0.5%. The geometry is perfectly valid, so ONLY
  // formation_fill fails -- proving the fill rule is what lowers overall.
  const sparse = mpackClone();
  sparse.id = 'pack_req0300_sparse';
  sparse.members = [{ enemy: 'frost_gnoll', at: 'B2' }, { enemy: 'ice_archer', at: 'B4' }];
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, sparse);
  const ff = checkOf(r, 'formation_fill');
  assert.ok(ff, 'a monster_pack must carry a formation_fill row');
  assert.strictEqual(ff.applicable, true, 'formation_fill APPLIES to monster_pack');
  assert.strictEqual(ff.ok, false, 'a 0.5% pack must FAIL the fill rule: ' + ff.detail);
  assert.strictEqual(ff.detail,
    'formation fill 0.5% (2/384) < 30% minimum -- add monsters (boss packs: boss + entourage); gimic exempt',
    'the exact warning string a failing pack surfaces');
  // ADDITIVE: the geometry + type checks still PASS; ONLY fill lowered overall.
  assert.ok(checkOf(r, 'schema_vocab').ok, 'schema_vocab must still PASS (geometry is valid)');
  assert.ok(checkOf(r, 'engine_types').ok, 'engine_types must still PASS (member types valid)');
  assert.strictEqual(r.overall, 'FAIL', 'a not-ok formation_fill row must lower overall to FAIL');
});

T('REQ-0300 a >= 30% monster_pack does NOT warn (formation_fill ok, overall PASS)', () => {
  const full = mpackClone();
  full.id = 'pack_req0300_full';
  // two 8x8 members = 128 of 384 = 33.3%, non-overlapping and in the placeable area.
  full.members = [{ enemy: 'demon_lord', at: 'B2' }, { enemy: 'demon_lord', at: 'K2' }];
  const r = checks.runChecks('monster_pack', PACK_SCHEMA, full);
  const ff = checkOf(r, 'formation_fill');
  assert.ok(ff && ff.applicable === true && ff.ok, 'a 33.3% pack must PASS the fill rule: ' + (ff && ff.detail));
  assert.strictEqual(ff.detail, 'formation fill 33.3% (128/384) >= 30% minimum');
  assert.strictEqual(r.overall, 'PASS', 'a full, valid pack must PASS overall (failed: ' + failedNames(r).join(',') + ')');
});

T('REQ-0300 the FILL_MIN boundary is strict `<`: exactly 30% PASSES, just below FAILS', () => {
  // Pinned through the SAME row-builder runChecks uses, with a synthetic roster
  // + placeable count so the exact 30% boundary is constructible (the live field
  // is 384, where 30% is a non-integer cell count).
  const roster = { three: { footprint: [3, 1] }, one: { footprint: [1, 1] } };
  const atMin = checks._formationFillResult({ members: [{ enemy: 'three', at: 'B2' }] }, roster, 10); // 3/10 = 30.0%
  assert.ok(atMin.ok, 'exactly 30% must PASS (the rule is a strict <): ' + atMin.detail);
  assert.strictEqual(atMin.detail, 'formation fill 30.0% (3/10) >= 30% minimum');
  const below = checks._formationFillResult({ members: [{ enemy: 'one', at: 'B2' }, { enemy: 'one', at: 'B4' }] }, roster, 10); // 2/10 = 20%
  assert.ok(!below.ok, 'just below 30% must FAIL: ' + below.detail);
});

T('REQ-0300 gimic and every non-pack kind are naturally exempt (no formation_fill row at all)', () => {
  // gimic is a different KIND; it never reaches the monster_pack branch, so it
  // gets no formation_fill row -- exemption by construction, no per-pack flag.
  const rEnemy = checks.runChecks('monster_def', ENEMY_SCHEMA, GOOD_ENEMY);
  assert.strictEqual(checkOf(rEnemy, 'formation_fill'), undefined, 'monster_def gets no formation_fill row');
  const rPo = checks.runChecks('po_def', PO_SCHEMA, GOOD_PO);
  assert.strictEqual(checkOf(rPo, 'formation_fill'), undefined, 'po_def gets no formation_fill row');
  // and the exported check is honest if called directly for a non-pack kind.
  const direct = checks.formationFillCheck('gimic', { id: 'x' });
  assert.strictEqual(direct.applicable, false, 'formationFillCheck is applicable:false for gimic');
});

// ============================================================
// REQ-0211 gate: the gimic/1 machine checks (trap / treasure box / hidden door).
// The dialect is keyed by schema_ref 'gimic/1'; its rules live in
// shared/content_validate.cjs validateGimicEntry (the SAME definition the
// dungeon generator relies on). Skills are cross-checked against the LIVE roster.
// ============================================================
const gimics = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'gimics.json'), 'utf8'));
const GIMIC_SCHEMA = gimics.schema; // 'gimic/1'
const GOOD_GIMIC = gimics.entries.find((g) => g.behavior === 'trap'); // the trap: has a skill volley
const gimicClone = () => JSON.parse(JSON.stringify(GOOD_GIMIC));

T('REQ-0211 positive: every live gimic/1 entry PASSes with its data untouched', () => {
  for (const g of gimics.entries) {
    const r = checks.runChecks('gimic', GIMIC_SCHEMA, clone(g));
    assert.strictEqual(r.overall, 'PASS', g.id + ' should PASS: ' + failedNames(r).join(','));
  }
});

T('REQ-0211 negative: an unknown behavior FAILs schema_vocab BY NAME', () => {
  const g = gimicClone(); g.behavior = 'teleporter';
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, g);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/behavior must be one of/.test(checkOf(r, 'schema_vocab').detail), 'names the illegal behavior');
});

T('REQ-0211 negative: a behavior/mode mismatch FAILs (a trap cannot be an unlock)', () => {
  const g = gimicClone(); g.mode = 'unlock';
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, g);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/cannot use mode/.test(checkOf(r, 'schema_vocab').detail), 'rejects the incompatible mode');
});

T('REQ-0211 negative: a malformed footprint FAILs (schema_vocab + engine_types)', () => {
  const g = gimicClone(); g.footprint = [0, 2];
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, g);
  assert.strictEqual(r.overall, 'FAIL', 'a non-positive footprint dimension is refused');
});

T('REQ-0211 negative: a skill the live roster does not know FAILs schema_vocab BY NAME', () => {
  const g = gimicClone(); g.skills = ['ghost_volley_that_does_not_exist'];
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, g);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/no live def/.test(checkOf(r, 'schema_vocab').detail), 'names the missing skill');
});

T('REQ-0211 engine_types APPLIES to gimic (dungen dereferences footprint/hp/timeout/skills)', () => {
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, gimicClone());
  const et = checkOf(r, 'engine_types');
  assert.notStrictEqual(et.applicable, false, 'engine_types must APPLY to gimic, unlike skill_def');
  assert.strictEqual(et.ok, true);
});

T('REQ-0211 honesty: gen_data is applicable:false for gimic, not a free PASS', () => {
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, gimicClone());
  assert.strictEqual(checkOf(r, 'gen_data').applicable, false, 'tool_gen_data does not consume gimic/1');
});

T('REQ-0211 negative: engine_types catches a string where dungen wants a number (hp)', () => {
  const g = gimicClone(); g.hp = '1';
  const r = checks.runChecks('gimic', GIMIC_SCHEMA, g);
  assert.strictEqual(r.overall, 'FAIL', 'a string hp is a crash inside the generator, not a nit');
});

T('REQ-0211 the gimic dialect does NOT leak: a good po/2 still PASSes', () => {
  const r = checks.runChecks('po_def', PO_SCHEMA, GOOD_PO);
  assert.strictEqual(r.overall, 'PASS', 'a good po/2 must still PASS after the gimic dialect landed');
});

// =====================================================================
// REQ-0185 gate: the dungeon/1 machine checks. A dungeon def is authored,
// PROBABILITY-WEIGHTED references to monster_pack + gimic defs; its rules live
// in shared/content_validate.cjs (validateDungeonEntry), reused by the dialect.
// schema_vocab cross-checks pool references against the LIVE pack + gimic
// rosters; engine_types APPLIES (sim/dungeon_roll.cjs dereferences the pools
// and level bands); gen_data is honestly applicable:false.
// =====================================================================
const dungeons = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', 'dungeons.json'), 'utf8'));
const DUNGEON_SCHEMA = dungeons.schema; // 'dungeon/1'
const GOOD_DUNGEON = dungeons.entries[0]; // niflheim_depths
const dungeonClone = () => JSON.parse(JSON.stringify(GOOD_DUNGEON));

T('REQ-0185 positive: every live dungeon/1 entry PASSes with its data untouched', () => {
  for (const d of dungeons.entries) {
    const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, clone(d));
    assert.strictEqual(r.overall, 'PASS', d.id + ' -> ' + r.overall + ' (' + failedNames(r).join(',') + ')');
  }
});

T('REQ-0185 schema_vocab: a packPool that names a non-existent monster_pack FAILs by name', () => {
  const d = dungeonClone(); d.packPool = [{ packId: 'pack_does_not_exist', weight: 1 }];
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, d);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/pack_does_not_exist/.test(checkOf(r, 'schema_vocab').detail), 'names the missing pack');
});

T('REQ-0185 schema_vocab: a gimicPool that names a non-existent gimic FAILs by name', () => {
  const d = dungeonClone(); d.gimicPool = [{ gimic: 'gimic_does_not_exist', weight: 1 }];
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, d);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/gimic_does_not_exist/.test(checkOf(r, 'schema_vocab').detail), 'names the missing gimic');
});

T('REQ-0185 schema_vocab: an empty/absent bossPool FAILs (a dive must have a final boss)', () => {
  const d = dungeonClone(); delete d.bossPool;
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, d);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r).includes('schema_vocab'), true, 'schema_vocab flags the missing bossPool');
});

T('REQ-0185 engine_types APPLIES to dungeon (the roller dereferences pools + level bands)', () => {
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, dungeonClone());
  const et = checkOf(r, 'engine_types');
  assert.notStrictEqual(et.applicable, false, 'engine_types must APPLY to dungeon, unlike skill_def');
  assert.strictEqual(et.ok, true);
});

T('REQ-0185 negative: engine_types catches a non-number weight (pickWeighted would read NaN)', () => {
  const d = dungeonClone(); d.packPool = [{ packId: d.packPool[0].packId, weight: 'lots' }];
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, d);
  assert.strictEqual(r.overall, 'FAIL', 'a string weight is a crash inside the roller, not a nit');
});

T('REQ-0185 honesty: gen_data is applicable:false for dungeon, not a free PASS', () => {
  const r = checks.runChecks('dungeon', DUNGEON_SCHEMA, dungeonClone());
  assert.strictEqual(checkOf(r, 'gen_data').applicable, false, 'tool_gen_data does not consume dungeon/1');
});

T('REQ-0185 the dungeon dialect does NOT leak: a good po/2 still PASSes', () => {
  const r = checks.runChecks('po_def', PO_SCHEMA, GOOD_PO);
  assert.strictEqual(r.overall, 'PASS', 'a good po/2 must still PASS after the dungeon dialect landed');
});

// =====================================================================
// REQ-0266 gate: the unit_skin/1 machine checks. A unit_skin def is COSMETIC
// identity: a `slot` (the D1 discriminator -- "unit" dresses a portrait,
// "bpskin" dresses a Backpack), a FREE artwork reference, and the live units it
// may dress. Its rules live in shared/content_validate.cjs
// (validateUnitSkinEntry) and are REUSED by the dialect, never re-implemented.
// schema_vocab cross-checks units[] against the LIVE unit roster; engine_types
// and gen_data are honestly applicable:false WITH a reason (a unit_skin has no
// engine-consumed record at all, and tool_gen_data has never seen one).
// =====================================================================
const unitSkins = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_unit_skins.json'), 'utf8'));
const USKIN_SCHEMA = unitSkins.schema; // 'unit_skin/1'
const GOOD_USKIN = unitSkins.entries.find((s) => s.slot === 'unit');
const GOOD_BPSKIN = unitSkins.entries.find((s) => s.slot === 'bpskin');
const uskinClone = () => JSON.parse(JSON.stringify(GOOD_USKIN));

T('REQ-0266 dialect resolution: unit_skin/1 is its own dialect, and it does not disturb the others', () => {
  assert.strictEqual(checks._dialectFor('unit_skin/1').name, 'unit_skin/1');
  assert.deepStrictEqual(checks._dialectFor('unit_skin/1').range_fields, [], 'a skin has no roll ranges');
  assert.strictEqual(checks._dialectFor('enemy/1').name, 'enemy/1', 'the enemy dialect is untouched');
  assert.strictEqual(checks._dialectFor('po/2').name, 'default');
});

T('REQ-0266 positive: EVERY live unit_skin/1 entry PASSes with its data untouched (both slots)', () => {
  assert.ok(unitSkins.entries.length >= 108, 'REQ-0266 shipped 54 units x 2 slots; the catalog GROWS with later cosmetics');
  for (const s of unitSkins.entries) {
    const r = checks.runChecks('unit_skin', USKIN_SCHEMA, clone(s));
    assert.strictEqual(r.overall, 'PASS', s.id + ' -> ' + r.overall + ' (' + failedNames(r).join(',') + ': '
      + r.checks.filter((c) => !c.ok && c.applicable !== false).map((c) => c.detail).join(' | ') + ')');
    assert.strictEqual(r.dialect, 'unit_skin/1', s.id + ' checked under the unit_skin/1 dialect');
  }
});

T('REQ-0266 the live corpus really exercises BOTH slots -- the positive case is not vacuous', () => {
  const slots = new Set(unitSkins.entries.map((s) => s.slot));
  assert.deepStrictEqual([...slots].sort(), ['bpskin', 'unit'], 'both D1 meanings are live data, in ONE kind');
  assert.ok(GOOD_USKIN && GOOD_BPSKIN, 'a fixture of each slot exists');
  // The free-reference law: two defs may legitimately share one artwork. Pin it,
  // because a gate that re-derived art_ref from the id would forbid the ruling.
  const byArt = {};
  for (const s of unitSkins.entries) byArt[s.art_ref] = (byArt[s.art_ref] || 0) + 1;
  assert.ok(Object.keys(byArt).some((a) => byArt[a] > 1), 'at least one artwork is shared by two skins (littleprincess/princess)');
});

T('REQ-0266 negative: an unknown slot FAILs schema_vocab BY NAME', () => {
  const s = uskinClone(); s.slot = 'hat';
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab'], 'only schema_vocab flags it');
  assert.ok(/slot must be one of unit \| bpskin/.test(checkOf(r, 'schema_vocab').detail), 'names the legal slots');
});

T('REQ-0266 negative: a unit the LIVE roster does not know FAILs schema_vocab BY NAME', () => {
  const s = uskinClone(); s.units = ['unit_that_does_not_exist'];
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/unit_that_does_not_exist/.test(checkOf(r, 'schema_vocab').detail), 'names the missing unit');
  assert.ok(/no live unit def/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: an EMPTY units[] FAILs (a skin that dresses nothing is fiction)', () => {
  const s = uskinClone(); s.units = [];
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/units must be a non-empty array/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: a DUPLICATE unit inside units[] FAILs', () => {
  const s = uskinClone(); s.units = [s.units[0], s.units[0]];
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/twice/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: a missing art_ref FAILs (a skin with no artwork resolves to nothing)', () => {
  const s = uskinClone(); delete s.art_ref;
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/art_ref is required/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: a missing i18n.ja.name FAILs (MANDATORY, exactly as unit/1 requires it)', () => {
  const s = uskinClone(); delete s.i18n;
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/i18n\.ja\.name is MANDATORY/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: a NON-ja locale FAILs -- SUPPORTED_LOCALES is NOT widened for skins', () => {
  const s = uskinClone(); s.i18n = { ja: s.i18n.ja, en: { name: 'Elf Portrait' } };
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL', 'a unit skin is roster content, not dungeon content: {ja} only');
  assert.ok(/unknown i18n locale "en"/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: an unknown field FAILs (closed key set, the validateBody discipline)', () => {
  const s = uskinClone(); s.palette = { fill: '#123456' };
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL', 'a bpskin/1 palette is not part of unit_skin/1');
  assert.ok(/unknown field "palette"/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 negative: a missing name FAILs schema_vocab (the default name field, no dialect spelling)', () => {
  const s = uskinClone(); delete s.name;
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, s);
  assert.strictEqual(r.overall, 'FAIL');
  assert.ok(/name \(non-empty string\) required/.test(checkOf(r, 'schema_vocab').detail));
});

T('REQ-0266 honesty: engine_types and gen_data are applicable:false WITH A REASON, not a free PASS', () => {
  const r = checks.runChecks('unit_skin', USKIN_SCHEMA, uskinClone());
  for (const name of ['engine_types', 'gen_data', 'integrate']) {
    const c = checkOf(r, name);
    assert.strictEqual(c.applicable, false, name + ' must be recorded as not-applicable for a cosmetic def');
    assert.ok(typeof c.detail === 'string' && c.detail.length > 20, name + ' must SAY WHY it does not apply (a green chip with no reason is the lie this convention exists to prevent)');
    assert.ok(/unit_skin/.test(c.detail), name + ' reason names the kind it is talking about');
  }
  // ...and the ONE check that does apply carries the whole verdict.
  assert.strictEqual(checkOf(r, 'schema_vocab').applicable, true);
  assert.strictEqual(failedNames(r).length, 0);
});

T('REQ-0266 the unit_skin dialect does NOT leak: po/2, enemy/1 and unit/1 keep their own rules', () => {
  assert.strictEqual(checks.runChecks('po_def', PO_SCHEMA, GOOD_PO).overall, 'PASS', 'a good po/2 must still PASS after the unit_skin dialect landed');
  assert.strictEqual(checks.runChecks('monster_def', ENEMY_SCHEMA, GOOD_ENEMY).overall, 'PASS', 'enemy/1 is untouched');
  // The sharpest non-leakage case: a unit_skin's OWN fields must not be blessed
  // for a unit_def. `slot`/`art_ref`/`units` are not unit/1 keys, and unit/1's
  // allowlist is what has to say so.
  const bogusUnit = { id: 'test_leak_unit', name: 'Leak', slot: 'unit', art_ref: 'x', units: ['elf'], connection_shape: 'bishop', icon: 'x', i18n: { ja: { name: 'x' } } };
  const r = checks.runChecks('unit_def', 'unit/1', bogusUnit);
  assert.strictEqual(r.overall, 'FAIL', 'unit_skin fields are not editable on a unit_def');
  assert.ok(/unknown field/.test(checkOf(r, 'schema_vocab').detail));
  // ...and the mirror: a unit_def is not a legal unit_skin either.
  const bogusSkin = { id: 'test_leak_skin', name: 'Leak', rarity: 'Common', icon: 'x', connection_shape: 'bishop', i18n: { ja: { name: 'x' } } };
  assert.strictEqual(checks.runChecks('unit_skin', USKIN_SCHEMA, bogusSkin).overall, 'FAIL', 'a unit/1 entry is not a legal unit_skin/1 entry');
});

console.log('\n== REQ-0161/0160 dialect: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
