#!/usr/bin/env node
'use strict';
// tools/backfill_content_registry.cjs -- REQ-0157 follow-up session (user
// ruling 2026-07-14: all-kind backfill, the mirror of REQ-0151 ruling 3's
// "all content in one ledger from day one"). Imports the EXISTING live game
// content into the content-data registry: for every entry of the four live
// corpus files, ONE content_defs row + ONE content_variants row (variant_no
// 1, the entry JSON VERBATIM -- no reshaping), then ADOPTS it. These entries
// are the live assets of record (the game already serves them), so the
// ledger shows them adopted from day one.
//
// CHOKEPOINT: every write goes through server/storage.cjs (the contentStore
// re-exports); this tool opens NO DB itself. Adoption calls
// storage.adoptVariant directly, which (verified) only sets
// content_defs.adopted_variant_id -- the export step
// (server/services/content_export.cjs) lives in the ROUTES layer
// (routes/content.cjs adopt handler), so no export fires here. That is
// intended: content/live is the SOURCE of this backfill; re-exporting it
// would be circular.
//
// PROVENANCE: { source:'backfill', origin_file, origin_schema, batch (only
// when the source file header carries one), imported_at, note }. The
// receiving API's provenance validation (normalizeProvenance: llm|human_edit
// only) deliberately does NOT apply -- it is a routes-layer contract for new
// commissions; this tool goes through the storage chokepoint directly, and
// 'backfill' is the honest source for pre-registry live assets (same posture
// as the REQ-0151 artwork backfill's params.backfill=true).
//
// SCHEMA_REF: the source file's own schema string ("po/2" / "si/2" / "tm/1"
// / "enemy/1") -- the file header is the canonical schema statement for
// these entries; the admin UI's create-default 'content/vocab.json' is a
// placeholder, not canon. NOTE: content_checks.loadVocab() cannot resolve
// "po/2" as a path, so the schema_vocab check falls back to
// content/vocab.json and machine_check.schema_ref records the vocab it
// actually validated against, while the def keeps the source-file truth.
// Documented, intended.
//
// MACHINE CHECKS: the REAL four checks (content_checks.runChecks) run on
// every variant this tool creates and persist via
// storage.setVariantMachineCheck -- the exact annotation path ingest uses.
// A FAIL NEVER blocks the backfill or the adoption: these entries are live
// by definition. Verdicts are tallied honestly (the check model has no WARN
// state: overall is PASS|FAIL; a check that cannot run for a kind is
// applicable:false and reported as not-applicable, never as PASS).
//
// INSERT-ONLY + IDEMPOTENT (this runs against the LIVE namespace that holds
// the user's real artwork registry): the tool never deletes and never
// updates anything pre-existing. The only writes to rows it did not insert
// THIS run are (a) adopted_variant_id on a def a PREVIOUS run of this tool
// provably created (brief marker + variant 1 provenance.source==='backfill'
// with the matching origin_file) that is still UNADOPTED -- crash-resume;
// an existing adoption is never changed -- and (b) nothing else. A
// pre-existing def that is not provably ours is skipped LOUDLY; no variant
// is ever inserted into a foreign def. Idempotency: defs keyed by
// system_name, variants by (content_id, variant_no); a second run creates
// 0 defs / 0 variants.
//
// Run (on the server, with the pg env the api uses):
//   set -a; . ~/backpack_ragnarok/server/.env; set +a
//   node tools/backfill_content_registry.cjs --dry-run   # inventory only, no DB
//   node tools/backfill_content_registry.cjs             # apply
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// The live corpus files -> registry kinds (content_kind ENUM).
// REQ-0160 (user rulings, 2026-07-14) widened this inventory by two files that
// the 2026-07-14c run had flagged and deliberately left out:
//   * Q1 = A: dungeon/items.json (po/2, 2 dungeon-mode entries) enters as po_def.
//     It is the SAME schema as live_items.json; provenance.origin_file (and its
//     batch, batch-002-dungeon-pilot) is what tells the two corpora apart.
//     po_def therefore has TWO source files -- the inventory prints PER FILE.
//   * Q2 = yes: dungeon/skills.json (skill/1, 14 entries) enters as the NEW
//     skill_def kind (server/migrations/010_content_kind_skill_def.sql).
const SOURCES = [
  { kind: 'po_def', file: 'content/live/live_items.json' },
  { kind: 'po_def', file: 'content/live/dungeon/items.json' },
  { kind: 'si_def', file: 'content/live/live_sis.json' },
  { kind: 'tm_def', file: 'content/live/live_tms.json' },
  { kind: 'monster_def', file: 'content/live/dungeon/enemies.json' },
  { kind: 'skill_def', file: 'content/live/dungeon/skills.json' },
  // REQ-0170 shipped both of these as live content; REQ-0171 puts them in the ledger.
  // unit_def's "zero entries by design" note (below) was true right up until the 12
  // roster defs landed -- it is now simply false, and a backfill that skipped them
  // would leave the pack pools pointing at units the registry has never heard of.
  { kind: 'unit_def', file: 'content/live/live_units.json' },
  { kind: 'gacha_pack', file: 'content/live/live_packs.json' },
  // REQ-0184: monster_pack/1 -- a pack of monsters AND their layout on the battle
  // field. Note this is a DIFFERENT kind from gacha_pack above, which is an emission
  // pool: one fields monsters, the other vends Units. Same word, unrelated tables.
  { kind: 'monster_pack', file: 'content/live/dungeon/packs.json' },
  // REQ-0211: gimic/1 -- the trap / treasure box / hidden door interactables.
  // Migrated out of the old non-registry entity/1 entities.json (now gimics.json).
  { kind: 'gimic', file: 'content/live/dungeon/gimics.json' },
  // REQ-0185: dungeon/1 -- an authored dungeon (identity + PROBABILITY-WEIGHTED
  // references to monster_pack + gimic defs). The concrete singular dungeon.json
  // stays SKIPPED below (it is the sim's offline determinism fixture, not per-entity
  // content); the authored defs live in dungeons.json.
  { kind: 'dungeon', file: 'content/live/dungeon/dungeons.json' },
  // REQ-0266: unit_skin/1 -- the COSMETIC skin defs (54 units x 2 slots). ONE kind
  // for both meanings (ruling D1): the entry's own `slot` field, and the KIND of the
  // artwork it references, say whether it dresses a unit PORTRAIT or a BACKPACK.
  // The `uskin_` / `uskin_bp_` prefixes keep the ids clear of the 54 unit ids and of
  // everything else live -- content_defs.system_name is UNIQUE ACROSS KINDS and
  // collectAll() below FATALs on a clash.
  { kind: 'unit_skin', file: 'content/live/live_unit_skins.json' },
  // User ruling 2026-07-15 (chat, with the REQ-0178 fallback report): the REQ-0051
  // starter-kit items (14 po/2 entries in their own file, isolated from
  // live_items.json for the REQ-0160 count-gate) enter the ledger as po_def.
  // lockpick/spyglass are EXCLUDED: the file's own note declares them "Scout-kit
  // reuse copies of the batch-002 pilot player items" -- the dungeon/items.json
  // rows are the originals and content_defs.system_name is UNIQUE.
  { kind: 'po_def', file: 'content/live/starter_items.json', exclude: ['lockpick', 'spyglass'] },
];

// unit_def: ZERO entries by design -- no unit data defs exist yet
// (REQ-0130 is provisional; units are not per-entity data defs today).
// Listed so the inventory states the kind honestly instead of omitting it.
const UNIT_DEF_NOTE = 'REQ-0171: unit_def is now a REAL source (content/live/live_units.json, 12 roster defs from REQ-0170) -- the old "zero by design" note is retired';

// Live files deliberately NOT backfilled, with reasons. The registry's
// content_kind ENUM is po_def|si_def|monster_def|unit_def|tm_def|skill_def
// (skill_def added by REQ-0160); nothing else is a registry kind, and
// singletons/compositions are not per-entity content.
//
// dungeon/skills.json and dungeon/items.json used to sit in this table as the
// two OPEN findings of the 2026-07-14c run. Both were ruled IN by the user on
// 2026-07-14 (REQ-0160 Q1=A, Q2=yes) and now live in SOURCES above.
const SKIPPED_FILES = [
  { file: 'content/live/dungeon/formations.json', reason: 'formation/1 encounter layouts -- composition data, not per-entity defs of a registry kind' },
  { file: 'content/live/dungeon/dungeon.json', reason: 'dungeon graph/config singleton -- not per-entity content' },
  { file: 'content/live/scenario.json', reason: 'scenario/progression singleton (no schema header) -- not per-entity content' },
  { file: 'content/live/seasons.json', reason: 'season schedule singleton -- not per-entity content' },
];

// Marker by which a def created by this tool is recognizable on a re-run.
const BRIEF_MARKER = 'Backfill of live ';

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/** Pure mapper: one parsed source file -> backfill entries. `data` is the
 * entry object VERBATIM (same object reference; no reshaping, no cleanup). */
function entriesFromFile(fileJson, source, importedAt) {
  const schema = typeof fileJson.schema === 'string' ? fileJson.schema : '';
  const batch = typeof fileJson.batch === 'string' ? fileJson.batch : null;
  const excluded = new Set(source.exclude || []);
  return (fileJson.entries || []).filter((entry) => {
    if (!excluded.has(entry.id)) return true;
    console.log('  EXCLUDED ' + source.kind + ' ' + entry.id + ' from ' + source.file
      + ' (documented reuse copy; the original row owns the name)');
    return false;
  }).map((entry) => {
    const provenance = { source: 'backfill', origin_file: source.file, origin_schema: schema };
    if (batch) provenance.batch = batch;
    provenance.imported_at = importedAt;
    provenance.note = 'live asset of record imported under the 2026-07-14 全kind backfill ruling; no regeneration guarantee';
    return {
      kind: source.kind,
      system_name: entry.id,
      brief: BRIEF_MARKER + source.kind + " '" + entry.id + "' from " + source.file + ' (pre-registry live asset)',
      schema_ref: schema,
      data: entry,
      provenance,
    };
  });
}

/** Collect all backfill entries from the live corpus under repoRoot.
 * Throws on a duplicate system_name across files: content_defs.system_name
 * is UNIQUE across ALL kinds, so a cross-file id clash must stop the run. */
function collectAll(repoRoot, importedAt) {
  const entries = [];
  const missingFiles = [];
  for (const s of SOURCES) {
    const p = path.join(repoRoot, s.file);
    if (!fs.existsSync(p)) { missingFiles.push(s.file); continue; }
    entries.push.apply(entries, entriesFromFile(readJson(p), s, importedAt));
  }
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.system_name)) {
      throw new Error('duplicate system_name across live files: ' + e.system_name +
        ' (' + seen.get(e.system_name) + ' vs ' + e.kind + ') -- content_defs.system_name is UNIQUE across kinds');
    }
    seen.set(e.system_name, e.kind);
  }
  return { entries, missingFiles };
}

function perKindCounts(entries) {
  const counts = { po_def: 0, si_def: 0, tm_def: 0, monster_def: 0, unit_def: 0, skill_def: 0, gimic: 0, dungeon: 0 };
  for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return counts;
}

/** Entries per SOURCE FILE. Since REQ-0160 a kind may have more than one source
 * file (po_def: live_items.json + dungeon/items.json), so the inventory must
 * count per file -- a per-kind count printed against each file would report the
 * kind total twice and make the G2 count-match gate meaningless. */
function perFileCounts(entries) {
  const counts = {};
  for (const e of entries) {
    const f = e.provenance.origin_file;
    counts[f] = (counts[f] || 0) + 1;
  }
  return counts;
}

/** Skip-rule guards (INSERT-ONLY doctrine). A def/variant is "ours" only
 * when it provably came from this tool; anything else is never written to. */
function defIsOurs(def, entry) {
  return !!(def && def.kind === entry.kind && typeof def.brief === 'string' && def.brief.startsWith(BRIEF_MARKER));
}
function variantIsOurs(variant, entry) {
  return !!(variant && variant.provenance && variant.provenance.source === 'backfill' &&
    variant.provenance.origin_file === entry.provenance.origin_file);
}

function printInventory(entries, missingFiles) {
  const counts = perKindCounts(entries);
  const fileCounts = perFileCounts(entries);
  console.log('== live-content backfill inventory (REQ-0157 follow-up + REQ-0160 dungeon kinds, user rulings 2026-07-14) ==');
  for (const s of SOURCES) {
    console.log('  ' + s.kind.padEnd(12) + ' ' + String(fileCounts[s.file] || 0).padStart(2) + ' entries  <- ' + s.file);
  }
  console.log('  note: ' + UNIT_DEF_NOTE);
  console.log('  per-kind totals: ' + Object.keys(counts).map((k) => k + '=' + counts[k]).join(' '));
  console.log('  TOTAL: ' + entries.length + ' defs / ' + entries.length + ' variants (one adopted variant_no 1 per def)');
  if (missingFiles.length) console.log('  MISSING SOURCE FILES: ' + missingFiles.join(', '));
  console.log('  skipped live files (documented, not backfilled):');
  for (const s of SKIPPED_FILES) console.log('    - ' + s.file + ' -- ' + s.reason);
}

// REQ-0352: RECONCILE mode -- the drift repair the INSERT-ONLY pass below must
// never do. For every entry of ONE kind, compare the live file's AUTHORED view
// (derived fields stripped per the parity tool's COVERED[].derived; REQ-0352
// section 5: powerLevel is autobalance-owned and never registry data) against
// the adopted variant; where they differ, create the NEXT variant from the
// authored view and ADOPT it. Direction of truth is the FILE (REQ-0352
// section 3): the file is what the game plays and what REQ-0303 edited; the
// registry variants were a 2026-07-15 snapshot nobody re-ported.
// Guards: only defs this tool created (defIsOurs) are written to; a missing or
// unadopted def is a warning, not a write (creation/repair stays the plain
// INSERT-ONLY pass's job). Derived-field config is read off the parity tool's
// COVERED so the two tools cannot disagree about what "authored" means.
async function reconcileKind(kind, dryRun) {
  const parity = require('./verify_content_registry_parity.cjs');
  const sources = SOURCES.filter((s) => s.kind === kind);
  if (!sources.length) throw new Error('--reconcile-kind ' + kind + ': not a SOURCES kind');
  const covered = parity.COVERED.filter((c) => c.kind === kind);
  const derived = (covered.length && covered[0].derived) || [];
  const importedAt = new Date().toISOString();
  const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
  const { runChecks } = require(path.join(REPO_ROOT, 'server', 'services', 'content_checks.cjs'));
  let reported = 0, match = 0, skipped = 0;
  try {
    for (const src of sources) {
      const fileJson = readJson(path.join(REPO_ROOT, src.file));
      const schema = typeof fileJson.schema === 'string' ? fileJson.schema : '';
      const excluded = new Set(src.exclude || []);
      for (const entry of (fileJson.entries || [])) {
        if (excluded.has(entry.id)) continue;
        const authored = parity.authoredView(entry, derived);
        const def = await storage.getContentDefByName(entry.id);
        if (!def || def.kind !== kind) { console.warn('  SKIP ' + entry.id + ': no ' + kind + ' content_def (the INSERT-ONLY pass owns creation)'); skipped++; continue; }
        if (!defIsOurs(def, { kind: kind })) { console.warn('  FOREIGN DEF SKIPPED (not this tool\'s; untouched): ' + entry.id); skipped++; continue; }
        const adopted = await storage.getAdoptedVariant(entry.id);
        if (!adopted) { console.warn('  SKIP ' + entry.id + ': def exists but nothing adopted (the INSERT-ONLY pass repairs adoption)'); skipped++; continue; }
        if (parity.deepEqualUnordered(authored, adopted.data)) { match++; continue; }
        const diffPaths = parity.diffFields(authored, adopted.data).map((d) => d.path).join(', ');
        if (dryRun) { console.log('  WOULD RE-PORT ' + entry.id.padEnd(24) + ' v' + adopted.variant_no + ' -> next  fields: ' + diffPaths); reported++; continue; }
        const provenance = {
          source: 'backfill', origin_file: src.file, origin_schema: schema, imported_at: importedAt,
          note: 'REQ-0352 reconcile re-port: live file wins (REQ-0303 member edits never reached the registry). Authored fields only -- powerLevel is derived (autobalance-owned) and deliberately absent.',
        };
        const variant = await storage.createVariant(def.id, { data: authored, provenance: provenance, status: 'ok' });
        let mc;
        try { mc = runChecks(kind, schema, authored); }
        catch (err) { mc = { checks: [{ name: 'runner', ok: false, applicable: true, detail: 'checks crashed: ' + err.message }], overall: 'FAIL', ran_at: new Date().toISOString() }; }
        await storage.setVariantMachineCheck(variant.id, mc);
        await storage.adoptVariant(entry.id, variant.variant_no);
        console.log('  ~ ' + entry.id.padEnd(24) + ' v' + adopted.variant_no + ' -> v' + variant.variant_no + ' adopted, checks overall=' + mc.overall + '  fields: ' + diffPaths);
        reported++;
      }
    }
    console.log('\n== reconcile ' + kind + (dryRun ? ' (DRY-RUN)' : '') + ' ==');
    console.log('  ' + reported + (dryRun ? ' would re-port' : ' re-ported + adopted') + ', ' + match + ' already match, ' + skipped + ' skipped');
  } finally {
    await storage.closeContentPool();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.indexOf('--dry-run') >= 0;
  const rk = args.indexOf('--reconcile-kind');
  if (rk >= 0) {
    const kind = args[rk + 1];
    if (!kind) throw new Error('--reconcile-kind needs a kind argument');
    await reconcileKind(kind, dryRun);
    return;
  }
  const importedAt = new Date().toISOString();
  const { entries, missingFiles } = collectAll(REPO_ROOT, importedAt);
  printInventory(entries, missingFiles);
  if (missingFiles.length) throw new Error('missing source files: ' + missingFiles.join(', '));
  if (dryRun) { console.log('DRY-RUN: no DB writes.'); return; }

  // Required only past the dry-run gate, so --dry-run provably opens no DB.
  const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
  const { runChecks } = require(path.join(REPO_ROOT, 'server', 'services', 'content_checks.cjs'));

  let defsNew = 0, defsOursExisting = 0, defsForeignSkipped = 0;
  let varNew = 0, varSkip = 0, varAnomalySkipped = 0;
  let adoptedNew = 0, adoptRepaired = 0, adoptAlready = 0;
  const verdictByKind = {}; // kind -> {PASS,FAIL}
  const checkByName = {};   // check name -> {ok,fail,not_applicable}

  const tallyVerdict = (kind, mc) => {
    const t = verdictByKind[kind] || (verdictByKind[kind] = { PASS: 0, FAIL: 0 });
    t[mc.overall === 'PASS' ? 'PASS' : 'FAIL']++;
    for (const c of (mc.checks || [])) {
      const n = checkByName[c.name] || (checkByName[c.name] = { ok: 0, fail: 0, not_applicable: 0 });
      if (c.applicable === false) n.not_applicable++;
      else if (c.ok) n.ok++;
      else n.fail++;
    }
  };

  try {
    for (const e of entries) {
      let def = await storage.getContentDefByName(e.system_name);
      let createdDefThisRun = false;
      if (!def) {
        def = await storage.createContentDef({ system_name: e.system_name, kind: e.kind, brief: e.brief, schema_ref: e.schema_ref });
        createdDefThisRun = true;
        defsNew++;
      } else if (!defIsOurs(def, e)) {
        // Pre-existing def that is NOT provably this tool's: never write into
        // it (no variant insert, no annotation, no adoption change).
        console.warn('  FOREIGN DEF SKIPPED (not this tool\'s; untouched): ' + e.system_name +
          ' [kind=' + def.kind + ', brief=' + JSON.stringify(String(def.brief).slice(0, 60)) + ']');
        defsForeignSkipped++;
        continue;
      } else {
        defsOursExisting++;
      }

      const variants = await storage.listVariants(def.id);
      const v1 = variants.find((v) => v.variant_no === 1);

      if (!v1) {
        if (variants.length > 0) {
          // Ours-looking def whose variant 1 is gone but other variants exist:
          // an anomaly this tool must not "fix" (INSERT-ONLY; variant_no is
          // never reused by doctrine anyway). Skip loudly.
          console.warn('  ANOMALY SKIPPED (def has ' + variants.length + ' variant(s) but no variant_no 1): ' + e.system_name);
          varAnomalySkipped++;
          continue;
        }
        // Fresh def (this run) or crash-resume (ours, zero variants).
        const variant = await storage.createVariant(def.id, { data: e.data, provenance: e.provenance, status: 'ok' });
        if (variant.variant_no !== 1) {
          throw new Error('expected variant_no 1 for backfill def ' + e.system_name + ', got ' + variant.variant_no);
        }
        varNew++;
        let mc;
        try { mc = runChecks(e.kind, e.schema_ref, e.data); }
        catch (err) {
          // Mirror the ingest route's posture: an honest FAIL record, never a
          // faked PASS. Never blocks the adoption below.
          mc = { checks: [{ name: 'runner', ok: false, applicable: true, detail: 'checks crashed: ' + err.message }], overall: 'FAIL', ran_at: new Date().toISOString() };
        }
        await storage.setVariantMachineCheck(variant.id, mc);
        tallyVerdict(e.kind, mc);
        await storage.adoptVariant(e.system_name, 1);
        adoptedNew++;
        console.log('  + ' + e.kind.padEnd(12) + e.system_name.padEnd(20) + ' variant 1 adopted, checks overall=' + mc.overall + (createdDefThisRun ? '' : ' (crash-resume fill)'));
        continue;
      }

      // Variant 1 already exists.
      if (!variantIsOurs(v1, e)) {
        console.warn('  FOREIGN VARIANT 1 SKIPPED (def untouched): ' + e.system_name +
          ' [provenance.source=' + (v1.provenance && v1.provenance.source) + ']');
        varAnomalySkipped++;
        continue;
      }
      varSkip++;
      if (def.adopted_variant_id == null) {
        // Idempotent completion: OUR unadopted def from a previous run gets
        // its adoption applied. An existing adoption is never changed.
        await storage.adoptVariant(e.system_name, 1);
        adoptRepaired++;
        console.log('  ~ ' + e.system_name + ': adoption repaired (our unadopted variant 1)');
      } else {
        adoptAlready++;
      }
    }

    console.log('\n== backfill applied ==');
    console.log('  defs    : ' + defsNew + ' created, ' + defsOursExisting + ' already existed (ours, skipped), ' + defsForeignSkipped + ' foreign skipped');
    console.log('  variants: ' + varNew + ' created, ' + varSkip + ' already existed, ' + varAnomalySkipped + ' anomaly/foreign skipped');
    console.log('  adopted : ' + adoptedNew + ' on creation, ' + adoptRepaired + ' repaired, ' + adoptAlready + ' already adopted');
    console.log('  machine-check verdicts by kind (overall; the model has no WARN state):');
    for (const k of Object.keys(perKindCounts(entries))) {
      const t = verdictByKind[k];
      console.log('    ' + k.padEnd(12) + (t ? ('PASS ' + t.PASS + ' / FAIL ' + t.FAIL) : '(no checks run this pass)'));
    }
    console.log('  per-check tallies (ok / fail / not-applicable):');
    for (const n of Object.keys(checkByName)) {
      const t = checkByName[n];
      console.log('    ' + n.padEnd(12) + t.ok + ' / ' + t.fail + ' / ' + t.not_applicable);
    }
  } finally {
    await storage.closeContentPool();
  }
}

module.exports = {
  SOURCES, SKIPPED_FILES, UNIT_DEF_NOTE, BRIEF_MARKER,
  entriesFromFile, collectAll, perKindCounts, perFileCounts, defIsOurs, variantIsOurs,
  reconcileKind, // REQ-0352
};

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}
