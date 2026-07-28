// backpack_ragnarok -- server/tests/content_checks_unit_deep_test.cjs
// REQ-0201 (units003-roster-registry): the unit_def machine check is DEEPENED.
// content_checks.schemaVocabCheck now runs shared/content_validate.cjs
// validateUnitEntry() -- the SAME executable validator the check_units live gate
// runs -- on any unit_def variant that carries a full entry (guard: data.id).
// So a registry unit variant's WHOLE entry (id/icon/i18n/connection_shape/charge)
// is machine-checked at INGEST time, not only at the check_units live gate.
//
// COUPLING RESOLVED (integration-units003: merge order 0200 -> 0201 COMPLETE):
// validateUnitEntry KNOWS the `charge` grammar now that REQ-0200 has landed it into
// shared/content_validate.cjs (UNIT_ALLOWED_KEYS += 'charge' + a validateCharge() AST).
// So a charge-bearing variant is NO LONGER rejected as an unknown field: a LEGAL charge
// block is deep-checked and ACCEPTED; an ILLEGAL one is rejected against the charge AST
// (unknown trigger, bad capacity, ...). This file now pins that post-merge truth.
// (History: on the pre-0200 REQ-0201 branch the same variant was correctly rejected as
// unknown field "charge"; that state is retired here now that 0200 is merged.)
//
// DB-free: runChecks is a pure function of (kind, schema_ref, data).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const checks = require('../services/content_checks.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now();
  try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; }
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

// A real units003 charge block (alchemist kit): legal grammar. Post-0200 `charge` IS an
// editable unit field (in UNIT_ALLOWED_KEYS) and this block deep-validates and is accepted.
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

T('POST-0200 (coupling resolved): a LEGAL charge-bearing variant PASSES -- charge is now a known, deep-validated field', () => {
  // Was, on the pre-0200 REQ-0201 branch: FAIL, rejected as unknown field "charge".
  // Now that 0200 is merged, the alchemist charge block deep-validates and is ACCEPTED.
  const good = clone(GOOD_UNIT);
  good.charge = clone(CHARGE);
  const r = checks.runChecks('unit_def', 'unit/1', good);
  assert.strictEqual(r.overall, 'PASS', 'a legal charge block must now deep-validate: ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.strictEqual(checkOf(r, 'schema_vocab').ok, true);
});

T('POST-0200: an ILLEGAL charge (garbage trigger) FAILs the DEEP charge-AST check -- a different reject than pre-0200 unknown-field', () => {
  // The reject reason has FLIPPED with the 0200 merge: pre-0200 a charge block failed
  // as unknown field "charge"; now the field is KNOWN and the garbage trigger is caught
  // by validateCharge's charge-AST walk.
  const bad = clone(GOOD_UNIT);
  bad.charge = { trigger: { t: 'no_such_trigger_xyz' }, gain: 'count', capacity: [1, 2], spend: 'fire_on_full', effects: [{ verb: { t: 'heal_bp', n: [1, 2] }, target: 'self' }] };
  const r = checks.runChecks('unit_def', 'unit/1', bad);
  assert.strictEqual(r.overall, 'FAIL', 'a charge-bearing variant with a garbage trigger must never PASS');
  assert.deepStrictEqual(failedNames(r), ['schema_vocab']);
  const detail = checkOf(r, 'schema_vocab').detail;
  assert.ok(/is not a charge-legal trigger/.test(detail),
    'post-0200 the reject is the deep charge-AST unknown-trigger error, NOT unknown-field: ' + detail);
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
  assert.ok(units.entries.length >= 12, 'roster 001 has at least its original 12 units (REQ-0207: GROWS with roster deploys, e.g. units003)');
  for (const e of units.entries) {
    const r = checks.runChecks('unit_def', 'unit/1', clone(e));
    assert.strictEqual(r.overall, 'PASS', e.id + ': ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  }
});

console.log('\n== REQ-0201 unit_def deep-validation: ' + pass + ' passed, ' + fail + ' failed ==');
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
