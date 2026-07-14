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
// REQ-0180: the unit_skin/1 SET ledger + the bpskin/1 defs its sets reference.
const unitSkins = load(path.join(CONTENT, 'live', 'live_unit_skins.json'));
let bpskins; try { bpskins = load(path.join(CONTENT, 'live', 'live_bpskins.json')); } catch (e) { bpskins = { entries: [] }; }
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
// REQ-0180: unit_skin/1 SET ledger + cross-references (a set's bpskin must be a
// LIVE bpskin/1 def; a unit's default set must be a LIVE set). A dangling ref is
// exactly the silent-lie failure mode this gate exists to catch.
if (unitSkins.kind !== 'unit_skin/1') fail('live_unit_skins.json: kind must be "unit_skin/1", got ' + JSON.stringify(unitSkins.kind));
const bpskinIds = new Set((bpskins.entries || []).map((e) => e.id));
const setIds = new Set();
for (const e of (unitSkins.entries || [])) {
  if (!e || typeof e.id !== 'string' || !e.id) { fail('unit_skin set: id is required'); continue; }
  if (setIds.has(e.id)) fail('duplicate unit_skin set id "' + e.id + '"');
  setIds.add(e.id);
  if (e.kind !== 'unit_skin/1') fail('unit_skin "' + e.id + '": kind must be "unit_skin/1"');
  if (typeof e.name !== 'string' || !e.name) fail('unit_skin "' + e.id + '": name is required');
  if (typeof e.art_unit !== 'string' || !e.art_unit) fail('unit_skin "' + e.id + '": art_unit is required (a kind=unit artwork system_name)');
  if (typeof e.bpskin !== 'string' || !e.bpskin) fail('unit_skin "' + e.id + '": bpskin is required (a bpskin/1 def id)');
  else if (!bpskinIds.has(e.bpskin)) fail('unit_skin "' + e.id + '": bpskin "' + e.bpskin + '" is not a live bpskin/1 def id');
}
for (const e of (units.entries || [])) {
  if (e.unit_skin !== undefined && !setIds.has(e.unit_skin)) fail('unit "' + e.id + '": unit_skin "' + e.unit_skin + '" names no live unit_skin/1 set');
}
console.log('unit_skins: ' + setIds.size + ' sets (all bpskin refs checked against ' + bpskinIds.size + ' bpskin defs)');
console.log('failures: ' + failures);
if (failures) process.exit(1);
console.log('ALL GREEN');
