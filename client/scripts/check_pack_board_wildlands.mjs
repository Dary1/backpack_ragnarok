#!/usr/bin/env node
// client/scripts/check_pack_board_wildlands.mjs -- REQ-0207 board footprint-resolution
// gate (sibling of REQ-0203's check_pack_board_grave_legion.mjs).
//
// The contentadmin monster_pack board draws member footprints by resolving each
// member's ART shape and transposing it {w,h} -> [fh,fw]=[h,w]. This gate drives the
// REAL production module (client/src/contentadmin/contentShared.ts -- ZERO code change)
// over the batch-006 packs + the artwork shapes verified READ-ONLY against the live
// registry, and asserts every member resolves to exactly the footprint the sim places
// by (the two rosters meet):
//   * 9 ids resolve by EXACT NAME (their session-ns-stripped system_name == their id);
//   * `boar`, `giant_snake` and `alpha_werewolf` resolve by an explicit artwork_ref: boar/
//     giant_snake art is namespaced ('monsters-003-flux2:boar' / '...:giant_snake'), and
//     alpha_werewolf's adopted art keeps the pre-rename system_name 'werewolf' (renamed off the
//     units003 unit_def collision) -- exactly the deploy PATCH the REQ prescribes, the wight precedent.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT_ROOT, '..');
const BATCH = path.join(REPO, 'content', 'batches', 'batch-006-wildlands');

// Artwork shapes verified READ-ONLY vs artworks.shape (live registry), 2026-07-17,
// keyed by the ref-first (session-ns-stripped) system_name.
const ART_SHAPES = {
  werewolf: { w: 4, h: 4 }, dire_wolf: { w: 5, h: 4 },
  giant_bat: { w: 4, h: 3 }, giant_spider: { w: 4, h: 3 }, giant_scorpion: { w: 4, h: 3 },
  basilisk: { w: 6, h: 4 }, imp: { w: 3, h: 4 }, gargoyle: { w: 4, h: 4 },
  dullahan: { w: 4, h: 4 }, demon_lord: { w: 8, h: 8 },
  'monsters-003-flux2:boar': { w: 4, h: 3 },        // boar's art carries a namespaced system_name
  'monsters-003-flux2:giant_snake': { w: 4, h: 4 }, // giant_snake's art carries a namespaced system_name
};
// enemy id -> the artwork_ref its content_def carries at deploy (null == resolve by name).
const REFS = { boar: 'monsters-003-flux2:boar', giant_snake: 'monsters-003-flux2:giant_snake', alpha_werewolf: 'werewolf' };

async function loadShared() {
  const server = await createServer({
    configFile: false, root: CLIENT_ROOT,
    server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  });
  try { return await server.ssrLoadModule('/src/contentadmin/contentShared.ts'); }
  finally { await server.close(); }
}

let failures = 0;
function check(name, cond, detail = '') { if (cond) console.log('  ok   ', name); else { failures++; console.log('  FAIL ', name, detail ? `-- ${detail}` : ''); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const S = await loadShared();
const enemies = JSON.parse(fs.readFileSync(path.join(BATCH, 'enemies.json'), 'utf8'));
const packs = JSON.parse(fs.readFileSync(path.join(BATCH, 'packs.json'), 'utf8'));
const footprintById = {}; for (const e of enemies.entries) footprintById[e.id] = e.footprint;

// Build the artwork index (keyed by system_name) + the monster_defs the board reads.
let artId = 1;
const artIndex = {};
for (const [system_name, shape] of Object.entries(ART_SHAPES)) {
  artIndex[system_name] = { id: artId, system_name, kind: 'monster', shape, gen_width: shape.w * 128, gen_height: shape.h * 128, main_object: '', prompt_template: '', style_override: null, edge_padding: null, adopted_render_id: artId };
  artId++;
}
const defs = enemies.entries.map((e, i) => ({ id: i + 1, system_name: e.id, kind: 'monster_def', brief: '', schema_ref: 'enemy/1', gen_config: {}, adopted_variant_id: null, artwork_ref: REFS[e.id] || null }));

console.log('REQ-0207 wildlands board:');

// The transpose the board applies must match the sim's authored footprint, per member,
// for every pack (covers all three wildlands packs).
for (const pack of packs.entries) {
  const members = S.packMembers(pack);
  const fp = S.buildMemberFootprints(members, defs, artIndex);
  for (const m of members) {
    const sh = ART_SHAPES[REFS[m.enemy] || m.enemy];
    const expected = [sh.h, sh.w];
    check(`${pack.id}: ${m.enemy} resolves art -> footprint ${JSON.stringify(expected)} (== sim authored)`,
      eq(fp[m.enemy], expected) && eq(fp[m.enemy], footprintById[m.enemy]),
      `board=${JSON.stringify(fp[m.enemy])} sim=${JSON.stringify(footprintById[m.enemy])}`);
  }
}

// The ones that MUST use a ref (art name != id): boar + alpha_werewolf (in wild_hunt), giant_snake (in venom_nest).
function refProof(enemyId, ref, expectFp, packId) {
  const members = S.packMembers(packs.entries.find(p => p.id === packId));
  const byNameOnly = S.buildMemberFootprints(
    members,
    enemies.entries.map((e, i) => ({ id: i + 1, system_name: e.id, kind: 'monster_def', brief: '', schema_ref: 'enemy/1', gen_config: {}, adopted_variant_id: null, artwork_ref: null })),
    artIndex);
  check(`${enemyId} does NOT resolve by exact name alone (art is namespaced) -- proves the deploy ref is required`,
    !(enemyId in byNameOnly), JSON.stringify(byNameOnly[enemyId]));
  const withRef = S.buildMemberFootprints(members, defs, artIndex);
  check(`${enemyId} DOES resolve once its content_def carries artwork_ref=${ref} -> ${JSON.stringify(expectFp)}`,
    eq(withRef[enemyId], expectFp), JSON.stringify(withRef[enemyId]));
}
refProof('boar', 'monsters-003-flux2:boar', [3, 4], 'pack_wild_hunt');
refProof('alpha_werewolf', 'werewolf', [4, 4], 'pack_wild_hunt');
refProof('giant_snake', 'monsters-003-flux2:giant_snake', [4, 4], 'pack_venom_nest');

// Non-square + boss pins (a square proves nothing about the axis on its own).
{
  const wh = S.buildMemberFootprints(S.packMembers(packs.entries.find(p => p.id === 'pack_wild_hunt')), defs, artIndex);
  check('dire_wolf {w:5,h:4} -> [4,5], NOT [5,4] (the transposed error)', eq(wh.dire_wolf, [4, 5]), JSON.stringify(wh.dire_wolf));
  const vn = S.buildMemberFootprints(S.packMembers(packs.entries.find(p => p.id === 'pack_venom_nest')), defs, artIndex);
  check('basilisk {w:6,h:4} -> [4,6], NOT [6,4] (the transposed error)', eq(vn.basilisk, [4, 6]), JSON.stringify(vn.basilisk));
  const dg = S.buildMemberFootprints(S.packMembers(packs.entries.find(p => p.id === 'pack_demon_gate')), defs, artIndex);
  check('demon_lord 8x8 -> [8,8]', eq(dg.demon_lord, [8, 8]), JSON.stringify(dg.demon_lord));
  check('imp {w:3,h:4} -> [4,3]', eq(dg.imp, [4, 3]), JSON.stringify(dg.imp));
}

console.log(failures === 0 ? '\nREQ-0207 wildlands board: all assertions pass' : `\nREQ-0207 wildlands board: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
