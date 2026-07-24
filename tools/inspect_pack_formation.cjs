#!/usr/bin/env node
'use strict';
// tools/inspect_pack_formation.cjs -- REQ-0298. Loads the LIVE monster_pack +
// enemy content and the sim field constants, runs the pure pack_formation
// inspector, and OUTPUTS the formation-fill result three ways:
//   --report     human table (pack | members | cells | fill% | PASS/FAIL),
//                sorted ascending by fill%, + a summary line. exits 0.
//   --json       the inspectPacks(...) object verbatim -- the STABLE contract
//                the admincontent view consumes (no timestamps/runtime). exits 0.
//   --gate       HARD gate: exit 1 if ANY monster_pack is below FILL_MIN.
//   --advisory   (DEFAULT) the report + a NOT-gating note listing the failing
//                ids, exits 0. Most live packs currently FAIL, so the hard gate
//                (--gate) is opt-in until it flips on with the pack-fix follow-up.
//   --self-test  inline fixtures (a known-footprint pack -> exact cells/fill;
//                the 30% boundary; an empty pack) exercising the real code path.
//
// Optional overrides: --packs <path> --enemies <path> (default: live dungeon).
const fs = require('fs');
const path = require('path');
const { FILL_MIN, placeableCellsFor, packFill, inspectPacks } = require('../sim/lib/pack_formation.cjs');
const { FIELD_ROWS, FIELD_COLS } = require('../sim/lib/field.cjs');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PACKS = path.join(ROOT, 'content', 'live', 'dungeon', 'packs.json');
const DEFAULT_ENEMIES = path.join(ROOT, 'content', 'live', 'dungeon', 'enemies.json');

function loadEntries(p) {
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  return doc.entries || [];
}
function enemyMap(entries) {
  const by = {};
  for (const e of entries) by[e.id] = e;
  return by;
}

// Round-half-to-EVEN, float-safe. The live snapshot was generated with banker's
// rounding (demon_gate 31.25% -> 31.2%, NOT 31.3%), so we reproduce that for the
// human table only. The JSON contract keeps fillFrac at full precision.
function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return (floor % 2 === 0) ? floor : floor + 1;
  return diff < 0.5 ? floor : floor + 1;
}
// tenths integer -> "NN.N%" (built from ints, no float formatting, byte-stable).
function pctStr(tenths) { const w = Math.floor(tenths / 10); return w + '.' + (tenths - w * 10) + '%'; }
function fmtPct(occupied, placeable) { return placeable > 0 ? pctStr(roundHalfEven(occupied * 1000 / placeable)) : '0.0%'; }
function fmtFrac(frac) { return pctStr(roundHalfEven(frac * 1000)); }
// Human label: the pack id with a leading "pack_" stripped, matching the REQ
// snapshot's bare names (frost_scouts, deep_tide). The JSON keeps the full id.
function shortId(id) { return typeof id === 'string' && id.indexOf('pack_') === 0 ? id.slice(5) : id; }
function padr(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function inspectLive(packsPath, enemiesPath) {
  const packs = loadEntries(packsPath);
  const enemyDefsById = enemyMap(loadEntries(enemiesPath));
  const placeableCells = placeableCellsFor(FIELD_ROWS, FIELD_COLS);
  return inspectPacks(packs, enemyDefsById, { placeableCells: placeableCells, fillMin: FILL_MIN });
}

function printReport(result) {
  // sort ascending by fill% -- a STABLE sort, so ties keep input order and the
  // table reproduces the REQ snapshot ordering exactly.
  const rows = result.packs.slice().sort((a, b) => a.fillFrac - b.fillFrac);
  const cellsOf = (r) => r.occupiedCells + '/' + r.placeableCells;
  const wPack = Math.max(4, ...rows.map(r => shortId(r.id).length));
  const wMem = Math.max(7, ...rows.map(r => String(r.memberCount).length));
  const wCells = Math.max(5, ...rows.map(r => cellsOf(r).length));
  const wFill = Math.max(5, ...rows.map(r => fmtPct(r.occupiedCells, r.placeableCells).length));
  console.log(padr('pack', wPack) + '  ' + padl('members', wMem) + '  ' + padl('cells', wCells) + '  ' + padl('fill%', wFill) + '  result');
  for (const r of rows) {
    console.log(
      padr(shortId(r.id), wPack) + '  ' +
      padl(r.memberCount, wMem) + '  ' +
      padl(cellsOf(r), wCells) + '  ' +
      padl(fmtPct(r.occupiedCells, r.placeableCells), wFill) + '  ' +
      (r.pass ? 'PASS' : 'FAIL')
    );
  }
  const s = result.summary;
  const passing = s.total - s.failing;
  console.log('');
  console.log('summary: ' + s.total + ' packs, ' + passing + ' pass, ' + s.failing + ' fail'
    + '  (FILL_MIN ' + fmtFrac(result.fillMin) + ', placeable ' + result.placeableCells + ' cells)');
  if (s.failing) console.log('failing (' + s.failing + '): ' + s.failingIds.map(shortId).join(', '));
}

function selfTest() {
  const enemyDefs = {
    big: { id: 'big', footprint: [4, 3] },     // 12 cells
    small: { id: 'small', footprint: [1, 1] },  // 1 cell
    nofoot: { id: 'nofoot' },                    // missing footprint -> [1,1] = 1
  };
  const checks = [];
  const push = (name, ok, detail) => checks.push([name, ok, detail]);
  const rep = (n) => Array.from({ length: n }, () => ({ enemy: 'small' }));

  // 1. a known-footprint pack -> EXACT cells/fill (12+1+1 = 14 of 100 = 0.14).
  const p1 = packFill({ id: 'p1', members: [{ enemy: 'big' }, { enemy: 'small' }, { enemy: 'nofoot' }] }, enemyDefs, 100);
  push('known footprints sum exactly (12+1+1=14)', p1.occupiedCells === 14, p1.occupiedCells);
  push('memberCount counts members', p1.memberCount === 3, p1.memberCount);
  push('fillFrac = occupied/placeable (0.14)', p1.fillFrac === 0.14, p1.fillFrac);

  // 2. placeableCells DERIVED from field constants (26x18 -> 24x16 = 384).
  push('placeableCellsFor(18,26) === 384', placeableCellsFor(18, 26) === 384, placeableCellsFor(18, 26));

  // 3. the 30% boundary: exactly-30% PASS, just-under FAIL.
  const exact = inspectPacks([{ id: 'exact', members: rep(30) }], enemyDefs, { placeableCells: 100, fillMin: 0.30 });
  push('exactly 30% PASSes (30/100)', exact.packs[0].pass === true && exact.packs[0].fillFrac === 0.30, exact.packs[0]);
  const under = inspectPacks([{ id: 'under', members: rep(29) }], enemyDefs, { placeableCells: 100, fillMin: 0.30 });
  push('just under 30% FAILs (29/100)', under.packs[0].pass === false, under.packs[0]);

  // 4. an empty pack -> 0 cells, 0 fill, FAIL, and appears in failingIds.
  const empty = inspectPacks([{ id: 'empty', members: [] }], enemyDefs, { placeableCells: 100, fillMin: 0.30 });
  push('empty pack: 0 cells, 0 fill, FAIL', empty.packs[0].occupiedCells === 0 && empty.packs[0].fillFrac === 0 && empty.packs[0].pass === false, empty.packs[0]);
  push('summary.failingIds carries the failing id', empty.summary.failing === 1 && empty.summary.failingIds[0] === 'empty', empty.summary);

  // 5. FILL_MIN is the exported 0.30, and the banker's-rounded display matches
  //    the snapshot's ambiguous case (120/384 = 31.25% -> 31.2%).
  push('FILL_MIN exported === 0.30', FILL_MIN === 0.30, FILL_MIN);
  push('banker rounding 120/384 -> 31.2%', fmtPct(120, 384) === '31.2%', fmtPct(120, 384));

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (ok) console.log('PASS  ' + name);
    else { failed++; console.log('FAIL  ' + name + ' -- ' + JSON.stringify(detail)); }
  }
  if (failed) { console.error('inspect_pack_formation self-test: ' + failed + ' failure(s)'); process.exit(1); }
  console.log('inspect_pack_formation self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
  if (argv.includes('--self-test')) { selfTest(); return; }
  const result = inspectLive(opt('--packs', DEFAULT_PACKS), opt('--enemies', DEFAULT_ENEMIES));
  if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
  printReport(result);
  const anyFail = result.summary.failing > 0;
  if (argv.includes('--gate')) {
    if (anyFail) { console.error('GATE FAIL: ' + result.summary.failing + ' monster_pack(s) below FILL_MIN (' + fmtFrac(result.fillMin) + ')'); process.exit(1); }
    console.log('GATE OK: all ' + result.summary.total + ' packs >= FILL_MIN'); process.exit(0);
  }
  // advisory / default
  if (anyFail) console.log('ADVISORY (not gating, exit 0): ' + result.summary.failing + ' of ' + result.summary.total
    + ' packs below FILL_MIN ' + fmtFrac(result.fillMin) + ' -- the HARD gate (--gate) flips on with the pack-fix follow-up REQ.');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { inspectLive: inspectLive, printReport: printReport, roundHalfEven: roundHalfEven, fmtPct: fmtPct };
