#!/usr/bin/env node
'use strict';
// tools/verify_content_registry_parity.cjs -- REQ-0178 (Phase 1) + REQ-0176
// (Phase-1b) parity /
// drift gate. Order-insensitive deep-compare of the live content FILES vs the
// ADOPTED registry variants, per covered kind. Coverage follows the serving
// path: po_def / si_def / tm_def (REQ-0178, the display path) plus unit_def /
// gacha_pack / monster_def / skill_def (REQ-0176, the authority path).
// Per entity it reports one of:
//   MATCH               -- file entry == adopted variant data (key order aside)
//   DRIFT               -- both exist but differ (field-level diff attached)
//   MISSING-IN-REGISTRY -- no content_def of this kind for the entity
//   UNADOPTED           -- content_def exists but has no adopted variant
// Exit code: non-zero ONLY on DRIFT (a file entry diverged from what the game
// now serves from the registry -- the deploy-blocking condition). MISSING /
// UNADOPTED are reported but do not fail (the orchestrator's deploy gate reads
// the summary/--json). --json prints the full machine-readable ledger.
//
// Reads the registry ONLY through server/storage.cjs (the sole chokepoint;
// opens no DB itself); needs STORAGE_BACKEND=pg + DATABASE_URL. Reads the live
// files through server/lib/content_files.cjs so it inspects EXACTLY the content
// root the server serves (CONTENT_ROOT honored). This is the standing drift
// check the deploy runs on LIVE before the cutover restart.
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');
const { contentPath, loadJSON } = require(path.join(REPO_ROOT, 'server', 'lib', 'content_files.cjs'));

// Covered kinds -> the live file(s) whose entries the backfill imported under
// that kind (mirror of tools/backfill_content_registry.cjs SOURCES). po_def has
// THREE source files (REQ-0160: live + dungeon items share the po/2 schema;
// REQ-0178 follow-up added the starter kit); ids are unique across files bar the
// two documented reuse copies.
//
// REQ-0176 (Phase-1b): unit_def/gacha_pack/monster_def/skill_def joined the
// covered set when services/core.cjs became registry-first. This list IS the
// drift gate -- a kind the serving path resolves but this tool does not check is
// a kind whose drift reaches the game unseen. Keep it a mirror of the backfill's
// SOURCES for every kind the serving path covers.
const COVERED = [
  { kind: 'po_def', file: contentPath('live', 'live_items.json') },
  { kind: 'po_def', file: contentPath('live', 'dungeon', 'items.json') },
  // 2026-07-15 ruling: starter-kit items enter the ledger (see the backfill tool's
  // SOURCES note); lockpick/spyglass are reuse copies owned by dungeon/items.json.
  { kind: 'po_def', file: contentPath('live', 'starter_items.json'), exclude: ['lockpick', 'spyglass'] },
  { kind: 'si_def', file: contentPath('live', 'live_sis.json') },
  { kind: 'tm_def', file: contentPath('live', 'live_tms.json') },
  { kind: 'unit_def', file: contentPath('live', 'live_units.json') }, // REQ-0176
  { kind: 'gacha_pack', file: contentPath('live', 'live_packs.json') }, // REQ-0176
  { kind: 'monster_def', file: contentPath('live', 'dungeon', 'enemies.json') }, // REQ-0176
  { kind: 'skill_def', file: contentPath('live', 'dungeon', 'skills.json') }, // REQ-0176
  // REQ-0266: unit_skin joins the covered set the day the serving path resolves it
  // (server/services/core.cjs REGISTRY_KINDS + server/lib/content.cjs's display
  // slice). This file's own header states the rule: a kind the serving path resolves
  // but this tool does not check is a kind whose drift reaches the game unseen.
  { kind: 'unit_skin', file: contentPath('live', 'live_unit_skins.json') }, // REQ-0266
  // REQ-0352: monster_pack joins the covered set BEFORE it is wired into
  // services/core.cjs REGISTRY_KINDS -- gate-before-wire (REQ-0352 section 4):
  // the instrument must show the 14 drifted packs before any data or wiring
  // changes. `derived` lists fields the registry does NOT own (REQ-0352
  // section 5: powerLevel is written only by tools/autobalance_pack_powerlevel.cjs
  // and lives file-side only). They are stripped from the FILE entry before
  // compare -- so a registry variant that ever carries one shows as DRIFT,
  // which is exactly the authorship violation the ruling forbids.
  { kind: 'monster_pack', file: contentPath('live', 'dungeon', 'packs.json'), derived: ['powerLevel'] }, // REQ-0352
];

// Canonical JSON (recursive key sort) -> order-insensitive equality.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function deepEqualUnordered(a, b) { return canonical(a) === canonical(b); }

// REQ-0352: the FILE entry minus its derived fields (COVERED[].derived) -- the
// authored view, which is what the registry is supposed to mirror. Stripping
// happens on the file side ONLY: a registry variant carrying a derived field
// still compares unequal and surfaces as DRIFT.
function authoredView(entry, derived) {
  if (!derived || !derived.length) return entry;
  const out = Object.assign({}, entry);
  for (const f of derived) delete out[f];
  return out;
}

// Field-level diff (order-insensitive): [{path, file, registry}] leaf mismatches.
function diffFields(a, b, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  if (deepEqualUnordered(a, b)) return out;
  const aObj = a && typeof a === 'object' && !Array.isArray(a);
  const bObj = b && typeof b === 'object' && !Array.isArray(b);
  if (aObj && bObj) {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
    for (const k of keys) diffFields(a[k], b[k], prefix ? prefix + '.' + k : k, out);
    return out;
  }
  out.push({ path: prefix || '(root)', file: a, registry: b });
  return out;
}

// Collect file entries across the covered files -> Map(id -> {kind,file,entry}).
// An absent covered file is skipped (reported implicitly as 0 entries).
function collectFileEntries() {
  const byName = new Map();
  for (const src of COVERED) {
    let doc;
    try { doc = loadJSON(src.file); } catch (e) { continue; }
    const excluded = new Set(src.exclude || []);
    for (const entry of (doc.entries || [])) {
      if (excluded.has(entry.id)) continue; // documented reuse copy; original row owns the name
      if (!byName.has(entry.id)) byName.set(entry.id, { kind: src.kind, file: src.file, entry: entry, derived: src.derived });
    }
  }
  return byName;
}

// Classify each collected entry against the registry (via storage). byName is
// injectable so the DB-free test can drive it with a hand-built corpus + a fake
// storage; production passes neither and reads the real files.
async function classifyAll(storage, byName) {
  byName = byName || collectFileEntries();
  const rows = [];
  for (const [name, info] of byName) {
    const adopted = await storage.getAdoptedVariant(name);
    if (adopted) {
      if (adopted.kind !== info.kind) { rows.push({ name, kind: info.kind, status: 'MISSING-IN-REGISTRY', detail: 'def exists but kind=' + adopted.kind }); continue; }
      const fileView = authoredView(info.entry, info.derived); // REQ-0352: authored fields only
      if (deepEqualUnordered(fileView, adopted.data)) rows.push({ name, kind: info.kind, status: 'MATCH', variant_no: adopted.variant_no });
      else rows.push({ name, kind: info.kind, status: 'DRIFT', variant_no: adopted.variant_no, diff: diffFields(fileView, adopted.data) });
      continue;
    }
    const def = await storage.getContentDefByName(name);
    if (!def || def.kind !== info.kind) { rows.push({ name, kind: info.kind, status: 'MISSING-IN-REGISTRY', detail: def ? ('def exists but kind=' + def.kind) : 'no content_def' }); continue; }
    rows.push({ name, kind: info.kind, status: 'UNADOPTED', detail: 'content_def has no adopted variant' });
  }
  return rows;
}

function summarize(rows) {
  const counts = { MATCH: 0, DRIFT: 0, 'MISSING-IN-REGISTRY': 0, UNADOPTED: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

async function main() {
  const asJson = process.argv.includes('--json');
  if (process.env.STORAGE_BACKEND !== 'pg' || !process.env.DATABASE_URL) {
    console.error('verify_content_registry_parity: STORAGE_BACKEND=pg + DATABASE_URL required (source server/.env)');
    process.exit(2);
  }
  const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
  let rows, counts;
  try {
    rows = await classifyAll(storage);
    counts = summarize(rows);
  } finally {
    try { await storage.closeContentPool(); } catch (e) { /* best effort */ }
  }
  if (asJson) {
    console.log(JSON.stringify({ ok: counts.DRIFT === 0, counts, rows }, null, 2));
  } else {
    // The banner names the covered kinds off COVERED itself, so it can never
    // advertise a coverage the tool does not actually check.
    const kinds = Array.from(new Set(COVERED.map((c) => c.kind)));
    console.log('== content registry parity (REQ-0178 + REQ-0176: ' + kinds.join(' / ') + ') ==');
    for (const r of rows) {
      if (r.status === 'MATCH') continue; // quiet on match; --json for the full ledger
      let line = '  ' + r.status.padEnd(20) + r.kind.padEnd(10) + r.name;
      if (r.status === 'DRIFT' && r.diff) line += '  fields: ' + r.diff.map((d) => d.path).join(', ');
      if (r.detail) line += '  (' + r.detail + ')';
      console.log(line);
    }
    console.log('  totals: MATCH=' + counts.MATCH + ' DRIFT=' + counts.DRIFT +
      ' MISSING-IN-REGISTRY=' + counts['MISSING-IN-REGISTRY'] + ' UNADOPTED=' + counts.UNADOPTED);
    console.log(counts.DRIFT === 0
      ? '  PARITY OK (no drift; the game serves the file corpus verbatim from the registry).'
      : '  DRIFT DETECTED -- a live-file entry diverges from its adopted registry variant. STOP: surface to the user.');
  }
  process.exit(counts.DRIFT > 0 ? 1 : 0);
}

module.exports = { canonical, deepEqualUnordered, diffFields, authoredView, collectFileEntries, classifyAll, summarize, COVERED };

if (require.main === module) {
  main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
}
