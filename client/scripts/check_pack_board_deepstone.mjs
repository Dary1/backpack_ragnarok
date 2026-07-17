#!/usr/bin/env node
// client/scripts/check_pack_board_deepstone.mjs -- REQ-0219 board footprint-resolution
// gate (sibling of REQ-0207 check_pack_board_wildlands.mjs).
//
// The contentadmin monster_pack board draws member footprints by resolving each
// member ART shape and transposing it {w,h} -> [fh,fw]=[h,w]. This gate drives the
// REAL production module (client/src/contentadmin/contentShared.ts -- ZERO code change)
// over the batch-007 packs + the artwork shapes verified READ-ONLY against the live
// registry, and asserts every member resolves to exactly the footprint the sim places
// by (the two rosters meet):
//   * 13 ids resolve by EXACT NAME (their session-ns-stripped system_name == their id);
//   * cockatrice / goblin / goblin_shaman / ogre resolve by an explicit artwork_ref:
//     their adopted art lives ONLY under the monsters-003-flux2: namespace (bare names
//     unadopted, verified read-only) -- the batch-006 boar precedent, the deploy PATCH.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT_ROOT, '..');
const BATCH = path.join(REPO, 'content', 'batches', 'batch-007-deepstone-legions');

// Artwork shapes verified READ-ONLY vs artworks.shape (live registry), 2026-07-17,
// keyed by the ref-first (session-ns-stripped) system_name.
const ART_SHAPES = {
  kraken: { w: 10, h: 10 }, sea_serpent: { w: 6, h: 6 }, sahuagin: { w: 3, h: 4 },
  giant_crab: { w: 4, h: 3 }, medusa: { w: 4, h: 4 }, lamia: { w: 4, h: 4 },
  stone_golem: { w: 4, h: 5 }, kobold: { w: 3, h: 4 }, orc_warrior: { w: 3, h: 4 },
  behemoth: { w: 8, h: 8 }, frost_giant: { w: 5, h: 6 }, cyclops: { w: 5, h: 6 },
  troll: { w: 4, h: 5 },
  'monsters-003-flux2:cockatrice': { w: 3, h: 4 },
  'monsters-003-flux2:goblin': { w: 3, h: 4 },
  'monsters-003-flux2:goblin_shaman': { w: 3, h: 4 },
  'monsters-003-flux2:ogre': { w: 4, h: 4 },
};
// enemy id -> the artwork_ref its content_def carries at deploy (null == resolve by name).
const REFS = {
  cockatrice: 'monsters-003-flux2:cockatrice', goblin: 'monsters-003-flux2:goblin',
  goblin_shaman: 'monsters-003-flux2:goblin_shaman', ogre: 'monsters-003-flux2:ogre',
};

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

let artId = 1;
const artIndex = {};
for (const [system_name, shape] of Object.entries(ART_SHAPES)) {
  artIndex[system_name] = { id: artId, system_name, kind: 'monster', shape, gen_width: shape.w * 128, gen_height: shape.h * 128, main_object: '', prompt_template: '', style_override: null, edge_padding: null, adopted_render_id: artId };
  artId++;
}
const defs = enemies.entries.map((e, i) => ({ id: i + 1, system_name: e.id, kind: 'monster_def', brief: '', schema_ref: 'enemy/1', gen_config: {}, adopted_variant_id: null, artwork_ref: REFS[e.id] || null }));

console.log('REQ-0219 deepstone-legions board:');

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

// The ones that MUST use a ref (art name != id): cockatrice (petrifying_court),
// goblin / goblin_shaman / ogre (greenskin_warband).
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
refProof('cockatrice', 'monsters-003-flux2:cockatrice', [4, 3], 'pack_petrifying_court');
refProof('goblin', 'monsters-003-flux2:goblin', [4, 3], 'pack_greenskin_warband');
refProof('goblin_shaman', 'monsters-003-flux2:goblin_shaman', [4, 3], 'pack_greenskin_warband');
refProof('ogre', 'monsters-003-flux2:ogre', [4, 4], 'pack_greenskin_warband');

// Non-square + boss pins (a square proves nothing about the axis on its own).
{
  const dt = S.buildMemberFootprints(S.packMembers(packs.entries.find(p => p.id === 'pack_deep_tide')), defs, artIndex);
  check('kraken 10x10 -> [10,10]', eq(dt.kraken, [10, 10]), JSON.stringify(dt.kraken));
  check('giant_crab {w:4,h:3} -> [3,4], NOT [4,3] (the transposed error)', eq(dt.giant_crab, [3, 4]), JSON.stringify(dt.giant_crab));
  const tr = S.buildMemberFootprints(S.packMembers(packs.entries.find(p => p.id === 'pack_titan_ridge')), defs, artIndex);
  check('cyclops {w:5,h:6} -> [6,5], NOT [5,6] (the transposed error)', eq(tr.cyclops, [6, 5]), JSON.stringify(tr.cyclops));
  check('troll {w:4,h:5} -> [5,4], NOT [4,5] (the transposed error)', eq(tr.troll, [5, 4]), JSON.stringify(tr.troll));
  check('behemoth 8x8 -> [8,8]', eq(tr.behemoth, [8, 8]), JSON.stringify(tr.behemoth));
}

console.log(failures === 0 ? '\nREQ-0219 deepstone-legions board: all assertions pass' : `\nREQ-0219 deepstone-legions board: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
