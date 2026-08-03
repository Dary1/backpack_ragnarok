'use strict';
// sim/tests/req0297_phase3_test.cjs -- REQ-0297 Phase 3.
//
// The all-pairs round-robin powerLevel autobalancer
// (tools/autobalance_pack_powerlevel.cjs): DETERMINISM + CONVERGENCE +
// NO-ANCHOR self-centring + the SIGN of the update + the win-score tiebreak.
//
// Proven on a TINY SYNTHETIC 3-pack field (strong / mid / weak). The full
// 14-live-pack round-robin is ~7s -- too slow for the unit suite -- so we inject
// a fast synthetic { monsterPackDefsById, enemyDefsById, skillDefsById, scaling }
// through the SAME autobalance() core the CLI uses. register(harness) is
// require()d by sim/tests/run.cjs; the file also self-runs standalone.
const path = require('path');
const tool = require(path.join(__dirname, '..', '..', 'tools', 'autobalance_pack_powerlevel.cjs'));
const levelScale = require(path.join(__dirname, '..', 'lib', 'level_scale.cjs'));

// A synthetic field with a CLEAR strength ordering so the round-robin has an
// unambiguous fixed point: pack_strong (2 strong beasts) > pack_mid (1+1) >
// pack_weak (2 weak beasts). g=1.1 on hp AND strike damage, so presenting a pack
// at effLevel = -powerLevel actually changes its strength (the whole mechanism).
function synDefs() {
  const enemyDefsById = {
    strongbeast: { id: 'strongbeast', name: 'Strong', hp: [200, 200], footprint: [1, 1], skills: ['bigstrike'] },
    weakbeast: { id: 'weakbeast', name: 'Weak', hp: [60, 60], footprint: [1, 1], skills: ['smallstrike'] },
  };
  const skillDefsById = {
    bigstrike: { trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'strike', n: [30, 30] }, attack_profile: { edge: ['top'], penetration: 5, aoe: 1 } },
    smallstrike: { trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'strike', n: [8, 8] }, attack_profile: { edge: ['top'], penetration: 0, aoe: 1 } },
  };
  const monsterPackDefsById = {
    pack_strong: { id: 'pack_strong', enemyIds: ['strongbeast', 'strongbeast'] },
    pack_mid: { id: 'pack_mid', enemyIds: ['strongbeast', 'weakbeast'] },
    pack_weak: { id: 'pack_weak', enemyIds: ['weakbeast', 'weakbeast'] },
  };
  const scaling = levelScale.loadProfile({
    schema: 'scaling/1',
    enemy: { hp: { kind: 'geometric', g: 1.1 }, footprint: { kind: 'flat' } },
    skill: {
      trigger: { every_secs: { s: { kind: 'flat' } } },
      verb: { _default: { n: { kind: 'geometric', g: 1.1 }, hits: { kind: 'flat' }, mult: { kind: 'flat' }, frac: { kind: 'flat' } } },
      attack_profile: { penetration: { kind: 'flat' }, aoe: { kind: 'flat' } },
    },
  });
  return { enemyDefsById, skillDefsById, monsterPackDefsById, scaling };
}
const CFG = { alpha: 0.7, loops: 6, seeds: 6 }; // synthetic set converges by ~loop 4

function register({ T, eq, ok, approx }) {
  T('REQ-0297 Phase3 determinism: same {defs,alpha,loops,seeds} -> byte-identical powerLevel + per-loop win-rates', () => {
    const a = tool.autobalance(Object.assign({ defs: synDefs() }, CFG));
    const b = tool.autobalance(Object.assign({ defs: synDefs() }, CFG));
    eq(a.powerLevel, b.powerLevel, 'reproducible final powerLevel vector');
    eq(a.history.map((h) => h.winRate), b.history.map((h) => h.winRate), 'reproducible per-loop residual win-rates');
  });

  T('REQ-0297 Phase3 convergence: an imbalanced field self-normalises to ~50% win-rate for EVERY pack within the loops', () => {
    const r = tool.autobalance(Object.assign({ defs: synDefs() }, CFG));
    const first = r.history[0], last = r.history[r.loops];
    ok(first.maxResid > 40, 'starts imbalanced (strong ~100% / weak ~0%): loop-0 maxResid ' + first.maxResid.toFixed(1));
    ok(last.maxResid < 5, 'settles: every pack within ~5% of 50% by the last loop, maxResid ' + last.maxResid.toFixed(2));
    ok(last.maxResid < first.maxResid * 0.25, 'residual shrank by >4x (not a fluke)');
    for (const wr of last.winRate) ok(wr >= 45 && wr <= 55, 'each final win-rate within 45..55, got ' + wr.toFixed(1));
  });

  T('REQ-0297 Phase3 SIGN: a round-robin WINNER gets powerLevel RAISED (strong>mid>weak); runtime effLevel=attackLv-powerLevel then scales it down', () => {
    const r = tool.autobalance(Object.assign({ defs: synDefs() }, CFG));
    const pl = {}; r.packIds.forEach((id, i) => { pl[id] = r.powerLevelRaw[i]; });
    ok(pl.pack_strong > pl.pack_mid, 'strong (won at loop 0) ends HIGHER than mid: ' + pl.pack_strong.toFixed(3) + ' > ' + pl.pack_mid.toFixed(3));
    ok(pl.pack_mid > pl.pack_weak, 'mid > weak: ' + pl.pack_mid.toFixed(3) + ' > ' + pl.pack_weak.toFixed(3));
    ok(pl.pack_strong > 0 && pl.pack_weak < 0, 'winner raised above field mean (+), loser lowered below it (-)');
  });

  T('REQ-0297 Phase3 NO anchor (theory): a full round-robin mean win-rate is EXACTLY 50% => mean dPowerLevel 0', () => {
    const d = synDefs();
    const ids = Object.keys(d.monsterPackDefsById);
    const m = tool.measure(ids.map(() => 0), CFG.seeds, d, ids); // all powerLevel 0
    const mean = m.winRate.reduce((s, x) => s + x, 0) / m.winRate.length;
    approx(mean, 50, 1e-9, 'mean(winRate) is 50% by construction (scoreA+scoreB=1 every game, equal game counts)');
  });

  T('REQ-0297 Phase3 NO anchor (proof): mean(powerLevel) is CONSERVED (=0) at EVERY loop -- the set self-centres, no reference pack', () => {
    const r = tool.autobalance(Object.assign({ defs: synDefs() }, CFG));
    for (const h of r.history) ok(Math.abs(h.meanPowerLevel) < 1e-9, 'mean(powerLevel) ~ 0 at loop ' + h.loop + ' got ' + h.meanPowerLevel);
  });

  T('REQ-0297 Phase3 win-score: win=1, loss=0, draw/timeout broken by remaining hp-fraction (sums to 1/game)', () => {
    eq(tool.scoreA({ winner: 'A', a: { hpFrac: 0.1 }, b: { hpFrac: 0.9 } }), 1, 'A wipeout win = 1 regardless of hp');
    eq(tool.scoreA({ winner: 'B', a: { hpFrac: 0.9 }, b: { hpFrac: 0.1 } }), 0, 'B win = 0');
    eq(tool.scoreA({ winner: 'timeout', a: { hpFrac: 0.6 }, b: { hpFrac: 0.3 } }), 1, 'timeout: A ahead on hp -> 1 (informative, not a coin flip)');
    eq(tool.scoreA({ winner: 'timeout', a: { hpFrac: 0.3 }, b: { hpFrac: 0.6 } }), 0, 'timeout: A behind on hp -> 0');
    eq(tool.scoreA({ winner: 'draw', a: { hpFrac: 0.5 }, b: { hpFrac: 0.5 } }), 0.5, 'exact hp tie -> 0.5');
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
  console.log('req0297_phase3: ' + pass + ' passed, ' + fail + ' failed');
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
