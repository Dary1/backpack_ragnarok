'use strict';
// sim/tests/unit_charge_encounter_test.cjs -- REQ-0200: the FUSION integration suite.
// Drives the REAL encounter loop (sim/lib/encounter.cjs -> runEncounter) with small
// battles whose player BPs carry `charge` blocks (drawn from tools/tests/units003_kits.json,
// plus two synthetic blocks for grammar shapes no live kit uses). Proves the charge
// runtime ACCUMULATES from real combat events (enemy hits, player hits, kills, heals,
// timer ticks, connected-unit events) and FIRES/STACKS inside the deterministic loop,
// with link topology resolved from the compiled connection_shape graph (bp.linkOut).
// Deterministic (fixed seeds; the runtime uses no RNG). Mirrors the sim harness.
const fs = require('fs');
const path = require('path');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));

const REPO = path.join(__dirname, '..', '..');
const scenario = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {}; for (const e of liveItems.entries) itemDefsById[e.id] = e;
const kits = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'tests', 'units003_kits.json'), 'utf8'));
const kitById = {}; for (const k of kits) kitById[k.id] = k;

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

// Enemy rosters: `biter` attacks (drives defensive/connected triggers + survives to
// deadline so player POs keep landing hits); `dummy` never attacks (controlled hp for
// selector fixtures); `gob` dies fast (drives on_kill).
const enemyDefs = {
  biter: { id: 'biter', name: 'Biter', hp: [100000, 100000], footprint: [1, 1], skills: ['cf_bite'] },
  dummy: { id: 'dummy', name: 'Dummy', hp: [100000, 100000], footprint: [1, 1], skills: [] },
  gob: { id: 'gob', name: 'Gob', hp: [6, 6], footprint: [1, 1], skills: [] },
};
const skillDefs = {
  cf_bite: { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [1, 1] }, attack_profile: { edge: ['top'], penetration: 6, aoe: 1 } },
};

function compileFresh() { return combat.compileSquadSnapshot(combat.deepCopy(scenario), itemDefsById, 'formation1', 'unit1'); }
function bpOf(c, id) { return c.bps.find(b => b.id === id); }
function inject(c, id, charge, unitId) { const b = bpOf(c, id); b.charge = charge; b.unitId = unitId || id; return b; }
function link(c, a, b) { const A = bpOf(c, a), B = bpOf(c, b); A.linkOut = (A.linkOut || []).concat([{ to: b, dir: null, mutual: true }]); B.linkOut = (B.linkOut || []).concat([{ to: a, dir: null, mutual: true }]); }
function run(c, opts) {
  opts = opts || {};
  return combat.runEncounter({
    rng: combat.makeRng(opts.seed || 'charge-fuse'), encIndex: 0,
    troopBps: c.bps, troopPos: c.pos, troopSis: c.sis || [],
    formationBox: { formationId: 'formation1' },
    enemyDefsById: enemyDefs, skillDefsById: skillDefs,
    encounterDef: { id: 'ce', type: 'pack', mode: 'battle', enemyPack: { enemyIds: opts.enemies || ['biter'] }, deadline_secs: opts.deadline || 40 },
    seedLabel: opts.seed || 'charge-fuse',
  });
}
function chargeEvents(r) { return r.events.filter(e => String(e.ev).indexOf('unit_charge') === 0); }
function spendEvents(r, id) { return r.events.filter(e => e.ev === 'unit_charge_spend' && e.id === id); }
function stripSeq(events) { return events.map(e => { const c = Object.assign({}, e); delete c.seq; return c; }); }

// ---- F1: guard + byte-identity (the no-op-on-charge-less contract) ----
T('fusion guard: charge-less encounter emits ZERO charge events + undefined chargeState; injecting charge adds ONLY unit_charge_* (base stream byte-identical)', () => {
  const base = run(compileFresh(), { seed: 'f1', enemies: ['biter'] });
  eq(chargeEvents(base).length, 0, 'no charge events on charge-less content');
  ok(base.chargeState === undefined, 'chargeState undefined when no BP carries charge');

  const c2 = compileFresh();
  inject(c2, 'alpha', kitById.darkknight.charge, 'darkknight');
  const charged = run(c2, { seed: 'f1', enemies: ['biter'] });
  ok(chargeEvents(charged).length > 0, 'charge events present once a BP carries charge');
  // the ONLY difference between the two event streams is the added unit_charge_* events
  const baseStream = stripSeq(base.events);
  const chargedBase = stripSeq(charged.events.filter(e => String(e.ev).indexOf('unit_charge') !== 0));
  eq(chargedBase, baseStream, 'fusion adds ONLY unit_charge_* events -- non-charge stream is byte-identical');
});

// ---- F2: passive_per_stack cap (darkknight, OnBPBeenHit) ----
T('passive_per_stack: darkknight stacks from real enemy hits, capped at midpoint capacity (15)', () => {
  const c = compileFresh();
  inject(c, 'alpha', kitById.darkknight.charge, 'darkknight');
  const r = run(c, { seed: 'f2', enemies: ['biter'], deadline: 60 });
  const s = r.chargeState.instances.alpha;
  ok(s.counter > 15, 'counter counts every OnBPBeenHit (got ' + s.counter + ')');
  eq(s.stacks, 15, 'stacks capped at floor(midpoint([12,18])) = 15');
  eq(s.spends, 0, 'passive_per_stack never spends');
  ok(r.events.some(e => e.ev === 'unit_charge_stack' && e.id === 'alpha'), 'unit_charge_stack emitted into the stream');
  const st = r.chargeState.targets.alpha.standing.buff_self;
  ok(st && st.stacks === 15, 'standing buff_self carries 15 stacks');
});

// ---- F3: gain=damage fire_on_full (dragonknight, on_damage_dealt) ----
T('gain=damage: dragonknight banks real player damage, fires multi_strike + Burn on self', () => {
  const c = compileFresh();
  inject(c, 'alpha', kitById.dragonknight.charge, 'dragonknight'); // alpha carries blade (strike)
  const r = run(c, { seed: 'f3', enemies: ['biter'], deadline: 40 });
  const sp = spendEvents(r, 'alpha');
  ok(sp.length >= 1, 'dragonknight fired at least once from banked damage (got ' + sp.length + ')');
  const verbs = sp[0].effects.map(e => e.verb);
  ok(verbs.indexOf('multi_strike') >= 0, 'spend applied multi_strike on self');
  ok(r.chargeState.targets.alpha.onHitStatus.Burn > 0, 'Burn on-hit rider attached to self');
});

// ---- F4: every_secs fire_on_full + units_connected AND on_connected_unit_attack ----
T('fire_on_full: alchemist fires on a timer at a linked unit; bard fires when a linked unit attacks', () => {
  const c = compileFresh();
  inject(c, 'delta', kitById.alchemist.charge, 'alchemist'); // every_secs
  link(c, 'delta', 'gamma');                                 // alchemist -> gamma (units_connected)
  inject(c, 'beta', kitById.bard.charge, 'bard');            // on_connected_unit_attack
  link(c, 'beta', 'alpha');                                  // alpha (blade) attacks -> bard on beta
  const r = run(c, { seed: 'f4', enemies: ['biter'], deadline: 40 });
  const alch = spendEvents(r, 'delta');
  ok(alch.length >= 1, 'alchemist (every_secs) fired (got ' + alch.length + ')');
  ok(alch[0].effects.every(e => e.to === 'gamma'), 'alchemist add_on_hit_status landed on the linked unit (gamma)');
  ok(spendEvents(r, 'beta').length >= 1, 'bard fired from a connected unit attacking');
});

// ---- F5: grant_charge cascade deferral -- king<->jester loop TERMINATES ----
T('cascade: king+jester grant_charge loop is a sustained bounded chain, never a same-tick blow-up', () => {
  const c = compileFresh();
  inject(c, 'gamma', kitById.king.charge, 'king');   // every_secs, grant_charge -> jester
  inject(c, 'delta', kitById.jester.charge, 'jester'); // on_connected_unit_spend, grant_charge -> king
  link(c, 'gamma', 'delta');
  let threw = false, r = null;
  try { r = run(c, { seed: 'f5', enemies: ['biter'], deadline: 40 }); } catch (e) { threw = true; }
  ok(!threw, 'loop terminated -- no MAX_CASCADE throw / same-tick infinite spend');
  ok(r && r.result, 'encounter completed with a result');
  ok(r.chargeState.instances.gamma.spends >= 1, 'king spent (timer-driven)');
  ok(r.chargeState.instances.delta.spends >= 1, 'jester spent (via on_connected_unit_spend + deferred grant)');
  ok(r.events.length < 200000, 'bounded event count -- chain did not explode');
});

// ---- F6: on_kill fires once per DISTINCT enemy death (dedup) ----
T('on_kill: werewolf gains once per distinct enemy killed (deduped) across real deaths', () => {
  const c = compileFresh();
  // werewolf on every offensive BP so every kill is credited to a werewolf-bearing BP.
  for (const id of ['alpha', 'gamma', 'delta']) inject(c, id, kitById.werewolf.charge, 'werewolf');
  const r = run(c, { seed: 'f6', enemies: ['gob', 'gob', 'gob', 'gob', 'gob', 'gob'], deadline: 40 });
  eq(r.result, 'clear', 'all enemies killed');
  // capacity midpoint 2.5 -> fires at 3 kills; kills_i = 3*spends_i + counter_i.
  let totalKills = 0;
  for (const id of ['alpha', 'gamma', 'delta']) { const s = r.chargeState.instances[id]; totalKills += 3 * s.spends + s.counter; }
  eq(totalKills, 6, 'exactly 6 distinct kills counted (dedup: never per-hit)');
});

// ---- F7: on_heal_done + bp_connected_lowest_hp selector (paladin) ----
T('on_heal_done + bp_connected_lowest_hp: paladin heals fire it; grant_shield lands on the lowest-hp linked BP', () => {
  const c = compileFresh();
  inject(c, 'gamma', kitById.paladin.charge, 'paladin');
  link(c, 'gamma', 'alpha'); link(c, 'gamma', 'delta');
  // controlled live hp: alpha most hurt, delta healthy (dummy never attacks -> hp is stable)
  bpOf(c, 'alpha').hp = 10; bpOf(c, 'delta').hp = 55;
  // drive real heals on the paladin BP via a Regen status (status_tick -> on_heal_done)
  combat.applyStatus ? combat.applyStatus(bpOf(c, 'gamma').statusBag, 'Regen', 10) : (bpOf(c, 'gamma').statusBag.Regen = { stacks: 10 });
  const r = run(c, { seed: 'f7', enemies: ['dummy'], deadline: 40 });
  const sp = spendEvents(r, 'gamma');
  ok(sp.length >= 1, 'paladin fired from on_heal_done (got ' + sp.length + ')');
  ok(sp.every(e => e.effects.every(x => x.to === 'alpha')), 'grant_shield always targeted the lowest-hp linked BP (alpha)');
  ok(r.chargeState.targets.alpha.shield > 0 && r.chargeState.targets.delta.shield === 0, 'shield went to alpha, not delta');
});

// ---- F8: advance_cooldown + bp_connected_max_cooldown_item selector (wizard) ----
T('advance_cooldown + bp_connected_max_cooldown_item: wizard advances the slowest-item linked BP', () => {
  const c = compileFresh();
  inject(c, 'beta', kitById.wizard.charge, 'wizard');
  link(c, 'beta', 'alpha'); link(c, 'beta', 'delta'); // cdProxy: alpha(blade 2.0) > delta(beast_jaw 1.55)
  const r = run(c, { seed: 'f8', enemies: ['dummy'], deadline: 40 });
  const sp = spendEvents(r, 'beta');
  ok(sp.length >= 1, 'wizard fired (every_secs)');
  ok(sp.every(e => e.effects.every(x => x.to === 'alpha')), 'advance_cooldown targeted the max-cooldown linked BP (alpha)');
  ok(r.chargeState.targets.alpha.cooldownAdvanced > 0 && r.chargeState.targets.delta.cooldownAdvanced === 0, 'only alpha advanced');
});

// ---- F9: fire_items (hero) + grant_lifesteal (vampire) effects land ----
T('effects: hero fire_items on self (on_damage_dealt); vampire grant_lifesteal on a linked attacker', () => {
  const c = compileFresh();
  inject(c, 'gamma', kitById.hero.charge, 'hero');   // gamma carries dagger (strike) -> on_damage_dealt
  inject(c, 'beta', kitById.vampire.charge, 'vampire');
  link(c, 'beta', 'alpha');                          // alpha (blade) attacks -> vampire on beta
  const r = run(c, { seed: 'f9', enemies: ['biter'], deadline: 40 });
  ok(spendEvents(r, 'gamma').length >= 1, 'hero fired from banked damage');
  ok(r.chargeState.targets.gamma.firedItems.length > 0, 'hero fire_items recorded on self');
  ok(spendEvents(r, 'beta').length >= 1, 'vampire fired from a linked attacker');
  ok(r.chargeState.targets.alpha.lifesteal.length > 0, 'vampire grant_lifesteal landed on the linked unit');
});

// ---- F10: units_connected_distributed splits the amount (synthetic grammar shape) ----
T('units_connected_distributed: a heal_bp split evenly across linked units (synthetic block)', () => {
  const c = compileFresh();
  const synth = { trigger: { t: 'every_secs', s: [1, 1] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'heal_bp', n: [8, 8] }, target: 'units_connected_distributed' }] };
  inject(c, 'beta', synth, 'synth_distrib');
  link(c, 'beta', 'alpha'); link(c, 'beta', 'gamma');
  const r = run(c, { seed: 'f10', enemies: ['dummy'], deadline: 20 });
  ok(spendEvents(r, 'beta').length >= 1, 'synthetic distributor fired');
  const ha = r.chargeState.targets.alpha.healed, hg = r.chargeState.targets.gamma.healed;
  ok(ha > 0 && ha === hg, 'both linked units healed equally');
  eq(ha % 4, 0, 'each fire split 8 across 2 linked units -> 4 each');
});

// ---- F11: spend=transform swaps the unit def (synthetic grammar shape) ----
T('spend=transform: an every_secs transform swaps unitId at capacity (synthetic block)', () => {
  const c = compileFresh();
  const synth = { trigger: { t: 'every_secs', s: [2, 2] }, gain: 'count', capacity: [2, 2], spend: 'transform', transform_to: 'form_two' };
  inject(c, 'delta', synth, 'form_one');
  const r = run(c, { seed: 'f11', enemies: ['dummy'], deadline: 20 });
  eq(r.chargeState.instances.delta.unitId, 'form_two', 'unit def swapped at capacity');
  ok(r.events.some(e => e.ev === 'unit_charge_transform' && e.id === 'delta'), 'transform emitted into the stream');
});

// ---- F12: link topology resolved from the REAL connection_shape machinery ----
T('link topology: adjacency comes from the compiled connection_shape graph (bp.linkOut), not hand-set', () => {
  // compile WITH a unit registry + connection_shapes so compile.cjs derives bp.linkOut
  // from each unit's connection_shape (the same graph the board links over).
  const connShapes = { plus: { kind: 'line', dirs: [0, 2, 4, 6], range: 0, pierce: false } };
  const unitDefs = {
    dwarf: { id: 'dwarf', connection_shape: 'plus', charge: kitById.fairy.charge },       // alpha
    elf: { id: 'elf', connection_shape: 'plus' },                                          // beta
    angel: { id: 'angel', connection_shape: 'plus' },                                      // gamma
    lightcavalry: { id: 'lightcavalry', connection_shape: 'plus' },                        // delta
  };
  const c = combat.compileSquadSnapshot(combat.deepCopy(scenario), itemDefsById, 'formation1', 'unit1', undefined, unitDefs, connShapes);
  const fairyBp = c.bps.find(b => b.charge && b.unitId === 'dwarf');
  ok(fairyBp, 'compile attached the fairy charge block from the unit def (dwarf)');
  ok((fairyBp.linkOut || []).length > 0, 'compile derived links from the connection_shape (non-empty linkOut)');
  const r = run(c, { seed: 'f12', enemies: ['dummy'], deadline: 20 });
  const adj = r.chargeState.adjacency[fairyBp.id] || [];
  eq(adj.slice().sort(), (fairyBp.linkOut || []).map(e => e.to).sort(), 'manager adjacency == compiled linkOut targets');
  const sp = spendEvents(r, fairyBp.id);
  ok(sp.length >= 1, 'fairy fired on a timer over its connection_shape-derived links');
  ok(sp[0].effects.every(e => adj.indexOf(e.to) >= 0), 'heal_bp landed only on connection_shape-linked units');
});

console.log('');
console.log('unit_charge_encounter_test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
