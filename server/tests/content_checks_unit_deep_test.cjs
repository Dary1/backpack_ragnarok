// backpack_ragnarok -- server/tests/content_checks_unit_deep_test.cjs
// REQ-0201 (units003-roster-registry): the unit_def machine check is DEEPENED.
// content_checks.schemaVocabCheck now runs shared/content_validate.cjs
// validateUnitEntry() -- the SAME executable validator the check_units live gate
// runs -- on any unit_def variant that carries a full entry (guard: data.id).
// So a registry unit variant's WHOLE entry (id/icon/i18n/connection_shape/charge)
// is machine-checked at INGEST time, not only at the check_units live gate.
//
// HONEST COUPLING (merge order 0200 -> 0201): validateUnitEntry only KNOWS the
// `charge` grammar once REQ-0200 lands it into shared/content_validate.cjs. THIS
// branch does NOT contain REQ-0200, so here a charge-bearing variant is correctly
// rejected as an UNKNOWN FIELD (charge is not yet in UNIT_ALLOWED_KEYS); once both
// branches merge the same variant is instead deep-checked against the charge AST
// (unknown trigger, bad capacity, ...). This file pins the pre-0200 truth and says so.
//
// DB-free: runChecks is a pure function of (kind, schema_ref, data).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const checks = require('../services/content_checks.cjs');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function checkOf(r, name) { return r.checks.find((c) => c.name === name); }
function failedNames(r) { return r.checks.filter((c) => c.applicable !== false && !c.ok).map((c) => c.name); }

// A MINIMAL legal unit/1 registry variant: id + name + icon (a FREE artwork
// system_name, NOT derived from id -- REQ-0149 G14) + rarity + connection_shape
// + i18n.ja.name. charge-less on purpose (see the honest-coupling note above).
const GOOD_UNIT = {
  id: 'req0201_probe',
  name: 'Probe',
  icon: 'units003_probe',              // artwork_ref facet -- units003_<id> convention
  rarity: 'Common',
  connection_shape: 'queen_2',
  i18n: { ja: { name: 'プローブ' } },
};

// A real units003 charge block (alchemist kit): legal grammar, but on THIS branch
// `charge` is not an editable unit field yet (REQ-0200 adds it to UNIT_ALLOWED_KEYS).
const CHARGE = {
  trigger: { t: 'every_secs', s: [4, 5] },
  gain: 'count',
  capacity: [2, 3],
  spend: 'fire_on_full',
  effects: [{ verb: { t: 'add_on_hit_status', status: 'Poison', n: [2, 3] }, target: 'units_connected' }],
};

console.log('== REQ-0201 unit_def deep-validation (validateUnitEntry wired into schema_vocab) ==');

T('minimal legal unit variant PASSES all applicable checks (charge-less)', () => {
  const r = checks.runChecks('unit_def', 'unit/1', clone(GOOD_UNIT));
  assert.strictEqual(r.overall, 'PASS', 'checks: ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.strictEqual(checkOf(r, 'schema_vocab').ok, true);
  // integrate stays n/a for a unit (no canvas placement): the deepen did not
  // accidentally switch a non-applicable check on.
  assert.strictEqual(checkOf(r, 'integrate').applicable, false);
});

T('deep check is WIRED: a variant missing i18n.ja.name FAILs schema_vocab (only validateUnitEntry knows this rule)', () => {
  const bad = clone(GOOD_UNIT);
  delete bad.i18n;
  const r = checks.runChecks('unit_def', 'unit/1', bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab']);
  assert.ok(/i18n\.ja\.name is MANDATORY/.test(checkOf(r, 'schema_vocab').detail),
    "the failure is validateUnitEntry's mandatory-i18n rule (the base schema_vocab check does not look at i18n): " + checkOf(r, 'schema_vocab').detail);
});

T('HONEST COUPLING (pre-0200): a charge-bearing variant FAILs -- rejected as an unknown FIELD until 0200 lands the charge grammar', () => {
  const bad = clone(GOOD_UNIT);
  bad.charge = clone(CHARGE);
  const r = checks.runChecks('unit_def', 'unit/1', bad);
  assert.strictEqual(r.overall, 'FAIL');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab']);
  const detail = checkOf(r, 'schema_vocab').detail;
  assert.ok(/unknown field "charge"/.test(detail),
    'on THIS branch charge is not yet in UNIT_ALLOWED_KEYS, so it is rejected as an unknown field (post-0200 this becomes a deep charge-AST check): ' + detail);
});

T('the deep check REACHES a charge-bearing entry -- an ILLEGAL charge is NEVER silently accepted (belt-and-braces, pre/post 0200)', () => {
  // Whatever the exact message (unknown-field pre-0200, unknown-trigger post-0200),
  // a charge block with a garbage trigger must NEVER produce overall PASS.
  const bad = clone(GOOD_UNIT);
  bad.charge = { trigger: { t: 'no_such_trigger_xyz' }, gain: 'count', capacity: [1, 2], spend: 'fire_on_full', effects: [{ verb: { t: 'heal_bp', n: [1, 2] }, target: 'self' }] };
  const r = checks.runChecks('unit_def', 'unit/1', bad);
  assert.strictEqual(r.overall, 'FAIL', 'a charge-bearing variant must never PASS on this branch');
});

T('GUARD: a partial unit_def record with NO id is NOT forced through validateUnitEntry', () => {
  // The deepen is guarded on data.id: a record lacking id (not a full variant) is
  // left to the base "id required" check and must NOT also raise validateUnitEntry's
  // icon/connection_shape/i18n errors.
  const partial = { name: 'Partial', rarity: 'Common' }; // no id, no icon, no i18n
  const r = checks.runChecks('unit_def', 'unit/1', partial);
  const detail = checkOf(r, 'schema_vocab').detail;
  assert.ok(/id \(non-empty string\) required/.test(detail), 'base id check still fires: ' + detail);
  assert.ok(!/icon is required/.test(detail),
    'validateUnitEntry (which demands icon) must NOT have run for an id-less record: ' + detail);
});

T('regression: the 12 live roster unit_defs (charge-less) still PASS the deepened schema_vocab', () => {
  const REPO = path.join(__dirname, '..', '..');
  const units = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_units.json'), 'utf8'));
  assert.strictEqual(units.entries.length, 12, 'roster 001 is 12 units');
  for (const e of units.entries) {
    const r = checks.runChecks('unit_def', 'unit/1', clone(e));
    assert.strictEqual(r.overall, 'PASS', e.id + ': ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  }
});

console.log('\n== REQ-0201 unit_def deep-validation: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);
