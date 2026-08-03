'use strict';
// server/tests/bio_test.cjs -- REQ-0060: standalone gate for the Pack
// Biography aggregation + storage + veteran-luck curve. Runs in BOTH
// backends (files by default; the ci.sh SKIP_PG block re-runs it with
// STORAGE_BACKEND=pg) -- files+pg PARITY: the SAME assertions execute in
// both modes. os.homedir() is remapped BEFORE requiring storage so
// DATA_DIR/BIO_DIR + the pg namespace point at a throwaway sandbox (the
// same isolation trick api_test.cjs uses).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-bio-test-'));
os.homedir = () => tmpHome;

const storage = require('../storage.cjs');
const bio = require('../services/bio.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now();
  try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack : e)); fail++; }
}

let n = 0;
const backend = process.env.STORAGE_BACKEND || 'files';
function uid() { return 'bp_biotest_' + backend + '_' + (++n) + '_' + Date.now(); }

function fakeRun(result, roster, extraEvents) {
  const events = [{ ev: 'progress', enc: -1, pct: 0 }].concat(extraEvents || []);
  events.push({ ev: 'run_end', result: result });
  return { id: 'run_' + Math.random().toString(36).slice(2), result: result, bioRoster: roster, events: events };
}

// 1. storage round-trip (identical assertions files+pg)
T('bio storage round-trip', () => {
  const u = uid();
  assert.strictEqual(storage.readBio(u), null);
  storage.writeBio(u, bio.emptyBio(u));
  const back = storage.readBio(u);
  assert.ok(back);
  assert.strictEqual(back.bp_uid, u);
  assert.strictEqual(back.runsSurvived, 0);
  assert.strictEqual(back.schema_version, 1);
});

// 2. ensureBio creates once; born is immutable
T('ensureBio creates + born immutable', () => {
  const u = uid();
  const a = bio.ensureBio(u, 'gacha', 'Test Queen');
  assert.strictEqual(a.born.origin, 'gacha');
  assert.strictEqual(a.namesCarried.length, 1);
  assert.strictEqual(a.namesCarried[0].name, 'Test Queen');
  const b = bio.ensureBio(u, 'field');
  assert.strictEqual(b.born.origin, 'gacha');
});

// 3. deriveRunBioDeltas: victory + attachments + damage
T('deriveRunBioDeltas victory/traps/chests/damage', () => {
  const run = fakeRun('victory',
    [{ id: 'a', hpMax: 100, hpEnd: 70 }, { id: 'b', hpMax: 60, hpEnd: 60 }],
    [{ ev: 'att_disarm', att: 't1' }, { ev: 'att_open', kind: 'chest', att: 'c1' }, { ev: 'att_open', kind: 'door', att: 'd1' }]);
  const d = bio.deriveRunBioDeltas(run);
  assert.strictEqual(d.a.runsSurvived, 1);
  assert.strictEqual(d.a.wipesEndured, 0);
  assert.strictEqual(d.a.bossesFelled, 1);
  assert.strictEqual(d.a.trapsDisarmedAboard, 1);
  assert.strictEqual(d.a.chestsOpenedAboard, 1); // door att_open does NOT count as chest
  assert.strictEqual(d.a.damageTanked, 30);
  assert.strictEqual(d.b.damageTanked, 0);
  assert.strictEqual(d.b.bossesFelled, 1);
});

// 4. deriveRunBioDeltas: wipe
T('deriveRunBioDeltas wipe', () => {
  const run = fakeRun('wipe', [{ id: 'a', hpMax: 100, hpEnd: 0 }]);
  const d = bio.deriveRunBioDeltas(run);
  assert.strictEqual(d.a.runsSurvived, 0);
  assert.strictEqual(d.a.wipesEndured, 1);
  assert.strictEqual(d.a.bossesFelled, 0);
  assert.strictEqual(d.a.damageTanked, 100);
});

// 5. applyRunBio folds + persists + accumulates; unseen bp born=field
T('applyRunBio folds + persists + accumulates', () => {
  const ua = uid();
  bio.applyRunBio(fakeRun('victory', [{ id: ua, hpMax: 100, hpEnd: 70 }], [{ ev: 'att_disarm', att: 't1' }]));
  const a = storage.readBio(ua);
  assert.strictEqual(a.runsSurvived, 1);
  assert.strictEqual(a.bossesFelled, 1);
  assert.strictEqual(a.trapsDisarmedAboard, 1);
  assert.strictEqual(a.damageTanked, 30);
  assert.strictEqual(a.born.origin, 'field');
  bio.applyRunBio(fakeRun('wipe', [{ id: ua, hpMax: 100, hpEnd: 0 }]));
  const a2 = storage.readBio(ua);
  assert.strictEqual(a2.runsSurvived, 1);
  assert.strictEqual(a2.wipesEndured, 1);
  assert.strictEqual(a2.damageTanked, 130);
});

// 6. rename history append-only (kept, never overwritten)
T('recordRename appends (append-only history)', () => {
  const u = uid();
  bio.ensureBio(u, 'gacha', 'Original');
  bio.recordRename(u, 'Renamed One');
  bio.recordRename(u, 'Renamed Two');
  const doc = storage.readBio(u);
  assert.deepStrictEqual(doc.namesCarried.map((x) => x.name), ['Original', 'Renamed One', 'Renamed Two']);
});

// 7. recordTmOp seat
T('recordTmOp accrues weathervane/chisel seats', () => {
  const u = uid();
  bio.recordTmOp(u, { weathervaneRerolls: 2, chiselCellsAdded: 1, chiselCellsFiled: 3 });
  bio.recordTmOp(u, { weathervaneRerolls: 1 });
  const doc = storage.readBio(u);
  assert.strictEqual(doc.weathervaneRerolls, 3);
  assert.strictEqual(doc.chiselCellsAdded, 1);
  assert.strictEqual(doc.chiselCellsFiled, 3);
});

// 8. veteran luck curve + cap (monotonic, bounded)
T('bioLuck curve + cap', () => {
  assert.strictEqual(bio.bioLuck(bio.emptyBio('x')), 0);
  assert.ok(Math.abs(bio.bioLuck(Object.assign(bio.emptyBio('x'), { runsSurvived: 10 })) - 0.02) < 1e-9);
  assert.ok(Math.abs(bio.bioLuck(Object.assign(bio.emptyBio('x'), { runsSurvived: 50 })) - 0.04) < 1e-9);
  // 0.02*3 (runs) + 0.02*2 (boss) + 0.02 (wipe) = 0.12 -> capped 0.10
  const vet = Object.assign(bio.emptyBio('x'), { runsSurvived: 200, bossesFelled: 25, wipesEndured: 20 });
  assert.ok(Math.abs(bio.bioLuck(vet) - 0.10) < 1e-9);
});

// 9. per-TM opt-in gate + clamp
T('tmSuccessChance gate + clamp', () => {
  const vet = Object.assign(bio.emptyBio('x'), { runsSurvived: 10 }); // luck 0.02
  assert.strictEqual(bio.tmSuccessChance(0.5, vet, { id: 'weathervane' }), 0.5);
  assert.strictEqual(bio.tmSuccessChance(0.5, vet, { respects_bio_luck: false }), 0.5);
  assert.ok(Math.abs(bio.tmSuccessChance(0.5, vet, { respects_bio_luck: true }) - 0.52) < 1e-9);
  const maxVet = Object.assign(bio.emptyBio('x'), { runsSurvived: 200, bossesFelled: 25, wipesEndured: 20 });
  assert.strictEqual(bio.tmSuccessChance(0.99, maxVet, { respects_bio_luck: true }), 1);
});

// 10. age helper
T('bioAgeDays', () => {
  const b = bio.emptyBio('x');
  b.born.date = new Date(Date.now() - 3 * 86400000).toISOString();
  assert.strictEqual(bio.bioAgeDays(b), 3);
});

console.log('---');
console.log('bio_test (' + backend + '): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
