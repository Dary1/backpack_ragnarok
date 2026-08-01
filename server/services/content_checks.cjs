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
//      precondition (the shared/engine.js type surface must not have
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
// REQ-0184 adds a FOURTH dialect, monster_pack/1 (content/live/dungeon/packs.json):
// a pack carries no rarity and no stats of its own -- it is a composition of
// monsters and WHERE each one stands. It spells its display name `name` (the
// default), so only its own reference/geometry rules are new; those live in
// shared/content_validate.cjs, not here.
// REQ-0266 adds unit_skin/1 (content/live/live_unit_skins.json): a COSMETIC def
// that carries no rarity, no stats and no effects -- it is identity + a `slot`
// + a FREE artwork reference + the units it may dress. It spells its display
// name `name` (the default), so nothing about the dialect table itself is new;
// its own rules (slot vocabulary, live-unit references, at-most-one-default per
// (unit, slot)) live in shared/content_validate.cjs and are REUSED below.
const DIALECTS = {
  'enemy/1': { name: 'enemy/1', rarity_case: 'lower', range_fields: ['hp'] },
  'skill/1': { name: 'skill/1', rarity_case: 'exact', range_fields: [], name_field: 'name_en' },
  'monster_pack/1': { name: 'monster_pack/1', rarity_case: 'exact', range_fields: [] },
  'gimic/1': { name: 'gimic/1', rarity_case: 'exact', range_fields: [] }, // REQ-0211
  'dungeon/1': { name: 'dungeon/1', rarity_case: 'exact', range_fields: [] }, // REQ-0185
  'unit_skin/1': { name: 'unit_skin/1', rarity_case: 'exact', range_fields: [] }, // REQ-0266
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
    // COUPLING RESOLVED (integration-units003: 0200 -> 0201 merged): validateUnitEntry
    // now KNOWS the `charge` grammar -- REQ-0200 landed it into content_validate.cjs
    // (UNIT_ALLOWED_KEYS += 'charge' + validateCharge). A charge-bearing variant is no
    // longer an unknown field: a legal charge block deep-validates, and an illegal one
    // (unknown trigger / bad capacity / illegal spend) is caught HERE by the charge AST.
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
  } else if (kind === 'monster_pack') {
    // REQ-0184. A pack's closed vocabulary is not vocab.json -- it is THE LIVE
    // MONSTER ROSTER plus the field's own geometry. Both rules already exist,
    // executable, in shared/content_validate.cjs (validateMonsterPackEntry), which
    // is the SAME function sim/lib/packs.cjs places from. It is REUSED here, not
    // re-implemented: two copies of "what is a legal pack layout" would drift, and
    // a drift between the checker and the placer is the worst kind -- the admin
    // would bless a layout the sim then puts somewhere else. (The REQ-0171 lesson,
    // applied to geometry.)
    const { validateMonsterPackEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
    let enemyDefs;
    try {
      const enemies = loadJson(path.join(repoRoot(), 'content', 'live', 'dungeon', 'enemies.json'));
      enemyDefs = {};
      for (const e of (enemies.entries || [])) enemyDefs[e.id] = e;
    } catch (e) {
      errs.push('cannot read content/live/dungeon/enemies.json to resolve the members: ' + e.message);
      enemyDefs = {};
    }
    try {
      validateMonsterPackEntry(data, enemyDefs);
    } catch (e) {
      errs.push(e.message);
    }
    // REQ-0352 section 5 ruling: powerLevel is DERIVED. Its sole writer is
    // tools/autobalance_pack_powerlevel.cjs (into the live file at deploy);
    // the registry owns the authored facts only (id/name/i18n/note/members).
    // A variant carrying it would be silently clobbered at the next deploy --
    // the worst field to put in front of an operator -- so the rule is
    // enforced HERE, where content is authored, not discovered at deploy.
    // NOT in shared/content_validate.cjs: the sim placer validates FILE
    // entries with that function, and file entries legitimately carry the
    // derived value.
    if (data.powerLevel !== undefined) {
      errs.push('powerLevel must not be authored in a monster_pack variant (REQ-0352: derived, written only by tools/autobalance_pack_powerlevel.cjs; the registry owns id/name/i18n/note/members)');
    }
  } else if (kind === 'gimic') {
    // REQ-0211. A gimic's rules are executable in shared/content_validate.cjs
    // (validateGimicEntry) -- the SAME definition the dungeon generator relies on;
    // reused here, not re-implemented (the REQ-0184 lesson). Skills are cross-checked
    // against the LIVE skill roster so a trap that names a missing volley FAILs by name.
    const { validateGimicEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
    let skillDefs = null;
    try {
      const skills = loadJson(path.join(repoRoot(), 'content', 'live', 'dungeon', 'skills.json'));
      skillDefs = {};
      for (const sk of (skills.entries || [])) skillDefs[sk.id] = sk;
    } catch (e) {
      skillDefs = null; // shape-only when the live skill roster cannot be read
    }
    try {
      validateGimicEntry(data, skillDefs);
    } catch (e) {
      errs.push(e.message);
    }
  } else if (kind === 'dungeon') {
    // REQ-0185. A dungeon def's rules are executable in shared/content_validate.cjs
    // (validateDungeonEntry) -- the SAME definition sim/dungeon_roll.cjs rolls a dive
    // from; reused here, not re-implemented (the REQ-0184/0211 lesson). Pool references
    // are cross-checked against the LIVE monster_pack + gimic rosters, so a def that
    // names a missing pack or gimic FAILs by name (an unresolved ref would roll an empty
    // pack / crash the attachment builder, and nothing else in the chain would say so).
    const { validateDungeonEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
    let monsterPackDefs = null;
    let gimicDefs = null;
    try {
      const packs = loadJson(path.join(repoRoot(), 'content', 'live', 'dungeon', 'packs.json'));
      monsterPackDefs = {};
      for (const e of (packs.entries || [])) monsterPackDefs[e.id] = e;
    } catch (e) { monsterPackDefs = null; } // shape-only when the live pack roster cannot be read
    try {
      const gimics = loadJson(path.join(repoRoot(), 'content', 'live', 'dungeon', 'gimics.json'));
      gimicDefs = {};
      for (const g of (gimics.entries || [])) gimicDefs[g.id] = g;
    } catch (e) { gimicDefs = null; }
    try {
      validateDungeonEntry(data, { monsterPackDefs, gimicDefs });
    } catch (e) {
      errs.push(e.message);
    }
  } else if (kind === 'unit_skin') {
    // REQ-0266. A unit_skin's closed vocabulary is not vocab.json -- it is THE
    // LIVE UNIT ROSTER (every id in `units[]` must have a unit def, or the skin
    // can never be resolved by any of the three chains and nothing else would
    // say so) plus its own slot/i18n rules. All of that already exists,
    // executable, in shared/content_validate.cjs (validateUnitSkinEntry) -- the
    // SAME function the live content gate runs. REUSED here, never
    // re-implemented: two copies of "what is a legal skin" would drift, and the
    // drift would be invisible (the REQ-0171/0184 lesson).
    //
    // NOTE the corpus rule (at most ONE default per (unit, slot)) is NOT checked
    // here: runChecks() validates ONE variant in isolation, and a variant is
    // routinely a NOT-YET-adopted candidate, so the live file is not the corpus
    // it belongs to. The corpus sweep is the live gate's job (tools/check_units.cjs).
    const { validateUnitSkinEntry } = require(path.join(repoRoot(), 'shared', 'content_validate.cjs'));
    let unitIds = null;
    try {
      const units = loadJson(path.join(repoRoot(), 'content', 'live', 'live_units.json'));
      unitIds = new Set((units.entries || []).map((e) => e.id));
    } catch (e) {
      errs.push('cannot read content/live/live_units.json to resolve units[]: ' + e.message);
      unitIds = null; // shape-only when the live roster cannot be read
    }
    try {
      validateUnitSkinEntry(data, { unitIds: unitIds });
    } catch (e) {
      errs.push(e.message);
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
  // REQ-0184: a monster_pack IS consumed by runtime code (sim/lib/packs.cjs
  // packMembers reads members[].enemy and members[].at), so like gacha_pack -- and
  // unlike skill_def -- it has a real type surface and the check APPLIES. These are
  // the exact field types that function dereferences; a member with no `at` is a
  // crash inside the placer, not a content nit.
  if (kind === 'monster_pack') {
    const errs = [];
    if (!Array.isArray(data.members)) errs.push('members must be an array (packMembers maps over it)');
    else data.members.forEach((m, i) => {
      if (!m || typeof m !== 'object') { errs.push('members[' + i + '] must be an object'); return; }
      if (typeof m.enemy !== 'string') errs.push('members[' + i + '].enemy must be a string (indexes enemyDefsById)');
      if (typeof m.at !== 'string') errs.push('members[' + i + '].at must be an A1 string like "F5" (parseA1 reads it)');
    });
    return { ok: errs.length === 0, detail: errs.length === 0 ? 'runtime field types conform to what sim/lib/packs.cjs packMembers() consumes' : errs.join('; ') };
  }
  // REQ-0211: a gimic IS consumed by runtime code -- sim/dungen.cjs reads a gimic's
  // footprint / hp / timeout_secs / skills to build the trap/chest/door attachments,
  // so like monster_pack it has a real type surface and the check APPLIES. A string
  // where dungen wants a number is a crash inside the generator, not a content nit.
  if (kind === 'gimic') {
    const errs = [];
    if (!Array.isArray(data.footprint) || data.footprint.length !== 2 || !Number.isInteger(data.footprint[0]) || !Number.isInteger(data.footprint[1])) errs.push('footprint must be [fh, fw] integers (dungen reads both)');
    if (!Number.isFinite(data.hp)) errs.push('hp must be a number (dungen reads it into the attachment hp range)');
    if (!Number.isFinite(data.timeout_secs)) errs.push('timeout_secs must be a number (dungen reads it as the attachment clock)');
    if (data.skills !== undefined && (!Array.isArray(data.skills) || !data.skills.every((x) => typeof x === 'string'))) errs.push('skills must be string[] (the volley/keeper skill ids dungen wires onto the attachment)');
    return { ok: errs.length === 0, detail: errs.length === 0 ? 'runtime field types conform to what sim/dungen.cjs builds gimic attachments from' : errs.join('; ') };
  }
  // REQ-0185: a dungeon IS consumed by runtime code -- sim/dungeon_roll.cjs reads
  // packPool/bossPool[].packId, gimicPool[].gimic and the dive.{packEncounters,gimicSlots}
  // bands to roll a concrete encounter list. So like monster_pack it has a real type
  // surface and the check APPLIES. A non-string ref or a non-number weight/band is a crash
  // in the roller (pickWeighted / bandCount), not a content nit.
  if (kind === 'dungeon') {
    const errs = [];
    const chkPool = (pool, name, key, required) => {
      if (pool === undefined && !required) return;
      if (!Array.isArray(pool)) { errs.push(name + ' must be an array (the roller pickWeighted maps over it)'); return; }
      pool.forEach((r, i) => {
        if (!r || typeof r !== 'object') { errs.push(name + '[' + i + '] must be an object'); return; }
        if (typeof r[key] !== 'string') errs.push(name + '[' + i + '].' + key + ' must be a string (indexes the def map)');
        if (!Number.isFinite(r.weight)) errs.push(name + '[' + i + '].weight must be a number (pickWeighted reads it)');
      });
    };
    chkPool(data.packPool, 'packPool', 'packId', true);
    chkPool(data.bossPool, 'bossPool', 'packId', true);
    chkPool(data.gimicPool, 'gimicPool', 'gimic', false);
    const chkBand = (b, name) => {
      if (!b || typeof b !== 'object') { errs.push(name + ' must be an object {base, max}'); return; }
      if (!Number.isInteger(b.base)) errs.push(name + '.base must be an integer (bandCount reads it)');
      if (!Number.isInteger(b.max)) errs.push(name + '.max must be an integer (bandCount reads it)');
    };
    if (data.dive && typeof data.dive === 'object') { chkBand(data.dive.packEncounters, 'dive.packEncounters'); chkBand(data.dive.gimicSlots, 'dive.gimicSlots'); }
    else errs.push('dive must be an object {packEncounters, gimicSlots} (the roller reads the level-scaling bands)');
    return { ok: errs.length === 0, detail: errs.length === 0 ? 'runtime field types conform to what sim/dungeon_roll.cjs rolls a dive from' : errs.join('; ') };
  }
  // REQ-0266: a unit_skin declares no ENGINE-consumed record at all -- it is
  // pure cosmetics (identity + slot + an artwork reference + the units it may
  // dress). shared/engine.js never sees one: the def is consumed by the
  // CLIENT's resolution chains (unitIcon / bpSkinResolve) and by the art_urls
  // join, neither of which is an engine type surface. Recorded honestly as
  // not-applicable WITH a reason, never as a free PASS (REQ-0160 ruling Q2-sub).
  if (kind === 'unit_skin') {
    return { ok: true, applicable: false, detail: 'engine_types not applicable for unit_skin (unit_skin/1 declares no engine-consumed record: no shape, no stats, no effects -- it is cosmetic identity + an artwork reference)' };
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
  // REQ-0184: same honesty for monster_pack -- tool_gen_data has never consumed a
  // pack composition, and a free PASS here would be a lie dressed as a green chip.
  if (kind === 'monster_pack') {
    return { ok: true, applicable: false, detail: 'gen_data not applicable for monster_pack (tool_gen_data does not consume monster_pack/1)' };
  }
  // REQ-0211: same honesty for gimic -- tool_gen_data has never consumed a gimic def,
  // and a free PASS here would be a lie dressed as a green chip.
  if (kind === 'gimic') {
    return { ok: true, applicable: false, detail: 'gen_data not applicable for gimic (tool_gen_data does not consume gimic/1)' };
  }
  // REQ-0185: same honesty for dungeon -- tool_gen_data has never consumed a dungeon
  // def, and a free PASS here would be a lie dressed as a green chip.
  if (kind === 'dungeon') {
    return { ok: true, applicable: false, detail: 'gen_data not applicable for dungeon (tool_gen_data does not consume dungeon/1)' };
  }
  // REQ-0266: same honesty for unit_skin -- tool_gen_data consumes items/sis
  // only and has never seen a cosmetic def, and a free PASS here would be a lie
  // dressed as a green chip.
  if (kind === 'unit_skin') {
    return { ok: true, applicable: false, detail: 'gen_data not applicable for unit_skin (tool_gen_data does not consume unit_skin/1)' };
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

// ---- 5. formation_fill (REQ-0300: the 30% rule as an admincontent warning) --
//
// REQ-0300 (user 2026-07-24: "put this 30% constraint into the admincontent
// WARNING system"). A monster_pack/1 whose formation fills < FILL_MIN (30%) of
// the enemy placeable area becomes a LIVE admincontent warning: a not-ok
// `formation_fill` check row that lowers `overall`, rendered by the contentadmin
// UI exactly like every other runChecks row (no new UI). The rule and its math
// are REQ-0298's sim/lib/pack_formation.cjs (packFill + FILL_MIN) measured over
// the SAME placeable area sim/lib/field.cjs defines -- REUSED, never re-derived,
// so a field resize or a FILL_MIN re-tune moves the checker with the sim.
//
// ADDITIVE, not a weakening: schema_vocab (geometry + references) and
// engine_types (member field types) are untouched -- a pack can be geometrically
// perfect and still warn here for being too sparse. GIMIC content is a different
// KIND and is never passed to this branch, so it is naturally exempt with no
// per-pack flag (the REQ-0298 doctrine carried through). PURE / DB-free.

/** The formation_fill row for an ALREADY-resolved pack (members -> enemy defs)
 * over a given placeable-cell count. Split out so a test can pin the exact
 * FILL_MIN boundary with a synthetic roster + count (the live field is 384,
 * where 30% is non-integer). fillFrac >= FILL_MIN passes -- the fail test is a
 * strict `<`, matching pack_formation.inspectPacks. */
function _formationFillResult(data, enemyDefsById, placeableCells) {
  const { FILL_MIN, packFill } = require(path.join(repoRoot(), 'sim', 'lib', 'pack_formation.cjs'));
  const f = packFill(data, enemyDefsById, placeableCells);
  const pct = (f.fillFrac * 100).toFixed(1);
  const min = Math.round(FILL_MIN * 100);
  if (f.fillFrac < FILL_MIN) {
    return { ok: false, applicable: true,
      detail: 'formation fill ' + pct + '% (' + f.occupiedCells + '/' + f.placeableCells + ') < ' + min
        + '% minimum -- add monsters (boss packs: boss + entourage); gimic exempt' };
  }
  return { ok: true, applicable: true,
    detail: 'formation fill ' + pct + '% (' + f.occupiedCells + '/' + f.placeableCells + ') >= ' + min + '% minimum' };
}

/** REQ-0300 formation-fill machine check for ONE monster_pack. Resolves member
 * footprints against content/live/dungeon/enemies.json with the SAME read/guard
 * the monster_pack schema_vocab check uses, then measures fill over the live
 * placeable area (sim/lib/field.cjs FIELD_ROWS x FIELD_COLS). Deterministic and
 * DB-free. If the enemy roster is unreadable it degrades to an HONEST
 * applicable:false (never throws): the fill rule is simply skipped, exactly as
 * the schema_vocab read degrades; the unreadable file is already reported by
 * schema_vocab, so overall still FAILs there without a misleading fill number. */
function formationFillCheck(kind, data) {
  if (kind !== 'monster_pack') {
    return { ok: true, applicable: false,
      detail: 'formation_fill not applicable for ' + kind + ' (only monster_pack/1 has a field formation; gimic and every other kind are naturally exempt)' };
  }
  const { placeableCellsFor } = require(path.join(repoRoot(), 'sim', 'lib', 'pack_formation.cjs'));
  const { FIELD_ROWS, FIELD_COLS } = require(path.join(repoRoot(), 'sim', 'lib', 'field.cjs'));
  let enemyDefs;
  try {
    const enemies = loadJson(path.join(repoRoot(), 'content', 'live', 'dungeon', 'enemies.json'));
    enemyDefs = {};
    for (const e of (enemies.entries || [])) enemyDefs[e.id] = e;
  } catch (e) {
    return { ok: true, applicable: false,
      detail: 'formation_fill n/a: cannot read content/live/dungeon/enemies.json to resolve member footprints (' + e.message + ')' };
  }
  return _formationFillResult(data, enemyDefs, placeableCellsFor(FIELD_ROWS, FIELD_COLS));
}

// ---- 6. serving (REQ-0354) -- the advisory drift tag + its live-file sha --
//
// "Adopted but inert" (REQ-0352/0353) was invisible where the operator works.
// This row compares ONE variant's data against the live content FILES -- the
// same corpus, through the same COVERED kind->file mapping, as
// tools/verify_content_registry_parity.cjs (required here, never re-derived,
// so the mapping cannot fork; kind_lists_agree_test pins COVERED ==
// REGISTRY_KINDS).
//
// THE STALENESS TRAP (REQ-0354 section 3): every other check is a pure
// function of the variant's own immutable data, so a stored verdict stays
// true forever. This row is a function of the variant AND the live files,
// which change without the variant changing -- a naively-stored PASS goes
// silently false, which is the exact failure mode this REQ exists to kill.
// Ruling (user, 2026-07-31): the row CARRIES the sha256 of every live file
// it was computed against (live_files[]); annotateServingStaleness() re-
// hashes them on READ and a mismatch renders as STALE -- a third state,
// neither PASS nor FAIL (same idiom as REQ-0297's powerlevel_calibrated_from).
//
// RULING (REQ-0354 section 4): advisory:true, and it NEVER feeds overall. A
// freshly adopted variant legitimately differs from the live file until its
// export lands; feeding overall would 409 every normal adoption and teach
// operators to always send override:true -- which also bypasses the REAL
// checks. overallOf() below is the ONE overall rule; advisory rows are
// skipped EXPLICITLY, never by abusing applicable:false (that field means
// "does not apply to this kind", a different fact, shown differently).

/** The ONE overall rule (REQ-0354 section 4): applicable:false and
 * advisory:true rows never sway the verdict. Used by runChecks() and by the
 * appended-tier recompute in routes/content.cjs. */
function overallOf(checks) {
  return checks.every((c) => c.advisory === true || c.applicable === false || c.ok) ? 'PASS' : 'FAIL';
}

/** The advisory `serving` row for ONE variant: does the live-file entry named
 * `systemName` match this variant's data (authored fields only, key order
 * aside)? DB-free: reads only the COVERED live files + REGISTRY_KINDS. */
function servingCheck(kind, systemName, data) {
  const advisory = true;
  let REGISTRY_KINDS = null;
  try { REGISTRY_KINDS = require('./core.cjs').REGISTRY_KINDS; } catch (e) { /* fall through to n/a */ }
  if (!REGISTRY_KINDS || !REGISTRY_KINDS.includes(kind)) {
    return { name: 'serving', advisory, ok: true, applicable: false,
      detail: 'serving n/a: kind "' + kind + '" is not wired into serving (services/core.cjs REGISTRY_KINDS) -- adoption cannot reach the game. A KIND-level condition: surfaced as the per-kind NOT WIRED banner (REQ-0354 section 5); kind_lists_agree_test forbids this state on CI.' };
  }
  const parity = require(path.join(repoRoot(), 'tools', 'verify_content_registry_parity.cjs'));
  const { CONTENT_ROOT } = require('../lib/content_files.cjs');
  const rel = (abs) => path.relative(CONTENT_ROOT, abs);
  const sources = parity.COVERED.filter((s) => s.kind === kind);
  const live_files = []; // EVERY covered file of the kind: absence-from-all is also a fact of all of them
  let hit = null;
  for (const src of sources) {
    let raw = null;
    try { raw = fs.readFileSync(src.file); }
    catch (e) { live_files.push({ file: rel(src.file), sha256: null }); continue; }
    live_files.push({ file: rel(src.file), sha256: sha256(raw) });
    if (hit) continue;
    let doc = null;
    try { doc = JSON.parse(raw.toString('utf8')); } catch (e) { continue; }
    const excluded = new Set(src.exclude || []);
    for (const entry of (doc.entries || [])) {
      if (entry && entry.id === systemName && !excluded.has(entry.id)) {
        hit = { file: rel(src.file), entry: parity.authoredView(entry, src.derived) };
        break;
      }
    }
  }
  if (!hit) {
    return { name: 'serving', advisory, ok: false, applicable: true, live_files,
      detail: 'no live-file entry named "' + systemName + '" for kind ' + kind + ' (checked: ' + (live_files.map((f) => f.file).join(', ') || 'none') + ') -- LEGITIMATE for a fresh def until its export is merged into content/live. Advisory: never blocks adoption (REQ-0354 section 4).' };
  }
  if (parity.deepEqualUnordered(hit.entry, data)) {
    return { name: 'serving', advisory, ok: true, applicable: true, live_files,
      detail: 'live-file entry matches this variant (' + hit.file + '; authored fields, key order aside)' };
  }
  const diffs = parity.diffFields(hit.entry, data).map((d) => d.path);
  const shown = diffs.slice(0, 8).join(', ') + (diffs.length > 8 ? ' (+' + (diffs.length - 8) + ' more)' : '');
  return { name: 'serving', advisory, ok: false, applicable: true, live_files,
    detail: 'DRIFT vs ' + hit.file + ' -- fields: ' + shown + '. Legitimate for a fresh adoption until its export lands; STANDING drift on an ADOPTED variant is the REQ-0353 defect class. Advisory: never blocks adoption.' };
}

/** READ-time staleness (REQ-0354 section 3, the trap closed): re-hash the
 * live files a stored serving row was computed against; any mismatch marks
 * the row stale:true (rendered STALE -- a stale green is worse than a red,
 * it is the state that produced REQ-0353). Mutates the row IN THE RESPONSE
 * object only; nothing is persisted. shaCache (Map file->sha|null) lets a
 * caller annotating many variants hash each file once. */
function annotateServingStaleness(mc, shaCache) {
  if (!mc || !Array.isArray(mc.checks)) return mc;
  const row = mc.checks.find((c) => c && c.name === 'serving');
  if (!row || !Array.isArray(row.live_files) || row.live_files.length === 0) return mc;
  const { CONTENT_ROOT } = require('../lib/content_files.cjs');
  const cache = shaCache || new Map();
  let stale = false;
  for (const lf of row.live_files) {
    if (!lf || typeof lf.file !== 'string') continue;
    let cur;
    if (cache.has(lf.file)) { cur = cache.get(lf.file); }
    else {
      try { cur = sha256(fs.readFileSync(path.join(CONTENT_ROOT, lf.file))); } catch (e) { cur = null; }
      cache.set(lf.file, cur);
    }
    if (cur !== (lf.sha256 == null ? null : lf.sha256)) { stale = true; break; }
  }
  row.stale = stale;
  return mc;
}

/** Per-KIND serving report for the list endpoint (REQ-0354 section 5): NOT
 * WIRED is a kind-level banner (14 identical red rows would bury the real
 * per-variant reds) and MISSING cannot be a variant tag at all -- there is no
 * variant to hang it on. defs come from the caller (storage stays out of this
 * module); kinds is routes/content.cjs KINDS (passed in -- requiring routes
 * from here would be a cycle). */
function servingReportForDefs(defs, kinds) {
  const parity = require(path.join(repoRoot(), 'tools', 'verify_content_registry_parity.cjs'));
  let REGISTRY_KINDS = [];
  try { REGISTRY_KINDS = require('./core.cjs').REGISTRY_KINDS; } catch (e) { /* report wired:false */ }
  const byName = parity.collectFileEntries();
  const defSet = new Set((defs || []).map((d) => d.kind + '/' + d.system_name));
  const defsByKind = {}; const adoptedByKind = {};
  for (const d of (defs || [])) {
    defsByKind[d.kind] = (defsByKind[d.kind] || 0) + 1;
    if (d.adopted_variant_id != null) adoptedByKind[d.kind] = (adoptedByKind[d.kind] || 0) + 1;
  }
  const rows = [];
  for (const kind of (kinds || [])) {
    const missing = [];
    let inFiles = 0;
    for (const [name, info] of byName) {
      if (info.kind !== kind) continue;
      inFiles++;
      if (!defSet.has(kind + '/' + name)) missing.push(name);
    }
    rows.push({
      kind,
      wired: REGISTRY_KINDS.includes(kind),
      def_count: defsByKind[kind] || 0,
      adopted_count: adoptedByKind[kind] || 0,
      in_files: inFiles,
      missing_count: missing.length,
      missing_from_registry: missing.slice(0, 100),
    });
  }
  return { generated_at: new Date().toISOString(), kinds: rows };
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
  // REQ-0300: the 30% formation-fill rule as a live admincontent warning row,
  // ONLY for monster_pack (a different kind -- e.g. gimic -- never reaches it, so
  // it is naturally exempt with no per-pack flag). A not-ok row lowers overall.
  if (kind === 'monster_pack') add('formation_fill', formationFillCheck(kind, data));
  const overall = overallOf(checks); // REQ-0354: the ONE overall rule (advisory-aware; no advisory row is added here, runChecks stays pure of the live files)
  return { checks, overall, dialect: dialect.name, schema_ref: vpath ? path.relative(root, vpath) : schema_ref, ran_at: new Date().toISOString() };
}

// ===========================================================================
// REQ-0188 -- art-authoritative cell-geometry DRIFT GUARD.
//
// Doctrine (REQ-0029 continued, REQ-0188 ruling 1): a thing's cell geometry is
// OWNED by its artwork. A monster_def/po_def whose def-side geometry disagrees
// with its LINKED artwork's shape is DRIFT -- the guard FAILs it, naming BOTH
// sides in BOTH spellings so the transposition class of bug (REQ-0029, [row,col]
// read as [col,row]) cannot hide. The def->artwork link reuses REQ-0174's
// ref-first canon (artwork_ref -> exact system_name -> none); the resolution
// itself is done by the caller and the resolved artwork passed IN, so this stays
// DB-free and unit-testable against fixtures.
//
// THREE spellings of ONE fact, and every conversion crosses the transpose:
//   monster artwork : {w, h}             (width, height)
//   enemy/1 def     : footprint [fh, fw] (HEIGHT, width)   <- the TRANSPOSE
//   po artwork      : {mask: 5x5 bool}   ([row][col])
//   po/2 def        : shape [[r, c]...]  ([row][col])
// Everything below compares NORMALIZED CELL-SETS (translated to the bounding-box
// top-left), so a footprint and an art shape agree iff they cover the same cells
// -- order-, offset- and spelling-independent.
// ===========================================================================

/** Normalized cell-set "r,c" of a list of [row,col] offsets, translated so the
 * bounding-box top-left is (0,0). null for an empty/invalid list. */
function _normCellSet(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const cs = cells.filter((c) => Array.isArray(c) && c.length >= 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]));
  if (cs.length === 0) return null;
  const minR = Math.min.apply(null, cs.map((c) => c[0]));
  const minC = Math.min.apply(null, cs.map((c) => c[1]));
  return new Set(cs.map((c) => (c[0] - minR) + ',' + (c[1] - minC)));
}

function _setEq(a, b) { return !!a && !!b && a.size === b.size && [...a].every((x) => b.has(x)); }

/** Cells of a rows x cols filled rectangle (top-left origin). */
function _rectCells(rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([r, c]);
  return out;
}

/** Active cells [[r,c]...] of a po artwork 5x5 boolean mask ([row][col]). */
function _maskCells(mask) {
  if (!Array.isArray(mask)) return null;
  const out = [];
  for (let r = 0; r < mask.length; r++) {
    const row = mask[r] || [];
    for (let c = 0; c < row.length; c++) if (row[c]) out.push([r, c]);
  }
  return out;
}

/** The DEF-side geometry of a monster_def/po_def as {cells:Set, spell:string}.
 * null when the kind carries no cell geometry or the field is missing/malformed. */
function defGeometry(kind, data) {
  if (!data || typeof data !== 'object') return null;
  if (kind === 'monster_def') {
    const fp = data.footprint;
    if (!isIntPair(fp) || fp[0] < 1 || fp[1] < 1) return null;
    return { cells: _normCellSet(_rectCells(fp[0], fp[1])), spell: 'footprint [fh,fw]=' + JSON.stringify(fp) };
  }
  if (kind === 'po_def') {
    const cells = _normCellSet(data.shape);
    if (!cells) return null;
    return { cells, spell: 'shape [[r,c]...]=' + JSON.stringify(data.shape) };
  }
  return null;
}

/** The ARTWORK-side geometry (THE AUTHORITY) as {cells:Set, spell:string}.
 * monster art shape is {w,h}; po art shape is {mask}. null when the artwork has
 * no usable cell geometry (si/unit/etc.), i.e. nothing to be authoritative WITH. */
function artworkGeometry(kind, artwork) {
  if (!artwork || !artwork.shape || typeof artwork.shape !== 'object') return null;
  const sh = artwork.shape;
  if (kind === 'monster_def') {
    const w = sh.w, h = sh.h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return null;
    // TRANSPOSE: monster art {w,h} owns the footprint [fh,fw] = [h,w].
    return { cells: _normCellSet(_rectCells(h, w)), spell: 'artwork {w,h}=' + JSON.stringify({ w, h }) + ' (=> footprint [' + h + ',' + w + '])' };
  }
  if (kind === 'po_def') {
    const cells = _maskCells(sh.mask);
    const set = _normCellSet(cells);
    if (!set) return null;
    return { cells: set, spell: 'artwork mask [row][col], active cells ' + JSON.stringify(cells) };
  }
  return null;
}

/** REQ-0188 DRIFT GUARD (the guard proper). Compare a monster_def/po_def's own
 * cell geometry with its LINKED artwork's shape (the authority). Returns a
 * machine-check-shaped result { name:'artwork_geometry', ok, applicable, detail }:
 *   applicable:false  kind carries no cell geometry, OR there is no linked
 *                     artwork with a usable shape (nothing to be authoritative
 *                     WITH -- an HONEST n/a, never a free PASS; REQ-0160 posture);
 *   ok:true           def geometry == artwork geometry (cell-sets equal);
 *   ok:false          DRIFT -- detail names BOTH sides in BOTH spellings.
 * `artwork` is the already-resolved artwork row (ref-first, REQ-0174 canon) or
 * null. Kept DB-free: the caller resolves and passes the artwork in. */
function checkArtworkGeometry(kind, data, artwork) {
  if (kind !== 'monster_def' && kind !== 'po_def') {
    return { name: 'artwork_geometry', ok: true, applicable: false, detail: 'artwork_geometry n/a for ' + kind + ' (no cell geometry to own)' };
  }
  const art = artworkGeometry(kind, artwork);
  if (!art) {
    return { name: 'artwork_geometry', ok: true, applicable: false, detail: 'artwork_geometry n/a: no linked artwork with a usable shape (art is authoritative but has no row here yet -- REQ-0188 seed coverage)' };
  }
  const def = defGeometry(kind, data);
  if (!def) {
    const side = kind === 'monster_def' ? 'footprint' : 'shape';
    return { name: 'artwork_geometry', ok: false, applicable: true, detail: 'GEOMETRY DRIFT: ' + kind + ' has a linked ' + art.spell + ' but no readable ' + side + ' of its own' };
  }
  const ok = _setEq(def.cells, art.cells);
  const detail = ok
    ? 'def geometry agrees with the authoritative artwork (' + def.spell + ' == ' + art.spell + ')'
    : 'GEOMETRY DRIFT: def ' + def.spell + ' disagrees with the authoritative ' + art.spell + ' -- the ART is the authority (REQ-0029/REQ-0188); regenerate the def side (tools/derive_def_geometry.cjs)';
  return { name: 'artwork_geometry', ok, applicable: true, detail };
}

// The live content the sim actually serves; every monster_def / po_def in it is
// swept. NOT hardcoded to the batch-002 roster: batch-005 (REQ-0203) monsters
// land in enemies.json and are covered automatically once merged.
const ART_GEOM_CORPUS = [
  { kind: 'monster_def', file: 'content/live/dungeon/enemies.json' },
  { kind: 'po_def', file: 'content/live/live_items.json' },
  { kind: 'po_def', file: 'content/live/dungeon/items.json' },
  { kind: 'po_def', file: 'content/live/starter_items.json' },
];

/** REQ-0188 LIVE SWEEP. Walk the served content, resolve each entity's linked
 * artwork REF-FIRST (REQ-0174 canon via storage.resolveArtworkFacetName ->
 * exact-name fallback), and run checkArtworkGeometry. READ-ONLY. Not part of the
 * four per-variant machine checks (those stay DB-free); this is the corpus-wide
 * guard for the deploy/CI dry-run. deps = { storage, root, log }. Returns
 * { agree, disagree, notApplicable, results }. */
async function sweepArtworkGeometry(deps) {
  deps = deps || {};
  const root = deps.root || repoRoot();
  const storage = deps.storage;
  if (!storage) throw new Error('sweepArtworkGeometry requires deps.storage (STORAGE_BACKEND=pg)');
  const log = deps.log || function () {};
  const results = [];
  const seen = new Set();
  for (const src of ART_GEOM_CORPUS) {
    let entries;
    try { entries = (loadJson(path.join(root, src.file)).entries) || []; } catch (_) { entries = []; }
    for (const entry of entries) {
      const key = src.kind + ':' + entry.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const def = await storage.getContentDefByName(entry.id);
      let artName = def ? await storage.resolveArtworkFacetName(def) : null;
      if (!artName) { const a = await storage.getArtworkByName(entry.id); if (a) artName = entry.id; }
      const artwork = artName ? await storage.getArtworkByName(artName) : null;
      const r = checkArtworkGeometry(src.kind, entry, artwork);
      results.push({ id: entry.id, kind: src.kind, file: src.file, artwork: artName, ok: r.ok, applicable: r.applicable, detail: r.detail });
      const tag = r.applicable ? (r.ok ? 'AGREE   ' : 'DISAGREE') : 'n/a     ';
      log(tag + ' ' + src.kind + ' ' + entry.id + (artName ? ' -> ' + artName : '') + '  ' + r.detail);
    }
  }
  const agree = results.filter((r) => r.applicable && r.ok).length;
  const disagree = results.filter((r) => r.applicable && !r.ok).length;
  const notApplicable = results.filter((r) => !r.applicable).length;
  log('--- artwork_geometry sweep: agree=' + agree + ' disagree=' + disagree + ' n/a=' + notApplicable + ' (total ' + results.length + ')');
  return { agree, disagree, notApplicable, results };
}


// REQ-0188 CLI: run the live artwork_geometry drift sweep READ-ONLY against the
// artwork registry. Exit 0 when clean, 1 on any disagreement, 2 on missing DB.
// DATABASE_URL (STORAGE_BACKEND=pg) required; source server/.env first.
if (require.main === module) {
  (async () => {
    const root = repoRoot();
    process.env.STORAGE_BACKEND = 'pg';
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL required (STORAGE_BACKEND=pg; source server/.env). The REQ-0188 drift guard reads the artwork registry READ-ONLY.');
      process.exit(2);
    }
    const storage = require(path.join(root, 'server', 'storage.cjs'));
    let res;
    try {
      res = await sweepArtworkGeometry({ storage, root, log: (...a) => console.log(...a) });
    } finally {
      if (storage.closeArtPool) await storage.closeArtPool();
      if (storage.closeContentPool) await storage.closeContentPool();
    }
    process.exit(res.disagree === 0 ? 0 : 1);
  })().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}

module.exports = { runChecks, servingCheck, annotateServingStaleness, overallOf, servingReportForDefs, formationFillCheck, _formationFillResult, _repoRoot: repoRoot, _contentLiveManifest: contentLiveManifest, _dialectFor: dialectFor, _DIALECTS: DIALECTS,
  checkArtworkGeometry, defGeometry, artworkGeometry, sweepArtworkGeometry, ART_GEOM_CORPUS,
  _normCellSet, _maskCells, _rectCells, _setEq };
