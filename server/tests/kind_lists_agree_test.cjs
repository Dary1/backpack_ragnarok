#!/usr/bin/env node
'use strict';
// server/tests/kind_lists_agree_test.cjs -- REQ-0352 section 6 (the assertion
// REQ-0353 section 6 and REQ-0354 section 6 also call for; REQ-0352 landed
// first and wrote it, the others reference it).
//
// FOUR hard-coded kind lists must agree, and for a while they did not:
//   1. server/routes/content.cjs   KINDS            -- what the API ingests
//   2. server/services/core.cjs    REGISTRY_KINDS   -- what serving resolves
//   3. server/lib/content.cjs      REGISTRY_KIND_BY_SECTION -- the display slice
//   4. tools/verify_content_registry_parity.cjs COVERED -- what the drift gate checks
//
// The monster_pack bug (REQ-0352 section 1) was exactly a disagreement between
// 1 and 2 (adoptions that never reached serving), made invisible by a
// disagreement between 2 and 4 (a served corpus the drift gate never looked
// at). gimic/dungeon sat in the same 2-vs-4 gap. This test turns the prose
// rule "keep the lists in sync" into a red CI stage. DB-free by construction:
// it reads the exported constants, resolves nothing.
const assert = require('assert');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..', '..');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

const { KINDS } = require(path.join(REPO_ROOT, 'server', 'routes', 'content.cjs'));
const { REGISTRY_KINDS } = require(path.join(REPO_ROOT, 'server', 'services', 'core.cjs'));
const { REGISTRY_KIND_BY_SECTION } = require(path.join(REPO_ROOT, 'server', 'lib', 'content.cjs'));
const parity = require(path.join(REPO_ROOT, 'tools', 'verify_content_registry_parity.cjs'));
const backfill = require(path.join(REPO_ROOT, 'tools', 'backfill_content_registry.cjs'));

const displayKinds = Object.values(REGISTRY_KIND_BY_SECTION);
const coveredKinds = Array.from(new Set(parity.COVERED.map((c) => c.kind)));
const sourceKinds = Array.from(new Set(backfill.SOURCES.map((s) => s.kind)));
const missing = (sub, sup) => sub.filter((k) => !sup.includes(k));

check('KINDS is a superset of REGISTRY_KINDS (everything served is ingestable)', () => {
  assert.deepStrictEqual(missing(REGISTRY_KINDS, KINDS), [],
    'REGISTRY_KINDS entries absent from routes KINDS');
});

check('REGISTRY_KINDS is a superset of the display kinds (display is a slice of serving)', () => {
  assert.deepStrictEqual(missing(displayKinds, REGISTRY_KINDS), [],
    'display kinds absent from REGISTRY_KINDS');
});

check('every ingestable kind is served (KINDS == REGISTRY_KINDS -- the monster_pack gap, pinned)', () => {
  // Stronger than subset on today's tree: an adoptable kind that serving
  // ignores is exactly the REQ-0352 section 1 bug. If a future kind must be
  // ingest-only for a while, weaken THIS assertion deliberately and say why.
  assert.deepStrictEqual(missing(KINDS, REGISTRY_KINDS), [],
    'KINDS entries absent from REGISTRY_KINDS -- adopted-but-never-served, the monster_pack bug');
});

check('the drift gate covers exactly the served kinds (COVERED == REGISTRY_KINDS)', () => {
  assert.deepStrictEqual(missing(REGISTRY_KINDS, coveredKinds), [],
    'served kinds the parity tool never checks -- drift there reaches the game unseen');
  assert.deepStrictEqual(missing(coveredKinds, REGISTRY_KINDS), [],
    'covered kinds that are not served -- the gate is checking a fiction');
});

check('parity COVERED stays a mirror of the backfill SOURCES kinds', () => {
  assert.deepStrictEqual(missing(coveredKinds, sourceKinds), [],
    'covered kinds with no backfill source -- COVERED claims a corpus the backfill never imported');
});

check('monster_pack derived-field config is present and exact (REQ-0352 section 5)', () => {
  const rows = parity.COVERED.filter((c) => c.kind === 'monster_pack');
  assert.strictEqual(rows.length, 1, 'exactly one monster_pack COVERED row');
  assert.deepStrictEqual(rows[0].derived, ['powerLevel'],
    'powerLevel is the one autobalance-derived field; adding a derived field is a section-5-class ruling, not a config tweak');
});

console.log('');
console.log('kind_lists_agree_test: ' + (failed ? failed + ' FAILED' : 'all green'));
process.exit(failed ? 1 : 0);
