'use strict';
// sim/tests/unit_charge_test.cjs -- REQ-0200: the unit charge runtime test suite.
// Drives sim/lib/unit_charge.cjs across scenario fixtures AND the full 30-kit
// units003 corpus. Deterministic (no RNG). Mirrors the sim harness T()/eq()/ok().
const path = require('path');
const fs = require('fs');
const { resolveRolledRange, makeChargeTarget, groundVerb, createChargeEngine } = require(path.join(__dirname, '..', 'lib', 'unit_charge.cjs'));

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const REPO = path.join(__dirname, '..', '..');
const kits = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'tests', 'units003_kits.json'), 'utf8'));
const kitById = {}; for (const k of kits) kitById[k.id] = k;

function engineFor(instances, adjacency, opts) {
  const targets = {};
  const ids = new Set();
  for (const i of instances) ids.add(i.id);
  for (const id in (adjacency || {})) { ids.add(id); for (const x of adjacency[id]) ids.add(x); }
  for (const id of ids) targets[id] = makeChargeTarget(id);
  return createChargeEngine(Object.assign({ instances, adjacency: adjacency || {}, targets }, opts || {}));
}

// ---- 1. resolveRolledRange seam ----
T('seam: midpoint fallback + per-instance roll override (REQ-0190)', () => {
  eq(resolveRolledRange([2, 3], null, 'k'), 2.5, 'midpoint');
  eq(resolveRolledRange([80, 120], {}, 'k'), 100, 'midpoint2');
  eq(resolveRolledRange([2, 3], { 'x:cap': 9 }, 'x:cap'), 9, 'rolled');
  eq(resolveRolledRange(7, null, 'k'), 7, 'scalar passthrough');
});

// ---- 2. every_secs fire_on_full lands on units_connected (alchemist) ----
T('every_secs/fire_on_full: alchemist poisons a linked unit, resets counter', () => {
  const eng = engineFor([{ id: 'alch', unitId: 'alchemist', charge: kitById.alchemist.charge }, { id: 'ally', unitId: 'x', charge: null }], { alch: ['ally'], ally: ['alch'] });
  // period midpoint 4.5, cap midpoint 2.5 -> 3 firings. now=15 -> fires at 4.5/9/13.5.
  eng.feed({ type: 'timer', now: 15 });
  ok(eng.spendsOf('alch') === 1, 'exactly one spend, got ' + eng.spendsOf('alch'));
  eq(eng.counterOf('alch'), 0, 'counter reset');
  ok((eng.target('ally').onHitStatus.Poison || 0) > 0, 'ally got Poison on-hit rider');
});

// ---- 3. passive_per_stack caps stacks at capacity (darkknight) ----
T('passive_per_stack: darkknight stacks cap at midpoint capacity (15)', () => {
  const eng = engineFor([{ id: 'dk', unitId: 'darkknight', charge: kitById.darkknight.charge }], {});
  for (let i = 0; i < 20; i++) eng.feed({ type: 'bp_damaged', bpId: 'dk', amount: 5 });
  eq(eng.counterOf('dk'), 20, 'counter counts every hit');
  eq(eng.stacksOf('dk'), 15, 'stacks capped at floor(midpoint([12,18])=15)');
  eq(eng.spendsOf('dk'), 0, 'passive never spends');
  const se = eng.standingEffects('dk');
  eq(se, [{ verb: 'buff_self', target: 'self', stacks: 15 }], 'standing effect x stacks');
  const st = eng.target('dk').standing.buff_self;
  ok(st && Math.abs(st.total - 0.15 * 15) < 1e-9, 'standing buff total = base(0.15) x stacks(15), got ' + (st && st.total));
});

// ---- 4. damage-gain fire_on_full (dragonknight) ----
T('gain=damage: dragonknight banks damage, fires multi_strike + Burn on self', () => {
  const eng = engineFor([{ id: 'dragon', unitId: 'dragonknight', charge: kitById.dragonknight.charge }], {});
  eng.feed({ type: 'bp_attack', sourceId: 'dragon', amount: 100 }); // cap midpoint 100
  eq(eng.spendsOf('dragon'), 1, 'spent once at 100 banked');
  ok(eng.target('dragon').damageTaken > 0, 'self multi_strike damage applied');
  ok((eng.target('dragon').onHitStatus.Burn || 0) > 0, 'self Burn on-hit');
});

// ---- 5a. target selector: bp_connected_lowest_hp (paladin) ----
T('target bp_connected_lowest_hp: paladin shields the most-hurt linked BP', () => {
  const eng = engineFor([{ id: 'pal', unitId: 'paladin', charge: kitById.paladin.charge }, { id: 'hurt', charge: null }, { id: 'fine', charge: null }], { pal: ['hurt', 'fine'] });
  eng.target('hurt').hp = 10; eng.target('fine').hp = 90;
  eng.feed({ type: 'bp_healed', bpId: 'pal' }); eng.feed({ type: 'bp_healed', bpId: 'pal' }); eng.feed({ type: 'bp_healed', bpId: 'pal' });
  ok(eng.spendsOf('pal') >= 1, 'paladin spent on heals');
  ok(eng.target('hurt').shield > 0, 'shield went to the low-hp BP');
  eq(eng.target('fine').shield, 0, 'not the healthy BP');
});

// ---- 5b. target selector: bp_connected_max_cooldown_item (wizard) ----
T('target bp_connected_max_cooldown_item: wizard advances the slowest linked item', () => {
  const eng = engineFor([{ id: 'wiz', unitId: 'wizard', charge: kitById.wizard.charge }, { id: 'slow', charge: null }, { id: 'fast', charge: null }], { wiz: ['slow', 'fast'] });
  eng.target('slow').itemCooldown = 9; eng.target('fast').itemCooldown = 1;
  eng.feed({ type: 'timer', now: 30 });
  ok(eng.spendsOf('wiz') >= 1, 'wizard spent');
  ok(eng.target('slow').cooldownAdvanced > 0, 'advanced the max-cooldown item');
  eq(eng.target('fast').cooldownAdvanced, 0, 'not the fast item');
});

// ---- 5c. units_connected_distributed splits the amount ----
T('target units_connected_distributed: amount split across linked units', () => {
  const charge = { trigger: { t: 'on_own_passive_fire' }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'heal_bp', n: [8, 8] }, target: 'units_connected_distributed' }] };
  const eng = engineFor([{ id: 'src', charge }, { id: 'a', charge: null }, { id: 'b', charge: null }], { src: ['a', 'b'] });
  eng.feed({ type: 'passive_fired', instanceId: 'src' });
  eq(eng.target('a').healed, 4, 'split 8/2'); eq(eng.target('b').healed, 4, 'split 8/2');
});

// ---- 6. cascade safety: a grant_charge loop terminates; fills defer to settle() ----
T('cascade: grant_charge fill defers to next tick; chain advances one bounded hop/tick', () => {
  // A: every_secs, grant_charge -> B (cap 1). B: on_connected_unit_spend, grant_charge -> A (cap 1).
  // This is the king<->jester grant loop: legitimately SUSTAINED across ticks, but with no
  // same-tick blow-up. Each grant_charge fill defers, so exactly one hop resolves per tick.
  const A = { trigger: { t: 'every_secs', s: [5, 5] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'grant_charge', n: [1, 1] }, target: 'units_connected' }] };
  const B = { trigger: { t: 'on_connected_unit_spend' }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'grant_charge', n: [1, 1] }, target: 'units_connected' }] };
  const eng = engineFor([{ id: 'A', charge: A }, { id: 'B', charge: B }], { A: ['B'], B: ['A'] });
  let threw = false; try { eng.feed({ type: 'timer', now: 5 }); } catch (e) { threw = true; }
  ok(!threw, 'feed did not throw / same-tick infinite loop');
  eq(eng.spendsOf('A'), 1, 'A spent once this tick');
  eq(eng.spendsOf('B'), 0, 'B was grant_charge-filled -> DEFERRED, did NOT spend same tick');
  ok(eng.hasDeferred(), 'B queued for the next tick');
  eng.settle(); // next tick: B spends exactly one hop later, and refills A (deferred again)
  eq(eng.spendsOf('B'), 1, 'B spends exactly one hop later');
  eq(eng.spendsOf('A'), 1, 'A did not double-spend this tick (its refill is deferred)');
  ok(eng.hasDeferred(), 'one bounded hop per tick -- a sustained loop, never a same-tick blow-up');
});

// ---- 7. on_kill fires once per enemy death ----
T('on_kill: werewolf gains once per distinct enemy death, never per-hit', () => {
  const eng = engineFor([{ id: 'wolf', unitId: 'werewolf', charge: kitById.werewolf.charge }], {});
  eng.feed({ type: 'enemy_killed', sourceId: 'wolf', enemyId: 'goblin1' });
  eng.feed({ type: 'enemy_killed', sourceId: 'wolf', enemyId: 'goblin1' }); // dup -> ignored
  eq(eng.counterOf('wolf'), 1, 'dup death ignored');
  eng.feed({ type: 'enemy_killed', sourceId: 'wolf', enemyId: 'goblin2' });
  eq(eng.counterOf('wolf'), 2, 'distinct death counts');
});

// ---- 8. transform swaps the unit def id ----
T('spend=transform: swaps unitId at capacity (minimal expressibility)', () => {
  const charge = { trigger: { t: 'every_secs', s: [4, 4] }, gain: 'count', capacity: [2, 2], spend: 'transform', transform_to: 'form_two' };
  const eng = engineFor([{ id: 'u', unitId: 'form_one', charge }], {});
  eng.feed({ type: 'timer', now: 8 }); // fires at 4 and 8 -> counter 2 -> transform
  eq(eng.unitIdOf('u'), 'form_two', 'unit def swapped');
});

// ---- 9. per-instance roll override flows through the seam ----
T('seam wiring: instanceRolls overrides capacity end-to-end', () => {
  const eng = createChargeEngine({ instances: [{ id: 'r', charge: kitById.knight.charge }], adjacency: {}, targets: { r: makeChargeTarget('r') }, instanceRolls: { 'r:cap': 5 } });
  eq(eng.capacityOf('r'), 5, 'rolled capacity used instead of midpoint');
});

// ---- 10. determinism: identical runs produce identical target logs ----
function runAlchemist() {
  const eng = engineFor([{ id: 'alch', charge: kitById.alchemist.charge }, { id: 'ally', charge: null }], { alch: ['ally'], ally: ['alch'] });
  eng.feed({ type: 'timer', now: 15 });
  return JSON.stringify(eng.target('ally').log);
}
T('determinism: two identical runs -> byte-identical effect logs', () => { eq(runAlchemist(), runAlchemist(), 'runs differ'); });

// ---- 11. FULL CORPUS SWEEP: every kit reaches capacity + spends/stacks; no unhandled verb ----
function stormOneKit(kit) {
  const primer = { id: 'primer', unitId: 'primer', charge: { trigger: { t: 'every_secs', s: [1, 1] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'strike', n: [1, 1] }, target: 'self' }] } };
  const inst = [{ id: kit.id, unitId: kit.id, charge: kit.charge }, primer];
  const adj = {}; adj[kit.id] = ['primer']; adj.primer = [kit.id];
  const eng = engineFor(inst, adj);
  // give selector inputs some spread so max/min selectors have a definite winner
  if (eng.target(kit.id)) { eng.target(kit.id).itemCooldown = 3; eng.target(kit.id).hp = 40; }
  for (let i = 1; i <= 40; i++) {
    eng.feed({ type: 'timer', now: i * 5 });
    eng.feed({ type: 'bp_attack', sourceId: kit.id, amount: 200 });
    eng.feed({ type: 'bp_attack', sourceId: 'primer', amount: 200 });
    eng.feed({ type: 'bp_damaged', bpId: kit.id, amount: 200 });
    eng.feed({ type: 'bp_damaged', bpId: 'primer', amount: 200 });
    eng.feed({ type: 'bp_healed', bpId: kit.id });
    eng.feed({ type: 'status_applied', sourceId: kit.id });
    eng.feed({ type: 'enemy_killed', sourceId: kit.id, enemyId: 'e' + i });
    eng.feed({ type: 'passive_fired', instanceId: kit.id });
    let g = 0; while (eng.hasDeferred() && g++ < 100) eng.settle();
  }
  return eng;
}
T('corpus: all 30 kits drive to capacity + fire/stack, no unhandled verb grounding', () => {
  let fired = 0, stacked = 0;
  const verbsSeen = new Set();
  for (const kit of kits) {
    const eng = stormOneKit(kit);
    const spend = kit.charge.spend;
    if (spend === 'passive_per_stack') { ok(eng.stacksOf(kit.id) > 0, kit.id + ': expected stacks > 0'); stacked++; }
    else { ok(eng.spendsOf(kit.id) > 0, kit.id + ': expected at least one spend'); fired++; }
    // no target log entry may be an 'unhandled' grounding
    for (const tid in eng.instances) { const t = eng.target(tid); if (!t) continue; for (const r of t.log) { verbsSeen.add(r.verb); ok(r.kind !== 'unhandled', kit.id + ': verb ' + r.verb + ' fell through to unhandled'); } for (const k in t.standing) verbsSeen.add(k); }
  }
  ok(fired === 27 && stacked === 3, 'expected 27 fire_on_full + 3 passive across corpus, got ' + fired + '/' + stacked);
  // every verb the corpus uses got a real grounding
  // grant_charge is grounded STRUCTURALLY (routes to a counter, verified by the cascade
  // scenario), so it never appears in a targets log -- exempt it here.
  for (const kit of kits) for (const e of (kit.charge.effects || [])) if (e.verb.t !== 'grant_charge') ok(verbsSeen.has(e.verb.t), 'verb ' + e.verb.t + ' never grounded');
});

console.log('');
console.log('unit_charge_test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);


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
