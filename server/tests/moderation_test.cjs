'use strict';
// server/tests/moderation_test.cjs -- REQ-0144 gates. The DB-free half (pure
// mappers + verdictToRow/overrideToRow validation + a round-trip proving the
// REAL python tool output ingests cleanly) ALWAYS runs. The pg half (chokepoint
// persistence: submission upsert, verdict insert, override/appeal path,
// idempotent re-record) runs only when DATABASE_URL is set -- same SKIP_PG
// discipline as artwork_test.cjs.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const REPO = path.join(__dirname, '..', '..');
const M = require('../storage_moderation.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

const goodRec = {
  pipeline_version: '1', verdict: 'REJECT',
  verdict_sha256: 'a'.repeat(64), input_sha256: 'b'.repeat(64),
  gates: [{ gate_id: 'nsfw.vit_base', verdict: 'REJECT', score: 0.9 }],
};

T('verdictToRow accepts a well-formed record', () => {
  const row = M.verdictToRow(goodRec);
  assert.strictEqual(row.verdict, 'REJECT');
  assert.strictEqual(JSON.parse(row.gates)[0].gate_id, 'nsfw.vit_base');
});
T('verdictToRow rejects an unknown verdict', () => { assert.throws(() => M.verdictToRow(Object.assign({}, goodRec, { verdict: 'MAYBE' }))); });
T('verdictToRow rejects a non-hex verdict_sha256', () => { assert.throws(() => M.verdictToRow(Object.assign({}, goodRec, { verdict_sha256: 'nope' }))); });
T('verdictToRow rejects missing gates', () => { const r = Object.assign({}, goodRec); delete r.gates; assert.throws(() => M.verdictToRow(r)); });
T('overrideToRow validates the action enum', () => {
  assert.throws(() => M.overrideToRow({ operator: 'op', action: 'X', reason: 'r' }));
  assert.strictEqual(M.overrideToRow({ operator: 'op', action: 'UPHOLD', reason: 'r' }).action, 'UPHOLD');
});
T('mapVerdict parses a gates json string', () => {
  const v = M.mapVerdict({ id: 1, submission_id: 2, pipeline_version: '1', verdict: 'PASS', verdict_sha256: 'c'.repeat(64), input_sha256: 'd'.repeat(64), gates: '[{"g":1}]', decided_at: 'now' });
  assert.strictEqual(v.gates[0].g, 1);
});
T('python pipeline output ingests into verdictToRow (contract)', () => {
  const PY = process.env.ART_KIT_PYTHON || path.join(os.homedir(), 'backpack_ragnarok', '.venv', 'bin', 'python');
  if (!fs.existsSync(PY)) { console.log('  (skip python contract: no venv python found)'); return; }
  const out = execFileSync(PY, ['tools/tests/emit_sample_verdict.py'], { cwd: REPO }).toString();
  const rec = JSON.parse(out);
  const row = M.verdictToRow(rec);
  assert.ok(/^[0-9a-f]{64}$/.test(row.verdict_sha256));
  assert.ok(['PASS', 'ESCALATE', 'REJECT'].includes(row.verdict));
});

async function pgTests() {
  process.env.STORAGE_BACKEND = 'pg';
  const storage = require('../storage.cjs');
  const sha = 'f'.repeat(63) + '1';
  const rec = { pipeline_version: '1', verdict: 'REJECT', verdict_sha256: '1'.repeat(64), input_sha256: sha, gates: [{ gate_id: 'ip.phash_denylist', verdict: 'REJECT', score: 3 }] };
  await AT('recordModerationVerdict persists through the storage.cjs chokepoint', async () => {
    const { submission, verdict } = await storage.recordModerationVerdict(rec, { source: 'moderation_test', byte_size: 123 });
    assert.ok(submission.id > 0);
    assert.strictEqual(verdict.verdict, 'REJECT');
    assert.strictEqual(verdict.gates[0].gate_id, 'ip.phash_denylist');
  });
  await AT('getLatestVerdict round-trips the evidence', async () => {
    const v = await storage.getLatestVerdict(sha);
    assert.strictEqual(v.verdict_sha256, '1'.repeat(64));
    assert.strictEqual(v.gates[0].score, 3);
  });
  await AT('override/appeal path records + lists', async () => {
    const v = await storage.getLatestVerdict(sha);
    const ov = await storage.recordOverride(v.id, { operator: 'ahyaqtie', action: 'OVERRIDE_APPROVE', reason: 'false positive on abstract art' });
    assert.strictEqual(ov.action, 'OVERRIDE_APPROVE');
    assert.strictEqual((await storage.listOverrides(v.id)).length, 1);
  });
  await AT('re-recording the same verdict_sha256 is idempotent', async () => {
    await storage.recordModerationVerdict(rec, { source: 'moderation_test' });
    assert.strictEqual((await storage.listVerdicts(sha)).length, 1);
  });
  await AT('cleanup (cascade deletes verdict + override)', async () => {
    await storage.deleteSubmissionBySha(sha);
    assert.strictEqual(await storage.getSubmissionBySha(sha), null);
  });
  await M.closeModerationPool();
}

(async () => {
  if (process.env.DATABASE_URL) { await pgTests(); } else { console.log('SKIP pg moderation tests (no DATABASE_URL)'); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();


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
