#!/usr/bin/env node
'use strict';
// server/tests/serving_check_test.cjs -- REQ-0354. DB-free unit gates for the
// advisory `serving` row, its live-file-sha staleness marker, the advisory-
// aware overall rule, the kind-level serving report, and the parity tool's
// --strict verdict (section 6).
//
// GATE 2 IS PINNED HERE ("staleness has teeth"): compute the row, mutate the
// live file, re-annotate WITHOUT re-running the check -- it must report STALE,
// not PASS. That is the section-3 trap: a serving verdict is a function of the
// variant AND the live files, and the files move without the variant moving.
//
// CONTENT_ROOT is captured at content_files.cjs module load, so it is set here
// BEFORE any require that could touch it (same seam the loader documents).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'req0354-'));
process.env.CONTENT_ROOT = TMP;
fs.mkdirSync(path.join(TMP, 'live', 'dungeon'), { recursive: true });

const SI = { id: 'stest_si', name_en: 'S Test', size: 1 };
const PACK = { id: 'stest_pack', members: [{ id: 'gnoll', count: 2 }], powerLevel: 42 };
function writeFixtures() {
  fs.writeFileSync(path.join(TMP, 'live', 'live_sis.json'), JSON.stringify({ entries: [SI] }));
  fs.writeFileSync(path.join(TMP, 'live', 'dungeon', 'packs.json'), JSON.stringify({ entries: [PACK] }));
}
writeFixtures();

const checks = require('../services/content_checks.cjs');

let failed = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + ((e && e.message) || e)); }
}

T('MATCH: live entry == variant -> serving PASS, advisory, sha carried', () => {
  const r = checks.servingCheck('si_def', 'stest_si', { id: 'stest_si', name_en: 'S Test', size: 1 });
  assert.strictEqual(r.name, 'serving');
  assert.strictEqual(r.advisory, true, 'advisory flag present (section 4)');
  assert.strictEqual(r.ok, true, r.detail);
  assert.strictEqual(r.applicable, true);
  assert.ok(Array.isArray(r.live_files) && r.live_files.length === 1
    && /^[0-9a-f]{64}$/.test(r.live_files[0].sha256), 'live-file sha256 carried (section 3 ruling)');
});

T('DRIFT: differing entry -> serving FAIL naming the drifted fields', () => {
  const r = checks.servingCheck('si_def', 'stest_si', { id: 'stest_si', name_en: 'Other', size: 2 });
  assert.strictEqual(r.ok, false);
  assert.ok(/DRIFT/.test(r.detail) && /name_en/.test(r.detail) && /size/.test(r.detail),
    'field paths in detail: ' + r.detail);
});

T('MISSING entry: absent from every covered file -> FAIL with fresh-def wording, shas still carried', () => {
  const r = checks.servingCheck('si_def', 'stest_absent', { id: 'stest_absent' });
  assert.strictEqual(r.ok, false);
  assert.ok(/no live-file entry/.test(r.detail), r.detail);
  assert.ok(/never blocks adoption/i.test(r.detail), 'section-4 wording present: ' + r.detail);
  assert.ok(r.live_files.length === 1 && r.live_files[0].sha256,
    'sha carried even on absence (the file gaining the entry later must read STALE)');
});

T('derived strip (REQ-0352 section 5): file-side powerLevel never reads as drift', () => {
  const r = checks.servingCheck('monster_pack', 'stest_pack', { id: 'stest_pack', members: [{ id: 'gnoll', count: 2 }] });
  assert.strictEqual(r.ok, true, r.detail);
});

T('NOT WIRED kind -> honest applicable:false pointing at the kind-level banner', () => {
  const r = checks.servingCheck('phantom_kind', 'x', { id: 'x' });
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.advisory, true);
  assert.ok(/not wired/i.test(r.detail) && /REGISTRY_KINDS/.test(r.detail), r.detail);
});

T('GATE 2 -- staleness has teeth: mutate the live file, re-READ without re-running -> STALE, not PASS', () => {
  const row = checks.servingCheck('si_def', 'stest_si', { id: 'stest_si', name_en: 'S Test', size: 1 });
  assert.strictEqual(row.ok, true, 'starts PASS');
  const mc = { overall: 'PASS', checks: [row] };
  checks.annotateServingStaleness(mc);
  assert.strictEqual(row.stale, false, 'unchanged file -> explicitly fresh (stale:false)');
  fs.writeFileSync(path.join(TMP, 'live', 'live_sis.json'),
    JSON.stringify({ entries: [{ id: 'stest_si', name_en: 'MUTATED', size: 1 }] }));
  checks.annotateServingStaleness(mc);
  assert.strictEqual(row.stale, true,
    'live file changed under a stored PASS -> STALE (the section-3 trap; a stale green is the REQ-0353 state)');
  writeFixtures();
});

T('GATE 3 (unit half) -- a failing advisory row never feeds overall', () => {
  const rows = [
    { name: 'schema_vocab', ok: true, applicable: true },
    { name: 'serving', ok: false, applicable: true, advisory: true },
  ];
  assert.strictEqual(checks.overallOf(rows), 'PASS',
    'advisory FAIL must not FAIL overall -- feeding it would 409 every normal adoption (section 4)');
  rows.push({ name: 'engine_types', ok: false, applicable: true });
  assert.strictEqual(checks.overallOf(rows), 'FAIL', 'real rows still fail overall');
  assert.strictEqual(checks.overallOf([{ name: 'x', ok: false, applicable: false }]), 'PASS',
    'applicable:false keeps its own, different meaning');
});

T('servingReportForDefs: wired flags + MISSING report rows (section 5)', () => {
  const defs = [{ system_name: 'stest_si', kind: 'si_def', adopted_variant_id: 7 }];
  const rep = checks.servingReportForDefs(defs, ['si_def', 'monster_pack', 'phantom_kind']);
  const si = rep.kinds.find((k) => k.kind === 'si_def');
  assert.ok(si.wired === true && si.in_files === 1 && si.missing_count === 0 && si.adopted_count === 1,
    JSON.stringify(si));
  const mp = rep.kinds.find((k) => k.kind === 'monster_pack');
  assert.ok(mp.missing_count === 1 && mp.missing_from_registry[0] === 'stest_pack',
    'stest_pack has no def -> MISSING report row: ' + JSON.stringify(mp));
  const ph = rep.kinds.find((k) => k.kind === 'phantom_kind');
  assert.strictEqual(ph.wired, false, 'unwired kind -> banner data');
});

T('parity strictOk (section 6): served set == passing set blocks on DRIFT, MISSING and UNADOPTED', () => {
  const { strictOk } = require('../../tools/verify_content_registry_parity.cjs');
  assert.strictEqual(strictOk({ MATCH: 413, DRIFT: 0, 'MISSING-IN-REGISTRY': 0, UNADOPTED: 0 }), true);
  assert.strictEqual(strictOk({ MATCH: 1, DRIFT: 1, 'MISSING-IN-REGISTRY': 0, UNADOPTED: 0 }), false);
  assert.strictEqual(strictOk({ MATCH: 1, DRIFT: 0, 'MISSING-IN-REGISTRY': 64, UNADOPTED: 0 }), false);
  assert.strictEqual(strictOk({ MATCH: 1, DRIFT: 0, 'MISSING-IN-REGISTRY': 0, UNADOPTED: 2 }), false);
});

console.log('');
console.log('serving_check_test: ' + (failed ? failed + ' FAILED' : 'all green'));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(failed ? 1 : 0);
