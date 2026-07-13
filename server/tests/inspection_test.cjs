// backpack_ragnarok -- server/tests/inspection_test.cjs
// REQ-0152 gates G1 (chokepoint + migration 008 + cascade-on-render-delete)
// and G2 (kit purity: kit_input_sha256 recorded + verified; version-bump
// staleness). Postgres-backed: SKIPPED cleanly when DATABASE_URL is unset
// (same SKIP_PG discipline as artwork_test.cjs). The auto-run integration leg
// drives the REAL queue: mock generation (ART_ROUTE_MOCK=1) -> auto-enqueued
// inspection kits run under the project venv (ART_KIT_PYTHON) with the fast,
// model-free border-key matte (ART_KIT_MATTE_METHOD=borderkey).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP inspection_test.cjs (no DATABASE_URL)'); process.exit(0); }

const realHome = os.homedir();
process.env.STORAGE_BACKEND = 'pg';
process.env.ART_ROUTE_MOCK = '1';
process.env.ART_KIT_MATTE_METHOD = process.env.ART_KIT_MATTE_METHOD || 'borderkey';
process.env.ART_KIT_PYTHON = process.env.ART_KIT_PYTHON
  || path.join(realHome, 'backpack_ragnarok', '.venv', 'bin', 'python');

// Isolated namespace (remap homedir before requiring storage), as artwork_test.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-insp-test-'));
os.homedir = () => tmpHome;

const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-insp-models-'));
for (const f of ['flux-2-klein-4b-Q8_0.gguf', 'qwen_3_4b.safetensors', 'flux2-vae.safetensors']) {
  fs.writeFileSync(path.join(modelDir, f), 'STANDIN-' + f);
}
process.env.ART_MODEL_DIR = modelDir;

const storage = require('../storage.cjs');
const jobs = require('../services/art_jobs.cjs');
const kitReg = require('../services/kit_registry.cjs');

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
function maskOf(cells) { const m = Array.from({ length: 5 }, () => Array(5).fill(false)); cells.forEach(([r, c]) => { m[r][c] = true; }); return m; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal valid PNG (1x1) for storage-only legs that don't run kits.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function waitRender(name, seed, ms) {
  const deadline = Date.now() + (ms || 30000);
  while (Date.now() < deadline) {
    const art = await storage.getArtworkByName(name);
    const rs = await storage.listRenders(art.id);
    const r = rs.find((x) => x.seed === seed);
    if (r && (r.status === 'ok' || r.status === 'failed')) return { art, r };
    await sleep(150);
  }
  throw new Error('render seed ' + seed + ' did not finish');
}

async function waitInspections(artworkId, want, ms) {
  const deadline = Date.now() + (ms || 40000);
  while (Date.now() < deadline) {
    const rows = await storage.listLatestInspectionsByArtwork(artworkId);
    if (rows.length >= want) return rows;
    await sleep(200);
  }
  return storage.listLatestInspectionsByArtwork(artworkId);
}

async function main() {
  const uniq = 'insp' + Date.now();

  // ---- G1: chokepoint + upsert/list + version bump (latest wins) ----
  await AT('G1 upsert + list + version-bump-latest via storage.cjs only', async () => {
    const a = await storage.createArtwork({ system_name: uniq + '_g1', kind: 'po', shape: { mask: maskOf([[0, 0]]) }, gen_width: 256, gen_height: 256, main_object: 'x', prompt_template: 't' });
    const r = await storage.createRender(a.id, 1, 'queued');
    await storage.updateRenderResult(r.id, { status: 'ok', image: PNG_1x1, image_sha256: 'sha_g1', final_prompt: 'p', params: {}, error: null });
    const row1 = await storage.upsertRenderInspection({ render_id: r.id, kit_id: 'po.cell_packing', kit_version: '1', verdict: 'PASS', metrics: { score: 50 }, checks: [], notes: [], kit_input_sha256: 'h1' });
    assert.ok(row1.id, 'row inserted');
    // re-upsert SAME version -> overwrite in place (no duplicate)
    await storage.upsertRenderInspection({ render_id: r.id, kit_id: 'po.cell_packing', kit_version: '1', verdict: 'WARN', metrics: { score: 60 }, checks: [], notes: [], kit_input_sha256: 'h1b' });
    const all1 = await storage.listRenderInspections(r.id);
    assert.strictEqual(all1.filter((x) => x.kit_id === 'po.cell_packing').length, 1, 'same-version upsert overwrites');
    assert.strictEqual(all1[0].verdict, 'WARN', 'overwrite took');
    // version BUMP -> new row retained (history); latest-by-artwork returns v2
    await storage.upsertRenderInspection({ render_id: r.id, kit_id: 'po.cell_packing', kit_version: '2', verdict: 'PASS', metrics: { score: 70 }, checks: [], notes: [], kit_input_sha256: 'h2' });
    const all2 = await storage.listRenderInspections(r.id);
    assert.strictEqual(all2.length, 2, 'version bump kept both rows');
    const latest = await storage.listLatestInspectionsByArtwork(a.id);
    const lp = latest.find((x) => x.kit_id === 'po.cell_packing');
    assert.strictEqual(lp.kit_version, '2', 'latest picks newest version');
  });

  // ---- G1: cascade-on-render-delete ----
  await AT('G1 deleting a render cascades its inspection rows', async () => {
    const a = await storage.createArtwork({ system_name: uniq + '_casc', kind: 'po', shape: { mask: maskOf([[0, 0]]) }, gen_width: 256, gen_height: 256, main_object: 'x', prompt_template: 't' });
    const r = await storage.createRender(a.id, 1, 'queued');
    await storage.updateRenderResult(r.id, { status: 'ok', image: PNG_1x1, image_sha256: 's', final_prompt: 'p', params: {}, error: null });
    await storage.upsertRenderInspection({ render_id: r.id, kit_id: 'matte.coverage_band', kit_version: '1', verdict: 'PASS', metrics: {}, checks: [], notes: [], kit_input_sha256: 'h' });
    assert.strictEqual((await storage.listRenderInspections(r.id)).length, 1);
    await storage.deleteRender(uniq + '_casc', 1);   // non-adopted -> allowed
    assert.strictEqual((await storage.listRenderInspections(r.id)).length, 0, 'inspections cascaded');
  });

  // ---- G2: kit_input_sha256 determinism + staleness sensitivity ----
  await AT('G2 kit_input_sha256 deterministic + flips on image/version change', async () => {
    const art = { kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0]]) }, gen_width: 256, gen_height: 512 };
    const h1 = kitReg.kitInputSha256('IMG_A', 'po.cell_packing', '1', art);
    const h1b = kitReg.kitInputSha256('IMG_A', 'po.cell_packing', '1', art);
    assert.strictEqual(h1, h1b, 'same input -> same hash');
    assert.notStrictEqual(h1, kitReg.kitInputSha256('IMG_B', 'po.cell_packing', '1', art), 'image change -> new hash');
    assert.notStrictEqual(h1, kitReg.kitInputSha256('IMG_A', 'po.cell_packing', '2', art), 'version bump -> new hash');
    const art2 = { kind: 'po', shape: { mask: maskOf([[0, 0]]) }, gen_width: 256, gen_height: 256 };
    assert.notStrictEqual(h1, kitReg.kitInputSha256('IMG_A', 'po.cell_packing', '1', art2), 'shape change -> new hash');
  });

  // ---- G1+G2 integration: generate (mock) -> kits auto-run -> persisted,
  //      kit_input_sha256 verified against a fresh Node recompute ----
  await AT('integration: mock generate -> po kits auto-run + persist + hash verified', async () => {
    const name = uniq + '_flow';
    const a = await storage.createArtwork({ system_name: name, kind: 'po', shape: { mask: maskOf([[0, 0], [1, 0], [2, 0]]) }, gen_width: 256, gen_height: 768, main_object: 'iron sword', prompt_template: '{main_object}, white background, bold outline' });
    const r = await storage.createRender(a.id, 1, 'queued');
    jobs.enqueue({ renderId: r.id, artwork: a, seed: 1, tiling: false });
    const { r: done } = await waitRender(name, 1, 30000);
    assert.strictEqual(done.status, 'ok', 'mock render ok');
    const rows = await waitInspections(a.id, 2, 40000);
    const ids = rows.map((x) => x.kit_id).sort();
    assert.deepStrictEqual(ids, ['matte.coverage_band', 'po.cell_packing'], 'both po kits ran: ' + ids.join(','));
    for (const row of rows) {
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(row.verdict), 'valid verdict ' + row.verdict);
      assert.ok(row.kit_input_sha256, 'kit_input_sha256 recorded');
      const artNow = await storage.getArtworkById(a.id);
      const expected = kitReg.kitInputSha256(done.image_sha256, row.kit_id, row.kit_version, artNow);
      assert.strictEqual(row.kit_input_sha256, expected, 'stored hash == Node recompute for ' + row.kit_id);
    }
  });

  // ---- G4-mechanics (storage side): version bump -> stale -> re-run -> new row.
  // Mirrors routes/art.cjs hGet's staleness rule; the e2e proves the same
  // through the HTTP route + UI badge. Uses the dev/test version override to
  // simulate a manifest bump.
  await AT('staleness: version bump -> stale, re-run at new version clears it', async () => {
    const name = uniq + '_stale';
    const a = await storage.createArtwork({ system_name: name, kind: 'po', shape: { mask: maskOf([[0, 0]]) }, gen_width: 256, gen_height: 256, main_object: 'x', prompt_template: 't' });
    const r = await storage.createRender(a.id, 1, 'queued');
    await storage.updateRenderResult(r.id, { status: 'ok', image: PNG_1x1, image_sha256: 'sha_stale', final_prompt: 'p', params: {}, error: null });
    const kit = 'matte.coverage_band';
    const artNow = await storage.getArtworkById(a.id);
    // run at v1 (as the runner would): hash uses the current (v1) version
    const v1 = kitReg.kitVersion(kit);
    await storage.upsertRenderInspection({ render_id: r.id, kit_id: kit, kit_version: v1, verdict: 'PASS', metrics: {}, checks: [], notes: [], kit_input_sha256: kitReg.kitInputSha256('sha_stale', kit, v1, artNow) });
    const stale = (row) => {
      const cur = kitReg.kitVersion(row.kit_id);
      if (cur && String(row.kit_version) !== String(cur)) return true;
      return row.kit_input_sha256 !== kitReg.kitInputSha256('sha_stale', row.kit_id, row.kit_version, artNow);
    };
    let latest = (await storage.listLatestInspectionsByArtwork(a.id)).find((x) => x.kit_id === kit);
    assert.strictEqual(stale(latest), false, 'fresh row not stale');
    // simulate a kit_version BUMP -> current version now 2 -> stale
    kitReg.setVersionOverride(kit, '2');
    latest = (await storage.listLatestInspectionsByArtwork(a.id)).find((x) => x.kit_id === kit);
    assert.strictEqual(stale(latest), true, 'version bump -> stale');
    // re-run at the new version -> new row; latest is v2 and not stale
    const v2 = kitReg.kitVersion(kit);
    await storage.upsertRenderInspection({ render_id: r.id, kit_id: kit, kit_version: v2, verdict: 'PASS', metrics: {}, checks: [], notes: [], kit_input_sha256: kitReg.kitInputSha256('sha_stale', kit, v2, artNow) });
    const allRows = (await storage.listRenderInspections(r.id)).filter((x) => x.kit_id === kit);
    assert.strictEqual(allRows.length, 2, 're-run at new version added a row (history kept)');
    latest = (await storage.listLatestInspectionsByArtwork(a.id)).find((x) => x.kit_id === kit);
    assert.strictEqual(latest.kit_version, '2', 'latest is the re-run row');
    assert.strictEqual(stale(latest), false, 're-run cleared stale');
    kitReg.clearVersionOverrides();
  });

  // cleanup this namespace
  await storage.clearAllArtworks();
  if (storage.closeArtPool) await storage.closeArtPool();
  console.log('\ninspection_test: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
