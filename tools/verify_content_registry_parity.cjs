#!/usr/bin/env node
'use strict';
// tools/verify_content_registry_parity.cjs -- REQ-0178 (Phase 1) parity /
// drift gate. Order-insensitive deep-compare of the live content FILES vs the
// ADOPTED registry variants, per covered kind (po_def / si_def / tm_def).
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
// that kind (mirror of tools/backfill_content_registry.cjs SOURCES, filtered to
// the Phase-1 covered kinds). po_def has TWO source files (REQ-0160: live +
// dungeon items share the po/2 schema; unique ids across files).
const COVERED = [
  { kind: 'po_def', file: contentPath('live', 'live_items.json') },
  { kind: 'po_def', file: contentPath('live', 'dungeon', 'items.json') },
  // 2026-07-15 ruling: starter-kit items enter the ledger (see the backfill tool's
  // SOURCES note); lockpick/spyglass are reuse copies owned by dungeon/items.json.
  { kind: 'po_def', file: contentPath('live', 'starter_items.json'), exclude: ['lockpick', 'spyglass'] },
  { kind: 'si_def', file: contentPath('live', 'live_sis.json') },
  { kind: 'tm_def', file: contentPath('live', 'live_tms.json') },
];

// Canonical JSON (recursive key sort) -> order-insensitive equality.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function deepEqualUnordered(a, b) { return canonical(a) === canonical(b); }

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
      if (!byName.has(entry.id)) byName.set(entry.id, { kind: src.kind, file: src.file, entry: entry });
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
      if (deepEqualUnordered(info.entry, adopted.data)) rows.push({ name, kind: info.kind, status: 'MATCH', variant_no: adopted.variant_no });
      else rows.push({ name, kind: info.kind, status: 'DRIFT', variant_no: adopted.variant_no, diff: diffFields(info.entry, adopted.data) });
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
    console.log('== content registry parity (REQ-0178 Phase 1: po_def / si_def / tm_def) ==');
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

module.exports = { canonical, deepEqualUnordered, diffFields, collectFileEntries, classifyAll, summarize, COVERED };

if (require.main === module) {
  main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
}
