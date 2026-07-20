'use strict';
// sim/tests/balance_sim_test.cjs -- REQ-0269: balance sim harness tests.
// Plain node assert-style (matches sim/tests/s4_test.cjs conventions).
//   node sim/tests/balance_sim_test.cjs
//
// (a) determinism: a small matrix run twice via the programmatic runMatrix entry
//     yields deep-equal COMPARISON PAYLOADS (no committed byte-goldens; this is
//     the REQ-0256-proof double-run-equality gate).
// (b) a fixture matchup goes through the real combat.runDungeon -> sane shape.
// (c) an overpowered fixture item trips a flag; a clone of a live common does not.
// (d) enemy-side injection: an overpowered skill candidate raises wipe rate.

const path = require('path');
const B = require(path.join(__dirname, '..', '..', 'tools', 'balance_sim.cjs'));
const combat = require(path.join(__dirname, '..', 'combat.cjs'));

let passed = 0, failed = 0;
function T(name, fn) { try { fn(); passed++; console.log('PASS  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + ' -- ' + e.message); if (process.env.BSIM_TRACE) console.log(e.stack); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const defs = B.loadDefs();

// Fixtures: shapes are 1-cell so they slot into starter_arms' single free cell
// (add mode) without depending on board packing.
const OP_ITEM = { id: '__op_item_fx', schema: 'po/2', name: 'OP', rarity: 'Common', shape: [[0, 0]], tags: ['WeaponPart'], effects: [{ trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'strike', n: [500, 600] } }] };
// clone of the live Common `dagger` (same stat-line: strike [7,11] ~every 1s),
// bodied as 1-cell to occupy starter_arms' only free slot.
const COMMON_CLONE = { id: '__common_clone_fx', schema: 'po/2', name: 'Clone', rarity: 'Common', shape: [[0, 0]], tags: ['WeaponPart'], effects: [{ trigger: { t: 'every_secs', s: [0.9, 1.2] }, verb: { t: 'strike', n: [7, 11] } }] };
const OP_SKILL = { id: '__op_skill_fx', schema: 'skill/1', name_en: 'OP', trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'strike', n: [500, 600] }, attack_profile: { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false }, modes: ['battle'] };

const hasFlag = (p) => p.flags.some(f => f.level === 'flag');
const hasCodeFlag = (p, code) => p.flags.some(f => f.code === code && f.level === 'flag');

// (a) determinism
T('(a) determinism: identical comparison payload across two runs (2 boards x 1 level x 4 seeds)', () => {
  const opts = { candidate: { kind: 'item', def: OP_ITEM, source: 'test' }, _defs: defs, boards: ['dense_turtle', 'scout_heavy'], levels: [3], seeds: 4, builder: 'greedy' };
  const r1 = B.runMatrix(opts);
  const r2 = B.runMatrix(opts);
  ok(B.canonical(r1.payload) === B.canonical(r2.payload), 'comparison payloads differ across runs');
  ok(r1.payload.matrix.runsPerArm === 8, 'expected 8 runs/arm, got ' + r1.payload.matrix.runsPerArm);
});

// (b) fixture matchup through the real engine
T('(b) fixture matchup runs through combat.runDungeon with a sane result shape', () => {
  const board = B.loadBoard('starter_arms');
  const out = combat.runDungeon({ masterSeed: 'bsim-fixture', dungeonDef: defs.dungeonDef, squadSnapshots: [board, board, board, board], itemDefsById: defs.itemDefsById, enemyDefsById: defs.enemyDefsById, monsterPackDefsById: defs.monsterPackDefsById, skillDefsById: defs.skillDefsById, siDefsById: defs.siDefsById, formationId: 'formation1', level: 3, participants: ['a', 'b'] });
  ok(Array.isArray(out.events) && out.events.length > 0, 'events missing/empty');
  ok(['victory', 'wipe', 'incomplete'].indexOf(out.result) !== -1, 'bad result ' + out.result);
  ok(typeof out.finalProgressPct === 'number', 'finalProgressPct not a number');
  ok(typeof out.H === 'number' && out.H >= 0 && out.H <= 1, 'H out of range: ' + out.H);
  ok(Array.isArray(out.rewards), 'rewards not an array');
});

// (c) OP item flags; live-common clone does not
T('(c) overpowered fixture item trips the item_dps_ceiling flag', () => {
  const r = B.runMatrix({ candidate: { kind: 'item', def: OP_ITEM, source: 'test' }, _defs: defs, boards: ['starter_arms'], levels: [3], seeds: 3, builder: 'greedy' });
  ok(hasFlag(r.payload), 'OP item did not flag');
  ok(hasCodeFlag(r.payload, 'item_dps_ceiling'), 'OP item did not trip item_dps_ceiling flag: ' + JSON.stringify(r.payload.flags));
});
T('(c) a clone of a live common item does not trip any flag', () => {
  const r = B.runMatrix({ candidate: { kind: 'item', def: COMMON_CLONE, source: 'test' }, _defs: defs, boards: ['starter_arms'], levels: [3], seeds: 6, builder: 'greedy' });
  ok(!hasFlag(r.payload), 'common clone tripped a flag: ' + JSON.stringify(r.payload.flags));
});

// (d) enemy-side injection raises wipe rate
T('(d) overpowered injected skill raises wipe rate vs baseline', () => {
  const r = B.runMatrix({ candidate: { kind: 'skill', def: OP_SKILL, source: 'test' }, _defs: defs, boards: ['starter_arms'], levels: [3], seeds: 3 });
  ok(r.payload.arms.candidate.wipeRate > r.payload.arms.baseline.wipeRate, 'candidate wipeRate ' + r.payload.arms.candidate.wipeRate + ' not > baseline ' + r.payload.arms.baseline.wipeRate);
  ok(hasFlag(r.payload), 'OP skill injection did not flag');
});

// bonus: closed-vocab rejection is a usage error
T('(e) unknown verb is rejected (closed vocab)', () => {
  const bad = { id: '__bad_fx', schema: 'po/2', rarity: 'Common', shape: [[0, 0]], effects: [{ trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'megablast', n: [1, 2] } }] };
  let threw = false;
  try { B.validateCandidate('item', bad, defs); } catch (e) { threw = !!e.__usage; }
  ok(threw, 'unknown verb should raise a usage error');
});

console.log('----------------------------------');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
