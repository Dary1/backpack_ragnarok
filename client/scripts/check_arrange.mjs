#!/usr/bin/env node
// client/scripts/check_arrange.mjs -- REQ-0373 gate. Drives the REAL
// shared/placement.mjs arrangePage() against the REAL shared/engine.js in
// plain Node (no vite, no browser -- both modules are dependency-free by
// invariant, exactly like check_placement.mjs's own import of them).
//
// Pins the REQ's unit gate -- "arrange output deterministic for a fixture
// page (same input -> same layout); every emitted move legal per the
// engine" -- plus the four rules placement.mjs's header states: a `fixed`
// PO never moves, BP cargo travels with its pack and is never re-seated
// alone, a free PO never lands inside a BP, and same-id TM stacks are never
// merged. The assertions are BEHAVIOURAL: any future repack strategy that
// still satisfies them is free to replace this one.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const require_ = createRequire(import.meta.url);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log('  ok   ', name);
  else { failures++; console.log('  FAIL ', name, detail ? `-- ${detail}` : ''); }
}
const json = (v) => JSON.stringify(v);

const { arrangePage } = await import(path.join(REPO, 'shared', 'placement.mjs'));
const Engine = require_(path.join(REPO, 'shared', 'engine.js'));

// Item defs: 1x1, a 2-cell vertical, and a 4-cell square -- enough shape
// variety for the footprint-descending order to be observable.
const ITEMS = {
  hilt: { name: 'Hilt', tags: [], shape: [[0, 0]], icon: 'icon-x' },
  dagger: { name: 'Dagger', tags: [], shape: [[0, 0], [1, 0]], icon: 'icon-x' },
  slab: { name: 'Slab', tags: [], shape: [[0, 0], [0, 1], [1, 0], [1, 1]], icon: 'icon-x' },
};
const E = Engine.create(ITEMS, { rune: { name: 'Rune', tags: [], icon: 'icon-x' } }, { ROWS: 8, COLS: 8 });
const fresh = () => E.migrateState({ linked: true, bps: [], pos: [], sis: [] });
const page0 = (st) => st.inv.pages[0];
const po = (uid, id, cell, extra = {}) => ({ uid, id, loc: 'grid', cell, rot: 0, ...extra });
const pack = (id, origin, shape = [[0, 0], [0, 1], [1, 0], [1, 1]]) => ({ id, name: id, color: '#888', shape, origin, unit: { id: 'dwarf', off: [0, 0] }, hpMax: 30 });

/** Every cell of a page, per record -- the layout signature the
 * determinism gate compares. */
function layoutOf(pg) {
  return json({
    bps: pg.bps.map((b) => [b.id, b.origin]).sort(),
    pos: pg.pos.map((p) => [p.uid, p.cell]).sort(),
    sis: pg.sis.map((s) => [s.uid, s.host && s.host.cell ? s.host.cell : s.host]).sort(),
    tms: (pg.tms || []).map((t) => [t.uid, t.cell, t.qty]).sort(),
  });
}

/** No two records overlap and every one is engine-legal where it sits. */
function assertLegal(st, label) {
  const pg = page0(st);
  const seen = new Map();
  let overlap = null;
  const claim = (r, c, who) => {
    const k = `${r},${c}`;
    if (seen.has(k)) overlap = `${who} vs ${seen.get(k)} at ${k}`;
    seen.set(k, who);
  };
  for (const b of pg.bps) for (const [r, c] of E.bpCells(b)) claim(r, c, b.id);
  for (const p of pg.pos) {
    const host = pg.bps.find((b) => E.poInBPIn(p, b));
    if (!host) for (const [r, c] of E.cellsOfIn(p)) claim(r, c, p.uid);
    // A PO inside a LOCKED pack is exempt from the anchor re-check: REQ-0209
    // makes invCanPlaceCells refuse ANY placement into a locked pack's
    // interior, including the cell the piece already occupies. Such a piece
    // is cargo -- it got there with invMoveBP, which is the sanctioned path
    // and the only one arrangePage uses for it. Asserting invCanPlacePO on it
    // would be asserting the engine's own refusal, not this repack's work.
    if (!host || !host.locked) check(`${label}: ${p.uid} sits at an engine-legal anchor`, E.invCanPlacePO(st, 0, p.uid, p.rot, p.cell).ok, json(p.cell));
    for (const [r, c] of E.cellsOfIn(p)) if (r < 1 || r > 8 || c < 1 || c > 8) check(`${label}: ${p.uid} in bounds`, false, json(p.cell));
  }
  for (const s of pg.sis) if (s.host && s.host.cell) claim(s.host.cell[0], s.host.cell[1], s.uid);
  for (const t of pg.tms || []) claim(t.cell[0], t.cell[1], t.uid);
  check(`${label}: no two records share a cell`, overlap === null, overlap || '');
}

// ---------------------------------------------------------------------
console.log('REQ-0373 arrangePage');

// 1. Determinism: the same scattered page arranges to the same layout,
//    twice, from two independently built states.
{
  const build = () => {
    const st = fresh();
    const pg = page0(st);
    pg.bps.push(pack('bp_a', [5, 5]));
    pg.pos.push(po('p_slab', 'slab', [7, 1]), po('p_dag', 'dagger', [2, 7]), po('p_hilt', 'hilt', [8, 8]));
    pg.sis.push({ uid: 's1', id: 'rune', host: { page: 0, cell: [4, 3] } });
    pg.tms.push({ uid: 't1', id: 'shard', qty: 3, cell: [6, 2] });
    return st;
  };
  const a = build();
  const b = build();
  const ra = arrangePage(E, a, 0);
  const rb = arrangePage(E, b, 0);
  check('scattered page reports movement', ra.moved > 0, json(ra));
  check('both runs report the same movement', json(ra) === json(rb), `${json(ra)} vs ${json(rb)}`);
  check('total counts every arrangeable entity', ra.total === 6, json(ra));
  check('same input -> same layout', layoutOf(page0(a)) === layoutOf(page0(b)), layoutOf(page0(a)));
  assertLegal(a, 'determinism');
  // Idempotent: arranging an arranged page changes nothing.
  const again = arrangePage(E, a, 0);
  check('arrange is idempotent (moved 0 on an arranged page)', again.moved === 0, json(again));
  // Footprint-descending: the 4-cell BP and the 4-cell slab take the first
  // rows; the 1x1s end up after them in row-major order.
  const hilt = page0(a).pos.find((p) => p.uid === 'p_hilt');
  const slab = page0(a).pos.find((p) => p.uid === 'p_slab');
  check('largest footprints pack first', slab.cell[0] <= hilt.cell[0], `slab ${json(slab.cell)} hilt ${json(hilt.cell)}`);
  check('the page packs into the top-left', page0(a).bps[0].origin[0] === 1, json(page0(a).bps[0].origin));
}

// 2. A `fixed` PO (starter-unit kit piece) never moves, and the repack
//    packs around it.
{
  const st = fresh();
  const pg = page0(st);
  pg.pos.push(po('p_fixed', 'slab', [4, 4], { fixed: true }), po('p_free', 'dagger', [8, 7]), po('p_h', 'hilt', [7, 3]));
  const r = arrangePage(E, st, 0);
  check('fixed PO stays exactly where it was', json(pg.pos.find((p) => p.uid === 'p_fixed').cell) === json([4, 4]));
  check('fixed PO is not counted as arrangeable', r.total === 2, json(r));
  check('free PO did move', json(pg.pos.find((p) => p.uid === 'p_free').cell) !== json([8, 7]));
  assertLegal(st, 'fixed anchor');
}

// 3. BP cargo travels with its pack, keeping its offset, and is never
//    re-seated on its own.
{
  const st = fresh();
  const pg = page0(st);
  pg.bps.push(pack('bp_c', [6, 6]));
  pg.pos.push(po('cargo', 'hilt', [7, 7])); // inside bp_c (origin+[1,1])
  pg.pos.push(po('loose', 'hilt', [1, 8]));
  const before = json([pg.pos.find((p) => p.uid === 'cargo').cell, pg.bps[0].origin]);
  arrangePage(E, st, 0);
  const bp = pg.bps[0];
  const cargo = pg.pos.find((p) => p.uid === 'cargo');
  check('pack moved to the top-left', json(bp.origin) === json([1, 1]), `${before} -> ${json(bp.origin)}`);
  check('cargo kept its offset inside the pack', json(cargo.cell) === json([bp.origin[0] + 1, bp.origin[1] + 1]), json(cargo.cell));
  check('cargo is still inside the pack', E.poInBPIn(cargo, bp));
  assertLegal(st, 'cargo');
}

// 4. A free PO never lands inside a BP (arranging must not load a pack).
{
  const st = fresh();
  const pg = page0(st);
  // 4x2 pack with only its unit cell used -- a naive first fit would drop
  // the loose 1x1 into one of its free interior cells.
  pg.bps.push(pack('bp_big', [3, 3], [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]));
  pg.pos.push(po('loose1', 'hilt', [8, 8]), po('loose2', 'hilt', [8, 7]));
  arrangePage(E, st, 0);
  const bp = pg.bps[0];
  for (const uid of ['loose1', 'loose2']) {
    const p = pg.pos.find((x) => x.uid === uid);
    check(`${uid} did not get loaded into the pack`, !E.poInBPIn(p, bp), json(p.cell));
  }
  assertLegal(st, 'no pack loading');
}

// 5. Same-id TM stacks are relocated, never merged.
{
  const st = fresh();
  const pg = page0(st);
  pg.tms.push({ uid: 't_a', id: 'shard', qty: 2, cell: [8, 8] }, { uid: 't_b', id: 'shard', qty: 5, cell: [4, 6] });
  arrangePage(E, st, 0);
  check('both stacks survive', pg.tms.length === 2, json(pg.tms));
  check('quantities untouched', json(pg.tms.map((t) => [t.id, t.qty]).sort()) === json([['shard', 2], ['shard', 5]]));
  check('stacks occupy distinct cells', json(pg.tms[0].cell) !== json(pg.tms[1].cell), json(pg.tms.map((t) => t.cell)));
  assertLegal(st, 'tm stacks');
}

// 6. Socketed / stowed SIs are untouched (no cell to arrange).
{
  const st = fresh();
  const pg = page0(st);
  pg.pos.push(po('host_po', 'hilt', [5, 5]));
  pg.sis.push({ uid: 's_stow', id: 'rune', host: 'inv' }, { uid: 's_seat', id: 'rune', host: { po: 'host_po', si: 0 } });
  const r = arrangePage(E, st, 0);
  check('non-free SIs are not arrangeable', r.total === 1, json(r));
  check('stowed SI keeps its inv host', pg.sis.find((s) => s.uid === 's_stow').host === 'inv');
  check('seated SI keeps its socket host', json(pg.sis.find((s) => s.uid === 's_seat').host) === json({ po: 'host_po', si: 0 }));
}

// 7. An empty page, and a page that is already packed, are both no-ops.
{
  const st = fresh();
  check('empty page reports nothing', json(arrangePage(E, st, 0)) === json({ moved: 0, total: 0 }));
  page0(st).pos.push(po('only', 'hilt', [1, 1]));
  check('already-packed page reports moved 0', arrangePage(E, st, 0).moved === 0);
  check('already-packed page did not move', json(page0(st).pos[0].cell) === json([1, 1]));
}

// 8. Records survive the round trip: nothing is dropped, duplicated or
//    invented, and no OTHER page is touched.
{
  const st = fresh();
  const pg = page0(st);
  pg.bps.push(pack('bp_x', [4, 4]));
  pg.pos.push(po('a', 'dagger', [7, 7]), po('b', 'hilt', [2, 8]), po('c', 'slab', [6, 1]));
  pg.sis.push({ uid: 's', id: 'rune', host: { page: 0, cell: [8, 1] } });
  pg.tms.push({ uid: 't', id: 'shard', qty: 1, cell: [1, 8] });
  st.inv.pages[1].pos.push(po('other', 'hilt', [5, 5]));
  const idsBefore = json([pg.bps.map((b) => b.id).sort(), pg.pos.map((p) => p.uid).sort(), pg.sis.map((s) => s.uid).sort(), pg.tms.map((x) => x.uid).sort()]);
  arrangePage(E, st, 0);
  const idsAfter = json([pg.bps.map((b) => b.id).sort(), pg.pos.map((p) => p.uid).sort(), pg.sis.map((s) => s.uid).sort(), pg.tms.map((x) => x.uid).sort()]);
  check('every record survives, none invented', idsBefore === idsAfter, `${idsBefore} -> ${idsAfter}`);
  check('another page is untouched', json(st.inv.pages[1].pos[0].cell) === json([5, 5]));
  assertLegal(st, 'round trip');
}

// 9. A LOCKED starter pack DOES relocate, carrying its `fixed` kit piece.
//    REQ-0209's `locked` refuses new CONTENTS inside the pack, not
//    relocation of the pack -- and invMoveBP shifts cargo geometrically, so
//    the `fixed` PO never needs (and never gets) an invMovePO call of its
//    own. This is the REQ-0373 spec amendment, pinned.
{
  const st = fresh();
  const pg = page0(st);
  const bp = pack('bp_starter', [6, 6]);
  bp.locked = true;
  pg.bps.push(bp);
  pg.pos.push(po('kit', 'hilt', [7, 7], { fixed: true })); // inside bp_starter
  arrangePage(E, st, 0);
  const moved = pg.bps.find((b) => b.id === 'bp_starter');
  const kit = pg.pos.find((p) => p.uid === 'kit');
  check('locked starter pack relocates as one block', json(moved.origin) === json([1, 1]), json(moved.origin));
  check('its fixed kit piece travelled with it', json(kit.cell) === json([2, 2]), json(kit.cell));
  check('the kit piece is still inside the pack', E.poInBPIn(kit, moved));
  check('invMovePO would still refuse the fixed piece on its own', !E.invMovePO(st, 0, 'kit', [5, 5]).ok);
  assertLegal(st, 'locked starter');
}

console.log(failures === 0 ? 'check_arrange: PASS' : `check_arrange: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
