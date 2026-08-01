#!/usr/bin/env node
'use strict';
// tools/predeploy_recalibrate_powerlevel.cjs -- REQ-0306.
//
// The MANDATORY final step of the content-deploy runbook
// (docs/llm_managed/content_deploy_runbook.md): run on the MAIN checkout
// (~/backpack_ragnarok @ master -- the live tree served by the backpack-api
// user unit via mtime hot-reload) after any level-affecting content promotion
// (tools/promote_dungeon_batch.cjs or a surgical edit of
// content/live/dungeon/{enemies,skills,packs}.json) and BEFORE
// `systemctl --user restart backpack-api`.
//
// What it does (batched, ONCE per deploy -- never per single edit):
//   1. `--check` (CHECKOUT-relative; = "live" only on the main checkout @
//      master): compare the sha256 of the three level-affecting live files
//      against the `powerlevel_calibrated_from` marker in content/registry.json.
//   2. CLEAN -> no-op, ZERO writes, exit 0.
//   3. DIRTY -> run the deterministic all-pairs round-robin autobalance with
//      the MARKER DEFAULTS (alpha 0.7 / loops 8 / seeds 6 -- REQ-0297; no
//      custom tuning at deploy), `emit` every pack.powerLevel (live + batch-002
//      base, REQ-0122 lossless kept green), re-stamp the marker, then
//      re-`check` and FAIL (exit 1) if somehow still dirty. Exit 0 on success.
//
// Idempotent: a second run immediately after a successful run is a CLEAN
// no-op. Deterministic: same content -> identical powerLevel / packs.json
// bytes (the marker `date` field is wall-clock and exempt).
//
// KNOWN GAPS (outside the sha dirty-set; see REQ-0306):
//   * content/scaling_profile.json and sim-code changes are level-affecting
//     but NOT detected -- they still need a manual
//     `node tools/autobalance_pack_powerlevel.cjs --emit`.
//   * additive SOURCE batches (batch-005/006/007 packs.json) carry no
//     powerLevel; a wholesale re-promotion would drift (flagged by --emit).
//
// Flags:
//   --self-test   DB-free orchestration self-test on a temp fixture (no live
//                 content read or written); run by tools/ci.sh [3.997/7].
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ---- orchestration core -----------------------------------------------------
// `tool` is injectable ({check, autobalance, emit}) so the self-test can drive
// the check->emit->check contract against a fixture-backed fake. The REAL
// check/emit mechanics are REQ-0297's and are pinned by that REQ's gates; what
// THIS script owns -- and what the self-test pins -- is the orchestration:
// clean => zero writes; dirty => emit with defaults + marker re-stamp; a
// post-emit re-check that refuses to report success while still dirty.
function runPredeploy(tool, log) {
  log = log || function (s) { console.log(s); };
  const c0 = tool.check();
  if (!c0.dirty) {
    log('[predeploy-recalibrate] CLEAN -- ' + (c0.reason || 'marker matches') + ' -- no-op (zero writes)');
    return { acted: false };
  }
  log('[predeploy-recalibrate] DIRTY -- ' + c0.reason + ' -- running batched round-robin autobalance (marker defaults; no custom tuning at deploy)');
  const t0 = Date.now();
  const result = tool.autobalance({}); // {} => the tool's own defaults = the marker defaults (alpha 0.7 / loops 8 / seeds 6)
  const e = tool.emit(result);
  const c1 = tool.check();
  if (c1.dirty) {
    throw new Error('[predeploy-recalibrate] STILL DIRTY after emit (' + c1.reason + ') -- do NOT deploy; investigate before restarting backpack-api');
  }
  log('[predeploy-recalibrate] recalibrated ' + result.packIds.length + ' packs in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's; powerlevel_calibrated_from re-stamped; now CLEAN');
  log('[predeploy-recalibrate] REMEMBER: commit the regenerated packs.json + registry.json before restarting backpack-api');
  return { acted: true, emit: e, result };
}

// ---- fixture-backed fake tool for --self-test -------------------------------
// Mirrors the REAL semantics that matter to the orchestration: check() compares
// current file sha256s to the marker (dirty when absent or different); emit()
// FIRST writes powerLevel into packs.json, THEN stamps the marker from the
// POST-write bytes (the ordering the real emit must honour, or a fresh emit
// would immediately re-report dirty).
const FIXTURE_LEVEL_FILES = ['enemies.json', 'skills.json', 'packs.json'];
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function fixtureTool(root) {
  const reg = path.join(root, 'registry.json');
  const fp = (f) => path.join(root, f);
  return {
    check() {
      let r = {};
      try { r = JSON.parse(fs.readFileSync(reg, 'utf8')); } catch (e) { /* no registry */ }
      const marker = r.powerlevel_calibrated_from && r.powerlevel_calibrated_from.files;
      const cur = {};
      for (const f of FIXTURE_LEVEL_FILES) cur[f] = sha256(fp(f));
      if (!marker) return { dirty: true, reason: 'never calibrated (no powerlevel_calibrated_from marker)', cur };
      const changed = FIXTURE_LEVEL_FILES.filter((f) => marker[f] !== cur[f]);
      return { dirty: changed.length > 0, reason: changed.length ? 'changed: ' + changed.join(', ') : 'clean', changed, cur, marker };
    },
    autobalance(opts) {
      if (opts == null || Object.keys(opts).length) throw new Error('fixture autobalance: predeploy must pass {} (marker defaults only)');
      return { packIds: ['fx_alpha', 'fx_bravo'], powerLevelRaw: [0.5, -0.5], powerLevel: [0.5, -0.5], alpha: 0.7, loops: 8, seeds: 6 };
    },
    emit(result) {
      const doc = JSON.parse(fs.readFileSync(fp('packs.json'), 'utf8'));
      doc.entries.forEach((e2) => {
        const i = result.packIds.indexOf(e2.id);
        if (i >= 0) e2.powerLevel = result.powerLevel[i];
      });
      fs.writeFileSync(fp('packs.json'), JSON.stringify(doc, null, 1) + '\n');
      let r = {};
      try { r = JSON.parse(fs.readFileSync(reg, 'utf8')); } catch (e) { r = {}; }
      const files = {};
      for (const f of FIXTURE_LEVEL_FILES) files[f] = sha256(fp(f)); // POST-write shas
      r.powerlevel_calibrated_from = { alpha: result.alpha, loops: result.loops, seeds: result.seeds, files };
      fs.writeFileSync(reg, JSON.stringify(r, null, 1) + '\n');
      return { liveSha: files['packs.json'] };
    },
  };
}

// ---- --self-test ------------------------------------------------------------
function selfTest() {
  let n = 0;
  const ok = (cond, msg) => { n += 1; if (!cond) throw new Error('self-test FAIL [' + n + ']: ' + msg); console.log('  ok ' + n + '  ' + msg); };
  const quiet = () => {};

  // real-module wiring: the functions the default CLI path calls must exist.
  const real = require(path.join(__dirname, 'autobalance_pack_powerlevel.cjs'));
  ok(typeof real.check === 'function' && typeof real.autobalance === 'function' && typeof real.emit === 'function',
    'real autobalance module exports check/autobalance/emit (CLI wiring target)');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy_recal_selftest_'));
  try {
    fs.writeFileSync(path.join(root, 'enemies.json'), '{"schema":"enemy/1","entries":[{"id":"fx_gob"}]}\n');
    fs.writeFileSync(path.join(root, 'skills.json'), '{"schema":"skill/1","entries":[{"id":"fx_hit"}]}\n');
    fs.writeFileSync(path.join(root, 'packs.json'), JSON.stringify({ schema: 'monster_pack/1', entries: [{ id: 'fx_alpha' }, { id: 'fx_bravo' }] }, null, 1) + '\n');
    const tool = fixtureTool(root);

    // 1. never-calibrated fixture is DIRTY -> run acts, emits, stamps, ends CLEAN.
    const r1 = runPredeploy(tool, quiet);
    ok(r1.acted === true, 'dirty (no marker) fixture -> predeploy ACTS (emit + marker)');
    const c1 = tool.check();
    ok(!c1.dirty, 'post-emit check is CLEAN (marker hashes POST-write bytes)');
    const packs1 = fs.readFileSync(path.join(root, 'packs.json'), 'utf8');
    ok(/"powerLevel": 0\.5/.test(packs1) && /"powerLevel": -0\.5/.test(packs1), 'emit wrote powerLevel into packs.json');
    const marker1 = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8')).powerlevel_calibrated_from;
    ok(marker1.alpha === 0.7 && marker1.loops === 8 && marker1.seeds === 6, 'marker records the DEFAULT alpha/loops/seeds (no custom tuning at deploy)');

    // 2. immediate second run is a CLEAN no-op with ZERO writes.
    const bytesBefore = FIXTURE_LEVEL_FILES.concat(['registry.json']).map((f) => fs.readFileSync(path.join(root, f)));
    const r2 = runPredeploy(tool, quiet);
    ok(r2.acted === false, 'second run is a no-op (idempotent)');
    const unchanged = FIXTURE_LEVEL_FILES.concat(['registry.json']).every((f, i) => fs.readFileSync(path.join(root, f)).equals(bytesBefore[i]));
    ok(unchanged, 'clean run performed ZERO writes (all bytes identical)');

    // 3. touching a level-affecting file re-dirties -> predeploy acts again.
    fs.appendFileSync(path.join(root, 'skills.json'), '\n');
    const c3 = tool.check();
    ok(c3.dirty && /skills\.json/.test(c3.reason), 'editing skills.json flips check to DIRTY naming the file');
    const r3 = runPredeploy(tool, quiet);
    ok(r3.acted === true && !tool.check().dirty, 're-dirtied fixture -> predeploy re-acts and ends CLEAN');

    // 4. a broken emit (marker not stamped) must FAIL LOUDLY, not report success.
    fs.appendFileSync(path.join(root, 'enemies.json'), '\n');
    const broken = fixtureTool(root);
    broken.emit = () => ({}); // stamps nothing
    let threw = false;
    try { runPredeploy(broken, quiet); } catch (e) { threw = /STILL DIRTY/.test(String(e.message)); }
    ok(threw, 'emit that fails to stamp the marker -> predeploy throws STILL DIRTY (refuses false success)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('[predeploy-recalibrate --self-test] OK (' + n + ' assertions, DB-free, no live content touched)');
}

// ---- CLI --------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
  } else {
    const tool = require(path.join(__dirname, 'autobalance_pack_powerlevel.cjs'));
    try { runPredeploy(tool); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
  }
}

module.exports = { runPredeploy, fixtureTool, selfTest };
