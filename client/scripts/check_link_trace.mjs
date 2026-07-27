#!/usr/bin/env node
// client/scripts/check_link_trace.mjs — REQ-0142 gate.
//
// Exercises the REAL production module (client/src/board/linkTrace.ts) against
// the REAL engine (mock-src/engine.js), not a reimplementation of either.
// linkTrace is deliberately pure (engine + state + layout in, plain data out —
// no Pixi, no DOM, no store), so plain Node can drive it once Vite has
// transpiled the TS. Same discipline, same vite-ssrLoadModule rig, as
// check_unit_icon.mjs — see its header.
//
// THE fixture is canvas_spec.md's own decoded example (PBSystem.xlsx, canvas
// A1:J10): six BPs, one Unit each, with the spec spelling out every link,
// every mutual pair and every intentional dud by hand. If this module's
// reading of the beam graph ever diverges from the ratified spec's, that is
// what goes red here. The three "why not" reasons each get a dedicated
// assertion on top (blocked chain / dud / direction-not-in-set), because they
// are REQ-0142's gate.
//
// Usage: node client/scripts/check_link_trace.mjs   (or: pnpm check:link-trace)
// Exit 0 = all assertions pass.
import { createServer } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const EngineFactory = require(path.resolve(CLIENT_ROOT, '..', 'shared', 'engine.js'));

async function loadLinkTrace() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    return await server.ssrLoadModule('/src/board/linkTrace.ts');
  } finally {
    await server.close();
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log('  ok   ', name);
  } else {
    failures++;
    console.log('  FAIL ', name, detail ? `-- ${detail}` : '');
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { traceUnit, whyNotPair, rayCells, cellLabel, DIR_NAMES } = await loadLinkTrace();

// ---------------------------------------------------------------------------
// Fixture: canvas_spec.md's decoded example. Cells are [row, col], 1-based;
// the spec's own labels are column-letter + row-number (C2 = col 3, row 2).
// Each BP here is a 1x1 pack whose single cell IS its Unit cell — the beam
// graph is a pure function of Unit CELLS and dirs, so collapsing the packs to
// their unit cells reproduces the spec's example exactly while keeping the
// fixture readable. (bpCells/origin still line up: a 1x1 shape at the origin.)
const LAYOUT = { ROWS: 10, COLS: 10 };

// REQ-0170: a Unit's rays come from its DEF's connection_shape, resolved through an
// injected registry -- there is no per-BP dirs array any more. canvas_spec.md's worked
// example is a USER-MANAGED GOLDEN and its dirs are the spec's own; so rather than
// bend the golden onto today's roster (which would be changing the spec to fit the
// code), this mints one synthetic unit def per dirs-set the spec uses. The example is
// reproduced EXACTLY, and what it now proves is that the walker resolves the same
// graph through the def indirection.
const SHAPES = {};
const UNITS = {};
const shapeKeyFor = (dirs) => {
  const key = dirs.length ? 'spec_' + dirs.join('_') : 'spec_none';
  if (!SHAPES[key]) {
    SHAPES[key] = dirs.length
      ? { kind: 'ray', dirs: [...dirs], range: null, pierce: false }
      : { kind: 'none', dirs: [] };
    UNITS['u_' + key] = { name: key, rarity: 'Common', icon: '', connection_shape: key };
  }
  return 'u_' + key;
};
const unit = (id, name, cell, dirs) => ({
  id,
  name,
  color: '#888888',
  shape: [[0, 0]],
  origin: cell,
  unit: { id: shapeKeyFor(dirs), off: [0, 0] },
});
// C2=[2,3] F2=[2,6] I2=[2,9] C8=[8,3] I8=[8,9]  (+ the Pale BP, unit not drawn
// in the draft — omitted, exactly as the spec omits it.)
const state = {
  linked: false,
  bps: [
    unit('ochre', 'Ochre', [2, 3], [2, 4]), // C2, dirs 2 (E) + 4 (S)
    unit('gold', 'Gold', [2, 6], [0]), // F2, dir 0 (N) — the spec's "intentional dud"
    unit('olive', 'Olive', [2, 9], [6]), // I2, dir 6 (W)
    unit('yellow', 'Yellow', [8, 3], [0, 1, 2, 3]), // C8, dirs 0,1,2,3
    unit('brown', 'Brown', [8, 9], [0]), // I8, dir 0 (N)
  ],
  pos: [],
  sis: [],
};
const engine = EngineFactory.create({}, {}, LAYOUT, undefined, UNITS, SHAPES);

// ---------------------------------------------------------------------------
console.log('ray walk (rayCells)');
check('E ray from C2 runs to the board edge', eq(rayCells(engine, LAYOUT, [2, 3], 2), [[2,4],[2,5],[2,6],[2,7],[2,8],[2,9],[2,10]]));
check('N ray from C2 stops at the top edge', eq(rayCells(engine, LAYOUT, [2, 3], 0), [[1, 3]]));
check('a ray leaving the board immediately is empty', eq(rayCells(engine, LAYOUT, [1, 1], 7), []));
check('cellLabel matches the spec notation', cellLabel([2, 3]) === 'C2' && cellLabel([8, 9]) === 'I8');
check('DIR_NAMES is the engine DIRS order', eq([...DIR_NAMES], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']));

// ---------------------------------------------------------------------------
console.log('canvas_spec worked example — links (the spec is the golden)');
const ochre = traceUnit(engine, state, LAYOUT, 'ochre');
check('C2 dir 2 (E) is received by F2 (Gold)', ochre.dirs[2].to === 'gold');
check('C2 dir 4 (S) is received by C8 (Yellow)', ochre.dirs[4].to === 'yellow');
check('C2 links exactly {Gold, Yellow}', eq([...ochre.linked].sort(), ['gold', 'yellow']));

const yellow = traceUnit(engine, state, LAYOUT, 'yellow');
check('C8 dir 0 (N) is a MUTUAL link with C2', yellow.dirs[0].to === 'ochre' && yellow.dirs[0].mutual === true);
check('C8 dir 1 (NE) is received by I2 (Olive)', yellow.dirs[1].to === 'olive');
check('C8 dir 2 (E) is received by I8 (Brown)', yellow.dirs[2].to === 'brown');
check('C8 dir 3 (SE) is an intentional dud', yellow.dirs[3].status === 'dud' && yellow.dirs[3].reason === 'no-receiver');
check('C8 mutualWith is exactly {Ochre}', eq(yellow.mutualWith, ['ochre']));
check('C8 duds is exactly [3]', eq(yellow.duds, [3]));

const gold = traceUnit(engine, state, LAYOUT, 'gold');
check('F2 dir 0 (N) hits nothing — pure receiver, intentional dud', gold.dirs[0].status === 'dud' && gold.dirs[0].reason === 'no-receiver');
check('F2 links nothing', eq(gold.linked, []));

const brown = traceUnit(engine, state, LAYOUT, 'brown');
check('I8 dir 0 (N) is received by I2 (Olive)', brown.dirs[0].to === 'olive');

const olive = traceUnit(engine, state, LAYOUT, 'olive');
check('I2 dir 6 (W): the FIRST Unit on the line is F2 (Gold), not C2', olive.dirs[6].to === 'gold');
check('I2 dir 6 is NOT mutual (Gold fires north, not east)', olive.dirs[6].mutual === false);

// ---------------------------------------------------------------------------
console.log('why-not reason 1: BLOCKED (the first-hit rule consumed the beam)');
// I2's westward ray passes Gold (F2) and then Ochre (C2). canvas_spec: "the
// link beam can not penetrate and link multiple linkers at the same time, one
// link direction only one first hit linker." So Ochre is SHADOWED by Gold.
check('I2 dir 6 reason is "blocked"', olive.dirs[6].reason === 'blocked');
check('I2 dir 6 shadows exactly {Ochre}', eq(olive.dirs[6].shadowed, ['ochre']));
check('I2 dir 6 unitsOnRay is nearest-first [Gold, Ochre]', eq(olive.dirs[6].unitsOnRay.map((h) => h.bp), ['gold', 'ochre']));
check('I2 reports the blocked pair with its blocker + cell', eq(olive.blocked, [{ dir: 6, target: 'ochre', blockedBy: 'gold', at: [2, 6] }]));
const pair = whyNotPair(engine, state, LAYOUT, 'olive', 'ochre');
check('whyNotPair(Olive -> Ochre) = blocked by Gold at F2', pair.reason === 'blocked' && pair.blockedBy === 'gold' && cellLabel(pair.at) === 'F2' && pair.dir === 6);
check('a LINKED pair reads "linked"', whyNotPair(engine, state, LAYOUT, 'ochre', 'gold').reason === 'linked');

console.log('why-not reason 2: NO RECEIVER (fired, empty ray — a legal dud)');
check('C8 dir 3 (SE) has an empty ray', eq(yellow.dirs[3].unitsOnRay, []) && yellow.dirs[3].to === null);
check('and its path runs to the board edge', eq(yellow.dirs[3].path, [[9, 4], [10, 5]]));
check('F2 dir 0 (N) likewise', eq(gold.dirs[0].unitsOnRay, []) && gold.dirs[0].reason === 'no-receiver');

console.log('why-not reason 3: DIRECTION NOT IN THE UNIT\'S SET');
// Gold sits due EAST of Ochre... and Ochre links it. Look the other way: Gold
// fires ONLY north (dir 0), so its westward ray — straight at Ochre — is never
// fired at all. Two perfectly aligned Units, no link, and this is the reason.
check('F2 dir 6 (W) is inactive', gold.dirs[6].active === false && gold.dirs[6].status === 'inactive');
check('F2 dir 6 reason is "dir-not-in-set"', gold.dirs[6].reason === 'dir-not-in-set');
check('F2 dir 6 still knows WHO would receive it (Ochre at C2)', gold.dirs[6].firstOnRay?.bp === 'ochre' && cellLabel(gold.dirs[6].firstOnRay.cell) === 'C2');
check('whyNotPair(Gold -> Ochre) = dir-not-in-set on dir 6', eq(whyNotPair(engine, state, LAYOUT, 'gold', 'ochre'), { reason: 'dir-not-in-set', dir: 6 }));
check('an inactive direction has a hypothetical path (origin-exclusive, hit-inclusive)', eq(gold.dirs[6].path, [[2, 5], [2, 4], [2, 3]]));

console.log('why-not reason 4 (pair-only): NOT ALIGNED');
// F2 -> C8 is +6 rows / -3 cols: not on any of the eight compass rays, so no
// beam direction could EVER reach it. (Ochre->Brown, by contrast, IS aligned --
// dead on the SE diagonal, 6 cells out -- and fails for the OTHER reason: Ochre
// simply does not fire dir 3. Two aligned Units with no link, and the panel can
// tell the player which of the two situations they are looking at.)
check('Gold (F2) and Yellow (C8) share no ray at all', whyNotPair(engine, state, LAYOUT, 'gold', 'yellow').reason === 'not-aligned');
check('Ochre -> Brown IS aligned (SE diagonal) but dir 3 is not fired', eq(whyNotPair(engine, state, LAYOUT, 'ochre', 'brown'), { reason: 'dir-not-in-set', dir: 3 }));
check('a pair with itself is "self"', whyNotPair(engine, state, LAYOUT, 'gold', 'gold').reason === 'self');
check('an unknown BP is reported, not thrown', whyNotPair(engine, state, LAYOUT, 'gold', 'nope').reason === 'unknown-bp');
check('traceUnit of an unknown BP is null, not a throw', traceUnit(engine, state, LAYOUT, 'nope') === null);

// ---------------------------------------------------------------------------
console.log('engine agreement (the engine stays THE authority — REQ-0142: no engine changes)');
// Every LINKED/DUD/MUTUAL fact this module reports must be the engine's own.
// This is the anti-drift assertion: if traceBeams() ever changes its mind about
// the beam graph, linkTrace must change with it — never around it.
const beams = engine.traceBeams(state);
let agree = true;
for (const bp of state.bps) {
  const tr = traceUnit(engine, state, LAYOUT, bp.id);
  // REQ-0170: the fired directions are the UNIT's connection shape, read through the
  // engine's own resolver -- the same source traceBeams() uses. Asking the engine
  // (rather than reading a field off the BP) is the point: there is no longer any
  // per-BP dirs array that could disagree with the def.
  const activeDirs = engine.connShapeOf(bp)?.dirs ?? [];
  for (const d of activeDirs) {
    const bm = beams.find((b) => b.from === bp.id && b.dir === d);
    const dt = tr.dirs[d];
    if (bm.to !== dt.to || bm.mutual !== dt.mutual || !eq(bm.path, dt.path)) agree = false;
    // ...and the first Unit on the ray IS whatever the engine hit.
    if ((dt.firstOnRay?.bp ?? null) !== bm.to) agree = false;
  }
  for (let d = 0; d < 8; d++) {
    if (!activeDirs.includes(d) && tr.dirs[d].to !== null) agree = false; // an unfired direction links nothing
  }
}
check('every active dir matches engine.traceBeams (to/mutual/path/first-hit)', agree);
check('every trace has exactly 8 direction rows, indexed by dir', state.bps.every((bp) => {
  const tr = traceUnit(engine, state, LAYOUT, bp.id);
  return tr.dirs.length === 8 && tr.dirs.every((dt, i) => dt.dir === i);
}));

console.log('');
if (failures) {
  console.log(`check_link_trace: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('check_link_trace: all assertions pass');
