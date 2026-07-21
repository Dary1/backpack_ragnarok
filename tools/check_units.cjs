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
//   5. REQ-0266: every unit_skin/1 def validates, AND the corpus rule holds -- at most
//      ONE default per (unit, slot). That rule is a property of the whole corpus, so
//      no per-variant machine check can see it (content_checks validates one variant
//      in isolation, and a variant is routinely a not-yet-adopted candidate). THIS is
//      where it is enforced. A second default would make the resolver pick one
//      arbitrarily -- the same class of quiet lie as (1).
const fs = require('fs');
const path = require('path');
const { validateUnitEntry, validatePackEntry, validateUnitSkinEntry } = require('../shared/content_validate.cjs');

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
    // REQ-0213 gate fix: a unit icon may reference an artwork of ANY kind
    // (art-first units use po illustrations; serving is /api/art/<icon>,
    // kind-agnostic), and the adoption export routes by ARTWORK kind --
    // content/art/<kind>/<name>.png. So look across every kind dir, not
    // only unit/.
    const artRoot = path.dirname(ART_DIR);
    let found = fs.existsSync(path.join(ART_DIR, e.icon + '.png'));
    if (!found) {
      try {
        for (const k of fs.readdirSync(artRoot)) {
          if (fs.existsSync(path.join(artRoot, k, e.icon + '.png'))) { found = true; break; }
        }
      } catch (err) { /* mirror layout unreadable -> fall through to fail */ }
    }
    if (!found) {
      fail('unit "' + e.id + '": icon "' + e.icon + '" has no exported artwork under content/art/*/' + e.icon + '.png ' +
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

// REQ-0266: the unit_skin/1 corpus. Optional-with-a-loud-SKIP, the same posture as
// the art-existence check above: a synthetic CONTENT_ROOT (the api_test fixture tree)
// ships no skins, and a gate that failed a tree for not carrying content it was never
// meant to carry would be a gate nobody could run.
const SKINS_PATH = path.join(CONTENT, 'live', 'live_unit_skins.json');
if (!fs.existsSync(SKINS_PATH)) {
  console.log('SKIP  unit_skin check -- no ' + SKINS_PATH + ' in this content root.');
} else {
  const skins = load(SKINS_PATH);
  if (skins.schema !== 'unit_skin/1') fail('live_unit_skins.json: schema must be "unit_skin/1", got ' + JSON.stringify(skins.schema));
  const skinEntries = skins.entries || [];
  const skinSeen = new Set();
  for (const s of skinEntries) {
    try {
      // The WHOLE corpus is handed in, which is what makes the at-most-one-default
      // -per-(unit, slot) rule checkable; the validator skips the entry itself.
      validateUnitSkinEntry(s, { unitIds: seen, skinIds: skinEntries });
    } catch (err) {
      fail(err.message);
      continue;
    }
    if (skinSeen.has(s.id)) fail('duplicate unit_skin id "' + s.id + '"');
    skinSeen.add(s.id);
    // content_defs.system_name is UNIQUE ACROSS KINDS -- a skin id that collides with
    // a unit id would FATAL the deploy backfill (tools/backfill_content_registry.cjs
    // collectAll). Cheap to check here, where both rosters are already in hand.
    if (seen.has(s.id)) fail('unit_skin id "' + s.id + '" collides with a unit def id (system_name is UNIQUE across kinds)');
  }
  const bySlot = {};
  for (const s of skinEntries) bySlot[s.slot] = (bySlot[s.slot] || 0) + 1;
  console.log('unit skins: ' + skinSeen.size + ' defs (' + Object.keys(bySlot).sort().map((k) => k + '=' + bySlot[k]).join(' ') + ')');
}

const shapes = Object.keys(vocab.connection_shapes || {});
const used = new Set((units.entries || []).map((e) => e.connection_shape));
console.log('units: ' + seen.size + ' defs / ' + used.size + ' distinct shapes used (of ' + shapes.length + ' in the vocabulary)');
// REQ-0200: `charge` is now part of the unit/1 schema; validateUnitEntry above ran
// validateCharge on every def that carries one. Report the count so a def growing a
// charge block is visible in the gate output.
const withCharge = (units.entries || []).filter((e) => e && e.charge).length;
console.log('units with charge blocks: ' + withCharge + ' (each validated via validateCharge)');
console.log('packs: ' + (packs.entries || []).length + ' / pool rows: ' + (packs.entries || []).reduce((n, p) => n + (p.pool || []).length, 0));
console.log('bonus slots: ' + (packs.entries || []).reduce((n, p) => n + (p.bonus || []).length, 0) + ' (REQ-0062)');
console.log('failures: ' + failures);
if (failures) process.exit(1);
console.log('ALL GREEN');
