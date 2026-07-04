#!/usr/bin/env node
// tools/migrate_i18n.cjs -- REQ-0038 formal i18n content migration.
//
// Moves each entry's legacy name_ja/flavor_ja fields into a new
// i18n.ja.{name,flavor} map, then DELETES the old _ja fields. Base
// name/flavor fields are untouched (they stay English, per the REQ-0038
// design decision: "base fields name/flavor stay English. Add an i18n
// map keyed by locale").
//
// Operates on:
//   - content/live/live_items.json
//   - content/live/live_sis.json
//   - any content/batches/*/draft.json file that carries name_ja/flavor_ja
//     (discovered by directory scan, not hardcoded -- today there is
//     exactly one, content/batches/batch-001-niflheim/draft.json, but
//     this must not silently skip a future second batch file).
//
// Idempotent / safe to re-run: an entry that already has i18n.ja and no
// more _ja fields is left alone (no-op); an entry with BOTH i18n.ja AND
// leftover _ja fields (e.g. a partially-migrated file) has its _ja
// fields merged in (only filling gaps, never overwriting an existing
// i18n.ja value) and then removed -- so running this script twice in a
// row (or on an already-migrated file) never throws and never changes
// file content on the second run.
//
// Verification: for every entry actually migrated, this script keeps an
// in-memory record of before/after values and asserts strict equality
// (byte-identical string equality) before writing anything out. This is
// also exposed as migrateDoc()/verifyMigration() so server tests can
// drive the same logic against a fixture copy and assert the same
// invariant programmatically, not just via this CLI's own internal
// checks.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const LIVE_ITEMS_PATH = path.join(REPO_ROOT, 'content', 'live', 'live_items.json');
const LIVE_SIS_PATH = path.join(REPO_ROOT, 'content', 'live', 'live_sis.json');
const BATCHES_DIR = path.join(REPO_ROOT, 'content', 'batches');

// Finds every draft.json under a content/batches subdirectory (one level
// deep, matching this repo's existing batch-directory convention -- see
// content/batches/batch-001-niflheim/draft.json). Returns an empty array
// if content/batches does not exist (defensive, not expected on this
// repo).
function findDraftBatchFiles() {
  if (!fs.existsSync(BATCHES_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(BATCHES_DIR)) {
    const dir = path.join(BATCHES_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const draftPath = path.join(dir, 'draft.json');
    if (fs.existsSync(draftPath)) out.push(draftPath);
  }
  return out;
}

// Migrates one entry object IN PLACE (mutates entry). Returns an array of
// verification records ({id, field, before, after}) for every field
// actually moved (empty array if the entry had neither name_ja nor
// flavor_ja, i.e. nothing to do).
//
// Rules:
//   - name_ja -> i18n.ja.name (only if i18n.ja.name is not ALREADY set --
//     re-run safety: never overwrite a value a previous run already
//     placed there).
//   - flavor_ja -> i18n.ja.flavor, same rule.
//   - name_ja / flavor_ja are deleted from the entry unconditionally once
//     processed (whether or not they ended up copied), so a second run
//     has nothing left to migrate (idempotent).
function migrateEntry(entry) {
  const records = [];
  const hasNameJa = Object.prototype.hasOwnProperty.call(entry, 'name_ja');
  const hasFlavorJa = Object.prototype.hasOwnProperty.call(entry, 'flavor_ja');
  if (!hasNameJa && !hasFlavorJa) return records;

  if (!entry.i18n || typeof entry.i18n !== 'object') entry.i18n = {};
  if (!entry.i18n.ja || typeof entry.i18n.ja !== 'object') entry.i18n.ja = {};

  if (hasNameJa) {
    const before = entry.name_ja;
    if (entry.i18n.ja.name === undefined) {
      entry.i18n.ja.name = before;
    }
    records.push({ id: entry.id, field: 'name', before: before, after: entry.i18n.ja.name });
    delete entry.name_ja;
  }
  if (hasFlavorJa) {
    const before = entry.flavor_ja;
    if (entry.i18n.ja.flavor === undefined) {
      entry.i18n.ja.flavor = before;
    }
    records.push({ id: entry.id, field: 'flavor', before: before, after: entry.i18n.ja.flavor });
    delete entry.flavor_ja;
  }
  return records;
}

// Migrates a whole live-content-shaped document ({schema, entries: [...]}
// or {schema, batch, note, entries: [...]} for draft.json). Mutates a
// DEEP CLONE of doc (never the input) and returns {doc: migratedDoc,
// records}. Pure -- no I/O -- so this is directly unit-testable.
function migrateDoc(doc) {
  const cloned = JSON.parse(JSON.stringify(doc));
  const records = [];
  const entries = cloned.entries || [];
  for (const entry of entries) {
    records.push.apply(records, migrateEntry(entry));
  }
  return { doc: cloned, records: records };
}

// Asserts every record's before/after strings are byte-identical. Throws
// (does not just log) on the first mismatch -- this is the actual
// verification gate, not a soft warning.
function verifyMigration(records) {
  for (const r of records) {
    if (r.before !== r.after) {
      throw new Error(
        'migrate_i18n: MISMATCH for entry "' + r.id + '" field "' + r.field + '": ' +
        'before=' + JSON.stringify(r.before) + ' after=' + JSON.stringify(r.after)
      );
    }
  }
  return true;
}

// Reads, migrates, verifies, and (if anything changed) atomically
// rewrites one content JSON file. Preserves the original file's trailing-
// newline convention (every content/live/*.json file in this repo ends
// with one), same pattern as server/admin.cjs's applyAdminEdit(). Returns
// {path, changed, records}.
function migrateFile(filePath) {
  const originalText = fs.readFileSync(filePath, 'utf8');
  const doc = JSON.parse(originalText);
  const result = migrateDoc(doc);
  const migrated = result.doc;
  const records = result.records;
  verifyMigration(records);

  const hadTrailingNewline = originalText.endsWith('\n');
  const newText = JSON.stringify(migrated, null, 1) + (hadTrailingNewline ? '\n' : '');
  const changed = newText !== originalText;
  if (changed) {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, '.' + path.basename(filePath) + '.migrate.tmp');
    fs.writeFileSync(tmpPath, newText, 'utf8');
    fs.renameSync(tmpPath, filePath);
  }
  return { path: filePath, changed: changed, records: records };
}

function main() {
  const targets = [LIVE_ITEMS_PATH, LIVE_SIS_PATH].concat(findDraftBatchFiles());
  let totalMigrated = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.log('[migrate_i18n] skip (not found): ' + target);
      continue;
    }
    const result = migrateFile(target);
    totalMigrated += result.records.length;
    console.log(
      '[migrate_i18n] ' + result.path + ': ' + result.records.length + ' field(s) verified byte-identical, ' +
      'file ' + (result.changed ? 'REWRITTEN' : 'unchanged (already migrated)')
    );
  }
  console.log('[migrate_i18n] done -- ' + totalMigrated + ' field(s) migrated+verified across ' + targets.length + ' file(s)');
}

if (require.main === module) {
  main();
}

module.exports = {
  migrateEntry: migrateEntry,
  migrateDoc: migrateDoc,
   verifyMigration: verifyMigration,
  migrateFile: migrateFile,
  findDraftBatchFiles: findDraftBatchFiles,
};
