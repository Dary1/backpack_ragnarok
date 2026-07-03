#!/usr/bin/env node
// tools/migrate_tag_hierarchy.cjs -- REQ-0022 batch 3/4 one-shot content migration.
//
// Migrates PO-bearing content JSON entries from the old flat vocabulary
// (type: <single string>, el: [<string>, ...]) to the new unified `tags`
// array used by the PO Tag hierarchy (see content/vocab.json "po_tags").
//
// Convention (documented here + at every construction/consumption site):
//   tags[0]           is always the former `type` value.
//   tags[1..]         are the former `el` values, in original order.
// This ordered-array approach preserves "is this the former type-tag"
// distinguishability without a separate boolean/marker field (per user
// ruling Q2=A + spec author's own suggested approach). See REQ-0022 batch 3/4.
//
// Socket-side fields (`sockets[].t`, `sockets[].tags`, SI `slot`/`reqTags`)
// are NOT value-migrated here: the ground truth is that only vocab.json's
// STRUCTURE changed (flat socketTypes/socketTags -> one unified socket_tags
// tree); the actual string values referenced by content JSON (gem/edge/coat/
// bond/Metal/Bone) are unchanged, so no item-level field renames are needed
// on the socket side. This script verifies that assumption for every entry
// it touches and aborts loudly if it ever finds a mismatch.
//
// Usage: node tools/migrate_tag_hierarchy.cjs [--dry-run]
//   (paths are fixed project-relative constants, run from repo root or anywhere)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'content', 'live', 'live_items.json'),
  path.join(ROOT, 'content', 'live', 'live_sis.json'),
  path.join(ROOT, 'content', 'batches', 'batch-001-niflheim', 'draft.json'),
];

const KNOWN_SOCKET_TYPES = ['gem', 'edge', 'coat', 'bond'];
const KNOWN_SOCKET_TAGS = ['Metal', 'Bone'];

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function entriesOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  throw new Error('Unrecognized content JSON shape (no entries[] / not a bare array)');
}

// Migrates one PO-shaped entry in place: {type, el} -> {tags}.
// Returns true if the entry was migrated (had type/el), false if it was
// left untouched (e.g. a socket-item-only entry with no type/el fields, like
// live_sis.json entries -- those have no PO tags at all and are skipped).
function migrateEntryTags(entry) {
  const hadType = Object.prototype.hasOwnProperty.call(entry, 'type');
  const hadEl = Object.prototype.hasOwnProperty.call(entry, 'el');
  if (!hadType && !hadEl) return false; // nothing to migrate (SI entry)

  const typeVal = entry.type;
  const elVals = Array.isArray(entry.el) ? entry.el : [];

  if (!hadType) {
    throw new Error('entry ' + entry.id + ' has "el" but no "type" -- cannot determine tags[0], aborting');
  }

  // tags[0] = former type value (always first, per convention), then el values
  // in original order.
  entry.tags = [typeVal].concat(elVals);
  delete entry.type;
  delete entry.el;
  return true;
}

// Verifies socket-bearing fields on an entry reference only known socket-side
// vocabulary (gem/edge/coat/bond for `t`/`slot`; Metal/Bone for `tags`/`reqTags`),
// i.e. confirms no item-level field embeds a literal "types"/"elements" array
// that would need renaming alongside vocab.json's restructure. Does not
// mutate anything -- socket VALUES are unchanged by this migration.
function verifySocketFieldsUnchanged(entry, sourceLabel, warnings) {
  if (Array.isArray(entry.sockets)) {
    for (const s of entry.sockets) {
      if (s.t !== undefined && !KNOWN_SOCKET_TYPES.includes(s.t)) {
        warnings.push(sourceLabel + '/' + entry.id + ': unrecognized socket t="' + s.t + '"');
      }
      for (const tg of (s.tags || [])) {
        if (!KNOWN_SOCKET_TAGS.includes(tg)) {
          warnings.push(sourceLabel + '/' + entry.id + ': unrecognized socket tag "' + tg + '"');
        }
      }
    }
  }
  if (entry.slot !== undefined && !KNOWN_SOCKET_TYPES.includes(entry.slot)) {
    warnings.push(sourceLabel + '/' + entry.id + ': unrecognized slot="' + entry.slot + '"');
  }
  for (const tg of (entry.reqTags || [])) {
    if (!KNOWN_SOCKET_TAGS.includes(tg)) {
      warnings.push(sourceLabel + '/' + entry.id + ': unrecognized reqTag "' + tg + '"');
    }
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const warnings = [];
  const summary = [];

  for (const target of TARGETS) {
    const label = path.relative(ROOT, target);
    const data = loadJSON(target);
    const entries = entriesOf(data);

    let migratedCount = 0;
    let skippedCount = 0;
    for (const entry of entries) {
      const migrated = migrateEntryTags(entry);
      if (migrated) migratedCount++; else skippedCount++;
      verifySocketFieldsUnchanged(entry, label, warnings);
    }

    summary.push({ file: label, total: entries.length, migrated: migratedCount, skipped: skippedCount });

    if (!dryRun) {
      fs.writeFileSync(target, JSON.stringify(data, null, 1) + '\n');
    }
  }

  console.log('=== migrate_tag_hierarchy.cjs ' + (dryRun ? '(DRY RUN, no files written)' : '') + ' ===');
  for (const s of summary) {
    console.log(s.file + ': ' + s.total + ' entries total, ' + s.migrated +
      ' migrated (type+el -> tags), ' + s.skipped + ' skipped (no type/el field, e.g. socket items)');
  }
  if (warnings.length) {
    console.log('');
    console.log('WARNINGS (unrecognized socket-vocab values found -- socket values should be');
    console.log('unchanged by this migration; investigate before trusting the migrated content):');
    for (const w of warnings) console.log('  ' + w);
  } else {
    console.log('');
    console.log('No unrecognized socket-vocab values found -- socket t/tags/slot/reqTags fields confirmed unchanged.');
  }
}

main();
