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
//
// REQ-0161 (ruling Q1 = Option A, user, 2026-07-14): the checks are ADVISORY
// MIRRORS OF REALITY, so they learn the schema dialect of the data the game
// actually serves; live data is never bent to fit a validator. See DIALECTS
// below for the table and the honesty guarantee.
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

// ---- 0. schema dialects (REQ-0161) --------------------------------------
//
// A def's data speaks the dialect of the schema its FILE HEADER declares --
// content_defs.schema_ref, set verbatim by the backfill from the source file
// ('po/2' | 'si/2' | 'tm/1' | 'enemy/1'). Those dialects legitimately differ:
// enemy/1 has always written lowercase rarity words and a [lo,hi] integer ROLL
// RANGE for hp (docs/llm_managed/monster_content_pipeline.md section 2, the doc
// canon), while po/si spell rarity with the capitalized vocab.json tokens and
// keep numeric stats scalar. Checking one dialect's data against another's
// conventions produced the 7 live monster_def FAILs of 2026-07-14c: a validator
// mismatch, not data corruption. Ruling Q1 = Option A: the validators learn the
// dialect, content/ is untouched.
//
//   schema_ref          | rarity tokens                    | integer-range fields
//   --------------------|----------------------------------|---------------------
//   enemy/1             | lowercase form of vocab.rarities  | hp ([lo,hi], lo<=hi)
//                       | ('common', 'rare', ...)           |
//   DEFAULT             | verbatim vocab.rarities token     | none (stats scalar)
//   (po/2, si/2, tm/1)  | ('Common', 'Rare', ...)           |
//
// HONESTY (kit doctrine, unchanged): a dialect is a spelling, never an excuse.
// A word that is no rarity at all still FAILs schema_vocab, and a malformed,
// inverted, non-integer or scalar-where-ranged field still FAILs engine_types --
// each naming its own check. Only the two spellings above are newly accepted.
//
// REQ-0160 adds a THIRD dialect, skill/1 (content/live/dungeon/skills.json):
//   * it spells its display name `name_en` / `name_ja`, not `name` + an i18n
//     block (hence dialect.name_field), and
//   * it declares ONE trigger+verb+attack_profile at the TOP level instead of an
//     effects[] array.
// Per the user ruling Q2-sub (2026-07-14), skill_def is NOT waved through with a
// fake applicable:false everywhere: schema_vocab APPLIES to it, wired by wrapping
// the record as a single pseudo-effect and running the SAME checkEffects() every
// other kind gets (domain EnemySkill). engine_types / gen_data / integrate stay
// honestly applicable:false -- skill/1 has no engine-consumed record, tool_gen_data
// does not consume it, and it has no canvas placement.
const DIALECTS = {
  'enemy/1': { name: 'enemy/1', rarity_case: 'lower', range_fields: ['hp'] },
  'skill/1': { name: 'skill/1', rarity_case: 'exact', range_fields: [], name_field: 'name_en' },
};
const DEFAULT_DIALECT = { name: 'default', rarity_case: 'exact', range_fields: [], name_field: 'name' };

/** The dialect a variant is written in, keyed by its def's schema_ref. */
function dialectFor(schema_ref) {
  return DIALECTS[typeof schema_ref === 'string' ? schema_ref.trim() : ''] || DEFAULT_DIALECT;
}

/** rarity token legal in this dialect? Unknown words FAIL in every dialect. */
function rarityAllowed(rarity, vocab, dialect) {
  if (!Array.isArray(vocab.rarities)) return true; // no rarity vocab -> nothing to check
  if (dialect.rarity_case === 'lower') {
    return typeof rarity === 'string' && vocab.rarities.some((r) => r.toLowerCase() === rarity);
  }
  return vocab.rarities.includes(rarity);
}

/** enemy/1 roll range: [lo, hi], both integers, lo <= hi. */
function isIntRange(x) {
  return Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] <= x[1];
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

function schemaVocabCheck(kind, data, vocab, dialect) {
  if (!vocab) return { ok: false, detail: 'vocab/schema_ref not resolvable' };
  const errs = [];
  if (!data || typeof data !== 'object') return { ok: false, detail: 'data must be an object' };
  if (typeof data.id !== 'string' || !data.id) errs.push('id (non-empty string) required');
  // The field THIS dialect spells the display name with (skill/1: name_en).
  const nameField = dialect.name_field || 'name';
  if (typeof data[nameField] !== 'string' || !data[nameField]) {
    errs.push(nameField + ' (non-empty string) required (' + dialect.name + ' dialect)');
  }
  if (data.rarity !== undefined && !rarityAllowed(data.rarity, vocab, dialect)) {
    errs.push('rarity not in vocab.rarities (' + dialect.name + ' dialect expects the '
      + (dialect.rarity_case === 'lower' ? 'lowercase' : 'verbatim') + ' token): ' + data.rarity);
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
    // REQ-0201: deepen the unit_def dialect. A registry unit VARIANT carries the
    // FULL unit/1 entry (id + icon + i18n + connection_shape + charge), so run the
    // SAME executable validator the check_units live gate runs
    // (shared/content_validate.cjs validateUnitEntry) at INGEST time -- the charge
    // block is machine-checked HERE, not only at the check_units live gate. Guard on
    // data.id: only the full variant carries the whole entry; a partial def record
    // (no id) is left to the base id-required check above, not forced through
    // validateUnitEntry's icon/connection_shape/i18n rules.
    // HONEST COUPLING (merge order 0200 -> 0201): validateUnitEntry only KNOWS the
    // `charge` grammar after REQ-0200 lands it into content_validate.cjs. On THIS
    // branch a charge-bearing variant is (correctly) rejected as an unknown field;
    // the deep charge check reaches full strength only once both branches merge.
    if (kind === 'unit_def' && data && typeof data.id === 'string' && data.id) {
      try {
        const { validateUnitEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
        validateUnitEntry(data, vocab);
      } catch (e) {
        errs.push(e.message);
      }
    }
  } else if (kind === 'tm_def') {
    if (data.short !== undefined && typeof data.short !== 'string') errs.push('tm_def.short must be a string');
  } else if (kind === 'gacha_pack') {
    // REQ-0171. A pack's closed vocabulary is not vocab.json -- it is THE LIVE UNIT
    // ROSTER: every pool row must name a unit that actually has a def, or the roll
    // either crashes or silently skips it. That rule already exists, executable, in
    // shared/content_validate.cjs (validatePackEntry) -- the same function the
    // check_units.cjs gate runs. It is REUSED here, not re-implemented: two copies of
    // "what is a legal pack" would drift, and the drift would be invisible.
    const { validatePackEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
    let unitIds;
    try {
      const units = loadJson(path.join(repoRoot(), 'content', 'live', 'live_units.json'));
      unitIds = new Set((units.entries || []).map((e) => e.id));
    } catch (e) {
      errs.push('cannot read content/live/live_units.json to resolve the pool: ' + e.message);
      unitIds = new Set();
    }
    try {
      validatePackEntry(data, unitIds);
    } catch (e) {
      errs.push(e.message);
    }
    // The cost currency must be a real TM def -- a pack priced in a currency that does
    // not exist is unbuyable, and nothing else in the chain would ever say so.
    if (data.cost_tm !== undefined) {
      try {
        const tms = loadJson(path.join(repoRoot(), 'content', 'live', 'live_tms.json'));
        if (!(tms.entries || []).some((e) => e.id === data.cost_tm)) {
          errs.push('cost_tm "' + data.cost_tm + '" is not a live tm def');
        }
      } catch (e) { /* live_tms unreadable -- not this check's business to fail on */ }
    }
  } else if (kind === 'skill_def') {
    // skill/1 carries its ONE trigger+verb at the top level. Wrap it as a single
    // pseudo-effect so the record gets the IDENTICAL vocab validation every other
    // kind gets (verb/trigger/status must exist in vocab.json, the trigger must be
    // legal in the domain, ranged verb params must be [lo,hi] with lo<=hi) -- this
    // is REUSE of checkEffects, not a new validator (REQ-0160 ruling Q2-sub).
    if (!data.trigger || !data.verb) errs.push('skill_def requires a top-level trigger and verb (skill/1)');
    else checkEffects([{ trigger: data.trigger, verb: data.verb }], vocab, 'EnemySkill', errs);
  }
  return { ok: errs.length === 0, detail: errs.length === 0 ? 'schema/vocab valid (' + dialect.name + ' dialect)' : errs.join('; ') };
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

function engineTypesCheck(kind, data, root, dialect) {
  // REQ-0171: a gacha_pack IS consumed by runtime code (server/services/gacha.cjs
  // rollPackBp reads cells/hp_per_cell/pool/cost), so unlike skill_def it has a real
  // type surface and the check APPLIES. These are the exact field types that function
  // dereferences -- a string where it wants a number is a 500 at roll time.
  if (kind === 'gacha_pack') {
    const errs = [];
    if (!Number.isFinite(data.cost)) errs.push('cost must be a number (gacha.cjs reads it as the LRDST price)');
    if (data.cells !== undefined && !isIntPair(data.cells)) errs.push('cells must be [minInt, maxInt] (rollPolyomino reads both)');
    if (data.hp_per_cell !== undefined && !Number.isFinite(data.hp_per_cell)) errs.push('hp_per_cell must be a number (hpMax = hp_per_cell x cellCount)');
    if (!Array.isArray(data.pool)) errs.push('pool must be an array');
    else for (const row of data.pool) {
      if (!row || typeof row.unit !== 'string') errs.push('every pool row needs unit (string)');
      else if (!Number.isFinite(row.weight)) errs.push('pool row "' + row.unit + '" needs weight (number)');
    }
    return { ok: errs.length === 0, detail: errs.length === 0 ? 'runtime field types conform to what gacha.cjs rollPackBp() consumes' : errs.join('; ') };
  }
  // skill/1 declares no engine-consumed record (no shape, no slot, no stats): there
  // is no runtime type surface for it to conform to. Recorded honestly as
  // not-applicable rather than as a free PASS (REQ-0160 ruling Q2-sub).
  if (kind === 'skill_def') {
    return { ok: true, applicable: false, detail: 'engine_types not applicable for skill_def (skill/1 declares no engine-consumed record: no shape, no slot, no stats)' };
  }
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
    // Dialect-declared roll ranges (enemy/1 hp) must be [lo,hi] int ranges;
    // every other numeric stat stays the scalar engine.js consumes.
    const ranged = new Set(dialect.range_fields);
    for (const f of dialect.range_fields) {
      if (data[f] !== undefined && !isIntRange(data[f])) {
        errs.push(f + ' must be a [lo,hi] integer range with lo<=hi (' + dialect.name + ' roll-range dialect)');
      }
    }
    if (data.hp !== undefined && !ranged.has('hp') && !Number.isFinite(data.hp)) errs.push('hp must be numeric');
    if (data.stats !== undefined && (typeof data.stats !== 'object' || data.stats === null)) errs.push('stats must be an object');
  } else if (kind === 'tm_def') {
    if (data.stackable !== undefined && typeof data.stackable !== 'boolean') errs.push('stackable must be boolean');
  }
  return { ok: errs.length === 0, detail: errs.length === 0 ? 'engine-type conformance OK (' + dialect.name + ' dialect; ' + surface.detail + ')' : errs.join('; ') };
}

// ---- 3. gen_data (tool_gen_data conventions) ----------------------------

function genDataCheck(kind, data, root) {
  // tool_gen_data consumes items/sis only; it has never had a skill input.
  // Honest applicable:false (REQ-0160 ruling Q2-sub).
  if (kind === 'skill_def') {
    return { ok: true, applicable: false, detail: 'gen_data not applicable for skill_def (tool_gen_data does not consume skill/1)' };
  }
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
  const dialect = dialectFor(schema_ref); // REQ-0161: which spelling this def is written in
  const checks = [];
  const add = (name, r) => checks.push({ name, ok: r.ok, applicable: r.applicable !== false, detail: r.detail, extra: r.content_live_unchanged !== undefined ? { content_live_unchanged: r.content_live_unchanged } : undefined });
  add('schema_vocab', schemaVocabCheck(kind, data, vocab, dialect));
  add('engine_types', engineTypesCheck(kind, data, root, dialect));
  add('gen_data', genDataCheck(kind, data, root));
  add('integrate', integrateCheck(kind, data, root));
  const overall = checks.every((c) => c.applicable === false || c.ok) ? 'PASS' : 'FAIL';
  return { checks, overall, dialect: dialect.name, schema_ref: vpath ? path.relative(root, vpath) : schema_ref, ran_at: new Date().toISOString() };
}

module.exports = { runChecks, _repoRoot: repoRoot, _contentLiveManifest: contentLiveManifest, _dialectFor: dialectFor, _DIALECTS: DIALECTS };
