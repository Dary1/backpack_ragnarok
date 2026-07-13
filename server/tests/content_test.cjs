// backpack_ragnarok -- server/tests/content_test.cjs
// REQ-0155 gates G1 (chokepoint + migration + constraints: immutability,
// adopted-undeletable, UNIQUE(content_id,variant_no), human_edit lineage),
// G2 (validator wiring: known-good PASS, broken FAIL naming the right check,
// integrate dry-run provably writes nothing), G3 (provenance completeness).
// Postgres-backed: SKIPPED cleanly when DATABASE_URL is unset. All DB access
// via storage.cjs (the sole chokepoint); machine checks via
// server/services/content_checks.cjs (which wires the real validators).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP content_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

// Isolated namespace: remap homedir before requiring storage so NAMESPACE is
// unique to this run and never collides with live/e2e content rows.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-content-test-'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

const storage = require('../storage.cjs');
const checks = require('../services/content_checks.cjs');
const { _normalizeProvenance } = require('../routes/content.cjs');
const { exportAdopted } = require('../services/content_export.cjs');

const REPO = path.join(__dirname, '..', '..');
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const liveSis = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_sis.json'), 'utf8'));
const GOOD_PO = liveItems.entries.find((e) => e.effects && e.effects.length);
const GOOD_SI = liveSis.entries[0];

function llmProv(i) { return { source: 'llm', model: 'claude-opus-4.8', model_version: '2026-01', prompt: 'make a po variant ' + i, params: { temperature: 1.0, variation: i }, seed_if_any: null }; }
function variantData(i) { const d = JSON.parse(JSON.stringify(GOOD_PO)); d.id = GOOD_PO.id + '_v' + i; d.name = GOOD_PO.name + ' v' + i; return d; }

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; } }

async function ingest(defId, data, prov, kind, schema_ref) {
  const v = await storage.createVariant(defId, { data, provenance: prov, status: 'ok' });
  const mc = checks.runChecks(kind, schema_ref, data);
  return storage.setVariantMachineCheck(v.id, mc);
}

async function main() {
  await storage.clearAllContent();

  // ---- G1: chokepoint + constraints ----
  await AT('G1 content_def system_name UNIQUE (cross-table shared namespace with artworks)', async () => {
    const def = await storage.createContentDef({ system_name: 'g1_uniq', kind: 'po_def', brief: 'b', schema_ref: 'content/vocab.json' });
    assert.ok(def.id, 'def created');
    let dup = null;
    try { await storage.createContentDef({ system_name: 'g1_uniq', kind: 'po_def' }); } catch (e) { dup = e; }
    assert.strictEqual(dup && dup.code, 'DUPLICATE', 'duplicate content_def refused');
    // shared namespace: create an artwork with the SAME name -> artwork_facet true (two facets, one entity)
    await storage.createArtwork({ system_name: 'g1_uniq', kind: 'unit', shape: null, gen_width: 512, gen_height: 512, main_object: 'x', prompt_template: 't' });
    const re = await storage.getContentDefByName('g1_uniq');
    assert.strictEqual(re.artwork_facet, true, 'artwork facet detected across tables (shared namespace)');
  });

  await AT('G1 variant_no = max+1 monotonic + UNIQUE(content_id, variant_no), never renumbered', async () => {
    const def = await storage.createContentDef({ system_name: 'g1_vno', kind: 'po_def' });
    const v1 = await storage.createVariant(def.id, { data: variantData(1), provenance: llmProv(1) });
    const v2 = await storage.createVariant(def.id, { data: variantData(2), provenance: llmProv(2) });
    const v3 = await storage.createVariant(def.id, { data: variantData(3), provenance: llmProv(3) });
    assert.deepStrictEqual([v1.variant_no, v2.variant_no, v3.variant_no], [1, 2, 3], 'monotonic max+1');
    // delete v2 (non-adopted) then create v4 -> must be 4, never reuse 2
    await storage.deleteVariant('g1_vno', 2);
    const v4 = await storage.createVariant(def.id, { data: variantData(4), provenance: llmProv(4) });
    assert.strictEqual(v4.variant_no, 4, 'variant_no never reused/renumbered after delete');
  });

  await AT('G1 variants immutable: UPDATE refused at storage (VARIANT_IMMUTABLE)', async () => {
    let refused = null;
    try { await storage.updateVariantData(); } catch (e) { refused = e; }
    assert.strictEqual(refused && refused.code, 'VARIANT_IMMUTABLE', 'storage refuses any variant-data mutation');
  });

  await AT('G1 adopted variant undeletable; non-adopted deletable; switch re-adopt', async () => {
    const def = await storage.createContentDef({ system_name: 'g1_adopt', kind: 'po_def' });
    const a = await storage.createVariant(def.id, { data: variantData(1), provenance: llmProv(1) });
    const b = await storage.createVariant(def.id, { data: variantData(2), provenance: llmProv(2) });
    await storage.adoptVariant('g1_adopt', a.variant_no);
    let refused = null;
    try { await storage.deleteVariant('g1_adopt', a.variant_no); } catch (e) { refused = e; }
    assert.strictEqual(refused && refused.code, 'ADOPTED_UNDELETABLE', 'adopted variant undeletable');
    await storage.deleteVariant('g1_adopt', b.variant_no); // non-adopted deletes fine
    const c = await storage.createVariant(def.id, { data: variantData(3), provenance: llmProv(3) });
    await storage.adoptVariant('g1_adopt', c.variant_no); // switch
    await storage.deleteVariant('g1_adopt', a.variant_no); // now a is no longer adopted -> deletable
    const adopted = await storage.getAdoptedVariant('g1_adopt');
    assert.strictEqual(adopted.variant_no, c.variant_no, 're-adopt switched adopted variant');
  });

  await AT('G1/G3 human_edit creates a NEW variant with parent_variant_id lineage', async () => {
    const def = await storage.createContentDef({ system_name: 'g1_edit', kind: 'po_def' });
    const parent = await storage.createVariant(def.id, { data: variantData(1), provenance: llmProv(1) });
    const edited = variantData(1); edited.name += ' (human tweak)';
    const prov = _normalizeProvenance({ model: 'human', prompt: 'human_edit', params: {} }, 'human_edit', parent.id);
    const child = await storage.createVariant(def.id, { data: edited, provenance: prov });
    assert.strictEqual(child.provenance.source, 'human_edit', 'child source=human_edit');
    assert.strictEqual(String(child.provenance.parent_variant_id), String(parent.id), 'child carries parent lineage');
    assert.notStrictEqual(child.variant_no, parent.variant_no, 'edit is a NEW variant, not in-place');
  });

  // ---- G2: validator wiring ----
  await AT('G2 known-good po_def PASSes all four machine checks', async () => {
    const r = checks.runChecks('po_def', 'content/vocab.json', GOOD_PO);
    assert.strictEqual(r.overall, 'PASS', 'overall PASS: ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
    const names = r.checks.map((c) => c.name);
    assert.deepStrictEqual(names, ['schema_vocab', 'engine_types', 'gen_data', 'integrate'], 'all four checks present');
  });

  await AT('G2 known-good si_def PASSes all four machine checks', async () => {
    const r = checks.runChecks('si_def', 'content/vocab.json', GOOD_SI);
    assert.strictEqual(r.overall, 'PASS', 'si overall PASS: ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  });

  await AT('G2 broken def FAILs naming schema_vocab (unknown verb)', async () => {
    const bad = JSON.parse(JSON.stringify(GOOD_PO));
    bad.effects[0].verb.t = 'NOT_A_REAL_VERB';
    const r = checks.runChecks('po_def', 'content/vocab.json', bad);
    assert.strictEqual(r.overall, 'FAIL');
    const sv = r.checks.find((c) => c.name === 'schema_vocab');
    assert.strictEqual(sv.ok, false, 'schema_vocab flagged');
    assert.ok(/NOT_A_REAL_VERB/.test(sv.detail), 'schema_vocab names the offending verb');
  });

  await AT('G2 engine_types FAILs on a non-integer shape pair (its own check named)', async () => {
    const bad = JSON.parse(JSON.stringify(GOOD_PO));
    bad.shape = [[0, 0], [0, 0.5]]; // still an array (schema_vocab passes shape presence) but not int pairs
    const r = checks.runChecks('po_def', 'content/vocab.json', bad);
    const et = r.checks.find((c) => c.name === 'engine_types');
    assert.strictEqual(et.ok, false, 'engine_types flagged the non-int shape');
    assert.ok(/int/.test(et.detail), 'engine_types names the shape type problem');
  });

  await AT('G2 integrate dry-run provably writes nothing to content/live', async () => {
    const before = checks._contentLiveManifest(REPO);
    const r = checks.runChecks('po_def', 'content/vocab.json', GOOD_PO);
    const after = checks._contentLiveManifest(REPO);
    assert.deepStrictEqual(after, before, 'content/live byte-identical before/after integrate dry-run');
    const integ = r.checks.find((c) => c.name === 'integrate');
    assert.strictEqual(integ.extra && integ.extra.content_live_unchanged, true, 'integrate check reports content_live_unchanged');
  });

  // ---- G3: provenance completeness ----
  await AT('G3 llm provenance requires model/prompt/params (rejects incomplete)', async () => {
    _normalizeProvenance({ source: 'llm', model: 'm', prompt: 'p', params: {} }); // ok
    for (const bad of [{ source: 'llm', prompt: 'p', params: {} }, { source: 'llm', model: 'm', params: {} }, { source: 'llm', model: 'm', prompt: 'p' }]) {
      let err = null; try { _normalizeProvenance(bad); } catch (e) { err = e; }
      assert.strictEqual(err && err.code, 'BAD_PROVENANCE', 'incomplete llm provenance refused: ' + JSON.stringify(bad));
    }
  });

  await AT('G3 every ingested variant row carries model/prompt/params', async () => {
    const def = await storage.createContentDef({ system_name: 'g3_prov', kind: 'po_def' });
    for (let i = 1; i <= 5; i++) await ingest(def.id, variantData(i), llmProv(i), 'po_def', 'content/vocab.json');
    const vs = await storage.listVariants(def.id);
    assert.strictEqual(vs.length, 5, '5 variants stored');
    for (const v of vs) {
      assert.ok(v.provenance.model && v.provenance.prompt && v.provenance.params, 'provenance model/prompt/params present');
      assert.ok(v.machine_check && v.machine_check.overall, 'machine_check ran on ingest');
    }
  });

  // ---- Flow (DB/storage-level rehearsal of the G4 e2e path) ----
  await AT('flow: create -> 5 variants + checks -> review -> adopt -> serve -> export -> edit -> re-adopt', async () => {
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-content-export-'));
    process.env.CONTENT_EXPORT_ROOT = exportRoot;
    const def = await storage.createContentDef({ system_name: 'flow_po', kind: 'po_def', brief: 'a flow po', schema_ref: 'content/vocab.json' });
    const variants = [];
    for (let i = 1; i <= 5; i++) variants.push(await ingest(def.id, variantData(i), llmProv(i), 'po_def', 'content/vocab.json'));
    // advisory agent review on variant 1
    await storage.setVariantReview(variants[0].id, { agent: 'reviewer', model: 'claude-opus-4.8', verdict: 'recommend', rationale: 'cleanest silhouette + valid sockets', reviewed_at: new Date().toISOString() });
    // adopt variant 1 -> serve + export
    await storage.adoptVariant('flow_po', 1);
    const served = await storage.getAdoptedVariant('flow_po');
    assert.strictEqual(served.variant_no, 1, 'adopted variant served');
    assert.ok(served.data && served.data.id, 'served adopted DATA present');
    const rec = await exportAdopted('flow_po');
    assert.ok(fs.existsSync(rec.path), 'export fired: adopted def written');
    // human edit -> NEW variant (no. 6), re-adopt it
    const edited = variantData(1); edited.name += ' (edited)';
    const prov = _normalizeProvenance({ model: 'human', prompt: 'edit', params: {} }, 'human_edit', variants[0].id);
    const child = await ingest(def.id, edited, prov, 'po_def', 'content/vocab.json');
    assert.strictEqual(child.variant_no, 6, 'edit created variant_no 6');
    await storage.adoptVariant('flow_po', 6);
    const served2 = await storage.getAdoptedVariant('flow_po');
    assert.strictEqual(served2.variant_no, 6, 're-adopt switched to the edited variant');
    const review = (await storage.listVariants(def.id)).find((v) => v.variant_no === 1).agent_review;
    assert.strictEqual(review.verdict, 'recommend', 'advisory agent_review persisted (with rationale)');
    assert.ok(review.rationale && review.rationale.length > 0, 'review rationale is mandatory + stored');
  });

  await storage.clearAllContent();
  await storage.clearAllArtworks(); // remove the shared-namespace artwork facet row created in G1
  await storage.closeContentPool();
  await storage.closeArtPool();
  os.homedir = realHome;
  console.log('\ncontent_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
