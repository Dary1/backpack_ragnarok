// backpack_ragnarok -- server/tests/content_serving_test.cjs
// REQ-0178 (Phase 1) gate D: registry-first /api/content serving. Proves, at
// the lib/content.cjs chokepoint:
//   - an ADOPTED variant beats the live-file entry (served VERBATIM, through
//     the same eff_en/eff_ja + i18n transform the file path applies);
//   - FALLBACK to the file entry when there is no def / no adopted variant;
//   - the KIND filter (a name adopted under a different kind does not leak);
//   - cache INVALIDATION: a fresh adopt changes the served payload within one
//     refreshRegistryData() (the handler's awaited invalidation);
//   - source ACCOUNTING counts (registry / fallback_file / file_only_names);
//   - byte-parity under an EMPTY registry (getContent == buildContentPayload);
//   - the parity CLASSIFIER against the live chokepoint (MATCH then DRIFT).
// Postgres-backed: SKIPPED cleanly when DATABASE_URL is unset. Same rig as
// content_test.cjs -- homedir remapped BEFORE requiring storage so the
// namespace never collides with live/e2e rows; CONTENT_ROOT points at the real
// worktree corpus so buildContentPayload reads live files while the registry is
// this run's isolated namespace.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP content_serving_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

const REPO = path.join(__dirname, '..', '..');
process.env.CONTENT_ROOT = path.join(REPO, 'content'); // real corpus for buildContentPayload

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-content-serving-test-'));
os.homedir = () => tmpHome; // isolated registry namespace (hash of $HOME/backpack_ragnarok)

const storage = require('../storage.cjs');
const content = require('../lib/content.cjs');
const parity = require('../../tools/verify_content_registry_parity.cjs');

const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const liveSis = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_sis.json'), 'utf8'));
const PO = liveItems.entries.find((e) => e.effects && e.effects.length) || liveItems.entries[0];
const SI = liveSis.entries[0];

function llmProv(i) { return { source: 'llm', model: 'claude-opus-4.8', model_version: '2026-01', prompt: 'serving variant ' + i, params: { variation: i }, seed_if_any: null }; }

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); fail++; } }

async function main() {
  await storage.clearAllContent();

  // ---- baseline: empty registry -> byte-parity with the file payload ----
  await AT('empty registry: getContent items/sis/tms == buildContentPayload (byte-parity)', async () => {
    await content.refreshRegistryData();
    const served = content.getContent();
    const file = content.buildContentPayload();
    assert.deepStrictEqual(served.items, file.items, 'items file-sourced');
    assert.deepStrictEqual(served.sis, file.sis, 'sis file-sourced');
    assert.deepStrictEqual(served.tms, file.tms, 'tms file-sourced');
    assert.strictEqual(served.content_sources, undefined, 'accounting NOT folded into the payload');
  });

  await AT('empty registry: accounting reports everything as file fallback', async () => {
    const s = content.getContentSources();
    assert.strictEqual(s.backend, 'pg');
    assert.strictEqual(s.items.registry, 0, 'no registry items yet');
    assert.ok(s.items.fallback_file > 0, 'items fall back to file');
    assert.ok(s.items.file_only_names.includes(PO.id), 'PO id listed as file-only');
    assert.strictEqual(s.items.registry + s.items.fallback_file, Object.keys(content.getContent().items).length, 'counts sum to served items');
  });

  // ---- registry beats file (served verbatim + transform applied) ----
  let poDef;
  await AT('adopted variant beats the file entry, served verbatim with eff render applied', async () => {
    poDef = await storage.createContentDef({ system_name: PO.id, kind: 'po_def', brief: 'REQ-0178 serving test', schema_ref: 'po/2' });
    const modified = JSON.parse(JSON.stringify(PO));
    modified.name = PO.name + ' [REGISTRY]';
    modified._req0178_marker = 'served-from-registry';
    const v = await storage.createVariant(poDef.id, { data: modified, provenance: llmProv(1) });
    await storage.adoptVariant(PO.id, v.variant_no);
    await content.refreshRegistryData();
    const item = content.getContent().items[PO.id];
    assert.ok(item, 'item still present under the same key');
    assert.strictEqual(item.name, PO.name + ' [REGISTRY]', 'registry name served');
    assert.strictEqual(item._req0178_marker, 'served-from-registry', 'registry-only field served verbatim');
    assert.strictEqual(item.eff_en, content.renderEffJoined(PO.effects, 'en'), 'eff_en re-rendered from registry effects');
    assert.strictEqual(item.eff_ja, content.renderEffJoined(PO.effects, 'ja'), 'eff_ja re-rendered from registry effects');
  });

  // ---- kind isolation: po_def named as an SI id must NOT override sis ----
  await AT('kind filter: a po_def named as an SI id does not leak into the sis section', async () => {
    const def = await storage.createContentDef({ system_name: SI.id, kind: 'po_def', brief: 'wrong-kind', schema_ref: 'po/2' });
    const v = await storage.createVariant(def.id, { data: { id: SI.id, name: 'WRONG KIND', effects: [] }, provenance: llmProv(9) });
    await storage.adoptVariant(SI.id, v.variant_no);
    await content.refreshRegistryData();
    const si = content.getContent().sis[SI.id];
    assert.strictEqual(si.name, SI.name, 'sis entry stays file-sourced (kind mismatch)');
    // and it DOES appear in the items section (it is a po_def now) only if SI.id is also a served item key -- it is not, so items is unaffected too
    assert.strictEqual(content.getContent().items[SI.id], undefined, 'SI id is not an item key');
  });

  // ---- invalidation: a fresh adopt changes serving within one refresh ----
  await AT('invalidation: adopting a new variant changes the served payload within one refresh', async () => {
    const before = content.getContent().items[PO.id].name;
    const v2data = JSON.parse(JSON.stringify(PO));
    v2data.name = PO.name + ' [V2]';
    const v2 = await storage.createVariant(poDef.id, { data: v2data, provenance: llmProv(2) });
    await storage.adoptVariant(PO.id, v2.variant_no);
    await content.refreshRegistryData(); // the exact call the adopt handler awaits
    const after = content.getContent().items[PO.id].name;
    assert.notStrictEqual(after, before, 'served name changed after re-adopt');
    assert.strictEqual(after, PO.name + ' [V2]', 'serves the newly adopted variant');
  });

  // ---- accounting reflects the adoption ----
  await AT('accounting: adopted PO counted as registry, absent from file_only_names', async () => {
    const s = content.getContentSources();
    assert.ok(s.items.registry >= 1, 'at least one registry item');
    assert.ok(!s.items.file_only_names.includes(PO.id), 'adopted PO not in file_only_names');
    assert.strictEqual(s.items.registry + s.items.fallback_file, Object.keys(content.getContent().items).length, 'counts sum to served items');
  });

  // ---- parity classifier against the live chokepoint ----
  await AT('parity classifier: verbatim adoption -> MATCH; drift -> DRIFT', async () => {
    // fresh def with data == the file entry VERBATIM -> MATCH
    await storage.createContentDef({ system_name: 'req0178_parity_match', kind: 'tm_def', brief: 'b', schema_ref: 'tm/1' });
    // use a real tm entry shape; fall back to a synthetic if none
    const tmEntry = { id: 'req0178_parity_match', name: 'Parity', qty_stack: 99 };
    const vm = await storage.createVariant((await storage.getContentDefByName('req0178_parity_match')).id, { data: tmEntry, provenance: llmProv(1) });
    await storage.adoptVariant('req0178_parity_match', vm.variant_no);

    const byNameMatch = new Map([['req0178_parity_match', { kind: 'tm_def', file: 'x', entry: JSON.parse(JSON.stringify(tmEntry)) }]]);
    let rows = await parity.classifyAll(storage, byNameMatch);
    assert.strictEqual(rows[0].status, 'MATCH', 'verbatim -> MATCH');

    const byNameDrift = new Map([['req0178_parity_match', { kind: 'tm_def', file: 'x', entry: Object.assign({}, tmEntry, { name: 'Drifted' }) }]]);
    rows = await parity.classifyAll(storage, byNameDrift);
    assert.strictEqual(rows[0].status, 'DRIFT', 'diverged file -> DRIFT');
    assert.deepStrictEqual(rows[0].diff.map((d) => d.path), ['name']);

    const byNameUn = new Map([['req0178_never_adopted', { kind: 'tm_def', file: 'x', entry: { id: 'x' } }]]);
    await storage.createContentDef({ system_name: 'req0178_never_adopted', kind: 'tm_def', brief: 'b', schema_ref: 'tm/1' });
    rows = await parity.classifyAll(storage, byNameUn);
    assert.strictEqual(rows[0].status, 'UNADOPTED', 'def without adoption -> UNADOPTED');

    const byNameMiss = new Map([['req0178_no_def', { kind: 'tm_def', file: 'x', entry: { id: 'x' } }]]);
    rows = await parity.classifyAll(storage, byNameMiss);
    assert.strictEqual(rows[0].status, 'MISSING-IN-REGISTRY', 'no def -> MISSING-IN-REGISTRY');
  });

  // ---- REQ-0182b: the registry-served predicate the admin PUT guard keys on ----
  // The legacy Dex-Edit route 409s an id the registry SERVES. api_test seeds no
  // adopted defs (its namespaces are empty by construction), so the guard never
  // fires there and the predicate would otherwise ship untested at unit level --
  // the e2e covers the route itself against live, where defs ARE adopted.
  await AT('REQ-0182b: registryServedKindFor reports an adopted po_def, and null for a file-served id', async () => {
    await content.refreshRegistryData();
    assert.strictEqual(content.registryServedKindFor(PO.id), 'po_def', 'the adopted PO is registry-served');
    assert.strictEqual(content.registryServedKindFor('definitely_not_a_content_id'), null, 'unknown id -> null');
    assert.strictEqual(content.registryServedKindFor(''), null, 'empty id -> null (no crash)');
    assert.strictEqual(content.registryServedKindFor(null), null, 'null id -> null (no crash)');
  });

  await AT('REQ-0182b: the predicate follows the snapshot -- an empty registry means nothing is guarded', async () => {
    await storage.clearAllContent();
    await content.refreshRegistryData();
    assert.strictEqual(content.registryServedKindFor(PO.id), null,
      'with no adopted defs the PO is file-served, so the admin PUT must NOT 409 (this is why api_test and the ci.sh fleet stay green)');
  });

  await storage.clearAllContent();
  await storage.closeContentPool();
  console.log('\ncontent_serving_test: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
