// sim/tests/forecast_parity.cjs -- REQ-0057: THE drift gate between
// shared/forecast.mjs (the overlay's walker, which the client runs) and
// sim/lib/{geometry,ray,entry,formation}.cjs (the walker a real run runs).
//
// REQ-0057 ratified: "Deterministic; shares walkRay semantics with the sim
// (port the walker or transpile the identical function -- parity test
// against sim/combat.cjs fixtures)." This file IS that test. It follows the
// house precedent REQ-0048 set with its "sim linkEdges == engine.js
// traceBeams" cross-implementation check in sim/tests/run.cjs: two
// independent implementations, one fixture corpus, byte-equal outputs.
//
// The forecast is only worth trusting if the rays it draws are the rays that
// will actually be fired. Four things are proven here:
//
//   1. CONSTANTS ARE PINNED. shared/ may not require() out of shared/, so
//      FIELD_ROWS / FIELD_COLS / RAY_STEP_BUDGET / ENTRY_JITTER_HALF_WIDTH
//      are re-declared there. That is a drift hazard -- so it is nailed
//      shut here: change a sim TUNABLE without changing the forecast's copy
//      and CI goes red.
//   2. GEOMETRY IS VERBATIM. reflectDir / stepCell / outside / mult /
//      chebyshevDist / centroidRoundHalfUp / parseBox agree with sim's on an
//      exhaustive sweep (every direction x every boundary crossing x every
//      corner), not on a spot check.
//   3. THE WALK IS BYTE-EQUAL. Over a fixture corpus (occupancy layouts x
//      entry cells x directions x penetration x aoe), the cell sequence
//      shared/forecast.mjs's walkRayPath() visits is JSON-identical to the
//      one sim's walkRay() emits in its ray_step events -- as are the
//      landing cell, the bounce count, the abort flag, the 5-bounce
//      all-field terminator, and the AOE splash (centre, radius, multiplier).
//      The corpus asserts its own COVERAGE (it fails if it never landed a
//      ray on an occupant, or never reached the 5-bounce terminator) so it
//      cannot quietly rot into a test of nothing. Note what it does NOT
//      reach: the 512-step abort. On an 18x26 field a diagonal ray bounces
//      five times long before 512 steps, so ray_abort is dead code in
//      practice for BOTH implementations -- it is ported and asserted
//      equal, not exercised, and the coverage counter prints 0 for it.
//   4. THE RNG MARGINALISATION IS RIGHT. shared/forecast.mjs does NOT sample
//      sim's entry-cell RNG -- it enumerates the distribution in closed form
//      (entryDistribution()). So we sample sim's REAL selectEntryCell()
//      tens of thousands of times and check the empirical histogram matches
//      the analytic weights, and that neither side produces an outcome the
//      other cannot.
//
// Run: node sim/tests/forecast_parity.cjs   (wired into tools/ci.sh)
'use strict';
const path = require('path');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function approx(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' expected ~' + b + ' (tol ' + tol + ') got ' + a);
}

// ---------------------------------------------------------------------
// sim-side reference walk: drive the REAL sim/lib/ray.cjs walkRay with
// inert callbacks and read the ray back out of its event log. Nothing is
// stubbed about the WALK itself -- only the damage/HP side effects the
// forecast has no opinion about (interpretation (1): no statuses, no HP).
// ---------------------------------------------------------------------
function simWalk(opts) {
  const { ROWS, COLS, entryCell, dir, penetration, aoe, occupied } = opts;
  // Every occupied cell is its own single-cell "occupant" -- the coarsest
  // possible occupancy, which is exactly what the forecast's isOccupied(r,c)
  // predicate models. (A multi-cell BP would make sim skip cells the ray
  // re-enters within the same occupant; that difference is a per-OCCUPANT vs
  // per-CELL question, not a walk question, and it is REQ-0057
  // interpretation (4), tested separately below.)
  const occSet = new Set(occupied.map((c) => c[0] + ',' + c[1]));
  const actors = new Map();
  for (const key of occSet) {
    actors.set(key, { alive: true, id: 'occ@' + key, ref: { id: 'occ@' + key } });
  }

  const splashes = [];
  const allFieldVolleys = [];

  const res = combat.walkRay({
    field: { ROWS, COLS },
    entryCell: entryCell.slice(),
    dir,
    mode: 'battle',
    penetration,
    aoe,
    aoeStatuses: false,
    bounceBudget: 0,
    liveOccupantFn(cell) {
      return actors.get(cell[0] + ',' + cell[1]) || null;
    },
    dealHitFn(occ, bmult, o2) {
      if (o2 && o2.allField) {
        allFieldVolleys.push({ bmult });
        return [];
      }
      return { dstLabel: occ.id, amount: 0, hpAfter: 1 };
    },
    splashFn(landing, radius, bmult) {
      splashes.push({ landing: landing.slice(), radius, bmult });
      return [];
    },
    isDestroyedPassable: true,
  });

  // Reassemble the traversed cells from the ray_step batches. flushSteps()
  // fires on every bounce and every hit, so concatenating the batches in
  // event order reproduces the exact in-field cell sequence, in order.
  const cells = [];
  for (const ev of res.events) {
    if (ev.ev === 'ray_step') for (const c of ev.path) cells.push([c[0], c[1]]);
  }
  return {
    cells,
    landing: res.landing ? res.landing.slice() : null,
    bounces: res.bounces,
    aborted: !!res.aborted,
    allField: allFieldVolleys.length > 0,
    allFieldMult: allFieldVolleys.length ? allFieldVolleys[0].bmult : null,
    splashes,
  };
}

// ---------------------------------------------------------------------
// Fixture corpus.
// ---------------------------------------------------------------------
const ROWS = combat.FIELD_ROWS, COLS = combat.FIELD_COLS;

// A dense-ish player board: two 8x8 formation boxes filled with 2x2 blocks,
// which is what a real 4-squad troop looks like to a ray.
function boardFromBoxes(boxStrs) {
  const cells = [];
  for (const bs of boxStrs) {
    const b = combat.parseBox(bs);
    for (let r = b.rowMin; r <= b.rowMax; r += 3) {
      for (let c = b.colMin; c <= b.colMax; c += 3) {
        cells.push([r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]);
      }
    }
  }
  return cells;
}

const BOARDS = [
  { name: 'empty', cells: [] },                       // every ray runs to the 5-bounce terminator
  { name: 'one-cell', cells: [[9, 13]] },
  { name: 'formation1-full', cells: boardFromBoxes(Object.values(combat.FORMATIONS.formation1.canvases)) },
  { name: 'formation4-full', cells: boardFromBoxes(Object.values(combat.FORMATIONS.formation4.canvases)) },
  { name: 'wall-row3', cells: Array.from({ length: COLS }, (_, i) => [3, i + 1]) },
  { name: 'corner-cluster', cells: [[1, 1], [1, 2], [2, 1], [2, 2], [18, 26], [18, 25], [17, 26]] },
];

const ENTRIES = [];
for (const edge of ['top', 'bottom', 'left', 'right']) {
  for (const dir of combat.EDGE_DIRS[edge]) {
    const coords = (edge === 'top' || edge === 'bottom')
      ? [1, 2, 7, 13, 20, COLS]
      : [1, 2, 6, 12, 17, ROWS];
    for (const k of coords) {
      const cell = (edge === 'top') ? [1, k]
        : (edge === 'bottom') ? [ROWS, k]
          : (edge === 'left') ? [k, 1]
            : [k, COLS];
      ENTRIES.push({ edge, dir, cell });
    }
  }
}

// ---------------------------------------------------------------------
// 1. Constants pinned to sim.
// ---------------------------------------------------------------------
async function main() {
  const F = await import(path.join(__dirname, '..', '..', 'shared', 'forecast.mjs'));

  T('constants: forecast mirrors sim FIELD_ROWS / FIELD_COLS', () => {
    eq(F.FIELD_ROWS, combat.FIELD_ROWS, 'FIELD_ROWS');
    eq(F.FIELD_COLS, combat.FIELD_COLS, 'FIELD_COLS');
  });

  T('constants: forecast mirrors sim RAY_STEP_BUDGET / ENTRY_JITTER_HALF_WIDTH', () => {
    eq(F.RAY_STEP_BUDGET, combat.TUNABLES.RAY_STEP_BUDGET, 'RAY_STEP_BUDGET');
    eq(F.ENTRY_JITTER_HALF_WIDTH, combat.TUNABLES.ENTRY_JITTER_HALF_WIDTH, 'ENTRY_JITTER_HALF_WIDTH');
  });

  T('geometry: DIR_VEC / EDGE_DIRS byte-equal', () => {
    eq(F.DIR_VEC, combat.DIR_VEC, 'DIR_VEC');
    eq(F.EDGE_DIRS, combat.EDGE_DIRS, 'EDGE_DIRS');
  });

  T('geometry: reflectDir exhaustive (every dir x every out-of-bounds crossing incl. corners)', () => {
    let n = 0;
    for (const dir of Object.keys(combat.DIR_VEC)) {
      for (let r = 0; r <= ROWS + 1; r++) {
        for (let c = 0; c <= COLS + 1; c++) {
          if (!combat.outside([r, c], ROWS, COLS)) continue;
          eq(F.reflectDir(dir, r, c, ROWS, COLS), combat.reflectDir(dir, r, c, ROWS, COLS),
            'reflectDir(' + dir + ',' + r + ',' + c + ')');
          n++;
        }
      }
    }
    ok(n > 100, 'expected a real sweep, got ' + n + ' cases');
  });

  T('geometry: stepCell / outside / mult / chebyshevDist agree with sim', () => {
    for (const dir of Object.keys(combat.DIR_VEC)) {
      for (const cell of [[1, 1], [9, 13], [18, 26], [0, 0], [19, 27]]) {
        eq(F.stepCell(cell, dir), combat.stepCell(cell, dir), 'stepCell');
        eq(F.outside(cell, ROWS, COLS), combat.outside(cell, ROWS, COLS), 'outside');
      }
    }
    for (let b = 0; b <= 9; b++) eq(F.mult(b), combat.mult(b), 'mult(' + b + ')');
    eq(F.chebyshevDist([2, 3], [9, 5]), combat.chebyshevDist([2, 3], [9, 5]), 'chebyshevDist');
  });

  T('geometry: centroidRoundHalfUp agrees with sim (incl. the .5 tie)', () => {
    const fixtures = [
      [[1, 1]],
      [[1, 1], [1, 2], [2, 1], [2, 2]],
      [[1, 1], [1, 2]],                 // colAvg = 1.5 -> round-half-UP = 2
      [[3, 4], [4, 5], [5, 6]],
      [[1, 1], [2, 2], [3, 3], [4, 5]],
    ];
    for (const f of fixtures) {
      eq(F.centroidRoundHalfUp(f), combat.centroidRoundHalfUp(f), 'centroid ' + JSON.stringify(f));
    }
  });

  T('formation: parseBox agrees with sim on all 16 ratified boxes', () => {
    for (const fid of Object.keys(combat.FORMATIONS)) {
      const cv = combat.FORMATIONS[fid].canvases;
      for (const slot of Object.keys(cv)) {
        eq(F.parseBox(cv[slot]), combat.parseBox(cv[slot]), fid + '.' + slot);
      }
    }
  });

  T('formation: boxCells / canvasToField / fieldToCanvas round-trip an 8x8 box', () => {
    const box = F.parseBox(combat.FORMATIONS.formation2.canvases.unit1); // J2:Q9
    const cells = F.boxCells(box);
    eq(cells.length, 64, 'an 8x8 formation box has 64 cells');
    for (let r0 = 0; r0 < 8; r0++) {
      for (let c0 = 0; c0 < 8; c0++) {
        const f = F.canvasToField(box, r0, c0);
        eq(F.fieldToCanvas(box, f[0], f[1]), [r0, c0], 'round-trip ' + r0 + ',' + c0);
      }
    }
    eq(F.fieldToCanvas(box, 1, 1), null, 'a cell outside the box maps to null');
  });

  // -------------------------------------------------------------------
  // 3. The walk, byte-equal, over the whole corpus.
  // -------------------------------------------------------------------
  T('walkRayPath == sim walkRay: byte-equal cell path, landing, bounces, abort (full corpus)', () => {
    let cases = 0, aborts = 0, allFields = 0, landings = 0;
    for (const board of BOARDS) {
      const occSet = new Set(board.cells.map((c) => c[0] + ',' + c[1]));
      const isOccupied = (r, c) => occSet.has(r + ',' + c);
      for (const e of ENTRIES) {
        for (const pen of [0, 1, 2, 3]) {
          const sim = simWalk({
            ROWS, COLS, entryCell: e.cell, dir: e.dir,
            penetration: pen, aoe: 0, occupied: board.cells,
          });
          const fx = F.walkRayPath({
            ROWS, COLS, entryCell: e.cell, dir: e.dir,
            penetration: pen, aoe: 0, isOccupied,
          });
          const label = board.name + ' ' + e.edge + '/' + e.dir + ' @' + e.cell + ' pen=' + pen;
          eq(fx.path.map((s) => [s[0], s[1]]), sim.cells, 'PATH ' + label);
          eq(fx.landing, sim.landing, 'LANDING ' + label);
          eq(fx.bounces, sim.bounces, 'BOUNCES ' + label);
          eq(fx.aborted, sim.aborted, 'ABORTED ' + label);
          eq(fx.allField, sim.allField, 'ALLFIELD ' + label);
          if (sim.allField) eq(F.mult(5), sim.allFieldMult, 'ALLFIELD MULT ' + label);
          cases++;
          if (sim.aborted) aborts++;
          if (sim.allField) allFields++;
          if (sim.landing && !sim.allField) landings++;
        }
      }
    }
    // The corpus is only meaningful if it actually exercised all three ray
    // endings. Assert coverage rather than trusting it.
    ok(cases > 400, 'corpus too small: ' + cases);
    ok(allFields > 0, 'no ray reached the 5-bounce all-field terminator');
    ok(landings > 0, 'no ray landed on an occupant');
    console.log('        (' + cases + ' rays: ' + landings + ' landed, ' + allFields +
      ' all-field, ' + aborts + ' step-budget aborts)');
  });

  T('walkRayPath == sim walkRay: bounce multiplier in force at each entered cell', () => {
    // sim reports bmult only on the events where it deals damage, so we
    // re-derive it independently here: mult() of the number of ray_bounce
    // events that preceded the step batch a cell arrived in. If the
    // forecast's per-cell multiplier ever drifts from that, the heat map is
    // scaling the wrong cells and every tooltip number is wrong.
    for (const board of [BOARDS[0], BOARDS[2]]) {
      const occSet = new Set(board.cells.map((c) => c[0] + ',' + c[1]));
      for (const e of ENTRIES.slice(0, 12)) {
        const occ = board.cells.map((c) => c.slice());
        const simRes = combat.walkRay({
          field: { ROWS, COLS },
          entryCell: e.cell.slice(), dir: e.dir, mode: 'battle',
          penetration: 2, aoe: 0, aoeStatuses: false, bounceBudget: 0,
          liveOccupantFn: (cell) => (occSet.has(cell[0] + ',' + cell[1])
            ? { alive: true, id: 'o', ref: {} } : null),
          dealHitFn: (o, bm, o2) => (o2 && o2.allField ? [] : { dstLabel: 'o', amount: 0, hpAfter: 1 }),
          splashFn: () => [],
          isDestroyedPassable: true,
        });
        const expected = [];
        let b = 0;
        for (const ev of simRes.events) {
          if (ev.ev === 'ray_bounce') b++;
          else if (ev.ev === 'ray_step') for (const c of ev.path) expected.push([c[0], c[1], combat.mult(b)]);
        }
        const fx = F.walkRayPath({
          ROWS, COLS, entryCell: e.cell, dir: e.dir,
          penetration: 2, aoe: 0,
          isOccupied: (r, c) => occSet.has(r + ',' + c),
        });
        eq(fx.path, expected, 'per-cell bmult ' + board.name + ' ' + e.edge + '/' + e.dir + ' @' + e.cell);
        void occ;
      }
    }
  });

  T('walkRayPath == sim walkRay: AOE splash centre / radius / multiplier', () => {
    let splashed = 0;
    for (const board of BOARDS) {
      const occSet = new Set(board.cells.map((c) => c[0] + ',' + c[1]));
      const isOccupied = (r, c) => occSet.has(r + ',' + c);
      for (const e of ENTRIES) {
        for (const aoe of [1, 2]) {
          const sim = simWalk({
            ROWS, COLS, entryCell: e.cell, dir: e.dir,
            penetration: 0, aoe, occupied: board.cells,
          });
          const fx = F.walkRayPath({
            ROWS, COLS, entryCell: e.cell, dir: e.dir,
            penetration: 0, aoe, isOccupied,
          });
          const label = board.name + ' ' + e.edge + '/' + e.dir + ' @' + e.cell + ' aoe=' + aoe;
          // sim splashes iff it has a landing cell; so must the forecast.
          eq(sim.splashes.length > 0, !!(fx.landing && fx.aoe > 0), 'SPLASH? ' + label);
          if (sim.splashes.length > 0) {
            eq(sim.splashes.length, 1, 'exactly one splash ' + label);
            eq(fx.landing, sim.splashes[0].landing, 'SPLASH CENTRE ' + label);
            eq(fx.aoe, sim.splashes[0].radius, 'SPLASH RADIUS ' + label);
            eq(fx.endMult, sim.splashes[0].bmult, 'SPLASH MULT ' + label);
            splashed++;
          }
        }
      }
    }
    ok(splashed > 0, 'no splash was exercised');
  });

  // -------------------------------------------------------------------
  // 4. The analytic entry-cell marginalisation vs sim's real RNG.
  // -------------------------------------------------------------------
  T('jitterWeights: the exact distribution of Math.round((u*2-1)*J)', () => {
    const J = combat.TUNABLES.ENTRY_JITTER_HALF_WIDTH;
    const w = F.jitterWeights(J);
    eq(w.map((x) => x.offset), [-2, -1, 0, 1, 2], 'support');
    eq(w.map((x) => x.weight), [0.125, 0.25, 0.25, 0.25, 0.125], 'weights');
    approx(w.reduce((a, x) => a + x.weight, 0), 1, 1e-12, 'weights must sum to 1');
  });

  T('entryDistribution == sim selectEntryCell (empirical histogram, 40k draws per config)', () => {
    const J = combat.TUNABLES.ENTRY_JITTER_HALF_WIDTH;
    const bounds = { ROWS, COLS };
    const N = 40000;
    const configs = [
      { name: 'gnoll top, centroid 1,1', cells: [[1, 1]], edges: ['top'] },
      { name: 'archer left|right, centroid 1,3', cells: [[1, 3], [1, 4]], edges: ['left', 'right'] },
      { name: 'bear 2x2 top, centroid 2,4', cells: [[1, 3], [1, 4], [2, 3], [2, 4]], edges: ['top'] },
      { name: 'stalker bottom, centroid 1,1', cells: [[1, 1]], edges: ['bottom'] },
      { name: 'boss 3x3 top|left|right', cells: [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]], edges: ['top', 'left', 'right'] },
      { name: 'clamped at the far corner', cells: [[18, 26]], edges: ['top', 'bottom'] },
    ];

    for (const cfg of configs) {
      const analytic = F.entryDistribution(
        combat.centroidRoundHalfUp(cfg.cells), cfg.edges, bounds, J);
      approx(analytic.reduce((a, x) => a + x.weight, 0), 1, 1e-9, cfg.name + ': weights sum');

      // Sample sim's REAL selectEntryCell. Each draw gets its own ray
      // sub-stream, exactly as fireSkillRay does (streamPrefix + '/ray').
      const rng = combat.makeRng('forecast-parity/' + cfg.name);
      const tally = new Map();
      for (let i = 0; i < N; i++) {
        const s = rng.stream('draw/' + i + '/ray');
        const r = combat.selectEntryCell(cfg.cells, cfg.edges, s, bounds);
        const k = r.edge + '|' + r.entryCell[0] + ',' + r.entryCell[1] + '|' + r.dir;
        tally.set(k, (tally.get(k) || 0) + 1);
      }

      const analyticByKey = new Map(
        analytic.map((a) => [a.edge + '|' + a.entryCell[0] + ',' + a.entryCell[1] + '|' + a.dir, a.weight]));

      // Support must match EXACTLY in both directions -- an outcome the
      // forecast never draws (or one it invents) is a bug no amount of
      // weight-tolerance should hide.
      for (const k of tally.keys()) {
        ok(analyticByKey.has(k), cfg.name + ': sim produced ' + k + ' which entryDistribution never enumerates');
      }
      for (const k of analyticByKey.keys()) {
        ok(tally.has(k), cfg.name + ': entryDistribution enumerates ' + k + ' which sim never produces');
      }
      // ...and the weights must match. 40k draws puts the 3-sigma band on a
      // p~0.1 outcome at ~0.0045, so 0.01 is a comfortable, non-flaky bound.
      for (const [k, w] of analyticByKey) {
        approx((tally.get(k) || 0) / N, w, 0.01, cfg.name + ': P(' + k + ')');
      }
    }
  });

  // -------------------------------------------------------------------
  // 5. The fold itself: shape, sanity, and the perf budget.
  // -------------------------------------------------------------------
  T('forecastPressure: fold over the live dungeon roster is finite, non-negative, and attributed', () => {
    const { getForecast } = require(path.join(__dirname, '..', '..', 'server', 'lib', 'forecast.cjs'));
    const payload = getForecast('default', 5);
    ok(payload.profiles.length > 0, 'the live roster produced no profiles');
    for (const p of payload.profiles) {
      ok(p.weight > 0 && p.weight <= 8, 'profile weight out of range: ' + p.key + ' = ' + p.weight);
      ok(p.rate > 0, 'profile rate must be positive: ' + p.key);
      ok(Array.isArray(p.edges) && p.edges.length > 0, 'profile has no edges: ' + p.key);
    }

    const box = F.parseBox(combat.FORMATIONS.formation1.canvases.unit1);
    const res = F.forecastPressure({
      bounds: payload.bounds,
      jitterHalfWidth: payload.jitterHalfWidth,
      profiles: payload.profiles,
      cells: F.boxCells(box),
    });
    eq(res.perCell.size, 64, 'one entry per canvas cell');
    ok(res.max > 0, 'a live roster must produce some pressure');
    for (const cell of res.perCell.values()) {
      ok(Number.isFinite(cell.damage) && cell.damage >= 0, 'bad damage at ' + cell.row + ',' + cell.col);
      ok(Number.isFinite(cell.statusRate) && cell.statusRate >= 0, 'bad statusRate at ' + cell.row + ',' + cell.col);
      ok(cell.contributors.length > 0, 'no contributors attributed at ' + cell.row + ',' + cell.col);
      // Contributors are the TOP-N, so they cannot exceed the cell total.
      const top = cell.contributors[0];
      ok(top.amount <= cell.damage + cell.statusRate + 1e-9,
        'contributor exceeds cell total at ' + cell.row + ',' + cell.col);
      ok(!!top.enemyId && !!top.skillId, 'contributor is unnamed at ' + cell.row + ',' + cell.col);
    }
  });

  T('forecastPressure: backpacks on the board cast a shadow (occupancy changes the map)', () => {
    const { getForecast } = require(path.join(__dirname, '..', '..', 'server', 'lib', 'forecast.cjs'));
    const payload = getForecast('default', 5);
    const box = F.parseBox(combat.FORMATIONS.formation1.canvases.unit1);
    const cells = F.boxCells(box);
    const bare = F.forecastPressure({
      bounds: payload.bounds, jitterHalfWidth: payload.jitterHalfWidth,
      profiles: payload.profiles, cells,
    });
    // Wall off the top three rows of the field: rays entering from the top
    // now land immediately instead of raking the board.
    const occupied = new Set();
    for (let c = 1; c <= COLS; c++) for (let r = 1; r <= 3; r++) occupied.add(F.cellKey(r, c));
    const shadowed = F.forecastPressure({
      bounds: payload.bounds, jitterHalfWidth: payload.jitterHalfWidth,
      profiles: payload.profiles, cells, occupied,
    });
    ok(shadowed.mean < bare.mean,
      'a wall of backpacks must REDUCE mean pressure behind it (' +
      shadowed.mean.toFixed(2) + ' vs ' + bare.mean.toFixed(2) + ')');
  });

  // [TUNABLE] 50 -> 100 ms (2026-07-17): the live roster roughly tripled when
  // REQ-0208 put the units003 + monsters batches on the authority path (27
  // monsters / 42 units live), and the 4-squad recompute settled at ~72 ms on
  // this box -- a content-scale effect, not an algorithmic regression (master
  // red predates REQ-0193's merge). Restoring headroom under a tighter budget
  // is REQ-0210-forecast-pressure-perf.
  //
  // [REQ-0230] load immunity (2026-07-17): wall clock measures the BOX, not
  // the code -- under multi-session CI contention (loadavg 7-40) the unchanged
  // fold measured 101-141ms wall and failed on an untouched master checkout.
  // Two changes, ratified option (a):
  //   1. Measure process.cpuUsage() (user+sys), not wall clock: scheduler
  //      stalls no longer count, real algorithmic regressions still do.
  //   2. Best-of-3: a single CPU sample can still spike ~40% under cache
  //      contention / a GC pause (observed 136ms one-shot vs 89-98ms
  //      best-of-3 on a fully saturated 8-core box); the min of 3 folds is
  //      what the algorithm costs.
  // [TUNABLE] 100 -> 150 ms CPU at the switch: the live roster has since
  // grown to ~108 profiles (REQ-0219 deepstone et al.) putting the quiet-box
  // fold at ~90ms, so 100 left no content headroom. 150 still fails a 2x
  // regression. Tightening the budget back down stays REQ-0210's job.
  T('forecastPressure: perf budget -- a full 4-squad recompute is well under [TUNABLE 150ms CPU], best of 3', () => {
    const { getForecast } = require(path.join(__dirname, '..', '..', 'server', 'lib', 'forecast.cjs'));
    const payload = getForecast('default', 10);
    const canvases = combat.FORMATIONS.formation1.canvases;
    // Warm up (first call pays for JIT, not for the algorithm).
    for (const slot of Object.keys(canvases)) {
      F.forecastPressure({
        bounds: payload.bounds, jitterHalfWidth: payload.jitterHalfWidth,
        profiles: payload.profiles, cells: F.boxCells(F.parseBox(canvases[slot])),
      });
    }
    let ms = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      const u0 = process.cpuUsage();
      for (const slot of Object.keys(canvases)) {
        F.forecastPressure({
          bounds: payload.bounds, jitterHalfWidth: payload.jitterHalfWidth,
          profiles: payload.profiles, cells: F.boxCells(F.parseBox(canvases[slot])),
        });
      }
      const du = process.cpuUsage(u0);
      ms = Math.min(ms, (du.user + du.system) / 1e3);
    }
    console.log('        (4-squad fold: ' + ms.toFixed(1) + 'ms CPU, best of 3)');
    // The REQ's budget is per RECOMPUTE (one board). Holding all FOUR squads
    // to it is the stricter bar, and node is a fair proxy for the browser's
    // JIT on a pure numeric loop like this.
    ok(ms < 150, 'perf budget blown: ' + ms.toFixed(1) + 'ms CPU >= 150ms');
  });

  // REQ-0203: the enemy verb extensions must fold IDENTICALLY in the forced-copy pair
  // server/lib/forecast.cjs expectedDamagePerFire  <->  shared/forecast.mjs expectedDamagePerFire.
  const SF0203 = require(path.join(__dirname, '..', '..', 'server', 'lib', 'forecast.cjs'));
  T('REQ-0203: expectedDamagePerFire byte-agrees across the forecast copies for the new verbs', () => {
    const cases = [
      { t: 'strike', n: [6, 11] },
      { t: 'multi_strike', n: [4, 7], hits: 4 },
      { t: 'lifesteal', n: [6, 10], frac: 0.5 },
      { t: 'bonus_vs_status', status: 'Weakness', n: [10, 16], mult: 1.5 },
      { t: 'heal_ally', n: [8, 14] },
    ];
    for (const v of cases) eq(SF0203.expectedDamagePerFire(v), F.expectedDamagePerFire(v), 'copies disagree for ' + v.t);
    eq(SF0203.expectedDamagePerFire({ t: 'lifesteal', n: [6, 10] }), 8, 'lifesteal folds to n midpoint');
    eq(SF0203.expectedDamagePerFire({ t: 'bonus_vs_status', n: [10, 16] }), 13, 'bonus_vs_status folds to BASE n midpoint (mult is runtime-conditional, not folded)');
    eq(SF0203.expectedDamagePerFire({ t: 'heal_ally', n: [8, 14] }), 0, 'heal_ally is enemy-side -- no incoming damage');
  });
  T('REQ-0203: the server forecast classifies lifesteal/bonus_vs_status as incoming DAMAGE, never heal_ally', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'server', 'lib', 'forecast.cjs'), 'utf8');
    const m = /const DAMAGE_VERBS = new Set\(\[([^\]]*)\]\)/.exec(src);
    ok(m, 'DAMAGE_VERBS set must be present');
    ok(/'lifesteal'/.test(m[1]) && /'bonus_vs_status'/.test(m[1]), 'lifesteal + bonus_vs_status must be damage verbs');
    ok(!/'heal_ally'/.test(m[1]), 'heal_ally must NOT be a damage verb (enemy-side)');
  });

  console.log('\nforecast parity: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
