#!/usr/bin/env node
'use strict';
// tools/autobalance_pack_powerlevel.cjs -- REQ-0297 Phase 3.
//
// Troop-FREE, all-pairs round-robin auto-adjuster for each monster_pack's
// `powerLevel` (the per-pack intrinsic combat level; STRONG pack = HIGH
// powerLevel). Supersedes REQ-0295's troop-based per-DUNGEON calibrator with a
// monster-vs-monster measurement via sim/balance/monster_arena.cjs (REQ-0296).
//
// ================= ALGORITHM (round-robin, no anchor) =====================
// Start every pack at powerLevel = 0. Each loop:
//   1. Present pack P at effLevel_P = T - powerLevel_P with T = 0 (only the
//      DIFFERENCES matter), i.e. effLevel_P = -powerLevel_P. The arena scales
//      that pack's hp + damage by g^effLevel_P (shipped scaling_profile, g=1.1).
//   2. Fight EVERY pair via the arena, SEEDS deterministic seeds, in BOTH
//      orientations (A-vs-B and B-vs-A) to cancel the arena's fire-order /
//      field-band positional bias (empirically slot B wins ~65:26 at eff 0).
//   3. Aggregate each pack's win-rate vs the whole field (a win=1, loss=0,
//      draw/timeout broken by remaining hp-fraction -> still sums to 1/game).
//   4. Update ALL packs SIMULTANEOUSLY (Jacobi):
//         dPowerLevel = alpha * (winRate% - 50) / 10       (FRACTIONAL; never rounded)
//      SIGN: a winner (winRate > 50) gets powerLevel RAISED (d > 0) => next loop
//      it presents at a LOWER effLevel => scaled DOWN => win-rate falls to 50%.
//      This is negative feedback -> self-normalisation. It matches the RUNTIME
//      semantics (effLevel = attackLv - powerLevel): the value we derive here IS
//      the pack.powerLevel the runtime reads.
//
// ================= NO EXTERNAL ANCHOR (theory + proof) ====================
// In a full round-robin every game contributes exactly 1.0 split between its two
// packs and every pack plays the same number of games, so Sum(winRate) = n/2 =>
// mean(winRate) = 50% EXACTLY => mean(dPowerLevel) = 0 EXACTLY every loop =>
// mean(powerLevel) is conserved. The set self-centres on the field average
// (powerLevel 0 = average pack); NO reference pack, NO re-anchoring. Verified
// empirically: mean(powerLevel) stays 0 to ~1e-15 every loop (see --report).
//
// ================= CONVERGENCE (observed, 14 live packs) ==================
// alpha 0.7 / seeds 6 / both-orientation, mean|winRate-50| over loops:
//   L0 24.5 -> L4 11.7 -> L5 5.1 -> L6 2.1 -> L7 1.2 -> L8 1.2 (flat), max|res|
//   settles ~3-4% (a structural floor: win/loss quantisation + pack
//   non-transitivity), per-loop max dPowerLevel -> ~0.27. alpha 0.5 needs ~10
//   loops; alpha >= 1.0 mildly oscillates (max-residual wanders up). Hence the
//   DEFAULTS below (conservative alpha, settled with 2 flat loops of margin).
//
// ================= DEPLOY HOOK (dirty trigger; --check) ===================
// Editing level-affecting content (skills / enemies / monster_packs) changes the
// live sha256 of those files. --check compares the live enemies.json/skills.json/
// packs.json sha256 to the stored `powerlevel_calibrated_from` marker (in
// content/registry.json) and exits NON-ZERO (dirty) when they differ. The intended
// hook: a pre-deploy step runs `--check`, and when dirty runs `--emit` ONCE,
// BATCHED at MERGE/DEPLOY -- regenerating every pack.powerLevel, re-stamping the
// marker, and shipping packs.json via the surgical content path. A CLEAN deploy
// skips it. Do NOT run per single edit. (This tool does not wire itself into a
// live deploy script; that is the integrated-deploy step's job.)
//
// Deterministic + reproducible: same {pack set, alpha, loops, seeds} -> identical
// powerLevel (pure functions of id-keyed seeds). Flags:
//   --report            print final powerLevel + per-loop residual win-rates + mean(powerLevel)
//   --emit              write powerLevel into live + batch-002 packs.json + registry (see EMIT note)
//   --check             dirty detection (exit 1 if content changed since last calibration)
//   --alpha N --loops N --seeds N   tune the iteration (defaults 0.7 / 8 / 6)
//   --json              machine-readable report
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const arena = require(path.join(__dirname, '..', 'sim', 'balance', 'monster_arena.cjs'));

const ROOT = path.join(__dirname, '..');
const LIVE_PACKS = path.join(ROOT, 'content', 'live', 'dungeon', 'packs.json');
const BASE_PACKS = path.join(ROOT, 'content', 'batches', 'batch-002-dungeon-pilot', 'packs.json');
const REGISTRY = path.join(ROOT, 'content', 'registry.json');
const LEVEL_FILES = ['enemies.json', 'skills.json', 'packs.json']; // the level-affecting live files (--check)

const DEFAULT_ALPHA = 0.7;
const DEFAULT_LOOPS = 8;
const DEFAULT_SEEDS = 6;
const STORE_DP = 4; // stored powerLevel precision (fractional; keeps emit byte-reproducible)

// ---- win scoring: a win=1, loss=0, draw/timeout broken by remaining hp -------
// Whatever the outcome, scoreA + scoreB === 1 exactly, so the round-robin mean
// stays 50% (the no-anchor invariant). Timeouts/draws are decided by which side
// kept more of its hp -- an informative "who was ahead", not a coin-flip 0.5.
function scoreA(r) {
  if (r.winner === 'A') return 1;
  if (r.winner === 'B') return 0;
  if (r.a.hpFrac > r.b.hpFrac) return 1;
  if (r.a.hpFrac < r.b.hpFrac) return 0;
  return 0.5;
}

// ---- one measurement loop: aggregate win-rate per pack vs the field ----------
// Both orientations of every unordered pair, SEEDS seeds each, at the given
// per-pack presentation effLevel = -powerLevel. Pure + deterministic in
// {pl, seeds, defs, packIds}: seeds are keyed on the CANONICAL (id-sorted) pair
// so the result is invariant to entry order.
function measure(pl, seeds, defs, packIds) {
  const n = packIds.length;
  const win = new Array(n).fill(0);
  const games = new Array(n).fill(0);
  let timeouts = 0, draws = 0;
  const acc = (r, aIdx, bIdx) => {
    const sa = scoreA(r);
    win[aIdx] += sa; win[bIdx] += 1 - sa;
    games[aIdx] += 1; games[bIdx] += 1;
    if (r.winner === 'timeout') timeouts += 1;
    if (r.winner === 'draw') draws += 1;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const canon = [packIds[i], packIds[j]].slice().sort();
      for (let k = 0; k < seeds; k++) {
        const seed = 'rr|' + canon[0] + '|' + canon[1] + '|' + k;
        const r1 = arena.runMonsterArena({ packA: packIds[i], packB: packIds[j], effLevelA: -pl[i], effLevelB: -pl[j], seed, defs });
        acc(r1, i, j);
        const r2 = arena.runMonsterArena({ packA: packIds[j], packB: packIds[i], effLevelA: -pl[j], effLevelB: -pl[i], seed, defs });
        acc(r2, j, i);
      }
    }
  }
  const winRate = win.map((w, idx) => (games[idx] ? 100 * w / games[idx] : 50));
  return { winRate, games, timeouts, draws };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const round = (x, dp) => { const p = Math.pow(10, dp); return Math.round(x * p) / p; };

// ---- the round-robin driver -------------------------------------------------
// Returns { packIds, powerLevel (final, rounded to STORE_DP), powerLevelRaw,
// history[] }, where each history row is the state ENTERING that loop (its
// residual win-rates + mean(powerLevel)); the final row (L === loops) is the
// converged state after the last update. Injectable `defs` lets the test drive a
// tiny synthetic pack set.
function autobalance(opts) {
  opts = opts || {};
  const alpha = opts.alpha != null ? opts.alpha : DEFAULT_ALPHA;
  const loops = opts.loops != null ? opts.loops : DEFAULT_LOOPS;
  const seeds = opts.seeds != null ? opts.seeds : DEFAULT_SEEDS;
  const defs = opts.defs || arena.loadContent();
  const packIds = opts.packIds || Object.keys(defs.monsterPackDefsById);
  const n = packIds.length;
  if (!defs.scaling) throw new Error('autobalance: no scaling profile loaded -- effLevel would be inert (content/scaling_profile.json missing?)');
  let pl = new Array(n).fill(0);
  const history = [];
  for (let L = 0; L <= loops; L++) {
    const m = measure(pl, seeds, defs, packIds);
    const resid = m.winRate.map((x) => Math.abs(x - 50));
    history.push({
      loop: L,
      winRate: m.winRate.slice(),
      powerLevel: pl.slice(),
      meanResid: mean(resid),
      maxResid: Math.max.apply(null, resid),
      meanPowerLevel: mean(pl),
      timeouts: m.timeouts,
      draws: m.draws,
    });
    if (L < loops) pl = pl.map((p, idx) => p + alpha * (m.winRate[idx] - 50) / 10); // Jacobi, fractional
  }
  return {
    packIds, alpha, loops, seeds,
    powerLevelRaw: pl.slice(),
    powerLevel: pl.map((x) => round(x, STORE_DP)),
    history,
  };
}

// ---- --emit surgical content write ------------------------------------------
// packs.json is an ADDITIVE-promoted file (REQ-0122): the 4 batch-002 base packs
// live at the HEAD of content/live/dungeon/packs.json byte-for-byte, then batch-005/
// 006 additive packs are spliced in. The REQ-0122 lossless test asserts (a) live
// packs.json sha256 == the LAST additive layer's recorded sha, and (b) the live
// head is byte-identical to batch-002's bytes. So a green in-worktree emit must:
//   * insert powerLevel into ALL live packs (byte-preserving line insertion),
//   * insert the SAME 4 base packs' powerLevel into batch-002 identically,
//   * re-stamp registry live_dungeon_additive[last].files["packs.json"] = new live sha,
//   * stamp the powerlevel_calibrated_from marker.
// A byte-preserving line insert (after each entry's "id" line, matching indent)
// keeps the base head identical between the two files. NOTE the additive SOURCE
// batches (batch-005/006 .../packs.json) are NOT touched here -- the lossless test
// does not read them, but a future wholesale RE-PROMOTION would want the same
// powerLevel; that sync is FLAGGED for the integrated-deploy step.
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function upsertPowerLevel(text, id, valStr) {
  const idRe = new RegExp('([ \\t]*)"id"\\s*:\\s*"' + escRe(id) + '"\\s*,?');
  const m = idRe.exec(text);
  if (!m) throw new Error('autobalance --emit: pack id not found in packs.json text: ' + id);
  const indent = m[1];
  const headEnd = m.index + m[0].length;
  const after = text.slice(headEnd);
  const nextId = after.search(/"id"\s*:/);
  const winLen = nextId >= 0 ? nextId : after.length;
  const window = after.slice(0, winLen);
  const rest = after.slice(winLen);
  const plRe = /("powerLevel"\s*:\s*)(-?\d+(?:\.\d+)?)/;
  if (plRe.test(window)) {
    return text.slice(0, headEnd) + window.replace(plRe, '$1' + valStr) + rest; // idempotent re-emit
  }
  return text.slice(0, headEnd) + '\n' + indent + '"powerLevel": ' + valStr + ',' + after;
}
function valStr(x) { return String(round(x, STORE_DP)); }
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function emit(result) {
  const idToVal = {};
  result.packIds.forEach((id, i) => { idToVal[id] = valStr(result.powerLevelRaw[i]); });
  // 1. live packs.json -- every pack.
  let liveText = fs.readFileSync(LIVE_PACKS, 'utf8');
  for (const id of result.packIds) liveText = upsertPowerLevel(liveText, id, idToVal[id]);
  fs.writeFileSync(LIVE_PACKS, liveText);
  // 2. batch-002 base packs.json -- only the 4 base packs it contains.
  let baseText = fs.readFileSync(BASE_PACKS, 'utf8');
  const baseDoc = JSON.parse(baseText);
  const baseIds = baseDoc.entries.map((e) => e.id);
  for (const id of baseIds) baseText = upsertPowerLevel(baseText, id, idToVal[id]);
  fs.writeFileSync(BASE_PACKS, baseText);
  // 3. registry: re-stamp the additive-layer packs.json sha + the calibrated-from marker.
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const newLiveSha = sha256File(LIVE_PACKS);
  const layers = Array.isArray(reg.live_dungeon_additive) ? reg.live_dungeon_additive : [];
  let stampedLayer = null;
  if (layers.length) {
    const last = layers[layers.length - 1];
    if (last.files && last.files['packs.json']) { last.files['packs.json'] = newLiveSha; stampedLayer = last.promoted_from || '(last additive layer)'; }
  }
  const marker = {};
  for (const f of LEVEL_FILES) marker[f] = sha256File(path.join(ROOT, 'content', 'live', 'dungeon', f));
  reg.powerlevel_calibrated_from = {
    note: 'REQ-0297: sha256 of the level-affecting live files at the last powerLevel autobalance. --check is dirty when live differs.',
    date: new Date().toISOString().slice(0, 10),
    alpha: result.alpha, loops: result.loops, seeds: result.seeds,
    files: marker,
  };
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 1) + '\n');
  return { liveSha: newLiveSha, baseIds, stampedLayer, marker };
}

// ---- --check dirty detection ------------------------------------------------
function check() {
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch (e) { /* no registry */ }
  const marker = reg.powerlevel_calibrated_from && reg.powerlevel_calibrated_from.files;
  const cur = {};
  for (const f of LEVEL_FILES) cur[f] = sha256File(path.join(ROOT, 'content', 'live', 'dungeon', f));
  if (!marker) return { dirty: true, reason: 'never calibrated (no powerlevel_calibrated_from marker)', cur };
  const changed = LEVEL_FILES.filter((f) => marker[f] !== cur[f]);
  return { dirty: changed.length > 0, reason: changed.length ? 'changed: ' + changed.join(', ') : 'clean', changed, cur, marker };
}

// ---- report -----------------------------------------------------------------
function printReport(result, runtimeMs, asJson) {
  if (asJson) {
    console.log(JSON.stringify({
      alpha: result.alpha, loops: result.loops, seeds: result.seeds, runtimeMs,
      packs: result.packIds.map((id, i) => ({ id, powerLevel: result.powerLevel[i], finalWinRate: round(result.history[result.loops].winRate[i], 2) })),
      perLoop: result.history.map((h) => ({ loop: h.loop, meanResid: round(h.meanResid, 3), maxResid: round(h.maxResid, 3), meanPowerLevel: h.meanPowerLevel, timeouts: h.timeouts })),
    }, null, 2));
    return;
  }
  console.log('# autobalance_pack_powerlevel  (alpha=' + result.alpha + ' loops=' + result.loops + ' seeds=' + result.seeds + ' both-orientation round-robin)');
  console.log('# ' + result.packIds.length + ' packs, ' + (runtimeMs / 1000).toFixed(1) + 's');
  console.log('#');
  console.log('# per-loop convergence (residual = |winRate-50|; meanPL conserved => no anchor):');
  console.log('#   loop  meanResid  maxResid   mean(powerLevel)   timeouts');
  for (const h of result.history) {
    console.log('    ' + String(h.loop).padStart(3) + '   ' + h.meanResid.toFixed(2).padStart(7) + '   ' + h.maxResid.toFixed(2).padStart(7) + '   ' + h.meanPowerLevel.toExponential(2).padStart(12) + '   ' + String(h.timeouts).padStart(6));
  }
  console.log('#');
  console.log('# derived powerLevel + settled win-rate vs field (STRONG pack = HIGH powerLevel):');
  const finalWr = result.history[result.loops].winRate;
  const order = result.packIds.map((id, i) => i).sort((a, b) => result.powerLevelRaw[b] - result.powerLevelRaw[a]);
  for (const i of order) {
    console.log('    ' + result.packIds[i].padEnd(24) + ' powerLevel=' + result.powerLevel[i].toFixed(STORE_DP).padStart(9) + '   finalWinRate=' + finalWr[i].toFixed(1).padStart(5) + '%');
  }
}

// ---- CLI --------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getN = (flag, def) => { const idx = argv.indexOf(flag); return idx >= 0 ? Number(argv[idx + 1]) : def; };
  const asJson = argv.includes('--json');
  const doEmit = argv.includes('--emit');
  const doCheck = argv.includes('--check');
  const doReport = argv.includes('--report') || (!doEmit && !doCheck);

  if (doCheck && !doEmit && !doReport) {
    const c = check();
    console.log('[autobalance --check] ' + (c.dirty ? 'DIRTY' : 'CLEAN') + ' -- ' + c.reason);
    process.exit(c.dirty ? 1 : 0);
  }

  const alpha = getN('--alpha', DEFAULT_ALPHA);
  const loops = getN('--loops', DEFAULT_LOOPS);
  const seeds = getN('--seeds', DEFAULT_SEEDS);
  const t0 = Date.now();
  const result = autobalance({ alpha, loops, seeds });
  const runtimeMs = Date.now() - t0;

  if (doReport) printReport(result, runtimeMs, asJson);

  if (doCheck) {
    const c = check();
    console.log('[autobalance --check] ' + (c.dirty ? 'DIRTY' : 'CLEAN') + ' -- ' + c.reason);
  }

  if (doEmit) {
    const e = emit(result);
    console.log('[autobalance --emit] wrote ' + result.packIds.length + ' powerLevel values:');
    console.log('  live  ' + path.relative(ROOT, LIVE_PACKS) + '  sha256=' + e.liveSha.slice(0, 16) + '...');
    console.log('  base  ' + path.relative(ROOT, BASE_PACKS) + '  (' + e.baseIds.length + ' base packs: ' + e.baseIds.join(', ') + ')');
    console.log('  registry additive-layer packs.json sha re-stamped (' + (e.stampedLayer || 'none') + '); powerlevel_calibrated_from marker set');
    console.log('  FLAG: additive SOURCE batches (batch-005/006 .../packs.json) NOT edited -- sync them (same powerLevel per pack) for a byte-lossless re-promotion; main checkout is the integrated-deploy step.');
  }
}

module.exports = { autobalance, measure, scoreA, emit, check, upsertPowerLevel, DEFAULT_ALPHA, DEFAULT_LOOPS, DEFAULT_SEEDS };
