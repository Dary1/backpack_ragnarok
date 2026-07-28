// backpack_ragnarok -- server/tests/artwork_test.cjs
// REQ-0151 gates G1 (chokepoint + migration + constraints), G2 (sizing law),
// G3 (provenance). Postgres-backed: SKIPPED cleanly when DATABASE_URL is
// unset (same SKIP_PG discipline as the pg pass of api_test.cjs). Generation
// runs through the REAL serialized queue + art_job.py, with ART_ROUTE_MOCK=1
// (no GPU) and a temp ART_MODEL_DIR of tiny stand-in model files so model
// content hashes are genuine + present.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (!process.env.DATABASE_URL) { console.log('SKIP artwork_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';
process.env.ART_ROUTE_MOCK = '1';

// Isolated namespace: remap homedir before requiring storage so NAMESPACE is
// unique to this run and never collides with live/e2e artwork rows.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-art-test-'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

// Temp model dir with tiny stand-in files named exactly like the real models.
const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-art-models-'));
for (const f of ['flux-2-klein-4b-Q8_0.gguf', 'qwen_3_4b.safetensors', 'flux2-vae.safetensors']) {
  fs.writeFileSync(path.join(modelDir, f), 'STANDIN-' + f);
}
process.env.ART_MODEL_DIR = modelDir;

const storage = require('../storage.cjs');
const jobs = require('../services/art_jobs.cjs');
const { deriveSize } = require('../services/art_sizing.cjs');
const art = require('../routes/art.cjs'); // REQ-0280: shapeAndSize + forcedTiling gates
const REPO = path.join(__dirname, '..', '..');
const ROUTE_CONSTS = JSON.parse(execFileSync('python3', ['-c',
  "import sys,json;sys.path.insert(0,'tools');import art_route as R;print(json.dumps({'steps':R.STEPS,'cfg':R.CFG,'sampler':R.SAMPLER,'unet':R.FLUX['unet'],'clip':R.FLUX['clip'],'vae':R.FLUX['vae']}))"],
  { cwd: REPO }).toString());

let pass = 0, fail = 0;
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
function sizeOf(cells) { const m = Array.from({ length: 5 }, () => Array(5).fill(false)); cells.forEach(([r, c]) => { m[r][c] = true; }); return deriveSize('po', { mask: m }); }

async function waitForRender(name, seed, ms, variant) {
  const v = variant == null ? 0 : variant;
  const deadline = Date.now() + (ms || 20000);
  while (Date.now() < deadline) {
    const art = await storage.getArtworkByName(name);
    const rs = await storage.listRenders(art.id);
    // REQ-0223: pin the variant -- a bare seed match would resolve a twin's
    // SIBLING and let an A/B assertion pass against the wrong render.
    const r = rs.find((x) => x.seed === seed && Number(x.variant) === v);
    if (r && (r.status === 'ok' || r.status === 'failed')) return r;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error('render seed ' + seed + (v ? ' variant ' + v : '') + ' did not finish in time');
}

function maskOf(cells) { const m = Array.from({ length: 5 }, () => Array(5).fill(false)); cells.forEach(([r, c]) => { m[r][c] = true; }); return m; }

async function runG2andG1() {
  await AT('G2 sizing law reproduces the ratified examples', async () => {
    assert.deepStrictEqual(sizeOf([[0, 0], [1, 0], [2, 0]]), { width: 256, height: 768 });
    assert.deepStrictEqual(sizeOf([[0, 0], [0, 1], [1, 0], [1, 1]]), { width: 512, height: 512 });
    assert.deepStrictEqual(sizeOf([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]), { width: 512, height: 768 });
    assert.deepStrictEqual(sizeOf([[0, 0], [1, 0]]), { width: 256, height: 512 });
    assert.deepStrictEqual(deriveSize('si', null), { width: 256, height: 256 });
    assert.deepStrictEqual(deriveSize('monster', { w: 3, h: 4 }), { width: 384, height: 512 });
    assert.deepStrictEqual(deriveSize('monster', { w: 6, h: 4 }), { width: 768, height: 512 });
    assert.deepStrictEqual(deriveSize('monster', { w: 10, h: 10 }), { width: 1280, height: 1280 });
    assert.deepStrictEqual(deriveSize('unit', null), { width: 512, height: 512 });
    assert.deepStrictEqual(deriveSize('bpskin', null), { width: 1024, height: 1024 });
    // REQ-0179: custom -- operator-set resolution, /16-snapped and clamped to [16, 16384].
    assert.deepStrictEqual(deriveSize('custom', { width: 1000, height: 700 }), { width: 1008, height: 704 });
    assert.deepStrictEqual(deriveSize('custom', { width: 512, height: 512 }), { width: 512, height: 512 });
    assert.deepStrictEqual(deriveSize('custom', { width: 20000, height: 16 }), { width: 16384, height: 16 });
    assert.throws(() => deriveSize('custom', { width: 0, height: 10 }), /positive integers/);
    assert.throws(() => deriveSize('custom', null), /positive integers/);
    // REQ-0280 / REQ-0264 s8.1: vfx role-derived LOCKED sizes + BAD_SHAPE on a bad role.
    assert.deepStrictEqual(deriveSize('vfx', { role: 'ray' }), { width: 256, height: 64 });
    assert.deepStrictEqual(deriveSize('vfx', { role: 'hit' }), { width: 256, height: 256 });
    for (const bad of [{ role: 'beam' }, {}, null]) {
      let e = null; try { deriveSize('vfx', bad); } catch (x) { e = x; }
      assert.ok(e && e.code === 'BAD_SHAPE', 'vfx bad role -> BAD_SHAPE: ' + JSON.stringify(bad));
    }
    // route validation (shapeAndSize) + the always-tiled ray law (forcedTiling).
    assert.deepStrictEqual(art.shapeAndSize('vfx', { role: 'ray' }), { shape: { role: 'ray' }, size: { width: 256, height: 64 } });
    { let e = null; try { art.shapeAndSize('vfx', {}); } catch (x) { e = x; } assert.ok(e && e.code === 'BAD_SHAPE', 'shapeAndSize vfx {} -> BAD_SHAPE'); }
    assert.strictEqual(art.forcedTiling({ kind: 'vfx', shape: { role: 'ray' } }, undefined), true, 'a ray is forced-tiled');
    assert.strictEqual(art.forcedTiling({ kind: 'vfx', shape: { role: 'hit' } }, undefined), false, 'a hit is not forced-tiled');
    assert.strictEqual(art.forcedTiling({ kind: 'vfx', shape: { role: 'hit' } }, true), true, 'a hit still honours an operator tiling opt-in');
    assert.strictEqual(art.forcedTiling({ kind: 'bpskin' }, undefined), true, 'bpskin unchanged (forced)');
    assert.strictEqual(art.forcedTiling({ kind: 'si' }, undefined), false, 'si unchanged (operator choice)');
    // REQ-0292: skill_icon is a LOCKED 256x256 still (no shape/role), never force-tiled.
    assert.deepStrictEqual(deriveSize('skill_icon', null), { width: 256, height: 256 });
    assert.deepStrictEqual(art.shapeAndSize('skill_icon', null), { shape: null, size: { width: 256, height: 256 } });
    assert.strictEqual(art.forcedTiling({ kind: 'skill_icon' }, undefined), false, 'skill_icon never force-tiled');
    assert.strictEqual(art.forcedTiling({ kind: 'skill_icon' }, true), true, 'skill_icon honours an operator tiling opt-in');
  });
  await AT('G1 system_name is UNIQUE (duplicate refused at storage)', async () => {
    await storage.createArtwork({ system_name: 'g1_uniq', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    let threw = null;
    try { await storage.createArtwork({ system_name: 'g1_uniq', kind: 'si', shape: null, gen_width: 256, gen_height: 256 }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'DUPLICATE', 'duplicate system_name refused');
  });
  await AT('G1 per-artwork seed = max+1, explicit seed allowed, UNIQUE(artwork,seed)', async () => {
    const a = await storage.createArtwork({ system_name: 'g1_seed', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    assert.strictEqual((await storage.createRender(a.id, null, 'queued')).seed, 1);
    assert.strictEqual((await storage.createRender(a.id, null, 'queued')).seed, 2);
    assert.strictEqual((await storage.createRender(a.id, 5, 'queued')).seed, 5);
    assert.strictEqual((await storage.createRender(a.id, null, 'queued')).seed, 6);
    let dup = null;
    try { await storage.createRender(a.id, 5, 'queued'); } catch (e) { dup = e; }
    assert.ok(dup && dup.code === 'DUPLICATE_SEED', 'duplicate seed refused');
  });
  await AT('REQ-0177 sentinel seed guard: auto-seed excludes 2147483647 (no int4 overflow)', async () => {
    const a = await storage.createArtwork({ system_name: 'g1_sentinel', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    // A sprite-backfill render carries the int4-max sentinel seed 2147483647
    // ("imported from an unknown environment").
    const sent = await storage.createRender(a.id, 2147483647, 'ok');
    assert.strictEqual(sent.seed, 2147483647, 'sentinel render stored at int4 max');
    // The NEXT auto-seed (seed=null) must NOT be 2147483648 (int4 overflow):
    // MAX(seed) FILTER (seed < 2147483647) is NULL here, so COALESCE(...,0)+1 = 1.
    const next = await storage.createRender(a.id, null, 'queued');
    assert.strictEqual(next.seed, 1, 'auto-seed after a lone sentinel is 1, not 2147483648');
    // With a real render present too, the auto-seed is max(non-sentinel)+1 = 2.
    const next2 = await storage.createRender(a.id, null, 'queued');
    assert.strictEqual(next2.seed, 2, 'auto-seed still ignores the sentinel with real renders present');
  });
  await AT('G1 adopted render undeletable in storage; non-adopted deletable; switch re-adopt', async () => {
    const a = await storage.createArtwork({ system_name: 'g1_adopt', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    const r1 = await storage.createRender(a.id, null, 'queued');
    const r2 = await storage.createRender(a.id, null, 'queued');
    await storage.updateRenderResult(r1.id, { status: 'ok', image: Buffer.from('a'), image_sha256: 'aa', final_prompt: 'p', params: {}, error: null });
    await storage.updateRenderResult(r2.id, { status: 'ok', image: Buffer.from('b'), image_sha256: 'bb', final_prompt: 'p', params: {}, error: null });
    await storage.adoptRender('g1_adopt', r1.seed);
    let refused = null;
    try { await storage.deleteRender('g1_adopt', r1.seed); } catch (e) { refused = e; }
    assert.ok(refused && refused.code === 'ADOPTED_UNDELETABLE', 'adopted delete refused');
    await storage.deleteRender('g1_adopt', r2.seed);
    const r3 = await storage.createRender(a.id, null, 'queued');
    await storage.updateRenderResult(r3.id, { status: 'ok', image: Buffer.from('c'), image_sha256: 'cc', final_prompt: 'p', params: {}, error: null });
    await storage.adoptRender('g1_adopt', r3.seed);
    await storage.deleteRender('g1_adopt', r1.seed);
  });
}

// REQ-0223 -- the same-seed A/B gate.
async function runG0223() {
  await AT('REQ-0223 twin: same seed again is a NEW variant, not DUPLICATE_SEED', async () => {
    const a = await storage.createArtwork({ system_name: 'r223_twin', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    const v0 = await storage.createRender(a.id, 7, 'queued');
    assert.strictEqual(v0.variant, 0, 'a first render lands on variant 0');
    const v1 = await storage.createRender(a.id, 7, 'queued', { twin: true });
    assert.strictEqual(v1.seed, 7, 'the twin keeps the SEED -- that is the whole point');
    assert.strictEqual(v1.variant, 1, 'the twin takes the next slot');
    const v2 = await storage.createRender(a.id, 7, 'queued', { twin: true });
    assert.strictEqual(v2.variant, 2, 'slots keep climbing; repeated presses stack');
    assert.notStrictEqual(String(v0.id), String(v1.id), 'twins are distinct rows -- no render was overwritten');
  });
  await AT('REQ-0223 dedupe survives: same seed WITHOUT twin still refused', async () => {
    const a = await storage.createArtwork({ system_name: 'r223_dedupe', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    await storage.createRender(a.id, 3, 'queued');
    let dup = null;
    try { await storage.createRender(a.id, 3, 'queued'); } catch (e) { dup = e; }
    assert.ok(dup && dup.code === 'DUPLICATE_SEED', 'an ACCIDENTAL re-press is still an error -- twins are opt-in');
    // ... and an auto-seed ignores `twin` entirely: a fresh seed's only honest slot is 0.
    const auto = await storage.createRender(a.id, null, 'queued', { twin: true });
    assert.strictEqual(auto.variant, 0, 'auto-seed is fresh, so it cannot be anyone twin');
  });
  await AT('REQ-0223 addressing: a bare seed still means variant 0; twins address independently', async () => {
    const a = await storage.createArtwork({ system_name: 'r223_addr', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    const v0 = await storage.createRender(a.id, 4, 'queued');
    const v1 = await storage.createRender(a.id, 4, 'queued', { twin: true });
    await storage.updateRenderResult(v0.id, { status: 'ok', image: Buffer.from('V0'), image_sha256: 'v0', final_prompt: 'p', params: { shape_lock: 'strict' }, error: null });
    await storage.updateRenderResult(v1.id, { status: 'ok', image: Buffer.from('V1'), image_sha256: 'v1', final_prompt: 'p', params: { shape_lock: 'off' }, error: null });
    // The legacy call shape -- no variant argument anywhere -- must still work.
    const bare = await storage.getRenderImageBySeed('r223_addr', 4);
    assert.strictEqual(bare.image.toString(), 'V0', 'a bare seed resolves variant 0, exactly as before twins existed');
    const twin = await storage.getRenderImageBySeed('r223_addr', 4, 1);
    assert.strictEqual(twin.image.toString(), 'V1', 'the twin is reachable by variant');
    // Adopting the A/B winner = adopting the other variant of the SAME seed.
    await storage.adoptRender('r223_addr', 4, 1);
    let refused = null;
    try { await storage.deleteRender('r223_addr', 4, 1); } catch (e) { refused = e; }
    assert.ok(refused && refused.code === 'ADOPTED_UNDELETABLE', 'the adopted TWIN is undeletable -- adoption keys on the row, not the seed');
    await storage.deleteRender('r223_addr', 4);   // variant 0, not adopted -> deletable
    const left = await storage.listRenders(a.id);
    assert.deepStrictEqual(left.map((r) => r.variant), [1], 'deleting variant 0 left its twin alone');
  });
  await AT('REQ-0223 listRenders orders (seed, variant): twins arrive adjacent, in slot order', async () => {
    const a = await storage.createArtwork({ system_name: 'r223_order', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    await storage.createRender(a.id, 2, 'queued');
    await storage.createRender(a.id, 1, 'queued');
    await storage.createRender(a.id, 1, 'queued', { twin: true });
    await storage.createRender(a.id, 2, 'queued', { twin: true });
    const rs = await storage.listRenders(a.id);
    assert.deepStrictEqual(rs.map((r) => r.seed + '/' + r.variant), ['1/0', '1/1', '2/0', '2/1'],
      'the A/B strip is a fold over this order, so twins must be adjacent and slot-ordered');
  });
  await AT('REQ-0223 TRUE same-seed A/B: one seed, two locks, both provenances intact', async () => {
    // This is the pair REQ-0187 could not produce. It had to burn disjoint seed
    // ranges (501-503 strict vs 511-512 off), so lock effect and seed effect were
    // confounded in every comparison it recorded. Here the seed is HELD FIXED and
    // only the lock moves, which is what makes the comparison mean anything.
    const a = await storage.createArtwork({ system_name: 'r223_ab', kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0], [2, 0]]) }, gen_width: 256, gen_height: 768, main_object: 'iron sword', prompt_template: '{main_object}, white background, bold outline' });
    const SEED = 42;
    const strict = await storage.createRender(a.id, SEED, 'queued');
    jobs.enqueue({ renderId: strict.id, artwork: a, seed: strict.seed, tiling: false, shapeOverride: { shape_lock: 'strict', shape_dilation_px: 8 } });
    const dStrict = await waitForRender('r223_ab', SEED, 30000, 0);
    // Same seed, second lock -- the press that used to die on DUPLICATE_SEED.
    const off = await storage.createRender(a.id, SEED, 'queued', { twin: true });
    jobs.enqueue({ renderId: off.id, artwork: a, seed: off.seed, tiling: false, shapeOverride: { shape_lock: 'off' } });
    const dOff = await waitForRender('r223_ab', SEED, 30000, 1);

    assert.strictEqual(dStrict.seed, dOff.seed, 'A and B share a seed -- the pair is a TRUE A/B');
    assert.notStrictEqual(dStrict.variant, dOff.variant, '... distinguished only by variant');
    assert.strictEqual(dStrict.status, 'ok', 'A rendered');
    assert.strictEqual(dOff.status, 'ok', 'B rendered');
    // Provenance stays honest per variant (REQ-0186 records the RESOLVED lock).
    assert.strictEqual(dStrict.params.shape_lock, 'strict', 'A records its resolved lock');
    assert.strictEqual(dOff.params.shape_lock, 'off', 'B records its resolved lock');
    assert.strictEqual(dStrict.params.seed, dOff.params.seed, 'both params agree on the shared seed');
    // The lock is the ONLY difference -- otherwise the A/B still would not isolate it.
    assert.strictEqual(dStrict.params.steps, dOff.params.steps, 'A/B differs in the lock, not the recipe');
    assert.strictEqual(dStrict.final_prompt !== dOff.final_prompt, true, 'strict renders an edit instruction, off does not -- the delta under test');
  });
}

async function runG3andFlow() {
  await AT('G3 provenance: params == art_route constants; verbatim final_prompt; model hashes present; DB image round-trips', async () => {
    const a = await storage.createArtwork({ system_name: 'g3_sword', kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0], [2, 0]]) }, gen_width: 256, gen_height: 768, main_object: 'iron sword', prompt_template: '{main_object}, white background, bold outline' });
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: false });
    const done = await waitForRender('g3_sword', r.seed, 30000);
    assert.strictEqual(done.status, 'ok', 'render ok: ' + done.error);
    const p = done.params;
    assert.strictEqual(p.steps, ROUTE_CONSTS.steps, 'steps == route');
    assert.strictEqual(p.cfg, ROUTE_CONSTS.cfg, 'cfg == route');
    assert.strictEqual(p.sampler, ROUTE_CONSTS.sampler, 'sampler == route');
    assert.strictEqual(p.models.unet.file, ROUTE_CONSTS.unet);
    assert.strictEqual(p.models.clip.file, ROUTE_CONSTS.clip);
    assert.strictEqual(p.models.vae.file, ROUTE_CONSTS.vae);
    for (const k of ['unet', 'clip', 'vae']) assert.ok(/^[0-9a-f]{64}$/.test(p.models[k].sha256), k + ' sha256 present');
    assert.deepStrictEqual(p.size, { width: 256, height: 768 });
    // REQ-0183: the preview must be handed the SAME inputs generation got --
    // including the shape -- or it composes a different prompt and this
    // verbatim check compares two unlike things. routes/art.cjs hPreview passes
    // the artwork's shape for exactly this reason; mirror it here.
    const prev = await jobs.runPython({ kind: 'po', main_object: 'iron sword', prompt_template: '{main_object}, white background, bold outline', style_override: null, width: 256, height: 768, seed: done.seed, shape: a.shape, mode: 'preview' });
    assert.strictEqual(done.final_prompt, prev.final_prompt, 'final_prompt stored verbatim');
    const img = await storage.getRenderImageBySeed('g3_sword', done.seed);
    assert.ok(Buffer.isBuffer(img.image) && img.image.length > 0, 'image bytes in DB');
    const crypto = require('crypto');
    assert.strictEqual(crypto.createHash('sha256').update(img.image).digest('hex'), done.image_sha256, 'stored image sha matches');
  });
  await AT('flow: generate->adopt->export fires->serve->delete rules->re-adopt switches', async () => {
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-art-export-'));
    process.env.ART_EXPORT_ROOT = exportRoot;
    const { exportAdopted } = require('../services/art_export.cjs');
    const a = await storage.createArtwork({ system_name: 'flow_pot', kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0]]) }, gen_width: 256, gen_height: 512, main_object: 'potion', prompt_template: '{main_object}, white background, bold outline' });
    const r1 = await storage.createRender(a.id, null, 'queued'); jobs.enqueue({ renderId: r1.id, artwork: a, seed: r1.seed, tiling: false });
    await waitForRender('flow_pot', r1.seed, 30000);
    const r2 = await storage.createRender(a.id, null, 'queued'); jobs.enqueue({ renderId: r2.id, artwork: a, seed: r2.seed, tiling: false });
    await waitForRender('flow_pot', r2.seed, 30000);
    await storage.adoptRender('flow_pot', r1.seed);
    const rec = await exportAdopted('flow_pot');
    assert.ok(fs.existsSync(rec.path), 'exported adopted PNG exists');
    let refused = null;
    try { await storage.deleteRender('flow_pot', r1.seed); } catch (e) { refused = e; }
    assert.ok(refused && refused.code === 'ADOPTED_UNDELETABLE', 'adopted delete refused mid-flow');
    await storage.adoptRender('flow_pot', r2.seed);
    const adopted2 = await storage.getAdoptedRender('flow_pot');
    assert.strictEqual(adopted2.seed, r2.seed, 're-adopt switched adopted seed');
    await exportAdopted('flow_pot');
    await storage.deleteRender('flow_pot', r1.seed);
  });
  await AT('REQ-0183 po generation is shape-conditioned: mask reaches the route; prompt is an edit instruction; provenance recorded', async () => {
    // The L-tromino the REQ-0153 spike proved the unconditioned route misses.
    const a = await storage.createArtwork({ system_name: 'shape_axe', kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0], [1, 1]]) }, gen_width: 512, gen_height: 512, main_object: 'battle axe', prompt_template: '{main_object}, white background, bold outline' });
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: false });
    const done = await waitForRender('shape_axe', r.seed, 30000);
    assert.strictEqual(done.status, 'ok', 'render ok: ' + done.error);
    // The shape reached GENERATION (it used to reach only the inspection kits).
    assert.strictEqual(done.params.shape_conditioned, true, 'render recorded as shape-conditioned');
    assert.strictEqual(done.params.shape_dilation_px, 8, 'dilation D=8 (the REQ-0153 verdict) recorded');
    // The prompt is the REQ-0153 edit instruction, not a bare subject: klein is
    // being asked to edit the gray scaffold riding along as a ReferenceLatent.
    assert.ok(/^Turn the gray shape into /.test(done.final_prompt), 'prompt is a shape-edit instruction: ' + done.final_prompt);
    assert.ok(/Keep the silhouette exactly/.test(done.final_prompt), 'prompt keeps the silhouette directive');
    assert.ok(/battle axe/.test(done.final_prompt), 'prompt still carries the subject');
    // Opting out returns the byte-identical unconditioned prompt.
    const off = await jobs.runPython({ kind: 'po', main_object: 'battle axe', prompt_template: '{main_object}, white background, bold outline', style_override: null, width: 512, height: 512, seed: 1, shape: a.shape, shape_lock: 'off', mode: 'preview' });
    assert.strictEqual(off.shape_conditioned, false, 'shape_lock:off opts out (REQ-0186 replaced the shape_conditioning seam)');
    assert.ok(!/Turn the gray shape/.test(off.final_prompt), 'opted-out prompt is the plain subject');
    // A kind with no cell shape is untouched by any of this.
    const si = await jobs.runPython({ kind: 'si', main_object: 'flame', prompt_template: '{main_object}, white background, bold outline', style_override: null, width: 256, height: 256, seed: 1, mode: 'preview' });
    assert.strictEqual(si.shape_conditioned, false, 'si is not shape-conditioned');
  });
  await AT('REQ-0220 auto lock: strict on EVERY shape (underfilled bbox and full rectangle alike)', async () => {
    // L-tromino: the shape REQ-0153 measured the baseline MISSING on -> condition it.
    const L = await storage.createArtwork({ system_name: 'lock_L', kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0], [1, 1]]) }, gen_width: 512, gen_height: 512, main_object: 'battle axe', prompt_template: '{main_object}, white background, bold outline', shape_lock: 'auto' });
    assert.strictEqual(L.shape_lock, 'auto', 'stored lock round-trips');
    const rL = await storage.createRender(L.id, null, 'queued');
    jobs.enqueue({ renderId: rL.id, artwork: L, seed: rL.seed, tiling: false });
    const dL = await waitForRender('lock_L', rL.seed, 30000);
    assert.strictEqual(dL.status, 'ok', 'L render ok: ' + dL.error);
    assert.strictEqual(dL.params.shape_lock, 'strict', 'auto resolves to strict on an L');
    assert.strictEqual(dL.params.shape_dilation_px, 8, 'default dilation recorded');
    assert.ok(/^Turn the gray shape into /.test(dL.final_prompt), 'L gets the edit instruction');

    // 2x2: REQ-0186 used to leave a full rectangle at `off`, on the claim that
    // strict turns a heater shield into a plain disc. REQ-0187 measured the
    // opposite on the production route (strict fit 81.3 vs off 71.8, 3/3 PASS
    // both, character kept), and REQ-0220 retired the split -- auto is strict
    // here too. This assertion is the regression guard for that ruling.
    const S = await storage.createArtwork({ system_name: 'lock_sq', kind: 'po', shape: { mask: maskOf([[0, 0], [0, 1], [1, 0], [1, 1]]) }, gen_width: 512, gen_height: 512, main_object: 'round shield', prompt_template: '{main_object}, white background, bold outline', shape_lock: 'auto' });
    const rS = await storage.createRender(S.id, null, 'queued');
    jobs.enqueue({ renderId: rS.id, artwork: S, seed: rS.seed, tiling: false });
    const dS = await waitForRender('lock_sq', rS.seed, 30000);
    assert.strictEqual(dS.status, 'ok', 'sq render ok: ' + dS.error);
    assert.strictEqual(dS.params.shape_lock, 'strict', 'auto resolves to strict on a full rectangle too (REQ-0220)');
    assert.strictEqual(dS.params.shape_dilation_px, 8, 'default dilation recorded on the rectangle too');
    assert.ok(/^Turn the gray shape into /.test(dS.final_prompt), 'a full rectangle now gets the edit instruction too (REQ-0220)');
  });
  await AT('REQ-0186 explicit locks + one-shot override + validation', async () => {
    const a = await storage.getArtworkByName('lock_sq');
    // An explicit lock beats auto -- including `off`, now the only way to opt a
    // full rectangle out of conditioning (REQ-0220 made auto strict everywhere).
    for (const [lock, wantPrompt] of [['off', false], ['guide', true], ['strict', true]]) {
      const p = await jobs.runPython({ kind: 'po', main_object: 'round shield', prompt_template: '{main_object}, white background, bold outline', style_override: null, width: 512, height: 512, seed: 1, shape: a.shape, shape_lock: lock, mode: 'preview' });
      assert.strictEqual(p.shape_lock, lock, 'explicit lock ' + lock + ' honoured over auto');
      assert.strictEqual(/Turn the gray shape/.test(p.final_prompt), wantPrompt, lock + ' prompt shape');
      assert.strictEqual(p.shape_conditioned, lock !== 'off', lock + ' conditioned flag');
    }
    // guide reports no dilation: it has no hard mask for a dilation to apply to.
    const g = await jobs.runPython({ kind: 'po', main_object: 'round shield', prompt_template: '{main_object}', style_override: null, width: 512, height: 512, seed: 1, shape: a.shape, shape_lock: 'guide', mode: 'preview' });
    assert.strictEqual(g.shape_dilation_px, undefined, 'guide carries no dilation');
    // The one-shot override steers the render WITHOUT touching the artwork.
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: false, shapeOverride: { shape_lock: 'strict', shape_dilation_px: 16 } });
    const d = await waitForRender('lock_sq', r.seed, 30000);
    assert.strictEqual(d.params.shape_lock, 'strict', 'override beat the artwork default');
    assert.strictEqual(d.params.shape_dilation_px, 16, 'override dilation used');
    const still = await storage.getArtworkByName('lock_sq');
    assert.strictEqual(still.shape_lock, 'auto', 'the artwork default was NOT mutated by a one-shot override');
    // Out-of-band values are refused, not silently coerced.
    for (const bad of [17, -1]) {
      const p = await jobs.runPython({ kind: 'po', main_object: 'x', prompt_template: '{main_object}', style_override: null, width: 512, height: 512, seed: 1, shape: a.shape, shape_lock: 'strict', shape_dilation_px: bad, mode: 'preview' });
      assert.strictEqual(p.status, 'failed', 'dilation ' + bad + ' refused');
    }
    const bogus = await jobs.runPython({ kind: 'po', main_object: 'x', prompt_template: '{main_object}', style_override: null, width: 512, height: 512, seed: 1, shape: a.shape, shape_lock: 'nonsense', mode: 'preview' });
    assert.strictEqual(bogus.status, 'failed', 'unknown lock refused');
  });
  // REQ-0179 custom LAST in this function: it makes no GPU render, but calls
  // jobs.runPython (preview) which spawns a python process OUTSIDE the pump's
  // serialization -- running it mid-sequence steals CPU from an in-flight rembg
  // inspection and flakes the render-timeout of the NEXT test. Kept last so it
  // perturbs nothing that waits on a render.
  await AT('REQ-0179 custom: operator-set resolution snapped+stored; final_prompt verbatim (no style tail)', async () => {
    const ss = deriveSize('custom', { width: 1000, height: 700 });
    const a = await storage.createArtwork({ system_name: 'custom_tex', kind: 'custom', shape: { width: ss.width, height: ss.height }, gen_width: ss.width, gen_height: ss.height, main_object: 'mossy stone bricks', prompt_template: '{main_object}, seamless tiling texture' });
    assert.deepStrictEqual({ w: a.gen_width, h: a.gen_height }, { w: 1008, h: 704 }, 'stored gen size == /16-snapped');
    // Prompt composition via preview mode (no render/inspection queue -> deterministic,
    // no dependence on inspection-model load timing): custom appends NO per-kind style
    // template, so the final prompt is the verbatim composed subject, and the preview
    // echoes the operator-set snapped size.
    const prev = await jobs.runPython({ kind: 'custom', main_object: 'mossy stone bricks', prompt_template: '{main_object}, seamless tiling texture', style_override: null, width: a.gen_width, height: a.gen_height, seed: 1, mode: 'preview' });
    assert.strictEqual(prev.final_prompt, 'mossy stone bricks, seamless tiling texture', 'operator-owned prompt is verbatim -- no per-kind style tail');
    assert.deepStrictEqual({ w: prev.width, h: prev.height }, { w: 1008, h: 704 }, 'preview echoes the operator-set size');
  });
}

// REQ-0280 / REQ-0264: the vfx kind end-to-end -- forced-tiling ray render,
// non-forced hit render, adoption + DIRECT serving (getAdoptedRender, the
// public /api/art/<name>.png path), and the kind-derived content/art/vfx/ export.
async function runVfx() {
  await AT('REQ-0280 vfx RAY render is FORCE-tiled with no b.tiling; params.tiling===true', async () => {
    const ss = deriveSize('vfx', { role: 'ray' });
    const a = await storage.createArtwork({ system_name: 'vfx_ray_default', kind: 'vfx', shape: { role: 'ray' }, gen_width: ss.width, gen_height: ss.height, main_object: 'pale energy beam' });
    assert.deepStrictEqual({ w: a.gen_width, h: a.gen_height }, { w: 256, h: 64 }, 'ray stored at 256x64');
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: art.forcedTiling(a, undefined) });
    const d = await waitForRender('vfx_ray_default', r.seed, 30000);
    assert.strictEqual(d.status, 'ok', 'ray render ok: ' + d.error);
    assert.strictEqual(d.params.tiling, true, 'a ray is ALWAYS tiled -- the seam contract cannot be forgotten');
  });
  await AT('REQ-0280 vfx HIT render NOT force-tiled; adopt + direct serving + content/art/vfx/ export', async () => {
    const ss = deriveSize('vfx', { role: 'hit' });
    const a = await storage.createArtwork({ system_name: 'vfx_hit_default', kind: 'vfx', shape: { role: 'hit' }, gen_width: ss.width, gen_height: ss.height, main_object: 'radial frost burst' });
    assert.deepStrictEqual({ w: a.gen_width, h: a.gen_height }, { w: 256, h: 256 }, 'hit stored at 256x256');
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: art.forcedTiling(a, undefined) });
    const d = await waitForRender('vfx_hit_default', r.seed, 30000);
    assert.strictEqual(d.status, 'ok', 'hit render ok: ' + d.error);
    assert.strictEqual(d.params.tiling, false, 'a hit is a still, not tiled');
    await storage.adoptRender('vfx_hit_default', r.seed);
    const served = await storage.getAdoptedRender('vfx_hit_default');
    assert.ok(served && served.image && served.image.length > 0, 'adopted vfx served DIRECTLY by system_name (no content def, no art_urls)');
    assert.strictEqual(served.kind, 'vfx', 'served kind is vfx');
    const prov = await require('../services/art_export.cjs').exportAdopted('vfx_hit_default');
    assert.ok(/[\\/]vfx[\\/]vfx_hit_default\.png$/.test(prov.path), 'exported under content/art/vfx/: ' + prov.path);
    assert.ok(fs.existsSync(prov.path), 'export file written');
  });
}

// REQ-0292: skill_icon end-to-end -- a 256x256 still, mock render + adopt + DIRECT
// serving by system_name (== a skill id; no content def, no art_urls join), and the
// kind-derived content/art/skill_icon/ export. Mirrors runVfx but role-less.
async function runSkillIcon() {
  await AT('REQ-0292 skill_icon: 256x256 still, NOT force-tiled; adopt + direct serve + content/art/skill_icon/ export', async () => {
    const ss = deriveSize('skill_icon', null);
    const a = await storage.createArtwork({ system_name: 'hrim_cleave', kind: 'skill_icon', shape: null, gen_width: ss.width, gen_height: ss.height, main_object: 'a frost cleave ability icon' });
    assert.deepStrictEqual({ w: a.gen_width, h: a.gen_height }, { w: 256, h: 256 }, 'skill_icon stored at 256x256');
    const r = await storage.createRender(a.id, null, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: r.seed, tiling: art.forcedTiling(a, undefined) });
    const d = await waitForRender('hrim_cleave', r.seed, 30000);
    assert.strictEqual(d.status, 'ok', 'skill_icon render ok: ' + d.error);
    assert.strictEqual(d.params.tiling, false, 'a skill_icon is a still, not tiled');
    await storage.adoptRender('hrim_cleave', r.seed);
    const served = await storage.getAdoptedRender('hrim_cleave');
    assert.ok(served && served.image && served.image.length > 0, 'adopted skill_icon served DIRECTLY by system_name == skill id (no content def, no art_urls)');
    assert.strictEqual(served.kind, 'skill_icon', 'served kind is skill_icon');
    const prov = await require('../services/art_export.cjs').exportAdopted('hrim_cleave');
    assert.ok(/[\\/]skill_icon[\\/]hrim_cleave\.png$/.test(prov.path), 'exported under content/art/skill_icon/: ' + prov.path);
    assert.ok(fs.existsSync(prov.path), 'export file written');
  });
}

(async () => {
  await storage.clearAllArtworks();
  await runG2andG1();
  await runG0223();
  await runG3andFlow();
  await runVfx();
  await runSkillIcon();
  await storage.clearAllArtworks();
  await storage.closeArtPool();
  os.homedir = realHome;
  console.log('\nartwork_test: ' + pass + ' passed, ' + fail + ' failed');
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
