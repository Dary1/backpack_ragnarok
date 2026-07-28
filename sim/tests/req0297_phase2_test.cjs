'use strict';
// sim/tests/req0297_phase2_test.cjs -- REQ-0297 Phase 2.
//
// Per-pack powerLevel runtime + scaling round-to-0 CARE + the +/-25 guard.
// Companion to req0297_verb_firing_test.cjs (Phase 1). register(harness) is
// require()d by sim/tests/run.cjs; the file also self-runs standalone.
//
// What is proven here (all with SYNTHETIC powerLevel + SYNTHETIC profiles -- no
// live values are shipped in this build; the calibrated powerLevels arrive later
// via the surgical content path, exactly like REQ-0293 proved its math against
// synthetic profiles):
//   1. effLevelForPack derivation: effLevel = attackLv - powerLevel (+ boss bonus);
//      absent powerLevel => 0 (no scaling), EVEN for a boss (byte-identical
//      fallback); extreme |effLevel| WARNS but is never capped.
//   2. per-pack composition: compileEnemyPack at the derived effLevel scales that
//      one pack's hp/damage; the boss slot is exactly +15% stronger on hp.
//   3. threading: runEncounter reads packDef.powerLevel + encounterDef.type ===
//      'boss' -- an absent-powerLevel pack is BYTE-IDENTICAL to no-scaling, a
//      powered pack differs, and the boss encounter differs from the pack one.
//   4. scaling-care: a tiny hp scaled DOWN never rounds to 0 (floored at 1);
//      the factor-1 path is byte-identical; magnitudes stay fractional.
//   5. +/-25 guard: every scaled skill/hp value stays > 0 and finite.
const path = require('path');
const fs = require('fs');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));
const levelScale = require(path.join(__dirname, '..', 'lib', 'level_scale.cjs'));

const REPO_ROOT = path.join(__dirname, '..', '..');
const scenario = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItemsRaw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {};
for (const e of liveItemsRaw.entries) itemDefsById[e.id] = e;

// The SHIPPED profile (g=1.1 on hp + damage magnitudes + heal; status/cadence flat).
const SHIPPED = levelScale.loadProfile(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'scaling_profile.json'), 'utf8')));
// A synthetic BIG-effect profile: hp geometric g=2, strike.n geometric g=2 -- a
// clearly observable step so the threading diff is unmistakable.
const HP2 = levelScale.loadProfile({
  schema: 'scaling/1',
  enemy: { hp: { kind: 'geometric', g: 2 }, footprint: { kind: 'flat' } },
  skill: {
    trigger: { every_secs: { s: { kind: 'flat' } } },
    verb: { _default: { n: { kind: 'flat' }, hits: { kind: 'flat' }, mult: { kind: 'flat' }, frac: { kind: 'flat' } },
            strike: { n: { kind: 'geometric', g: 2 } } },
    attack_profile: { penetration: { kind: 'flat' }, aoe: { kind: 'flat' } },
  },
});

const BOX = { rowMin: 1, colMin: 1, rowMax: 18, colMax: 26 };
const G = 1.1;

function register({ T, eq, ok, approx }) {
  const near = (a, b, msg, tol) => ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), (msg || '') + ' expected ~' + b + ' got ' + a);
  const B = levelScale.BOSS_LV_BONUS;

  // ===================================================================
  // 1. effLevelForPack derivation
  // ===================================================================
  T('REQ-0297 effLevelForPack: effLevel = attackLv - powerLevel (fractional, negative ok)', () => {
    eq(levelScale.effLevelForPack(10, 3, false), 7, 'attackLv 10 - powerLevel 3');
    eq(levelScale.effLevelForPack(3, 10, false), -7, 'a strong pack (high powerLevel) presents LOWER -> scaled down');
    near(levelScale.effLevelForPack(0, -13.5, false), 13.5, 'a negative internal powerLevel is fine and meaningful');
    near(levelScale.effLevelForPack(7, 2.5, false), 4.5, 'fractional powerLevel');
  });

  T('REQ-0297 effLevelForPack: BOSS_LV_BONUS is log_1.1(1.15) and buys exactly +15% strength', () => {
    near(B, Math.log(1.15) / Math.log(1.1), 'BOSS_LV_BONUS = log_1.1(1.15)');
    near(Math.pow(1.1, B), 1.15, 'g^BOSS_LV_BONUS == 1.15 on the g=1.1 ladder');
    near(levelScale.effLevelForPack(10, 3, true), 7 + B, 'boss slot adds the bonus to effLevel', 1e-12);
    // The boss buff, expressed as an hp/damage MULTIPLIER under the shipped 1.1 profile, is 1.15x.
    const fPack = levelScale.factorFor({ kind: 'geometric', g: G }, levelScale.effLevelForPack(9, 4, false));
    const fBoss = levelScale.factorFor({ kind: 'geometric', g: G }, levelScale.effLevelForPack(9, 4, true));
    near(fBoss / fPack, 1.15, 'boss is +15% vs the same pack under the shipped profile');
  });

  T('REQ-0297 effLevelForPack: absent powerLevel => 0 (no scaling), EVEN for a boss (byte-identical fallback)', () => {
    eq(levelScale.effLevelForPack(20, undefined, false), 0, 'undefined powerLevel -> no scaling');
    eq(levelScale.effLevelForPack(20, undefined, true), 0, 'a BOSS with no powerLevel gets NO bonus and NO scaling');
    eq(levelScale.effLevelForPack(20, null, true), 0, 'null -> no scaling');
    eq(levelScale.effLevelForPack(20, NaN, true), 0, 'NaN -> no scaling');
    // powerLevel === 0 is a REAL value, NOT absent: effLevel = attackLv (+ bonus).
    eq(levelScale.effLevelForPack(5, 0, false), 5, 'powerLevel 0 is a real value (average pack), not absent');
    near(levelScale.effLevelForPack(5, 0, true), 5 + B, 'powerLevel 0 boss still gets the bonus', 1e-12);
  });

  T('REQ-0297 effLevelForPack: extreme |effLevel| WARNS but NEVER caps (self-normalisation preserved)', () => {
    const warned = [];
    const orig = console.warn;
    console.warn = (m) => warned.push(String(m));
    try {
      eq(levelScale.effLevelForPack(100, 0, false), 100, 'returns the TRUE effLevel, never clamped (+100)');
      eq(levelScale.effLevelForPack(0, 100, false), -100, 'returns the TRUE effLevel, never clamped (-100)');
      eq(levelScale.effLevelForPack(10, 0, false), 10, 'an in-band value (+10) does not warn');
    } finally { console.warn = orig; }
    eq(warned.length, 2, 'only the two extreme cases warned; the in-band one did not');
    ok(warned.every((m) => m.indexOf('extreme') !== -1 && m.indexOf('NOT capped') !== -1), 'warning names the content signal, not a cap');
  });

  // ===================================================================
  // 2. Per-pack composition (effLevelForPack -> compileEnemyPack)
  // ===================================================================
  const synEnemyDefs = { synbeast: { id: 'synbeast', name: 'SynBeast', hp: [100, 100], footprint: [1, 1], skills: ['synstrike'] } };
  const synSkillDefs = { synstrike: { trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'strike', n: [10, 10] }, attack_profile: { edge: ['top'], penetration: 5, aoe: 1 } } };

  T('REQ-0297 per-pack scale: pack presents at round(baseHp * g^(attackLv-powerLevel)); boss is +BOSS_LV_BONUS on top', () => {
    const attackLv = 10, powerLevel = 7; // effLevel(pack) = 3
    const effPack = levelScale.effLevelForPack(attackLv, powerLevel, false);
    const effBoss = levelScale.effLevelForPack(attackLv, powerLevel, true);
    eq(effPack, 3, 'pack effLevel');
    near(effBoss, 3 + B, 'boss effLevel', 1e-12);
    const enPack = combat.compileEnemyPack({ enemyIds: ['synbeast'], powerLevel: powerLevel }, synEnemyDefs, synSkillDefs, combat.makeRng('per-pack'), BOX, { scaling: HP2, effLevel: effPack });
    const enBoss = combat.compileEnemyPack({ enemyIds: ['synbeast'], powerLevel: powerLevel }, synEnemyDefs, synSkillDefs, combat.makeRng('per-pack'), BOX, { scaling: HP2, effLevel: effBoss });
    eq(enPack[0].hpMax, Math.round(100 * Math.pow(2, 3)), 'pack hp = 100 * 2^3 = 800');
    eq(enBoss[0].hpMax, Math.round(100 * Math.pow(2, 3 + B)), 'boss hp = 100 * 2^(3+BOSS_LV_BONUS)');
    ok(enBoss[0].hpMax > enPack[0].hpMax, 'boss is strictly stronger than the same pack');
    // enemy strike damage also scaled per pack (HP2 scales strike.n by g=2 too).
    eq(enPack[0].skills[0].verb.n, [10 * Math.pow(2, 3), 10 * Math.pow(2, 3)], 'pack strike n = 10 * 2^3');
  });

  T('REQ-0297 per-pack scale: two packs at the SAME attackLv but different powerLevel present at different strengths', () => {
    const attackLv = 12;
    const weak = combat.compileEnemyPack({ enemyIds: ['synbeast'], powerLevel: 12 }, synEnemyDefs, synSkillDefs, combat.makeRng('two-packs'), BOX, { scaling: HP2, effLevel: levelScale.effLevelForPack(attackLv, 12, false) }); // eff 0
    const strong = combat.compileEnemyPack({ enemyIds: ['synbeast'], powerLevel: 9 }, synEnemyDefs, synSkillDefs, combat.makeRng('two-packs'), BOX, { scaling: HP2, effLevel: levelScale.effLevelForPack(attackLv, 9, false) }); // eff 3
    eq(weak[0].hpMax, 100, 'powerLevel==attackLv -> effLevel 0 -> unscaled 100');
    eq(strong[0].hpMax, 800, 'lower powerLevel -> higher effLevel -> stronger present');
  });

  // ===================================================================
  // 3. Threading through runEncounter (the actual runtime path)
  // ===================================================================
  function runEnc(opts) {
    const encType = opts.type || 'pack';
    const enemyPack = { enemyIds: ['synbeast'] };
    if (opts.powerLevel !== undefined) enemyPack.powerLevel = opts.powerLevel;
    // FRESH troop per run: runEncounter mutates troop HP in place (persistent
    // attrition), so a shared troop would leak state between runs and defeat the
    // byte-identical comparison. Each call compiles an independent squad.
    const fresh = combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1');
    const bag = {
      rng: combat.makeRng('thread-seed'), encIndex: 0,
      troopBps: fresh.bps, troopPos: fresh.pos,
      formationBox: { formationId: 'formation1' },
      enemyDefsById: synEnemyDefs, skillDefsById: synSkillDefs,
      encounterDef: { id: 'enc0', type: encType, mode: 'battle', enemyPack: enemyPack, deadline_secs: 3, timeout_secs: 3 },
      seedLabel: 'thread-seed',
    };
    if (opts.scaling) bag.scaling = opts.scaling;
    if (opts.attackLv !== undefined) bag.attackLv = opts.attackLv;
    return combat.toJSONL(combat.runEncounter(bag).events);
  }

  T('REQ-0297 threading: absent powerLevel is BYTE-IDENTICAL to no-scaling (even with a profile + attackLv present)', () => {
    const noScaling = runEnc({});                                  // no profile at all
    const absentPL = runEnc({ scaling: HP2, attackLv: 10 });       // profile + attackLv, but pack has NO powerLevel
    ok(noScaling.length > 0, 'the encounter produced a non-empty log');
    eq(absentPL, noScaling, 'absent-powerLevel pack under a live profile == today no-scaling log, byte-for-byte');
  });

  T('REQ-0297 threading: a powered pack DIFFERS from no-scaling, and the boss slot DIFFERS from the pack slot', () => {
    const noScaling = runEnc({});
    const poweredPack = runEnc({ scaling: HP2, attackLv: 10, powerLevel: 7, type: 'pack' });   // eff 3
    const poweredBoss = runEnc({ scaling: HP2, attackLv: 10, powerLevel: 7, type: 'boss' });   // eff 3 + bonus
    ok(poweredPack !== noScaling, 'a pack with powerLevel scales -> log differs from unscaled (threading works)');
    ok(poweredBoss !== poweredPack, 'the boss slot (encounterDef.type===boss) adds BOSS_LV_BONUS -> differs from the pack slot');
  });

  // ===================================================================
  // 4. Scaling-care: fractional / no round-to-0
  // ===================================================================
  T('REQ-0297 scaling-care: a tiny hp scaled DOWN is a positive fraction that bare rounding would zero', () => {
    const sr = levelScale.scaleEnemyHpRange([1, 1], SHIPPED, -25); // 1 * 1.1^-25 ~= 0.0923
    ok(sr[0] > 0, 'the continuous scaled hp is strictly > 0 (g^effLevel is never 0)');
    ok(sr[0] < 0.5, 'and small enough that Math.round would zero it');
    eq(Math.round(sr[0]), 0, 'proof: bare integer rounding WOULD produce a dead (0-hp) enemy');
  });

  T('REQ-0297 scaling-care: compileEnemyPack floors a scaled-down tiny hp at 1 (never spawns dead)', () => {
    const tinyDefs = { blip: { id: 'blip', name: 'Blip', hp: [1, 1], footprint: [1, 1], skills: [] } };
    const scaled = combat.compileEnemyPack({ enemyIds: ['blip'] }, tinyDefs, {}, combat.makeRng('care'), BOX, { scaling: SHIPPED, effLevel: -25 });
    ok(scaled[0].hp >= 1, 'scaled-down tiny hp floored to >= 1 (no dead skill / no dead enemy)');
    ok(scaled[0].hpMax >= 1 && Number.isFinite(scaled[0].hpMax), 'hpMax floored and finite');
  });

  T('REQ-0297 scaling-care: factor-1 (effLevel 0) hp is BYTE-IDENTICAL to no-scaling -- floor never engages', () => {
    const tinyDefs = { blip: { id: 'blip', name: 'Blip', hp: [1, 1], footprint: [1, 1], skills: [] } };
    const noScaling = combat.compileEnemyPack({ enemyIds: ['blip'] }, tinyDefs, {}, combat.makeRng('care0'), BOX);
    const factor1 = combat.compileEnemyPack({ enemyIds: ['blip'] }, tinyDefs, {}, combat.makeRng('care0'), BOX, { scaling: SHIPPED, effLevel: 0 });
    eq(factor1[0].hp, noScaling[0].hp, 'effLevel-0 hp identical to no-scaling (factor-1 path untouched)');
    eq(noScaling[0].hp, 1, 'the exact today value (1) is preserved, NOT floored/changed by the care logic');
  });

  T('REQ-0297 scaling-care: scaled damage magnitudes stay FRACTIONAL > 0 (per-hit damage is not integer-rounded)', () => {
    const skills = [{ trigger: { t: 'every_secs', s: [1, 1] }, verb: { t: 'strike', n: [1, 1] }, attack_profile: { penetration: 0, aoe: 0 } }];
    const out = levelScale.scaleSkillsForLevel(skills, ['s'], SHIPPED, -25);
    ok(out[0].verb.n[0] > 0 && out[0].verb.n[0] < 1, 'strike n stays a positive fraction, never rounded to 0');
    ok(Number.isFinite(out[0].verb.n[0]), 'and finite');
  });

  // ===================================================================
  // 5. The +/-25 guard: no dead skill / hp, all finite / sane
  // ===================================================================
  T('REQ-0297 GUARD: across effLevel -25..+25, every scaled hp/skill magnitude is > 0 and finite', () => {
    const hp = [3, 7]; // small hp to stress the low end
    const skills = [
      { trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [9, 9] }, attack_profile: { penetration: 0, aoe: 0 } },
      { trigger: { t: 'every_secs', s: [3, 3] }, verb: { t: 'multi_strike', hits: 3, n: [1, 2] }, attack_profile: { penetration: 0, aoe: 0 } },
      { trigger: { t: 'every_secs', s: [4, 4] }, verb: { t: 'heal_ally', n: [5, 5] } },
      { trigger: { t: 'every_secs', s: [5, 5] }, verb: { t: 'apply_status', status: 'Chill', n: [2, 2] } },
    ];
    for (let eff = -25; eff <= 25; eff++) {
      const sh = levelScale.scaleEnemyHpRange(hp, SHIPPED, eff);
      for (const v of sh) { ok(v > 0, 'hp leaf > 0 at effLevel ' + eff + ' got ' + v); ok(Number.isFinite(v), 'hp leaf finite at effLevel ' + eff); }
      const out = levelScale.scaleSkillsForLevel(skills, ['a', 'b', 'c', 'd'], SHIPPED, eff);
      for (const s of out) {
        const n = s.verb && s.verb.n;
        if (Array.isArray(n)) for (const v of n) { ok(v > 0, 'verb.n leaf > 0 at effLevel ' + eff + ' (' + s.verb.t + ') got ' + v); ok(Number.isFinite(v), 'verb.n finite at effLevel ' + eff); }
      }
      // flat leaves are NOT scaled (byte-identical): cadence + apply_status magnitude untouched.
      eq(out[0].trigger.s, [2, 2], 'trigger.s stays flat at effLevel ' + eff);
      eq(out[3].verb.n, [2, 2], 'apply_status.n stays flat at effLevel ' + eff);
    }
  });
}

module.exports = { register };

if (require.main === module) {
  let pass = 0, fail = 0;
  const T = (name, fn) => { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  const approx = (a, b, tol, msg) => { if (Math.abs(a - b) > (tol || 1e-9)) throw new Error((msg || '') + ' expected ~' + b + ' got ' + a); };
  register({ T, eq, ok, approx });
  console.log('----------------------------------');
  console.log('req0297_phase2: ' + pass + ' passed, ' + fail + ' failed');
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
