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
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
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
  await runAdoptedStillSafe();
  await storage.clearAllArtworks();
  await storage.closeArtPool();
  os.homedir = realHome;
  console.log('\nartqueue_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
