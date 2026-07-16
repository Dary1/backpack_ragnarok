#!/usr/bin/env node
// client/scripts/check_pack_board.mjs -- REQ-0184 gate.
//
// Exercises the REAL production module (client/src/contentadmin/contentShared.ts)
// that the monster_pack board preview draws from. Pure functions (no DOM, no
// Pixi), so plain Node drives them once Vite has transpiled the TS -- the same
// vite-ssrLoadModule rig and the same reason as check_link_trace.mjs.
//
// WHAT THIS GATE IS FOR. A monster's cell size exists in two vocabularies:
//   enemy/1  footprint {[fh, fw]}  -- [height, width]; what sim/lib/packs.cjs places by
//   artwork  shape     {w, h}      -- {width, height}; what art_sizing.cjs generates at
// The board resolves footprints from the ART, so it crosses that transpose on
// every member. Get it backwards and a 6x4 chimera silently draws as 4x6 -- a
// preview that is confidently, quietly wrong about the one thing the kind exists
// to show. That is what these assertions exist to catch.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

async function loadShared() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    return await server.ssrLoadModule('/src/contentadmin/contentShared.ts');
  } finally {
    await server.close();
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log('  ok   ', name);
  else { failures++; console.log('  FAIL ', name, detail ? `-- ${detail}` : ''); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const S = await loadShared();

console.log('REQ-0184 monster_pack board:');

// ---- the transpose, pinned against art_sizing.cjs's OWN ratified examples ----
// "goblin 3x4 -> 384x512" means w=3,h=4 (3*128=384 wide, 4*128=512 tall).
// So the footprint is [fh,fw] = [4,3]: 4 rows tall, 3 cols wide.
check('art shape {w:3,h:4} (art_sizing goblin) -> footprint [4,3] (h,w)',
  eq(S.footprintFromArtShape({ w: 3, h: 4 }), [4, 3]), JSON.stringify(S.footprintFromArtShape({ w: 3, h: 4 })));
check('art shape {w:6,h:4} (art_sizing chimera) -> footprint [4,6] -- NOT [6,4]',
  eq(S.footprintFromArtShape({ w: 6, h: 4 }), [4, 6]), JSON.stringify(S.footprintFromArtShape({ w: 6, h: 4 })));
check('art shape {w:10,h:10} (art_sizing ancient dragon) -> [10,10] (square: transpose-blind, so it proves nothing alone)',
  eq(S.footprintFromArtShape({ w: 10, h: 10 }), [10, 10]));

// ---- a non-square footprint must occupy the cells the SIM would occupy ----
// cellsFor is the same derivation shared/content_validate.cjs uses.
const cells = S.cellsFor(S.parseA1('B2'), S.footprintFromArtShape({ w: 3, h: 4 }));
check('a {w:3,h:4} monster at B2 occupies 4 ROWS x 3 COLS (B2:D5)',
  eq(cells, [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4], [5, 2], [5, 3], [5, 4]]),
  JSON.stringify(cells.map((c) => S.formatA1(c[0], c[1]))));
check('...and its far corner is D5, not F3 (the transposed answer)',
  S.formatA1(cells[cells.length - 1][0], cells[cells.length - 1][1]) === 'D5',
  S.formatA1(cells[cells.length - 1][0], cells[cells.length - 1][1]));

// ---- garbage in -> null out, never an invented footprint ----
for (const bad of [null, undefined, {}, { w: 3 }, { h: 4 }, { w: 0, h: 4 }, { w: 3.5, h: 4 }, { w: '3', h: '4' }, [3, 4], { mask: [] }]) {
  check('unusable art shape ' + JSON.stringify(bad) + ' -> null (drawn 1x1 and labelled, never guessed)',
    S.footprintFromArtShape(bad) === null, JSON.stringify(S.footprintFromArtShape(bad)));
}

// ---- resolution reuses REQ-0174's ref-first canon ----
const art = {
  bear_art: { id: 1, system_name: 'bear_art', kind: 'monster', shape: { w: 2, h: 2 }, gen_width: 256, gen_height: 256, main_object: '', prompt_template: '', style_override: null, edge_padding: null, adopted_render_id: 1 },
  frostback_bear: { id: 2, system_name: 'frostback_bear', kind: 'monster', shape: { w: 5, h: 6 }, gen_width: 640, gen_height: 768, main_object: '', prompt_template: '', style_override: null, edge_padding: null, adopted_render_id: 2 },
  lone_wisp: { id: 3, system_name: 'lone_wisp', kind: 'monster', shape: { w: 1, h: 1 }, gen_width: 128, gen_height: 128, main_object: '', prompt_template: '', style_override: null, edge_padding: null, adopted_render_id: 3 },
};
const mkDef = (system_name, artwork_ref) => ({ id: 1, system_name, kind: 'monster_def', brief: '', schema_ref: 'enemy/1', gen_config: {}, adopted_variant_id: null, artwork_ref });

const members = S.packMembers({ members: [
  { enemy: 'frostback_bear', at: 'B2' },
  { enemy: 'lone_wisp', at: 'H2' },
  { enemy: 'orphan_monster', at: 'K2' },
] });
check('packMembers reads 3 members', members.length === 3);

// an explicit artwork_ref WINS over the exact-name match (REQ-0174 canon)
const fpRef = S.buildMemberFootprints(members, [mkDef('frostback_bear', 'bear_art')], art);
check('artwork_ref wins: frostback_bear -> bear_art {w:2,h:2} -> [2,2], NOT its own name-match {w:5,h:6}',
  eq(fpRef.frostback_bear, [2, 2]), JSON.stringify(fpRef.frostback_bear));

// no ref -> exact-name fallback
const fpName = S.buildMemberFootprints(members, [mkDef('frostback_bear', null)], art);
check('no ref -> exact system_name match: frostback_bear -> {w:5,h:6} -> [6,5]',
  eq(fpName.frostback_bear, [6, 5]), JSON.stringify(fpName.frostback_bear));

// no def at all -> still resolves by exact name (the one-name-one-entity canon)
const fpNoDef = S.buildMemberFootprints(members, [], art);
check('no monster_def -> exact-name artwork still resolves (lone_wisp -> [1,1])',
  eq(fpNoDef.lone_wisp, [1, 1]), JSON.stringify(fpNoDef.lone_wisp));

// a monster with NO art is ABSENT -- reported, never invented
check('a monster with no artwork is ABSENT from the map (so the board draws 1x1 AND says so)',
  !('orphan_monster' in fpNoDef), JSON.stringify(Object.keys(fpNoDef)));

// a def pointing at a dangling ref falls back to the name match, never throws
const fpDangling = S.buildMemberFootprints(members, [mkDef('frostback_bear', 'no_such_art')], art);
check('a dangling artwork_ref falls back to the exact-name match (never throws, never invents)',
  eq(fpDangling.frostback_bear, [6, 5]), JSON.stringify(fpDangling.frostback_bear));

console.log(failures === 0 ? '\nREQ-0184 pack board: all assertions pass' : `\nREQ-0184 pack board: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
