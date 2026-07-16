#!/usr/bin/env node
'use strict';
// tools/units003_acceptance.cjs -- REQ-0200 acceptance gate.
//
// THE corpus check for the unit charge engine: every one of the 30 units003 kits
// (the REQ-0201 authoring sheet, mirrored into tools/tests/units003_kits.json) must
// validate as a live unit/1 entry against vocab v15 -- i.e. its `charge` block must
// pass validateCharge (trigger union, gain, capacity range, spend mode, per-effect
// verb+target, the "any"/po_tag/pct/hits exceptions). This is the proof that the
// grammar the vocab froze is now actually ENFORCED end-to-end.
//
// Kit -> live-entry transform (documented, not silent):
//   - `design_note` is authoring-only metadata (NOT a unit/1 field) and is dropped.
//   - `icon` is a stub 'icon-<id>' here; the real illustration-first icon is adopted
//     when REQ-0201 lands these as live content (this gate is about the AST, not art).
const fs = require('fs');
const path = require('path');
const { validateUnitEntry } = require('../shared/content_validate.cjs');

const ROOT = path.join(__dirname, '..');
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'vocab.json'), 'utf8'));
const kits = JSON.parse(fs.readFileSync(path.join(__dirname, 'tests', 'units003_kits.json'), 'utf8'));

if (vocab.version < 15) { console.error('FAIL  vocab.version must be >= 15, got ' + vocab.version); process.exit(1); }

let failures = 0;
const seen = new Set();
// Track charge coverage so the acceptance corpus is also a spec-coverage witness.
const triggersSeen = new Set(), verbsSeen = new Set(), targetsSeen = new Set(), spendsSeen = new Set(), gainsSeen = new Set();

for (const kit of kits) {
  const { design_note, ...rest } = kit;
  const entry = Object.assign({ icon: 'icon-' + kit.id }, rest);
  try {
    validateUnitEntry(entry, vocab);
  } catch (err) {
    console.error('FAIL  ' + kit.id + ': ' + err.message);
    failures++;
    continue;
  }
  if (seen.has(kit.id)) { console.error('FAIL  duplicate kit id "' + kit.id + '"'); failures++; }
  seen.add(kit.id);
  const c = kit.charge;
  if (c) {
    triggersSeen.add(c.trigger.t);
    gainsSeen.add(c.gain);
    spendsSeen.add(c.spend);
    for (const e of (c.effects || [])) { verbsSeen.add(e.verb.t); targetsSeen.add(e.target); }
  }
}

console.log('units003 acceptance: ' + seen.size + ' / ' + kits.length + ' kits validate against vocab v' + vocab.version);
console.log('charge triggers exercised: ' + [...triggersSeen].sort().join(', '));
console.log('charge verbs exercised:    ' + [...verbsSeen].sort().join(', '));
console.log('charge targets exercised:  ' + [...targetsSeen].sort().join(', '));
console.log('spend modes / gain:        ' + [...spendsSeen].sort().join(', ') + ' | ' + [...gainsSeen].sort().join(', '));
console.log('failures: ' + failures);
if (failures) process.exit(1);
console.log('ALL GREEN');
