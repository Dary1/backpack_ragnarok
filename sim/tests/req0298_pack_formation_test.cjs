'use strict';
// sim/tests/req0298_pack_formation_test.cjs -- REQ-0298.
//
// Unit tests for the pure formation-fill inspector (sim/lib/pack_formation.cjs):
//   1. packFill math -- a synthetic pack of known footprints sums to EXACT cells
//      and fill (footprint area = fh*fw; missing/malformed -> [1,1] = 1 cell).
//   2. placeableCellsFor -- derives (COLS-2)*(ROWS-2) from the field constants.
//   3. FILL_MIN -- the exported 0.30 constant.
//   4. the 30% boundary -- exactly-30% PASS, just-under FAIL, over PASS.
//   5. the --json summary shape -- fillMin/placeableCells echoed, total/failing
//      count + failingIds in input order, and the per-pack contract keys.
//
// Companion to run.cjs: register(harness) is require()d by sim/tests/run.cjs so
// these roll into its pass/fail totals; the file also self-runs standalone. Pure
// + deterministic -- no clocks, no RNG, no I/O.

function register({ T, eq, ok, approx }) {
  const pf = require('../lib/pack_formation.cjs');

  T('REQ-0298 packFill: exact footprint-area sum', () => {
    const defs = { a: { footprint: [4, 3] }, b: { footprint: [2, 2] }, c: {} };
    const r = pf.packFill({ id: 'x', members: [{ enemy: 'a' }, { enemy: 'b' }, { enemy: 'c' }] }, defs, 384);
    eq(r.occupiedCells, 12 + 4 + 1, 'occupied = 12+4+1'); // c has no footprint -> [1,1]
    eq(r.memberCount, 3, 'memberCount');
    eq(r.placeableCells, 384, 'placeableCells passthrough');
    approx(r.fillFrac, 17 / 384, 1e-12, 'fillFrac = 17/384');
  });

  T('REQ-0298 packFill: missing/malformed footprint defaults to [1,1]', () => {
    const r = pf.packFill({ id: 'x', members: [{ enemy: 'ghost' }, { enemy: 'unknown' }] }, { ghost: { footprint: 'bad' } }, 100);
    eq(r.occupiedCells, 2, 'both members default to 1 cell');
  });

  T('REQ-0298 placeableCellsFor derives from field constants', () => {
    eq(pf.placeableCellsFor(18, 26), 384, 'live field 26x18 -> 24x16 = 384');
    eq(pf.placeableCellsFor(10, 10), 64, '10x10 -> 8x8 = 64');
  });

  T('REQ-0298 FILL_MIN exported constant is 0.30', () => {
    ok(pf.FILL_MIN === 0.30, 'FILL_MIN === 0.30');
  });

  T('REQ-0298 30% boundary: exactly-30% PASS, just-under FAIL, over PASS', () => {
    const defs = { u: { footprint: [1, 1] } };
    const mk = (n) => ({ id: 'p' + n, members: Array.from({ length: n }, () => ({ enemy: 'u' })) });
    const res = pf.inspectPacks([mk(30), mk(29), mk(31)], defs, { placeableCells: 100, fillMin: 0.30 });
    ok(res.packs[0].fillFrac === 0.30 && res.packs[0].pass === true, 'exactly 30% (30/100) PASS');
    ok(res.packs[1].pass === false, 'just under (29/100) FAIL');
    ok(res.packs[2].pass === true, 'over (31/100) PASS');
  });

  T('REQ-0298 inspectPacks --json summary shape (count + ids + keys)', () => {
    const defs = { big: { footprint: [10, 10] }, small: { footprint: [1, 1] } };
    const packs = [
      { id: 'pack_full', members: [{ enemy: 'big' }] },     // 100/100 -> PASS
      { id: 'pack_sparse', members: [{ enemy: 'small' }] }, //   1/100 -> FAIL
      { id: 'pack_empty', members: [] },                    //   0/100 -> FAIL
    ];
    const res = pf.inspectPacks(packs, defs, { placeableCells: 100, fillMin: 0.30 });
    eq(res.fillMin, 0.30, 'fillMin echoed');
    eq(res.placeableCells, 100, 'placeableCells echoed');
    eq(res.summary.total, 3, 'summary.total');
    eq(res.summary.failing, 2, 'summary.failing count');
    eq(res.summary.failingIds, ['pack_sparse', 'pack_empty'], 'failingIds in input order');
    eq(Object.keys(res.packs[0]).sort(), ['fillFrac', 'id', 'memberCount', 'occupiedCells', 'pass', 'placeableCells'], 'per-pack contract keys');
    eq(res.packs[0].pass, true, 'full pack passes');
  });
}

module.exports = { register };

if (require.main === module) {
  let pass = 0, fail = 0;
  const T = (name, fn) => { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  const approx = (a, b, tol, msg) => { if (Math.abs(a - b) > (tol || 1e-9)) throw new Error((msg || '') + ' expected ~' + b + ' got ' + a); };
  register({ T, eq, ok, approx });
  console.log('----------------------------------');
  console.log('req0298_pack_formation: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
