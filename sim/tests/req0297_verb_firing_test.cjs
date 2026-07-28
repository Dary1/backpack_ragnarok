'use strict';
// sim/tests/req0297_verb_firing_test.cjs -- REQ-0297 Phase 1.
//
// Faction-neutral verb-firing matrix. For every monster (EnemySkill) reactive/
// timed trigger x every SUPPORTED ray/rider verb, this runs the verb as a
// MONSTER skill both as ATTACKER (its every_secs hit lands + its OnHit/
// OnSquadHit rider fires) AND as a struck DEFENDER (its OnSquadBeenHit
// retaliation fires), inside the headless monster-vs-monster arena
// (sim/balance/monster_arena.cjs), and asserts the verb actually FIRES and has
// an observable EFFECT (damage dealt / status applied / ally healed).
//
// PURPOSE: catch, by construction, any verb/trigger that silently no-ops when
// driven by a monster (e.g. a dispatch still hardcoded to the player side).
// Verbs / triggers intentionally unsupported as monster reactive/timed ray
// riders are ENUMERATED + documented here (not exercised), and the coverage
// tests fail if a NEW vocab verb/EnemySkill trigger is added without being
// classified.
//
// Wiring: run.cjs require()s register(harness) so `node sim/tests/run.cjs`
// executes these; also self-runs standalone (`node .../req0297_verb_firing_test.cjs`).
const path = require('path');
const fs = require('fs');
const { runMonsterArena } = require(path.join(__dirname, '..', 'balance', 'monster_arena.cjs'));

const REPO_ROOT = path.join(__dirname, '..', '..');
const vocab = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'vocab.json'), 'utf8'));

// Generous attack profile: high penetration means a battle ray never terminates
// early on the (few) arena occupants, so it bounces to 5 and strikes ALL live
// opponents (walkRay ray_hit_all) -- geometry-independent, so "the hit lands"
// is deterministic regardless of entry-cell jitter.
const AP = { edge: ['top'], direction: 'front', penetration: 30, aoe: 2, aoe_statuses: true };

// ---- monster verb classification (every vocab.verbs entry is placed) -------
// DAMAGE/STATUS via fireSkillRay/dealHitOnField -- valid as a monster TIMED
// (every_secs) skill AND as an OnSquadBeenHit retaliation.
const RAY_VERBS = ['strike', 'multi_strike', 'apply_status', 'add_on_hit_status', 'bonus_vs_status', 'lifesteal'];
// Handled by applyReactiveVerbToTarget -- valid as OnHit/OnSquadHit OFFENSIVE
// riders. bonus_vs_status is intentionally absent (no branch -> no-op rider).
const RIDER_VERBS = ['strike', 'multi_strike', 'apply_status', 'add_on_hit_status', 'lifesteal'];
// Monster heal_ally: TIMED support skill (REQ-0203); own branch in
// fireEnemyInstanceSlot (not a ray), heals the lowest-HP pack ally.
const SUPPORT_VERBS = ['heal_ally'];
// Everything else in vocab.verbs is NOT a monster reactive/timed ray/rider verb
// in Phase 1 -- documented category each (player-PO / unit-charge only, or a
// battle_start-folded self/defence buff resolved in compileEnemyPack).
const UNSUPPORTED = {
  block: 'battle_start-folded defence (damage_reduction); not a monster ray verb',
  heal_bp: 'player-PO heal; no monster ray/rider path',
  amp_status: 'player-PO/charge status amp; not a monster ray verb',
  buff_host: 'passive self-buff folded at compile (compileEnemyPack)',
  buff_self_per_tag: 'passive self-buff folded at compile',
  buff_adjacent: 'passive self-buff folded at compile',
  cleanse: 'player-PO status cleanse; no monster ray path',
  reflect_damage: 'Spikes status (defender-side reflect); not a fired ray verb',
  haste: 'cadence buff (player charge/PO); not a monster ray verb',
  slow_enemy: 'player-PO cadence debuff; not a monster ray verb',
  bonus_vs_blocked: 'player-PO conditional bonus; not a monster ray verb',
  status_immune: 'battle_start-folded immunity (compileEnemyPack)',
  pulse: 'player link-pulse (every_secs spark); player-only emitter',
  buff_linked: 'player linked-BP buff; not a monster verb',
  buff_self: 'battle_start-folded self-buff (compileEnemyPack)',
  damage_reduction: 'battle_start-folded defence (compileEnemyPack)',
  grant_charge: 'unit-charge only (REQ-0200)',
  advance_cooldown: 'unit-charge only (REQ-0200)',
  fire_items: 'unit-charge only (REQ-0200)',
  grant_shield: 'unit-charge only (REQ-0200)',
  grant_lifesteal: 'unit-charge only (REQ-0200)',
  charge_strike: 'unit-charge only (REQ-0200)',
  transfer_status: 'player-PO status transfer; not a monster ray verb',
  shield_break: 'unit-charge/player shield interaction; not a monster ray verb',
  grant_self_status: 'battle_start-folded self-status buff (Spikes/Regen) in compileEnemyPack; not a monster ray verb (REQ-0299)',
  death_throes: 'on_death dying-blast fired via the runEncounter death drain (fireDeathThroes), not the m-v-m fire path (REQ-0299)',
};

// EnemySkill-domain triggers that define a reactive/timed FIRING and ARE driven
// by the m-v-m fire dispatch (arena).
const FIRE_TRIGGERS = ['every_secs', 'OnHit', 'OnSquadHit', 'OnSquadBeenHit'];
// EnemySkill triggers handled OUTSIDE the arena fire dispatch (documented).
const NONFIRE_ENEMY_TRIGGERS = {
  battle_start: 'compile-time fold (compileEnemyPack foldBattleStartStatusVerbs)',
  on_hp_below: 'runEncounter hp-below watcher, not the m-v-m fire path',
  on_death: 'runEncounter death drain (fireDeathThroes), not the m-v-m fire path (REQ-0299)',
};

function mkVerb(v) {
  switch (v) {
    case 'strike': return { t: 'strike', n: [14, 14] };
    case 'multi_strike': return { t: 'multi_strike', hits: 3, n: [6, 6] };
    case 'apply_status': return { t: 'apply_status', status: 'Chill', n: [3, 3] };
    case 'add_on_hit_status': return { t: 'add_on_hit_status', status: 'Poison', n: [3, 3] };
    case 'bonus_vs_status': return { t: 'bonus_vs_status', n: [12, 12], status: 'Chill', mult: 2 };
    case 'lifesteal': return { t: 'lifesteal', n: [14, 14], frac: 0.5 };
    case 'heal_ally': return { t: 'heal_ally', n: [40, 40] };
    default: throw new Error('mkVerb: no fixture for ' + v);
  }
}
const statusOf = (v) => mkVerb(v).status;
const timedSkill = (verb) => ({ trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb, attack_profile: AP, modes: ['battle'] });
const has = (events, pred) => events.some(pred);

function arena(spec) {
  const monsterPackDefsById = {};
  for (const p of spec.packs) monsterPackDefsById[p.id] = p;
  const defs = { enemyDefsById: spec.enemyDefsById, skillDefsById: spec.skillDefsById, monsterPackDefsById, scaling: null };
  const res = runMonsterArena({ packA: 'A', packB: 'B', seed: spec.seed || 'req0297', defs, keepEvents: true, deadlineSecs: spec.deadlineSecs || 3 });
  return { res, events: res.events || [] };
}

// ATTACKER, timed: A's monster fires `verb` on every_secs at a punching bag B.
function runTimed(verb, seed) {
  return arena({ seed,
    enemyDefsById: {
      att: { id: 'att', name: 'Att', hp: [400, 400], footprint: [1, 1], skills: ['s'] },
      bag: { id: 'bag', name: 'Bag', hp: [99999, 99999], footprint: [1, 1], skills: [] },
    },
    skillDefsById: { s: timedSkill(mkVerb(verb)) },
    packs: [{ id: 'A', members: [{ enemy: 'att', at: 'B2' }] }, { id: 'B', members: [{ enemy: 'bag', at: 'B2' }] }],
  });
}
// ATTACKER, offensive rider: A's monster lands a timed strike; its `trigger`
// (OnHit/OnSquadHit) rider `verb` rides each landed hit onto B.
function runRider(trigger, verb, seed) {
  return arena({ seed,
    enemyDefsById: {
      att: { id: 'att', name: 'Att', hp: [400, 400], footprint: [1, 1], skills: ['s_hit', 's_rider'] },
      bag: { id: 'bag', name: 'Bag', hp: [99999, 99999], footprint: [1, 1], skills: [] },
    },
    skillDefsById: {
      s_hit: timedSkill({ t: 'strike', n: [10, 10] }),
      s_rider: { trigger: { t: trigger }, verb: mkVerb(verb), attack_profile: AP, modes: ['battle'] },
    },
    packs: [{ id: 'A', members: [{ enemy: 'att', at: 'B2' }] }, { id: 'B', members: [{ enemy: 'bag', at: 'B2' }] }],
  });
}
// DEFENDER, OnSquadBeenHit: A's monster (plain strike) hits B's monster, whose
// ONLY skill is an OnSquadBeenHit(`verb`) retaliation aimed back at A. B has NO
// timed attack, so ANY damage to A is purely the REQ-0297 retaliation dispatch.
function runDefender(verb, seed) {
  return arena({ seed,
    enemyDefsById: {
      att: { id: 'att', name: 'Att', hp: [400, 400], footprint: [1, 1], skills: ['s_hit'] },
      def: { id: 'def', name: 'Def', hp: [99999, 99999], footprint: [1, 1], skills: ['s_react'] },
    },
    skillDefsById: {
      s_hit: timedSkill({ t: 'strike', n: [10, 10] }),
      s_react: { trigger: { t: 'OnSquadBeenHit' }, verb: mkVerb(verb), attack_profile: AP, modes: ['battle'] },
    },
    packs: [{ id: 'A', members: [{ enemy: 'att', at: 'B2' }] }, { id: 'B', members: [{ enemy: 'def', at: 'B2' }] }],
  });
}

function register(H) {
  const { T, eq, ok } = H;

  // ---- coverage / classification --------------------------------------------
  T('REQ-0297 vocab coverage: every vocab.verbs entry is classified (monster ray/rider/support or documented-unsupported)', () => {
    const classified = new Set([...RAY_VERBS, ...SUPPORT_VERBS, ...Object.keys(UNSUPPORTED)]);
    for (const v of vocab.verbs) ok(classified.has(v), 'vocab verb not classified for REQ-0297 monster matrix: ' + v);
    for (const v of classified) ok(vocab.verbs.includes(v), 'classified verb not present in vocab.verbs: ' + v);
    for (const v of RIDER_VERBS) ok(RAY_VERBS.includes(v), 'rider verb must also be a ray verb: ' + v);
  });
  T('REQ-0297 trigger coverage: every EnemySkill reactive/timed trigger is a fire-trigger or documented non-fire', () => {
    const enemyTriggers = Object.keys(vocab.trigger_domains).filter(k => vocab.trigger_domains[k].includes('EnemySkill'));
    ok(enemyTriggers.length > 0, 'found EnemySkill triggers');
    for (const tr of enemyTriggers) ok(FIRE_TRIGGERS.includes(tr) || (tr in NONFIRE_ENEMY_TRIGGERS), 'EnemySkill trigger unaccounted: ' + tr);
  });

  // ---- ATTACKER: timed (every_secs) -----------------------------------------
  for (const v of RAY_VERBS) {
    T('REQ-0297 timed attacker fires + has effect: monster every_secs ' + v, () => {
      const { res, events } = runTimed(v, 'timed-' + v);
      ok(has(events, e => e.ev === 'telegraph' && e.src === 'att'), 'monster timed skill telegraphed');
      if (v === 'apply_status' || v === 'add_on_hit_status') {
        ok(has(events, e => e.ev === 'apply_status' && e.status === statusOf(v)), v + ' applied its status to B');
      } else if (v === 'lifesteal') {
        ok(has(events, e => e.ev === 'lifesteal_heal'), 'lifesteal emitted a self-heal event');
        ok(res.b.hp < res.b.hpMax, 'lifesteal strike damaged B');
      } else {
        ok(res.b.hp < res.b.hpMax, v + ' damaged B (b.hp ' + res.b.hp + ' < ' + res.b.hpMax + ')');
      }
    });
  }
  T('REQ-0297 timed attacker fires + has effect: monster every_secs heal_ally (heals a wounded pack ally)', () => {
    const { events } = arena({ seed: 'timed-heal_ally',
      enemyDefsById: {
        healer: { id: 'healer', name: 'Healer', hp: [99999, 99999], footprint: [1, 1], skills: ['s_heal'] },
        tank: { id: 'tank', name: 'Tank', hp: [500, 500], footprint: [1, 1], skills: [] },
        bopper: { id: 'bopper', name: 'Bopper', hp: [99999, 99999], footprint: [1, 1], skills: ['s_bop'] },
      },
      skillDefsById: { s_heal: timedSkill({ t: 'heal_ally', n: [40, 40] }), s_bop: timedSkill({ t: 'strike', n: [30, 30] }) },
      packs: [
        { id: 'A', members: [{ enemy: 'healer', at: 'B2' }, { enemy: 'tank', at: 'C2' }] },
        { id: 'B', members: [{ enemy: 'bopper', at: 'B2' }] },
      ],
    });
    ok(has(events, e => e.ev === 'heal_ally' && e.amount > 0 && e.hp_after > e.hp_before), 'heal_ally healed a wounded ally (hp rose)');
  });

  // ---- ATTACKER: offensive riders (OnHit / OnSquadHit) ----------------------
  for (const trig of ['OnHit', 'OnSquadHit']) {
    for (const v of RIDER_VERBS) {
      T('REQ-0297 offensive rider fires + has effect: monster ' + trig + ' ' + v, () => {
        const { events } = runRider(trig, v, trig + '-' + v);
        const procs = events.filter(e => e.ev === 'reactive_proc' && e.trigger === trig && e.verb === v);
        ok(procs.length > 0, trig + '/' + v + ' rider emitted a reactive_proc');
        if (v === 'strike' || v === 'multi_strike') ok(procs.some(e => e.amount > 0), v + ' rider dealt damage');
        else if (v === 'apply_status' || v === 'add_on_hit_status') ok(procs.some(e => e.status === statusOf(v)), v + ' rider applied its status');
        else if (v === 'lifesteal') ok(procs.some(e => e.heal > 0), 'lifesteal rider healed the owner');
      });
    }
    T('REQ-0297 documented no-op: monster ' + trig + ' bonus_vs_status is NOT an offensive rider (applyReactiveVerbToTarget has no branch)', () => {
      const { events } = runRider(trig, 'bonus_vs_status', trig + '-bvs');
      ok(!has(events, e => e.ev === 'reactive_proc' && e.trigger === trig && e.verb === 'bonus_vs_status'), 'bonus_vs_status emits no reactive_proc as a rider');
    });
  }

  // ---- DEFENDER: OnSquadBeenHit (the REQ-0297 faction-neutral dispatch) ------
  for (const v of RAY_VERBS) {
    T('REQ-0297 defender fires + has effect: struck monster OnSquadBeenHit ' + v + ' (m-v-m retaliation)', () => {
      const { res, events } = runDefender(v, 'def-' + v);
      ok(has(events, e => e.ev === 'reactive_proc' && e.trigger === 'OnSquadBeenHit' && e.verb === v && String(e.src).endsWith('def#0')), 'struck monster dispatched its OnSquadBeenHit ' + v);
      if (v === 'apply_status' || v === 'add_on_hit_status') {
        ok(has(events, e => e.ev === 'apply_status' && e.status === statusOf(v)), 'retaliation applied its status to the attacker');
      } else {
        ok(res.a.hp < res.a.hpMax, v + ' retaliation damaged the attacker (a.hp ' + res.a.hp + ' < ' + res.a.hpMax + '; def has NO timed attack)');
      }
    });
  }
  T('REQ-0297 documented: struck monster OnSquadBeenHit heal_ally dispatches its proc but the retaliation ray no-ops (heal_ally is not a fireSkillRay verb)', () => {
    const { res, events } = runDefender('heal_ally', 'def-heal_ally');
    ok(has(events, e => e.ev === 'reactive_proc' && e.trigger === 'OnSquadBeenHit' && e.verb === 'heal_ally'), 'dispatch still emits the OnSquadBeenHit proc');
    eq(res.a.hp, res.a.hpMax, 'no retaliation damage from a heal_ally OnSquadBeenHit');
  });
}

module.exports = { register };

if (require.main === module) {
  let pass = 0, fail = 0;
  const T = (name, fn) => { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  register({ T, eq, ok });
  console.log('----------------------------------');
  console.log('req0297_verb_firing: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}


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
