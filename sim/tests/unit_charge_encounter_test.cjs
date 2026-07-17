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
  // REQ-0200 real-delta helpers: killable soak (clear-time deltas), never-dying soak
  // (fires-count deltas over a full deadline), and a mild penetrating chipper.
  tank: { id: 'tank', name: 'Tank', hp: [900, 900], footprint: [1, 1], skills: [] },
  bigtank: { id: 'bigtank', name: 'BigTank', hp: [1000000, 1000000], footprint: [1, 1], skills: [] },
  nipper: { id: 'nipper', name: 'Nipper', hp: [100000, 100000], footprint: [1, 1], skills: ['cf_nip'] },
  // REQ-0212: an enemy carrying a flat block pool (battle_start damage_reduction fold ->
  // ref.damageReduction) -- the shield_break landing surface + a soak that survives to deadline.
  blocker: { id: 'blocker', name: 'Blocker', hp: [400, 400], footprint: [1, 1], skills: ['cf_armor'] },
};
const skillDefs = {
  cf_bite: { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [1, 1] }, attack_profile: { edge: ['top'], penetration: 6, aoe: 1 } },
  cf_nip: { trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [3, 3] }, attack_profile: { edge: ['top'], penetration: 6, aoe: 1 } },
  cf_armor: { trigger: { t: 'battle_start' }, verb: { t: 'damage_reduction', n: [30, 30] } }, // REQ-0212: folds to ref.damageReduction = 30 (enemy block pool)
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
function endT(r) { const e = r.events.filter(x => x.ev === 'encounter_end')[0]; return e ? e.t : Infinity; } // REQ-0200

// ---- F1: guard + determinism contract (no real effect until a charge actually SPENDS) ----
// REQ-0200 real-actor pass: a charge that FIRES now mutates real sim actors, so the old
// "any injected charge leaves the base stream byte-identical" claim is intentionally GONE
// (that mutation IS the feature). What still holds -- the real determinism guard -- is:
// (a) charge-less content is fully inert (0 charge events, undefined chargeState);
// (b) a charge PRESENT but never reaching capacity performs ZERO real mutations, so its
//     non-charge event stream stays byte-identical to the charge-less twin.
// Committed goldens (all charge-less) remain byte-identical -- proven by sim/tests/goldens.cjs.
T('fusion guard: charge-less is inert; an injected-but-never-spending charge mutates nothing (non-charge stream byte-identical) yet the manager IS live', () => {
  const base = run(compileFresh(), { seed: 'f1', enemies: ['biter'] });
  eq(chargeEvents(base).length, 0, 'no charge events on charge-less content');
  ok(base.chargeState === undefined, 'chargeState undefined when no BP carries charge');

  // A fire_on_full charge whose capacity is unreachable here: it accumulates from real
  // enemy hits but NEVER spends -> the real-actor sink is never invoked.
  const inertCharge = { trigger: { t: 'OnBPBeenHit' }, gain: 'count', capacity: [100000, 100000], spend: 'fire_on_full', effects: [{ verb: { t: 'strike', n: [5, 5] }, target: 'self' }] };
  const c2 = compileFresh();
  inject(c2, 'alpha', inertCharge, 'inert_probe');
  const run2 = run(c2, { seed: 'f1', enemies: ['biter'] });
  ok(run2.chargeState !== undefined, 'the charge manager IS built (a BP carries charge)');
  ok(run2.chargeState.instances.alpha.counter > 0, 'it accumulates from real enemy hits');
  eq(run2.chargeState.instances.alpha.spends, 0, 'but never reaches capacity -> never spends');
  eq(chargeEvents(run2).length, 0, 'no spend/stack events emitted');
  // no spend => no sink call => no real mutation => non-charge stream byte-identical.
  eq(stripSeq(run2.events.filter(e => String(e.ev).indexOf('unit_charge') !== 0)), stripSeq(base.events), 'a non-spending charge mutates NOTHING -- non-charge stream byte-identical');
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


// =====================================================================
// REAL-ACTOR OUTCOME DELTAS (REQ-0200 richer-adapter pass). Each runs a charged
// battle vs its charge-less twin at the SAME seed and asserts the REAL sim outcome
// changed (enemy hp / BP hp / status maps / item cadence) -- not just the runtime's
// own bookkeeping. Deterministic via the midpoint/rolled-range seam + fixed seeds.
// Extra non-attacking survivors keep the enemy roster: `tank` (killable soak),
// `bigtank` (never dies -> battle runs to deadline), `nipper` (mild penetrating chip).
// =====================================================================

// ---- RD1: dragonknight breath ENDS THE BATTLE SOONER (multi_strike into the enemy) ----
T('REAL delta -- dragonknight breath: on_damage_dealt banks real player damage, then fires multi_strike into the enemy side -> the tank dies STRICTLY sooner than without the charge', () => {
  const c = compileFresh();
  inject(c, 'alpha', kitById.dragonknight.charge, 'dragonknight'); // alpha carries the blade
  const charged = run(c, { seed: 'rd1', enemies: ['tank'], deadline: 60 });
  const control = run(compileFresh(), { seed: 'rd1', enemies: ['tank'], deadline: 60 });
  eq(charged.result, 'clear', 'charged run clears the tank');
  eq(control.result, 'clear', 'control run clears the tank');
  ok(charged.chargeState.instances.alpha.spends >= 1, 'the breath fired at least once');
  ok(endT(charged) < endT(control), 'breath damage into the enemy ends the battle sooner (' + endT(charged).toFixed(2) + ' < ' + endT(control).toFixed(2) + ')');
});

// ---- RD2: paladin shield REDUCES REAL BP HP LOSS (grant_shield -> real shield pool) ----
T('REAL delta -- paladin shield: on_heal_done grants a real shield to the lowest-hp linked BP; the shielded BP loses LESS hp to enemy fire', () => {
  const c = compileFresh();
  inject(c, 'gamma', kitById.paladin.charge, 'paladin');
  link(c, 'gamma', 'alpha');
  bpOf(c, 'gamma').statusBag.Regen = { stacks: 30 };   // drives on_heal_done via real Regen ticks
  const charged = run(c, { seed: 'rd2', enemies: ['nipper'], deadline: 10 });

  const cc = compileFresh();
  bpOf(cc, 'gamma').statusBag.Regen = { stacks: 30 };  // same heal source, no charge
  const control = run(cc, { seed: 'rd2', enemies: ['nipper'], deadline: 10 });

  ok(charged.chargeState.instances.gamma.spends >= 1, 'paladin fired grant_shield');
  ok(bpOf(c, 'alpha').hp > bpOf(cc, 'alpha').hp, 'shielded alpha keeps more hp (' + bpOf(c, 'alpha').hp + ' > ' + bpOf(cc, 'alpha').hp + ')');
  ok(bpOf(c, 'alpha').hp > 0 && bpOf(cc, 'alpha').hp > 0, 'both alphas survive (isolated delta = shield absorption)');
});

// ---- RD3: werewolf snowball (haste + buff_self) CLEARS THE PACK SOONER ----
T('REAL delta -- werewolf snowball: on_kill applies real Haste (shorter item cadence) + buff_self -> the pack clears sooner than without the charge', () => {
  const enemies = []; for (let i = 0; i < 9; i++) enemies.push('gob'); enemies.push('tank');
  const c = compileFresh();
  for (const id of ['alpha', 'gamma', 'delta']) inject(c, id, kitById.werewolf.charge, 'werewolf');
  const charged = run(c, { seed: 'rd3', enemies, deadline: 60 });
  const control = run(compileFresh(), { seed: 'rd3', enemies, deadline: 60 });
  eq(charged.result, 'clear', 'charged clears'); eq(control.result, 'clear', 'control clears');
  let spends = 0; for (const id of ['alpha', 'gamma', 'delta']) spends += charged.chargeState.instances[id].spends;
  ok(spends >= 1, 'werewolf fired at least once (real Haste applied)');
  ok(endT(charged) < endT(control), 'snowball clears the pack sooner (' + endT(charged).toFixed(2) + ' < ' + endT(control).toFixed(2) + ')');
});

// ---- RD4: pure haste ISOLATES the real cadence wiring -> STRICTLY more item fires ----
T('REAL delta -- haste isolates item-cadence: a synthetic haste-only charge applies real Haste to alpha and STRICTLY increases its blade fire count vs a survivor (no damage buff involved)', () => {
  const hasteOnly = { trigger: { t: 'every_secs', s: [2, 2] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'haste', n: [5, 5] }, target: 'self' }] };
  const c = compileFresh();
  inject(c, 'alpha', hasteOnly, 'haste_only');
  const charged = run(c, { seed: 'rd4', enemies: ['bigtank'], deadline: 20 });
  const control = run(compileFresh(), { seed: 'rd4', enemies: ['bigtank'], deadline: 20 });
  const bladeFires = (r) => r.events.filter(e => e.ev === 'ray_fire' && e.field === 'enemy' && e.cause !== 'charge' && e.src === 'blade').length;
  ok(bpOf(c, 'alpha').statusBag.Haste && bpOf(c, 'alpha').statusBag.Haste.stacks > 0, 'real Haste stacks on alpha statusBag');
  ok(bladeFires(charged) > bladeFires(control), 'shorter cadence => strictly more blade fires (' + bladeFires(charged) + ' > ' + bladeFires(control) + ')');
});

// ---- RD5: vampire lifesteal HEALS A REAL BP above its starting hp ----
T('REAL delta -- vampire lifesteal: grant_lifesteal on a linked attacker makes that BP heal from its own hits -> alpha ends ABOVE its wounded start hp', () => {
  const c = compileFresh();
  inject(c, 'beta', kitById.vampire.charge, 'vampire');
  link(c, 'beta', 'alpha');                 // alpha (blade) attacks -> vampire fires -> lifesteal to alpha
  bpOf(c, 'alpha').hp = 50;                  // wounded; dummy never attacks so hp only rises via lifesteal
  const charged = run(c, { seed: 'rd5', enemies: ['dummy'], deadline: 30 });

  const cc = compileFresh();
  bpOf(cc, 'alpha').hp = 50;
  const control = run(cc, { seed: 'rd5', enemies: ['dummy'], deadline: 30 });

  ok(charged.chargeState.instances.beta.spends >= 1, 'vampire fired grant_lifesteal');
  ok(bpOf(c, 'alpha').hp > 50, 'lifesteal healed alpha above its wounded start (' + bpOf(c, 'alpha').hp + ' > 50)');
  eq(bpOf(cc, 'alpha').hp, 50, 'without the charge alpha stays at 50 (no heal, no damage)');
  ok(bpOf(c, 'alpha').hp > bpOf(cc, 'alpha').hp, 'charged alpha ends healthier than the control');
});

// ---- RD6: samurai block + reflect land on the REAL damage pipeline ----
T('REAL delta -- samurai counter: OnBPBeenHit adds real flat block (reduceIncoming) and reflects real damage back onto the attacking enemy', () => {
  const c = compileFresh();
  inject(c, 'alpha', kitById.samurai.charge, 'samurai');
  const charged = run(c, { seed: 'rd6', enemies: ['nipper'], deadline: 14 });
  ok(charged.chargeState.instances.alpha.spends >= 1, 'samurai fired block + reflect_damage');
  ok(bpOf(c, 'alpha').damageReduction > 0, 'block added a real flat damage-reduction (' + bpOf(c, 'alpha').damageReduction + ')');
  ok(charged.events.some(e => e.ev === 'unit_charge_reflect' && e.amount > 0), 'reflect dealt real damage to the attacker');
});

// ---- RD7: witch on-hit rider applies a REAL status to struck enemies ----
T('REAL delta -- witch on-hit rider: add_on_hit_status attaches a real Burn rider to a linked attacker, whose hits then apply real Burn to enemies', () => {
  const c = compileFresh();
  inject(c, 'beta', kitById.witch.charge, 'witch');
  link(c, 'beta', 'alpha');
  const charged = run(c, { seed: 'rd7', enemies: ['dummy'], deadline: 14 });
  ok(charged.chargeState.instances.beta.spends >= 1, 'witch fired add_on_hit_status');
  ok(bpOf(c, 'alpha').chargeOnHit && bpOf(c, 'alpha').chargeOnHit.Burn > 0, 'a real Burn on-hit rider is attached to alpha');
  ok(charged.events.some(e => e.ev === 'unit_charge_onhit' && e.status === 'Burn'), 'alpha hits applied real Burn to a struck enemy');
});


// =====================================================================
// REQ-0212: charge_strike / transfer_status / shield_break -- end-to-end in the
// REAL encounter loop (combat.runEncounter), plus a validation-rejection test.
// =====================================================================

// ---- RD-CS: charge_strike damage LANDS (a) and SCALES with capacity (b) ----
T('REQ-0212 charge_strike: OnHit banks alpha blade hits; at capacity it strikes the enemy for n x stacks_spent -> a killable tank dies sooner, and (vs an undying soak) the per-strike amount SCALES with capacity', () => {
  const mkCharge = (cap) => ({ trigger: { t: 'OnHit' }, gain: 'count', capacity: [cap, cap], spend: 'fire_on_full', effects: [{ verb: { t: 'charge_strike', n: [10, 10] }, target: 'self' }] });
  const strikesOf = (r) => r.events.filter(e => e.ev === 'unit_charge_strike' && e.src === 'alpha');

  // (a) LANDS: vs a killable tank, the banked strike makes it die STRICTLY sooner than the charge-less twin.
  const cCharged = compileFresh(); inject(cCharged, 'alpha', mkCharge(4), 'powderkeg_probe');
  const charged = run(cCharged, { seed: 'cs1', enemies: ['tank'], deadline: 60 });
  const control = run(compileFresh(), { seed: 'cs1', enemies: ['tank'], deadline: 60 });
  eq(charged.result, 'clear', 'charged clears the tank');
  eq(control.result, 'clear', 'control clears the tank');
  const s4 = strikesOf(charged);
  ok(s4.length >= 1, 'charge_strike fired at least once (got ' + s4.length + ')');
  eq(s4[0].amount, 40, 'first strike = n_mid(10) x stacks_spent(4) = 40');
  eq(s4[0].stacks_spent, 4, 'stacks_spent == rolled capacity (4)');
  ok(endT(charged) < endT(control), 'charge_strike damage lands -> tank dies sooner (' + endT(charged).toFixed(2) + ' < ' + endT(control).toFixed(2) + ')');

  // (b) SCALES: vs an UNDYING bigtank (battle runs to deadline so both capacities reach a fire),
  // the per-strike amount == n_mid x capacity, so cap 8 strikes for twice cap 4.
  const b4 = compileFresh(); inject(b4, 'alpha', mkCharge(4), 'pk4');
  const b8 = compileFresh(); inject(b8, 'alpha', mkCharge(8), 'pk8');
  const r4 = run(b4, { seed: 'cs2', enemies: ['bigtank'], deadline: 40 });
  const r8 = run(b8, { seed: 'cs2', enemies: ['bigtank'], deadline: 40 });
  const f4 = strikesOf(r4), f8 = strikesOf(r8);
  ok(f4.length >= 1, 'cap-4 charge_strike fired vs the undying soak (got ' + f4.length + ')');
  ok(f8.length >= 1, 'cap-8 charge_strike fired vs the undying soak (got ' + f8.length + ')');
  eq(f4[0].amount, 40, 'cap 4 -> 10 x 4 = 40');
  eq(f8[0].amount, 80, 'cap 8 -> 10 x 8 = 80');
  ok(f8[0].amount > f4[0].amount, 'per-strike damage SCALES with capacity (' + f8[0].amount + ' > ' + f4[0].amount + ')');
});

// ---- RD-TS: transfer_status MOVES negative statuses host -> enemy ----
T('REQ-0212 transfer_status: a fire_on_full charge moves up to n negative statuses OFF the host BP onto the enemy, keeping their stacks (a MOVE, not a copy)', () => {
  const c = compileFresh();
  inject(c, 'alpha', { trigger: { t: 'every_secs', s: [1, 1] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'transfer_status', n: [2, 2] }, target: 'self' }] }, 'curseddoll_probe');
  bpOf(c, 'alpha').statusBag.Burn = { stacks: 40 };
  bpOf(c, 'alpha').statusBag.Poison = { stacks: 30 };
  const r = run(c, { seed: 'ts1', enemies: ['dummy'], deadline: 6 }); // dummy never attacks -> nothing re-applies debuffs to alpha
  const moves = r.events.filter(e => e.ev === 'unit_charge_transfer' && e.src === 'alpha');
  ok(moves.length >= 2, 'at least two statuses moved off the host (got ' + moves.length + ')');
  const kinds = new Set(moves.map(m => m.status));
  ok(kinds.has('Burn') && kinds.has('Poison'), 'both Burn and Poison were transferred (kinds=' + JSON.stringify([...kinds]) + ')');
  ok(moves.every(m => m.dst && m.dst.indexOf('dummy') === 0), 'each transfer landed on the enemy (dst=dummy)');
  ok(moves.some(m => m.status === 'Burn' && m.stacks > 0), 'the moved Burn kept its stacks (' + (moves.find(m => m.status === 'Burn') || {}).stacks + ')');
  ok(!bpOf(c, 'alpha').statusBag.Burn && !bpOf(c, 'alpha').statusBag.Poison, 'the host BP no longer carries the transferred statuses');
});

// ---- RD-SB: shield_break REDUCES the enemy block pool ----
T('REQ-0212 shield_break: an every_secs charge strips flat block off the enemy (ref.damageReduction 30 -> ... -> 0) -> the blocked enemy dies sooner than with its block intact', () => {
  const c = compileFresh();
  inject(c, 'alpha', { trigger: { t: 'every_secs', s: [1, 1] }, gain: 'count', capacity: [1, 1], spend: 'fire_on_full', effects: [{ verb: { t: 'shield_break', n: [10, 15] }, target: 'self' }] }, 'pickaxe_probe');
  const charged = run(c, { seed: 'sb1', enemies: ['blocker'], deadline: 60 });
  const control = run(compileFresh(), { seed: 'sb1', enemies: ['blocker'], deadline: 60 });
  const breaks = charged.events.filter(e => e.ev === 'unit_charge_shieldbreak' && e.dst.indexOf('blocker') === 0);
  ok(breaks.length >= 1, 'shield_break fired at least once (got ' + breaks.length + ')');
  eq(breaks[0].before, 30, 'first break sees the enemy block pool at 30');
  eq(breaks[0].after, 17.5, 'first break removes n_mid(12.5) -> 30 - 12.5 = 17.5');
  ok(breaks.some(b => b.after === 0), 'the block pool is driven to 0 (floored, never negative)');
  ok(breaks.every(b => b.after >= 0), 'block never goes below 0');
  eq(charged.result, 'clear', 'with the block stripped the squad clears the blocker');
  ok(endT(charged) < endT(control), 'stripping the enemy block lets damage land -> blocker dies sooner (' + endT(charged).toFixed(2) + ' < ' + endT(control).toFixed(2) + ')');
});

// ---- RD-REJ: charge_strike under a non-fire_on_full spend is REJECTED by name ----
T('REQ-0212 validation: charge_strike is REJECTED by name under passive_per_stack (legal only under fire_on_full)', () => {
  const { validateCharge } = require(path.join(REPO, 'shared', 'content_validate.cjs'));
  const vocab = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'vocab.json'), 'utf8'));
  // legal under fire_on_full -- must NOT throw
  validateCharge({ trigger: { t: 'OnBPBeenHit' }, gain: 'count', capacity: [10, 15], spend: 'fire_on_full', effects: [{ verb: { t: 'charge_strike', n: [4, 6] }, target: 'self' }] }, vocab, 'ok');
  // illegal under passive_per_stack -- must throw, naming charge_strike + fire_on_full
  let threw = false, msg = '';
  try { validateCharge({ trigger: { t: 'OnBPBeenHit' }, gain: 'count', capacity: [6, 10], spend: 'passive_per_stack', effects: [{ verb: { t: 'charge_strike', n: [4, 6] }, target: 'self' }] }, vocab, 'bad'); }
  catch (e) { threw = true; msg = e.message; }
  ok(threw, 'charge_strike under passive_per_stack must be rejected');
  ok(/charge_strike/.test(msg) && /fire_on_full/.test(msg), 'the reject names charge_strike + fire_on_full: ' + msg);
});

console.log('');
console.log('unit_charge_encounter_test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
