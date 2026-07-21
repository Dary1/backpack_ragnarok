#!/usr/bin/env node
'use strict';
// tools/candidate_gate.cjs -- REQ-0272: the ONE door every generated content
// candidate passes before a human ever looks at it. Three stages, one verdict:
//
//   Stage 1 VALIDATE  schema + closed-vocab + dialect (rarity casing, range
//                     fields, name field). REUSES shared/content_validate.cjs
//                     (validateEffect/validateSocket/isValidRange) and the
//                     dialect table in server/services/content_checks.cjs
//                     (_dialectFor) -- it does not fork either.
//   Stage 2 STATIC    the corpus dps-band lint, by SPAWNING
//                     tools/check_stat_bands.cjs --gate on the candidate.
//   Stage 3 DYNAMIC   the REQ-0269 balance sim (tools/balance_sim.cjs
//                     runMatrix) on a small default matrix, unless --skip-sim.
//
// Usage:
//   node tools/candidate_gate.cjs <candidate.json>
//        [--kind auto|item|skill|enemy] [--seeds N] [--skip-sim]
//
// Exit: 0 = pass (warnings allowed), 1 = any FLAG or validation failure,
//       2 = usage error. A JSON report (deterministic core + a non-core meta
//       block) is written next to the candidate as <name>.gate.json.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const B = require(path.join(REPO, 'tools', 'balance_sim.cjs'));
const CV = require(path.join(REPO, 'shared', 'content_validate.cjs'));
const CHECKS = require(path.join(REPO, 'server', 'services', 'content_checks.cjs'));
const CSB = require(path.join(REPO, 'tools', 'check_stat_bands.cjs'));

const STATS_PATH = path.join(REPO, 'content', 'corpus_stats.json');
const CHECK_BANDS = path.join(REPO, 'tools', 'check_stat_bands.cjs');
const VOCAB_PATH = path.join(REPO, 'content', 'vocab.json');
const ENEMY_BANDS_PATH = path.join(REPO, 'content', 'enemy_bands.json');

// kind -> the schema_ref its live file declares, so content_checks._dialectFor
// hands back the SAME dialect row the machine-check and the live gates use.
const SCHEMA_REF = { item: 'po/2', skill: 'skill/1', enemy: 'enemy/1' };

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function usage(msg) { const e = new Error(msg); e.__usage = true; return e; }

// ---------------- Stage 1: VALIDATE (schema + vocab + dialect) --------------
// rarity legal in this dialect? Mirrors content_checks.rarityAllowed: enemy/1
// spells rarity lowercase, po/2 spells it verbatim (Capitalized vocab token).
function rarityAllowed(rarity, vocab, dialect) {
  if (!Array.isArray(vocab.rarities)) return true;
  if (dialect.rarity_case === 'lower') {
    return typeof rarity === 'string' && vocab.rarities.some((r) => r.toLowerCase() === rarity);
  }
  return vocab.rarities.includes(rarity);
}
function isIntRange(x) {
  return Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] <= x[1];
}

function validateStage(kind, def, defs, vocab) {
  const reasons = [];
  const dialect = CHECKS._dialectFor(SCHEMA_REF[kind]);
  const push = (m) => reasons.push(m);

  if (typeof def.id !== 'string' || !def.id) push('id (non-empty string) is required');
  const nameField = dialect.name_field || 'name';
  if (typeof def[nameField] !== 'string' || !def[nameField]) {
    push(nameField + ' (non-empty string) is required (' + dialect.name + ' dialect)');
  }

  const hasRarity = kind === 'item' || kind === 'enemy';
  if (hasRarity) {
    if (def.rarity === undefined) push('rarity is required');
    else if (!rarityAllowed(def.rarity, vocab, dialect)) {
      push('rarity "' + def.rarity + '" not legal for the ' + dialect.name + ' dialect (expects the '
        + (dialect.rarity_case === 'lower' ? 'lowercase' : 'verbatim Capitalized') + ' vocab token)');
    }
  } else if (def.rarity !== undefined && !rarityAllowed(def.rarity, vocab, dialect)) {
    push('rarity "' + def.rarity + '" not in vocab.rarities');
  }

  if (kind === 'item') {
    if (!Array.isArray(def.tags) || def.tags.length === 0) push('tags must be a non-empty array of po_tags');
    else for (const t of def.tags) if (!(t in (vocab.po_tags || {}))) push('tag "' + t + '" not in vocab.po_tags');
    if (!Array.isArray(def.shape) || def.shape.length === 0) push('shape must be a non-empty array of [row,col] cells');
    else for (const c of def.shape) if (!Array.isArray(c) || c.length !== 2) { push('bad shape cell ' + JSON.stringify(c)); break; }
    if (!Array.isArray(def.effects)) push('effects must be an array');
    else def.effects.forEach((eff, i) => { try { CV.validateEffect(eff, vocab, 'effects[' + i + ']'); } catch (e) { push(e.message); } });
    if (def.sockets !== undefined) {
      if (!Array.isArray(def.sockets)) push('sockets must be an array');
      else def.sockets.forEach((s, i) => { try { CV.validateSocket(s, vocab, 'sockets[' + i + ']'); } catch (e) { push(e.message); } });
    }
  } else if (kind === 'skill') {
    try { CV.validateEffect({ trigger: def.trigger, verb: def.verb }, vocab, 'skill'); } catch (e) { push(e.message); }
    if (!def.attack_profile || typeof def.attack_profile !== 'object') push('attack_profile (object) is required');
    if (def.name_ja !== undefined && typeof def.name_ja !== 'string') push('name_ja must be a string');
  } else if (kind === 'enemy') {
    // enemy/1 range field: hp is an INTEGER roll range (dialect.range_fields).
    for (const rf of (dialect.range_fields || [])) {
      if (!isIntRange(def[rf])) push(rf + ' must be a [lo,hi] integer range with lo<=hi (' + dialect.name + ' range field)');
    }
    if (def.footprint !== undefined) {
      const f = def.footprint;
      if (!Array.isArray(f) || f.length !== 2 || !Number.isInteger(f[0]) || !Number.isInteger(f[1]) || f[0] < 1 || f[1] < 1) {
        push('footprint must be [fh,fw] positive integers');
      }
    }
    if (!Array.isArray(def.skills)) push('skills must be an array of skill ids');
    else for (const sk of def.skills) if (!defs.skillDefsById[sk]) push('references unknown skill "' + sk + '" (no live skill/1 def)');
  } else {
    push('unknown kind "' + kind + '"');
  }

  return { status: reasons.length ? 'FLAG' : 'PASS', reasons };
}

// ---------------- Stage 2: STATIC (dps/hp bands; scope-aware) ---------------
// item  -> corpus dps warn bands (content/corpus_stats.json, bands_scope=item),
//          via the same spawned check_stat_bands.cjs --gate as before.
// skill -> per-skill dps-proxy vs the pooled skill_dps band (live_self).
// enemy -> hp midpoint vs its rarity enemy_hp band AND total dps (its skills'
//          dps proxies) vs its rarity enemy_total_dps band (live_self).
// Missing content/enemy_bands.json -> na fallback (advisory PASS), unchanged.
function loadEnemyBands() {
  try { return JSON.parse(fs.readFileSync(ENEMY_BANDS_PATH, 'utf8')); }
  catch (_e) { return null; }
}
function round3(x) { return Math.round(x * 1000) / 1000; }

// A value vs a {warn_lo, warn_hi, flag_multiple} band: FLAG outside the
// flag bounds (warn_lo/fm .. warn_hi*fm), WARN outside the warn bounds, else OK.
function evalBand(value, band) {
  const fm = (typeof band.flag_multiple === 'number' && band.flag_multiple > 0)
    ? band.flag_multiple : 2;
  const wl = Number(band.warn_lo);
  const wh = Number(band.warn_hi);
  const fl = wl / fm;
  const fh = wh * fm;
  let status = 'OK';
  if (value > fh || value < fl) status = 'FLAG';
  else if (value > wh || value < wl) status = 'WARN';
  return { status, warn_lo: round3(wl), warn_hi: round3(wh),
    flag_lo: round3(fl), flag_hi: round3(fh) };
}

// live skill defs, with any embedded skill_defs supplied on the candidate
// merged over the live table (array of skill/1 objects, or an id->def object).
function resolveSkillDefs(def, defs) {
  const byId = Object.assign({}, (defs && defs.skillDefsById) || {});
  const emb = def.skill_defs;
  if (Array.isArray(emb)) { for (const sd of emb) if (sd && sd.id) byId[sd.id] = sd; }
  else if (emb && typeof emb === 'object') { for (const k of Object.keys(emb)) byId[k] = emb[k]; }
  return byId;
}

function staticItem(def) {
  const tmp = path.join(os.tmpdir(), 'cand_gate_' + process.pid + '_' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ schema: 'po/2', entries: [def] }));
  let r;
  try {
    r = spawnSync(process.execPath, [CHECK_BANDS, '--gate', '--stats', STATS_PATH, '--defs', tmp], { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_e) { /* best-effort */ }
  }
  if (r.error) return { status: 'WARN', reasons: ['static lint failed to run: ' + r.error.message], evaluated: 0 };
  const out = (r.stdout || '') + '';
  const reasons = [];
  let evaluated = 0, dps = null, warn_hi = null;
  const mSum = /summary:\s+(\d+)\s+damage defs evaluated/.exec(out);
  if (mSum) evaluated = parseInt(mSum[1], 10);
  const re = /^\s*(OVER|OK|na)\s+(\S+)\s+\((\S+)\)\s+dps=([\d.]+)\s+warn_hi=(\S+)/gm;
  let m;
  while ((m = re.exec(out)) !== null) {
    dps = parseFloat(m[4]); warn_hi = m[5] === '-' ? null : parseFloat(m[5]);
    if (m[1] === 'OVER') reasons.push('dps-proxy ' + dps + ' > ' + m[3] + ' item-scope warn_hi ' + warn_hi + ' (item-scope bands, content/corpus_stats.json)');
  }
  if (r.status === 1) return { status: 'FLAG', reasons, evaluated, dps, warn_hi };
  if (r.status === 0) {
    if (evaluated === 0) return { status: 'PASS', reasons: ['no rarity-banded damage-tick effect -> not gated (advisory)'], evaluated, dps, warn_hi };
    if (warn_hi === null) return { status: 'PASS', reasons: ['dps-proxy ' + dps + ' computed; no item-scope rarity band for this def -> not gated (advisory)'], evaluated, dps, warn_hi };
    return { status: 'PASS', reasons: ['dps-proxy ' + dps + ' <= item-scope warn_hi ' + warn_hi + ' (item-scope bands, content/corpus_stats.json)'], evaluated, dps, warn_hi };
  }
  return { status: 'WARN', reasons: ['static lint exited ' + r.status + ': ' + (r.stderr || '').trim()], evaluated, dps, warn_hi };
}

function staticSkill(def, eb) {
  const { dps, counted } = CSB.defDps(def);
  const dps3 = round3(dps);
  if (!eb) return { status: 'PASS', reasons: ['live_self skill bands unavailable (content/enemy_bands.json missing) -> not gated (advisory)'], evaluated: 0, dps: dps3, warn_hi: null };
  if (counted === 0) return { status: 'PASS', reasons: ['no damage-tick effect -> not gated (advisory)'], evaluated: 0, dps: dps3, warn_hi: null };
  const grp = eb.skill_dps;
  const band = grp && grp.band;
  if (!band) return { status: 'PASS', reasons: ['no live_self skill_dps band available -> not gated (advisory)'], evaluated: 1, dps: dps3, warn_hi: null };
  const e = evalBand(dps, band);
  const prov = grp.provisional ? ' [provisional n=' + grp.n + ']' : ' [n=' + grp.n + ']';
  const scope = 'live_self skill-dps bands';
  if (e.status === 'FLAG') return { status: 'FLAG', reasons: ['skill dps-proxy ' + dps3 + ' outside flag bounds [' + e.flag_lo + ', ' + e.flag_hi + '] of ' + scope + ' (warn_hi ' + e.warn_hi + ')' + prov], evaluated: 1, dps: dps3, warn_hi: e.warn_hi };
  if (e.status === 'WARN') return { status: 'WARN', reasons: ['skill dps-proxy ' + dps3 + ' outside warn bounds [' + e.warn_lo + ', ' + e.warn_hi + '] of ' + scope + prov], evaluated: 1, dps: dps3, warn_hi: e.warn_hi };
  return { status: 'PASS', reasons: ['skill dps-proxy ' + dps3 + ' within ' + scope + ' warn [' + e.warn_lo + ', ' + e.warn_hi + ']' + prov], evaluated: 1, dps: dps3, warn_hi: e.warn_hi };
}

function staticEnemy(def, defs, eb) {
  if (!eb) return { status: 'PASS', reasons: ['live_self enemy bands unavailable (content/enemy_bands.json missing) -> not gated (advisory)'], evaluated: 0, hp_mid: null, dps: null, warn_hi: null };
  const rarity = typeof def.rarity === 'string' ? def.rarity.toLowerCase() : null;
  const reasons = [];
  const sub = [];
  const skillById = resolveSkillDefs(def, defs);

  // (a) hp midpoint vs enemy_hp[rarity]
  const hpMid = CSB.mid(def.hp);
  const hp_mid3 = hpMid === null ? null : round3(hpMid);
  const hpGrp = rarity ? (eb.enemy_hp || {})[rarity] : null;
  const hpBand = hpGrp && hpGrp.band;
  if (hpMid === null) reasons.push('enemy hp has no computable midpoint -> hp not gated (advisory)');
  else if (!hpBand) reasons.push('no live_self enemy_hp band for rarity "' + rarity + '" -> hp not gated (advisory)');
  else {
    const e = evalBand(hpMid, hpBand);
    const prov = hpGrp.provisional ? ' [provisional n=' + hpGrp.n + ']' : ' [n=' + hpGrp.n + ']';
    if (e.status === 'FLAG') { sub.push('FLAG'); reasons.push('enemy hp midpoint ' + hp_mid3 + ' outside flag bounds [' + e.flag_lo + ', ' + e.flag_hi + '] of live_self enemy-hp band for ' + rarity + ' (warn [' + e.warn_lo + ', ' + e.warn_hi + '])' + prov); }
    else if (e.status === 'WARN') { sub.push('WARN'); reasons.push('enemy hp midpoint ' + hp_mid3 + ' outside warn bounds [' + e.warn_lo + ', ' + e.warn_hi + '] of live_self enemy-hp band for ' + rarity + prov); }
    else reasons.push('enemy hp midpoint ' + hp_mid3 + ' within live_self enemy-hp band for ' + rarity + ' warn [' + e.warn_lo + ', ' + e.warn_hi + ']' + prov);
  }

  // (b) total dps (sum of resolved skills' dps proxies) vs enemy_total_dps[rarity]
  let total = 0;
  const unresolved = [];
  for (const sid of (Array.isArray(def.skills) ? def.skills : [])) {
    const sd = skillById[sid];
    if (!sd) { unresolved.push(sid); continue; }
    total += CSB.defDps(sd).dps;
  }
  const total3 = round3(total);
  if (unresolved.length) reasons.push('unresolved skills (no live/embedded def): ' + unresolved.join(', ') + ' -> excluded from total dps');
  const dpsGrp = rarity ? (eb.enemy_total_dps || {})[rarity] : null;
  const dpsBand = dpsGrp && dpsGrp.band;
  if (!dpsBand) reasons.push('no live_self enemy_total_dps band for rarity "' + rarity + '" -> total dps not gated (advisory)');
  else {
    const e = evalBand(total, dpsBand);
    const prov = dpsGrp.provisional ? ' [provisional n=' + dpsGrp.n + ']' : ' [n=' + dpsGrp.n + ']';
    if (e.status === 'FLAG') { sub.push('FLAG'); reasons.push('enemy total dps-proxy ' + total3 + ' outside flag bounds [' + e.flag_lo + ', ' + e.flag_hi + '] of live_self enemy total-dps band for ' + rarity + ' (warn [' + e.warn_lo + ', ' + e.warn_hi + '])' + prov); }
    else if (e.status === 'WARN') { sub.push('WARN'); reasons.push('enemy total dps-proxy ' + total3 + ' outside warn bounds [' + e.warn_lo + ', ' + e.warn_hi + '] of live_self enemy total-dps band for ' + rarity + prov); }
    else reasons.push('enemy total dps-proxy ' + total3 + ' within live_self enemy total-dps band for ' + rarity + ' warn [' + e.warn_lo + ', ' + e.warn_hi + ']' + prov);
  }

  let status = 'PASS';
  if (sub.indexOf('FLAG') !== -1) status = 'FLAG';
  else if (sub.indexOf('WARN') !== -1) status = 'WARN';
  return { status, reasons, evaluated: 1, hp_mid: hp_mid3, dps: total3, warn_hi: dpsBand ? round3(Number(dpsBand.warn_hi)) : null };
}

function staticStage(kind, def, defs) {
  if (kind === 'skill') return staticSkill(def, loadEnemyBands());
  if (kind === 'enemy') return staticEnemy(def, defs, loadEnemyBands());
  return staticItem(def);
}

// ---------------- Stage 3: DYNAMIC (balance sim runMatrix) ------------------
function dynamicStage(kind, def, source, defs, seeds) {
  let res;
  try {
    res = B.runMatrix({ candidate: { kind, def, source }, _defs: defs, seeds: seeds, levels: [3] });
  } catch (e) {
    if (e && e.__usage) return { status: 'WARN', reasons: ['sim could not evaluate candidate: ' + e.message], payload: null };
    throw e;
  }
  const flags = res.payload.flags || [];
  const flagReasons = flags.filter((f) => f.level === 'flag').map((f) => f.code + ': ' + f.message);
  const warnReasons = flags.filter((f) => f.level === 'warn').map((f) => f.code + ': ' + f.message);
  let status = 'PASS';
  if (flagReasons.length) status = 'FLAG';
  else if (warnReasons.length) status = 'WARN';
  const reasons = status === 'PASS' ? ['no bands tripped -- clean'] : flagReasons.concat(warnReasons);
  return { status, reasons, payload: res.payload };
}

// ---------------- report ----------------------------------------------------
function fmtReport(rep) {
  const L = [];
  const c = rep.candidate;
  L.push('CANDIDATE GATE -- "' + c.id + '" [' + c.kind + (c.rarity ? '/' + c.rarity : '') + ']  (' + c.source + ')');
  L.push('');
  const stage = (label, s) => {
    L.push('  ' + label.padEnd(9) + s.status);
    for (const r of (s.reasons || [])) L.push('      - ' + r);
  };
  stage('VALIDATE', rep.stages.validate);
  stage('STATIC', rep.stages.static);
  stage('DYNAMIC', rep.stages.dynamic);
  L.push('');
  L.push('VERDICT: ' + rep.verdict + (rep.warnings ? ' (' + rep.warnings + ' warning' + (rep.warnings === 1 ? '' : 's') + ')' : ''));
  return L.join('\n') + '\n';
}

function reportPath(candidatePath) {
  const dir = path.dirname(candidatePath);
  const base = path.basename(candidatePath).replace(/\.json$/i, '');
  return path.join(dir, base + '.gate.json');
}

// ---------------- CLI -------------------------------------------------------
function parseArgs(argv) {
  const o = { skipSim: false, kind: 'auto', seeds: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kind') o.kind = argv[++i];
    else if (a === '--seeds') o.seeds = parseInt(argv[++i], 10);
    else if (a === '--skip-sim') o.skipSim = true;
    else if (a.startsWith('--')) throw usage('unknown flag ' + a);
    else rest.push(a);
  }
  if (rest.length !== 1) throw usage('exactly one <candidate.json> path is required');
  o.candidate = rest[0];
  if (o.kind && ['auto', 'item', 'skill', 'enemy'].indexOf(o.kind) === -1) throw usage('--kind must be auto|item|skill|enemy');
  if (o.seeds !== undefined && (!Number.isInteger(o.seeds) || o.seeds < 1)) throw usage('--seeds must be a positive integer');
  return o;
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('[candidate_gate] ' + e.message); process.exit(2); }

  const candPath = path.isAbsolute(o.candidate) ? o.candidate : path.resolve(process.cwd(), o.candidate);
  if (!fs.existsSync(candPath)) { console.error('[candidate_gate] candidate file not found: ' + candPath); process.exit(2); }

  const defs = B.loadDefs();
  const vocab = loadJSON(VOCAB_PATH);
  let cand;
  try { cand = B.resolveCandidate(candPath, o.kind === 'auto' ? undefined : o.kind, defs); }
  catch (e) { console.error('[candidate_gate] ' + (e && e.message ? e.message : e)); process.exit(2); }

  const kind = cand.kind, def = cand.def;
  const rarity = kind === 'item' ? (def.rarity || null) : (kind === 'enemy' ? (def.rarity || null) : null);

  const stages = { validate: null, static: null, dynamic: null };
  stages.validate = validateStage(kind, def, defs, vocab);

  if (stages.validate.status === 'FLAG') {
    stages.static = { status: 'SKIP', reasons: ['skipped: validation failed'], evaluated: 0 };
    stages.dynamic = { status: 'SKIP', reasons: ['skipped: validation failed'], payload: null };
  } else {
    stages.static = staticStage(kind, def, defs);
    if (o.skipSim) stages.dynamic = { status: 'SKIP', reasons: ['skipped: --skip-sim'], payload: null };
    else stages.dynamic = dynamicStage(kind, def, cand.source, defs, o.seeds || 3);
  }

  const statuses = [stages.validate.status, stages.static.status, stages.dynamic.status];
  const flagged = statuses.indexOf('FLAG') !== -1;
  const warnings = statuses.filter((s) => s === 'WARN').length;
  const verdict = flagged ? 'FLAG' : 'PASS';

  const core = {
    schema: 'candidate_gate/1',
    candidate: { id: def.id || '(anon)', kind, rarity, source: path.basename(candPath) },
    stages: {
      validate: stages.validate,
      static: stages.static,
      dynamic: { status: stages.dynamic.status, reasons: stages.dynamic.reasons, payload: stages.dynamic.payload },
    },
    verdict,
    warnings,
    exit: flagged ? 1 : 0,
  };

  const report = Object.assign({}, core, {
    meta: { req: 'REQ-0272', generatedAt: new Date().toISOString(), node: process.version, candidatePath: candPath },
  });

  const rp = reportPath(candPath);
  try { fs.writeFileSync(rp, JSON.stringify(report, null, 2) + '\n'); }
  catch (e) { console.error('[candidate_gate] could not write report ' + rp + ': ' + e.message); }

  process.stdout.write(fmtReport(core));
  console.error('[candidate_gate] wrote ' + rp);
  process.exit(core.exit);
}

if (require.main === module) main();
module.exports = { validateStage, staticStage, dynamicStage, rarityAllowed, isIntRange, reportPath, SCHEMA_REF };
