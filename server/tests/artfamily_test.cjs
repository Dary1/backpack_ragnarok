// backpack_ragnarok -- server/tests/artfamily_test.cjs
// REQ-0233 gate: art-queue FAMILY SCHEDULING. The pump keeps at most ONE model
// stack resident: it drains the in-flight family (generation vs matte) before
// switching, kit inspections auto-enqueued mid-generation-batch WAIT for the
// family to finish, and a generation->matte switch fires the ComfyUI restart
// barrier exactly once (matte->generation needs none). The barrier's real
// systemctl restart is disabled here (ART_FAMILY_BARRIER=0); its logical firing
// is still counted via jobs.__test so the invariant is observable. Same
// pg-backed rig as inspection_test.cjs (mock generation, model-free borderkey
// matte); SKIPPED cleanly when DATABASE_URL is unset.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP artfamily_test.cjs (no DATABASE_URL)'); process.exit(0); }

const realHome = os.homedir();
process.env.STORAGE_BACKEND = 'pg';
process.env.ART_ROUTE_MOCK = '1';
process.env.ART_FAMILY_BARRIER = '0';          // count barrier fires; never restart comfyui
process.env.ART_DISPATCH_LOG = '1';            // record dispatch order for the ordering asserts
process.env.ART_KIT_MATTE_METHOD = process.env.ART_KIT_MATTE_METHOD || 'borderkey';
process.env.ART_KIT_PYTHON = process.env.ART_KIT_PYTHON
  || path.join(realHome, 'backpack_ragnarok', '.venv', 'bin', 'python');
process.env.ART_JOB_PYTHON = process.env.ART_JOB_PYTHON
  || path.join(realHome, 'backpack_ragnarok', '.venv', 'bin', 'python');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-fam-test-'));
os.homedir = () => tmpHome;

const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-fam-models-'));
for (const f of ['flux-2-klein-4b-Q8_0.gguf', 'qwen_3_4b.safetensors', 'flux2-vae.safetensors']) {
  fs.writeFileSync(path.join(modelDir, f), 'STANDIN-' + f);
}
process.env.ART_MODEL_DIR = modelDir;

const storage = require('../storage.cjs');
const jobs = require('../services/art_jobs.cjs');

let pass = 0, fail = 0;
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Wait until the queue is idle AND the dispatch log has settled (no new job for
// three consecutive polls) -- families + barrier tick are done.
async function drain(ms) {
  const deadline = Date.now() + (ms || 90000);
  let last = -1, stable = 0;
  while (Date.now() < deadline) {
    const snap = jobs.listJobs();
    const n = jobs.__test.dispatchLog().length;
    const idle = !snap.running && snap.pending.length === 0 && snap.inspectDepth === 0;
    if (idle && n === last) { if (++stable >= 3) return; } else { stable = 0; }
    last = n;
    await sleep(200);
  }
  throw new Error('queue did not drain: ' + JSON.stringify(jobs.__test.dispatchLog()));
}

async function enqueueGen(a) {
  const r = await storage.createRender(a.id, null, 'queued');
  jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: false });
  return r;
}

async function t1() {
  await AT('REQ-0233 generation family drains before mattes; auto-inspections wait; barrier fires once', async () => {
    jobs.__test.reset();
    const a = await storage.createArtwork({ system_name: 'fam_grouping', kind: 'si', shape: null, gen_width: 128, gen_height: 128, main_object: 'orb', prompt_template: '{main_object}' });
    process.env.ART_MOCK_DELAY_MS = '400';
    await enqueueGen(a); await enqueueGen(a); await enqueueGen(a);
    await drain(120000);
    delete process.env.ART_MOCK_DELAY_MS;
    const log = jobs.__test.dispatchLog();
    const gens = log.filter((e) => e.type === 'generate');
    const mattes = log.filter((e) => e.family === 'matte');
    assert.strictEqual(gens.length, 3, '3 generation jobs dispatched');
    assert.ok(mattes.length >= 1, 'at least one matte (inspection) job dispatched, got ' + mattes.length);
    const lastGenIdx = log.map((e) => e.type).lastIndexOf('generate');
    const firstMatteIdx = log.findIndex((e) => e.family === 'matte');
    assert.ok(firstMatteIdx > lastGenIdx, 'every generation ran before any matte (families not interleaved)');
    assert.strictEqual(jobs.__test.barrierRuns(), 1, 'exactly one gen->matte barrier, got ' + jobs.__test.barrierRuns());
  });
}

async function t2() {
  await AT('REQ-0233 barrier fires once PER gen->matte switch; matte->generation needs none', async () => {
    jobs.__test.reset();
    const a = await storage.createArtwork({ system_name: 'fam_switch', kind: 'si', shape: null, gen_width: 128, gen_height: 128, main_object: 'orb', prompt_template: '{main_object}' });
    process.env.ART_MOCK_DELAY_MS = '300';
    // Batch A: one generation -> its inspections -> one gen->matte barrier.
    await enqueueGen(a);
    await drain(90000);
    assert.strictEqual(jobs.__test.barrierRuns(), 1, 'batch A: one barrier');
    assert.strictEqual(jobs.__test.currentFamily(), 'matte', 'batch A ends in the matte family');
    // Batch B: another generation. matte->gen switch is FREE (no barrier); the
    // generation then finishes and its inspections trigger a SECOND barrier.
    await enqueueGen(a);
    await drain(90000);
    delete process.env.ART_MOCK_DELAY_MS;
    assert.strictEqual(jobs.__test.barrierRuns(), 2, 'batch B adds exactly one more barrier (matte->gen was free), got ' + jobs.__test.barrierRuns());
  });
}

(async () => {
  await t1();
  await t2();
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
