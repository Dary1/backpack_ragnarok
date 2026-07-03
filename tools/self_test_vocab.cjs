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

  // choose a trigger appropriate to the verb; buff_adjacent pairs naturally with "adjacent"
  let trigger;
  if (verbT === 'buff_adjacent') {
    trigger = { t: 'adjacent', tagKind: 'type', tag: POTagNames[0] };
  } else if (verbT === 'buff_self_per_tag' || verbT === 'buff_host') {
    trigger = { t: 'passive' };
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
  };
  if (effect.trigger.t === 'adjacent') {
    entry.conn = [[0, 0]]; // required: non-empty subset of shape cells
  }
  poEntries.push(entry);
}

// ---- also cover every trigger at least once (some triggers aren't hit by the verb loop) ----
// on_hit, on_bp_damaged, battle_start need at least one PO example; host_on_hit needs an SI example.
const extraPO = [
  {
    id: 'selftest_trig_on_hit', name: 'Selftest trig on_hit', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_on_hit', sockets: [],
    effects: [{ trigger: { t: 'on_hit' }, verb: { t: 'strike', n: [2, 4] } }],
  },
  {
    id: 'selftest_trig_bp_damaged', name: 'Selftest trig bp_damaged', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_bp_damaged', sockets: [],
    effects: [{ trigger: { t: 'on_bp_damaged' }, verb: { t: 'block', n: [2, 4] } }],
  },
  {
    id: 'selftest_trig_battle_start', name: 'Selftest trig battle_start', tags: [POTagNames[0]],
    rarity: 'Common', shape: [[0, 0], [1, 0]], icon: 'icon-selftest_trig_battle_start', sockets: [],
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'block', n: [8, 12] } }],
  },
];
poEntries.push(...extraPO);

const siEntries = [
  {
    id: 'selftest_trig_host_on_hit', name: 'Selftest trig host_on_hit', slot: 'gem', reqTags: [],
    icon: 'icon-selftest_trig_host_on_hit', rarity: 'Common',
    effects: [{ trigger: { t: 'host_on_hit' }, verb: { t: 'apply_status', status: vocab.statuses[0], n: [1, 2] } }],
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
