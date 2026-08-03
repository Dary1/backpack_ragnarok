'use strict';
// server/tests/pacing_test.cjs -- REQ-0240: paceEvents unit gates
// (per-class gaps, coalescing, budget clamp, pacingVersion:0 passthrough,
// serve-time decoration without mutating the stored log, roster payload).
// DB-free; wired into tools/ci.sh.
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'services', 'pacing.cjs'));
const PACING = P.PACING;

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

function ev(o) { return Object.assign({ t: 0, seq: 0 }, o); }
function sampleRun() {
  return [
    ev({ ev: 'progress', enc: -1, pct: 0, t: 0 }),
    ev({ ev: 'encounter_start', enc: 0, kind: 'pack', t: 0 }),
    ev({ ev: 'telegraph', src: 'g#1', skill: 'strike', edge: 'top', t: 0.5 }),
    ev({ ev: 'ray_fire', field: 'player', src: 'g#1', entry: [1, 5], t: 1.0 }),
    ev({ ev: 'ray_step', path: [[1, 5], [2, 5], [3, 5]], t: 1.0 }),
    ev({ ev: 'ray_hit', dst: 'F7', amount: 12, hp_after: 40, t: 1.1 }),
    ev({ ev: 'progress', enc: 0, pct: 50, t: 1.2 }),
    ev({ ev: 'encounter_start', enc: 1, kind: 'boss', t: 2.0 }),
    ev({ ev: 'run_end', result: 'victory', final_pct: 100, t: 3.0 }),
  ];
}

T('computeTimeline does NOT mutate the input events (storage stays clean)', () => {
  const evs = sampleRun();
  const before = JSON.stringify(evs);
  P.computeTimeline(evs);
  assert.strictEqual(JSON.stringify(evs), before, 'events must be untouched -- pt lives in a parallel array');
});

T('pt is monotonic non-decreasing and starts at introMs', () => {
  const { pt } = P.computeTimeline(sampleRun());
  assert.strictEqual(pt[0], PACING.introMs, 'pt_0 must equal introMs');
  for (let i = 1; i < pt.length; i++) assert.ok(pt[i] >= pt[i - 1], 'pt must be non-decreasing at ' + i);
});

T('per-class floors: encounter_start / telegraph beats respect the table', () => {
  const { pt } = P.computeTimeline(sampleRun());
  assert.ok(pt[1] - pt[0] >= PACING.minGapMs.encounter_start, 'encounter_start floor');
  assert.ok(pt[2] - pt[1] >= PACING.gapAfterMs.encounter_start, 'encounter_start gapAfter holds the intro banner');
});

T('ray_step gapAfter scales with path length and clamps to [minMs,maxMs]', () => {
  assert.strictEqual(P.gapAfterMs('ray_step', { path: new Array(2).fill([0, 0]) }), PACING.rayStep.minMs);
  assert.strictEqual(P.gapAfterMs('ray_step', { path: new Array(50).fill([0, 0]) }), PACING.rayStep.maxMs);
});

T('coalescing: >=minHits same-target ray_hit collapse to one beat with a summed rep', () => {
  const evs = [
    ev({ ev: 'encounter_start', enc: 0, kind: 'pack', t: 0 }),
    ev({ ev: 'ray_hit', dst: 'F7', amount: 5, t: 1.00 }),
    ev({ ev: 'ray_hit', dst: 'F7', amount: 7, t: 1.02 }),
    ev({ ev: 'ray_hit', dst: 'F7', amount: 3, t: 1.05 }),
    ev({ ev: 'ray_hit', dst: 'F7', amount: 9, t: 1.10 }),
    ev({ ev: 'run_end', result: 'victory', t: 2.0 }),
  ];
  const { pt, coalesce, hidden } = P.computeTimeline(evs);
  // one representative (the last member, index 4) carries the summary
  assert.deepStrictEqual(coalesce[4], { hits: 4, amount: 24 });
  // all four burst members share one beat
  assert.strictEqual(new Set([pt[1], pt[2], pt[3], pt[4]]).size, 1);
  // three non-rep members are hidden (indices 1,2,3)
  assert.ok(hidden[1] && hidden[2] && hidden[3] && !hidden[4]);
});

T('coalescing does NOT fire below minHits or across targets', () => {
  const evs = [ev({ ev: 'ray_hit', dst: 'A1', amount: 5, t: 1.0 }), ev({ ev: 'ray_hit', dst: 'A1', amount: 5, t: 1.05 }), ev({ ev: 'ray_hit', dst: 'B2', amount: 5, t: 1.1 })];
  const { pt, coalesce } = P.computeTimeline(evs);
  assert.strictEqual(Object.keys(coalesce).length, 0, 'no coalesce below minHits');
  assert.ok(pt[0] < pt[1] && pt[1] < pt[2]);
});

T('budget clamp: a small run stretches UP to >= minPresentSecs', () => {
  const { durationSecs, pt } = P.computeTimeline(sampleRun());
  assert.ok(durationSecs >= PACING.minPresentSecs - 1e-6, 'below min floor: ' + durationSecs);
  assert.ok(durationSecs <= PACING.maxPresentSecs + 1e-6);
  for (let i = 1; i < pt.length; i++) assert.ok(pt[i] >= pt[i - 1]);
});

T('budget clamp: a huge run compresses DOWN to <= maxPresentSecs', () => {
  const evs = [ev({ ev: 'encounter_start', enc: 0, kind: 'pack', t: 0 })];
  for (let i = 0; i < 4000; i++) evs.push(ev({ ev: 'ray_fire', field: 'player', src: 'x', entry: [1, 1], t: i * 0.01 }));
  evs.push(ev({ ev: 'run_end', result: 'victory', t: 40 }));
  const { durationSecs } = P.computeTimeline(evs);
  assert.ok(durationSecs <= PACING.maxPresentSecs + 1e-6, 'over max: ' + durationSecs);
  assert.ok(durationSecs >= PACING.maxPresentSecs - 1, 'a huge run should sit near the max clamp');
});

T('pacingVersion:0 passthrough: presentationDurationSecs/eventPtSecs use sim t', () => {
  const legacy = { pacingVersion: 0, events: [ev({ ev: 'encounter_start', t: 0 }), ev({ ev: 'run_end', t: 21.4 })] };
  assert.strictEqual(P.presentationDurationSecs(legacy), 21.4, 'legacy duration is max t');
  assert.strictEqual(P.eventPtSecs(legacy, 1), 21.4, 'legacy event visibility gates on t');
  const paced = { pacingVersion: 1, presentation: { pt: [46000], durationSecs: 49 }, events: [ev({ ev: 'run_end', t: 21.4 })] };
  assert.strictEqual(P.eventPtSecs(paced, 0), 46, 'paced event visibility gates on pt/1000');
  assert.strictEqual(P.presentationDurationSecs(paced), 49);
});

T('decorateVisible gates on pt, merges pt onto COPIES, never mutates run.events', () => {
  const events = sampleRun();
  const tl = P.computeTimeline(events);
  const run = { pacingVersion: 1, presentation: { version: 1, durationSecs: tl.durationSecs, pt: tl.pt, coalesce: tl.coalesce, hidden: tl.hidden }, events };
  // Before intro (0.5s) nothing is visible.
  assert.strictEqual(P.decorateVisible(run, 0.5).length, 0, 'intro withholds all events');
  // At the presentation duration, every event is visible + carries pt.
  const all = P.decorateVisible(run, tl.durationSecs);
  assert.strictEqual(all.length, events.length);
  assert.strictEqual(all[0].pt, PACING.introMs);
  // Stored events remain byte-clean (no pt leaked in).
  assert.ok(events.every((e) => e.pt === undefined), 'stored events must not carry pt');
});

T('legacy decorateVisible: pacingVersion 0 gates on t and returns raw events', () => {
  const events = [ev({ ev: 'encounter_start', t: 0 }), ev({ ev: 'run_end', t: 21.4 })];
  const run = { pacingVersion: 0, events };
  assert.strictEqual(P.decorateVisible(run, 0).length, 1, 't<=0 -> only the first');
  assert.strictEqual(P.decorateVisible(run, 25).length, 2);
  assert.strictEqual(P.decorateVisible(run, 25)[0], events[0], 'legacy returns the raw event object');
});

T('buildRoster: per-slot player BPs (exact hpMax) + enemy hints', () => {
  const result = { bps: [
    { id: 'bp_a', hpMax: 100, hp: 80, squadSlot: 'unit1' },
    { id: 'bp_b', hpMax: 120, hp: 0, squadSlot: 'unit1' },
    { id: 'bp_c', hpMax: 90, hp: 90, squadSlot: 'unit3' },
  ] };
  const dungeonDef = { encounters: [{ enemyPack: { packId: 'pk1' } }] };
  const defs = {
    monsterPackDefsById: { pk1: { members: [{ enemy: 'gob', at: 'B2' }] } },
    enemyDefsById: { gob: { id: 'gob', name: 'Goblin', hp: [30, 45], footprint: [1, 1], i18n: { ja: { name: 'ゴブリン' } } } },
  };
  const roster = P.buildRoster(result, dungeonDef, defs);
  assert.strictEqual(roster.slots.length, 4);
  // REQ-0355: bps carry bpIdx (falls back to push order when the sim never tagged it).
  assert.deepStrictEqual(roster.slots[0].bps, [{ id: 'bp_a', hpMax: 100, bpIdx: 0 }, { id: 'bp_b', hpMax: 120, bpIdx: 1 }]);
  assert.strictEqual(roster.slots[1].bps.length, 0);
  assert.strictEqual(roster.slots[0].canvas, null); // no squadSnapshots passed -> null canvas, legacy-safe
  assert.deepStrictEqual(roster.enemies[0], { id: 'gob', instanceId: 'gob#0', at: 'B2', fieldCells: [[2, 2]], name: 'Goblin', nameJa: 'ゴブリン', hpMax: 45, footprint: [1, 1], packId: 'pk1', masked: false });
});

T('REQ-0276 A2(i) buildRoster: enemy instanceId / at / fieldCells / masked (transpose-safe)', () => {
  const dungeonDef = { encounters: [{ enemyPack: { packId: 'pk1' } }] };
  const defs = {
    monsterPackDefsById: { pk1: { members: [
      { enemy: 'gnoll', at: 'B2' },
      { enemy: 'archer', at: 'C2' },
      { enemy: 'archer', at: 'E2' },
    ] } },
    enemyDefsById: {
      gnoll: { id: 'gnoll', name: 'Gnoll', hp: [10, 10], footprint: [1, 1] },
      // footprint [fh,fw]=[1,2]: ONE row, TWO cols -- proves fieldCells honours
      // the [height,width] transpose (a wrong w=fp[0] would give one cell).
      archer: { id: 'archer', name: 'Archer', hp: [8, 8], footprint: [1, 2] },
    },
  };
  const roster = P.buildRoster({ bps: [] }, dungeonDef, defs);
  assert.strictEqual(roster.enemies.length, 3, 'three placed instances');
  // instanceId mirrors compileEnemyPack's eid + '#' + <index-in-pack-members>.
  assert.deepStrictEqual(roster.enemies.map((e) => e.instanceId), ['gnoll#0', 'archer#1', 'archer#2']);
  assert.deepStrictEqual(roster.enemies.map((e) => e.at), ['B2', 'C2', 'E2']);
  assert.strictEqual(roster.enemies[0].fieldCells.length, 1, 'gnoll [1,1] occupies 1 cell');
  assert.deepStrictEqual(roster.enemies[1].fieldCells, [[2, 3], [2, 4]], 'C2 + width 2 -> [2,3],[2,4] (transpose-safe)');
  assert.ok(roster.enemies.every((e) => e.masked === false), 'monsters are unmasked');
});

T('REQ-0276 A2(ii..iv) decorateVisible: serve-time attribution on COPIES only', () => {
  const events = [
    ev({ ev: 'ray_hit', dst: 'gnoll#0', amount: 5, hp_after: 5 }),
    ev({ ev: 'ray_hit', dst: '?', amount: 3 }),
    ev({ ev: 'ray_hit_all', hits: [{ dst: 'archer#1', amount: 2 }, { dst: '?', amount: 1 }] }),
    ev({ ev: 'att_reveal', att: 'att_trap0', kind: 'trap', at: [9, 13] }),
    ev({ ev: 'unit_charge_spend', id: 'bp_a', spend: 'fire_on_full' }),
    ev({ ev: 'unit_charge_strike', src: 'bp_c', amount: 4 }),
  ];
  const roster = {
    slots: [
      { slot: 'unit1', index: 0, bps: [{ id: 'bp_a', hpMax: 100 }] },
      { slot: 'unit2', index: 1, bps: [] },
      { slot: 'unit3', index: 2, bps: [{ id: 'bp_c', hpMax: 90 }] },
      { slot: 'unit4', index: 3, bps: [] },
    ],
    enemies: [
      { id: 'gnoll', instanceId: 'gnoll#0' },
      { id: 'archer', instanceId: 'archer#1' },
      { id: 'archer', instanceId: 'archer#2' },
    ],
  };
  const run = {
    pacingVersion: 1, roster, gimics: { att_trap0: 'trap_frost_deadfall' },
    presentation: { pt: events.map((_, i) => 2000 + i), durationSecs: 60 },
    events,
  };
  const before = JSON.stringify(events);
  const out = P.decorateVisible(run, 1e9);
  assert.strictEqual(out.length, events.length, 'all revealed');
  assert.strictEqual(out[0].enemyIdx, 0, 'gnoll#0 -> roster index 0');
  assert.strictEqual(out[1].enemyIdx, undefined, 'masked dst carries no enemyIdx (reveal semantics preserved)');
  assert.strictEqual(out[2].hits[0].enemyIdx, 1, 'archer#1 -> index 1');
  assert.strictEqual(out[2].hits[1].enemyIdx, undefined, 'masked area hit stays anonymous');
  assert.strictEqual(out[3].gimicId, 'trap_frost_deadfall', 'att_* -> source gimic content id');
  assert.strictEqual(out[4].slot, 0, 'unit_charge via id: bp_a in unit1 -> slot 0');
  assert.strictEqual(out[5].slot, 2, 'unit_charge via src: bp_c in unit3 -> slot 2');
  assert.strictEqual(JSON.stringify(events), before, 'stored run.events (incl nested hits) byte-identical');
  assert.ok(events.every((e) => e.enemyIdx === undefined && e.gimicId === undefined && e.slot === undefined), 'no attribution leaked onto stored events');
});


// ---- REQ-0355: served `field` stamping + per-seat lean canvases ----------

T('REQ-0355: decorateVisible stamps the walking ray field onto served hit copies', () => {
  const events = [
    { t: 0, seq: 0, ev: 'ray_fire', field: 'enemy', src: 'blade' },
    { t: 0, seq: 1, ev: 'ray_hit', dst: 'gob#0', amount: 5, hp_after: 40 },
    { t: 1, seq: 2, ev: 'ray_fire', field: 'player', src: 'gob' },
    { t: 1, seq: 3, ev: 'ray_hit', dst: 'bp_a', amount: 3, hp_after: 97, slot: 0, bpIdx: 0 },
    { t: 1, seq: 4, ev: 'ray_aoe', center: [1, 1], radius: 1, hits: [{ dst: 'bp_a', amount: 1, hp_after: 96, slot: 0, bpIdx: 0 }] },
  ];
  const paced = P.paceEvents(events);
  const run = { events, pacingVersion: paced.pacingVersion, presentation: paced.presentation, roster: null };
  const out = P.decorateVisible(run, 1e9);
  assert.strictEqual(out[1].field, 'enemy', 'hit after an enemy-field fire is field:enemy');
  assert.strictEqual(out[3].field, 'player', 'hit after a player-field fire is field:player');
  assert.strictEqual(out[4].field, 'player', 'aoe inherits the walking ray field');
  assert.strictEqual(out[3].slot, 0, 'sim slot attribution passes through serving untouched');
  assert.strictEqual(events[1].field, undefined, 'stored events never mutated');
});

T('REQ-0355: buildRoster serves a lean per-seat canvas from the frozen squad snapshots', () => {
  const result = { bps: [{ id: 'bp_a', hpMax: 100, hp: 80, squadSlot: 'unit1', bpIdx: 0 }] };
  const dungeonDef = { encounters: [] };
  const snapshots = [
    { bps: [{ id: 'bp_a', name: 'Alpha', color: '#BF9000', hpMax: 100, shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'dwarf', off: [0, 1] } }],
      pos: [{ id: 'blade', loc: 'grid', rot: 0, uid: 'p1', cell: [1, 1] }, { id: 'stowed', loc: 'inv', uid: 'p2' }],
      sis: [{ uid: 's1' }] },
    null, { bps: [], pos: [], sis: [] }, null,
  ];
  const roster = P.buildRoster(result, dungeonDef, {}, snapshots);
  assert.deepStrictEqual(roster.slots[0].canvas, {
    bps: [{ id: 'bp_a', name: 'Alpha', color: '#BF9000', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'dwarf', off: [0, 1] } }],
    pos: [{ id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }],
  }, 'lean pick: draw fields only; non-grid POs and sis dropped');
  assert.strictEqual(roster.slots[1].canvas, null, 'empty seat -> null canvas');
  assert.deepStrictEqual(roster.slots[2].canvas, { bps: [], pos: [] });
  assert.deepStrictEqual(roster.slots[0].bps, [{ id: 'bp_a', hpMax: 100, bpIdx: 0 }]);
});

T('REQ-0276 A2: no roster -> no attribution (legacy-safe, masked stays masked)', () => {
  const events = [ev({ ev: 'ray_hit', dst: 'gnoll#0', amount: 5 })];
  const run = { pacingVersion: 1, roster: null, presentation: { pt: [2000] }, events };
  assert.strictEqual(P.decorateVisible(run, 1e9)[0].enemyIdx, undefined, 'no roster -> no enemyIdx');
});

console.log('\npacing: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
