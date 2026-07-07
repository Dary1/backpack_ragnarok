#!/usr/bin/env node
// self_test_vocab.cjs -- builds one effect per verb in content/vocab.json, validates each
// (REQ-0022 batch 3/4: vocab.json's flat "types" array became the "po_tags" hierarchy tree;
// this file uses Object.keys(vocab.po_tags)[0] ("Weapon", the first-declared root) wherever
// it used to read vocab.types[0], and builds PO-entry fixtures with "tags" instead of
// separate "type"/"el" fields, matching the migrated content JSON schema.)
// via tool_validate.cjs (shelled out to via execFileSync), and renders every effect in both
// locales via eff_render.cjs. Exits 0 and prints "ALL GREEN" iff everything passes; exits 1
// on any failure with a diagnostic dump.
// NOTE (REQ-0022 batch 6): tool_validate.cjs does not exist anywhere in this project (it was
// never built -- see docs/terminology_alignment_plan.md S1.8). The two validator-dependent
// checks below (range-validation passthrough and the negative bare-int-rejection test) will
// report FAIL until that tool is written; every other check in this script (effect rendering
// across all verbs/triggers, EN/JA non-empty + non-fallthrough, single render() sanity) runs
// and passes standalone. This file's own require paths (content/vocab.json, live_items.json,
// live_sis.json) were fixed to point at their real locations; tool_validate.cjs was left
// unbuilt rather than guessed at, since it requires its own validation-rule design.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render, renderAll } = require('./eff_render.cjs');

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

let validateOut = '';
let validateExit = 0;
try {
  validateOut = execFileSync('node', [validatorPath, vocabPath, liveItemsPath, liveSIsPath, draftPath], { encoding: 'utf8' });
} catch (e) {
  validateExit = e.status;
  validateOut = (e.stdout || '') + (e.stderr || '');
}
log('--- tool_validate.cjs output ---');
log(validateOut);
log('--- tool_validate.cjs exit code: ' + validateExit + ' ---');
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
let negOut = '';
let negExit = 0;
try {
  negOut = execFileSync('node', [validatorPath, vocabPath, liveItemsPath, liveSIsPath, negPath], { encoding: 'utf8' });
} catch (e) {
  negExit = e.status;
  negOut = (e.stdout || '') + (e.stderr || '');
}
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

// ---- summary ----
console.log(lines.join('\n'));
console.log('');
console.log('=== self_test_vocab.cjs summary ===');
console.log('verbs covered: ' + vocab.verbs.length + ' / triggers covered (incl. extras): ' +
  new Set(poEntries.concat(siEntries).flatMap(e => e.effects.map(f => f.trigger.t))).size + ' of ' + vocab.triggers.length);
console.log('failures: ' + failures);
if (failures === 0) {
  console.log('ALL GREEN');
  process.exit(0);
} else {
  console.log('SELF-TEST FAILED');
  process.exit(1);
}
