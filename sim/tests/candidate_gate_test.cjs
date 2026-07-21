'use strict';
// sim/tests/candidate_gate_test.cjs -- REQ-0272: one-door candidate gate tests.
// Plain node assert-style (matches sim/tests/balance_sim_test.cjs). Spawns the
// real CLI end-to-end on inline fixtures written to a throwaway temp dir, and
// asserts on both the exit code and the <name>.gate.json report it writes.
//   node sim/tests/candidate_gate_test.cjs
//
// The four gate outcomes the REQ pins:
//   (a) a known-good candidate passes end-to-end (exit 0)
//   (b) an over-band candidate exits 1 with the STATIC reason
//   (c) an in-band-but-sim-flagged candidate exits 1 with the DYNAMIC reason
//   (d) a junk-vocab candidate exits 1 at VALIDATE
// plus: usage errors exit 2, and the report core is deterministic (double run).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '..', 'tools', 'candidate_gate.cjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cand_gate_test_'));

let passed = 0, failed = 0;
function T(name, fn) { try { fn(); passed++; console.log('PASS  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + ' -- ' + e.message); if (process.env.CG_TRACE) console.log(e.stack); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function writeFixture(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}
function reportOf(candPath) {
  const rp = candPath.replace(/\.json$/i, '') + '.gate.json';
  return JSON.parse(fs.readFileSync(rp, 'utf8'));
}
function runGate(candPath, extraArgs) {
  const r = spawnSync(process.execPath, [GATE, candPath].concat(extraArgs || []), { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', report: r.status === 2 ? null : reportOf(candPath) };
}

// ---- fixtures (stat-lines verified against the live bands, REQ-0272) -------
const GOOD_ITEM = { id: 'cg_good_dagger', schema: 'po/2', name: 'Test Dagger', rarity: 'Common', tags: ['Weapon', 'Metal'], shape: [[0, 0]], effects: [{ trigger: { t: 'every_secs', s: [1.6, 2.0] }, verb: { t: 'strike', n: [4, 6] } }] };
const OVERBAND_ITEM = { id: 'cg_ob_maul', schema: 'po/2', name: 'Overband Maul', rarity: 'Common', tags: ['Weapon'], shape: [[0, 0]], effects: [{ trigger: { t: 'every_secs', s: [1.8, 2.2] }, verb: { t: 'strike', n: [80, 120] } }] };
// In-band statically (apply_status is not a damage verb -> static 'na'), but a
// brutal enemy-side DoT the balance sim catches as OP (raises squad wipes).
const DYN_SKILL = { id: 'cg_dyn_poison', schema: 'skill/1', name_en: 'Creeping Rot', name_ja: 'クリープ', trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'apply_status', n: [120, 150], status: 'Poison' }, attack_profile: { edge: ['top'], direction: 'front', penetration: 2, aoe: 6, aoe_statuses: true }, modes: ['battle'] };
const JUNK_ITEM = { id: 'cg_junk', schema: 'po/2', name: 'Junk', rarity: 'Common', tags: ['Weapon'], shape: [[0, 0]], effects: [{ trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'megablast', n: [1, 2] } }] };

// (a) known-good passes end-to-end
T('(a) known-good candidate passes end-to-end (exit 0, verdict PASS)', () => {
  const p = writeFixture('good_item.json', GOOD_ITEM);
  const r = runGate(p, ['--seeds', '4']);
  ok(r.status === 0, 'expected exit 0, got ' + r.status + '\n' + r.stdout);
  ok(r.report.verdict === 'PASS', 'verdict not PASS: ' + r.report.verdict);
  ok(r.report.stages.validate.status === 'PASS', 'validate not PASS');
  ok(r.report.stages.static.status === 'PASS', 'static not PASS');
});

// (b) over-band exits 1 with the STATIC reason
T('(b) over-band candidate exits 1 with a STATIC-stage reason', () => {
  const p = writeFixture('overband_item.json', OVERBAND_ITEM);
  const r = runGate(p, ['--skip-sim']);
  ok(r.status === 1, 'expected exit 1, got ' + r.status);
  ok(r.report.stages.validate.status === 'PASS', 'validate should pass (vocab is legal)');
  ok(r.report.stages.static.status === 'FLAG', 'static not FLAG: ' + r.report.stages.static.status);
  ok(r.report.stages.static.reasons.some((s) => /warn_hi/.test(s)), 'static reason lacks warn_hi: ' + JSON.stringify(r.report.stages.static.reasons));
});

// (c) in-band statically, flagged dynamically
T('(c) in-band-but-sim-flagged candidate exits 1 with a DYNAMIC-stage reason', () => {
  const p = writeFixture('dyn_skill.json', DYN_SKILL);
  const r = runGate(p, ['--seeds', '2']);
  ok(r.status === 1, 'expected exit 1, got ' + r.status + '\n' + r.stdout);
  ok(r.report.stages.static.status === 'PASS', 'static should PASS (na): ' + r.report.stages.static.status);
  ok(r.report.stages.dynamic.status === 'FLAG', 'dynamic not FLAG: ' + r.report.stages.dynamic.status);
  ok(r.report.stages.dynamic.reasons.length > 0, 'no dynamic reason recorded');
});

// (d) junk vocab exits 1 at VALIDATE
T('(d) junk-vocab candidate exits 1 at VALIDATE (static/dynamic skipped)', () => {
  const p = writeFixture('junk.json', JUNK_ITEM);
  const r = runGate(p, ['--skip-sim']);
  ok(r.status === 1, 'expected exit 1, got ' + r.status);
  ok(r.report.stages.validate.status === 'FLAG', 'validate not FLAG');
  ok(r.report.stages.validate.reasons.some((s) => /unknown verb/.test(s)), 'validate reason lacks unknown verb: ' + JSON.stringify(r.report.stages.validate.reasons));
  ok(r.report.stages.static.status === 'SKIP', 'static should be SKIP after validation failure');
});

// (e) usage errors exit 2
T('(e) usage: no candidate path exits 2', () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: 'utf8' });
  ok(r.status === 2, 'expected exit 2, got ' + r.status);
});
T('(e) usage: missing candidate file exits 2', () => {
  const r = spawnSync(process.execPath, [GATE, path.join(TMP, 'nope.json')], { encoding: 'utf8' });
  ok(r.status === 2, 'expected exit 2, got ' + r.status);
});

// (f) report core is deterministic across two runs (meta stripped)
T('(f) report core is deterministic (double run, meta stripped)', () => {
  const p = writeFixture('det_skill.json', DYN_SKILL);
  runGate(p, ['--seeds', '2']);
  const r1 = reportOf(p); delete r1.meta;
  runGate(p, ['--seeds', '2']);
  const r2 = reportOf(p); delete r2.meta;
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'report core differs across runs');
});

// cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }

console.log('----------------------------------');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
