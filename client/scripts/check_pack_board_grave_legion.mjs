#!/usr/bin/env node
// client/scripts/check_pack_board_grave_legion.mjs -- REQ-0203 G5.
//
// The contentadmin monster_pack board draws member footprints by resolving each
// member's ART shape and transposing it. REQ-0203 is where "the two rosters finally
// meet": the sim's authored enemy/1 footprint [fh,fw] and the artwork shape {w,h}
// must agree for every batch-005 member. This gate drives the REAL production module
// (client/src/contentadmin/contentShared.ts -- ZERO code change) over the actual
// batch-005 packs + the artwork shapes verified read-only against the live registry,
// and asserts every member resolves to the footprint the sim places by.
//   * 7 ids resolve by EXACT NAME (their art system_name == their id);
//   * `wight` resolves by an explicit artwork_ref (its art is 'monsters-003-flux2:wight'),
//     exactly the deploy PATCH the REQ prescribes.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT_ROOT, '..');
const BATCH = path.join(REPO, 'content', 'batches', 'batch-005-grave-legion');

// Artwork shapes verified read-only vs artworks.shape (live registry), 2026-07-17.
const ART_SHAPES = {
  zombie: { w: 3, h: 4 }, ghost: { w: 3, h: 4 }, mummy: { w: 3, h: 4 },
  skeleton_warrior: { w: 3, h: 4 }, necromancer: { w: 3, h: 4 },
  lich: { w: 4, h: 5 }, bone_dragon: { w: 10, h: 10 },
  'monsters-003-flux2:wight': { w: 3, h: 4 }, // wight's art carries a namespaced system_name
};
// enemy id -> the artwork_ref its content_def carries at deploy (null == resolve by name).
const REFS = { wight: 'monsters-003-flux2:wight' };

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

console.log('REQ-0203 grave-legion board:');

// The transpose the board applies must match the sim's authored footprint, per member.
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

// The one that MUST use a ref (its art name != its id): wight.
{
  const members = S.packMembers(packs.entries.find(p => p.id === 'pack_grave_legion'));
  const byNameOnly = S.buildMemberFootprints(members, enemies.entries.map((e, i) => ({ id: i + 1, system_name: e.id, kind: 'monster_def', brief: '', schema_ref: 'enemy/1', gen_config: {}, adopted_variant_id: null, artwork_ref: null })), artIndex);
  check('wight does NOT resolve by exact name alone (art is namespaced) -- proves the deploy ref is required',
    !('wight' in byNameOnly), JSON.stringify(byNameOnly.wight));
  const withRef = S.buildMemberFootprints(members, defs, artIndex);
  check('wight DOES resolve once its content_def carries artwork_ref=monsters-003-flux2:wight -> [4,3]',
    eq(withRef.wight, [4, 3]), JSON.stringify(withRef.wight));
}

// bone_dragon (10x10 square proves nothing about the axis alone) + lich (non-square) pins.
{
  const members = S.packMembers(packs.entries.find(p => p.id === 'pack_bone_court'));
  const fp = S.buildMemberFootprints(members, defs, artIndex);
  check('bone_dragon 10x10 -> [10,10]', eq(fp.bone_dragon, [10, 10]));
  check('lich {w:4,h:5} -> [5,4], NOT [4,5] (the transposed error)', eq(fp.lich, [5, 4]), JSON.stringify(fp.lich));
}

console.log(failures === 0 ? '\nREQ-0203 grave-legion board: all assertions pass' : `\nREQ-0203 grave-legion board: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
