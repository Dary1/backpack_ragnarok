#!/usr/bin/env node
'use strict';
// tools/balance_sim.cjs -- REQ-0269: balance sim harness. Monte Carlo battle
// evaluation of a generated content candidate (item / enemy / skill) against a
// baseline, through the real combat engine (sim/combat.cjs runDungeon) and the
// S4 metrics post-processor (sim/s4/metrics.cjs). No LLM, no server, no ports:
// pure in-process. Content is PINNED to THIS worktree's content/live (+
// content/live/dungeon) via __dirname -- never os.homedir, never batch dirs;
// s4_boards/* are reused as loadout TEMPLATES. Determinism: seeded RNG end to
// end (both arms of a matrix cell share the cell master seed, so a delta is
// attributable to the candidate alone); the COMPARISON PAYLOAD
// (metrics/deltas/flags) is timestamp/path-free and double-run identical.
//
//   node tools/balance_sim.cjs run --candidate <id|path> [--kind item|enemy|skill]
//        [--seeds N] [--levels a,b] [--boards n|id,id] [--builder greedy|random]
//        [--pack <id>] [--slot i] [--out DIR] [--json]
//
// Exit codes: 0 clean, 1 flagged (a 'flag'-level band tripped), 2 usage error.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const combat = require(path.join(REPO, 'sim', 'combat.cjs'));
const metrics = require(path.join(REPO, 'sim', 's4', 'metrics.cjs'));
const builders = require(path.join(REPO, 'sim', 'balance', 'builders.cjs'));
const inject = require(path.join(REPO, 'sim', 'balance', 'inject.cjs'));

const { processRun, _stats } = metrics;
const { mean, p95, round } = _stats;

const DEFAULT_BOARDS = ['dense_turtle', 'scout_heavy', 'no_utility_control', 'sparse_glass', 'circuit_chain'];
const DEFAULT_PACK = 'pack_frost_scouts';
const DEFAULT_ARENA_ENCOUNTERS = 4;
const FORMATION = 'formation1';

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function usage(msg) { const e = new Error(msg); e.__usage = true; return e; }
function die(msg, code) { console.error('[balance_sim] ' + msg); process.exit(code === undefined ? 2 : code); }
function sumVals(o) { let s = 0; for (const k in o) s += o[k]; return s; }
function p50(xs) { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  if (x === Infinity) return '"Infinity"';
  if (x === -Infinity) return '"-Infinity"';
  return JSON.stringify(x === undefined ? null : x);
}

// ---------- content loading (PINNED to this worktree) ----------
function loadDefs() {
  const items = loadJSON(path.join(REPO, 'content', 'live', 'live_items.json'));
  const itemDefsById = {}; const liveItemIds = [];
  for (const e of items.entries) { itemDefsById[e.id] = e; liveItemIds.push(e.id); }
  // starter-unit kit items: some s4_boards templates reference them (overlay-if-absent).
  try { const st = loadJSON(path.join(REPO, 'content', 'live', 'starter_items.json')); for (const e of st.entries) if (!itemDefsById[e.id]) itemDefsById[e.id] = e; } catch (e) { /* absent */ }
  const enemies = loadJSON(path.join(REPO, 'content', 'live', 'dungeon', 'enemies.json'));
  const enemyDefsById = {}; for (const e of enemies.entries) enemyDefsById[e.id] = e;
  const skillsRaw = loadJSON(path.join(REPO, 'content', 'live', 'dungeon', 'skills.json'));
  const skillDefsById = {}; const skillFullById = {};
  for (const s of skillsRaw.entries) { skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes }; skillFullById[s.id] = s; }
  const packs = loadJSON(path.join(REPO, 'content', 'live', 'dungeon', 'packs.json'));
  const monsterPackDefsById = {}; for (const p of packs.entries) monsterPackDefsById[p.id] = p;
  const dungeonDef = loadJSON(path.join(REPO, 'content', 'live', 'dungeon', 'dungeon.json'));
  let siDefsById; try { const s = loadJSON(path.join(REPO, 'content', 'live', 'live_sis.json')); siDefsById = {}; for (const e of s.entries) siDefsById[e.id] = e; } catch (e) { siDefsById = undefined; }
  const vocab = loadJSON(path.join(REPO, 'content', 'vocab.json'));
  return { itemDefsById, liveItemIds, enemyDefsById, skillDefsById, skillFullById, monsterPackDefsById, dungeonDef, siDefsById, vocab };
}

function loadBoard(id) {
  const p = path.join(REPO, 'content', 's4_boards', id + '.json');
  if (!fs.existsSync(p)) throw usage('board template not found: ' + id);
  return loadJSON(p);
}

// Outlier bands: prefer content/corpus_stats.json (REQ-0268) when present; its
// `bands` overlay the hand-set sim/balance_bands.json defaults. Absence is
// graceful -- we just use the defaults.
function loadBands() {
  const defaults = loadJSON(path.join(REPO, 'sim', 'balance_bands.json'));
  const corpusPath = path.join(REPO, 'content', 'corpus_stats.json');
  if (fs.existsSync(corpusPath)) {
    try {
      const c = loadJSON(corpusPath);
      if (c && c.bands && typeof c.bands === 'object') return { bands: Object.assign({}, defaults, c.bands), source: 'corpus_stats+balance_bands' };
    } catch (e) { /* malformed -> fall back */ }
  }
  return { bands: defaults, source: 'balance_bands' };
}

// ---------- candidate resolution ----------
function looksLikePath(s) { return s.indexOf('/') !== -1 || s.indexOf('\\') !== -1 || /\.json$/i.test(s); }
function inferKind(def) {
  if (def.schema && /^po\b|^po\//.test(def.schema)) return 'item';
  if (def.schema && /^enemy\b|^enemy\//.test(def.schema)) return 'enemy';
  if (def.schema && /^skill\b|^skill\//.test(def.schema)) return 'skill';
  if (Array.isArray(def.shape) && Array.isArray(def.effects)) return 'item';
  if (Array.isArray(def.hp) && Array.isArray(def.skills)) return 'enemy';
  if (def.attack_profile && def.verb && def.trigger) return 'skill';
  return null;
}
function resolveCandidate(arg, kindArg, defs) {
  if (looksLikePath(arg)) {
    const fp = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    if (!fs.existsSync(fp)) throw usage('candidate file not found: ' + fp);
    let raw; try { raw = loadJSON(fp); } catch (e) { throw usage('candidate file is not valid JSON: ' + e.message); }
    let def = raw;
    if (raw && Array.isArray(raw.entries)) {
      if (raw.entries.length !== 1) throw usage('candidate file must contain exactly one def (entries length ' + raw.entries.length + ')');
      def = raw.entries[0];
    }
    const kind = kindArg || inferKind(def);
    if (!kind) throw usage('cannot infer candidate kind from file; pass --kind item|enemy|skill');
    return { kind, def, source: fp };
  }
  const id = arg;
  let kind = kindArg;
  if (!kind) {
    const hits = [];
    if (defs.itemDefsById[id]) hits.push('item');
    if (defs.enemyDefsById[id]) hits.push('enemy');
    if (defs.skillDefsById[id]) hits.push('skill');
    if (!hits.length) throw usage('candidate "' + id + '" is neither an existing file nor a known live id');
    if (hits.length > 1) throw usage('candidate id "' + id + '" is ambiguous across ' + hits.join(',') + '; pass --kind');
    kind = hits[0];
  }
  let def;
  if (kind === 'item') def = defs.itemDefsById[id];
  else if (kind === 'enemy') def = defs.enemyDefsById[id];
  else if (kind === 'skill') def = defs.skillFullById[id];
  if (!def) throw usage('candidate id "' + id + '" not found as ' + kind);
  return { kind, def, source: id };
}

// ---------- validation (closed vocab) ----------
function validateCandidate(kind, def, defs) {
  const vocab = defs.vocab;
  const triggers = new Set(vocab.triggers || []);
  const verbs = new Set(vocab.verbs || []);
  const rarities = new Set(vocab.rarities || []);
  const errs = [];
  const checkEffect = (eff, where) => {
    if (!eff || typeof eff !== 'object') { errs.push(where + ': not an object'); return; }
    if (!eff.trigger || !triggers.has(eff.trigger.t)) errs.push(where + ': unknown trigger "' + (eff.trigger && eff.trigger.t) + '" (closed vocab)');
    if (!eff.verb || !verbs.has(eff.verb.t)) errs.push(where + ': unknown verb "' + (eff.verb && eff.verb.t) + '" (closed vocab)');
  };
  if (kind === 'item') {
    if (!def.id) errs.push('item: missing id');
    if (!Array.isArray(def.shape) || !def.shape.length) errs.push('item: shape must be a non-empty array of [r,c]');
    else for (const cell of def.shape) if (!Array.isArray(cell) || cell.length !== 2) { errs.push('item: bad shape cell ' + JSON.stringify(cell)); break; }
    if (!rarities.has(def.rarity)) errs.push('item: rarity "' + def.rarity + '" not in closed vocab ' + JSON.stringify(Array.from(rarities)));
    if (!Array.isArray(def.effects)) errs.push('item: effects must be an array');
    else def.effects.forEach((e, i) => checkEffect(e, 'item.effects[' + i + ']'));
  } else if (kind === 'skill') {
    if (!def.id) errs.push('skill: missing id');
    checkEffect({ trigger: def.trigger, verb: def.verb }, 'skill');
    if (!def.attack_profile) errs.push('skill: missing attack_profile');
  } else if (kind === 'enemy') {
    if (!def.id) errs.push('enemy: missing id');
    if (!Array.isArray(def.hp) || def.hp.length !== 2) errs.push('enemy: hp must be [lo,hi]');
    if (!Array.isArray(def.skills)) errs.push('enemy: skills must be an array of skill ids');
    else for (const sk of def.skills) if (!defs.skillDefsById[sk]) errs.push('enemy: references unknown skill "' + sk + '" (closed vocab: live skills)');
  } else {
    errs.push('unknown kind "' + kind + '"');
  }
  if (errs.length) throw usage('candidate validation failed:\n  - ' + errs.join('\n  - '));
}

// ---------- per-run + per-arm metrics (reuse sim/s4/metrics processRun) ----------
function poInstancesOf(board) { const o = {}; for (const p of board.pos) { if (p.loc !== 'grid') continue; o[p.id] = (o[p.id] || 0) + 4; } return o; }

function runOne(opts) {
  const out = combat.runDungeon({
    masterSeed: opts.masterSeed, dungeonDef: opts.dungeonDef,
    squadSnapshots: [opts.board, opts.board, opts.board, opts.board],
    itemDefsById: opts.itemDefsById, enemyDefsById: opts.enemyDefsById,
    monsterPackDefsById: opts.monsterPackDefsById, skillDefsById: opts.skillDefsById,
    siDefsById: opts.siDefsById, formationId: FORMATION, level: opts.level, participants: ['a', 'b'],
  });
  return processRun(out, {
    boardId: opts.boardId, dungeonKey: opts.dungeonKey, formationId: FORMATION, level: opts.level,
    seed: opts.masterSeed, variant: 'base', playerBpIds: opts.board.bps.map(b => b.id), poInstances: opts.poInstances,
  });
}

function armMetrics(records, candidateId) {
  const N = records.length || 1;
  const wins = records.filter(r => r.result === 'victory').length;
  const wipes = records.filter(r => r.wipe === true || r.result === 'wipe').length;
  const ttk = records.map(r => r.durationSecs);
  const dealt = records.map(r => sumVals(r.dmgBySrc) + sumVals(r.dotBySrc));
  const taken = records.map(r => r.dmgTakenTotal);
  const candDps = []; let candDmg = 0, allDmg = 0, rays = 0;
  for (const r of records) {
    const cd = (r.dmgBySrc[candidateId] || 0) + (r.dotBySrc[candidateId] || 0);
    const inst = (r.meta.poInstances || {})[candidateId] || 1;
    candDps.push(cd / Math.max(r.battleSecs, 1e-9) / inst);
    candDmg += cd; allDmg += sumVals(r.dmgBySrc) + sumVals(r.dotBySrc);
    rays += r.raysBySrc[candidateId] ? r.raysBySrc[candidateId].fired : 0;
  }
  return {
    runs: N, winRate: round(wins / N), wipeRate: round(wipes / N),
    ttk: { mean: round(mean(ttk)), p50: round(p50(ttk)), p95: round(p95(ttk)) },
    dmgDealtMean: round(mean(dealt)), dmgTakenMean: round(mean(taken)),
    candidate: { dpsMean: round(mean(candDps)), dpsP95: round(p95(candDps)), dmgShare: round(allDmg > 0 ? candDmg / allDmg : 0), raysFired: rays },
  };
}

function ratio(a, b) { return b !== 0 ? round(a / b) : (a === 0 ? 1 : null); }
function computeDeltas(c, b) {
  return {
    winRate: round(c.winRate - b.winRate), wipeRate: round(c.wipeRate - b.wipeRate),
    dmgDealtMean: round(c.dmgDealtMean - b.dmgDealtMean), dmgTakenMean: round(c.dmgTakenMean - b.dmgTakenMean),
    ttkMean: round(c.ttk.mean - b.ttk.mean), ttkRatio: ratio(c.ttk.mean, b.ttk.mean), dmgDealtRatio: ratio(c.dmgDealtMean, b.dmgDealtMean),
  };
}

// ---------- flagging against bands ----------
function bandDelta(flags, band, absval, code, base) {
  if (!band) return;
  if (band.flag != null && absval > band.flag) flags.push({ level: 'flag', code, message: base + ' > flag band ' + band.flag });
  else if (band.warn != null && absval > band.warn) flags.push({ level: 'warn', code, message: base + ' > warn band ' + band.warn });
}
function bandRatio(flags, band, r, code, base) {
  if (!band || r == null) return;
  const dev = Math.abs(r - 1);
  if (band.flag != null && dev > band.flag) flags.push({ level: 'flag', code, message: base + ' (dev ' + round(dev) + ') > flag band ' + band.flag });
  else if (band.warn != null && dev > band.warn) flags.push({ level: 'warn', code, message: base + ' (dev ' + round(dev) + ') > warn band ' + band.warn });
}
function evaluateFlags(cand, c, b, d, bands) {
  const flags = [];
  if (cand.kind === 'item') {
    const ic = bands.item_dps_ceiling || {};
    const ceiling = ic[cand.def.rarity];
    if (typeof ceiling === 'number') {
      const fm = ic.flag_multiple || 3;
      const dps = c.candidate.dpsMean;
      if (dps > ceiling * fm) flags.push({ level: 'flag', code: 'item_dps_ceiling', message: 'candidate ' + cand.def.id + ' effective DPS ' + dps + ' > ' + cand.def.rarity + ' ceiling ' + ceiling + ' x' + fm + ' (' + round(ceiling * fm) + ')' });
      else if (dps > ceiling) flags.push({ level: 'warn', code: 'item_dps_ceiling', message: 'candidate ' + cand.def.id + ' effective DPS ' + dps + ' > ' + cand.def.rarity + ' ceiling ' + ceiling });
    }
  }
  bandDelta(flags, bands.delta_win_rate, Math.abs(d.winRate), 'delta_win_rate', 'win-rate delta ' + d.winRate);
  bandDelta(flags, bands.delta_wipe_rate, Math.abs(d.wipeRate), 'delta_wipe_rate', 'wipe-rate delta ' + d.wipeRate);
  bandRatio(flags, bands.delta_ttk_ratio, d.ttkRatio, 'delta_ttk_ratio', 'TTK ratio ' + d.ttkRatio);
  bandRatio(flags, bands.delta_dmg_dealt_ratio, d.dmgDealtRatio, 'delta_dmg_dealt_ratio', 'player-dmg-dealt ratio ' + d.dmgDealtRatio);
  return flags;
}

// ---------- the matrix runner (programmatic entry; CLI is a thin wrapper) ----------
function runMatrix(opts) {
  const defs = opts._defs || loadDefs();
  const bandsInfo = opts._bands || loadBands();
  const cand = opts.candidate;
  validateCandidate(cand.kind, cand.def, defs);

  const seedBase = opts.seedBase || 'req0269';
  const seeds = opts.seeds || 6;
  const levels = (opts.levels && opts.levels.length) ? opts.levels.slice() : [3];
  const boardIds = (opts.boards && opts.boards.length ? opts.boards : DEFAULT_BOARDS.slice(0, 3)).slice();
  const builderName = opts.builder || 'greedy';

  const candRecords = [], baseRecords = [], notes = [];
  const usedBoards = [];

  if (cand.kind === 'item') {
    const builder = builders.BUILDERS[builderName];
    if (!builder) throw usage('unknown builder "' + builderName + '" (greedy|random)');
    const itemDefsById = Object.assign({}, defs.itemDefsById, { [cand.def.id]: cand.def });
    for (const entry of boardIds) {
      const boardId = typeof entry === 'string' ? entry : entry.id;
      const template = typeof entry === 'string' ? loadBoard(entry) : entry.board;
      const brng = combat.makeRng(seedBase + '|build|' + boardId + '|' + builderName).stream('place');
      const built = builder.build({ board: template, candidateDef: cand.def, itemDefsById, uid: '__cand_po' }, brng);
      if (!built) { notes.push('board ' + boardId + ': no legal placement for candidate shape -- skipped'); continue; }
      const candBoard = built.board;
      notes.push('board ' + boardId + ': ' + built.note);
      usedBoards.push(boardId);
      const candInst = poInstancesOf(candBoard), baseInst = poInstancesOf(template);
      for (const level of levels) for (let i = 0; i < seeds; i++) {
        const ms = seedBase + '|' + boardId + '|L' + level + '|s' + i;
        candRecords.push(runOne({ masterSeed: ms, dungeonDef: defs.dungeonDef, board: candBoard, itemDefsById, enemyDefsById: defs.enemyDefsById, monsterPackDefsById: defs.monsterPackDefsById, skillDefsById: defs.skillDefsById, siDefsById: defs.siDefsById, level, boardId, dungeonKey: 'live', poInstances: candInst }));
        baseRecords.push(runOne({ masterSeed: ms, dungeonDef: defs.dungeonDef, board: template, itemDefsById: defs.itemDefsById, enemyDefsById: defs.enemyDefsById, monsterPackDefsById: defs.monsterPackDefsById, skillDefsById: defs.skillDefsById, siDefsById: defs.siDefsById, level, boardId, dungeonKey: 'live', poInstances: baseInst }));
      }
    }
    if (!usedBoards.length) throw usage('no board template admitted a legal placement for candidate "' + cand.def.id + '" (shape too large for any template free cells)');
    notes.push('item arm: builder=' + builderName + ', live dungeon "' + defs.dungeonDef.id + '"; candidate placed vs absent');
  } else {
    const packId = opts.pack || DEFAULT_PACK;
    const slot = opts.slot || 0;
    const arenaN = opts.arenaEncounters || DEFAULT_ARENA_ENCOUNTERS;
    const injected = inject.injectIntoPack({ kind: cand.kind, candidateDef: cand.def, enemyDefsById: defs.enemyDefsById, skillDefsById: defs.skillDefsById, monsterPackDefsById: defs.monsterPackDefsById, packId, slot });
    const arena = inject.arenaDungeon(packId, arenaN);
    for (const entry of boardIds) {
      const boardId = typeof entry === 'string' ? entry : entry.id;
      const board = typeof entry === 'string' ? loadBoard(entry) : entry.board; usedBoards.push(boardId);
      const inst = poInstancesOf(board);
      for (const level of levels) for (let i = 0; i < seeds; i++) {
        const ms = seedBase + '|' + boardId + '|L' + level + '|s' + i;
        candRecords.push(runOne({ masterSeed: ms, dungeonDef: arena, board, itemDefsById: defs.itemDefsById, enemyDefsById: injected.enemyDefsById, monsterPackDefsById: injected.monsterPackDefsById, skillDefsById: injected.skillDefsById, siDefsById: defs.siDefsById, level, boardId, dungeonKey: 'arena', poInstances: inst }));
        baseRecords.push(runOne({ masterSeed: ms, dungeonDef: arena, board, itemDefsById: defs.itemDefsById, enemyDefsById: defs.enemyDefsById, monsterPackDefsById: defs.monsterPackDefsById, skillDefsById: defs.skillDefsById, siDefsById: defs.siDefsById, level, boardId, dungeonKey: 'arena', poInstances: inst }));
      }
    }
    notes.push('enemy/skill arm: pack "' + packId + '" slot ' + slot + ' (' + JSON.stringify(injected.injectedMember) + '), arena of ' + arenaN + ' boss-less pack encounters; player boards unchanged');
  }

  const candidateId = cand.def.id;
  const armCand = armMetrics(candRecords, candidateId);
  const armBase = armMetrics(baseRecords, candidateId);
  const deltas = computeDeltas(armCand, armBase);
  const flags = evaluateFlags(cand, armCand, armBase, deltas, bandsInfo.bands);

  const payload = {
    kind: cand.kind, candidateId,
    rarity: cand.kind === 'item' ? (cand.def.rarity || null) : null,
    builder: cand.kind === 'item' ? builderName : null,
    injection: cand.kind !== 'item' ? { pack: opts.pack || DEFAULT_PACK, slot: opts.slot || 0 } : null,
    matrix: { boards: usedBoards, levels: levels.slice(), seeds, cells: usedBoards.length * levels.length * seeds, runsPerArm: candRecords.length },
    arms: { candidate: armCand, baseline: armBase },
    deltas, flags, bandsSource: bandsInfo.source,
  };
  return { payload, notes, source: cand.source, defs, bands: bandsInfo.bands, records: { candidate: candRecords, baseline: baseRecords } };
}

// ---------- report ----------
function fmtReport(res) {
  const p = res.payload; const c = p.arms.candidate, b = p.arms.baseline, d = p.deltas;
  const L = [];
  L.push('BALANCE SIM -- candidate "' + p.candidateId + '" [' + p.kind + (p.rarity ? '/' + p.rarity : '') + ']');
  L.push('matrix: ' + p.matrix.boards.join(',') + ' x levels ' + JSON.stringify(p.matrix.levels) + ' x ' + p.matrix.seeds + ' seeds = ' + p.matrix.cells + ' cells (' + p.matrix.runsPerArm + ' runs/arm)');
  if (p.builder) L.push('builder: ' + p.builder);
  if (p.injection) L.push('injection: pack ' + p.injection.pack + ' slot ' + p.injection.slot);
  L.push('bands: ' + p.bandsSource);
  L.push('');
  L.push('  ' + 'metric'.padEnd(20) + 'candidate'.padStart(12) + 'baseline'.padStart(12) + '   delta');
  const row = (label, cv, bv, dv) => L.push('  ' + label.padEnd(20) + String(cv).padStart(12) + String(bv).padStart(12) + '   D ' + dv);
  row('win rate', c.winRate, b.winRate, d.winRate);
  row('wipe rate', c.wipeRate, b.wipeRate, d.wipeRate);
  row('TTK mean (s)', c.ttk.mean, b.ttk.mean, d.ttkMean + ' (x' + d.ttkRatio + ')');
  row('TTK p50 (s)', c.ttk.p50, b.ttk.p50, '-');
  row('TTK p95 (s)', c.ttk.p95, b.ttk.p95, '-');
  row('dmg dealt mean', c.dmgDealtMean, b.dmgDealtMean, d.dmgDealtMean + ' (x' + d.dmgDealtRatio + ')');
  row('dmg taken mean', c.dmgTakenMean, b.dmgTakenMean, d.dmgTakenMean);
  if (p.kind === 'item') {
    row('cand DPS mean', c.candidate.dpsMean, b.candidate.dpsMean, '-');
    row('cand dmg share', c.candidate.dmgShare, b.candidate.dmgShare, '-');
    row('cand rays fired', c.candidate.raysFired, b.candidate.raysFired, '-');
  }
  L.push('');
  L.push('flags:');
  if (!p.flags.length) L.push('  (none) -- clean');
  for (const f of p.flags) L.push('  [' + f.level.toUpperCase() + '] ' + f.code + ': ' + f.message);
  const flagged = p.flags.some(f => f.level === 'flag');
  L.push('');
  L.push('VERDICT: ' + (flagged ? 'FLAGGED (' + p.flags.filter(f => f.level === 'flag').length + ' flag, ' + p.flags.filter(f => f.level === 'warn').length + ' warn)' : (p.flags.length ? 'CLEAN (' + p.flags.length + ' warn)' : 'CLEAN')));
  return L.join('\n') + '\n';
}

// ---------- CLI ----------
function parseArgs(a) {
  const o = { levels: null, boards: null };
  for (let i = 0; i < a.length; i++) {
    const f = a[i];
    if (f === '--candidate') o.candidate = a[++i];
    else if (f === '--kind') o.kind = a[++i];
    else if (f === '--seeds') o.seeds = parseInt(a[++i], 10);
    else if (f === '--levels') o.levels = a[++i].split(',').map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x));
    else if (f === '--boards') { const v = a[++i]; if (/^\d+$/.test(v)) o.boards = DEFAULT_BOARDS.slice(0, parseInt(v, 10)); else o.boards = v.split(',').map(x => x.trim()).filter(Boolean); }
    else if (f === '--builder') o.builder = a[++i];
    else if (f === '--pack') o.pack = a[++i];
    else if (f === '--slot') o.slot = parseInt(a[++i], 10);
    else if (f === '--out') o.out = a[++i];
    else if (f === '--json') o.json = true;
    else throw usage('unknown flag ' + f);
  }
  return o;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== 'run') die('usage: node tools/balance_sim.cjs run --candidate <id|path> [--kind item|enemy|skill] [--seeds N] [--levels a,b] [--boards n|id,id] [--builder greedy|random] [--pack id] [--slot i] [--out DIR] [--json]', 2);
  let o; try { o = parseArgs(args.slice(1)); } catch (e) { if (e.__usage) die(e.message, 2); throw e; }
  if (!o.candidate) die('missing --candidate <id|path>', 2);
  if (o.seeds !== undefined && (!Number.isInteger(o.seeds) || o.seeds < 1)) die('--seeds must be a positive integer', 2);

  let res;
  try {
    const defs = loadDefs();
    const cand = resolveCandidate(o.candidate, o.kind, defs);
    res = runMatrix({ candidate: cand, _defs: defs, seeds: o.seeds, levels: o.levels, boards: o.boards, builder: o.builder, pack: o.pack, slot: o.slot });
  } catch (e) { if (e && e.__usage) die(e.message, 2); throw e; }

  const report = fmtReport(res);
  const configForHash = { kind: res.payload.kind, candidateId: res.payload.candidateId, boards: res.payload.matrix.boards, levels: res.payload.matrix.levels, seeds: res.payload.matrix.seeds, builder: res.payload.builder, injection: res.payload.injection };
  const seedHash = sha(canonical(configForHash)).slice(0, 12);
  const outDir = o.out || path.join(REPO, 'data', 'balance_sim', 'run-' + seedHash);
  const meta = { req: 'REQ-0269', generatedAt: new Date().toISOString(), node: process.version, candidateSource: res.source, seedBase: 'req0269', seedHash, notes: res.notes };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), canonical(res.payload) + '\n');
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.txt'), report);

  if (o.json) process.stdout.write(canonical(res.payload) + '\n');
  else process.stdout.write(report);
  console.error('[balance_sim] wrote ' + outDir + '/{summary.json,meta.json,report.txt}');
  process.exit(res.payload.flags.some(f => f.level === 'flag') ? 1 : 0);
}

if (require.main === module) main();
module.exports = { runMatrix, loadDefs, loadBands, loadBoard, resolveCandidate, validateCandidate, canonical, armMetrics, computeDeltas, evaluateFlags, fmtReport };
