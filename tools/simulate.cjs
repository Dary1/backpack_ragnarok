#!/usr/bin/env node
'use strict';
// tools/simulate.cjs -- REQ-0050: the S4 simulate gate.
//
//   node tools/simulate.cjs run sim/s4_matrices/default.json [--out DIR] [--check-golden]
//
// Matrix runner + replay post-processor + threshold asserter (content_pipeline
// S4; combat_spec section 10). Deterministic: fixed seed lists in the matrix =>
// byte-identical summary.json => stable sha256 (the per-matrix golden).
// Exit codes: 0 = green (warnings allowed, reported), 1 = hard gate failure,
// 2 = usage/config error. No LLM anywhere.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const combat = require(path.join(REPO, 'sim', 'combat.cjs'));
const dungen = require(path.join(REPO, 'sim', 'dungen.cjs'));
const metrics = require(path.join(REPO, 'sim', 's4', 'metrics.cjs'));

function die(msg, code) { console.error('[s4] ' + msg); process.exit(code === undefined ? 2 : code); }
function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// canonical JSON: sorted keys, so the summary hash is stable.
function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  }
  if (x === Infinity) return '"Infinity"';
  return JSON.stringify(x === undefined ? null : x);
}

// ---------- content loading ----------
function loadDefs() {
  const liveItemsRaw = loadJSON(path.join(REPO, 'content', 'live', 'live_items.json'));
  const itemDefsById = {};
  for (const e of liveItemsRaw.entries) itemDefsById[e.id] = e;
  const liveItemIds = liveItemsRaw.entries.map(e => e.id);
  // batch-002 pilot items carry the only detection/unlock POs so far
  const pilotRaw = loadJSON(path.join(REPO, 'content', 'batches', 'batch-002-dungeon-pilot', 'items.json'));
  for (const e of pilotRaw.entries) if (!itemDefsById[e.id]) itemDefsById[e.id] = e;
  // REQ-0051: starter-unit kit items (the four content/s4_boards/starter_*.json
  // baselines reference them). Isolated file, same overlay-if-absent rule.
  try { const stRaw = loadJSON(path.join(REPO, "content", "live", "starter_items.json")); for (const e of stRaw.entries) if (!itemDefsById[e.id]) itemDefsById[e.id] = e; } catch (e) { /* absent = no starter items */ }
  // S4 fixture items (synthetic; pulse content debuts later -- circuit boards need them NOW)
  const fixRaw = loadJSON(path.join(REPO, 'content', 's4_boards', 's4_fixture_items.json'));
  for (const e of fixRaw.entries) itemDefsById[e.id] = e;
  const BATCH = path.join(REPO, 'content', 'batches', 'batch-002-dungeon-pilot');
  const enemiesRaw = loadJSON(path.join(BATCH, 'enemies.json'));
  const skillsRaw = loadJSON(path.join(BATCH, 'skills.json'));
  const dungeonRaw = loadJSON(path.join(BATCH, 'dungeon.json'));
  const enemyDefsById = {};
  for (const e of enemiesRaw.entries) enemyDefsById[e.id] = e;
  // REQ-0184: monster_pack/1 -- dungeon.json names its packs from packs.json.
  const packsRaw = loadJSON(path.join(BATCH, 'packs.json'));
  const monsterPackDefsById = {};
  for (const e of packsRaw.entries) monsterPackDefsById[e.id] = e;
  const skillDefsById = {};
  for (const s of skillsRaw.entries) skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
  let siDefsById;
  try {
    const sisRaw = loadJSON(path.join(REPO, 'content', 'live', 'live_sis.json'));
    siDefsById = {};
    for (const e of sisRaw.entries) siDefsById[e.id] = e;
  } catch (e) { siDefsById = undefined; }
  const poRarity = {};
  for (const id of Object.keys(itemDefsById)) poRarity[id] = itemDefsById[id].rarity || null;
  return { itemDefsById, enemyDefsById, skillDefsById, siDefsById, monsterPackDefsById, dungeonRaw, liveItemIds, poRarity };
}

function loadBoard(id) {
  const p = path.join(REPO, 'content', 's4_boards', id + '.json');
  if (!fs.existsSync(p)) die('board not found: ' + p);
  return loadJSON(p);
}

// ---------- board variants ----------
function delinkBoard(board) {
  const b = JSON.parse(JSON.stringify(board));
  for (const bp of b.bps) if (bp.linker) bp.linker = { off: bp.linker.off, dirs: [] };
  return b;
}
function coverageBoard(board, fraction) {
  // deterministically keep the first ceil(n*fraction) POs (stable order = author order)
  const b = JSON.parse(JSON.stringify(board));
  const keep = Math.max(1, Math.ceil(b.pos.length * fraction));
  b.pos = b.pos.slice(0, keep);
  const keptUids = new Set(b.pos.map(p => p.uid));
  b.sis = (b.sis || []).filter(s => !(s.host && s.host.po) || keptUids.has(s.host.po));
  return b;
}

// ---------- one run ----------
function runOne(defs, board, dungeonSpec, formationId, level, seed, variant, boardId, axisFlags) {
  let dungeonDef, dungeonKey;
  if (dungeonSpec.type === 'batch002') {
    dungeonDef = defs.dungeonRaw; dungeonKey = 'batch002';
  } else {
    dungeonDef = dungen.generate(dungeonSpec.type, level, dungeonSpec.genSeed || seed);
    dungeonKey = 'dungen/' + dungeonSpec.type;
  }
  // D4 denominators: ATTACHMENT rolls only (att_* events are attachment-scoped;
  // standalone trap/chest/door ENCOUNTERS resolve through encounter events instead).
  const defAtt = { trap: 0, chest: 0, door: 0 };
  let standaloneUtilEncounters = 0;
  for (const enc of dungeonDef.encounters || []) {
    for (const a of enc.attachments || []) if (defAtt[a.kind] !== undefined) defAtt[a.kind]++;
    if (enc.type === 'trap' || enc.type === 'chest' || enc.type === 'door') standaloneUtilEncounters++;
  }
  const out = combat.runDungeon({
    masterSeed: seed,
    dungeonDef,
    squadSnapshots: [board, board, board, board],
    itemDefsById: defs.itemDefsById,
    enemyDefsById: defs.enemyDefsById,
    monsterPackDefsById: defs.monsterPackDefsById, // REQ-0184
    skillDefsById: defs.skillDefsById,
    siDefsById: defs.siDefsById,
    formationId, level,
    participants: ['s4a', 's4b'],
  });
  const poInstances = {};
  for (const p of board.pos) poInstances[p.id] = (poInstances[p.id] || 0) + 4; // x4 squads
  return metrics.processRun(out, {
    boardId, dungeonKey, formationId, level, seed, variant: variant || 'base',
    playerBpIds: board.bps.map(b => b.id),
    defAtt, standaloneUtilEncounters, poInstances,
    levelCurve: !!(axisFlags && axisFlags.levelCurve),
  });
}

// ---------- matrix ----------
function runMatrix(matrixPath, opts) {
  const matrix = loadJSON(matrixPath);
  const thresholds = loadJSON(path.join(REPO, 'sim', 's4_thresholds.json'));
  const defs = loadDefs();
  const records = [];
  let runCount = 0;
  for (const axis of matrix.axes) {
    for (const boardId of axis.boards) {
      const base = loadBoard(boardId);
      const variants = [['base', base]];
      if (axis.delinkedVariant) variants.push(['delinked', delinkBoard(base)]);
      if (axis.coverageSeries) for (const f of axis.coverageSeries) variants.push(['cov' + Math.round(f * 100), coverageBoard(base, f)]);
      for (const [variant, board] of variants) {
        for (const d of axis.dungeons) {
          for (const level of (d.levels || [3])) {
            for (const formationId of axis.formations) {
              for (const seed of axis.seeds) {
                records.push(runOne(defs, board, d, formationId, level, axis.id + '/' + seed, variant, boardId, { levelCurve: !!axis.levelCurve }));
                runCount++;
              }
            }
          }
        }
      }
    }
  }
  const summary = metrics.aggregate(records, {
    dpsCeilings: (loadJSON(path.join(REPO, 'content', 'vocab.json')).dps_ceiling_warn) || {},
    poRarity: defs.poRarity,
    liveItemIds: defs.liveItemIds,
  });
  summary.matrixId = matrix.id;
  summary.runCount = runCount;
  const verdict = metrics.evaluate(summary, thresholds);
  const canon = canonical({ summary, verdict });
  const hash = sha(canon);
  return { matrix, summary, verdict, hash, canon, records };
}

// ---------- report ----------
function fmtReport(res) {
  const L = [];
  const s = res.summary, v = res.verdict;
  L.push('S4 SIMULATE GATE REPORT -- matrix "' + s.matrixId + '" (' + s.runCount + ' runs)');
  L.push('summary sha256: ' + res.hash);
  L.push('');
  L.push('== A. item/effect ==');
  for (const po of Object.keys(s.A.dpsPerPo)) {
    const d = s.A.dpsPerPo[po];
    L.push('  A1 ' + po + ': dps mean ' + d.mean + ' p95 ' + d.p95 + (d.ceiling ? ' (ceiling ' + d.ceiling + ' ' + d.rarity + ')' : ''));
  }
  for (const st of Object.keys(s.A.statuses)) {
    const a = s.A.statuses[st];
    L.push('  A2 ' + st + ': applies ' + a.applies + ' stacks ' + a.stacks + ' tickDmg ' + a.tickDamage + ' growth ' + a.growthRatio);
  }
  L.push('  A3 heal/run mean: ' + s.A.healPerRunMean + ' (block + overheal%: not derivable from replay v1)');
  if (s.A.circuit) L.push('  A4 circuit: pulses/s ' + s.A.circuit.pulsesPerSecMean + ' amp ' + s.A.circuit.amplificationFactor + 'x capHit ' + s.A.circuit.pulseCapHitRate + ' hops ' + JSON.stringify(s.A.circuit.hopHist));
  L.push('');
  L.push('== B. ray geometry ==');
  for (const src of Object.keys(s.B.bounceBySkill)) {
    const b = s.B.bounceBySkill[src];
    L.push('  B1/B3 ' + src + ': rays ' + b.fired + ' bounceMean ' + b.bounceMean + ' terminator ' + b.terminatorRate + ' idle ' + b.idleRate + ' aoeX ' + b.aoeExtraPerRay + ' penX ' + b.penExtraPerRay);
  }
  for (const f of ['player', 'enemy']) {
    const h = s.B.heatmap[f];
    L.push('  B2 ' + f + ' field: ' + h.visitedCells + ' visited cells, dead cols ' + JSON.stringify(h.deadColumns));
  }
  if (s.B.coverage) L.push('  B4 coverage: ' + s.B.coverage.series.map(x => x.variant + ' dmgTaken ' + x.dmgTakenMean + ' clear ' + x.clearRate).join(' | ') + (s.B.coverage.minimalDominates ? '  [DOMINATED]' : ''));
  if (s.B.formationEquity) L.push('  B5 formations: ' + JSON.stringify(s.B.formationEquity.winRates) + ' spread ' + s.B.formationEquity.spreadPts + 'pt sideShare ' + JSON.stringify(s.B.formationEquity.sideEntryDamageShare));
  L.push('  B6 ray aborts: ' + s.B.rayAborts);
  L.push('');
  L.push('== C. squad/troop ==');
  L.push('  C1 firstBPdown mean ' + s.C.timeToFirstBpDownMean + 's, wipe mean ' + s.C.timeToWipeMean + 's, downs ' + JSON.stringify(s.C.bpDownCounts));
  L.push('  C2 overkill ' + s.C.overkillPct + ' idleRays ' + s.C.idleRayPct);
  L.push('  C3 cascade factor mean ' + s.C.cascadeFactorMean);
  L.push('');
  L.push('== D. encounter/run ==');
  for (const k of Object.keys(s.D.encounterDurations)) {
    const d = s.D.encounterDurations[k];
    L.push('  D1 ' + k + ': mean ' + d.mean + 's p95 ' + d.p95 + 's (n ' + d.n + ')');
  }
  L.push('  D2 clear by level: ' + JSON.stringify(s.D.clearRateByLevel) + (s.D.monotonicityViolations.length ? ' VIOLATIONS ' + JSON.stringify(s.D.monotonicityViolations) : ''));
  if (s.D.hDistribution) L.push('  D3 H: mean ' + s.D.hDistribution.mean + ' low ' + s.D.hDistribution.fracLow + ' mid ' + s.D.hDistribution.fracMid + ' high ' + s.D.hDistribution.fracHigh);
  L.push('  D4 utility: trapDiscovery ' + s.D.utility.trapDiscoveryRate + ' chestDone ' + s.D.utility.chestCompletionRate + ' chestLost ' + s.D.utility.chestLostRate + ' totals ' + JSON.stringify(s.D.utility.attTotals));
  if (s.D.scoutNetEV) L.push('  D4 scout EV: rewardsDelta ' + s.D.scoutNetEV.rewardsDelta + ' hDelta ' + s.D.scoutNetEV.hDelta + ' dpsForegone ' + s.D.scoutNetEV.battleDpsForegoneRatio);
  L.push('  D5 shortcuts: ' + s.D.shortcut.count + ' jumps, mean ' + s.D.shortcut.jumpPctMean + '%');
  L.push('  D6 wipes: ' + s.D.wipes.count + ' (rate ' + s.D.wipes.rate + ') encHist ' + JSON.stringify(s.D.wipes.encounterIndexHist) + ' early ' + s.D.wipes.earlyWipeRate);
  L.push('');
  L.push('== E. meta/economy ==');
  L.push('  E1 cycle ' + s.E.economy.cycleSecsMean + 's items/h ' + s.E.economy.itemsPerHour + ' lrdst/h ' + s.E.economy.lrdstPerHour + ' items/day ' + s.E.economy.itemsPerDay + ' (warehouse cap 200 / 7d TTL)');
  L.push('  E2 ' + s.E.gachaAudit);
  L.push('  E3 plateau: ' + JSON.stringify(s.E.plateau));
  L.push('  E4 adoption: rate ' + s.E.adoption.adoptionRate + ' in-top ' + JSON.stringify(s.E.adoption.liveItemsInTopDecile));
  L.push('');
  L.push('== verdict ==');
  for (const w of v.warns) L.push('  WARN ' + w);
  for (const h of v.hards) L.push('  HARD ' + h);
  L.push(v.hards.length ? 'GATE: FAIL (' + v.hards.length + ' hard, ' + v.warns.length + ' warn)' : 'GATE: PASS (' + v.warns.length + ' warn)');
  return L.join('\n') + '\n';
}

// ---------- main ----------
function main() {
  const args = process.argv.slice(2);
  if (args[0] !== 'run' || !args[1]) die('usage: node tools/simulate.cjs run <matrix.json> [--out DIR] [--check-golden]');
  const matrixPath = args[1];
  let outDir = null, checkGolden = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--out') outDir = args[++i];
    else if (args[i] === '--check-golden') checkGolden = true;
    else die('unknown flag ' + args[i]);
  }
  const res = runMatrix(matrixPath, {});
  const report = fmtReport(res);
  process.stdout.write(report);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.txt'), report);
    fs.writeFileSync(path.join(outDir, 'summary.json'), res.canon + '\n');
    fs.writeFileSync(path.join(outDir, 'summary.sha256'), res.hash + '\n');
    console.log('[s4] wrote ' + outDir + '/{report.txt,summary.json,summary.sha256}');
  }
  if (checkGolden) {
    const gp = matrixPath.replace(/\.json$/, '.golden.sha256');
    if (!fs.existsSync(gp)) die('golden file missing: ' + gp);
    const want = fs.readFileSync(gp, 'utf8').trim();
    if (want !== res.hash) die('golden mismatch: want ' + want + ' got ' + res.hash, 1);
    console.log('[s4] golden OK');
  }
  process.exit(res.verdict.hards.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { runMatrix, fmtReport, canonical };
