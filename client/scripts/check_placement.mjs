#!/usr/bin/env node
// client/scripts/check_placement.mjs -- REQ-0273 gate. Drives the REAL
// client/src/lib/placement.ts against the REAL mock-src/engine.js (vite
// ssrLoadModule, same rig as check_bpskin.mjs) and pins the bug-2 fix:
// claiming a rolled BP must never MOVE an unrelated free-placed PO, and the
// resulting state must be engine-legal in every page. Pre-fix, the
// placeholder-at-[1,1] made invMoveBP capture free POs inside the fake
// footprint and teleport them into the new BP -- onto the unit cell when the
// offsets aligned (the one cell invOccupancy does not cover). The assertions
// here are behavioural, not implementation-shaped: any future placeholder
// scheme must still pass them.
import { createServer } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
const require_ = createRequire(import.meta.url);
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { firstFitPlaceBp, firstFitPlace } = await server.ssrLoadModule('/src/lib/placement.ts');
    const Engine = require_(path.join(REPO, 'shared', 'engine.js'));
    const ITEMS = { hilt: { name: 'H', tags: [], shape: [[0, 0]], icon: 'icon-x' }, dagger: { name: 'D', tags: [], shape: [[0, 0], [1, 0]], icon: 'icon-x' } };
    const E = Engine.create(ITEMS, {}, { ROWS: 8, COLS: 8 });
    const fresh = () => E.migrateState({ linked: true, bps: [], pos: [], sis: [] });
    const rolled = { uid: 'bp_new', shape: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]], unit: { id: 'dwarf', off: [2, 1] }, hpMax: 30, unitDef: { name: 'Dwarf' } };

    // 1. THE bug: a free PO in the placeholder\x27s old [1,1] footprint zone.
    {
      const st = fresh();
      st.inv.pages[0].pos.push({ uid: 'p1', id: 'hilt', loc: 'grid', cell: [3, 2], rot: 0 });
      const res = firstFitPlaceBp(E, st, rolled, 0, E.PAGE_COUNT);
      ok(res, 'rolled BP found a home');
      eq(st.inv.pages[0].pos.find((p) => p.uid === 'p1').cell, [3, 2], 'free PO NEVER moves during a BP claim');
      const bp = st.inv.pages[res.page].bps.find((b) => b.id === 'bp_new');
      const uc = E.unitCell(bp);
      for (const pg of st.inv.pages.map((_, i) => i)) {
        for (const p of st.inv.pages[pg].pos) {
          if (p.loc !== 'grid') continue;
          ok(E.invCanPlacePO(st, pg, p.uid, p.rot, p.cell).ok, `post-claim legality: ${p.uid} at ${JSON.stringify(p.cell)} on page ${pg}`);
          ok(!E.cellsOfIn(p).some(([r, c]) => r === uc[0] && c === uc[1]), `${p.uid} clear of the unit cell`);
        }
      }
    }

    // 2. Scatter: many free POs, claim still finds a legal origin and moves none.
    {
      const st = fresh();
      const before = [];
      let u = 0;
      for (const cell of [[1, 1], [2, 2], [3, 1], [1, 4], [4, 4], [2, 6]]) {
        const uid = 'q' + u++;
        st.inv.pages[0].pos.push({ uid, id: 'hilt', loc: 'grid', cell, rot: 0 });
        before.push([uid, cell.slice()]);
      }
      const res = firstFitPlaceBp(E, st, { ...rolled, uid: 'bp_two' }, 0, E.PAGE_COUNT);
      ok(res, 'scatter: rolled BP placed');
      for (const [uid, cell] of before) {
        eq(st.inv.pages[0].pos.find((p) => p.uid === uid).cell, cell, `scatter: ${uid} untouched`);
      }
      ok(E.checkUidInvariant(st).ok, 'scatter: uid invariant holds');
    }

    // 3. firstFitPlace (po branch) stays healthy alongside: claim a PO, all legal.
    {
      const st = fresh();
      st.inv.pages[0].bps.push({ id: 'b1', name: 'B', color: '#fff', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'dwarf', off: [0, 0] } });
      const res = firstFitPlace(E, st, 'po', 'c1', 'dagger', 0, E.PAGE_COUNT);
      ok(res, 'po claim placed');
      const p = st.inv.pages[res.page].pos.find((x) => x.uid === 'c1');
      ok(E.invCanPlacePO(st, res.page, 'c1', p.rot, p.cell).ok, 'po claim is engine-legal');
      ok(!E.cellsOfIn(p).some(([r, c]) => r === 1 && c === 1), 'po claim clear of the unit cell');
    }
  } finally {
    await server.close();
  }
  console.log(fails ? `check_placement: ${fails} FAILED` : 'check_placement: all green');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
