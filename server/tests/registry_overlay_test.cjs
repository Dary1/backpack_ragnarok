'use strict';
// server/tests/registry_overlay_test.cjs -- REQ-0348. The ONE registry snapshot.
//
// DB-FREE by construction: storage.resolveAdoptedContentData is stubbed, so this
// file pins the SNAPSHOT RULES rather than today's registry contents, and needs
// neither DATABASE_URL nor a pg round trip. STORAGE_BACKEND is set to 'pg'
// in-process because the snapshot builder is pg-only by design and returns an
// empty registry otherwise (services/core.cjs computeRegistryData) -- it is read
// per call, so setting it here is enough and nothing else in the process cares.
//
// Two failure modes are pinned, and both are things that ALREADY went wrong once:
//
//   (A) PER-KIND ISOLATION ON BOTH PATHS. REQ-0211 was filed because a content
//       kind whose pg enum value was not yet migrated made
//       resolveAdoptedContentData throw `invalid input value for enum
//       content_kind`, which rejected the whole snapshot promise and blanked
//       EVERY kind's overlay -- the roll and the sim silently degraded all
//       content to file-served. The fix (a per-kind try/catch) was applied to
//       services/core.cjs and NOT to the display path's own private copy in
//       lib/content.cjs, which kept awaiting five kinds in one object literal.
//       So the same outage stayed live for /api/content for another 137 REQs.
//       REQ-0348 deleted the second copy; this test is what stops a third one
//       from being written. It asserts the degradation is per-kind on the
//       AUTHORITY path and on the DISPLAY path in the same breath, because the
//       whole point is that there is no longer a "the other path" to forget.
//
//   (B) THE NAME-SET SUBSET. Each consumer asks the registry only for the names
//       its own file payload holds. core's sets are supersets of the display
//       path's today -- identical for si/tm/unit/pack, and a strict superset for
//       po_def (core's itemDefsById also carries the pilot dungeon/items.json
//       entries). That is WHY the display path can read core's snapshot at all.
//       It is not a law of nature: add a content file that only /api/content
//       loads and the display path silently loses its overlay for those names,
//       with nothing failing. This test fails loudly instead.
const assert = require('assert');

process.env.STORAGE_BACKEND = 'pg'; // must precede the requires below

const storage = require('../storage.cjs');
const core = require('../services/core.cjs');
const content = require('../lib/content.cjs');

let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('PASS ', name))
    .catch((e) => { failed++; console.error('FAIL ', name, '-', e && e.message); });
}

// ---------------------------------------------------------------------------
// stub: record every (kind, names) ask, answer with a marker adoption for the
// first requested name, and throw for whichever kind the current case names.
// ---------------------------------------------------------------------------
const realResolve = storage.resolveAdoptedContentData;
let asked = [];
let throwFor = null;
function installStub() {
  asked = [];
  storage.resolveAdoptedContentData = async function (kind, names) {
    asked.push({ kind, names: names.slice() });
    if (kind === throwFor) {
      // The exact shape REQ-0211 hit: pg rejects the enum value for a kind whose
      // migration has not been deployed to this database yet.
      throw new Error('invalid input value for enum content_kind: "' + kind + '"');
    }
    if (!names.length) return {};
    return { [names[0]]: { id: names[0], __adopted_marker: kind } };
  };
}
function restoreStub() { storage.resolveAdoptedContentData = realResolve; }

const DISPLAY_KINDS = ['po_def', 'si_def', 'tm_def', 'unit_def', 'gacha_pack'];

(async function run() {
  // -------------------------------------------------------------------------
  // (A) one throwing kind degrades ONLY itself -- authority path
  // -------------------------------------------------------------------------
  await check('REQ-0211/REQ-0348: a kind that throws degrades ALONE in the shared snapshot', async () => {
    installStub();
    throwFor = 'si_def'; // deliberately one of the DISPLAY path's own five
    await core.refreshRegistryData();
    const snap = core.getRegistrySnapshot();

    assert.deepStrictEqual(snap.si_def, {}, 'the throwing kind degrades to file-served (empty)');
    const survivors = Object.keys(snap).filter((k) => k !== 'si_def' && Object.keys(snap[k]).length > 0);
    assert.ok(survivors.length >= 3,
      'every OTHER kind keeps its adoptions; got survivors=' + JSON.stringify(survivors));
    assert.ok(Object.keys(snap.po_def).length > 0, 'po_def specifically survived a si_def failure');
  });

  // -------------------------------------------------------------------------
  // (A') the same failure, observed through the DISPLAY path. This is the
  // assertion that did not exist before REQ-0348, and the one that would have
  // caught the un-migrated REQ-0211 fix.
  // -------------------------------------------------------------------------
  await check('REQ-0348: the display path sees the SAME per-kind degradation, not a blanket blank', async () => {
    installStub();
    throwFor = 'si_def';
    await content.refreshRegistryData(); // the exact call routes/content.cjs awaits
    const s = content.getContentSources();

    assert.strictEqual(s.sis.registry, 0, 'the throwing kind falls back to file for the display payload');
    assert.ok(s.items.registry > 0,
      'items KEEP their registry overlay despite si_def throwing -- pre-REQ-0348 this was 0 ' +
      '(one rejected await blanked all five sections)');
  });

  await check('REQ-0348: display and authority read ONE snapshot -- same object identity', async () => {
    installStub();
    throwFor = null;
    await core.refreshRegistryData();
    // getContentSources() resolves through lib/content.cjs's coreRegistrySnapshot(),
    // so a non-zero count here can only come from core's snapshot: there is no
    // second one left to disagree with it.
    const s = content.getContentSources();
    const sched = core.getScheduleSources();
    assert.ok(s.items.registry > 0, 'display path overlays from the shared snapshot');
    assert.ok(sched.itemDefsById.registry > 0, 'authority path overlays from the shared snapshot');
  });

  await check('REQ-0348: a registry holding ONLY non-display kinds leaves /api/content byte-identical', async () => {
    installStub();
    throwFor = null;
    // Answer adoptions for the authority-only kinds and nothing for the five the
    // display path overlays: registryIsEmpty() must still short-circuit, or the
    // files-backend e2e fleet stops being a no-regression baseline.
    storage.resolveAdoptedContentData = async function (kind, names) {
      if (DISPLAY_KINDS.indexOf(kind) !== -1 || !names.length) return {};
      return { [names[0]]: { id: names[0], __adopted_marker: kind } };
    };
    await content.refreshRegistryData();
    const filePayload = content.buildContentPayload();
    const served = content.getContent();
    for (const section of ['items', 'sis', 'tms', 'units', 'packs']) {
      assert.deepStrictEqual(served[section], filePayload[section],
        section + ' must be byte-identical to the file payload when no display kind is adopted');
    }
  });

  // -------------------------------------------------------------------------
  // (B) the name-set subset that makes sharing the snapshot legal at all
  // -------------------------------------------------------------------------
  await check('REQ-0348: every name the display path needs is a name the shared snapshot asked for', async () => {
    installStub();
    throwFor = null;
    await core.refreshRegistryData();
    const askedByKind = {};
    for (const a of asked) askedByKind[a.kind] = new Set(a.names);

    const fp = content.buildContentPayload();
    const SECTION_BY_KIND = { po_def: 'items', si_def: 'sis', tm_def: 'tms', unit_def: 'units', gacha_pack: 'packs' };
    for (const kind of DISPLAY_KINDS) {
      const wanted = Object.keys(fp[SECTION_BY_KIND[kind]] || {});
      const got = askedByKind[kind];
      assert.ok(got, 'the shared snapshot asks for kind ' + kind + ' at all');
      const missing = wanted.filter((n) => !got.has(n));
      assert.deepStrictEqual(missing, [],
        'display section "' + SECTION_BY_KIND[kind] + '" has names the shared snapshot never requests: ' +
        JSON.stringify(missing.slice(0, 8)) + '. Adding a content file that only /api/content loads ' +
        'silently drops the overlay for those names -- either feed it to services/core.cjs too, or give ' +
        'the display path back a snapshot of its own (and re-derive REQ-0348 before you do).');
    }
  });

  // -------------------------------------------------------------------------
  // (C) REQ-0352: the monster_pack MERGE overlay. The one kind whose served
  // entry has TWO writers: the registry (authored members/name/i18n/note) and
  // autobalance (derived powerLevel, file-side only). A whole-entry replace
  // passes every other case in this file and still zeroes level scaling for
  // every pack -- this case is what fails instead.
  // -------------------------------------------------------------------------
  await check('REQ-0352: a served monster_pack keeps the registry members AND the derived powerLevel', async () => {
    installStub();
    throwFor = null;
    const packId = 'pack_frost_scouts'; // live file entry with a calibrated powerLevel
    storage.resolveAdoptedContentData = async function (kind, names) {
      if (kind !== 'monster_pack' || names.indexOf(packId) === -1) return {};
      // An adopted variant per the section-5 ruling: authored fields only.
      return { [packId]: { id: packId, name: 'Frost Scouts (registry)', members: [{ enemy: 'frost_gnoll', at: 'B2' }] } };
    };
    await core.refreshRegistryData();
    const served = core.getScheduleContent();
    const entry = served.monsterPackDefsById[packId];
    assert.ok(entry, packId + ' is served at all');
    assert.strictEqual(entry.name, 'Frost Scouts (registry)', 'authored half: the registry name wins');
    assert.strictEqual(entry.members.length, 1, 'authored half: the registry members win (file has 16)');
    assert.ok(Number.isFinite(entry.powerLevel),
      'derived half: powerLevel rides through from the file entry -- a whole-entry replace deletes it');
    const { effLevelForPack } = require('../../sim/lib/level_scale.cjs');
    assert.notStrictEqual(effLevelForPack(entry.powerLevel + 3, entry.powerLevel, false), 0,
      'effLevelForPack is non-zero for the served entry -- the REQ-0352 section 5.3 failure mode, pinned');
  });

  // -------------------------------------------------------------------------
  // (D) REQ-0351: the mutation-side invalidation runs the recompute ONCE.
  // Before REQ-0348 routes/content.cjs's invalidateServedContent() awaited two
  // DIFFERENT snapshot builders; after it, both names resolved to the same
  // recompute, so the old Promise.all fired the identical recompute twice
  // concurrently -- two asks per kind per mutation. This pins the collapse:
  // one invalidateServedContent() -> exactly one registry ask per kind.
  // -------------------------------------------------------------------------
  await check('REQ-0351: ONE invalidateServedContent() asks the registry exactly ONCE per kind', async () => {
    installStub();
    throwFor = null;
    const { _invalidateServedContent } = require('../routes/content.cjs');
    asked = []; // count only what THIS invalidation triggers
    await _invalidateServedContent();
    const counts = {};
    for (const a of asked) counts[a.kind] = (counts[a.kind] || 0) + 1;
    const kinds = Object.keys(counts);
    assert.ok(kinds.length >= DISPLAY_KINDS.length,
      'the recompute still asks for every kind; got ' + JSON.stringify(kinds));
    const dupes = kinds.filter((k) => counts[k] !== 1);
    assert.deepStrictEqual(dupes, [],
      'kinds asked more than once per invalidation: ' +
      JSON.stringify(dupes.map((k) => k + ' x' + counts[k])) +
      ' -- the pre-REQ-0351 duplicate recompute is back');
  });

  restoreStub();
  console.log('');
  console.log('registry_overlay_test: ' + (failed ? failed + ' FAILED' : 'all green'));
  process.exit(failed ? 1 : 0);
})();
