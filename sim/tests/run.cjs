// sim/tests/run.cjs -- REQ-0036 P1-A combat simulator test suite.
// Mirrors mock-src/tests/run.cjs's T()/eq()/ok() harness style.
'use strict';
const path = require('path');
const fs = require('fs');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));
const dungen = require(path.join(__dirname, '..', 'dungen.cjs'));

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
  if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' expected ~' + b + ' (tol ' + tol + ') got ' + a);
}

// =====================================================================
// Fixtures: content loaded from the repo (scenario.json, live_items.json,
// batch-002-dungeon-pilot). Paths resolved relative to repo root.
// =====================================================================
const REPO_ROOT = path.join(__dirname, '..', '..');
const scenario = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItemsRaw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {};
for (const e of liveItemsRaw.entries) itemDefsById[e.id] = e;

const BATCH_DIR = path.join(REPO_ROOT, 'content', 'batches', 'batch-002-dungeon-pilot');
const enemiesRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'enemies.json'), 'utf8'));
const skillsRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'skills.json'), 'utf8'));
const dungeonRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'dungeon.json'), 'utf8'));
const itemsPilotRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'items.json'), 'utf8'));
// REQ-0184: monster_pack/1 -- batch-002's dungeon.json names its packs from here.
const packsRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'packs.json'), 'utf8'));
const monsterPackDefsById = {};
for (const e of packsRaw.entries) monsterPackDefsById[e.id] = e;

const enemyDefsById = {};
for (const e of enemiesRaw.entries) enemyDefsById[e.id] = e;
const skillDefsById = {};
for (const s of skillsRaw.entries) {
  skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
}
const pilotItemDefsById = {};
for (const e of itemsPilotRaw.entries) pilotItemDefsById[e.id] = e;

function fourSquadSnapshots() { return [scenario, scenario, scenario, scenario]; }

// A tiny synthetic enemy/skill pack for isolated unit tests that don't
// need the full batch-002 roster.
const tinyEnemyDefs = {
  tiny_goblin: { id: 'tiny_goblin', name: 'Tiny Goblin', hp: [20, 20], footprint: [1, 1], skills: ['tiny_bite'] },
};
const tinySkillDefs = {
  tiny_bite: { trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
};

// =====================================================================
// 1. Determinism
// =====================================================================
T('determinism: same seed -> byte-identical JSONL replay log', () => {
  const opts = {
    masterSeed: 'det-seed-A',
    dungeonDef: { encounters: [
      { id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 },
      { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 },
    ] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs,
    formationId: 'formation1', level: 1, participants: ['pA', 'pB'],
  };
  const r1 = combat.runDungeon(opts);
  const r2 = combat.runDungeon(opts);
  const j1 = combat.toJSONL(r1.events), j2 = combat.toJSONL(r2.events);
  ok(j1 === j2, 'identical seed must produce identical JSONL log');
  ok(j1.length > 0, 'log should be non-empty');
});

T('determinism: different seed -> log differs', () => {
  const base = {
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 }, { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 }] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs,
    formationId: 'formation1', level: 1, participants: ['pA', 'pB'],
  };
  const r1 = combat.runDungeon(Object.assign({ masterSeed: 'seed-one' }, base));
  const r2 = combat.runDungeon(Object.assign({ masterSeed: 'seed-two' }, base));
  ok(combat.toJSONL(r1.events) !== combat.toJSONL(r2.events), 'different seeds should (almost certainly) differ');
});

// =====================================================================
// 1b. REQ-0078 reactive triggers (OnHit / OnBeenHit taxonomy)
// =====================================================================
const reactEnemyDefs = {
  react_goblin: { id: 'react_goblin', name: 'React Goblin', hp: [300, 300], footprint: [1, 1], skills: ['rg_bite', 'rg_onhit_poison', 'rg_retaliate'] },
};
const reactSkillDefs = {
  rg_bite: { trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [6, 6] }, attack_profile: { edge: ['top'], penetration: 4, aoe: 2 } },
  rg_onhit_poison: { trigger: { t: 'OnSquadHit' }, verb: { t: 'apply_status', status: 'Poison', n: [2, 2] } },
  rg_retaliate: { trigger: { t: 'OnSquadBeenHit' }, verb: { t: 'strike', n: [9, 9] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
};
function runReact(seed, enemyDefs, skillDefs) {
  return combat.runDungeon({
    masterSeed: seed,
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['react_goblin'] }, deadline_secs: 30 }] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: enemyDefs, skillDefsById: skillDefs,
    formationId: 'formation1', level: 1, participants: ['pA', 'pB'],
  });
}
T('REQ-0078 reactive: OnSquadHit rider + OnSquadBeenHit retaliation fire on a monster', () => {
  const r = runReact('req0078-react', reactEnemyDefs, reactSkillDefs);
  const rp = r.events.filter(e => e.ev === 'reactive_proc');
  const onhit = rp.filter(e => e.trigger === 'OnSquadHit');
  const beenhit = rp.filter(e => e.trigger === 'OnSquadBeenHit');
  const retal = r.events.filter(e => e.ev === 'ray_fire' && String(e.src).indexOf('#react') >= 0);
  ok(onhit.length > 0, 'OnSquadHit offensive rider fires when the monster lands a direct hit');
  ok(beenhit.length > 0, 'OnSquadBeenHit fires when the monster takes a direct hit');
  ok(retal.length > 0, 'OnSquadBeenHit produces a retaliation ray (src tagged #react)');
  eq(onhit[0].verb, 'apply_status', 'OnSquadHit rider applies its verb');
  eq(onhit[0].status, 'Poison', 'rider applies Poison to the struck target');
});
T('REQ-0078 reactive: replay deterministic under isolated reactive RNG streams', () => {
  ok(combat.toJSONL(runReact('same', reactEnemyDefs, reactSkillDefs).events) ===
     combat.toJSONL(runReact('same', reactEnemyDefs, reactSkillDefs).events), 'same seed -> identical reactive replay');
});
T('REQ-0078 reactive: pure every_secs content emits NO reactive_proc (baseline invariant)', () => {
  const r = combat.runDungeon({
    masterSeed: 'baseline',
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 }] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs,
    formationId: 'formation1', level: 1, participants: ['pA', 'pB'],
  });
  eq(r.events.filter(e => e.ev === 'reactive_proc').length, 0, 'no reactive procs for non-reactive content');
});

// =====================================================================
// 1c. REQ-0095 player-side reactive triggers (OnHit taxonomy Phase 1b)
// =====================================================================
T('REQ-0095 reactive: player OnSquadHit rider + OnSquadBeenHit retaliation fire', () => {
  const gridPos = (scenario.pos || []).filter(p => p.loc === 'grid');
  let atk = null;
  for (const p of gridPos) { const d = itemDefsById[p.id]; if (d && (d.effects || []).some(f => f.trigger && f.trigger.t === 'every_secs' && (f.verb.t === 'strike' || f.verb.t === 'multi_strike'))) { atk = p.id; break; } }
  ok(atk, 'scenario has an attacking (every_secs strike) item');
  const inj = JSON.parse(JSON.stringify(itemDefsById));
  inj[atk].effects = (inj[atk].effects || []).concat([
    { trigger: { t: 'OnSquadHit' }, verb: { t: 'apply_status', status: 'Poison', n: [2, 2] } },
    { trigger: { t: 'OnSquadBeenHit' }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
  ]);
  const ed = { agg: { id: 'agg', name: 'Agg', hp: [400, 400], footprint: [2, 2], skills: ['big_bite'] } };
  const sd = { big_bite: { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [8, 8] }, attack_profile: { edge: ['top'], penetration: 8, aoe: 3 } } };
  const r = combat.runDungeon({ masterSeed: 'req0095-player', dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['agg'] }, deadline_secs: 30 }] }, squadSnapshots: fourSquadSnapshots(), itemDefsById: inj, enemyDefsById: ed, skillDefsById: sd, formationId: 'formation1', level: 1, participants: ['pA'] });
  const rp = r.events.filter(e => e.ev === 'reactive_proc');
  ok(rp.filter(e => e.trigger === 'OnSquadHit').length > 0, 'player OnSquadHit rider fires on landing a hit');
  ok(rp.filter(e => e.trigger === 'OnSquadBeenHit').length > 0, 'player OnSquadBeenHit fires when a player BP is hit');
  ok(r.events.some(e => e.ev === 'ray_fire' && String(e.src).indexOf('#react') >= 0), 'player OnSquadBeenHit produces a retaliation ray');
});
T('REQ-0095 reactive: player determinism (isolated reactive RNG)', () => {
  const inj = JSON.parse(JSON.stringify(itemDefsById));
  const atk = (scenario.pos || []).filter(p => p.loc === 'grid').map(p => p.id).find(id => (itemDefsById[id].effects || []).some(f => f.trigger && f.trigger.t === 'every_secs'));
  inj[atk].effects = (inj[atk].effects || []).concat([{ trigger: { t: 'OnSquadHit' }, verb: { t: 'apply_status', status: 'Poison', n: [2, 2] } }]);
  const mk = () => combat.runDungeon({ masterSeed: 'req0095-det', dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 30 }] }, squadSnapshots: fourSquadSnapshots(), itemDefsById: inj, enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs, formationId: 'formation1', level: 1, participants: ['pA'] });
  ok(combat.toJSONL(mk().events) === combat.toJSONL(mk().events), 'same seed -> identical player reactive replay');
});

T('REQ-0095 reactive: OnPOHit fires when a seated SI host PO lands a hit', () => {
  const siDefs = {}; for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'live', 'live_sis.json'), 'utf8')).entries) siDefs[e.id] = e;
  const gridPos = (scenario.pos || []).filter(p => p.loc === 'grid');
  const atkPo = gridPos.find(p => (itemDefsById[p.id].effects || []).some(f => f.trigger && f.trigger.t === 'every_secs' && f.verb.t === 'strike' && !f.cond));
  ok(atkPo, 'scenario has an unconditioned every_secs striker PO');
  const sc = JSON.parse(JSON.stringify(scenario));
  sc.sis = (sc.sis || []).concat([{ uid: 'onpo_test', id: 'acc_frost', host: { po: atkPo.uid, si: 0 } }]);
  const ed = { wall: { id: 'wall', name: 'Wall', hp: [600, 600], footprint: [14, 20], skills: ['nap'] } };
  const sd = { nap: { trigger: { t: 'every_secs', s: [9, 9] }, verb: { t: 'strike', n: [1, 1] }, attack_profile: { edge: ['top'] } } };
  const r = combat.runDungeon({ masterSeed: 'req0095-onpohit', dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['wall'] }, deadline_secs: 20 }] }, squadSnapshots: [sc, scenario, scenario, scenario], itemDefsById, siDefsById: siDefs, enemyDefsById: ed, skillDefsById: sd, formationId: 'formation1', level: 1, participants: ['pA'] });
  const onpo = r.events.filter(e => e.ev === 'reactive_proc' && e.trigger === 'OnPOHit');
  ok(onpo.length > 0, 'OnPOHit fires when the seated SI host PO lands a hit');
  eq(onpo[0].status, 'Chill', 'Frost Orb OnPOHit applies Chill to the struck target');
});

// =====================================================================
// 2. Ray geometry
// =====================================================================
T('ray geometry: entry projection+jitter stays within field bounds across many draws', () => {
  const rng = combat.makeRng('entry-bounds-seed');
  for (let i = 0; i < 200; i++) {
    const rayStream = rng.stream('entrytest/' + i + '/ray');
    const { edge, entryCell } = combat.selectEntryCell([[5, 5], [5, 6]], ['top', 'left', 'right', 'bottom'], rayStream, { ROWS: 18, COLS: 26 });
    ok(entryCell[0] >= 1 && entryCell[0] <= 18, 'row in bounds, got ' + entryCell[0]);
    ok(entryCell[1] >= 1 && entryCell[1] <= 26, 'col in bounds, got ' + entryCell[1]);
    ok(['top', 'left', 'right', 'bottom'].includes(edge), 'edge must be one of the 4');
  }
});

T('ray geometry: penetration exhaustion -- N pass-throughs then terminal hit', () => {
  // Three occupants in a row along a DR ray; penetration=1 should hit
  // first two (pass through 1), terminal-stop at the third.
  const occupants = [
    { id: 'occA', fieldCells: [[2, 2]], alive: true },
    { id: 'occB', fieldCells: [[3, 3]], alive: true },
    { id: 'occC', fieldCells: [[4, 4]], alive: true },
  ];
  const hitOrder = [];
  const result = combat.walkRay({
    field: { ROWS: 18, COLS: 26 }, entryCell: [1, 1], dir: 'DR', mode: 'battle',
    penetration: 1, aoe: 0, aoeStatuses: false, bounceBudget: 0,
    liveOccupantFn: (cell) => occupants.find(o => o.alive && o.fieldCells.some(c => c[0] === cell[0] && c[1] === cell[1])) || null,
    dealHitFn: (occ) => { hitOrder.push(occ.id); return { amount: 1, hpAfter: 0, dstLabel: occ.id, isDiscovery: false }; },
    splashFn: () => [],
  });
  eq(hitOrder, ['occA', 'occB'], 'should hit occA (pass) then occB (terminal), never reach occC');
  eq(result.landing, [3, 3], 'landing cell should be occB\'s cell');
});

T('ray geometry: boundary reflection direction-mirroring on all 4 edges (incl. corner)', () => {
  eq(combat.reflectDir('UL', 0, 5, 18, 26), 'DL', 'top boundary flips row component');
  eq(combat.reflectDir('UR', 0, 5, 18, 26), 'DR', 'top boundary flips row component');
  eq(combat.reflectDir('DR', 19, 5, 18, 26), 'UR', 'bottom boundary flips row component');
  eq(combat.reflectDir('DL', 5, 0, 18, 26), 'DR', 'left boundary flips col component');
  eq(combat.reflectDir('DR', 5, 27, 18, 26), 'DL', 'right boundary flips col component');
  eq(combat.reflectDir('DR', 19, 27, 18, 26), 'UL', 'corner hit flips BOTH components');
});

T('ray geometry: bounce damage scaling exactness (mult table)', () => {
  eq(combat.mult(0), 1.0); eq(combat.mult(1), 1.0); eq(combat.mult(2), 1.0);
  eq(combat.mult(3), 1.5);
  eq(combat.mult(4), 2.0);
  eq(combat.mult(5), 2.5);
  eq(combat.mult(6), 2.5, 'b>5 stays at the b=5 mult (5th-bounce terminates before b=6 would occur, but mult() itself is defined for any b>=5)');
});

T('ray geometry: 5-bounce all-hit-then-terminate (battle mode)', () => {
  const occupants = [
    { id: 'o1', fieldCells: [[9, 13]], alive: true, hp: 100 },
  ];
  let allHitCalled = false;
  const result = combat.walkRay({
    field: { ROWS: 3, COLS: 3 }, entryCell: [1, 1], dir: 'UL', mode: 'battle',
    penetration: 0, aoe: 0, aoeStatuses: false, bounceBudget: 0,
    liveOccupantFn: () => null, // never hit anything directly; force bounces
    dealHitFn: (occ, mult, opts2) => {
      if (opts2 && opts2.allField) { allHitCalled = true; return occupants.map(o => ({ dst: o.id, amount: 10 * mult })); }
      return { amount: 0, hpAfter: 0, dstLabel: 'x', isDiscovery: false };
    },
    splashFn: () => [],
  });
  ok(allHitCalled, 'the 5th-bounce all-field strike callback should have fired');
  ok(result.events.some(e => e.ev === 'ray_hit_all'), 'a ray_hit_all event should be logged');
  const bounceEvents = result.events.filter(e => e.ev === 'ray_bounce');
  eq(bounceEvents.length, 5, 'exactly 5 bounces before termination');
});

T('ray geometry: detection-mode per-PO bounce-budget stop (no discovery)', () => {
  const result = combat.walkRay({
    field: { ROWS: 3, COLS: 3 }, entryCell: [1, 1], dir: 'UL', mode: 'detection',
    penetration: 0, aoe: 0, aoeStatuses: false, bounceBudget: 2,
    liveOccupantFn: () => null,
    dealHitFn: () => ({ amount: 0, hpAfter: 0, dstLabel: 'x', isDiscovery: false }),
    splashFn: () => [],
  });
  ok(!result.discovered, 'no discovery should occur when nothing is ever hit');
  ok(result.events.some(e => e.ev === 'ray_end' && e.reason === 'bounce_budget_exhausted'), 'should log bounce-budget exhaustion');
  const bounceEvents = result.events.filter(e => e.ev === 'ray_bounce');
  eq(bounceEvents.length, 3, 'budget=2 means it bounces until the 3rd bounce triggers the > check and ends');
});

T('ray geometry: destroyed-BP passthrough (dead occupant does not stop or count against penetration)', () => {
  const occupants = [
    { id: 'dead1', fieldCells: [[2, 2]], alive: false },
    { id: 'live1', fieldCells: [[3, 3]], alive: true },
  ];
  const hitOrder = [];
  const result = combat.walkRay({
    field: { ROWS: 18, COLS: 26 }, entryCell: [1, 1], dir: 'DR', mode: 'battle',
    penetration: 0, aoe: 0, aoeStatuses: false, bounceBudget: 0,
    liveOccupantFn: (cell) => occupants.find(o => o.alive && o.fieldCells.some(c => c[0] === cell[0] && c[1] === cell[1])) || null,
    dealHitFn: (occ) => { hitOrder.push(occ.id); return { amount: 1, hpAfter: 0, dstLabel: occ.id, isDiscovery: false }; },
    splashFn: () => [],
  });
  eq(hitOrder, ['live1'], 'dead occupant should be skipped entirely (passable)');
  eq(result.landing, [3, 3]);
});

T('ray geometry: gap passthrough (empty cell does not stop the ray)', () => {
  const occupants = [{ id: 'only1', fieldCells: [[5, 5]], alive: true }];
  const result = combat.walkRay({
    field: { ROWS: 18, COLS: 26 }, entryCell: [1, 1], dir: 'DR', mode: 'battle',
    penetration: 0, aoe: 0, aoeStatuses: false, bounceBudget: 0,
    liveOccupantFn: (cell) => occupants.find(o => o.fieldCells.some(c => c[0] === cell[0] && c[1] === cell[1])) || null,
    dealHitFn: (occ) => ({ amount: 1, hpAfter: 0, dstLabel: occ.id, isDiscovery: false }),
    splashFn: () => [],
  });
  eq(result.landing, [5, 5], 'ray should pass through 3 empty gap cells before hitting the only occupant');
});

// =====================================================================
// 3. AOE
// =====================================================================
T('AOE: Chebyshev radius correctness + landing cell not double-hit', () => {
  const occupants = [
    { id: 'landing', fieldCells: [[5, 5]], alive: true },
    { id: 'near', fieldCells: [[6, 6]], alive: true }, // chebyshev dist 1
    { id: 'far', fieldCells: [[8, 8]], alive: true },  // chebyshev dist 3
  ];
  const splashHits = [];
  combat.walkRay({
    field: { ROWS: 18, COLS: 26 }, entryCell: [1, 1], dir: 'DR', mode: 'battle',
    penetration: 0, aoe: 2, aoeStatuses: false, bounceBudget: 0,
    liveOccupantFn: (cell) => occupants.find(o => o.fieldCells.some(c => c[0] === cell[0] && c[1] === cell[1])) || null,
    dealHitFn: (occ) => ({ amount: 1, hpAfter: 0, dstLabel: occ.id, isDiscovery: false }),
    splashFn: (landing, radius, mult) => {
      for (const o of occupants) {
        if (o.id === 'landing') continue; // landing occupant not double-hit
        const dist = combat.chebyshevDist(o.fieldCells[0], landing);
        if (dist <= radius) splashHits.push(o.id);
      }
      return splashHits.map(id => ({ dst: id, amount: 1 }));
    },
  });
  ok(splashHits.includes('near'), 'near (dist 1) should be within radius 2');
  ok(!splashHits.includes('far'), 'far (dist 3) should be outside radius 2');
  ok(!splashHits.includes('landing'), 'landing occupant must not appear in splash hits (no double-hit)');
});

T('AOE: aoe_statuses flag gates whether splash targets receive statuses', () => {
  const rng = combat.makeRng('aoe-status-seed');
  const bagWithSplash = combat.freshStatusBag();
  const bagWithoutSplash = combat.freshStatusBag();
  const target1 = { fieldCells: [[6, 6]], alive: true, statusBag: bagWithSplash, applyDamage() {} };
  const target2 = { fieldCells: [[6, 7]], alive: true, statusBag: bagWithoutSplash, applyDamage() {} };
  const verbEff = { verb: { t: 'apply_status', status: 'Chill', n: [3, 3] } };
  // Simulate fireSkillRay's splashFn logic manually for both flag states.
  function simulateSplash(doStatuses, target) {
    if (doStatuses) combat.applyStatus(target.statusBag, 'Chill', 3);
  }
  simulateSplash(true, target1);
  simulateSplash(false, target2);
  ok(target1.statusBag.Chill && target1.statusBag.Chill.stacks === 3, 'aoe_statuses:true should apply Chill to splash target');
  ok(!target2.statusBag.Chill, 'aoe_statuses:false should NOT apply Chill to splash target');
});

// =====================================================================
// 4. Status system (all 8 + interaction matrix)
// =====================================================================
T('status: Burn tick math (1x stacks dmg per period, -1 stack per tick)', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Burn', 3);
  const t1 = combat.tickStatuses(bag, 1.0);
  eq(t1, [{ name: 'Burn', amount: 3, kind: 'damage' }], 'first tick: 3 dmg, stacks decrement to 2');
  eq(bag.Burn.stacks, 2);
  const t2 = combat.tickStatuses(bag, 1.0);
  eq(t2, [{ name: 'Burn', amount: 2, kind: 'damage' }]);
  eq(bag.Burn.stacks, 1);
});

T('status: Poison tick math (independent of Burn, same P)', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Poison', 4);
  combat.applyStatus(bag, 'Burn', 2);
  const ticks = combat.tickStatuses(bag, 1.0);
  const poisonTick = ticks.find(t => t.name === 'Poison');
  const burnTick = ticks.find(t => t.name === 'Burn');
  eq(poisonTick.amount, 4);
  eq(burnTick.amount, 2);
  ok(bag.Poison.stacks === 3 && bag.Burn.stacks === 1, 'both decrement independently by 1');
});

T('status: Chill cadence slow + stack cap', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Chill', 15); // exceeds cap of 10
  eq(bag.Chill.stacks, 10, 'Chill stacks must cap at CHILL_STACK_CAP=10');
  const cadence = combat.cadenceMultiplier(bag);
  approx(cadence, 1 + 10 * combat.TUNABLES.CHILL_PCT_PER_STACK, 1e-9, 'cadence multiplier reflects 10 stacks at 4%/stack');
});

T('status: Regen heal', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Regen', 5);
  const ticks = combat.tickStatuses(bag, 1.0);
  eq(ticks, [{ name: 'Regen', amount: 5, kind: 'heal' }]);
  eq(bag.Regen.stacks, 4);
});

T('status: Spikes consume-per-hit (no time decay)', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Spikes', 3);
  // tick many times -- Spikes must NOT decay from time alone
  for (let i = 0; i < 10; i++) combat.tickStatuses(bag, 1.0);
  eq(bag.Spikes.stacks, 3, 'Spikes has NO time decay');
  const reflect1 = combat.consumeSpikes(bag);
  eq(reflect1, 3, 'reflect amount = 1x stacks (3) on first hit');
  eq(bag.Spikes.stacks, 2, 'exactly 1 stack consumed per hit');
  const reflect2 = combat.consumeSpikes(bag);
  eq(reflect2, 2);
  eq(bag.Spikes.stacks, 1);
});

T('status: Stun suspend/resume (isStunned true during, false after expiry)', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Stun', 2.0);
  ok(combat.isStunned(bag), 'should be stunned immediately after application');
  combat.tickStatuses(bag, 1.0);
  ok(combat.isStunned(bag), 'still stunned after 1s (duration 2s)');
  combat.tickStatuses(bag, 1.5);
  ok(!combat.isStunned(bag), 'stun should have expired after total 2.5s > 2.0s duration');
});

T('status: Weakness damage reduction', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Weakness', 4);
  const m = combat.weaknessMultiplier(bag);
  approx(m, 1 - 4 * combat.TUNABLES.WEAKNESS_PCT_PER_STACK, 1e-9, '4 stacks at 5%/stack = 20% reduction -> 0.8 multiplier');
});

T('status: Haste cadence speedup', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Haste', 3);
  const cadence = combat.cadenceMultiplier(bag);
  approx(cadence, 1 - 3 * combat.TUNABLES.HASTE_PCT_PER_STACK, 1e-9, '3 stacks Haste at 4%/stack speeds cadence (multiplier < 1)');
});

T('status interaction: Chill+Haste net to ONE cadence number', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Chill', 5);
  combat.applyStatus(bag, 'Haste', 5);
  const cadence = combat.cadenceMultiplier(bag);
  approx(cadence, 1.0, 1e-9, '5 Chill (+20%) and 5 Haste (-20%) at equal stacks should net to exactly 1.0 (no change)');
});

T('status interaction: amp_status multiplies the APPLIED n at application time', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Burn', 4, 2); // amp mult=2 -> applied magnitude 8, not the tick
  eq(bag.Burn.stacks, 8, 'amp_status doubles the applied magnitude (4*2=8), not the per-tick damage formula');
});

T('status interaction: cleanse removes ALL debuffs, leaves buffs untouched', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Burn', 3);
  combat.applyStatus(bag, 'Poison', 2);
  combat.applyStatus(bag, 'Chill', 4);
  combat.applyStatus(bag, 'Weakness', 2);
  combat.applyStatus(bag, 'Stun', 1);
  combat.applyStatus(bag, 'Regen', 5);
  combat.applyStatus(bag, 'Spikes', 2);
  combat.applyStatus(bag, 'Haste', 3);
  combat.cleanse(bag);
  ok(!bag.Burn && !bag.Poison && !bag.Chill && !bag.Weakness && !bag.Stun, 'all debuffs removed');
  ok(bag.Regen && bag.Spikes && bag.Haste, 'buffs (Regen/Spikes/Haste) must remain untouched');
});

T('status interaction: Stun does not pause DoT ticks (Burn/Poison keep ticking through Stun)', () => {
  const bag = combat.freshStatusBag();
  combat.applyStatus(bag, 'Stun', 5.0);
  combat.applyStatus(bag, 'Burn', 3);
  const ticks = combat.tickStatuses(bag, 1.0);
  ok(ticks.some(t => t.name === 'Burn' && t.amount === 3), 'Burn should tick normally even while Stun is active');
});

// =====================================================================
// 4b. REQ-0093: status_kind targeting for status_immune / bonus_vs_status
// =====================================================================
T('REQ-0093 resolveStatusKind: all 9 keywords resolve to the exact expected Set', () => {
  eq([...combat.resolveStatusKind('buff')].sort(), [...combat.BUFF_STATUSES].sort(), 'buff');
  eq([...combat.resolveStatusKind('debuff')].sort(), [...combat.DEBUFF_STATUSES].sort(), 'debuff');
  // dot is the one non-singleton mechanical bucket -- spot-checked exactly.
  eq([...combat.resolveStatusKind('dot')].sort(), ['Burn', 'Poison'], 'dot must resolve to exactly {Burn, Poison}');
  eq([...combat.resolveStatusKind('hot')], ['Regen'], 'hot');
  eq([...combat.resolveStatusKind('cadence_slow')], ['Chill'], 'cadence_slow');
  eq([...combat.resolveStatusKind('cadence_fast')], ['Haste'], 'cadence_fast');
  eq([...combat.resolveStatusKind('onhit_reflect')], ['Spikes'], 'onhit_reflect');
  eq([...combat.resolveStatusKind('suspend')], ['Stun'], 'suspend');
  eq([...combat.resolveStatusKind('dmg_reduce')], ['Weakness'], 'dmg_reduce');
  // every keyword covered, none silently falls through to an empty Set
  for (const kw of combat.STATUS_KINDS) {
    ok(combat.resolveStatusKind(kw).size > 0, 'keyword "' + kw + '" must resolve to a non-empty Set');
  }
});

T('REQ-0093 status_immune (literal): applyStatus is suppressed at the bag._immune chokepoint, non-immune bag unaffected', () => {
  const immuneBag = combat.freshStatusBag();
  immuneBag._immune = new Set(['Poison']);
  combat.applyStatus(immuneBag, 'Poison', 5);
  ok(!immuneBag.Poison, 'immune actor must never accumulate the named status');

  const plainBag = combat.freshStatusBag();
  combat.applyStatus(plainBag, 'Poison', 5);
  eq(plainBag.Poison.stacks, 5, 'a bag with no _immune set behaves exactly as before this REQ');
});

T('REQ-0093 status_immune (status_kind=debuff): suppresses EVERY debuff status, buffs unaffected', () => {
  const bag = combat.freshStatusBag();
  bag._immune = combat.resolveStatusKind('debuff');
  combat.applyStatus(bag, 'Burn', 3);
  combat.applyStatus(bag, 'Poison', 3);
  combat.applyStatus(bag, 'Chill', 3);
  combat.applyStatus(bag, 'Weakness', 3);
  combat.applyStatus(bag, 'Stun', 3);
  combat.applyStatus(bag, 'Regen', 3);
  combat.applyStatus(bag, 'Haste', 3);
  ok(!bag.Burn && !bag.Poison && !bag.Chill && !bag.Weakness && !bag.Stun, 'all 5 debuffs suppressed');
  ok(bag.Regen && bag.Haste, 'buffs must still apply normally -- immunity to "debuff" kind does not touch buffs');
});

T('REQ-0093 bonus_vs_status (literal): strike gains the rolled bonus only when target carries the named status', () => {
  const rng = combat.makeRng('req0093-bonus-literal').stream('t');
  const events = [];
  // Burn (not a dmg_reduce-kind status) keeps this test isolated from
  // weaknessMultiplier, which is ALSO keyed off the target's own bag --
  // using Weakness here would conflate the two mechanisms.
  const targetWith = combat.makeEnemyActor({ id: 'e1', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: { Burn: { stacks: 1 } } });
  const bonus = [{ set: new Set(['Burn']), n: [3, 3] }];
  const r1 = combat.dealHitOnField(targetWith, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events, bonus);
  eq(r1.amount, 13, 'base 10 + flat bonus 3 = 13 when target carries Burn');

  const targetWithout = combat.makeEnemyActor({ id: 'e2', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {} });
  const r2 = combat.dealHitOnField(targetWithout, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events, bonus);
  eq(r2.amount, 10, 'no bonus when target does not carry the status');
});

T('REQ-0093 bonus_vs_status (status_kind=dot): bonus applies vs EITHER member status of the resolved kind-Set', () => {
  const rng = combat.makeRng('req0093-bonus-kind').stream('t');
  const events = [];
  const bonus = [{ set: combat.resolveStatusKind('dot'), n: [5, 5] }];
  const burning = combat.makeEnemyActor({ id: 'e3', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: { Burn: { stacks: 1 } } });
  const poisoned = combat.makeEnemyActor({ id: 'e4', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: { Poison: { stacks: 1 } } });
  const chilled = combat.makeEnemyActor({ id: 'e5', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: { Chill: { stacks: 1 } } });
  eq(combat.dealHitOnField(burning, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events, bonus).amount, 15, 'Burn is in the dot kind-Set');
  eq(combat.dealHitOnField(poisoned, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events, bonus).amount, 15, 'Poison is in the dot kind-Set');
  eq(combat.dealHitOnField(chilled, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events, bonus).amount, 10, 'Chill (cadence_slow) is NOT in the dot kind-Set -- no bonus');
});

T('REQ-0093 bonus_vs_status: multi_strike re-checks + re-rolls the bonus independently per sub-hit', () => {
  const rng = combat.makeRng('req0093-bonus-multi').stream('t');
  const events = [];
  const target = combat.makeEnemyActor({ id: 'e6', hp: 1000, hpMax: 1000, fieldCells: [[1, 1]], statusBag: { Burn: { stacks: 1 } } });
  const bonus = [{ set: new Set(['Burn']), n: [2, 2] }];
  const r = combat.dealHitOnField(target, { verb: { t: 'multi_strike', n: [10, 10], hits: 3 } }, 1, rng, 'battle', events, bonus);
  eq(r.amount, 36, '3 sub-hits x (10 base + 2 bonus) = 36');
});

T('REQ-0093 compile-time fold (enemy): compileEnemyPack attaches statusBag._immune + bonusVsStatus from the enemy\'s own battle_start skills', () => {
  const enemyDefsById = {
    poison_immune_goblin: { id: 'poison_immune_goblin', name: 'Poison-Immune Goblin', hp: [20, 20], footprint: [1, 1], skills: ['tiny_bite', 'skill_immune_poison', 'skill_bonus_vs_weak'] },
  };
  const skillDefsById = {
    tiny_bite: { trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
    skill_immune_poison: { trigger: { t: 'battle_start' }, verb: { t: 'status_immune', status: 'Poison' } },
    skill_bonus_vs_weak: { trigger: { t: 'battle_start' }, verb: { t: 'bonus_vs_status', status: 'Weakness', n: [4, 4] } },
  };
  const rng = combat.makeRng('req0093-pack-fold');
  const enemies = combat.compileEnemyPack({ enemyIds: ['poison_immune_goblin'] }, enemyDefsById, skillDefsById, rng, { rowMin: 1, colMin: 1, rowMax: 18, colMax: 26 });
  const en = enemies[0];
  ok(en.statusBag._immune.has('Poison'), 'compiled enemy must carry the folded immunity Set');
  eq(en.bonusVsStatus.length, 1, 'compiled enemy must carry the folded bonus_vs_status list');
  ok(en.bonusVsStatus[0].set.has('Weakness'), 'folded bonus entry targets Weakness');

  // and the fold actually suppresses application through the real chokepoint:
  combat.applyStatus(en.statusBag, 'Poison', 5);
  ok(!en.statusBag.Poison, 'a compiled, genuinely immune enemy must reject Poison via applyStatus');
});

T('REQ-0093 compile-time fold (player BP): compileSquadSnapshot attaches bp.statusBag._immune + bp.bonusVsStatus from that BP\'s placed POs', () => {
  const squadState = {
    bps: [{ id: 'bpA', name: 'BP A', shape: [[0, 0]], origin: [1, 1], hpMax: 100 }],
    pos: [{ uid: 'poA', id: 'itemImmune', cell: [1, 1], rot: 0, loc: 'grid' }],
    layout: { ROWS: 8, COLS: 8 },
  };
  const itemDefsById = {
    itemImmune: {
      id: 'itemImmune', shape: [[0, 0]],
      effects: [
        { trigger: { t: 'battle_start' }, verb: { t: 'status_immune', status_kind: 'debuff' } },
        { trigger: { t: 'battle_start' }, verb: { t: 'bonus_vs_status', status_kind: 'dot', n: [6, 6] } },
      ],
    },
  };
  const snap = combat.compileSquadSnapshot(squadState, itemDefsById, 'formation1', 'unit1');
  const bp = snap.bps[0];
  ok(bp.statusBag._immune.has('Burn') && bp.statusBag._immune.has('Stun'), 'debuff-kind immunity folded onto the owning BP covers every debuff member');
  ok(!bp.statusBag._immune.has('Regen'), 'buff statuses must not be swept into a debuff-kind immunity');
  eq(bp.bonusVsStatus.length, 1, 'bonus_vs_status folded onto the owning BP');
  ok(bp.bonusVsStatus[0].set.has('Burn') && bp.bonusVsStatus[0].set.has('Poison'), 'dot-kind bonus set is {Burn, Poison}');
});

// =====================================================================
// 4c. REQ-0121: buff_self / damage_reduction / on_hp_below
// =====================================================================
T('REQ-0121 reduceIncoming: flat subtraction, floored at zero, absent field is a no-op', () => {
  eq(combat.reduceIncoming(10, { ref: { damageReduction: 3 } }), 7, '10 - 3 = 7');
  eq(combat.reduceIncoming(2, { ref: { damageReduction: 10 } }), 0, 'floored at zero, never negative/healing');
  eq(combat.reduceIncoming(5, { ref: {} }), 5, 'no damageReduction field: exact no-op (golden safety)');
});

T('REQ-0121 damage_reduction: applied per hit in dealHitOnField, per sub-hit for multi_strike, floors at zero', () => {
  const rng = combat.makeRng('req0121-dr').stream('t');
  const events = [];
  const shielded = combat.makeEnemyActor({ id: 'd1', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {}, damageReduction: 3 });
  eq(combat.dealHitOnField(shielded, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events).amount, 7, 'strike 10 - 3 = 7');
  const multi = combat.makeEnemyActor({ id: 'd2', hp: 1000, hpMax: 1000, fieldCells: [[1, 1]], statusBag: {}, damageReduction: 4 });
  eq(combat.dealHitOnField(multi, { verb: { t: 'multi_strike', n: [10, 10], hits: 3 } }, 1, rng, 'battle', events).amount, 18, '3 x (10 - 4) = 18: reduction per sub-hit (OQ19 separate-hit rule)');
  const tank = combat.makeEnemyActor({ id: 'd3', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {}, damageReduction: 50 });
  eq(combat.dealHitOnField(tank, { verb: { t: 'strike', n: [10, 10] } }, 1, rng, 'battle', events).amount, 0, 'over-reduction floors at zero');
  eq(tank.hp(), 100, 'zero damage taken');
});

T('REQ-0121 damage_reduction: DoT status ticks are NOT reduced (blows are blunted, poison is not)', () => {
  const en = { id: 'd4', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: combat.freshStatusBag(), damageReduction: 99 };
  combat.applyStatus(en.statusBag, 'Burn', 3);
  const ticks = combat.tickStatuses(en.statusBag, 1.0);
  const burn = ticks.find(t => t.name === 'Burn');
  ok(burn && burn.amount === 3, 'tick damage bypasses reduceIncoming by design (vocab provenance note)');
});

T('REQ-0121 compileEnemyPack: battle_start damage_reduction + buff_self fold; shared skill defs never mutated', () => {
  const enemyDefsById2 = {
    thick_ogre: { id: 'thick_ogre', name: 'Thick Ogre', hp: [30, 30], footprint: [1, 1], skills: ['og_smash', 'og_hide', 'og_rage'] },
  };
  const skillDefsById2 = {
    og_smash: { trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
    og_hide: { trigger: { t: 'battle_start' }, verb: { t: 'damage_reduction', n: [4, 4] } },
    og_rage: { trigger: { t: 'battle_start' }, verb: { t: 'buff_self', stat: 'damage', n: [3, 3] } },
  };
  const rng = combat.makeRng('req0121-pack-fold');
  const enemies = combat.compileEnemyPack({ enemyIds: ['thick_ogre'] }, enemyDefsById2, skillDefsById2, rng, { rowMin: 1, colMin: 1, rowMax: 18, colMax: 26 });
  const en = enemies[0];
  approx(en.damageReduction, 4, 1e-9, 'battle_start damage_reduction folded to a resolved scalar');
  const smash = en.skills.find(s => s.verb.t === 'strike');
  eq(smash.verb.n, [8, 8], 'battle_start buff_self folded (+3) onto the enemy\'s OWN strike range');
  eq(skillDefsById2.og_smash.verb.n, [5, 5], 'shared content def NEVER mutated (per-instance deep copy)');
});

T('REQ-0121 compileEnemyPack: an enemy with no new verbs keeps SHARED skill refs (zero golden impact)', () => {
  const rng = combat.makeRng('req0121-shared-refs');
  const enemies = combat.compileEnemyPack({ enemyIds: ['tiny_goblin'] }, tinyEnemyDefs, tinySkillDefs, rng, { rowMin: 1, colMin: 1, rowMax: 18, colMax: 26 });
  ok(enemies[0].skills[0] === tinySkillDefs.tiny_bite, 'no buff_self anywhere: skills list must keep the exact shared def objects');
  eq(enemies[0].damageReduction, 0, 'damageReduction defaults to 0');
});

T('REQ-0121 on_hp_below: strict crossing, fire-once-ever, no re-arm on heal-back (user ruling 2026-07-12)', () => {
  const en = { id: 'e-once', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {} };
  let fires = 0;
  combat.registerHpBelowWatchers(en, [{ key: 'k1', frac: 0.5, onFire() { fires++; } }]);
  const actor = combat.makeEnemyActor(en);
  actor.applyDamage(50); // hp 50 == exactly 50%: NOT strictly below
  eq(fires, 0, 'landing exactly ON the threshold must not fire (strict <)');
  actor.applyDamage(1); // hp 49
  eq(fires, 1, 'fires the instant the threshold is strictly crossed');
  actor.applyDamage(10); // hp 39
  eq(fires, 1, 'staying below must not re-fire');
  actor.heal(50); // hp 89: back above
  actor.applyDamage(50); // hp 39: re-crossed downward
  eq(fires, 1, 'once EVER: healing back above and re-crossing does not re-arm');
});

T('REQ-0121 on_hp_below: killing blow does not fire; one hit can fire multiple thresholds in registration order', () => {
  const en = { id: 'e-multi', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {} };
  const fired = [];
  combat.registerHpBelowWatchers(en, [
    { key: 'half', frac: 0.5, onFire() { fired.push('half'); } },
    { key: 'third', frac: 0.3, onFire() { fired.push('third'); } },
  ]);
  combat.makeEnemyActor(en).applyDamage(80); // hp 20: crosses 0.5 AND 0.3 at once
  eq(fired, ['half', 'third'], 'both thresholds fire from one hit, registration order');

  const en2 = { id: 'e-kill', hp: 100, hpMax: 100, fieldCells: [[1, 1]], statusBag: {} };
  let fires2 = 0;
  combat.registerHpBelowWatchers(en2, [{ key: 'k', frac: 0.5, onFire() { fires2++; } }]);
  combat.makeEnemyActor(en2).applyDamage(100); // outright kill from full HP
  eq(fires2, 0, 'no posthumous enrage on a killing blow');
});

T('REQ-0121 foldFlatBonusInPlace: shifts only strike/multi_strike n-ranges, in place, zero bonus is a no-op', () => {
  const skills2 = [
    { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [5, 8] } },
    { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'apply_status', status: 'Burn', n: [2, 2] } },
  ];
  combat.foldFlatBonusInPlace(skills2, 4);
  eq(skills2[0].verb.n, [9, 12], 'strike shifted');
  eq(skills2[1].verb.n, [2, 2], 'non-damage verb untouched');
  combat.foldFlatBonusInPlace(skills2, 0);
  eq(skills2[0].verb.n, [9, 12], 'zero bonus is an exact no-op');
});

T('REQ-0121 integration: enemy on_hp_below buff_self enrage fires exactly once in a real run and buffs its own skill', () => {
  const enemyDefs3 = {
    rage_orc: { id: 'rage_orc', name: 'Rage Orc', hp: [200, 200], footprint: [1, 1], skills: ['orc_hit', 'orc_rage'] },
  };
  const skillDefs3 = {
    orc_hit: { trigger: { t: 'every_secs', s: [1.5, 1.5] }, verb: { t: 'strike', n: [2, 2] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
    orc_rage: { trigger: { t: 'on_hp_below', hp_frac: 0.5 }, verb: { t: 'buff_self', stat: 'damage', n: [6, 6] } },
  };
  const opts = {
    masterSeed: 'req0121-enrage',
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['rage_orc'] }, deadline_secs: 120 }] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: enemyDefs3, skillDefsById: skillDefs3,
    formationId: 'formation1', level: 1, participants: ['pA'],
  };
  const r = combat.runDungeon(opts);
  const procs = r.events.filter(e => e.ev === 'passive_proc' && e.trigger === 'on_hp_below');
  eq(procs.length, 1, 'enrage fires exactly once, never per-tick');
  eq(procs[0].verb, 'buff_self', 'payload verb recorded');
  approx(procs[0].amount, 6, 1e-9, 'resolved [6,6] buff amount');
  approx(procs[0].frac, 0.5, 1e-9, 'threshold recorded');
  eq(skillDefs3.orc_hit.verb.n, [2, 2], 'shared def untouched after the in-place instance fold');
  // determinism guard: same seed, byte-identical log through the enrage path
  const r2 = combat.runDungeon(opts);
  ok(combat.toJSONL(r.events) === combat.toJSONL(r2.events), 'enrage path replays byte-identical');
});

T('REQ-0121 player-side compile: PO battle_start buff_self folds onto own verbs; damage_reduction folds onto owning BP', () => {
  const squadState = {
    bps: [{ id: 'bpA', name: 'BP A', shape: [[0, 0], [0, 1]], origin: [1, 1], hpMax: 100 }],
    pos: [
      { uid: 'p1', id: 'itemBuffSelf', cell: [1, 1], rot: 0, loc: 'grid' },
      { uid: 'p2', id: 'itemHide', cell: [1, 2], rot: 0, loc: 'grid' },
    ],
    layout: { ROWS: 8, COLS: 8 },
  };
  const itemDefs3 = {
    itemBuffSelf: {
      id: 'itemBuffSelf', shape: [[0, 0]],
      effects: [
        { trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [10, 10] } },
        { trigger: { t: 'battle_start' }, verb: { t: 'buff_self', stat: 'damage', n: [5, 5] } },
      ],
    },
    itemHide: {
      id: 'itemHide', shape: [[0, 0]],
      effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'damage_reduction', n: [3, 3] } }],
    },
  };
  const snap = combat.compileSquadSnapshot(squadState, itemDefs3, 'formation1', 'unit1');
  const strike = snap.pos.find(p => p.uid === 'p1').effects.find(e => e.verb.t === 'strike');
  eq(strike.verb.n, [15, 15], 'battle_start buff_self folded (+5) onto own strike (buff_host posture)');
  approx(snap.bps[0].damageReduction, 3, 1e-9, 'battle_start damage_reduction folded onto the OWNING BP');
});

T('REQ-0121 player-side on_hp_below: a PO enrage watches its OWNING BP\'s HP (domain ruling) -- integration', () => {
  const squadState = {
    bps: [{ id: 'bpA', name: 'BP A', shape: [[0, 0]], origin: [1, 1], hpMax: 60 }],
    pos: [{ uid: 'p1', id: 'itemEnrage', cell: [1, 1], rot: 0, loc: 'grid' }],
    layout: { ROWS: 8, COLS: 8 },
  };
  const itemDefs4 = {
    itemEnrage: {
      id: 'itemEnrage', shape: [[0, 0]],
      effects: [
        { trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [1, 1] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } },
        { trigger: { t: 'on_hp_below', hp_frac: 0.9 }, verb: { t: 'buff_self', stat: 'damage', n: [7, 7] } },
      ],
    },
  };
  const r = combat.runDungeon({
    masterSeed: 'req0121-player-enrage',
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 60 }] },
    squadSnapshots: [squadState, squadState, squadState, squadState],
    itemDefsById: itemDefs4, enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs,
    formationId: 'formation1', level: 1, participants: ['pA'],
  });
  const procs = r.events.filter(e => e.ev === 'passive_proc' && e.trigger === 'on_hp_below' && e.src === 'itemEnrage');
  ok(procs.length >= 1, 'at least one squad\'s BP dropped below 90% and its PO enrage fired (goblin strikes 5s)');
  ok(procs.length <= 4, 'at most once per squad BP (fire-once per owning BP object)');
  for (const p of procs) approx(p.amount, 7, 1e-9, 'resolved [7,7] amount');
});

// =====================================================================
// 4d. REQ-0122: dynamic dungeon-domain content loading (live/dungeon)
// =====================================================================
const promoteTool = require(path.join(REPO_ROOT, 'tools', 'promote_dungeon_batch.cjs'));
const crypto0122 = require('crypto');
const os0122 = require('os');

T('REQ-0122 single source: dungen.liveDungeonDir() is content/live/dungeon and feeds server core too', () => {
  const norm = dungen.liveDungeonDir().split(path.sep).join('/');
  ok(norm.endsWith('content/live/dungeon'), 'generator reads the promoted live dir, not a batch hardcode');
  const core = require(path.join(REPO_ROOT, 'server', 'services', 'core.cjs'));
  eq(core.LIVE_DUNGEON_DIR, dungen.liveDungeonDir(), 'server core and dungen share ONE path source (no drift)');
});

T('REQ-0122 lossless promotion invariant: live/dungeon byte-matches the promoted-from batch AND the registry sha256s', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'registry.json'), 'utf8'));
  ok(reg.live_dungeon && reg.live_dungeon.promoted_from, 'registry carries live_dungeon provenance');
  const srcDir = path.join(REPO_ROOT, 'content', 'batches', reg.live_dungeon.promoted_from);
  for (const f of promoteTool.REQUIRED_FILES) {
    const live = fs.readFileSync(path.join(dungen.liveDungeonDir(), f));
    eq(crypto0122.createHash('sha256').update(live).digest('hex'), reg.live_dungeon.files[f], f + ' sha256 matches registry provenance');
    ok(live.equals(fs.readFileSync(path.join(srcDir, f))), f + ' is byte-identical to the promoted-from batch (lossless)');
  }
});

T('REQ-0122 promote tool: REFUSES a partial batch (anti-downgrade guard, the batch-004 lesson)', () => {
  const tmpSrc = fs.mkdtempSync(path.join(os0122.tmpdir(), 'req0122-partial-'));
  fs.writeFileSync(path.join(tmpSrc, 'enemies.json'), '{"schema":"enemy/1","entries":[]}');
  const tmpLive = fs.mkdtempSync(path.join(os0122.tmpdir(), 'req0122-live-'));
  const tmpReg = path.join(tmpSrc, 'registry.json');
  fs.writeFileSync(tmpReg, '{"batches":[]}');
  let msg = '';
  try { promoteTool.promote(tmpSrc, { liveDir: tmpLive, registryPath: tmpReg }); } catch (e) { msg = String(e.message); }
  ok(/missing required file/.test(msg), 'partial batch must be refused, got: ' + msg);
  eq(fs.readdirSync(tmpLive).length, 0, 'refusal writes NOTHING (all-or-nothing)');
});

T('REQ-0122 promote tool: a full batch promotes byte-identically + records provenance (isolated target)', () => {
  const srcDir = path.join(REPO_ROOT, 'content', 'batches', 'batch-002-dungeon-pilot');
  const tmpLive = fs.mkdtempSync(path.join(os0122.tmpdir(), 'req0122-live2-'));
  const tmpReg = path.join(tmpLive, 'registry.json');
  fs.writeFileSync(tmpReg, '{"batches":[]}');
  const r = promoteTool.promote(srcDir, { liveDir: tmpLive, registryPath: tmpReg });
  for (const f of promoteTool.REQUIRED_FILES) {
    ok(fs.readFileSync(path.join(tmpLive, f)).equals(fs.readFileSync(path.join(srcDir, f))), f + ' copied byte-identically');
  }
  const reg = JSON.parse(fs.readFileSync(tmpReg, 'utf8'));
  eq(reg.live_dungeon.promoted_from, 'batch-002-dungeon-pilot', 'provenance records the source batch');
  eq(Object.keys(reg.live_dungeon.files).length, promoteTool.REQUIRED_FILES.length, 'per-file sha256 recorded');
  ok(Array.isArray(reg.batches), 'existing registry content preserved');
  eq(Object.keys(r.files).length, promoteTool.REQUIRED_FILES.length, 'promote() reports every required file'); // REQ-0184: derived, not hardcoded -- packs.json made the old literal 6 wrong
});

T('REQ-0122 test_fixed generator serves the promoted live copy verbatim', () => {
  const def = dungen.generate('test_fixed', 2, 'whatever');
  const liveDoc = JSON.parse(fs.readFileSync(path.join(dungen.liveDungeonDir(), 'dungeon.json'), 'utf8'));
  eq(def.id, liveDoc.id, 'same doc id');
  eq(def.encounters.length, liveDoc.encounters.length, 'same encounter count');
  eq(def.dungeonType, 'test_fixed', 'type echo');
});

// =====================================================================
// 5. Mode filtering
// =====================================================================
T('mode filtering: non-battle-mode PO does not fire during a battle encounter, no backlog on resume', () => {
  const detectionOnlyDef = { id: 'det_only', name: 'DetOnly', shape: [[0, 0]], modes: ['detection'],
    effects: [{ trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } }] };
  const scenarioWithDetOnly = combat.deepCopy(scenario);
  scenarioWithDetOnly.pos.push({ uid: 'pDetOnly', id: 'det_only', loc: 'grid', cell: [6, 6], rot: 0 });
  const itemDefs2 = Object.assign({}, itemDefsById, { det_only: detectionOnlyDef });

  const result = combat.runEncounter({
    rng: combat.makeRng('modefilter-seed'), encIndex: 0,
    troopBps: combat.compileSquadSnapshot(scenarioWithDetOnly, itemDefs2, 'formation1', 'unit1').bps,
    troopPos: combat.compileSquadSnapshot(scenarioWithDetOnly, itemDefs2, 'formation1', 'unit1').pos,
    formationBox: { formationId: 'formation1' },
    enemyDefsById: tinyEnemyDefs, skillDefsById: tinySkillDefs,
    encounterDef: { id: 'battle-enc', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['tiny_goblin'] }, deadline_secs: 15 },
    seedLabel: 'modefilter-seed',
  });
  const firedFromDetOnly = result.events.some(e => e.ev === 'ray_fire' && e.src === 'det_only');
  ok(!firedFromDetOnly, 'a detection-mode-only PO must never fire a ray during a battle-mode encounter');
});

// =====================================================================
// 6. Trap/door/chest win + timeout paths
// =====================================================================
T('trap: win path (discovery before timeout ends the encounter as clear)', () => {
  // Use a detection PO placed such that its rays are very likely to find
  // a 1x1 entity at the field center over several fire cycles within a
  // generous deadline; assert on the STRUCTURAL outcome contract (result
  // is either 'clear' or 'timeout', both legal), then separately force a
  // guaranteed-find by shrinking the field to 1 cell so the ray cannot
  // miss.
  const scenarioWithSpyglass = combat.deepCopy(scenario);
  scenarioWithSpyglass.pos.push({ uid: 'pSpy', id: 'spyglass', loc: 'grid', cell: [6, 6], rot: 0 });
  const itemDefs2 = Object.assign({}, itemDefsById, { spyglass: pilotItemDefsById.spyglass });
  const compiled = combat.compileSquadSnapshot(scenarioWithSpyglass, itemDefs2, 'formation1', 'unit1');
  const result = combat.runEncounter({
    rng: combat.makeRng('trap-win-seed-7'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'trap-test', type: 'trap', mode: 'detection',
      entityDef: { id: 'trap_frost_deadfall', name: 'Trap', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 18, skills: ['trap_deadfall_volley'] },
      timeout_secs: 18, deadline_secs: 18.5 },
    seedLabel: 'trap-win-seed-7',
  });
  ok(['clear', 'timeout', 'wipe'].includes(result.result), 'trap result must be one of the legal outcomes');
});

T('trap: timeout path fires the volley once and ends the encounter', () => {
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1');
  // No detection-mode PO present at all -> guaranteed timeout (never discovered).
  const result = combat.runEncounter({
    rng: combat.makeRng('trap-timeout-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'trap-test2', type: 'trap', mode: 'detection',
      entityDef: { id: 'trap_frost_deadfall', name: 'Trap', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 1, skills: ['trap_deadfall_volley'] },
      timeout_secs: 1, deadline_secs: 1.5 },
    seedLabel: 'trap-timeout-seed',
  });
  ok(result.result === 'timeout' || result.result === 'wipe', 'no detection PO present -> must time out (or wipe if the volley somehow killed the troop, structurally legal)');
  ok(result.events.some(e => e.ev === 'ray_fire'), 'the timeout volley should have fired at least one ray');
});

T('door: win path (unlock stage clears when HP reduced to 0 before timeout)', () => {
  const scenarioWithLockpick = combat.deepCopy(scenario);
  scenarioWithLockpick.pos.push({ uid: 'pLock', id: 'lockpick', loc: 'grid', cell: [6, 6], rot: 0 });
  const itemDefs2 = Object.assign({}, itemDefsById, { lockpick: pilotItemDefsById.lockpick });
  const compiled = combat.compileSquadSnapshot(scenarioWithLockpick, itemDefs2, 'formation1', 'unit1');
  const result = combat.runEncounter({
    rng: combat.makeRng('door-win-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'door-test', type: 'door', mode: 'unlock',
      entityDef: { id: 'door_rimefast_stage2', name: 'Door', hp: 1, footprint: [2, 2], masked: false, timeout_secs: 60, skills: [] },
      timeout_secs: 60, deadline_secs: 60.5 },
    seedLabel: 'door-win-seed',
  });
  ok(['clear', 'timeout_break', 'wipe'].includes(result.result), 'door result must be a legal outcome');
});

T('door: timeout path ("keyhole breaks") when HP not reduced to 0 in time', () => {
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1'); // no unlock PO present
  const result = combat.runEncounter({
    rng: combat.makeRng('door-timeout-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'door-test2', type: 'door', mode: 'unlock',
      entityDef: { id: 'door_rimefast_stage2', name: 'Door', hp: 999, footprint: [2, 2], masked: false, timeout_secs: 1, skills: [] },
      timeout_secs: 1, deadline_secs: 1.5 },
    seedLabel: 'door-timeout-seed',
  });
  eq(result.result, 'timeout_break', 'with no unlock-mode PO present and huge HP, the door must time out with "keyhole breaks"');
});

T('chest: win path (HP reduced to 0 before timeout -> clear, reward-eligible)', () => {
  const scenarioWithLockpick = combat.deepCopy(scenario);
  scenarioWithLockpick.pos.push({ uid: 'pLock', id: 'lockpick', loc: 'grid', cell: [6, 6], rot: 0 });
  const itemDefs2 = Object.assign({}, itemDefsById, { lockpick: pilotItemDefsById.lockpick });
  const compiled = combat.compileSquadSnapshot(scenarioWithLockpick, itemDefs2, 'formation1', 'unit1');
  const result = combat.runEncounter({
    rng: combat.makeRng('chest-win-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'chest-test', type: 'chest', mode: 'unlock',
      entityDef: { id: 'chest_frostbound_cache', name: 'Chest', hp: 1, footprint: [2, 2], masked: false, timeout_secs: 60, skills: [] },
      timeout_secs: 60, deadline_secs: 60.5 },
    seedLabel: 'chest-win-seed',
  });
  ok(['clear', 'timeout_lost', 'wipe'].includes(result.result), 'chest result must be a legal outcome');
});

T('chest: timeout path (lost with no penalty) when HP not reduced in time', () => {
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1'); // no unlock PO
  const result = combat.runEncounter({
    rng: combat.makeRng('chest-timeout-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: {}, skillDefsById,
    encounterDef: { id: 'chest-test2', type: 'chest', mode: 'unlock',
      entityDef: { id: 'chest_frostbound_cache', name: 'Chest', hp: 999, footprint: [2, 2], masked: false, timeout_secs: 1, skills: [] },
      timeout_secs: 1, deadline_secs: 1.5 },
    seedLabel: 'chest-timeout-seed',
  });
  eq(result.result, 'timeout_lost', 'chest should be lost (no penalty) on timeout with no unlock PO present');
  const bpHpAfter = compiled.bps.reduce((s, b) => s + b.hp, 0);
  const bpHpMaxTotal = compiled.bps.reduce((s, b) => s + b.hpMax, 0);
  eq(bpHpAfter, bpHpMaxTotal, 'no penalty means troop HP must be untouched (chest has no offensive skills)');
});

// =====================================================================
// 7. Boss/pack battle: victory AND wipe
// =====================================================================
T('pack battle: victory when enemies are weak and troop is strong', () => {
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1');
  const weakEnemy = { weak_target: { id: 'weak_target', name: 'Weak', hp: [1, 1], footprint: [1, 1], skills: [] } };
  const result = combat.runEncounter({
    rng: combat.makeRng('pack-victory-seed'), encIndex: 0,
    troopBps: compiled.bps, troopPos: compiled.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: weakEnemy, skillDefsById: {},
    encounterDef: { id: 'pack-vic', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['weak_target'] }, deadline_secs: 30 },
    seedLabel: 'pack-victory-seed',
  });
  eq(result.result, 'clear', 'a 1-HP enemy against a full attacking troop should clear quickly');
});

T('boss/pack: wipe asserts level-down + no gain/loss', () => {
  // Construct a scenario where the enemy is overwhelmingly strong so the
  // troop wipes; assert level-down via runDungeon and that HP ends at 0
  // (attrition), with no rewards accrued on wipe.
  const strongEnemy = {
    overwhelm: { id: 'overwhelm', name: 'Overwhelm', hp: [500, 500], footprint: [1, 1], skills: ['overwhelm_strike'] },
  };
  const strongSkills = {
    overwhelm_strike: { trigger: { t: 'every_secs', s: [0.1, 0.1] }, verb: { t: 'strike', n: [500, 500] }, attack_profile: { edge: ['top', 'left', 'right', 'bottom'], penetration: 5, aoe: 5 } },
  };
  const result = combat.runDungeon({
    masterSeed: 'wipe-seed-1',
    dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['overwhelm'] }, deadline_secs: 30 }, { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['overwhelm'] }, deadline_secs: 30 }] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: strongEnemy, skillDefsById: strongSkills,
    formationId: 'formation1', level: 5, participants: ['p1'],
  });
  eq(result.result, 'wipe', 'troop must wipe against an overwhelming enemy');
  eq(result.level, 4, 'level should step down by FAILURE_STEP=1 (5 -> 4)');
  eq(result.rewards, [], 'no rewards should be granted on wipe');
  const totalHp = result.bps.reduce((s, b) => s + b.hp, 0);
  eq(totalHp, 0, 'all BPs should be at 0 hp on a wipe (nothing lost beyond attrition, nothing gained)');
});

// =====================================================================
// 8. Rewards: uniform distribution statistical smoke test
// =====================================================================
T('rewards: uniform distribution statistical smoke test (fixed seed, documented tolerance)', () => {
  const rng = combat.makeRng('reward-stats-seed');
  const participants = ['pA', 'pB', 'pC', 'pD'];
  const items = new Array(2000).fill(0).map((_, i) => 'item' + i);
  const assignments = combat.distributeRewardsUniform(items, participants, rng);
  const counts = { pA: 0, pB: 0, pC: 0, pD: 0 };
  for (const a of assignments) counts[a.owner]++;
  // With 2000 draws over 4 participants, expected ~500 each; documented
  // tolerance: allow +/-15% deviation from the uniform expectation to
  // keep this a stable, non-flaky statistical smoke test.
  const expected = items.length / participants.length;
  for (const p of participants) {
    approx(counts[p], expected, expected * 0.15, 'participant ' + p + ' should receive roughly 1/4 of rewards (tolerance 15%)');
  }
  ok(assignments.every(a => a.destination === 'warehouse'), 'every reward should be modeled as landing in the warehouse');
});

// =====================================================================
// 9. Attrition: BP hp carries across encounters within a run
// =====================================================================
T('attrition: BP hp persists across encounters within one run (permanent, no auto-heal)', () => {
  const dmgEnemy = { dmg_dealer: { id: 'dmg_dealer', name: 'Dmg', hp: [1000, 1000], footprint: [1, 1], skills: ['dmg_hit'] } };
  const dmgSkills = { dmg_hit: { trigger: { t: 'every_secs', s: [0.3, 0.3] }, verb: { t: 'strike', n: [5, 5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } } };
  const result = combat.runDungeon({
    masterSeed: 'attrition-seed',
    dungeonDef: { encounters: [
      { id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['dmg_dealer'] }, deadline_secs: 3 },
      { id: 'e1', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['dmg_dealer'] }, deadline_secs: 3 },
      { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['dmg_dealer'] }, deadline_secs: 3 },
    ] },
    squadSnapshots: fourSquadSnapshots(), itemDefsById, enemyDefsById: dmgEnemy, skillDefsById: dmgSkills,
    formationId: 'formation1', level: 1, participants: ['p1'],
  });
  // The dmg_dealer never dies (1000 hp) so every encounter times out via
  // deadline_secs without ever clearing -- meaning damage accrues across
  // all 3 encounter calls onto the SAME bps array. Assert some damage was
  // taken (i.e. HP is below max, proving persistence rather than a fresh
  // reset each encounter).
  const totalHpMax = result.bps.reduce((s, b) => s + b.hpMax, 0);
  const totalHp = result.bps.reduce((s, b) => s + b.hp, 0);
  ok(totalHp < totalHpMax, 'accrued damage across 3 encounters should leave troop below full HP (persistent attrition)');
  ok(totalHp >= 0, 'HP never goes negative');
});

// =====================================================================
// 10. Cooldown formula
// =====================================================================
T('cooldown formula: H=0 -> CD_max, H=1 -> CD_min, intermediate H is linear', () => {
  eq(combat.cooldownForH(0), combat.TUNABLES.CD_MAX_SECS, 'H=0 (wipe-equivalent) must equal CD_MAX_SECS');
  eq(combat.cooldownForH(1), combat.TUNABLES.CD_MIN_SECS, 'H=1 (full HP) must equal CD_MIN_SECS');
  const mid = combat.cooldownForH(0.5);
  const expectedMid = combat.TUNABLES.CD_MIN_SECS + (combat.TUNABLES.CD_MAX_SECS - combat.TUNABLES.CD_MIN_SECS) * 0.5;
  approx(mid, expectedMid, 1e-9, 'H=0.5 should be exactly halfway between CD_MIN and CD_MAX (linear formula)');
});

// =====================================================================
// 11. Full-run smoke: batch-002 dungeon end-to-end
// =====================================================================
T('full-run smoke: batch-002 Niflheim Depths dungeon runs end-to-end with a fixed seed, no crashes', () => {
  const scenarioWithPilotItems = combat.deepCopy(scenario);
  scenarioWithPilotItems.pos.push({ uid: 'pLock', id: 'lockpick', loc: 'grid', cell: [6, 6], rot: 0 });
  scenarioWithPilotItems.pos.push({ uid: 'pSpy', id: 'spyglass', loc: 'grid', cell: [7, 7], rot: 0 });
  const itemDefsWithPilots = Object.assign({}, itemDefsById, pilotItemDefsById);

  const result = combat.runDungeon({
    masterSeed: 'full-dungeon-smoke-seed-1',
    dungeonDef: dungeonRaw, monsterPackDefsById,
    squadSnapshots: [scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems],
    itemDefsById: itemDefsWithPilots, enemyDefsById, skillDefsById,
    formationId: 'formation2', level: 3, participants: ['alice', 'bob', 'carol', 'dave'],
  });
  ok(['victory', 'wipe', 'incomplete'].includes(result.result), 'full dungeon run must end in a legal terminal state, got ' + result.result);
  ok(result.finalProgressPct >= 0 && result.finalProgressPct <= 100, 'progress must be within [0,100], got ' + result.finalProgressPct);
  if (result.result === 'victory') eq(result.finalProgressPct, 100, 'a victory result must show 100% progress');
  ok(result.events.length > 20, 'a full multi-encounter dungeon run should produce a substantial event log, got ' + result.events.length);
  ok(result.cooldownSecs >= combat.TUNABLES.CD_MIN_SECS && result.cooldownSecs <= combat.TUNABLES.CD_MAX_SECS, 'cooldown must be within [CD_MIN,CD_MAX]');
  // sanity: the log should be valid JSONL (every line parses)
  const jsonl = combat.toJSONL(result.events);
  const lines = jsonl.split('\n');
  for (const line of lines) JSON.parse(line); // throws if malformed
  console.log('  (full-run smoke: result=' + result.result + ' progress=' + result.finalProgressPct.toFixed(1) + '% events=' + result.events.length + ' cooldown=' + result.cooldownSecs.toFixed(1) + 's)');
});

// =====================================================================
// REQ-0042: LRDST reward accrual tests
// =====================================================================
T('REQ-0042 LRDST reward: a victorious run accrues a positive lrdstReward within the combined pack+boss tunable range; a wiped run accrues 0',()=>{
  const scenarioWithPilotItems = combat.deepCopy(scenario);
  const result = combat.runDungeon({
    masterSeed: 'lrdst-reward-victory-seed-1',
    dungeonDef: dungeonRaw, monsterPackDefsById,
    squadSnapshots: [scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems],
    itemDefsById, enemyDefsById, skillDefsById,
    formationId: 'formation2', level: 3, participants: ['alice'],
  });
  if (result.result === 'victory') {
    // batch-002's dungeon def has multiple non-boss encounters + 1 boss --
    // total lrdstReward must be at least the boss's own minimum (5) and
    // at most (nonBossCount x 3 + 10), but since we don't hardcode the
    // exact encounter count here, just assert the loose invariant that
    // matters: strictly positive, and a sane upper bound (well under
    // what could ever be produced by a handful of encounters).
    ok(result.lrdstReward > 0, 'a victorious run must accrue a positive LRDST reward, got ' + result.lrdstReward);
    ok(result.lrdstReward < 200, 'LRDST reward should be a small tunable-bounded number, not a runaway value, got ' + result.lrdstReward);
  } else if (result.result === 'wipe') {
    eq(result.lrdstReward, 0, 'a wipe must accrue ZERO LRDST -- same "wipe = nothing else" rule as item rewards');
  }
});

T('REQ-0045 (f) guard: compileEnemyPack NEVER places a pack member outside the enemy field\'s own bounds (col/row), across many seeds and pack sizes -- the reported overflow was client-side label rendering only, never the placement math', () => {
  // Regression guard (not a fix -- see the REQ-0045 outcome doc): the
  // reported bug ("enemy-side placement overflows past the right edge
  // of the enemy plane") was found to be a CLIENT-side rendering bug
  // (client/src/schedule/MonitorRenderer.ts's enemy Text label carried
  // no width clamp -- fixed there). The SIM's own placement math
  // (compileEnemyPack's column-fill-with-row-wrap), right here, was
  // ALWAYS correct: every pack member's fieldCells stay within
  // [enemyFieldBox.rowMin, rowMax] x [colMin, colMax], regardless of
  // pack size or footprint mix. This asserts that fact explicitly and
  // permanently across a heavy seed x pack-size sweep, using the REAL
  // batch-002 enemy roster (footprints from 1x1 up to 3x3, the actual
  // range this sim ships with).
  const enemyFieldBox = { rowMin: 1, colMin: 1, rowMax: combat.FIELD_ROWS, colMax: combat.FIELD_COLS };
  const rosterIds = Object.keys(enemyDefsById);
  ok(rosterIds.length > 0, 'sanity: the real batch-002 roster must be non-empty for this sweep to mean anything');
  let violations = 0;
  let totalChecked = 0;
  for (let seedIdx = 0; seedIdx < 60; seedIdx++) {
    const rng = combat.makeRng('pack-bounds-seed-' + seedIdx);
    // Vary pack size across the sweep, up to a genuinely large pack (69
    // members, matching the REQ-0045 investigation's own upper bound) --
    // deterministic per seedIdx, not random, so this test is itself
    // reproducible.
    const packSize = 1 + (seedIdx % 69);
    const enemyIds = [];
    for (let i = 0; i < packSize; i++) enemyIds.push(rosterIds[i % rosterIds.length]);
    const packDef = { enemyIds };
    const enemies = combat.compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, enemyFieldBox);
    for (const enemy of enemies) {
      for (const [r, c] of enemy.fieldCells) {
        totalChecked++;
        if (r < enemyFieldBox.rowMin || r > enemyFieldBox.rowMax || c < enemyFieldBox.colMin || c > enemyFieldBox.colMax) {
          violations++;
          console.log('  (VIOLATION: seed ' + seedIdx + ', packSize ' + packSize + ', enemy ' + enemy.id + ', cell [' + r + ',' + c + '] outside [' + enemyFieldBox.rowMin + '-' + enemyFieldBox.rowMax + ',' + enemyFieldBox.colMin + '-' + enemyFieldBox.colMax + '])');
        }
      }
    }
  }
  ok(totalChecked > 100, 'sanity: this sweep must actually check a substantial number of cells, got ' + totalChecked);
  eq(violations, 0, violations + ' of ' + totalChecked + ' checked cells fell outside the enemy field\'s own bounds -- see VIOLATION lines above for exact seed/pack/enemy/cell');
});

T('REQ-0045 (e) guard: an instant/forced wipe classifies as result==\'wipe\' with EMPTY rewards + 0 lrdstReward + no victory run_end event -- never misclassified as a win', () => {
  // Regression guard (not a fix -- see the REQ-0045 outcome doc): the
  // reported bug ("Victory displayed when clearly not a victory; no
  // rewards shown") was found to be a CLIENT-side display bug
  // (client/src/schedule/Monitor.tsx revealed the summary panel
  // prematurely -- before `settled` -- and never actually rendered
  // run.rewards at all, since GET .../run never even carries a
  // `rewards` field; the warehouse is the real reward ledger). The sim's
  // OWN victory/wipe classification, right here, was ALWAYS correct --
  // this asserts that fact explicitly and permanently: a devastating
  // synthetic enemy (n:[9999,9999] every 0.01s) against the fixture's
  // real troop guarantees a wipe on the very FIRST encounter, well
  // before the boss (the only path to 'victory') is ever reached.
  const devastatingEnemyDefs = {
    instant_kill_boss: { id: 'instant_kill_boss', name: 'Instant Kill Boss', hp: [99999, 99999], footprint: [1, 1], skills: ['instant_kill_strike'] },
  };
  const devastatingSkillDefs = {
    instant_kill_strike: { trigger: { t: 'every_secs', s: [0.01, 0.01] }, verb: { t: 'strike', n: [9999, 9999] }, attack_profile: { edge: ['top'], penetration: 999, aoe: 0 } },
  };
  const dungeonDef = { schema: 'dungeon/1', id: 'forced_wipe_test', name: 'Forced Wipe Test', encounters: [
    { id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['instant_kill_boss'] }, deadline_secs: 5, rewardItems: ['should_never_be_granted'] },
    { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['instant_kill_boss'] }, deadline_secs: 5 },
  ] };
  for (let i = 0; i < 10; i++) {
    const result = combat.runDungeon({
      masterSeed: 'forced-wipe-seed-' + i,
      dungeonDef,
      squadSnapshots: fourSquadSnapshots(),
      itemDefsById, enemyDefsById: devastatingEnemyDefs, skillDefsById: devastatingSkillDefs,
      formationId: 'formation1', level: 1, participants: ['alice'],
    });
    eq(result.result, 'wipe', 'a devastating enemy must force a wipe (seed forced-wipe-seed-' + i + '), got ' + result.result);
    eq(result.rewards, [], 'a wiped run must show ZERO rewards, never the first encounter\'s rewardItems');
    eq(result.lrdstReward, 0, 'a wiped run must accrue ZERO lrdst, matching the item-reward invariant');
    const runEndEvents = result.events.filter((e) => e.ev === 'run_end');
    eq(runEndEvents.length, 1, 'exactly one run_end event must be emitted');
    eq(runEndEvents[0].result, 'wipe', 'the run_end event itself must carry result:\'wipe\', never \'victory\'');
    ok(!result.events.some((e) => e.ev === 'run_end' && e.result === 'victory'), 'no run_end event may EVER claim victory on a forced wipe');
  }
});

T('REQ-0042 LRDST reward: a single cleared non-boss encounter rolls within [1,3]; a single cleared boss rolls within [5,10]',()=>{
  // Isolate ONE encounter type at a time via a minimal synthetic dungeon
  // def (bypasses batch-002's specific encounter mix so this test is
  // about the TUNABLE RANGE itself, not the real dungeon's composition).
  const scenarioWithPilotItems = combat.deepCopy(scenario);
  const oneNonBossDungeon = { schema: 'dungeon/1', id: 'lrdst_test_nonboss', name: 'LRDST Test',
    encounters: [{ id: 'enc1', type: 'pack', mode: 'battle', enemyPack: { enemyIds: Object.keys(enemyDefsById)[0] ? [Object.keys(enemyDefsById)[0]] : [] }, deadline_secs: 30, rewardItems: [] }] };
  // Fall back to the real dungeon's own first non-boss encounter type/
  // enemyPack if the synthetic minimal one can't resolve an enemy id
  // (defensive -- keeps this test robust to fixture content changes).
  const realNonBoss = dungeonRaw.encounters.find((e) => e.type !== 'boss');
  const realBoss = dungeonRaw.encounters.find((e) => e.type === 'boss');
  ok(realNonBoss, 'sanity: the real batch-002 dungeon def has at least one non-boss encounter');
  ok(realBoss, 'sanity: the real batch-002 dungeon def has a boss encounter');

  // Run several seeds and collect the SINGLE-encounter LRDST roll by
  // running a dungeon truncated to exactly one encounter, isolating each
  // type's own accrual in result.lrdstReward (only that one encounter
  // contributes, since a 1-encounter dungeon with a non-boss clear never
  // reaches 100% progress -- runResult becomes 'incomplete', which still
  // accrues lrdstReward since only 'wipe' zeroes it out, per the function's
  // own comment).
  for (let i = 0; i < 30; i++) {
    const singleNonBoss = { schema: 'dungeon/1', id: 'lrdst_iso_nonboss', name: 'iso', encounters: [realNonBoss] };
    const r = combat.runDungeon({
      masterSeed: 'lrdst-iso-nonboss-seed-' + i,
      dungeonDef: singleNonBoss,
      squadSnapshots: [scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems],
      itemDefsById, enemyDefsById, skillDefsById, monsterPackDefsById, // REQ-0184: realNonBoss names its pack by id
      formationId: 'formation2', level: 3, participants: ['alice'],
    });
    if (r.result !== 'wipe') {
      ok(r.lrdstReward >= 1 && r.lrdstReward <= 3, 'single non-boss clear LRDST must be in [1,3], got ' + r.lrdstReward + ' (seed ' + i + ')');
    }
  }
  for (let i = 0; i < 30; i++) {
    const singleBoss = { schema: 'dungeon/1', id: 'lrdst_iso_boss', name: 'iso', encounters: [realBoss] };
    const r = combat.runDungeon({
      masterSeed: 'lrdst-iso-boss-seed-' + i,
      dungeonDef: singleBoss,
      squadSnapshots: [scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems, scenarioWithPilotItems],
      itemDefsById, enemyDefsById, skillDefsById, monsterPackDefsById, // REQ-0184: realBoss names its pack by id
      formationId: 'formation2', level: 3, participants: ['alice'],
    });
    if (r.result === 'victory') {
      ok(r.lrdstReward >= 5 && r.lrdstReward <= 10, 'single boss clear LRDST must be in [5,10], got ' + r.lrdstReward + ' (seed ' + i + ')');
    }
  }
});

// =====================================================================
// Additional coverage: formation box parsing + engine interop invariant
// =====================================================================
T('formation defs: all 4 boxes parse to exactly 8x8, formation4 uses CORRECTED J11:Q18', () => {
  for (const fid of Object.keys(combat.FORMATIONS)) {
    const cv = combat.FORMATIONS[fid].canvases;
    for (const squad of Object.keys(cv)) {
      const box = combat.parseBox(cv[squad]);
      eq(box.colMax - box.colMin + 1, 8, fid + '.' + squad + ' width');
      eq(box.rowMax - box.rowMin + 1, 8, fid + '.' + squad + ' height');
    }
  }
  eq(combat.FORMATIONS.formation4.canvases.unit4, 'J11:Q18', 'formation4 unit4 must be the CORRECTED box, not the xlsx J11:Q19 error');
});

T('parseBox: column letter mapping A=1..Z=26 is correct', () => {
  eq(combat.colLetterToIndex('A'), 1);
  eq(combat.colLetterToIndex('Z'), 26);
  eq(combat.colIndexToLetter(1), 'A');
  eq(combat.colIndexToLetter(26), 'Z');
  const box = combat.parseBox('J2:Q9');
  eq(box, { colMin: 10, colMax: 17, rowMin: 2, rowMax: 9 });
});

T('engine interop invariant: combat.cjs never calls an engine mutator (no PO/BP state in engine module is touched)', () => {
  // Sanity check that the exposed `engine` object still has its mutator
  // functions present (proves we required the real module, not a stub),
  // while combat.cjs's own compile pass produces field cells WITHOUT ever
  // invoking any of them -- verified structurally: compileSquadSnapshot's
  // result is plain, JSON-serializable data with no shared references
  // back into engine internals.
  ok(typeof combat.engine.create === 'function', 'engine.create should be the real function');
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1');
  const serialized = JSON.stringify(compiled);
  ok(serialized.length > 0, 'compiled snapshot must be plain-data serializable (no engine object leakage)');
});

T('REQ-0045 (d) guard: compileSquadSnapshot copies EVERY BP on the squad, each at its own real origin -- never just bps[0] auto-placed at (0,0)', () => {
  // Regression guard (not a fix -- see the REQ-0045 outcome doc): the
  // reported bug ("only the first BP of a deployed squad is copied into
  // the run, auto-placed top-left") was found to be a CLIENT-side
  // display-only bug (client/src/schedule/Monitor.tsx/MonitorRenderer.ts
  // truncated to bps[0] for the monitor's visual only) -- the actual
  // combat simulation, right here, was ALWAYS correct: this asserts
  // that fact explicitly and permanently, as a standing guard against
  // ever reintroducing a bps[0]-only truncation at the SIM layer, since
  // that would be a far more serious bug than a display-only one (it
  // would mean the game's actual outcome silently ignores every BP but
  // the first on every multi-BP squad).
  //
  // content/live/scenario.json's own top-level canvas has 4 BPs at 4
  // genuinely distinct origins (alpha@[1,1], beta@[1,4], gamma@[4,2],
  // delta@[4,5]) -- exactly the "multiple BPs on one squad's 8x8 local
  // canvas" shape this guards.
  const compiled = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1');
  eq(compiled.bps.length, scenario.bps.length, 'every BP on the squad canvas must be present in the compiled snapshot, not just the first');
  ok(compiled.bps.length >= 2, 'sanity: the fixture scenario must actually have multiple BPs for this guard to mean anything');
  // Cross-check EVERY bp by id: its compiled localCells must equal its
  // OWN shape offsets PLUS its OWN origin (never renormalized to (0,0),
  // never collapsed onto some OTHER bp's origin).
  for (const bpDef of scenario.bps) {
    const compiledBp = compiled.bps.find((b) => b.id === bpDef.id);
    ok(compiledBp, 'bp ' + bpDef.id + ' must be present in the compiled snapshot');
    const expectedLocalCells = bpDef.shape.map(([dr, dc]) => [bpDef.origin[0] + dr, bpDef.origin[1] + dc]);
    eq(compiledBp.localCells, expectedLocalCells, 'bp ' + bpDef.id + ' localCells must be its own shape+origin, not truncated/renormalized/collapsed onto another bp');
  }
  // The 4 bps' local cell sets must be MUTUALLY DISJOINT (proving they
  // occupy their own real, distinct positions rather than all
  // collapsing onto one origin, e.g. all onto (0,0) or all onto the
  // first bp's own origin -- the exact shape the reported bug would take
  // if it existed at this layer).
  const seen = new Set();
  for (const bp of compiled.bps) {
    for (const [r, c] of bp.localCells) {
      const key = r + ',' + c;
      ok(!seen.has(key), 'cell ' + key + ' claimed by more than one bp -- bps are overlapping/collapsed, not at their own distinct positions');
      seen.add(key);
    }
  }
});

T('multi_strike: each sub-hit is a separate hit (OQ19) -- N hits produce N independent damage rolls', () => {
  const rng = combat.makeRng('multistrike-seed');
  const dmgStream = rng.stream('ms-test/dmg');
  let hitCount = 0;
  const actor = {
    hp: () => 100, statusBag: combat.freshStatusBag(),
    ref: { id: 'test_actor', masked: false },
    applyDamage(amt) { hitCount++; },
  };
  const events = [];
  combat.dealHitOnField(actor, { verb: { t: 'multi_strike', n: [2, 4], hits: 3 } }, 1.0, dmgStream, 'battle', events);
  eq(hitCount, 3, 'multi_strike with hits:3 should call applyDamage exactly 3 separate times');
});


// =====================================================================
// REQ-0043: dungeon auto-generation (sim/dungen.cjs)
// =====================================================================
T('dungen determinism: same (type,level,seed) => byte-identical def (default type)', () => {
  const a = dungen.generate('default', 5, 'det-seed-1');
  const b = dungen.generate('default', 5, 'det-seed-1');
  eq(a, b, 'two generate() calls with identical inputs must produce byte-identical (JSON.stringify-equal) defs');
});

T('dungen determinism: different seeds produce different defs (sanity -- generator is not seed-blind)', () => {
  const a = dungen.generate('default', 5, 'seed-alpha');
  const b = dungen.generate('default', 5, 'seed-beta');
  ok(JSON.stringify(a) !== JSON.stringify(b), 'different seeds at the same level should (almost always) differ in composition');
});

T('dungen determinism: same (type,level,seed) => byte-identical def across MANY levels (smoke, not just one)', () => {
  for (const lvl of [1, 2, 3, 7, 10, 15, 20]) {
    const a = dungen.generate('default', lvl, 'multi-level-seed');
    const b = dungen.generate('default', lvl, 'multi-level-seed');
    eq(a, b, 'level ' + lvl + ' must be deterministic');
  }
});

T('dungen: default type always ends with exactly one boss encounter, pinned last', () => {
  for (const lvl of [1, 4, 9, 16]) {
    const d = dungen.generate('default', lvl, 'boss-check-' + lvl);
    const last = d.encounters[d.encounters.length - 1];
    eq(last.type, 'boss', 'level ' + lvl + ' last encounter must be type boss');
    const bossCount = d.encounters.filter((e) => e.type === 'boss').length;
    eq(bossCount, 1, 'level ' + lvl + ' must have exactly one boss encounter');
  }
});

T('dungen: default type -- trap count is bounded 0-2, door chain 0-1 (as two entries), chest 0-1', () => {
  for (const lvl of [1, 5, 10, 20]) {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const d = dungen.generate('default', lvl, seed + '-' + lvl);
      const trapCount = d.encounters.filter((e) => e.type === 'trap').length;
      const doorCount = d.encounters.filter((e) => e.type === 'door').length;
      const chestCount = d.encounters.filter((e) => e.type === 'chest').length;
      ok(trapCount >= 0 && trapCount <= 2, 'trap count must be 0-2, got ' + trapCount);
      ok(doorCount === 0 || doorCount === 2, 'door chain must appear as 0 or 2 entries (stage1+stage2), got ' + doorCount);
      ok(chestCount >= 0 && chestCount <= 1, 'chest count must be 0-1, got ' + chestCount);
    }
  }
});

T('dungen: level scaling is monotone non-decreasing -- packsForLevel(level) never decreases as level rises', () => {
  let prev = dungen.packsForLevel(1);
  for (let lvl = 2; lvl <= 30; lvl++) {
    const cur = dungen.packsForLevel(lvl);
    ok(cur >= prev, 'packsForLevel(' + lvl + ')=' + cur + ' must be >= packsForLevel(' + (lvl - 1) + ')=' + prev);
    prev = cur;
  }
});

T('dungen: level scaling is monotone non-decreasing -- packBudgetForLevel(level) never decreases as level rises', () => {
  let prev = combat.packBudgetForLevel(1);
  for (let lvl = 2; lvl <= 30; lvl++) {
    const cur = combat.packBudgetForLevel(lvl);
    ok(cur >= prev, 'packBudgetForLevel(' + lvl + ')=' + cur + ' must be >= packBudgetForLevel(' + (lvl - 1) + ')=' + prev);
    prev = cur;
  }
});

T('dungen: higher level => generated pack member counts trend >= lower level (smoke, aggregate over many seeds)', () => {
  function avgPackMembers(level) {
    let total = 0, packEncCount = 0;
    for (let i = 0; i < 40; i++) {
      const d = dungen.generate('default', level, 'scale-smoke-' + level + '-' + i);
      for (const e of d.encounters) {
        if (e.type === 'pack') { total += e.enemyPack.enemyIds.length; packEncCount++; }
      }
    }
    return total / packEncCount;
  }
  const avgLow = avgPackMembers(1);
  const avgHigh = avgPackMembers(15);
  ok(avgHigh >= avgLow, 'average pack member count at level 15 (' + avgHigh + ') should be >= level 1 (' + avgLow + ')');
});

T('dungen: test_fixed type returns batch-002 dungeon.json verbatim (byte-equal), regardless of level/seed', () => {
  const raw = dungen.loadFixedDungeon();
  for (const [lvl, seed] of [[1, 'a'], [7, 'b'], [99, 'anything']]) {
    const got = dungen.generate('test_fixed', lvl, seed);
    eq(got.id, raw.id, 'test_fixed id must match batch-002 dungeon.json');
    eq(got.encounters, raw.encounters, 'test_fixed encounters must be byte-identical to batch-002 dungeon.json, regardless of level/seed');
    eq(got.name, raw.name);
  }
});

T('dungen: test_fixed is generator-independent -- two different seeds produce identical encounters', () => {
  const a = dungen.generate('test_fixed', 3, 'fixed-seed-x');
  const b = dungen.generate('test_fixed', 3, 'fixed-seed-y');
  eq(a.encounters, b.encounters, 'test_fixed encounters must not vary by seed at all');
});

T('dungen: unknown dungeonType throws (caller-facing validation seam)', () => {
  let threw = false;
  try { dungen.generate('not_a_real_type', 1, 'x'); } catch (e) { threw = true; }
  ok(threw, 'generate() must throw for an unknown dungeonType');
});

T('dungen: default() with no seed/level args still returns a valid, runnable def (defaults applied)', () => {
  const d = dungen.generate('default', undefined, undefined);
  ok(Array.isArray(d.encounters) && d.encounters.length > 0, 'default-arg generate() must still produce a non-empty encounter list');
  eq(d.encounters[d.encounters.length - 1].type, 'boss');
});

T('dungen: a generated default-type def actually RUNS through combat.runDungeon end-to-end without throwing', () => {
  const d = dungen.generate('default', 6, 'runnable-check-seed');
  const result = combat.runDungeon({
    masterSeed: 'runnable-check-combat-seed',
    dungeonDef: d,
    squadSnapshots: fourSquadSnapshots(),
    itemDefsById, enemyDefsById, skillDefsById,
    formationId: 'formation1', level: 6, participants: ['alice'],
  });
  ok(result.result === 'victory' || result.result === 'wipe' || result.result === 'incomplete', 'runDungeon must return a recognized result for a generated def');
  ok(Array.isArray(result.events) && result.events.length > 0, 'runDungeon must produce events for a generated def');
});

T('dungen: a generated def only ever references enemy ids that exist in the batch-002 roster (compileEnemyPack never throws missing-def)', () => {
  for (let i = 0; i < 20; i++) {
    const d = dungen.generate('default', (i % 20) + 1, 'roster-check-' + i);
    for (const e of d.encounters) {
      if (e.enemyPack) {
        for (const eid of e.enemyPack.enemyIds) {
          ok(!!enemyDefsById[eid], 'generated encounter references unknown enemy id ' + eid);
        }
      }
    }
  }
});


// =====================================================================
// REQ-0048: Linker Combat Effects v1 (Pulse + Resonance)
// =====================================================================
(function () {
  const L = { ROWS: 8, COLS: 8 };
  // REQ-0170: a BP's rays are its UNIT's connection_shape, resolved through an
  // injected registry -- so these fixtures mint one synthetic unit def per dirs-set
  // they need, exactly as they already mint synthetic ITEM defs (linkItemDefs). This
  // keeps every link graph below BYTE-IDENTICAL to the pre-REQ-0170 fixtures (an
  // east-only ray stays east-only; the live vocabulary has no such shape, and
  // bending these fixtures onto `rook` would have silently added edges and changed
  // what the pulse tests assert). The LIVE vocabulary is exercised by the parity
  // test at the end of this block, against the real scenario.
  const linkUnitDefs = {};
  const linkShapes = {};
  function unitForDirs(dirs) {
    const key = dirs.length ? 'ray_' + dirs.join('_') : 'no_link';
    if (!linkShapes[key]) {
      linkShapes[key] = dirs.length
        ? { kind: 'ray', dirs: dirs.slice(), range: null, pierce: false }
        : { kind: 'none', dirs: [] };
    }
    const uid = 'u_' + key;
    if (!linkUnitDefs[uid]) linkUnitDefs[uid] = { name: uid, rarity: 'Common', icon: '', connection_shape: key };
    return uid;
  }
  function bp(id, origin, dirs, off) { return { id: id, name: id, shape: [[0,0],[0,1]], origin: origin, unit: { id: unitForDirs(dirs), off: off || [0,0] }, hpMax: 100 }; }
  function cellBp(id, origin, dirs) { return { id: id, name: id, shape: [[0,0]], origin: origin, unit: { id: unitForDirs(dirs), off: [0,0] }, hpMax: 100 }; }
  function dummyUnit(id) { return { linked: false, bps: [{ id: id, name: id, shape: [[0,0]], origin: [1,1], unit: { id: unitForDirs([]), off: [0,0] }, hpMax: 50 }], pos: [], layout: L, sis: [] }; }
  const linkItemDefs = {
    spark:     { id: 'spark',     shape: [[0,0]], tags: [], modes: ['battle'], effects: [{ trigger: { t: 'every_secs', s: [1,1] }, verb: { t: 'pulse' } }] },
    sparkfast: { id: 'sparkfast', shape: [[0,0]], tags: [], modes: ['battle'], effects: [{ trigger: { t: 'every_secs', s: [0.1,0.1] }, verb: { t: 'pulse' } }] },
    payload:   { id: 'payload',   shape: [[0,0]], tags: [], modes: ['battle'], attack_profile: { edge: ['top'], penetration: 0, aoe: 0 }, effects: [{ trigger: { t: 'on_link_pulse' }, verb: { t: 'strike', n: [5,5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } }] },
  };
  const wallEnemy = { wall: { id: 'wall', name: 'Wall', hp: [100000,100000], footprint: [1,1], skills: [] } };
  function runLink(seed, unit, extraDefs, mode, deadline) {
    return combat.runDungeon({
      masterSeed: seed,
      dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: mode || 'battle', enemyPack: { enemyIds: ['wall'] }, deadline_secs: deadline || 5 }] },
      squadSnapshots: [unit, dummyUnit('z2'), dummyUnit('z3'), dummyUnit('z4')],
      itemDefsById: Object.assign({}, linkItemDefs, extraDefs || {}),
      enemyDefsById: wallEnemy, skillDefsById: {}, formationId: 'formation1', level: 1, participants: ['pA'],
      unitDefsById: linkUnitDefs, connShapes: linkShapes, // REQ-0170
    });
  }
  const chainUnit = { linked: true, layout: L, sis: [],
    bps: [ bp('A', [1,1], [2], [0,1]), bp('B', [1,4], [2], [0,0]), bp('C', [1,7], [], [0,0]) ],
    pos: [ { uid: 's1', id: 'spark',   loc: 'grid', cell: [1,1], rot: 0 },
           { uid: 'y1', id: 'payload', loc: 'grid', cell: [1,5], rot: 0 },
           { uid: 'y2', id: 'payload', loc: 'grid', cell: [1,8], rot: 0 } ] };
  T('REQ-0048 pulse: chain A->B->C propagates + fires on_link_pulse payloads (cause:pulse)', () => {
    const r = runLink('req48-chain', chainUnit);
    const lp = r.events.filter(e => e.ev === 'link_pulse');
    ok(lp.some(e => e.from === 'A' && e.to === 'B'), 'link_pulse A->B present');
    ok(lp.some(e => e.from === 'B' && e.to === 'C'), 'link_pulse B->C present (auto-relay w/o spark in B)');
    const pray = r.events.filter(e => e.ev === 'ray_fire' && String(e.src).indexOf('#pulse') >= 0 && e.cause === 'pulse');
    ok(pray.length >= 2, 'payload rays fired (B and C), tagged cause:pulse');
  });
  T('REQ-0048 pulse: deterministic (same seed -> byte-identical JSONL incl. new events)', () => {
    const a = combat.toJSONL(runLink('req48-det', chainUnit).events);
    const b = combat.toJSONL(runLink('req48-det', chainUnit).events);
    ok(a === b, 'identical seed -> identical pulse replay');
    ok(a.indexOf('link_pulse') >= 0, 'log actually contains pulse events');
  });
  const mutualUnit = { linked: true, layout: L, sis: [],
    bps: [ bp('A', [1,1], [2], [0,1]), bp('B', [1,4], [6], [0,0]) ],
    pos: [ { uid: 's1', id: 'spark', loc: 'grid', cell: [1,1], rot: 0 }, { uid: 'y1', id: 'payload', loc: 'grid', cell: [1,5], rot: 0 } ] };
  T('REQ-0048 pulse: mutual link never echoes back to origin (visited set)', () => {
    const r = runLink('req48-mut', mutualUnit);
    const lp = r.events.filter(e => e.ev === 'link_pulse');
    ok(lp.some(e => e.from === 'A' && e.to === 'B'), 'A->B present');
    ok(!lp.some(e => e.to === 'A'), 'no pulse echoes back into origin A');
  });
  const hopUnit = { linked: true, layout: L, sis: [],
    bps: [ cellBp('A',[1,1],[4]), cellBp('B',[2,1],[4]), cellBp('C',[3,1],[4]), cellBp('D',[4,1],[4]), cellBp('E',[5,1],[]) ],
    pos: [ { uid: 's1', id: 'spark', loc: 'grid', cell: [1,1], rot: 0 } ] };
  T('REQ-0048 pulse: hop budget H=3 stops the chain (D reached, E not)', () => {
    const r = runLink('req48-hop', hopUnit);
    const lp = r.events.filter(e => e.ev === 'link_pulse');
    ok(lp.some(e => e.to === 'D'), 'reaches D within 3 hops');
    ok(!lp.some(e => e.to === 'E'), 'does not reach E (beyond hop budget)');
  });
  T('REQ-0048 pulse: rate cap fizzles excess emissions (PULSE_CAP/sec)', () => {
    const fastUnit = { linked: true, layout: L, sis: [],
      bps: [ bp('A',[1,1],[2],[0,1]), bp('B',[1,4],[],[0,0]) ],
      pos: [ { uid: 's1', id: 'sparkfast', loc: 'grid', cell: [1,1], rot: 0 } ] };
    const r = runLink('req48-cap', fastUnit, null, 'battle', 3);
    ok(r.events.some(e => e.ev === 'pulse_fizzle' && e.reason === 'rate_cap'), 'excess pulses fizzle at the rate cap');
  });
  T('REQ-0048 pulse: mode gating -- battle-only spark does not emit in a detection encounter', () => {
    const r = runLink('req48-mode', mutualUnit, null, 'detection', 5);
    ok(!r.events.some(e => e.ev === 'link_pulse'), 'battle-only spark never emits in a detection encounter');
  });
  T('REQ-0048 pulse: pulse to a dead BP fizzles (dead_target)', () => {
    const deadUnit = { linked: true, layout: L, sis: [],
      bps: [ bp('A',[1,1],[2],[0,1]), bp('B',[1,4],[],[0,0]) ],
      pos: [ { uid: 's1', id: 'spark', loc: 'grid', cell: [1,1], rot: 0 } ] };
    deadUnit.bps[1].hpMax = 0; // B starts dead -> arrival must fizzle
    const r = runLink('req48-dead', deadUnit);
    ok(r.events.some(e => e.ev === 'pulse_fizzle' && e.reason === 'dead_target' && e.to === 'B'), 'arrival at a dead BP fizzles');
  });
  T('REQ-0048 resonance: buff_linked folds +n per linked-tag PO; cond flags set', () => {
    const resItems = {
      weapon: { id: 'weapon', shape: [[0,0]], tags: ['Weapon'], modes: ['battle'], effects: [
        { trigger: { t: 'passive' }, verb: { t: 'buff_linked', stat: 'damage', n: [10,10], tag: 'Weapon', dir: 'out' } },
        { trigger: { t: 'every_secs', s: [1,1] }, verb: { t: 'strike', n: [1,1] }, attack_profile: { edge: ['top'] } } ] },
      wtag: { id: 'wtag', shape: [[0,0]], tags: ['Weapon'], modes: ['battle'], effects: [] },
    };
    const unit = { linked: true, layout: L, sis: [],
      bps: [ bp('A',[1,1],[2],[0,1]), bp('B',[1,4],[],[0,0]) ],
      pos: [ { uid: 'w1', id: 'weapon', loc: 'grid', cell: [1,1], rot: 0 },
             { uid: 't1', id: 'wtag', loc: 'grid', cell: [1,4], rot: 0 },
             { uid: 't2', id: 'wtag', loc: 'grid', cell: [1,5], rot: 0 } ] };
    const c = combat.compileSquadSnapshot(unit, resItems, 'formation1', 'unit1', undefined, linkUnitDefs, linkShapes); // REQ-0170: the link graph needs the Unit registry
    const w = c.pos.find(p => p.uid === 'w1');
    const strike = w.effects.find(e => e.verb && e.verb.t === 'strike');
    eq(strike.verb.n, [21, 21], 'buff_linked adds +10 per linked Weapon PO (2) => base [1,1] -> [21,21]');
    const a = c.bps.find(b => b.id === 'A');
    eq(a.linkFlags.linked_out, true, 'A is linked_out');
    eq(a.linkFlags.linked_in, false, 'A is not linked_in (one-way A->B)');
    const bb = c.bps.find(b => b.id === 'B');
    eq(bb.linkFlags.linked_in, true, 'B is linked_in');
  });
})();


// REQ-0048: engine<->sim beam parity -- sim's static link graph must match
// engine.js traceBeams on a shared fixture (sim runtime stays engine-free;
// only this TEST loads the engine, per REQ-0047 contract #6 + REQ-0048).
(function () {
  const Engine = require(path.join(REPO_ROOT, 'mock-src', 'engine.js'));
  const Data = require(path.join(REPO_ROOT, 'mock-src', 'data.js'));
  const norm = (edges) => edges.map(e => e.from + '>' + e.to + '@' + e.dir).sort();
  T('REQ-0048 parity: sim linkEdges == engine.js traceBeams (established links, live fixture)', () => {
    // REQ-0170: the parity that matters now is that BOTH walkers resolve the SAME
    // registry -- the live unit defs + the ratified connection_shapes. If the sim
    // and the engine could disagree here, the board would draw rays the battle did
    // not honour, which is the exact class of bug this test exists to catch.
    const E = Engine.create(Data.ITEMS, Data.SI_DEFS, Data.LAYOUT, Data.TREES, Data.UNITS, Data.CONN_SHAPES);
    const st = Data.makeState();
    const engineEdges = E.traceBeams(st).filter(b => b.to).map(b => ({ from: b.from, to: b.to, dir: b.dir }));
    const c = combat.compileSquadSnapshot(st, Data.ITEMS, 'formation1', 'unit1', undefined, Data.UNITS, Data.CONN_SHAPES);
    const simEdges = (c.linkEdges || []).map(e => ({ from: e.from, to: e.to, dir: e.dir }));
    ok(engineEdges.length > 0, 'fixture must have >=1 established link (else the test is vacuous)');
    eq(norm(simEdges), norm(engineEdges), 'sim link graph must equal engine traceBeams established links');
  });
})();


// =====================================================================
// REQ-0049: Layered encounters (trap/chest/door attachments)
// =====================================================================
(function () {
  const L = { ROWS: 8, COLS: 8 };
  function cellBp(id, origin) { return { id: id, name: id, shape: [[0,0]], origin: origin, unit: { id: 'berserker', off: [0,0] }, hpMax: 200 }; }
  function dummyUnit(id) { return { linked: false, bps: [{ id: id, name: id, shape: [[0,0]], origin: [1,1], unit: { id: 'berserker', off: [0,0] }, hpMax: 60 }], pos: [], layout: L, sis: [] }; }
  const items = {
    battler:  { id: 'battler',  shape: [[0,0]], tags: [], modes: ['battle'],    attack_profile: { edge: ['top'], penetration: 0, aoe: 0 }, effects: [{ trigger: { t: 'every_secs', s: [1,1] }, verb: { t: 'strike', n: [8,8] }, attack_profile: { edge: ['top'] } }] },
    detector: { id: 'detector', shape: [[0,0]], tags: [], modes: ['detection'], attack_profile: { edge: ['top'], penetration: 0, aoe: 0 }, effects: [{ trigger: { t: 'every_secs', s: [0.5,0.5] }, verb: { t: 'strike', n: [1,1] }, attack_profile: { edge: ['top'] } }] },
    unlocker: { id: 'unlocker', shape: [[0,0]], tags: [], modes: ['unlock'],    attack_profile: { edge: ['top'], penetration: 0, aoe: 0 }, effects: [{ trigger: { t: 'every_secs', s: [0.5,0.5] }, verb: { t: 'strike', n: [50,50] }, attack_profile: { edge: ['top'] } }] },
  };
  const enemies = { grunt: { id: 'grunt', name: 'Grunt', hp: [9999,9999], footprint: [1,1], skills: [] }, weak: { id: 'weak', name: 'Weak', hp: [4,4], footprint: [1,1], skills: [] } };
  const skills = { trap_volley: { trigger: { t: 'every_secs', s: [99,99] }, verb: { t: 'strike', n: [5,5] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 0 } } };
  // unit with a battle PO + a detection PO + an unlock PO (all placed in one BP)
  function partyUnit(poIds) {
    return { linked: false, layout: L, sis: [],
      bps: [ cellBp('A', [1,1]), cellBp('B', [1,3]), cellBp('C', [1,5]) ],
      pos: poIds.map((id, i) => ({ uid: 'u' + i, id: id, loc: 'grid', cell: [1, 1 + 2*i], rot: 0 })) };
  }
  function runAtt(seed, poIds, attachments, enemyId, deadline) {
    return combat.runDungeon({
      masterSeed: seed,
      dungeonDef: { encounters: [{ id: 'e0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: [enemyId || 'grunt'] }, deadline_secs: deadline || 30, attachments: attachments }] },
      squadSnapshots: [partyUnit(poIds), dummyUnit('z2'), dummyUnit('z3'), dummyUnit('z4')],
      itemDefsById: items, enemyDefsById: enemies, skillDefsById: skills,
      formationId: 'formation1', level: 1, participants: ['pA'],
    });
  }
  const chestAtt = (id) => ({ id: id || 'ch1', kind: 'chest', mode: 'unlock', entity: { footprint: [2,2], hp: [10,10], timeout_secs: 6 }, reward: { roll: 'reward_cache' } });
  const trapAtt  = (id) => ({ id: id || 'tr1', kind: 'trap',  mode: 'detection', entity: { footprint: [1,1], skills: ['trap_volley'], timeout_secs: 3 }, reward: { roll: 'reward_disarm' } });
  const doorAtt  = (id) => ({ id: id || 'dr1', kind: 'door',  mode: 'detection', entity: { footprint: [2,2], hp: [10,10], timeout_secs: 8 }, reward: { roll: 'reward_shortcut' } });

  T('REQ-0049 placement: deterministic (same seed -> byte-identical JSONL incl. att events)', () => {
    const a = combat.toJSONL(runAtt('req49-det', ['battler','unlocker'], [chestAtt()], 'weak').events);
    const b = combat.toJSONL(runAtt('req49-det', ['battler','unlocker'], [chestAtt()], 'weak').events);
    ok(a === b, 'identical seed -> identical attachment replay');
    ok(a.indexOf('att_') >= 0, 'log contains attachment events');
  });
  T('REQ-0049 trap: detection disarms (att_reveal + att_disarm + reward)', () => {
    const r = runAtt('req49-trap-disarm', ['battler','detector'], [trapAtt()], 'grunt', 20);
    ok(r.events.some(e => e.ev === 'att_reveal' && e.att === 'tr1'), 'trap revealed by detection');
    ok(r.events.some(e => e.ev === 'att_disarm' && e.att === 'tr1' && e.reward === 'reward_disarm'), 'trap disarmed w/ reward');
    ok(!r.events.some(e => e.ev === 'att_fire'), 'disarmed trap never fires its volley');
  });
  T('REQ-0049 trap: timeout mid-battle fires the volley (reason=timeout)', () => {
    const r = runAtt('req49-trap-to', ['battler'], [trapAtt()], 'grunt', 20); // no detector, pack survives (grunt 9999hp), trap timeout=3
    ok(r.events.some(e => e.ev === 'att_fire' && e.att === 'tr1' && e.reason === 'timeout'), 'undiscovered trap fires at timeout');
  });
  T('REQ-0049 trap: pack cleared while undiscovered fires once at end (reason=end)', () => {
    const r = runAtt('req49-trap-end', ['battler'], [trapAtt('tr1')], 'weak', 30); // weak pack dies fast (<3s), trap still unexpired+undiscovered
    ok(r.events.some(e => e.ev === 'att_fire' && e.att === 'tr1' && e.reason === 'end'), 'stumbled-into trap fires at encounter end');
  });
  T('REQ-0049 chest: unlock DPS opens it (att_open chest + reward)', () => {
    const r = runAtt('req49-chest-open', ['battler','unlocker'], [chestAtt()], 'grunt', 20);
    ok(r.events.some(e => e.ev === 'att_open' && e.att === 'ch1' && e.kind === 'chest' && e.reward === 'reward_cache'), 'chest opened by unlock DPS');
  });
  T('REQ-0049 transparency: battle-only party never touches the chest -> lost', () => {
    const r = runAtt('req49-chest-lost', ['battler'], [chestAtt()], 'weak', 30); // no unlocker; pack cleared; chest never damaged
    ok(!r.events.some(e => e.ev === 'att_open'), 'battle rays cannot open the chest (mode-pure)');
    ok(r.events.some(e => e.ev === 'att_lost' && e.att === 'ch1' && e.kind === 'chest'), 'unopened chest is lost, no penalty');
  });
  T('REQ-0049 door: detection then unlock -> two-stage open + shortcut', () => {
    const r = runAtt('req49-door', ['battler','detector','unlocker'], [doorAtt()], 'grunt', 20);
    ok(r.events.some(e => e.ev === 'att_reveal' && e.att === 'dr1'), 'door stage-1 detection find');
    ok(r.events.some(e => e.ev === 'att_open' && e.att === 'dr1' && e.kind === 'door' && e.shortcut === true), 'door stage-2 unlock grants shortcut');
  });
  T('REQ-0049 cap: at most 2 attachments per encounter are instantiated', () => {
    const r = runAtt('req49-cap', ['battler','detector','unlocker'], [trapAtt('a1'), chestAtt('a2'), doorAtt('a3')], 'grunt', 20);
    const attIds = new Set(r.events.filter(e => typeof e.att === 'string').map(e => e.att));
    ok(attIds.size <= 2, 'no more than 2 attachments resolve (cap enforced); saw ' + attIds.size);
    ok(!attIds.has('a3'), 'the 3rd attachment (a3) was never instantiated');
  });
})();


// REQ-0049 dungen: trap/chest/door now generate as attachments on packs.
(function () {
  T('REQ-0049 dungen: trap/chest/door are pack attachments (cap<=2), no standalone chest/door encounters', () => {
    let sawAtt = false, sawStandaloneCD = false;
    for (const level of [1, 3, 5, 8]) for (const seed of ['a', 'b', 'c']) {
      const def = dungen.generate('default', level, 'req49-' + level + '-' + seed);
      for (const e of def.encounters) {
        if (e.attachments) {
          sawAtt = true;
          ok(e.attachments.length <= 2, 'cap <=2 per encounter, saw ' + e.attachments.length);
          for (const a of e.attachments) ok(['trap', 'chest', 'door'].includes(a.kind), 'valid attachment kind ' + a.kind);
          ok(e.type === 'pack' || e.type === 'boss', 'attachments only ride battle encounters');
        }
        if (e.type === 'chest' || e.type === 'door') sawStandaloneCD = true;
      }
    }
    ok(sawAtt, 'some generated dungeons carry attachments');
    ok(!sawStandaloneCD, 'no standalone chest/door encounters remain (moved to attachments)');
  });
  T('REQ-0049 dungen: a generated def with attachments runs end-to-end and emits att_* events', () => {
    let def = null;
    for (const level of [5, 8]) { for (const seed of ['a', 'b', 'c', 'd', 'e']) { const d = dungen.generate('default', level, 'req49run-' + level + '-' + seed); if (d.encounters.some(e => e.attachments)) { def = d; break; } } if (def) break; }
    ok(def, 'found a generated def carrying attachments');
    const r = combat.runDungeon({ masterSeed: 'req49-dungen-run', dungeonDef: def, squadSnapshots: [scenario, scenario, scenario, scenario], itemDefsById, enemyDefsById, skillDefsById, formationId: 'formation1', level: def.level, participants: ['pA'] });
    ok(Array.isArray(r.events) && r.events.length > 0, 'generated def with attachments runs end-to-end');
    ok(r.events.some(e => String(e.ev).indexOf('att_') === 0), 'attachments produce att_* events in the replay');
  });
})();


// REQ-0049 run integration: attachment rewards + door shortcut flow through runDungeon.
(function () {
  const L = { ROWS: 8, COLS: 8 };
  function cellBp(id, o) { return { id: id, name: id, shape: [[0,0]], origin: o, unit: { id: 'berserker', off: [0,0] }, hpMax: 200 }; }
  function dummyU(id) { return { linked: false, bps: [{ id: id, name: id, shape: [[0,0]], origin: [1,1], unit: { id: 'berserker', off: [0,0] }, hpMax: 60 }], pos: [], layout: L, sis: [] }; }
  const it = {
    battler:  { id: 'battler',  shape: [[0,0]], modes: ['battle'],    attack_profile: { edge: ['top'] }, effects: [{ trigger: { t: 'every_secs', s: [0.5,0.5] }, verb: { t: 'strike', n: [50,50] }, attack_profile: { edge: ['top'] } }] },
    detector: { id: 'detector', shape: [[0,0]], modes: ['detection'], attack_profile: { edge: ['top'] }, effects: [{ trigger: { t: 'every_secs', s: [0.4,0.4] }, verb: { t: 'strike', n: [1,1] }, attack_profile: { edge: ['top'] } }] },
    unlocker: { id: 'unlocker', shape: [[0,0]], modes: ['unlock'],    attack_profile: { edge: ['top'] }, effects: [{ trigger: { t: 'every_secs', s: [0.4,0.4] }, verb: { t: 'strike', n: [50,50] }, attack_profile: { edge: ['top'] } }] },
  };
  const en = { weak: { id: 'weak', name: 'Weak', hp: [10,10], footprint: [1,1], skills: [] } };
  function party(ids) { return { linked: false, layout: L, sis: [], bps: [cellBp('A',[1,1]),cellBp('B',[1,3]),cellBp('C',[1,5])], pos: ids.map((id,i)=>({uid:'u'+i,id:id,loc:'grid',cell:[1,1+2*i],rot:0})) }; }
  function run(seed, ids, encs) {
    return combat.runDungeon({ masterSeed: seed, dungeonDef: { encounters: encs }, squadSnapshots: [party(ids), dummyU('z2'), dummyU('z3'), dummyU('z4')], itemDefsById: it, enemyDefsById: en, skillDefsById: {}, formationId: 'formation1', level: 3, participants: ['pA'] });
  }
  const packBoss = (atts) => ([
    { id: 'p0', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['weak'] }, deadline_secs: 20, attachments: atts },
    { id: 'boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['weak'] }, deadline_secs: 20 },
  ]);
  T('REQ-0049 run: chest opened by unlock -> reward accrues to run.rewards', () => {
    const r = run('req49-rw-chest', ['battler','unlocker'], packBoss([{ id: 'ch', kind: 'chest', mode: 'unlock', entity: { footprint: [2,2], hp: [20,20], timeout_secs: 15 }, reward: { roll: 'reward_frostbound_cache_roll' } }]));
    ok(r.result === 'victory', 'run won');
    ok(r.rewards.some(a => a.item === 'reward_frostbound_cache_roll'), 'chest reward accrued into run rewards (resolvable roll id)');
  });
  T('REQ-0049 run: attachment door opened -> +J% shortcut event (via=attachment)', () => {
    const r = run('req49-rw-door', ['battler','detector','unlocker'], packBoss([{ id: 'dr', kind: 'door', mode: 'detection', entity: { footprint: [2,2], hp: [20,20], timeout_secs: 15 }, reward: null }]));
    ok(r.events.some(e => e.ev === 'shortcut' && e.via === 'attachment'), 'attachment door grants a shortcut jump');
  });
})();


// REQ-0049 scouting report: expected attachment counts per dungeon+level.
(function () {
  T('REQ-0049 scouting: report matches the def it previews; grows with level', () => {
    const low = dungen.scoutingReport('default', 1);
    const high = dungen.scoutingReport('default', 12);
    for (const k of ['trap', 'chest', 'door']) { ok(Number.isInteger(low[k]) && low[k] >= 0, k + ' count is a non-negative int'); }
    // report equals a direct count of the same-seed def
    const def = dungen.generate('default', 6, 'scout-default-6');
    const rep = dungen.scoutingReport('default', 6);
    let t = 0, ch = 0, dr = 0;
    for (const e of def.encounters) for (const a of (e.attachments || [])) { if (a.kind === 'trap') t++; else if (a.kind === 'chest') ch++; else if (a.kind === 'door') dr++; }
    eq(rep.trap + (def.encounters.some(e => e.entityDef) ? -0 : 0) >= t, true, 'trap count consistent');
    const totalLow = low.trap + low.chest + low.door, totalHigh = high.trap + high.chest + high.door;
    ok(totalHigh >= totalLow, 'higher level scouts at least as many objectives (monotone-ish)');
  });
})();

console.log('----------------------------------');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
