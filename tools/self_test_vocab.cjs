#!/usr/bin/env node
// self_test_vocab.cjs -- builds one effect per verb in content/vocab.json, validates each
// (REQ-0022 batch 3/4: vocab.json's flat "types" array became the "po_tags" hierarchy tree;
// this file uses Object.keys(vocab.po_tags)[0] ("Weapon", the first-declared root) wherever
// it used to read vocab.types[0], and builds PO-entry fixtures with "tags" instead of
// separate "type"/"el" fields, matching the migrated content JSON schema.)
// via a range validator (see runValidate below), and renders every effect in both
// locales via eff_render.cjs. Exits 0 and prints "ALL GREEN" iff everything passes; exits 1
// on any failure with a diagnostic dump.
// NOTE (REQ-0081): tool_validate.cjs -- the full schema/vocab/range content validator --
// has been "rebuild queued" since the S2 content pipeline (docs/terminology_alignment_plan.md
// S1.8) and is deliberately deferred to the S4 simulate-gate / content-validator work
// (REQ-0050); designing it here would pre-empt that REQ. Until it exists, this self-test no
// longer HARD-depends on it: runValidate() shells out to tools/tool_validate.cjs when present
// (so REQ-0050's validator is picked up automatically the moment it lands) and otherwise falls
// back to an in-process range validator (inlineValidate) that enforces exactly the contract the
// two validator-dependent checks below exercise -- ranged verb params must be [lo,hi] integer
// ranges, and an entry tagged `_expect_reject` must be caught (the negative bare-int test). This
// keeps the gate self-contained and green without guessing at the full validator's rule design.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render, renderAll, renderCharge } = require('./eff_render.cjs');
const { validateCharge } = require('../shared/content_validate.cjs');

const DIR = __dirname;
const vocab = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'content', 'vocab.json'), 'utf8'));
// PO Tag hierarchy roots (REQ-0022 batch 3/4): vocab.po_tags is a parent-map
// { tagName: parent|null }; Object.keys() preserves declaration order, so
// POTagNames[0] === 'Weapon', matching the old vocab.types[0] usage below.
const POTagNames = Object.keys(vocab.po_tags || {});

let failures = 0;
const lines = [];
function log(s) { lines.push(s); }

// ---- 1. build one PO entry per verb, each with a single effect exercising that verb ----

function rangeFor(verbT, param) {
  // small, valid [lo,hi] ranges per param
  if (param === 'hits') return undefined; // hits is a scalar int, not a range
  return [2, 4];
}

function buildEffectForVerb(verbT) {
  const rParams = (vocab.ranged_verb_params || {})[verbT] || [];
  const verb = { t: verbT };
  for (const p of rParams) {
    verb[p] = rangeFor(verbT, p);
  }
  if (verbT === 'multi_strike') verb.hits = 3;
  if (['apply_status', 'add_on_hit_status', 'amp_status'].includes(verbT)) {
    verb.status = vocab.statuses[0]; // Burn
    if (verbT === 'amp_status') { delete verb.n; verb.mult = 2; }
  }
  if (verbT === 'buff_host') verb.stat = 'damage';
  if (verbT === 'buff_self') verb.stat = 'damage'; // REQ-0121: same OQ7 shape as buff_host
  if (verbT === 'buff_self_per_tag' || verbT === 'buff_adjacent') {
    verb.stat = 'damage';
    verb.tagKind = 'type';
    verb.tag = POTagNames[0]; // Weapon
  }
  // REQ-0093: status_immune (flat immunity, no ranged param) / bonus_vs_status
  // (ranged 'n' bonus, already populated above via ranged_verb_params).
  // Default per-verb fixture uses the LITERAL `status` form; dedicated
  // status_kind-form fixtures (one polarity + one mechanical keyword each,
  // for both verbs) are added separately below in extraPO.
  if (verbT === 'status_immune' || verbT === 'bonus_vs_status') {
    verb.status = vocab.statuses[0]; // Burn
  }

  // choose a trigger appropriate to the verb; buff_adjacent pairs naturally with "adjacent"
  let trigger;
  if (verbT === 'buff_adjacent') {
    trigger = { t: 'adjacent', tagKind: 'type', tag: POTagNames[0] };
  } else if (verbT === 'buff_self_per_tag' || verbT === 'buff_host') {
    trigger = { t: 'passive' };
  } else if (verbT === 'status_immune' || verbT === 'bonus_vs_status') {
    trigger = { t: 'battle_start' }; // REQ-0093: matches vocab trigger_domains.battle_start
  } else if (verbT === 'buff_self') {
    // REQ-0121: exercise the NEW on_hp_below trigger here (PO-legal per the
    // widened trigger_domains ruling, user 2026-07-09) so the REQ-0081
    // full-trigger-coverage gate covers it; the battle_start form shares
    // buff_host's shape and needs no separate fixture.
    trigger = { t: 'on_hp_below', hp_frac: 0.5 };
  } else if (verbT === 'damage_reduction') {
    trigger = { t: 'battle_start' }; // REQ-0121: battle_start-folded constant
  } else if (verbT === 'battle_start_test') {
    trigger = { t: 'battle_start' };
  } else {
    trigger = { t: 'every_secs', s: [2, 3] };
  }
  return { trigger, verb };
}

const poEntries = [];
for (const verbT of vocab.verbs) {
  const effect = buildEffectForVerb(verbT);
  const entry = {
    id: 'selftest_' + verbT,
    name: 'Selftest ' + verbT,
    // tags[0]=former type (REQ-0022 batch 3/4); no former elements here.
    tags: [POTagNames[0]], // Weapon
    rarity: 'Common',
    shape: [[0, 0]],
    part: { assembles: 'na', role: 'na' }, // satisfy 1x1 scarcity rule
    icon: 'icon-selftest_' + verbT,
    sockets: [],
    effects: [effect],
    // REQ-0036 P1-A: vocab v5 adds a closed "modes" vocab (battle/detection/
    // unlock). Existing POs default to modes:["battle"] per the ratified
    // combat spec S6.1 -- probe that default here for every per-verb fixture.
    modes: ['battle'],
  };
  if (effect.trigger.t === 'adjacent') {
    // REQ-0023: conn -> ports ({tiles,tag}). tag reuses this entry's own
    // trigger tag so a hypothetical future tool_validate.cjs schema check
    // (see file header -- tool_validate.cjs does not exist yet) would see
    // a self-consistent port whose tag matches what the effect claims to
    // react to.
    entry.ports = [{ tiles: [[0, 0]], tag: effect.trigger.tag }]; // required: non-empty subset of shape cells
  }
  poEntries.push(entry);
}

// ---- also cover every trigger at least once (some triggers aren't hit by the verb loop) ----
// on_hit, on_bp_damaged, battle_start need at least one PO example; host_on_hit needs an SI example.
const extraPO = [
  {
    id: 'selftest_trig_on_hit', name: 'Selftest trig on_hit', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_on_hit', sockets: [],
    effects: [{ trigger: { t: 'OnHit' }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_trig_bp_damaged', name: 'Selftest trig bp_damaged', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_bp_damaged', sockets: [],
    effects: [{ trigger: { t: 'OnBPBeenHit' }, verb: { t: 'block', n: [2, 4] } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_trig_battle_start', name: 'Selftest trig battle_start', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_battle_start', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'block', n: [8, 12] } }],
    modes: ['battle'],
  },
  // REQ-0048: linker-pulse payload trigger -- fires when a link pulse arrives at the
  // host BP (sim wiring: sim/lib/encounter.cjs firePulsePayloads). The fixture only
  // proves build+render+range legality, which is what "trigger covered" means here.
  {
    id: 'selftest_trig_on_link_pulse', name: 'Selftest trig on_link_pulse', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_on_link_pulse', sockets: [],
    effects: [{ trigger: { t: 'on_link_pulse' }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['battle'],
  },
  // REQ-0081: cover the remaining REQ-0078 reactive-trigger taxonomy entries so the
  // self-test exercises ALL vocab.triggers (see the coverage assertion at the summary).
  // eff_render.cjs already renders these (REQ-0078 wired the prefixes); vocab
  // trigger_domains lists PO for each, so a PO fixture is schema-legal. Their engine
  // wiring is Phase-2/REQ-0079 work -- the self-test only builds + renders + range-checks
  // fixtures, which is exactly what "trigger covered" means here.
  {
    id: 'selftest_trig_bp_hierarchy_hit', name: 'Selftest trig OnBPHierarchyHit', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_bp_hierarchy_hit', sockets: [],
    effects: [{ trigger: { t: 'OnBPHierarchyHit' }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_trig_squad_hit', name: 'Selftest trig OnSquadHit', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_squad_hit', sockets: [],
    effects: [{ trigger: { t: 'OnSquadHit' }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_trig_squad_been_hit', name: 'Selftest trig OnSquadBeenHit', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_squad_been_hit', sockets: [],
    effects: [{ trigger: { t: 'OnSquadBeenHit' }, verb: { t: 'block', n: [2, 4] } }],
    modes: ['battle'],
  },
  // REQ-0093: status_kind-form fixtures -- one polarity keyword (debuff)
  // + one mechanical keyword (dot, the one non-singleton bucket) for each
  // of status_immune / bonus_vs_status, per this REQ's own test-coverage note.
  {
    id: 'selftest_status_immune_kind_debuff', name: 'Selftest status_immune kind debuff', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_status_immune_kind_debuff', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'status_immune', status_kind: 'debuff' } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_status_immune_kind_dot', name: 'Selftest status_immune kind dot', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_status_immune_kind_dot', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'status_immune', status_kind: 'dot' } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_bonus_vs_status_kind_debuff', name: 'Selftest bonus_vs_status kind debuff', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_bonus_vs_status_kind_debuff', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'bonus_vs_status', status_kind: 'debuff', n: [3, 5] } }],
    modes: ['battle'],
  },
  {
    id: 'selftest_bonus_vs_status_kind_dot', name: 'Selftest bonus_vs_status kind dot', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_bonus_vs_status_kind_dot', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'bonus_vs_status', status_kind: 'dot', n: [3, 5] } }],
    modes: ['battle'],
  },
];
poEntries.push(...extraPO);

// ---- REQ-0036 P1-A: probe vocab v5's new "modes" field ----
// vocab.json v5 adds a top-level closed-vocab "modes" list: ["battle",
// "detection", "unlock"] (see combat_spec_draft.md S6.1/S9). There is no
// tool_validate.cjs to actually validate against (see file header note --
// that gap is pre-existing and out of scope here), so this check is kept
// LOCAL/self-contained: it just verifies each fixture's "modes" array
// round-trips through JSON and only contains values from vocab.modes.
const modeProbeEntries = [
  {
    id: 'selftest_modes_detection', name: 'Selftest modes detection', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0]], icon: 'icon-selftest_modes_detection', sockets: [],
    effects: [{ trigger: { t: 'every_secs', s: [2, 3] }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['detection'],
  },
  {
    id: 'selftest_modes_unlock', name: 'Selftest modes unlock', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0]], icon: 'icon-selftest_modes_unlock', sockets: [],
    effects: [{ trigger: { t: 'every_secs', s: [2, 3] }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['unlock'],
  },
  {
    id: 'selftest_modes_multi', name: 'Selftest modes multi', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0]], icon: 'icon-selftest_modes_multi', sockets: [],
    effects: [{ trigger: { t: 'every_secs', s: [2, 3] }, verb: { t: 'strike', n: [2, 4] } }],
    modes: ['battle', 'detection'],
  },
];
poEntries.push(...modeProbeEntries);

log('');
log('--- modes field probe (REQ-0036 P1-A, vocab v5) ---');
const vocabModes = vocab.modes || [];
for (const entry of poEntries) {
  if (!Array.isArray(entry.modes)) {
    failures++;
    log('FAIL: ' + entry.id + ' has no modes array');
    continue;
  }
  // round-trip through JSON to prove the field survives serialization
  const roundTripped = JSON.parse(JSON.stringify(entry.modes));
  const roundTripOk = Array.isArray(roundTripped) &&
    roundTripped.length === entry.modes.length &&
    roundTripped.every((m, i) => m === entry.modes[i]);
  const valuesOk = entry.modes.length > 0 && entry.modes.every(m => vocabModes.includes(m));
  const ok = roundTripOk && valuesOk;
  log((ok ? 'OK  ' : 'FAIL') + ' ' + entry.id + '  modes: ' + JSON.stringify(entry.modes));
  if (!ok) {
    failures++;
    log('FAIL: ' + entry.id + ' modes field did not round-trip or contained a value outside vocab.modes ' + JSON.stringify(vocabModes));
  }
}

const siEntries = [
  {
    id: 'selftest_trig_host_on_hit', name: 'Selftest trig host_on_hit', slot: 'gem', reqTags: [],
    icon: 'icon-selftest_trig_host_on_hit', rarity: 'Common',
    effects: [{ trigger: { t: 'OnPOHit' }, verb: { t: 'apply_status', status: vocab.statuses[0], n: [1, 2] } }],
  },
];

// ---- 2. validate via tool_validate.cjs (shell out, same code path as real content) ----
const batchDraft = { schema: 'batch/1', batch: 'self_test_vocab', items: poEntries, sis: siEntries };
const draftPath = path.join(DIR, '_self_test_vocab_draft.json');
fs.writeFileSync(draftPath, JSON.stringify(batchDraft, null, 2));

const liveItemsPath = path.join(DIR, '..', 'content', 'live', 'live_items.json');
const liveSIsPath = path.join(DIR, '..', 'content', 'live', 'live_sis.json');
const vocabPath = path.join(DIR, '..', 'content', 'vocab.json');
const validatorPath = path.join(DIR, 'tool_validate.cjs');

// REQ-0081: in-process range validator, used when tools/tool_validate.cjs is absent (it is
// deferred to REQ-0050 -- see the header note). Enforces only the contract the two checks
// below exercise: every ranged verb param (vocab.ranged_verb_params) must be an integer
// [lo,hi] range with lo <= hi; a bare int / non-range is a violation. An entry carrying a
// truthy `_expect_reject` is a negative-test fixture that is SUPPOSED to violate -- catching
// a violation there prints PASS(expected-reject) and is NOT an error (mirrors the contract a
// real tool_validate.cjs would honor for the bare-int rejection test).
function inlineValidate(draft, vocabDef) {
  const rvp = vocabDef.ranged_verb_params || {};
  const outLines = [];
  let errors = 0;
  const squads = (draft.items || []).concat(draft.sis || []);
  for (const entry of squads) {
    const expectReject = !!entry._expect_reject;
    const violations = [];
    for (const eff of (entry.effects || [])) {
      const vt = eff.verb && eff.verb.t;
      for (const p of (rvp[vt] || [])) {
        const val = eff.verb[p];
        const isRange = Array.isArray(val) && val.length === 2 &&
          Number.isInteger(val[0]) && Number.isInteger(val[1]) && val[0] <= val[1];
        if (!isRange) {
          violations.push(entry.id + ': verb ' + vt + " param '" + p +
            "' must be an integer [lo,hi] range, got " + JSON.stringify(val));
        }
      }
    }
    if (expectReject) {
      if (violations.length > 0) {
        outLines.push('PASS(expected-reject) ' + entry.id + ': ' + violations.length +
          ' violation(s) as expected (' + entry._expect_reject + ')');
      } else {
        outLines.push('[ERROR] ' + entry.id + ': expected rejection but validated clean');
        errors++;
      }
    } else if (violations.length > 0) {
      for (const v of violations) outLines.push('[ERROR] ' + v);
      errors += violations.length;
    } else {
      outLines.push('PASS ' + entry.id);
    }
  }
  return { exit: errors > 0 ? 1 : 0, out: outLines.join('\n') + '\n' };
}

// Prefer the real content validator once REQ-0050 builds it; otherwise fall back to the
// in-process range validator. Both return { exit, out } with the shape the checks below
// expect (exit code + text scanned for [ERROR] / PASS(expected-reject)).
function runValidate(draftFilePath, draftObj) {
  if (fs.existsSync(validatorPath)) {
    try {
      return { exit: 0, out: execFileSync('node',
        [validatorPath, vocabPath, liveItemsPath, liveSIsPath, draftFilePath], { encoding: 'utf8' }) };
    } catch (e) {
      return { exit: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
    }
  }
  return inlineValidate(draftObj, vocab);
}

const { exit: validateExit, out: validateOut } = runValidate(draftPath, batchDraft);
log('--- validator output (tool_validate.cjs if present, else inline range check) ---');
log(validateOut);
log('--- validator exit code: ' + validateExit + ' ---');
if (validateExit !== 0) {
  failures++;
  log('FAIL: validator reported errors for one or more self-test entries (expected all PASS).');
}

// double check: every entry actually reports PASS (not just non-fatal exit)
const errorLineCount = (validateOut.match(/\[ERROR/g) || []).length;
if (errorLineCount > 0) {
  failures++;
  log('FAIL: validator output contains ' + errorLineCount + ' [ERROR] result line(s).');
}

// ---- 3. render every effect in both locales; check both are non-empty and distinct per verb ----
log('');
log('--- render checks (EN / JA) ---');
const allEntries = poEntries.concat(siEntries);
for (const entry of allEntries) {
  const en = renderAll(entry.effects, 'en');
  const ja = renderAll(entry.effects, 'ja');
  for (let i = 0; i < entry.effects.length; i++) {
    const enS = en[i], jaS = ja[i];
    const ok = typeof enS === 'string' && enS.length > 0 && typeof jaS === 'string' && jaS.length > 0;
    log((ok ? 'OK  ' : 'FAIL') + ' ' + entry.id + '[' + i + ']  EN: ' + enS + '   JA: ' + jaS);
    if (!ok) failures++;
    // sanity: verb literal 't' should never leak through as the whole rendered string (means unhandled case)
    const verbT = entry.effects[i].verb.t;
    if (enS === verbT || jaS === verbT) {
      failures++;
      log('FAIL: renderer fell through to default (unhandled verb) for ' + entry.id + '/' + verbT);
    }
  }
}

// also exercise render() singular API directly (not just renderAll)
const singleCheck = render({ trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [22, 38] } }, 'en');
log('');
log('single render() sanity: ' + singleCheck);
if (singleCheck !== 'Every 2s: Strike 22–38.') {
  failures++;
  log('FAIL: expected "Every 2s: Strike 22–38." got "' + singleCheck + '"');
}
const singleCheckJA = render({ trigger: { t: 'every_secs', s: [2, 2] }, verb: { t: 'strike', n: [22, 38] } }, 'ja');
log('single render() JA sanity: ' + singleCheckJA);
if (!singleCheckJA.includes('22〜38')) {
  failures++;
  log('FAIL: expected JA range "22〜38" in "' + singleCheckJA + '"');
}

// ---- 4. negative test: bare int (non-range) must be REJECTED by validator ----
const badEntry = {
  id: 'selftest_bad_bare_int', name: 'Selftest bad bare int', tags: [POTagNames[0]],
  rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_bad_bare_int', sockets: [],
  effects: [{ trigger: { t: 'every_secs', s: [2, 3] }, verb: { t: 'strike', n: 10 } }], // bare int, should fail
  _expect_reject: 'bare int n instead of [lo,hi] range must be rejected',
};
const negBatch = { schema: 'batch/1', batch: 'self_test_vocab_neg', items: [badEntry], sis: [] };
const negPath = path.join(DIR, '_self_test_vocab_neg_draft.json');
fs.writeFileSync(negPath, JSON.stringify(negBatch, null, 2));
const { exit: negExit, out: negOut } = runValidate(negPath, negBatch);
log('');
log('--- negative test (bare int rejection) exit code: ' + negExit + ' ---');
if (negExit !== 0 || !negOut.includes('PASS(expected-reject)')) {
  failures++;
  log('FAIL: bare-int range violation was not correctly rejected. Output:');
  log(negOut);
} else {
  log('OK: bare int correctly rejected by range validation.');
}

// cleanup temp files
try { fs.unlinkSync(draftPath); } catch (e) {}
try { fs.unlinkSync(draftPath.replace(/\.json$/, '.approved.json')); } catch (e) {}
try { fs.unlinkSync(negPath); } catch (e) {}
try { fs.unlinkSync(negPath.replace(/\.json$/, '.approved.json')); } catch (e) {}

// ---- REQ-0200: unit `charge` fixtures ----------------------------------------
// The charge triggers were moved into vocab.triggers by REQ-0200, so the REQ-0081
// coverage assertion below now demands a fixture for each. These are HONEST charge
// fixtures (validated by the real validateCharge, rendered by the real renderCharge),
// NOT fake PO effects -- they collectively exercise every charge trigger, all three
// spend modes, all six targets, grant_lifesteal, and the grammar's exception cases
// (bonus_vs_status status "any", fire_items.tag, multi_strike.hits range).
const chargeFixtures = [
  { trigger: { t: 'every_secs', s: [2, 3] }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'strike', n: [2, 4] }, target: 'self' }] },
  { trigger: { t: 'OnHit' }, gain: 'count', capacity: [6, 10], spend: 'passive_per_stack', effects: [{ verb: { t: 'buff_self', pct: [1, 2] }, target: 'self' }] },
  { trigger: { t: 'OnBPBeenHit' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'block', n: [8, 12] }, target: 'self' }] },
  { trigger: { t: 'on_damage_dealt' }, gain: 'damage', capacity: [80, 120], spend: 'fire_on_full', effects: [{ verb: { t: 'multi_strike', n: [15, 25], hits: [3, 4] }, target: 'self' }] },
  { trigger: { t: 'on_connected_unit_spend' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'grant_charge', n: [1, 2] }, target: 'units_connected' }] },
  { trigger: { t: 'on_connected_unit_attack' }, gain: 'count', capacity: [3, 4], spend: 'fire_on_full', effects: [{ verb: { t: 'bonus_vs_status', status: 'any', pct: [20, 30] }, target: 'units_connected' }] },
  { trigger: { t: 'on_connected_unit_bp_been_hit' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'grant_shield', n: [10, 15] }, target: 'bp_connected' }, { verb: { t: 'heal_bp', n: [5, 8] }, target: 'bp_connected' }] },
  { trigger: { t: 'on_own_passive_fire' }, gain: 'count', capacity: [1, 2], spend: 'fire_on_full', effects: [{ verb: { t: 'heal_bp', n: [3, 5] }, target: 'units_connected_distributed' }] },
  { trigger: { t: 'on_heal_done' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'grant_shield', n: [8, 12] }, target: 'bp_connected_lowest_hp' }] },
  { trigger: { t: 'on_status_applied' }, gain: 'count', capacity: [3, 4], spend: 'fire_on_full', effects: [{ verb: { t: 'amp_status', status: 'Poison', n: [1, 2] }, target: 'units_connected' }] },
  { trigger: { t: 'on_kill' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'haste', n: [2, 3] }, target: 'self' }, { verb: { t: 'buff_self', pct: [8, 12] }, target: 'self' }] },
  // spend=transform (no units003 kit uses it; the grammar demands expressibility) + transform_to
  { trigger: { t: 'every_secs', s: [4, 6] }, gain: 'count', capacity: [2, 3], spend: 'transform', transform_to: 'selftest_form2' },
  // fire_items.tag filter + advance_cooldown -> max-cooldown target + grant_lifesteal(pct,dur_s)
  { trigger: { t: 'on_damage_dealt' }, gain: 'damage', capacity: [40, 60], spend: 'fire_on_full', effects: [{ verb: { t: 'fire_items', tag: 'Weapon' }, target: 'self' }, { verb: { t: 'advance_cooldown', n: [2, 3] }, target: 'bp_connected_max_cooldown_item' }, { verb: { t: 'grant_lifesteal', pct: [15, 25], dur_s: [4, 6] }, target: 'units_connected' }] },
  // REQ-0212: the three new charge-effect verbs. charge_strike is fire_on_full-ONLY (validateCharge
  // rejects other spends -- covered by server/tests/content_checks_unit_deep_test.cjs and the sim
  // rejection test); all three carry n and aim -> self (the host BP is the SOURCE into the enemy).
  { trigger: { t: 'OnBPBeenHit' }, gain: 'count', capacity: [10, 15], spend: 'fire_on_full', effects: [{ verb: { t: 'charge_strike', n: [4, 6] }, target: 'self' }] },
  { trigger: { t: 'on_status_applied' }, gain: 'count', capacity: [2, 3], spend: 'fire_on_full', effects: [{ verb: { t: 'transfer_status', n: [1, 2] }, target: 'self' }] },
  { trigger: { t: 'on_connected_unit_attack' }, gain: 'count', capacity: [3, 4], spend: 'fire_on_full', effects: [{ verb: { t: 'shield_break', n: [10, 15] }, target: 'self' }] },
];
const chargeTriggersCovered = new Set();
log('');
log('--- REQ-0200 charge fixtures (validateCharge + renderCharge) ---');
for (let ci = 0; ci < chargeFixtures.length; ci++) {
  const cf = chargeFixtures[ci];
  let vok = true, vmsg = '';
  try { validateCharge(cf, vocab, 'chargefix[' + ci + ']'); }
  catch (e) { vok = false; vmsg = e.message; }
  const en = renderCharge(cf, 'en');
  const ja = renderCharge(cf, 'ja');
  const rok = typeof en === 'string' && en.length > 0 && typeof ja === 'string' && ja.length > 0;
  const ok = vok && rok;
  log((ok ? 'OK  ' : 'FAIL') + ' chargefix[' + ci + '] ' + cf.trigger.t + '/' + cf.spend +
    (vok ? '' : '  VALIDATE: ' + vmsg));
  if (!ok) { failures++; if (!vok) log('  validateCharge threw: ' + vmsg); }
  chargeTriggersCovered.add(cf.trigger.t);
}
// coverage cross-checks: every charge target + spend mode is exercised by a fixture.
{
  const tSeen = new Set(), sSeen = new Set();
  for (const cf of chargeFixtures) { sSeen.add(cf.spend); for (const e of (cf.effects || [])) tSeen.add(e.target); }
  const allTargets = Object.keys((vocab.charge && vocab.charge.targets) || {});
  const allSpends = Object.keys((vocab.charge && vocab.charge.spend) || {});
  const missT = allTargets.filter(t => !tSeen.has(t));
  const missS = allSpends.filter(x => !sSeen.has(x));
  if (missT.length) { failures++; log('FAIL: charge fixtures miss targets: ' + JSON.stringify(missT)); }
  if (missS.length) { failures++; log('FAIL: charge fixtures miss spend modes: ' + JSON.stringify(missS)); }
  log('charge targets exercised ' + tSeen.size + '/' + allTargets.length + ', spend modes ' + sSeen.size + '/' + allSpends.length);
}

// ---- REQ-0081: assert FULL trigger coverage (was an informational "N of 10" print) ----
// Every trigger declared in vocab.triggers must be exercised by at least one fixture that
// also passed the render + range checks above. This makes coverage a hard gate: if a future
// vocab change adds a trigger with no self-test fixture, this fails instead of silently
// under-reporting.
const coveredTriggers = new Set(
  poEntries.concat(siEntries).flatMap(e => e.effects.map(f => f.trigger.t)));
for (const t of chargeTriggersCovered) coveredTriggers.add(t); // REQ-0200 charge fixtures
const uncoveredTriggers = (vocab.triggers || []).filter(t => !coveredTriggers.has(t));
log('');
log('--- trigger coverage (REQ-0081) ---');
log('covered ' + coveredTriggers.size + ' of ' + (vocab.triggers || []).length +
  ' vocab.triggers: ' + JSON.stringify([...coveredTriggers].sort()));
if (uncoveredTriggers.length > 0) {
  failures++;
  log('FAIL: vocab.triggers not exercised by any fixture: ' + JSON.stringify(uncoveredTriggers));
}

// ---- summary ----
console.log(lines.join('\n'));
console.log('');
console.log('=== self_test_vocab.cjs summary ===');
console.log('verbs covered: ' + vocab.verbs.length + ' / triggers covered (incl. extras + charge): ' +
  coveredTriggers.size + ' of ' + vocab.triggers.length);
console.log('failures: ' + failures);
if (failures === 0) {
  console.log('ALL GREEN');
  process.exit(0);
} else {
  console.log('SELF-TEST FAILED');
  process.exit(1);
}
