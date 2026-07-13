// backpack_ragnarok -- server/tests/backfill_content_registry_test.cjs
// REQ-0157 follow-up (user ruling 2026-07-14: all-kind backfill of the live
// content into the content-data registry). DB-FREE: exercises the pure,
// deterministic parts of tools/backfill_content_registry.cjs -- live-file
// entry -> def/variant row mapping, kind mapping, provenance shape, and the
// INSERT-ONLY skip rules -- against fixtures plus the committed live corpus.
// No DATABASE_URL, no network. Runs in the DB-free CI pass ([4.65/7]).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bf = require('../../tools/backfill_content_registry.cjs');

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMPORTED_AT = '2026-07-14T00:00:00.000Z';

T('kind mapping: the four live files map to the four kinds; unit_def has NO source (zero by design)', () => {
  const kinds = bf.SOURCES.map((s) => s.kind).sort();
  assert.deepStrictEqual(kinds, ['monster_def', 'po_def', 'si_def', 'tm_def']);
  assert.strictEqual(bf.SOURCES.find((s) => s.kind === 'po_def').file, 'content/live/live_items.json');
  assert.strictEqual(bf.SOURCES.find((s) => s.kind === 'si_def').file, 'content/live/live_sis.json');
  assert.strictEqual(bf.SOURCES.find((s) => s.kind === 'tm_def').file, 'content/live/live_tms.json');
  assert.strictEqual(bf.SOURCES.find((s) => s.kind === 'monster_def').file, 'content/live/dungeon/enemies.json');
  assert.ok(!bf.SOURCES.some((s) => s.kind === 'unit_def'), 'unit_def must have no source file');
  assert.ok(/REQ-0130/.test(bf.UNIT_DEF_NOTE), 'unit_def zero is documented with its reason');
});

T('entry mapping: def fields (system_name = bare id, brief, schema_ref from file header) + data VERBATIM', () => {
  const fileJson = { schema: 'po/2', entries: [
    { id: 'blade', name: 'Longsword Blade', rarity: 'Common', shape: [[0, 0], [1, 0]], tags: ['Metal'], nested: { keep: [1, 2] } },
  ] };
  const pristine = JSON.parse(JSON.stringify(fileJson));
  const src = bf.SOURCES.find((s) => s.kind === 'po_def');
  const e = bf.entriesFromFile(fileJson, src, IMPORTED_AT);
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].kind, 'po_def');
  assert.strictEqual(e[0].system_name, 'blade', 'bare name, shared namespace with artworks by design');
  assert.strictEqual(e[0].brief, "Backfill of live po_def 'blade' from content/live/live_items.json (pre-registry live asset)");
  assert.strictEqual(e[0].schema_ref, 'po/2', 'schema_ref = the source file header, not the UI placeholder');
  assert.strictEqual(e[0].data, fileJson.entries[0], 'data is the entry object VERBATIM (same reference, no reshaping)');
  assert.deepStrictEqual(fileJson, pristine, 'mapper must not mutate the source entry');
});

T('provenance shape: source=backfill + origin file/schema + imported_at + no-regeneration note', () => {
  const fileJson = { schema: 'si/2', entries: [{ id: 'acc_gem', name: 'Gem' }] };
  const src = bf.SOURCES.find((s) => s.kind === 'si_def');
  const p = bf.entriesFromFile(fileJson, src, IMPORTED_AT)[0].provenance;
  assert.strictEqual(p.source, 'backfill');
  assert.strictEqual(p.origin_file, 'content/live/live_sis.json');
  assert.strictEqual(p.origin_schema, 'si/2');
  assert.strictEqual(p.imported_at, IMPORTED_AT);
  assert.ok(/no regeneration guarantee/.test(p.note), 'note carries the no-regeneration doctrine');
  assert.ok(/2026-07-14/.test(p.note), 'note names the ruling date');
  assert.ok(!('batch' in p), 'no batch key when the file header has none');
});

T('provenance batch: carried ONLY when the source file header has one (enemies.json)', () => {
  const fileJson = { schema: 'enemy/1', batch: 'batch-002-dungeon-pilot', entries: [{ id: 'frost_gnoll', name: 'Frost Gnoll', hp: [30, 45] }] };
  const src = bf.SOURCES.find((s) => s.kind === 'monster_def');
  const e = bf.entriesFromFile(fileJson, src, IMPORTED_AT)[0];
  assert.strictEqual(e.provenance.batch, 'batch-002-dungeon-pilot');
  assert.strictEqual(e.kind, 'monster_def');
  assert.deepStrictEqual(e.data.hp, [30, 45], 'hp range array stays VERBATIM (honest checks may FAIL on it; backfill never reshapes)');
});

T('collectAll (real committed corpus): per-kind counts match the files, names unique, unit_def 0', () => {
  const { entries, missingFiles } = bf.collectAll(REPO_ROOT, IMPORTED_AT);
  assert.deepStrictEqual(missingFiles, [], 'all four live corpus files present');
  const counts = bf.perKindCounts(entries);
  for (const s of bf.SOURCES) {
    const n = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, s.file), 'utf8')).entries.length;
    assert.strictEqual(counts[s.kind], n, s.kind + ' count == ' + s.file + ' entries.length');
  }
  assert.strictEqual(counts.unit_def, 0, 'unit_def backfills ZERO (REQ-0130 provisional)');
  assert.strictEqual(entries.length, counts.po_def + counts.si_def + counts.tm_def + counts.monster_def);
  assert.strictEqual(new Set(entries.map((e) => e.system_name)).size, entries.length, 'system_names unique across all files');
});

T('collectAll: cross-file duplicate system_name REFUSED (content_defs.system_name is UNIQUE across kinds)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-cbf-'));
  fs.mkdirSync(path.join(tmp, 'content', 'live', 'dungeon'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'content', 'live', 'live_items.json'), JSON.stringify({ schema: 'po/2', entries: [{ id: 'dup' }] }));
  fs.writeFileSync(path.join(tmp, 'content', 'live', 'live_sis.json'), JSON.stringify({ schema: 'si/2', entries: [{ id: 'dup' }] }));
  assert.throws(() => bf.collectAll(tmp, IMPORTED_AT), /duplicate system_name across live files: dup/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

T('skip rules: foreign defs/variants are never treated as ours (INSERT-ONLY guard)', () => {
  const entry = bf.entriesFromFile({ schema: 'po/2', entries: [{ id: 'blade' }] }, bf.SOURCES.find((s) => s.kind === 'po_def'), IMPORTED_AT)[0];
  // defs
  assert.strictEqual(bf.defIsOurs({ kind: 'po_def', brief: entry.brief }, entry), true, 'our own def recognized');
  assert.strictEqual(bf.defIsOurs({ kind: 'po_def', brief: 'A sword the user commissioned' }, entry), false, 'user-created def is foreign');
  assert.strictEqual(bf.defIsOurs({ kind: 'monster_def', brief: entry.brief }, entry), false, 'kind mismatch is foreign even with the marker');
  assert.strictEqual(bf.defIsOurs(null, entry), false);
  // variants
  assert.strictEqual(bf.variantIsOurs({ provenance: { source: 'backfill', origin_file: 'content/live/live_items.json' } }, entry), true);
  assert.strictEqual(bf.variantIsOurs({ provenance: { source: 'llm', origin_file: 'content/live/live_items.json' } }, entry), false, 'llm-ingested variant is foreign');
  assert.strictEqual(bf.variantIsOurs({ provenance: { source: 'backfill', origin_file: 'content/live/dungeon/enemies.json' } }, entry), false, 'origin_file must match');
  assert.strictEqual(bf.variantIsOurs({ provenance: null }, entry), false);
  assert.strictEqual(bf.variantIsOurs(null, entry), false);
});

T('skip list: every non-backfilled live file is documented with a reason; no overlap with sources', () => {
  const skipped = new Map(bf.SKIPPED_FILES.map((s) => [s.file, s.reason]));
  for (const f of ['content/live/dungeon/entities.json', 'content/live/dungeon/formations.json',
    'content/live/dungeon/dungeon.json', 'content/live/scenario.json', 'content/live/seasons.json',
    'content/live/dungeon/skills.json', 'content/live/dungeon/items.json']) {
    assert.ok(skipped.has(f), f + ' documented as skipped');
    assert.ok(skipped.get(f).length > 20, f + ' has a real reason');
  }
  for (const s of bf.SOURCES) assert.ok(!skipped.has(s.file), s.file + ' must not be both source and skipped');
});

console.log('\nbackfill_content_registry_test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
