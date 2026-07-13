'use strict';
// server/services/content_checks.cjs -- REQ-0155. The four machine checks
// that auto-run on EVERY ingested content variant, wiring the project's
// EXISTING validators per kind. Result -> content_variants.machine_check
// JSONB: { checks: [{name, ok, detail, applicable}], overall: PASS|FAIL,
// ran_at }. A variant whose overall is FAIL is adoptable ONLY behind an
// explicit override confirm (enforced at the route) -- the checks are
// advisory-loud, never a hard block (REQ-0155 doctrine).
//
// The four checks (REQ-0155 § Machine checks), and HOW each existing
// validator is wired:
//   1. schema_vocab  -- self_test_vocab.cjs CONVENTIONS. self_test_vocab is a
//      fixed self-test (it builds its OWN fixtures, takes no external data
//      input), so it cannot be handed an arbitrary variant; we apply its
//      documented contract (verbs/triggers/statuses from content/vocab.json;
//      ranged verb params must be [lo,hi] int ranges; tags from the po_tags/
//      socket_tags hierarchy) to the variant's data against schema_ref.
//   2. engine_types  -- check_engine_types.cjs, WIRED as a subprocess
//      precondition (the mock-src/engine.js type surface must not have
//      drifted) PLUS a per-kind field-type conformance check of the def
//      against the runtime types engine.js consumes (its "declared type must
//      match runtime type" doctrine, applied to the content record).
//   3. gen_data      -- tool_gen_data.cjs, WIRED as a subprocess: the variant
//      is written as the sole entry of a temp items/sis file and run through
//      the real generator to a TEMP out (never content/); exit 0 = the
//      data.js generation path accepts it. Non-item kinds (monster/unit/tm,
//      which tool_gen_data does not consume) use the same eff_render/serialize
//      convention in-process.
//   4. integrate     -- tool_integrate.cjs, WIRED as a subprocess in its
//      already-no-write mode (it only ever readFileSync's): the variant is
//      run as a synthetic 1-entry batch against the LIVE vocab/items/sis. We
//      SNAPSHOT content/live (recursive sha256 manifest) before and after and
//      assert it is byte-identical -- the "provably writes nothing / must not
//      touch content/live" guarantee (gate G2).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

function repoRoot() {
  // server/services/ -> repo root
  return path.join(__dirname, '..', '..');
}
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Resolve the vocab file a schema_ref points at. schema_ref is a repo-
// relative path (default 'content/vocab.json'); anything that resolves to a
// readable JSON with a `verbs` array is treated as the vocab tree.
function loadVocab(root, schema_ref) {
  const candidates = [];
  if (schema_ref) candidates.push(path.resolve(root, schema_ref));
  candidates.push(path.join(root, 'content', 'vocab.json'));
  for (const c of candidates) {
    try { const v = loadJson(c); if (v && Array.isArray(v.verbs)) return { vocab: v, path: c }; } catch (_) { /* next */ }
  }
  return { vocab: null, path: null };
}

// ---- 1. schema_vocab (self_test_vocab conventions) ----------------------

function tagInTree(tag, tree) { return tree && Object.prototype.hasOwnProperty.call(tree, tag); }

function checkEffects(effects, vocab, domain, errs) {
  if (effects === undefined) return; // effects optional for some kinds
  if (!Array.isArray(effects)) { errs.push('effects must be an array'); return; }
  const triggers = new Set(vocab.triggers || []);
  const verbs = new Set(vocab.verbs || []);
  const statuses = new Set(vocab.statuses || []);
  const ranged = vocab.ranged_verb_params || {};
  const domains = vocab.trigger_domains || {};
  effects.forEach((eff, i) => {
    const where = 'effects[' + i + ']';
    const tr = eff && eff.trigger;
    const vb = eff && eff.verb;
    if (!tr || typeof tr.t !== 'string') { errs.push(where + '.trigger.t missing'); return; }
    if (!triggers.has(tr.t)) { errs.push(where + '.trigger.t not in vocab.triggers: ' + tr.t); }
    else if (domains[tr.t] && domain && !domains[tr.t].includes(domain)) {
      errs.push(where + '.trigger ' + tr.t + ' not legal in domain ' + domain);
    }
    if (!vb || typeof vb.t !== 'string') { errs.push(where + '.verb.t missing'); return; }
    if (!verbs.has(vb.t)) { errs.push(where + '.verb.t not in vocab.verbs: ' + vb.t); return; }
    // ranged params must be [lo,hi] integer ranges (self_test_vocab contract)
    for (const p of (ranged[vb.t] || [])) {
      const rng = vb[p];
      if (!Array.isArray(rng) || rng.length !== 2 || !Number.isFinite(rng[0]) || !Number.isFinite(rng[1]) || rng[0] > rng[1]) {
        errs.push(where + '.verb.' + p + ' must be a [lo,hi] range with lo<=hi');
      }
    }
    if (vb.status !== undefined && !statuses.has(vb.status)) {
      errs.push(where + '.verb.status not in vocab.statuses: ' + vb.status);
    }
  });
}

function schemaVocabCheck(kind, data, vocab) {
  if (!vocab) return { ok: false, detail: 'vocab/schema_ref not resolvable' };
  const errs = [];
  if (!data || typeof data !== 'object') return { ok: false, detail: 'data must be an object' };
  if (typeof data.id !== 'string' || !data.id) errs.push('id (non-empty string) required');
  if (typeof data.name !== 'string' || !data.name) errs.push('name (string) required');
  if (data.rarity !== undefined && Array.isArray(vocab.rarities) && !vocab.rarities.includes(data.rarity)) {
    errs.push('rarity not in vocab.rarities: ' + data.rarity);
  }
  if (kind === 'po_def') {
    if (!Array.isArray(data.tags) || data.tags.length === 0) errs.push('po_def requires non-empty tags[]');
    else for (const t of data.tags) if (!tagInTree(t, vocab.po_tags)) errs.push('tag not in vocab.po_tags: ' + t);
    if (!Array.isArray(data.shape)) errs.push('po_def requires shape [[r,c]...]');
    for (const s of (data.sockets || [])) {
      if (!s || !tagInTree(s.t, vocab.socket_tags)) errs.push('socket.t not in vocab.socket_tags: ' + (s && s.t));
      for (const tg of (s && s.tags) || []) if (!tagInTree(tg, vocab.socket_tags)) errs.push('socket tag not in vocab.socket_tags: ' + tg);
    }
    checkEffects(data.effects, vocab, 'PO', errs);
  } else if (kind === 'si_def') {
    if (!tagInTree(data.slot, vocab.socket_tags)) errs.push('si_def slot not in vocab.socket_tags: ' + data.slot);
    for (const tg of (data.reqTags || [])) if (!tagInTree(tg, vocab.socket_tags)) errs.push('reqTag not in vocab.socket_tags: ' + tg);
    checkEffects(data.effects, vocab, 'SI', errs);
  } else if (kind === 'monster_def' || kind === 'unit_def') {
    // Roster/dungeon defs: skills/effects when present are validated against
    // the same verb/trigger vocab (EnemySkill/Unit domains).
    checkEffects(data.effects, vocab, kind === 'unit_def' ? 'Unit' : 'EnemySkill', errs);
  } else if (kind === 'tm_def') {
    if (data.short !== undefined && typeof data.short !== 'string') errs.push('tm_def.short must be a string');
  }
  return { ok: errs.length === 0, detail: errs.length === 0 ? 'schema/vocab valid' : errs.join('; ') };
}

// ---- 2. engine_types (check_engine_types conventions) -------------------

let _engineSurfaceCache = null;
function engineSurfaceSound(root) {
  if (_engineSurfaceCache) return _engineSurfaceCache;
  try {
    execFileSync(process.execPath, [path.join('tools', 'check_engine_types.cjs')], { cwd: root, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    _engineSurfaceCache = { ok: true, detail: 'engine type surface OK' };
  } catch (e) {
    const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    _engineSurfaceCache = { ok: false, detail: 'engine type-surface drift: ' + out.trim().slice(0, 300) };
  }
  return _engineSurfaceCache;
}

function isIntPair(x) { return Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]); }

function engineTypesCheck(kind, data, root) {
  const surface = engineSurfaceSound(root);
  if (!surface.ok) return surface;
  const errs = [];
  // Per-kind runtime-type conformance of the record engine.js consumes.
  if (kind === 'po_def') {
    if (!Array.isArray(data.shape) || !data.shape.every(isIntPair)) errs.push('shape must be [[int,int]...] (engine PO shape)');
    if (data.sockets !== undefined) {
      if (!Array.isArray(data.sockets)) errs.push('sockets must be an array');
      else data.sockets.forEach((s, i) => { if (!s || typeof s.t !== 'string') errs.push('sockets[' + i + '].t must be a string'); if (s && s.tags !== undefined && !Array.isArray(s.tags)) errs.push('sockets[' + i + '].tags must be an array'); });
    }
    if (!Array.isArray(data.tags) || !data.tags.every((t) => typeof t === 'string')) errs.push('tags must be string[]');
  } else if (kind === 'si_def') {
    if (typeof data.slot !== 'string') errs.push('slot must be a string (engine socket slot)');
    if (data.reqTags !== undefined && (!Array.isArray(data.reqTags) || !data.reqTags.every((t) => typeof t === 'string'))) errs.push('reqTags must be string[]');
  } else if (kind === 'monster_def' || kind === 'unit_def') {
    if (data.hp !== undefined && !Number.isFinite(data.hp)) errs.push('hp must be numeric');
    if (data.stats !== undefined && (typeof data.stats !== 'object' || data.stats === null)) errs.push('stats must be an object');
  } else if (kind === 'tm_def') {
    if (data.stackable !== undefined && typeof data.stackable !== 'boolean') errs.push('stackable must be boolean');
  }
  return { ok: errs.length === 0, detail: errs.length === 0 ? 'engine-type conformance OK (' + surface.detail + ')' : errs.join('; ') };
}

// ---- 3. gen_data (tool_gen_data conventions) ----------------------------

function genDataCheck(kind, data, root) {
  const vocabPath = path.join(root, 'content', 'vocab.json');
  const scenarioPath = path.join(root, 'content', 'live', 'scenario.json');
  if (kind === 'po_def' || kind === 'si_def') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req0155-gd-'));
    try {
      const itemsPath = path.join(tmp, 'items.json');
      const sisPath = path.join(tmp, 'sis.json');
      const outPath = path.join(tmp, 'data.js');
      fs.writeFileSync(itemsPath, JSON.stringify({ entries: kind === 'po_def' ? [data] : [] }));
      fs.writeFileSync(sisPath, JSON.stringify({ entries: kind === 'si_def' ? [data] : [] }));
      execFileSync(process.execPath, [path.join('tools', 'tool_gen_data.cjs'), vocabPath, itemsPath, sisPath, scenarioPath, outPath],
        { cwd: root, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
      const built = fs.existsSync(outPath) && fs.readFileSync(outPath, 'utf8').includes('GameData');
      return { ok: built, detail: built ? 'generation path (tool_gen_data) accepted the def' : 'tool_gen_data produced no data.js' };
    } catch (e) {
      const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
      return { ok: false, detail: 'tool_gen_data rejected: ' + (out.trim() || e.message).slice(0, 300) };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
  }
  // monster/unit/tm: tool_gen_data does not consume these. Apply the same
  // serialize/eff_render convention in-process: the def must round-trip
  // through JSON and any effects must render without throwing.
  try {
    JSON.parse(JSON.stringify(data));
    if (Array.isArray(data.effects)) {
      const { render } = require(path.join(root, 'tools', 'eff_render.cjs'));
      for (const eff of data.effects) render(eff, 'en');
    }
    return { ok: true, detail: 'generation-path convention OK (serialize + eff_render)' };
  } catch (e) {
    return { ok: false, detail: 'generation-path convention failed: ' + (e.message || String(e)).slice(0, 300) };
  }
}

// ---- 4. integrate (tool_integrate dry-run, no-write) --------------------

function contentLiveManifest(root) {
  const base = path.join(root, 'content', 'live');
  const out = {};
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(fp);
      else out[path.relative(base, fp)] = sha256(fs.readFileSync(fp));
    }
  }
  try { walk(base); } catch (_) { /* no live dir */ }
  return out;
}

function integrateCheck(kind, data, root) {
  if (kind !== 'po_def' && kind !== 'si_def') {
    return { ok: true, applicable: false, detail: 'integrate dry-run not applicable for ' + kind + ' (no canvas placement)' };
  }
  const vocabPath = path.join(root, 'content', 'vocab.json');
  const itemsPath = path.join(root, 'content', 'live', 'live_items.json');
  const sisPath = path.join(root, 'content', 'live', 'live_sis.json');
  const before = contentLiveManifest(root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req0155-int-'));
  let result;
  try {
    const batchPath = path.join(tmp, 'batch.json');
    const batch = kind === 'po_def' ? { items: [data], sis: [] } : { items: [], sis: [data] };
    fs.writeFileSync(batchPath, JSON.stringify(batch));
    let ok = true, detail;
    try {
      const out = execFileSync(process.execPath, [path.join('tools', 'tool_integrate.cjs'), vocabPath, itemsPath, sisPath, batchPath],
        { cwd: root, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const m = /errors:\s*(\d+)/.exec(out);
      const errCount = m ? Number(m[1]) : 0;
      ok = errCount === 0;
      detail = ok ? 'integrate dry-run passed (0 errors)' : ('integrate dry-run reported ' + errCount + ' error(s)');
    } catch (e) {
      const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
      ok = false; detail = 'integrate dry-run failed: ' + (out.trim() || e.message).slice(0, 300);
    }
    result = { ok, detail };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  // PROOF: content/live is byte-identical before and after (must not write).
  const after = contentLiveManifest(root);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged) {
    return { ok: false, applicable: true, content_live_unchanged: false,
      detail: 'INTEGRATE WROTE TO content/live -- dry-run guarantee violated' };
  }
  return Object.assign({}, result, { applicable: true, content_live_unchanged: true });
}

// ---- runner -------------------------------------------------------------

/** Run all four machine checks on one variant's data. Pure of DB access
 * (the caller persists the result via storage.setVariantMachineCheck). */
function runChecks(kind, schema_ref, data) {
  const root = repoRoot();
  const { vocab, path: vpath } = loadVocab(root, schema_ref);
  const checks = [];
  const add = (name, r) => checks.push({ name, ok: r.ok, applicable: r.applicable !== false, detail: r.detail, extra: r.content_live_unchanged !== undefined ? { content_live_unchanged: r.content_live_unchanged } : undefined });
  add('schema_vocab', schemaVocabCheck(kind, data, vocab));
  add('engine_types', engineTypesCheck(kind, data, root));
  add('gen_data', genDataCheck(kind, data, root));
  add('integrate', integrateCheck(kind, data, root));
  const overall = checks.every((c) => c.applicable === false || c.ok) ? 'PASS' : 'FAIL';
  return { checks, overall, schema_ref: vpath ? path.relative(root, vpath) : schema_ref, ran_at: new Date().toISOString() };
}

module.exports = { runChecks, _repoRoot: repoRoot, _contentLiveManifest: contentLiveManifest };
