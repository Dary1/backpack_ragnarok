// backpack_ragnarok -- server/tests/backfill_content_registry_test.cjs
// REQ-0157 follow-up (user ruling 2026-07-14: all-kind backfill of the live
// content into the content-data registry), WIDENED by REQ-0160 (rulings Q1=A,
// Q2=yes): dungeon/items.json enters as po_def (a kind with TWO source files
// now) and dungeon/skills.json enters as the new skill_def kind. DB-FREE:
// exercises the pure,
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
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMPORTED_AT = '2026-07-14T00:00:00.000Z';

T('kind mapping: the thirteen live files map to eleven kinds (po_def has THREE sources); unit_def and gacha_pack are REAL sources (REQ-0171); monster_pack (REQ-0184), gimic (REQ-0211), dungeon (REQ-0185) and unit_skin (REQ-0266) are too', () => {
  const files = bf.SOURCES.map((s) => s.kind + ' <- ' + s.file).sort();
  assert.deepStrictEqual(files, [
    'dungeon <- content/live/dungeon/dungeons.json',  // REQ-0185 -- authored weighted refs to monster_pack + gimic
    'gacha_pack <- content/live/live_packs.json',     // REQ-0171
    'gimic <- content/live/dungeon/gimics.json',      // REQ-0211 -- trap / treasure box / hidden door
    'monster_def <- content/live/dungeon/enemies.json',
    'monster_pack <- content/live/dungeon/packs.json', // REQ-0184 -- a pack of MONSTERS + their layout; unrelated to gacha_pack above
    'po_def <- content/live/dungeon/items.json',      // REQ-0160 Q1 = A
    'po_def <- content/live/live_items.json',
    'po_def <- content/live/starter_items.json',      // 2026-07-15 ruling (REQ-0178 fallback report)
    'si_def <- content/live/live_sis.json',
    'skill_def <- content/live/dungeon/skills.json',  // REQ-0160 Q2 = yes
    'tm_def <- content/live/live_tms.json',
    'unit_def <- content/live/live_units.json',       // REQ-0171 (defs shipped by REQ-0170)
    'unit_skin <- content/live/live_unit_skins.json', // REQ-0266 -- the cosmetic skins (unit portrait + BP skin, ONE kind)
  ]);
  assert.strictEqual(bf.SOURCES.filter((s) => s.kind === 'po_def').length, 3, '2026-07-15: starter POs join live_items + dungeon items under po_def');
  const starterSrc = bf.SOURCES.find((s) => s.file === 'content/live/starter_items.json');
  assert.deepStrictEqual(starterSrc.exclude, ['lockpick', 'spyglass'],
    'the two documented Scout-kit reuse copies must be excluded -- dungeon/items.json owns those names');
  // exclusion is enforced by entriesFromFile (unit test below uses a synthetic doc)
  const fake = { schema: 'po/2', entries: [{ id: 'lockpick' }, { id: 'fresh_item' }] };
  const got = bf.entriesFromFile ? bf.entriesFromFile(fake, starterSrc, IMPORTED_AT) : null;
  if (got) {
    assert.deepStrictEqual(got.map((e) => e.system_name), ['fresh_item'], 'excluded ids never become entries');
  }
  // The old assertion here was "unit_def must have NO source" -- true until REQ-0170
  // shipped the 12 roster defs. It is now the OPPOSITE assertion, and that inversion is
  // the point: a pack pool that references units the ledger has never heard of would be
  // a ledger that cannot check its own references.
  assert.ok(bf.SOURCES.some((s) => s.kind === 'unit_def'), 'unit_def now HAS a source (REQ-0171)');
  assert.ok(bf.SOURCES.some((s) => s.kind === 'gacha_pack'), 'gacha_pack is a registry kind (REQ-0171)');
  assert.ok(bf.SOURCES.some((s) => s.kind === 'unit_skin'), 'unit_skin is a registry kind (REQ-0266)');
  assert.ok(/REQ-0171/.test(bf.UNIT_DEF_NOTE), 'the retired "zero by design" note says who retired it');
});

T('kind mapping (REQ-0160): dungeon skills map to skill_def, dungeon items to po_def -- both VERBATIM, batch carried', () => {
  const skillSrc = bf.SOURCES.find((s) => s.kind === 'skill_def');
  const sf = { schema: 'skill/1', batch: 'batch-002-dungeon-pilot', entries: [
    { id: 'gnoll_claw', name_en: 'Gnoll Claw', name_ja: 'ノールの爪', trigger: { t: 'every_secs', s: [1.8, 2.4] }, verb: { t: 'strike', n: [6, 11] } },
  ] };
  const se = bf.entriesFromFile(sf, skillSrc, IMPORTED_AT)[0];
  assert.strictEqual(se.kind, 'skill_def');
  assert.strictEqual(se.system_name, 'gnoll_claw');
  assert.strictEqual(se.schema_ref, 'skill/1', 'schema_ref = the skill/1 file header (the dialect key the checks read)');
  assert.strictEqual(se.provenance.origin_file, 'content/live/dungeon/skills.json');
  assert.strictEqual(se.provenance.batch, 'batch-002-dungeon-pilot');
  assert.strictEqual(se.data, sf.entries[0], 'data VERBATIM (name_en/name_ja kept as skill/1 spells them)');

  const poSrc = bf.SOURCES.find((s) => s.file === 'content/live/dungeon/items.json');
  const pf = { schema: 'po/2', batch: 'batch-002-dungeon-pilot', entries: [{ id: 'lockpick', name: 'Iron Lockpick', modes: ['unlock'] }] };
  const pe = bf.entriesFromFile(pf, poSrc, IMPORTED_AT)[0];
  assert.strictEqual(pe.kind, 'po_def', 'dungeon items are po_defs, not a separate kind (ruling Q1 = A)');
  assert.strictEqual(pe.provenance.origin_file, 'content/live/dungeon/items.json',
    'origin_file is what tells dungeon POs apart from live_items POs -- the whole basis of ruling Q1 = A');
  assert.deepStrictEqual(pe.data.modes, ['unlock'], 'the dungeon-mode field survives VERBATIM');
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

T('collectAll (real committed corpus): PER-FILE counts match each file, names unique across kinds, unit_def 0', () => {
  const { entries, missingFiles } = bf.collectAll(REPO_ROOT, IMPORTED_AT);
  assert.deepStrictEqual(missingFiles, [], 'all live corpus files present');
  const fileCounts = bf.perFileCounts(entries);
  for (const s of bf.SOURCES) {
    const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, s.file), 'utf8')).entries.length;
    const n = raw - (s.exclude ? s.exclude.length : 0); // 2026-07-15: excluded reuse copies never count
    assert.strictEqual(fileCounts[s.file], n, s.file + ' count == its entries.length minus exclusions');
  }
  const counts = bf.perKindCounts(entries);
  assert.strictEqual(counts.unit_def, fileCounts['content/live/live_units.json'], 'unit_def backfills its live file (REQ-0171)');
  assert.strictEqual(counts.gacha_pack, fileCounts['content/live/live_packs.json'], 'gacha_pack backfills its live file (REQ-0171)');
  assert.strictEqual(counts.monster_pack, fileCounts['content/live/dungeon/packs.json'], 'monster_pack backfills its live file (REQ-0184)');
  assert.strictEqual(counts.gimic, fileCounts['content/live/dungeon/gimics.json'], 'gimic backfills its live file (REQ-0211)');
  assert.strictEqual(counts.dungeon, fileCounts['content/live/dungeon/dungeons.json'], 'dungeon backfills its live file (REQ-0185)');
  assert.strictEqual(counts.unit_skin, fileCounts['content/live/live_unit_skins.json'], 'unit_skin backfills its live file (REQ-0266)');
  assert.strictEqual(counts.po_def,
    fileCounts['content/live/live_items.json'] + fileCounts['content/live/dungeon/items.json']
      + fileCounts['content/live/starter_items.json'],
    'po_def total is the SUM of its three source files (REQ-0160 + 2026-07-15 starter ruling)');
  assert.strictEqual(entries.length,
    counts.po_def + counts.si_def + counts.tm_def + counts.monster_def + counts.skill_def + counts.unit_def + counts.gacha_pack + counts.monster_pack + counts.gimic + counts.dungeon + counts.unit_skin);
  assert.strictEqual(new Set(entries.map((e) => e.system_name)).size, entries.length,
    'system_names unique across ALL files -- content_defs.system_name is UNIQUE across kinds');
});

T('collectAll (count gate): 22 pre-existing + 16 (REQ-0160) + the REQ-0171 units and packs + the REQ-0184 monster packs', () => {
  const { entries } = bf.collectAll(REPO_ROOT, IMPORTED_AT);
  const c = bf.perKindCounts(entries);
  const fc = bf.perFileCounts(entries);
  // The 2026-07-14c run imported 22 (po 8 / si 6 / tm 1 / monster 7).
  const preExisting = fc['content/live/live_items.json'] + c.si_def + c.tm_def + c.monster_def;
  assert.ok(preExisting >= 22, 'the already-imported corpus never shrinks below its original 22 (REQ-0207: backfill is INSERT-ONLY; monster/tm counts GROW with deploys)');
  // REQ-0160 adds exactly 2 dungeon POs + 14 skills.
  assert.strictEqual(fc['content/live/dungeon/items.json'], 2, 'Q1 = A adds exactly 2 po_defs');
  assert.ok(c.skill_def >= 14, 'Q2 = yes added 14 skill_defs at REQ-0160; the skill corpus GROWS with later additive deploys (REQ-0207: batch-005 +16)');
  // REQ-0171 adds whatever the two live files actually hold -- deliberately NOT a frozen
  // number: the roster and the pack catalog are CONTENT and are expected to grow (REQ-0062
  // added two themed packs while this REQ was in flight). The gate is that the totals
  // RECONCILE, not that they never move.
  // 2026-07-15 ruling adds the starter POs (their file's entries minus the 2 reuse copies).
  // REQ-0184 adds the monster packs on the same doctrine: the pack catalog is CONTENT
  // and may grow, so the gate is that the totals RECONCILE, not that they never move.
  assert.strictEqual(entries.length,
    fc['content/live/live_items.json'] + fc['content/live/dungeon/items.json'] + c.si_def + c.tm_def + c.monster_def + c.skill_def
      + c.unit_def + c.gacha_pack + c.monster_pack + c.gimic + c.dungeon + c.unit_skin + fc['content/live/starter_items.json'],
    'the corpus RECONCILES across every source kind (REQ-0207: the ruled base -- monster/skill/tm -- GROWS with deploys, so it is summed dynamically, not frozen at 38)');
  assert.ok(c.unit_def >= 12, 'roster 001 is 12 units (REQ-0170)');
  assert.ok(c.gacha_pack >= 1, 'at least the common_bp pack exists');
  assert.ok(c.monster_pack >= 4, 'REQ-0184 ported batch-002 four packs; the pack catalog GROWS with additive deploys (REQ-0207: batch-005 +3)');
  assert.ok(c.gimic >= 4, 'REQ-0211 migrated the four legacy gimmicks (trap / two door stages / chest) into gimic defs');
  assert.ok(c.dungeon >= 3, 'REQ-0185 authored the frost/grave/wild dungeon defs; the catalog GROWS with additive deploys');
  // REQ-0266 shipped 54 units x 2 slots. Same doctrine as every kind above: the
  // cosmetic catalog is CONTENT and may grow, so the gate is that the totals
  // RECONCILE (asserted just above) and never SHRINK below what shipped.
  assert.ok(c.unit_skin >= 108, 'REQ-0266 shipped a default portrait + BP skin for each of the 54 units; the skin catalog GROWS with later cosmetics');
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
  for (const f of ['content/live/dungeon/formations.json',
    'content/live/dungeon/dungeon.json', 'content/live/scenario.json', 'content/live/seasons.json']) {
    assert.ok(skipped.has(f), f + ' documented as skipped');
    assert.ok(skipped.get(f).length > 20, f + ' has a real reason');
  }
  for (const s of bf.SOURCES) assert.ok(!skipped.has(s.file), s.file + ' must not be both source and skipped');
});

T('skip list (REQ-0160): the two ruled-IN files left the skip table for SOURCES -- no file is in both', () => {
  const skipped = new Set(bf.SKIPPED_FILES.map((s) => s.file));
  const sources = new Set(bf.SOURCES.map((s) => s.file));
  for (const f of ['content/live/dungeon/skills.json', 'content/live/dungeon/items.json']) {
    assert.ok(!skipped.has(f), f + ' is no longer skipped (ruled in on 2026-07-14)');
    assert.ok(sources.has(f), f + ' is now a backfill source');
  }
  // REQ-0211: the trap/treasure/hidden-door interactables became the gimic kind;
  // their file (renamed entities.json -> gimics.json) left the skip table for SOURCES.
  assert.ok(!skipped.has('content/live/dungeon/gimics.json'), 'gimics.json is not skipped');
  assert.ok(sources.has('content/live/dungeon/gimics.json'), 'gimics.json is a backfill source (gimic kind)');
  assert.ok(!skipped.has('content/live/dungeon/entities.json'), 'the legacy entities.json is gone from the skip table');
  // REQ-0266: live_unit_skins.json is a brand-new SOURCE, not a new skip -- which is
  // exactly why the SKIPPED_FILES.length assertion below must stay at four.
  assert.ok(!skipped.has('content/live/live_unit_skins.json'), 'live_unit_skins.json is not skipped');
  assert.ok(sources.has('content/live/live_unit_skins.json'), 'live_unit_skins.json is a backfill source (unit_skin kind)');
  // The remaining skips are the ones ruled OUT for good: singletons + compositions.
  assert.strictEqual(bf.SKIPPED_FILES.length, 4, 'exactly the four not-per-entity live files stay out (entities.json left for the gimic kind, REQ-0211)');
});

console.log('\nbackfill_content_registry_test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);


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
