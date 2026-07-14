// backpack_ragnarok -- server/tests/contentagg_test.cjs
// REQ-0157: (a) listContentDefs() per-def aggregates (variant_count /
// ok_count / failed_check_count / adopted_variant_no / last_variant_at /
// has_artwork_facet), computed in ONE SQL round-trip and ADDITIVE over the
// REQ-0155 row shape; (b) the recheck seam (routes/content.cjs
// _recheckVariant -- the exact core POST .../variants/<no>/recheck runs):
// re-runs the four machine checks on an IMMUTABLE variant and persists a
// FRESH machine_check through the annotation path the DB immutability
// trigger permits, leaving the asset-of-record untouched. Same rig as
// content_test.cjs: Postgres-backed, SKIPPED cleanly when DATABASE_URL is
// unset, homedir remapped BEFORE requiring storage so the namespace never
// collides with live/e2e rows.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP contentagg_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

// Isolated namespace: remap homedir before requiring storage so NAMESPACE is
// unique to this run and never collides with live/e2e content rows.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-contentagg-test-'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

const storage = require('../storage.cjs');
const { _recheckVariant } = require('../routes/content.cjs');

const REPO = path.join(__dirname, '..', '..');
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const GOOD_PO = liveItems.entries.find((e) => e.effects && e.effects.length);

function llmProv(i) { return { source: 'llm', model: 'claude-opus-4.8', model_version: '2026-01', prompt: 'variant ' + i, params: { variation: i }, seed_if_any: null }; }
function variantData(i) { const d = JSON.parse(JSON.stringify(GOOD_PO)); d.id = GOOD_PO.id + '_agg' + i; d.name = GOOD_PO.name + ' agg' + i; return d; }
function fakeCheck(overall, ranAt) {
  return { overall, checks: [{ name: 'schema_vocab', ok: overall === 'PASS', applicable: true, detail: 'synthetic' }], ran_at: ranAt || new Date().toISOString() };
}

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; } }

async function main() {
  await storage.clearAllContent();

  await AT('REQ-0157 listContentDefs aggregates: counts / adopted_variant_no / last_variant_at / has_artwork_facet', async () => {
    const def = await storage.createContentDef({ system_name: 'agg_full', kind: 'po_def', brief: 'aggregate probe', schema_ref: 'content/vocab.json' });
    // aggregates read the persisted JSONB/status only, so the machine_check
    // rows are written synthetically here (the REAL runner is covered by
    // content_test G2 and the recheck test below).
    const v1 = await storage.createVariant(def.id, { data: variantData(1), provenance: llmProv(1) });
    await storage.setVariantMachineCheck(v1.id, fakeCheck('PASS'));
    const v2 = await storage.createVariant(def.id, { data: variantData(2), provenance: llmProv(2) });
    await storage.setVariantMachineCheck(v2.id, fakeCheck('FAIL'));
    const v3 = await storage.createVariant(def.id, { data: variantData(3), provenance: llmProv(3) });
    await storage.setVariantMachineCheck(v3.id, fakeCheck('PASS'));
    const v4 = await storage.createVariant(def.id, { data: variantData(4), provenance: llmProv(4), status: 'failed' });
    await storage.setVariantMachineCheck(v4.id, fakeCheck('FAIL'));
    await storage.adoptVariant('agg_full', 3);
    // shared namespace: an artwork row under the SAME bare name = art facet
    await storage.createArtwork({ system_name: 'agg_full', kind: 'unit', shape: null, gen_width: 512, gen_height: 512, main_object: 'x', prompt_template: 't' });
    const list = await storage.listContentDefs();
    const row = list.find((d) => d.system_name === 'agg_full');
    assert.ok(row, 'agg_full listed');
    assert.strictEqual(row.variant_count, 4, 'variant_count');
    assert.strictEqual(row.ok_count, 3, 'ok_count counts status=ok only');
    assert.strictEqual(row.failed_check_count, 2, 'failed_check_count counts machine_check.overall=FAIL');
    assert.strictEqual(row.adopted_variant_no, 3, 'adopted_variant_no resolved from adopted_variant_id');
    assert.ok(row.last_variant_at != null, 'last_variant_at present');
    assert.strictEqual(row.has_artwork_facet, true, 'has_artwork_facet via cross-table read');
  });

  await AT('REQ-0157 aggregates on an empty def: zeros/nulls; REQ-0155 row shape preserved (additive only)', async () => {
    await storage.createContentDef({ system_name: 'agg_empty', kind: 'tm_def', brief: 'no variants yet', schema_ref: 'content/vocab.json', gen_config: { generate_n: 3 } });
    const list = await storage.listContentDefs();
    const row = list.find((d) => d.system_name === 'agg_empty');
    assert.strictEqual(row.variant_count, 0);
    assert.strictEqual(row.ok_count, 0);
    assert.strictEqual(row.failed_check_count, 0);
    assert.strictEqual(row.adopted_variant_no, null);
    assert.strictEqual(row.last_variant_at, null);
    assert.strictEqual(row.has_artwork_facet, false, 'no artwork facet for a data-only def');
    // REQ-0155 shape intact underneath
    assert.strictEqual(row.kind, 'tm_def');
    assert.strictEqual(row.brief, 'no variants yet');
    assert.strictEqual(row.schema_ref, 'content/vocab.json');
    assert.deepStrictEqual(row.gen_config, { generate_n: 3 });
    assert.strictEqual(row.adopted_variant_id, null);
    assert.ok(row.id != null && row.created_at != null, 'id/created_at present');
  });

  await AT('REQ-0157 recheck re-runs the four checks and rewrites a STALE verdict with a fresh ran_at', async () => {
    const def = await storage.createContentDef({ system_name: 'agg_recheck', kind: 'po_def', brief: 'recheck probe', schema_ref: 'content/vocab.json' });
    const v = await storage.createVariant(def.id, { data: variantData(9), provenance: llmProv(9) });
    // simulate validator evolution: the stored verdict is a stale synthetic
    // FAIL from "before the validators moved"
    const staleRan = new Date(Date.now() - 86400000).toISOString();
    await storage.setVariantMachineCheck(v.id, fakeCheck('FAIL', staleRan));
    const updated = await _recheckVariant('agg_recheck', v.variant_no);
    const mc = updated.machine_check;
    assert.strictEqual(mc.overall, 'PASS', 'known-good po_def rechecks to PASS (verdict consistent with content_test G2)');
    assert.deepStrictEqual(mc.checks.map((c) => c.name), ['schema_vocab', 'engine_types', 'gen_data', 'integrate'], 'all four checks re-ran');
    assert.ok(mc.ran_at && mc.ran_at > staleRan, 'fresh ran_at replaces the stale one');
    // asset-of-record untouched: same variant row, same data hash
    assert.strictEqual(updated.id, v.id, 'same immutable variant row');
    assert.strictEqual(updated.data_sha256, v.data_sha256, 'data hash unchanged (annotation-only update)');
    assert.strictEqual(updated.variant_no, v.variant_no, 'variant_no unchanged');
  });

  await AT('REQ-0157 recheck of a missing variant/def -> NOT_FOUND (404 at the route)', async () => {
    let e1 = null;
    try { await _recheckVariant('agg_recheck', 999); } catch (e) { e1 = e; }
    assert.ok(e1 && e1.code === 'NOT_FOUND', 'missing variant_no refused');
    let e2 = null;
    try { await _recheckVariant('agg_no_such_def', 1); } catch (e) { e2 = e; }
    assert.ok(e2 && e2.code === 'NOT_FOUND', 'missing def refused');
  });

  await storage.clearAllContent();
  await storage.clearAllArtworks(); // the shared-namespace facet row
  await storage.closeContentPool();
  await storage.closeArtPool();
  os.homedir = realHome;
  console.log('\ncontentagg_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
