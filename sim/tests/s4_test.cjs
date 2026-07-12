'use strict';
// sim/tests/s4_test.cjs -- REQ-0050: S4 post-processor unit tests on
// hand-crafted JSONL fixtures (each metric family, each flag class), plus
// matrix determinism and warn-vs-hard exit-code behavior.
//
//   node sim/tests/s4_test.cjs
const path = require('path');
const { execFileSync } = require('child_process');
const metrics = require(path.join(__dirname, '..', 's4', 'metrics.cjs'));
const REPO = path.join(__dirname, '..', '..');

let passed = 0, failed = 0;
function T(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + ' -- ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); }

// ---- fixture helpers ----
function runOut(events, extra) {
  return Object.assign({ events, result: 'victory', finalProgressPct: 100, rewards: [], lrdstReward: 0, cooldownSecs: 60, H: 0.8 }, extra || {});
}
function meta(extra) {
  return Object.assign({ boardId: 'fx', dungeonKey: 'fx', formationId: 'formation1', level: 3, seed: 's', variant: 'base', playerBpIds: ['pbp1', 'pbp2'], defAtt: { trap: 0, chest: 0, door: 0 }, poInstances: {} }, extra || {});
}
const enc = (i, kind, t0, t1, result) => [
  { t: t0, seq: 0, ev: 'encounter_start', enc: i, kind },
  { t: t1, seq: 99, ev: 'encounter_end', enc: i, result: result || 'clear' },
];

// ---- A1: DPS attribution (direct + bounce_mult + aoe + all-field + DoT credit) ----
T('A1 attributes ray damage (direct/aoe/hit_all) and DoT to the firing PO, per-instance, over battle time', () => {
  const events = [
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 1, seq: 1, ev: 'ray_fire', src: 'blade', field: 'enemy', entry: [9, 13] },
    { t: 1, seq: 2, ev: 'ray_hit', dst: 'e1', amount: 10, hp_after: 50 },
    { t: 1, seq: 3, ev: 'ray_aoe', center: [9, 13], radius: 1, hits: [{ dst: 'e2', amount: 4, hp_after: 20 }] },
    { t: 1, seq: 4, ev: 'ray_hit_all', bounce_mult: 2.5, hits: [{ dst: 'e3', amount: 6, hp_after: 1 }] },
    { t: 2, seq: 5, ev: 'apply_status', dst: 'e1', status: 'Burn', n: 3 },
    { t: 3, seq: 6, ev: 'status_tick', dst: 'e1', status: 'Burn', amount: 5, hp_after: 45 },
    { t: 10, seq: 7, ev: 'encounter_end', enc: 0, result: 'clear' },
    { t: 0, seq: 8, ev: 'run_end', result: 'victory', final_pct: 100, troop_bp_hp: [1], H: 0.9 },
  ];
  const rec = metrics.processRun(runOut(events), meta({ poInstances: { blade: 2 } }));
  eq(rec.dmgBySrc.blade, 20, 'direct+aoe+all-field damage');
  eq(rec.dotBySrc.blade, 5, 'DoT credited to applier');
  eq(rec.battleSecs, 10, 'battle seconds');
  const sum = metrics.aggregate([rec], { dpsCeilings: { Common: 12 }, poRarity: { blade: 'Common' } });
  eq(sum.A.dpsPerPo.blade.mean, 1.25, 'dps = (20+5)/10s /2 instances');
});

// ---- A2: runaway status growth -> hard ----
T('A2 flags runaway status growth (second-half applies >> first half) as hard', () => {
  const events = [{ t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' }];
  let seq = 1;
  events.push({ t: 1, seq: seq++, ev: 'ray_fire', src: 'amp', field: 'enemy', entry: [9, 13] });
  for (let i = 0; i < 5; i++) events.push({ t: 1 + i * 0.1, seq: seq++, ev: 'apply_status', dst: 'e1', status: 'Burn', n: 1 });
  for (let i = 0; i < 25; i++) events.push({ t: 80 + i * 0.1, seq: seq++, ev: 'apply_status', dst: 'e1', status: 'Burn', n: 2 });
  events.push({ t: 100, seq: seq++, ev: 'encounter_end', enc: 0, result: 'clear' });
  const rec = metrics.processRun(runOut(events), meta());
  const sum = metrics.aggregate([rec], {});
  ok(sum.A.statuses.Burn.growthRatio >= 3, 'growth ratio computed: ' + sum.A.statuses.Burn.growthRatio);
  const v = metrics.evaluate(sum, { a2_min_applies: 20, a2_runaway_growth_ratio: 3 });
  ok(v.hards.some(h => h.indexOf('A2 Burn') >= 0), 'hard flag raised');
});

// ---- A4: pulse metrics + cap-rate warn ----
T('A4 counts pulses/hops/fanout and warns on PULSE_CAP hit rate', () => {
  const events = [
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 1, seq: 1, ev: 'link_pulse', from: 'A', to: 'B', hop: 1, origin: 'A' },
    { t: 1, seq: 2, ev: 'link_pulse', from: 'B', to: 'C', hop: 2, origin: 'A' },
    { t: 2, seq: 3, ev: 'pulse_fizzle', reason: 'rate_cap', origin: 'A' },
    { t: 3, seq: 4, ev: 'pulse_payload', dst: 'B', verb: 'strike', amount: 5 },
    { t: 10, seq: 5, ev: 'encounter_end', enc: 0, result: 'clear' },
  ];
  const rec = metrics.processRun(runOut(events), meta());
  eq(rec.pulse.linkPulses, 2); eq(rec.pulse.hopHist[2], 1); eq(rec.pulse.fanout.A, 1);
  const sum = metrics.aggregate([rec], {});
  ok(sum.A.circuit, 'circuit block present');
  ok(sum.A.circuit.pulseCapHitRate > 0.3, 'cap rate 1/(2+1)');
  const v = metrics.evaluate(sum, { a4_pulse_cap_hit_rate_warn: 0.05 });
  ok(v.warns.some(w => w.indexOf('PULSE_CAP') >= 0), 'cap warn raised');
});

// ---- B1: bounce distribution + terminator warn ----
T('B1 tracks bounce counts per skill and warns on all-field terminator rate', () => {
  const events = [{ t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' }];
  let seq = 1;
  for (let i = 0; i < 12; i++) {
    events.push({ t: 1 + i, seq: seq++, ev: 'ray_fire', src: 'bouncy', field: 'enemy', entry: [9, 13] });
    for (let b = 0; b < 5; b++) events.push({ t: 1 + i, seq: seq++, ev: 'ray_bounce', at: [9, 13 + b] });
    events.push({ t: 1 + i, seq: seq++, ev: 'ray_hit_all', bounce_mult: 2.5, hits: [{ dst: 'e1', amount: 1, hp_after: 99 }] });
  }
  events.push({ t: 60, seq: seq++, ev: 'encounter_end', enc: 0, result: 'clear' });
  const rec = metrics.processRun(runOut(events), meta());
  const sum = metrics.aggregate([rec], {});
  eq(sum.B.bounceBySkill.bouncy.fired, 12);
  eq(sum.B.bounceBySkill.bouncy.terminatorRate, 1);
  const v = metrics.evaluate(sum, { b1_min_rays: 10, b1_terminator_rate_warn: 0.3 });
  ok(v.warns.some(w => w.indexOf('B1 bouncy') >= 0), 'terminator warn raised');
});

// ---- B4: coverage dominance hard ----
T('B4 hard-flags a coverage series where minimal coverage strictly dominates', () => {
  const mk = (variant, dmgTaken, win) => {
    const events = [
      { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
      { t: 1, seq: 1, ev: 'ray_fire', src: 'enemy1', field: 'player', entry: [9, 1] },
      { t: 1, seq: 2, ev: 'ray_hit', dst: 'pbp1', amount: dmgTaken, hp_after: 10 },
      { t: 10, seq: 3, ev: 'encounter_end', enc: 0, result: 'clear' },
    ];
    return metrics.processRun(runOut(events, { result: win ? 'victory' : 'wipe' }), meta({ variant }));
  };
  const recs = [mk('cov75', 30, true), mk('cov50', 20, true), mk('cov25', 10, true)];
  const sum = metrics.aggregate(recs, {});
  ok(sum.B.coverage.minimalDominates, 'dominance detected');
  const v = metrics.evaluate(sum, {});
  ok(v.hards.some(h => h.indexOf('B4') >= 0), 'hard raised');
});

// ---- B5: formation equity warn ----
T('B5 warns when formation win-rate spread exceeds the band', () => {
  const mk = (formationId, win) => metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 10, seq: 1, ev: 'encounter_end', enc: 0, result: win ? 'clear' : 'wipe' },
    { t: 0, seq: 2, ev: 'run_end', result: win ? 'victory' : 'wipe', H: win ? 0.8 : 0 },
  ], { result: win ? 'victory' : 'wipe' }), meta({ formationId }));
  const recs = [mk('formation1', true), mk('formation1', true), mk('formation2', false), mk('formation2', false)];
  const sum = metrics.aggregate(recs, {});
  eq(sum.B.formationEquity.spreadPts, 100);
  const v = metrics.evaluate(sum, { b5_win_rate_spread_pts_warn: 15 });
  ok(v.warns.some(w => w.indexOf('B5') >= 0), 'spread warn raised');
});

// ---- B6: ray_abort hard ----
T('B6 hard-flags any ray_abort', () => {
  const rec = metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 1, seq: 1, ev: 'ray_fire', src: 'x', field: 'enemy', entry: [9, 13] },
    { t: 1, seq: 2, ev: 'ray_abort', reason: 'step_budget_exhausted', steps: 512 },
    { t: 10, seq: 3, ev: 'encounter_end', enc: 0, result: 'clear' },
  ]), meta());
  const sum = metrics.aggregate([rec], {});
  eq(sum.B.rayAborts, 1);
  const v = metrics.evaluate(sum, { b6_ray_abort_allowed: 0 });
  ok(v.hards.some(h => h.indexOf('B6') >= 0), 'abort hard raised');
});

// ---- C1/C2/C3: downs, overkill, cascade ----
T('C metrics: first-BP-down time (cumulative clock), overkill share, cascade factor', () => {
  const events = [
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 10, seq: 1, ev: 'encounter_end', enc: 0, result: 'clear' },
    { t: 0, seq: 2, ev: 'encounter_start', enc: 1, kind: 'pack' },
    { t: 2, seq: 3, ev: 'ray_fire', src: 'enemy1', field: 'player', entry: [9, 1] },
    { t: 2, seq: 4, ev: 'ray_hit', dst: 'pbp1', amount: 40, hp_after: 0 },
    { t: 4, seq: 5, ev: 'ray_fire', src: 'enemy1', field: 'player', entry: [9, 1] },
    { t: 4, seq: 6, ev: 'ray_hit', dst: 'pbp2', amount: 40, hp_after: 5 },
    { t: 5, seq: 7, ev: 'ray_fire', src: 'us', field: 'enemy', entry: [9, 13] },
    { t: 5, seq: 8, ev: 'ray_hit', dst: 'e9', amount: 10, hp_after: 0 },
    { t: 5.5, seq: 9, ev: 'ray_fire', src: 'us', field: 'enemy', entry: [9, 13] },
    { t: 5.5, seq: 10, ev: 'ray_hit', dst: 'e9', amount: 6, hp_after: 0 },
    { t: 8, seq: 11, ev: 'encounter_end', enc: 1, result: 'clear' },
  ];
  const rec = metrics.processRun(runOut(events), meta());
  eq(rec.bpFirstDownT.pbp1, 12, 'first down at 10s(enc0) + 2s');
  eq(rec.overkillDmg, 6, 'second hit on a dead target is overkill');
  ok(rec.cascade.afterDmg === 40 && rec.cascade.beforeDmg === 40, 'cascade split around first down');
  const sum = metrics.aggregate([rec], {});
  eq(sum.C.timeToFirstBpDownMean, 12);
  ok(sum.C.overkillPct > 0, 'overkill share > 0');
});

// ---- D2: monotonicity hard ----
T('D2 hard-flags a level curve where k+1 is easier than k', () => {
  const mk = (level, win) => metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 10, seq: 1, ev: 'encounter_end', enc: 0, result: win ? 'clear' : 'wipe' },
  ], { result: win ? 'victory' : 'wipe' }), meta({ level }));
  const recs = [mk(1, true), mk(1, false), mk(2, true), mk(2, true)];
  const sum = metrics.aggregate(recs, {});
  const v = metrics.evaluate(sum, {});
  ok(v.hards.some(h => h.indexOf('D2 monotonicity') >= 0), 'monotonicity hard raised');
});

// ---- D3: bimodal H hard ----
T('D3 hard-flags a bimodal finishing-H distribution', () => {
  const mk = (H) => metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 10, seq: 1, ev: 'encounter_end', enc: 0, result: 'clear' },
  ], { H }), meta());
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push(mk(0.02));
  for (let i = 0; i < 6; i++) recs.push(mk(0.98));
  const sum = metrics.aggregate(recs, {});
  const v = metrics.evaluate(sum, { d3_min_runs: 10, d3_bimodal_extreme_frac: 0.8, d3_bimodal_mid_frac: 0.1 });
  ok(v.hards.some(h => h.indexOf('D3') >= 0), 'bimodal hard raised');
});

// ---- D4: chest lost warn ----
T('D4 warns when chests are lost to fast clears beyond the band', () => {
  const mk = () => metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 1, seq: 1, ev: 'att_reveal', att: 'c1', kind: 'chest', at: [9, 13] },
    { t: 9, seq: 2, ev: 'att_lost', att: 'c1', kind: 'chest' },
    { t: 10, seq: 3, ev: 'encounter_end', enc: 0, result: 'clear' },
  ]), meta({ defAtt: { trap: 0, chest: 1, door: 0 } }));
  const recs = [mk(), mk(), mk(), mk(), mk()];
  const sum = metrics.aggregate(recs, {});
  eq(sum.D.utility.chestLostRate, 1);
  const v = metrics.evaluate(sum, { d4_min_chests: 5, d4_chest_lost_rate_warn: 0.4 });
  ok(v.warns.some(w => w.indexOf('D4 chest lost') >= 0), 'chest-lost warn raised');
});

// ---- D6: early-wipe warn ----
T('D6 warns when too many wipes land in the first two encounters', () => {
  const mk = (enc) => {
    const evs = [];
    for (let i = 0; i <= enc; i++) {
      evs.push({ t: 0, seq: i * 2, ev: 'encounter_start', enc: i, kind: 'pack' });
      evs.push({ t: 5, seq: i * 2 + 1, ev: 'encounter_end', enc: i, result: i === enc ? 'wipe' : 'clear' });
    }
    evs.push({ t: 0, seq: 99, ev: 'run_end', result: 'wipe', H: 0 });
    return metrics.processRun(runOut(evs, { result: 'wipe', H: 0 }), meta());
  };
  const recs = [mk(0), mk(1), mk(1), mk(0), mk(5)];
  const sum = metrics.aggregate(recs, {});
  eq(sum.D.wipes.count, 5);
  ok(sum.D.wipes.earlyWipeRate === 0.8, 'early rate 4/5');
  const v = metrics.evaluate(sum, { d6_min_wipes: 4, d6_early_wipe_rate_warn: 0.25 });
  ok(v.warns.some(w => w.indexOf('D6') >= 0), 'early-wipe warn raised');
});

// ---- E1/E3: economy + plateau ----
T('E1/E3 derive items-per-hour and plateau ETA from cycle time and clear rate', () => {
  const mk = (win) => metrics.processRun(runOut([
    { t: 0, seq: 0, ev: 'encounter_start', enc: 0, kind: 'pack' },
    { t: 30, seq: 1, ev: 'encounter_end', enc: 0, result: win ? 'clear' : 'wipe' },
  ], { result: win ? 'victory' : 'wipe', rewards: win ? [{ item: { id: 'x' }, owner: 'a' }] : [], cooldownSecs: 570 }), meta({ level: 3 }));
  const recs = [mk(true), mk(true), mk(false), mk(true)];
  const sum = metrics.aggregate(recs, {});
  eq(sum.E.economy.cycleSecsMean, 600);
  eq(sum.E.economy.itemsPerHour, 4.5, '0.75 items/run * 6 runs/h');
  eq(sum.E.plateau.L3.clearRate, 0.75);
});

// ---- exit-code classes (subprocess against a tiny matrix) ----
T('threshold classes: hard fails exit 1, warn-only exits 0 (subprocess, tiny matrix)', () => {
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's4x-'));
  const tiny = {
    id: 's4-tiny', axes: [{
      id: 'tiny', boards: ['sparse_glass'],
      dungeons: [{ type: 'batch002', levels: [3] }],
      formations: ['formation1'], seeds: ['t-1'],
    }],
  };
  const mp = path.join(tmp, 'tiny.json');
  fs.writeFileSync(mp, JSON.stringify(tiny));
  // warn-only expectation: exit 0
  let code0 = 0;
  try { execFileSync(process.execPath, [path.join(REPO, 'tools', 'simulate.cjs'), 'run', mp], { stdio: 'pipe' }); }
  catch (e) { code0 = e.status; }
  eq(code0, 0, 'tiny matrix should pass (warn-only)');
  // determinism: two runs, same summary hash
  const out1 = execFileSync(process.execPath, [path.join(REPO, 'tools', 'simulate.cjs'), 'run', mp], { stdio: 'pipe' }).toString();
  const out2 = execFileSync(process.execPath, [path.join(REPO, 'tools', 'simulate.cjs'), 'run', mp], { stdio: 'pipe' }).toString();
  const h1 = (out1.match(/summary sha256: ([0-9a-f]+)/) || [])[1];
  const h2 = (out2.match(/summary sha256: ([0-9a-f]+)/) || [])[1];
  ok(h1 && h1 === h2, 'matrix determinism: identical summary hash');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('----------------------------------');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
