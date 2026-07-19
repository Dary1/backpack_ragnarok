'use strict';
// server/tests/skin_prefs_test.cjs -- REQ-0266. The PER-PROFILE skin selection
// store, driven through storage.cjs (THE chokepoint -- no consumer, including
// this test, requires storage/skin_prefs.cjs directly). ci.sh runs this file
// under BOTH the files backend and STORAGE_BACKEND=pg, so a green run under each
// IS the files+pg parity proof (identical public behaviour on both backends).
// Mirrors server/tests/bpskin_test.cjs's shape. Self-cleaning (unique player id
// + delete). DB-free under the files backend.
//
// What is pinned here is REQ-0266 D-B, and every clause of it is a failure mode:
//   round trip     -- a pick that does not survive a read is not a preference.
//   MERGE          -- a PUT that replaced the whole doc would silently drop every
//                     other unit the moment a client sent a one-key body.
//   null CLEARS    -- the only way back to the default; if null were ignored, a
//                     player could never undo a pick.
//   absence        -- no row / no map / no key all mean "use the default" (D5);
//                     nothing is ever backfilled.
//   unknown skin   -- rejected on write, and IGNORED on read, so a deleted or
//                     renamed skin can never blank a unit.
//   slot mismatch  -- a bpskin written into the portrait map would render nothing.
const assert = require('assert');
const storage = require('../storage.cjs');
const backend = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'files';
const pid = 'test-req0266-' + process.pid + '-' + Date.now();
const other = pid + '-other';
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok  :', name); } catch (e) { failed++; console.error('FAIL:', name, '-', e.message); } }

// A synthetic corpus, in the exact shape /api/content's unit_skins section has
// (id -> def). Injected rather than read from content/live so this test pins the
// RULES, not today's roster.
const CORPUS = {
  uskin_alpha: { id: 'uskin_alpha', name: 'Alpha Portrait', slot: 'unit', art_ref: 'art_alpha', units: ['alpha'], default: true },
  uskin_alpha_alt: { id: 'uskin_alpha_alt', name: 'Alpha Alt', slot: 'unit', art_ref: 'art_alpha_alt', units: ['alpha', 'beta'] },
  uskin_bp_alpha: { id: 'uskin_bp_alpha', name: 'Alpha Pack', slot: 'bpskin', art_ref: 'bpskin_unit_alpha', units: ['alpha'], default: true },
};

check('absence reads as {unit:{},bpskin:{}} -- a player who never picked has no row (D5)', () => {
  assert.strictEqual(storage.readSkinPrefs(pid), null, 'no doc is written by anything but a PUT');
  assert.deepStrictEqual(storage.getSkinPrefs(pid), { unit: {}, bpskin: {} });
  assert.deepStrictEqual(storage.resolveSkinPrefs(storage.readSkinPrefs(pid), CORPUS), { unit: {}, bpskin: {} },
    'resolving an absent selection is empty, never a throw');
});

check('round trip: a pick in each slot persists and reads back', () => {
  storage.mergeSkinPrefs(pid, { unit: { alpha: 'uskin_alpha' }, bpskin: { alpha: 'uskin_bp_alpha' } });
  assert.deepStrictEqual(storage.getSkinPrefs(pid), { unit: { alpha: 'uskin_alpha' }, bpskin: { alpha: 'uskin_bp_alpha' } });
  const doc = storage.readSkinPrefs(pid);
  assert.strictEqual(doc.player_id, pid, 'the doc names its owner');
  assert.ok(typeof doc.updated_at === 'string' && doc.updated_at.length >= 20, 'updated_at is an ISO stamp');
});

check('MERGE semantics: a one-key PUT touches ONLY that key -- never the whole doc', () => {
  storage.mergeSkinPrefs(pid, { unit: { beta: 'uskin_alpha_alt' } });
  assert.deepStrictEqual(storage.getSkinPrefs(pid), {
    unit: { alpha: 'uskin_alpha', beta: 'uskin_alpha_alt' },
    bpskin: { alpha: 'uskin_bp_alpha' },
  }, 'the untouched unit key AND the untouched slot map both survive');
});

check('MERGE semantics: a slot map absent from the body is untouched in full', () => {
  storage.mergeSkinPrefs(pid, { unit: { alpha: 'uskin_alpha_alt' } });
  const got = storage.getSkinPrefs(pid);
  assert.strictEqual(got.unit.alpha, 'uskin_alpha_alt', 'the supplied key is overwritten');
  assert.strictEqual(got.bpskin.alpha, 'uskin_bp_alpha', 'the omitted bpskin map is not cleared');
});

check('null CLEARS one key back to the default, and nothing else', () => {
  storage.mergeSkinPrefs(pid, { unit: { alpha: null } });
  const got = storage.getSkinPrefs(pid);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(got.unit, 'alpha'), false,
    'a cleared key is ABSENT, not null -- absence IS the default (D5), so the two must not be stored differently');
  assert.strictEqual(got.unit.beta, 'uskin_alpha_alt', 'the sibling key is untouched');
  assert.strictEqual(got.bpskin.alpha, 'uskin_bp_alpha', 'the other slot is untouched');
});

check('an UNKNOWN skin id is REJECTED on write (validateSkinPrefsPatch)', () => {
  assert.throws(() => storage.validateSkinPrefsPatch({ unit: { alpha: 'uskin_ghost' } }, CORPUS),
    /no such unit_skin "uskin_ghost"/);
});

check('a SLOT MISMATCH is REJECTED on write (a bpskin cannot go in the portrait map)', () => {
  assert.throws(() => storage.validateSkinPrefsPatch({ unit: { alpha: 'uskin_bp_alpha' } }, CORPUS),
    /has slot "bpskin", which cannot be written to the "unit" map/);
  assert.throws(() => storage.validateSkinPrefsPatch({ bpskin: { alpha: 'uskin_alpha' } }, CORPUS),
    /has slot "unit", which cannot be written to the "bpskin" map/);
});

check('a skin that does not list the unit is REJECTED (units[] is the whitelist, D3)', () => {
  assert.throws(() => storage.validateSkinPrefsPatch({ unit: { beta: 'uskin_alpha' } }, CORPUS),
    /does not list unit "beta" in its units\[\]/);
  // ...and a skin that DOES list several units is accepted for each of them.
  assert.strictEqual(storage.validateSkinPrefsPatch({ unit: { beta: 'uskin_alpha_alt' } }, CORPUS), true);
});

check('an unknown top-level map is REJECTED; null is always legal; shapes are checked', () => {
  assert.throws(() => storage.validateSkinPrefsPatch({ hat: {} }, CORPUS), /unknown field "hat"/);
  assert.throws(() => storage.validateSkinPrefsPatch({ unit: 'uskin_alpha' }, CORPUS), /unit must be an object/);
  assert.throws(() => storage.validateSkinPrefsPatch('nope', CORPUS), /body must be a JSON object/);
  assert.throws(() => storage.validateSkinPrefsPatch({ unit: { alpha: 42 } }, CORPUS), /must be a skin id string or null/);
  assert.strictEqual(storage.validateSkinPrefsPatch({ unit: { alpha: null } }, CORPUS), true, 'clearing needs no corpus lookup');
  assert.strictEqual(storage.validateSkinPrefsPatch({}, CORPUS), true, 'an empty body is a legal no-op');
});

check('an unknown/deleted skin id reads as ABSENT -- it must never blank a unit', () => {
  // Write a doc directly (as a previous release could have), then delete the skin
  // from the corpus by simply not having it there.
  storage.writeSkinPrefs(pid, { player_id: pid, unit: { alpha: 'uskin_retired' }, bpskin: { alpha: 'uskin_bp_alpha' }, updated_at: new Date().toISOString() });
  const resolved = storage.resolveSkinPrefs(storage.readSkinPrefs(pid), CORPUS);
  assert.deepStrictEqual(resolved.unit, {}, 'the retired id is dropped, so the unit falls back to its DEFAULT rather than rendering nothing');
  assert.strictEqual(resolved.bpskin.alpha, 'uskin_bp_alpha', 'the still-valid sibling pick survives');
  // A pick whose skin has been RE-SLOTTED is the same class of stale reference.
  storage.writeSkinPrefs(pid, { player_id: pid, unit: { alpha: 'uskin_bp_alpha' }, bpskin: {}, updated_at: new Date().toISOString() });
  assert.deepStrictEqual(storage.resolveSkinPrefs(storage.readSkinPrefs(pid), CORPUS).unit, {}, 'a re-slotted skin reads as absent too');
  // With NO corpus the selection is returned unfiltered -- shape-only resolution,
  // so a content read failure degrades to "trust the stored value", never to blank.
  assert.strictEqual(storage.resolveSkinPrefs(storage.readSkinPrefs(pid), null).unit.alpha, 'uskin_bp_alpha');
});

check('a malformed stored doc degrades to empty, never throws (defensive read)', () => {
  storage.writeSkinPrefs(pid, { player_id: pid, unit: 'not-a-map', bpskin: { alpha: 7 }, updated_at: 'x' });
  assert.deepStrictEqual(storage.getSkinPrefs(pid), { unit: {}, bpskin: {} });
});

check('per-player isolation: one player\'s selection is invisible to another', () => {
  storage.mergeSkinPrefs(pid, { unit: { alpha: 'uskin_alpha' } });
  assert.deepStrictEqual(storage.getSkinPrefs(other), { unit: {}, bpskin: {} });
  storage.mergeSkinPrefs(other, { unit: { alpha: 'uskin_alpha_alt' } });
  assert.strictEqual(storage.getSkinPrefs(pid).unit.alpha, 'uskin_alpha');
  assert.strictEqual(storage.getSkinPrefs(other).unit.alpha, 'uskin_alpha_alt');
});

check('deleteSkinPrefs removes the row, and absence reads as empty again', () => {
  storage.deleteSkinPrefs(pid);
  assert.strictEqual(storage.readSkinPrefs(pid), null);
  assert.deepStrictEqual(storage.getSkinPrefs(pid), { unit: {}, bpskin: {} });
});

try { storage.deleteSkinPrefs(pid); } catch (e) { /* ignore */ }
try { storage.deleteSkinPrefs(other); } catch (e) { /* ignore */ }
console.log(`\nskin_prefs_test (${backend} backend): ${failed ? failed + ' FAILED' : 'ALL GREEN'}`);
process.exit(failed ? 1 : 0);
