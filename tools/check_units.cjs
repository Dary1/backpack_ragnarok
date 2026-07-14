#!/usr/bin/env node
'use strict';
// tools/check_units.cjs -- REQ-0170. THE gate on Unit content.
//
// Four things must hold, and nothing here is a style preference -- each one is a
// failure mode that has a name in this project's history:
//
//   1. Every unit/1 def validates against the RATIFIED schema + closed vocabulary
//      (shared/content_validate.cjs validateUnitEntry). An unknown connection_shape
//      resolves to null at walk time and the Unit forms no links, silently. A def
//      that lies quietly is worse than one that fails loudly.
//   2. Every def's `icon` names an artwork that has actually been ADOPTED. This is the
//      illustration-first law (unit_icon_pipeline.md G1): a def may only be authored
//      against accepted art. The AUTHORITY is the artwork registry (the DB) -- the
//      PNGs under content/art/ are an export mirror and are NOT in git (REQ-0151: only
//      the adopted asset ever reaches content/, and only on a dedicated branch). So
//      this check uses the export dir when one exists in this tree, and SKIPS -- loudly
//      -- when it does not, rather than failing a worktree for not carrying binaries
//      it was never meant to carry. The board itself loads art from /api/art/<icon>,
//      which reads the DB, and a 404 there is already a non-event (unitIcon.ts's
//      fallback chain).
//   3. Every gacha_pack/1 pool row names a unit that HAS a live def. A pool row
//      pointing at a missing def is a roll that either crashes or silently skips.
//   4. `icon` is NOT asserted to be 'icon-' + id. That convention is DEAD (REQ-0149
//      G14: Princess and Little Princess are two defs sharing one artwork), and a
//      gate that re-imposed it would forbid the ruling.
const fs = require('fs');
const path = require('path');
const { validateUnitEntry, validatePackEntry } = require('../shared/content_validate.cjs');

const ROOT = path.join(__dirname, '..');
const CONTENT = process.env.CONTENT_ROOT || path.join(ROOT, 'content');
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const vocab = load(path.join(CONTENT, 'vocab.json'));
const units = load(path.join(CONTENT, 'live', 'live_units.json'));
const packs = load(path.join(CONTENT, 'live', 'live_packs.json'));
// REQ-0062: bonus-slot tables reference PO / SI / TM live content -- load their id
// sets so validatePackEntry can reject a table that names content with no live def.
const liveItems = load(path.join(CONTENT, 'live', 'live_items.json'));
const liveSis = load(path.join(CONTENT, 'live', 'live_sis.json'));
const liveTms = load(path.join(CONTENT, 'live', 'live_tms.json'));
const contentIds = {
  po: new Set((liveItems.entries || []).map((e) => e.id)),
  si: new Set((liveSis.entries || []).map((e) => e.id)),
  tm: new Set((liveTms.entries || []).map((e) => e.id)),
};

let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };

const ART_DIR = path.join(CONTENT, 'art', 'unit');
const artDirExists = fs.existsSync(ART_DIR);
if (!artDirExists) {
  console.log('SKIP  art-existence check -- no ' + ART_DIR + ' in this tree. Adopted art lives in the artwork');
  console.log('      registry (DB) and is served from /api/art/<icon>; the content/art export is not in git.');
}

if (units.schema !== 'unit/1') fail('live_units.json: schema must be "unit/1", got ' + JSON.stringify(units.schema));
if (packs.schema !== 'gacha_pack/1') fail('live_packs.json: schema must be "gacha_pack/1", got ' + JSON.stringify(packs.schema));

const seen = new Set();
for (const e of (units.entries || [])) {
  try {
    validateUnitEntry(e, vocab);
  } catch (err) {
    fail(err.message);
    continue;
  }
  if (seen.has(e.id)) fail('duplicate unit id "' + e.id + '"');
  seen.add(e.id);
  if (artDirExists) {
    const art = path.join(ART_DIR, e.icon + '.png');
    if (!fs.existsSync(art)) {
      fail('unit "' + e.id + '": icon "' + e.icon + '" has no exported artwork at content/art/unit/' + e.icon + '.png ' +
           '(illustration-first: adopt the render -- adoption is what exports the asset)');
    }
  }
}

for (const p of (packs.entries || [])) {
  try {
    validatePackEntry(p, seen, contentIds);
  } catch (err) {
    fail(err.message);
  }
}

const shapes = Object.keys(vocab.connection_shapes || {});
const used = new Set((units.entries || []).map((e) => e.connection_shape));
console.log('units: ' + seen.size + ' defs / ' + used.size + ' distinct shapes used (of ' + shapes.length + ' in the vocabulary)');
console.log('packs: ' + (packs.entries || []).length + ' / pool rows: ' + (packs.entries || []).reduce((n, p) => n + (p.pool || []).length, 0));
console.log('bonus slots: ' + (packs.entries || []).reduce((n, p) => n + (p.bonus || []).length, 0) + ' (REQ-0062)');
console.log('failures: ' + failures);
if (failures) process.exit(1);
console.log('ALL GREEN');
