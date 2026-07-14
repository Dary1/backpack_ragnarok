#!/usr/bin/env node
// client/scripts/check_unit_skin.mjs -- REQ-0180 gate. Exercises the REAL
// unit_skin/1 registry + resolver (client/src/board/skin/unitSkinRegistry.ts)
// from plain Node via vite ssrLoadModule (same rig as check_bpskin.mjs), and
// cross-checks the LIVE ledger: every set names a live bpskin/1 def, every
// unit's default set is a live set. Pure functions, no Pixi/DOM. Exit 0 = green.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(a === b, `${m} (got ${a}, want ${b})`); }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const us = await server.ssrLoadModule('/src/board/skin/unitSkinRegistry.ts');
    const ui = await server.ssrLoadModule('/src/board/unitIcon.ts');

    // validator
    const good = { kind: 'unit_skin/1', id: 's', name: 'S', art_unit: 'batch:art', bpskin: 'devornate' };
    ok(us.validateUnitSkinDef(good).ok, 'well-formed set passes validation');
    ok(!us.validateUnitSkinDef({ kind: 'unit_skin/1', id: 's', name: 'S', bpskin: 'devornate' }).ok, 'missing art_unit rejected');
    ok(!us.validateUnitSkinDef({ kind: 'unit_skin/1', id: 's', name: 'S', art_unit: 'a' }).ok, 'missing bpskin rejected');
    ok(!us.validateUnitSkinDef({ kind: 'wrong/1', id: 's', name: 'S', art_unit: 'a', bpskin: 'b' }).ok, 'wrong kind rejected');

    // load the LIVE ledger + cross-ref against live bpskins
    const doc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_unit_skins.json'), 'utf8'));
    const bpDoc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8'));
    const unitsDoc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_units.json'), 'utf8'));
    const sets = us.loadUnitSkinDefs(doc);
    const setKeys = Object.keys(sets);
    ok(setKeys.length === (doc.entries || []).length && setKeys.length > 0, `all ${setKeys.length} live sets load`);
    const bpIds = new Set((bpDoc.entries || []).map((e) => e.id));
    for (const k of setKeys) ok(bpIds.has(sets[k].bpskin), `set "${k}" bpskin "${sets[k].bpskin}" is a live bpskin def`);
    for (const e of (unitsDoc.entries || [])) if (e.unit_skin !== undefined) ok(!!sets[e.unit_skin], `unit "${e.id}" default set "${e.unit_skin}" is live`);

    // one invalid entry is dropped, never throws
    const dropped = us.loadUnitSkinDefs({ entries: [good, { kind: 'unit_skin/1', id: 'bad' }] });
    eq(Object.keys(dropped).length, 1, 'invalid entry dropped (never blocks)');

    // module registry + resolution
    us.setUnitSkinDefs(sets);
    ok(us.allUnitSkinKeys().length === setKeys.length, 'allUnitSkinKeys returns every loaded set (availability floor = all)');
    ok(us.getUnitSkinDef(setKeys[0]) && us.getUnitSkinDef('nope') === null, 'getUnitSkinDef hit/miss');
    eq(us.resolveUnitSkinKey('per_place', 'def_default'), 'per_place', 'per-placement override wins');
    eq(us.resolveUnitSkinKey(null, 'def_default'), 'def_default', 'def default when no override');
    eq(us.resolveUnitSkinKey(undefined, undefined), null, 'null when neither set (plain floor)');
    eq(us.resolveUnitSkinKey('', 'def_default'), 'def_default', 'empty override falls through');

    // icon key namespacing + raster manifest
    eq(ui.unitSkinIconKey('elf_default'), 'unitskin:elf_default', 'unit_skin icon key namespaced');
    const rasters = us.unitSkinIconRasters();
    ok(rasters.length === setKeys.length, 'one Unit-core raster per set');
    ok(rasters.every((r) => r.key.startsWith('unitskin:') && r.url.endsWith('.png')), 'raster keys namespaced + urls end .png (Pixi parser)');
  } finally { await server.close(); }
  if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
  console.log('\ncheck_unit_skin: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
