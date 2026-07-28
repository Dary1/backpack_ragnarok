// backpack_ragnarok -- server/tests/artqueue_test.cjs
// REQ-0156 gates G1 (listArtworks aggregates) and G3 (queue semantics:
// cancel-pending removes exactly that job, cancel-running kills the worker
// and the pump advances, canceled render = failed + 'canceled by user',
// adopted render stays undeletable). Same rig as artwork_test.cjs:
// Postgres-backed, SKIPPED cleanly when DATABASE_URL is unset, homedir
// remapped BEFORE requiring storage so the namespace never collides with
// live/e2e rows, ART_ROUTE_MOCK=1 (no GPU) + temp stand-in model files.
// ART_MOCK_DELAY_MS (art_job.py, REQ-0156) holds mock jobs in the queue
// long enough for the cancel paths to be observable.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP artqueue_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';
process.env.ART_ROUTE_MOCK = '1';
// REQ-0233: the pump now restarts comfyui.service on a generation->matte
// family switch; disable that real side effect in this hermetic test.
process.env.ART_FAMILY_BARRIER = '0';

// Isolated namespace: remap homedir before requiring storage so NAMESPACE is
// unique to this run and never collides with live/e2e artwork rows.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-artq-test-'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

// Temp model dir with tiny stand-in files named exactly like the real models.
const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-artq-models-'));
for (const f of ['flux-2-klein-4b-Q8_0.gguf', 'qwen_3_4b.safetensors', 'flux2-vae.safetensors']) {
  fs.writeFileSync(path.join(modelDir, f), 'STANDIN-' + f);
}
process.env.ART_MODEL_DIR = modelDir;

const storage = require('../storage.cjs');
const jobs = require('../services/art_jobs.cjs');

let pass = 0, fail = 0;
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function waitForRender(name, seed, ms) {
  const deadline = Date.now() + (ms || 30000);
  while (Date.now() < deadline) {
    const art = await storage.getArtworkByName(name);
    const rs = await storage.listRenders(art.id);
    const r = rs.find((x) => x.seed === seed);
    if (r && (r.status === 'ok' || r.status === 'failed')) return r;
    await sleep(150);
  }
  throw new Error('render seed ' + seed + ' did not finish in time');
}

async function runAggregates() {
  await AT('G1 listArtworks aggregates: adopted_seed / latest_ok_seed / counts / last_render_at', async () => {
    // rows built directly through the storage chokepoint (no queue needed)
    const a = await storage.createArtwork({ system_name: 'agg_a', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    await storage.createArtwork({ system_name: 'agg_empty', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    const r1 = await storage.createRender(a.id, null, 'queued');
    const r2 = await storage.createRender(a.id, null, 'queued');
    const r3 = await storage.createRender(a.id, null, 'queued');
    await storage.updateRenderResult(r1.id, { status: 'ok', image: Buffer.from('a'), image_sha256: 'aa', final_prompt: 'p', params: {}, error: null });
    await storage.updateRenderResult(r2.id, { status: 'ok', image: Buffer.from('b'), image_sha256: 'bb', final_prompt: 'p', params: {}, error: null });
    await storage.updateRenderResult(r3.id, { status: 'failed', error: 'boom' });
    await storage.adoptRender('agg_a', r1.seed);
    const list = await storage.listArtworks();
    const row = list.find((x) => x.system_name === 'agg_a');
    assert.ok(row, 'agg_a listed');
    assert.strictEqual(row.adopted_seed, r1.seed, 'adopted_seed = adopted render seed');
    assert.strictEqual(row.latest_ok_seed, r2.seed, 'latest_ok_seed = most recent ok render');
    assert.strictEqual(row.render_count, 3, 'render_count');
    assert.strictEqual(row.ok_count, 2, 'ok_count');
    assert.strictEqual(row.failed_count, 1, 'failed_count');
    assert.ok(row.last_render_at != null, 'last_render_at present');
    const empty = list.find((x) => x.system_name === 'agg_empty');
    assert.strictEqual(empty.adopted_seed, null);
    assert.strictEqual(empty.latest_ok_seed, null);
    assert.strictEqual(empty.render_count, 0);
    assert.strictEqual(empty.ok_count, 0);
    assert.strictEqual(empty.failed_count, 0);
    assert.strictEqual(empty.last_render_at, null);
    // REQ-0151 row shape preserved (additive change only)
    assert.strictEqual(row.gen_width, 256);
    assert.ok(row.adopted_render_id != null);
  });
}

async function runCancelPending() {
  await AT('G3 cancel-pending removes exactly that job; render failed \'canceled by user\'; rest complete', async () => {
    process.env.ART_MOCK_DELAY_MS = '3000'; // hold each mock job ~3 s
    const a = await storage.createArtwork({ system_name: 'q_pend', kind: 'si', shape: null, gen_width: 256, gen_height: 256, main_object: 'orb', prompt_template: '{main_object}' });
    const r1 = await storage.createRender(a.id, null, 'queued');
    const r2 = await storage.createRender(a.id, null, 'queued');
    const r3 = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r1.id, artwork: a, seed: r1.seed, tiling: false });
    jobs.enqueue({ renderId: r2.id, artwork: a, seed: r2.seed, tiling: false });
    jobs.enqueue({ renderId: r3.id, artwork: a, seed: r3.seed, tiling: false });
    // r1 is in flight (pump starts synchronously); r2 + r3 are pending
    let snap = jobs.listJobs();
    assert.ok(snap.running && snap.running.renderId === r1.id, 'r1 running');
    assert.deepStrictEqual(snap.pending.map((p) => p.renderId), [r2.id, r3.id], 'r2+r3 pending');
    assert.strictEqual(snap.pending[0].artwork, 'q_pend', 'pending metadata carries system_name');
    assert.ok(snap.pending[0].enqueued_at > 0, 'pending metadata carries enqueued_at');
    const out = await jobs.cancelJob(r2.id);
    assert.strictEqual(out.canceled, 'pending');
    snap = jobs.listJobs();
    assert.deepStrictEqual(snap.pending.map((p) => p.renderId), [r3.id], 'exactly r2 removed');
    const c = await waitForRender('q_pend', r2.seed, 5000);
    assert.strictEqual(c.status, 'failed');
    assert.strictEqual(c.error, 'canceled by user');
    // the untouched jobs still complete (pump unaffected)
    assert.strictEqual((await waitForRender('q_pend', r1.seed, 30000)).status, 'ok');
    assert.strictEqual((await waitForRender('q_pend', r3.seed, 30000)).status, 'ok');
    delete process.env.ART_MOCK_DELAY_MS;
  });
}

async function runCancelRunning() {
  await AT('G3 cancel-running kills the worker (fast), render \'canceled by user\', pump advances', async () => {
    process.env.ART_MOCK_DELAY_MS = '8000'; // job would take ~8 s uncancelled
    const a = await storage.createArtwork({ system_name: 'q_run', kind: 'si', shape: null, gen_width: 256, gen_height: 256, main_object: 'gem', prompt_template: '{main_object}' });
    const r1 = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r1.id, artwork: a, seed: r1.seed, tiling: false });
    const t0 = Date.now();
    // wait until the job is observably running (status flipped => the child
    // spawn is imminent/done), then cancel it mid-flight
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rs = await storage.listRenders(a.id);
      if (rs.find((x) => x.seed === r1.seed).status === 'running') break;
      await sleep(50);
    }
    await sleep(300);
    const snap = jobs.listJobs();
    assert.ok(snap.running && snap.running.renderId === r1.id, 'listJobs shows the running job');
    assert.ok(snap.running.elapsed_ms >= 0 && snap.running.artwork === 'q_run', 'running metadata present');
    const out = await jobs.cancelJob(r1.id);
    assert.strictEqual(out.canceled, 'running');
    const c = await waitForRender('q_run', r1.seed, 10000);
    assert.strictEqual(c.status, 'failed');
    assert.strictEqual(c.error, 'canceled by user');
    assert.ok(Date.now() - t0 < 6000, 'kill was immediate (did not sit out the 8 s sleep)');
    // pump advances: a follow-up (fast) job completes normally
    delete process.env.ART_MOCK_DELAY_MS;
    const r2 = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r2.id, artwork: a, seed: r2.seed, tiling: false });
    assert.strictEqual((await waitForRender('q_run', r2.seed, 30000)).status, 'ok');
    // a finished job is neither pending nor running -> cancel 404s
    let nf = null;
    try { await jobs.cancelJob(r2.id); } catch (e) { nf = e; }
    assert.ok(nf && nf.code === 'NOT_FOUND', 'cancel of a finished job -> NOT_FOUND');
  });
}

async function runDeferred() {
  await AT('G5 REQ-0197 hold gates generation; executeBatch releases grouped by prompt; held cancel works; unhold drains', async () => {
    const a = await storage.createArtwork({ system_name: 'q_hold_a', kind: 'si', shape: null, gen_width: 256, gen_height: 256, main_object: 'axe', prompt_template: '{main_object}' });
    const b = await storage.createArtwork({ system_name: 'q_hold_b', kind: 'si', shape: null, gen_width: 256, gen_height: 256, main_object: 'bow', prompt_template: '{main_object}' });
    jobs.setHold(true);
    const ra1 = await storage.createRender(a.id, null, 'queued');
    const rb1 = await storage.createRender(b.id, null, 'queued');
    const ra2 = await storage.createRender(a.id, null, 'queued');
    const rb2 = await storage.createRender(b.id, null, 'queued');
    // interleaved on purpose: a, b, a, b -- the release must group a,a then b
    jobs.enqueue({ renderId: ra1.id, artwork: a, seed: ra1.seed, tiling: false });
    jobs.enqueue({ renderId: rb1.id, artwork: b, seed: rb1.seed, tiling: false });
    jobs.enqueue({ renderId: ra2.id, artwork: a, seed: ra2.seed, tiling: false });
    jobs.enqueue({ renderId: rb2.id, artwork: b, seed: rb2.seed, tiling: false });
    await sleep(300);
    let snap = jobs.listJobs();
    assert.strictEqual(snap.held, true, 'held flag on');
    assert.strictEqual(snap.running, null, 'nothing starts while held');
    assert.deepStrictEqual(snap.pending, [], 'live queue stays empty while held');
    assert.deepStrictEqual(snap.heldPending.map((p) => p.renderId), [ra1.id, rb1.id, ra2.id, rb2.id], 'held set in enqueue order');
    assert.strictEqual(snap.heldPending[0].artwork, 'q_hold_a', 'held metadata carries system_name');
    assert.strictEqual(jobs.queueDepth(), 4, 'held jobs still count in the queue depth badge');
    const rsA = await storage.listRenders(a.id);
    assert.ok(rsA.every((x) => x.status === 'queued'), 'held renders stay status queued');
    // a held job cancels exactly like a pending one
    const out = await jobs.cancelJob(rb2.id);
    assert.strictEqual(out.canceled, 'pending');
    const c = await waitForRender('q_hold_b', rb2.seed, 5000);
    assert.strictEqual(c.status, 'failed');
    assert.strictEqual(c.error, 'canceled by user');
    // execute batch: held a,b,a releases as a,a,b (groups in first-enqueued order)
    process.env.ART_MOCK_DELAY_MS = '2000'; // hold job 1 long enough to observe the order
    const res = jobs.executeBatch();
    assert.strictEqual(res.released, 3, 'exactly the held jobs released');
    snap = jobs.listJobs();
    assert.ok(snap.running && snap.running.renderId === ra1.id, 'first group leader runs first');
    assert.deepStrictEqual(snap.pending.map((p) => p.renderId), [ra2.id, rb1.id], 'same-prompt job jumped ahead of the earlier-enqueued other group');
    assert.strictEqual(snap.held, true, 'executeBatch stays in hold mode');
    delete process.env.ART_MOCK_DELAY_MS;
    assert.strictEqual((await waitForRender('q_hold_a', ra1.seed, 30000)).status, 'ok');
    assert.strictEqual((await waitForRender('q_hold_a', ra2.seed, 30000)).status, 'ok');
    assert.strictEqual((await waitForRender('q_hold_b', rb1.seed, 30000)).status, 'ok');
    // jobs enqueued after the execute keep waiting for the NEXT execute/unhold
    const rb3 = await storage.createRender(b.id, null, 'queued');
    jobs.enqueue({ renderId: rb3.id, artwork: b, seed: rb3.seed, tiling: false });
    await sleep(300);
    snap = jobs.listJobs();
    assert.deepStrictEqual(snap.heldPending.map((p) => p.renderId), [rb3.id], 'post-execute enqueue is held for the next batch');
    assert.strictEqual(snap.running, null, 'it does not start on its own');
    // unhold: releases the remainder and resumes auto-run
    jobs.setHold(false);
    assert.strictEqual((await waitForRender('q_hold_b', rb3.seed, 30000)).status, 'ok');
    snap = jobs.listJobs();
    assert.strictEqual(snap.held, false, 'hold off');
    const rb4 = await storage.createRender(b.id, null, 'queued');
    jobs.enqueue({ renderId: rb4.id, artwork: b, seed: rb4.seed, tiling: false });
    assert.strictEqual((await waitForRender('q_hold_b', rb4.seed, 30000)).status, 'ok', 'auto-run restored');
  });
}

async function runAdoptedStillSafe() {
  await AT('G3 adopted render remains undeletable after cancels exist', async () => {
    const a = await storage.createArtwork({ system_name: 'q_adopt', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    const r1 = await storage.createRender(a.id, null, 'queued');
    await storage.updateRenderResult(r1.id, { status: 'ok', image: Buffer.from('x'), image_sha256: 'xx', final_prompt: 'p', params: {}, error: null });
    await storage.adoptRender('q_adopt', r1.seed);
    let refused = null;
    try { await storage.deleteRender('q_adopt', r1.seed); } catch (e) { refused = e; }
    assert.ok(refused && refused.code === 'ADOPTED_UNDELETABLE', 'adopted delete refused');
  });
}

(async () => {
  await storage.clearAllArtworks();
  await runAggregates();
  await runCancelPending();
  await runCancelRunning();
  await runDeferred();
  await runAdoptedStillSafe();
  await storage.clearAllArtworks();
  await storage.closeArtPool();
  os.homedir = realHome;
  console.log('\nartqueue_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });


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
