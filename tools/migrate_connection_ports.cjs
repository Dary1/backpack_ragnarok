#!/usr/bin/env node
// tools/migrate_connection_ports.cjs -- REQ-0023 one-shot content migration.
//
// Migrates PO-bearing content JSON entries from the old flat `conn` field
// (external target tiles, no tag) to the new `ports` array used by the
// Connection Port model (see docs/REQ/REQ-0023-connection-port-model.md):
//
//   conn: [[x,y], ...]  -->  ports: [ {tiles:[[x,y],...], tag}, ... ]
//
// WHY AN ARRAY OF PORTS (not a single {tiles,tag}): the pre-migration engine
// hard-coded per-recipe `el`/tag membership checks directly inside combos()
// (see shared/engine.js combos(), REQ-0022-era code) -- e.g. flame_tablet's
// single physical `conn` (2 tiles, aimed at whatever sits beside it) backed
// TWO separate recipes: "Ignite" (needs a Flame PO connected to an Oil PO)
// and "Flaming Blade" (needs a Flame PO connected to a Weapon PO). A port
// carries exactly ONE tag (per REQ-0023's {tiles,tag} shape), so a PO whose
// old `conn` needed to recognize more than one partner-tag emits MULTIPLE
// ports that share the same `tiles` (same physical connection point) but
// each declare a different tag. This is a lossless, mechanical unpacking of
// the old hard-coded tag checks into the general port model -- see the
// inference table below for the exact old-check -> port-tag mapping used
// for every migrated entry.
//
// ---------------------------------------------------------------------
// INFERENCE TABLE (old recipe/effect-text semantics -> inferred port tag)
// ---------------------------------------------------------------------
// content/live/live_items.json (LIVE, feeds shared/engine.js combos()):
//
//   flame_tablet (tags: Rune, Flame; conn aims at the Weapon/blade neighbor)
//     -> TWO ports, same tiles as old conn:
//        {tag:"Weapon"} -- preserves "Flaming Blade" (flame_tablet.combos()
//                          check: hasTag(...,'Flame') PO connected to a
//                          hasTag(...,'Weapon') PO). Also matches this PO's
//                          own displayed effect "Adjacent Weapon: ...Burn".
//        {tag:"Oil"}    -- preserves "Ignite" (Flame PO connected to an Oil
//                          PO). Also matches this PO's own displayed effect
//                          "Adjacent Oil: ...amp Burn x2".
//
//   oil_flask (tags: Reagent, Oil; conn aims at the Flame/flame_tablet
//   neighbor)
//     -> ONE port, same tiles as old conn: {tag:"Flame"} -- preserves
//        "Ignite" from the oil side (symmetric geometric check in combos()
//        already treats either PO's target tiles landing on the other as
//        sufficient; this port supplies the oil-side half of that OR).
//        Matches this PO's own displayed effect "Adjacent Flame: ...amp
//        Burn x2".
//
// content/batches/batch-001-niflheim/draft.json (DRAFT/staging -- NOT fed
// into the engine/combos()/tests today; see tool_gen_data.cjs/tool_integrate
// .cjs, neither of which reads draft.json. This migration is SCHEMA-ONLY
// for these three entries: no runtime behavior currently depends on their
// conn/ports field, so tags are inferred from the recovered
// effects_text_en/ja tooltip strings, best-effort, matching the same
// port-tag-is-the-partner-tag convention used for the two live entries.):
//
//   rime_shard (tags: Rune, Frost; effects_text: "Adjacent Weapon: Apply
//   4-8 Chill on hit.")
//     -> ONE port, same tiles as old conn: {tag:"Weapon"}
//
//   hoarfrost_creep (tags: Reagent, Frost, Wood; effects_text: "Adjacent
//   Flame: Chill applications x2. ...")
//     -> ONE port, same tiles as old conn: {tag:"Flame"}
//
//   niflheim_crown (tags: Relic, Frost, Metal; effects_text: "...Adjacent
//   Frost: Chill applications x2.")
//     -> ONE port, same tiles as old conn: {tag:"Frost"}
//
// All other entries across both files have no `conn` field and are left
// untouched (skipped).
//
// Schema version bump: content/vocab.json "version" 3 -> 4 (documents that
// the `conn`->`ports` content-schema change has landed; vocab.json's own
// po_tags/socket_tags trees are unchanged by this migration).
//
// Usage: node tools/migrate_connection_ports.cjs [--dry-run]
//   (paths are fixed project-relative constants, run from repo root or anywhere)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOCAB_PATH = path.join(ROOT, 'content', 'vocab.json');
const TARGETS = [
  path.join(ROOT, 'content', 'live', 'live_items.json'),
  path.join(ROOT, 'content', 'live', 'live_sis.json'),
  path.join(ROOT, 'content', 'batches', 'batch-001-niflheim', 'draft.json'),
];

// Explicit inference table (id -> array of tags to attach as ports, one
// port per tag, all sharing the entry's existing `conn` tile list). Any
// `conn`-bearing entry NOT listed here has no known/inferable tag mapping;
// the script aborts loudly rather than guessing (see main()).
const PORT_TAG_INFERENCE = {
  flame_tablet: ['Weapon', 'Oil'],
  oil_flask: ['Flame'],
  rime_shard: ['Weapon'],
  hoarfrost_creep: ['Flame'],
  niflheim_crown: ['Frost'],
};

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function entriesOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  throw new Error('Unrecognized content JSON shape (no entries[] / not a bare array)');
}

// Migrates one entry in place: conn:[[x,y],...] -> ports:[{tiles,tag},...].
// Returns 'migrated' | 'skipped' (no conn field) | throws if conn is present
// but has no inference-table entry (unknown mapping -- do not guess).
function migrateEntryConn(entry) {
  const hadConn = Object.prototype.hasOwnProperty.call(entry, 'conn');
  if (!hadConn) return 'skipped';

  const tags = PORT_TAG_INFERENCE[entry.id];
  if (!tags || !tags.length) {
    throw new Error(
      'entry ' + entry.id + ' has a "conn" field but no entry in PORT_TAG_INFERENCE -- ' +
      'refusing to guess a port tag. Add an explicit, documented mapping before migrating.'
    );
  }

  const tiles = entry.conn.map(function (o) { return [o[0], o[1]]; });
  entry.ports = tags.map(function (tag) { return { tiles: tiles.map(function (t) { return [t[0], t[1]]; }), tag: tag }; });
  delete entry.conn;
  return 'migrated';
}

function bumpVocabVersion(dryRun) {
  const vocab = loadJSON(VOCAB_PATH);
  const before = vocab.version;
  if (typeof before !== 'number') {
    throw new Error('vocab.json "version" field missing or not a number; refusing to bump blindly');
  }
  vocab.version = before + 1;
  if (!dryRun) {
    fs.writeFileSync(VOCAB_PATH, JSON.stringify(vocab, null, 1) + '\n');
  }
  return { before, after: vocab.version };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = [];

  for (const target of TARGETS) {
    const label = path.relative(ROOT, target);
    const data = loadJSON(target);
    const entries = entriesOf(data);

    let migratedCount = 0;
    let skippedCount = 0;
    const migratedIds = [];
    for (const entry of entries) {
      const result = migrateEntryConn(entry);
      if (result === 'migrated') { migratedCount++; migratedIds.push(entry.id); }
      else skippedCount++;
    }

    summary.push({ file: label, total: entries.length, migrated: migratedCount, skipped: skippedCount, migratedIds });

    if (!dryRun) {
      fs.writeFileSync(target, JSON.stringify(data, null, 1) + '\n');
    }
  }

  const vocabBump = bumpVocabVersion(dryRun);

  console.log('=== migrate_connection_ports.cjs ' + (dryRun ? '(DRY RUN, no files written)' : '') + ' ===');
  for (const s of summary) {
    console.log(s.file + ': ' + s.total + ' entries total, ' + s.migrated +
      ' migrated (conn -> ports) [' + s.migratedIds.join(', ') + '], ' + s.skipped + ' skipped (no conn field)');
  }
  console.log('content/vocab.json: version ' + vocabBump.before + ' -> ' + vocabBump.after);
}

main();
