// backpack_ragnarok -- server/tests/schedule_serving_test.cjs
// REQ-0176 (REQ-0178 Phase-1b) gate: registry-first serving on the AUTHORITY
// path. REQ-0178 proved it for lib/content.cjs (/api/content -- what the player
// SEES). This proves it at the services/core.cjs chokepoint -- what the game
// actually DOES: the gacha roll, the run simulation, market, warehouse.
//
// Covers, per the REQ:
//   - EMPTY registry -> getScheduleContent() returns the file payload OBJECT
//     UNCHANGED (identity, not just deep-equality: the files-backend
//     no-regression contract is that the loader is untouched);
//   - an ADOPTED variant beats the file entry, per kind (7 kinds);
//   - the HEADLINE: adopting a gacha_pack changes what resolvePack() rolls --
//     the exact harm REQ-0176 was raised for ("retune the pool, adopt, and the
//     Workshop keeps rolling the old odds");
//   - skill_def RESHAPE: mechanics-only in skillDefsById (REQ-0057) AND names in
//     skillNamesById -- the one non-verbatim kind, where a bad overlay silently
//     changes combat;
//   - po_def PRECEDENCE: the registry overlays on top of the pilot/starter
//     file overlays (incl. the lockpick/spyglass duplicate-id pair);
//   - FALLBACK when there is no def / no adopted variant;
//   - the KIND filter (a name adopted under another kind must not leak);
//   - INVALIDATION: one refreshRegistryData() and the next roll/sim sees it;
//   - ACCOUNTING (getScheduleSources) counts.
// Postgres-backed: SKIPPED cleanly when DATABASE_URL is unset.
//
// Rig note (differs from content_serving_test.cjs, and it matters): this module
// resolves its DUNGEON paths through sim/dungen.cjs liveDungeonDir(), which is
// anchored on os.homedir() -- NOT on CONTENT_ROOT (see dungen.cjs's header: the
// os.homedir() anchoring is deliberate so a faked home repoints the whole tree).
// So faking homedir for namespace isolation ALSO moves the dungeon corpus, and a
// bare mkdtemp home leaves enemies/skills unreadable. We therefore SYMLINK the
// temp home at the real worktree: NAMESPACE hashes the homedir STRING (unique per
// run -> isolated registry rows), while every path RESOLVES through the symlink to
// the real corpus. Both halves of the rig hold at once.
// homedir must be faked BEFORE requiring core.cjs -- it computes LIVE_DUNGEON_DIR
// at require time.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP schedule_serving_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

const REPO = path.join(__dirname, '..', '..');
process.env.CONTENT_ROOT = path.join(REPO, 'content'); // real corpus for the file tier

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-schedule-serving-test-'));
fs.symlinkSync(REPO, path.join(tmpHome, 'backpack_ragnarok'), 'dir'); // see the rig note above
os.homedir = () => tmpHome; // isolated registry namespace (hash of $HOME/backpack_ragnarok)

const storage = require('../storage.cjs');
const core = require('../services/core.cjs');
const gacha = require('../services/gacha.cjs');

const rd = (...p) => JSON.parse(fs.readFileSync(path.join(REPO, 'content', ...p), 'utf8'));
const liveUnits = rd('live', 'live_units.json');
const livePacks = rd('live', 'live_packs.json');
const enemies = rd('live', 'dungeon', 'enemies.json');
const skills = rd('live', 'dungeon', 'skills.json');
const liveItems = rd('live', 'live_items.json');

const UNIT = liveUnits.entries[0];
const PACK = livePacks.entries.find((e) => (e.pool || []).length > 1) || livePacks.entries[0];
const MON = enemies.entries[0];
const SKILL = skills.entries[0];
const PO = liveItems.entries[0];

function prov(i) { return { source: 'llm', model: 'claude-opus-4.8', model_version: '2026-01', prompt: 'schedule serving ' + i, params: { variation: i }, seed_if_any: null }; }

// adopt(data) under `kind` for `name`: create def if needed, add a variant, adopt it.
async function adopt(name, kind, schema_ref, data, i) {
  let def = await storage.getContentDefByName(name);
  if (!def) def = await storage.createContentDef({ system_name: name, kind, brief: 'REQ-0176 serving test', schema_ref });
  const v = await storage.createVariant(def.id, { data, provenance: prov(i) });
  await storage.adoptVariant(name, v.variant_no);
  await core.refreshRegistryData(); // the exact call routes/content.cjs awaits
  return def;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = 0, fail = 0;
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); fail++; } }

async function main() {
  await storage.clearAllContent();

  // ---- baseline: empty registry -> the loader is literally untouched ----
  await AT('empty registry: getScheduleContent() returns the file payload object UNCHANGED (identity)', async () => {
    await core.refreshRegistryData();
    const a = core.getScheduleContent();
    const b = core.getScheduleContent();
    assert.strictEqual(a, b, 'same object across calls (mtime cache intact, no overlay rebuild)');
    assert.ok(a.unitDefsById[UNIT.id], 'file tier populated');
    assert.deepStrictEqual(a.unitDefsById[UNIT.id], UNIT, 'unit served from file verbatim');
  });

  await AT('empty registry: accounting reports every map as file fallback', async () => {
    const s = core.getScheduleSources();
    assert.strictEqual(s.backend, 'pg');
    assert.strictEqual(s.unitDefsById.registry, 0, 'no registry units yet');
    assert.ok(s.unitDefsById.fallback_file > 0, 'units fall back to file');
    assert.ok(s.packDefsById.file_only_names.includes(PACK.id), 'pack listed as file-only');
  });

  // ---- unit_def ----
  await AT('unit_def: adopted variant beats the file entry', async () => {
    const d = clone(UNIT); d.name = UNIT.name + ' [REGISTRY]'; d._req0176 = 'unit';
    await adopt(UNIT.id, 'unit_def', 'unit/1', d, 1);
    const u = core.getScheduleContent().unitDefsById[UNIT.id];
    assert.strictEqual(u.name, UNIT.name + ' [REGISTRY]', 'registry unit served');
    assert.strictEqual(u._req0176, 'unit', 'registry-only field served verbatim');
  });

  // ---- gacha_pack: THE HEADLINE ----
  await AT('gacha_pack: adopting a retuned pool changes what resolvePack() ROLLS (the REQ-0176 harm)', async () => {
    const filePack = core.getScheduleContent().packDefsById[PACK.id];
    const fileFirstWeight = filePack.pool[0].weight;

    const d = clone(PACK);
    d.pool = d.pool.map((row, i) => Object.assign({}, row, { weight: i === 0 ? 999 : 1 }));
    d.cost = (PACK.cost || 0) + 7;
    await adopt(PACK.id, 'gacha_pack', 'gacha_pack/1', d, 2);

    const rolled = gacha.resolvePack(PACK.id); // the AUTHORITATIVE roll path
    assert.strictEqual(rolled.pool[0].weight, 999, 'the roll sees the retuned weight');
    assert.notStrictEqual(rolled.pool[0].weight, fileFirstWeight, 'and it is NOT the old file weight');
    assert.strictEqual(rolled.cost, (PACK.cost || 0) + 7, 'the roll sees the retuned cost');
  });

  // ---- monster_def ----
  await AT('monster_def: adopted variant beats the file entry (dungeon path)', async () => {
    const d = clone(MON); d._req0176 = 'monster'; d.hp = (MON.hp || 10) + 123;
    await adopt(MON.id, 'monster_def', 'monster/1', d, 3);
    const m = core.getScheduleContent().enemyDefsById[MON.id];
    assert.strictEqual(m.hp, (MON.hp || 10) + 123, 'registry monster served');
    assert.strictEqual(m._req0176, 'monster', 'served verbatim');
  });

  // ---- skill_def: the one non-verbatim kind ----
  await AT('skill_def: registry data goes through the mechanics-only reshape (REQ-0057), no display fields leak', async () => {
    const d = clone(SKILL);
    // A marker INSIDE attack_profile (a mechanics field the reshape passes
    // through) proves the mechanics actually came FROM the adopted variant --
    // asserting only the key set would pass even with the overlay disabled,
    // since the FILE path produces the same 4-key shape. A sibling top-level
    // field proves the reshape still drops everything else.
    d.attack_profile = Object.assign({}, SKILL.attack_profile || {}, { _req0176_marker: 'reached-mechanics' });
    d.name_en = 'Registry Skill EN'; d.name_ja = 'Registry Skill JA';
    d._req0176 = 'should-not-reach-mechanics';
    await adopt(SKILL.id, 'skill_def', 'skill/1', d, 4);
    const mech = core.getScheduleContent().skillDefsById[SKILL.id];
    assert.strictEqual(mech.attack_profile._req0176_marker, 'reached-mechanics',
      'the combat fold is reading the ADOPTED variant, not the file');
    assert.deepStrictEqual(Object.keys(mech).sort(), ['attack_profile', 'modes', 'trigger', 'verb'],
      'mechanics map carries EXACTLY the 4 mechanics fields');
    assert.strictEqual(mech._req0176, undefined, 'registry-only field must NOT ride into the combat fold');
    assert.strictEqual(mech.name_en, undefined, 'display name must NOT ride into the combat fold');
  });

  await AT('skill_def: registry names reach skillNamesById in the i18n shape', async () => {
    const n = core.getScheduleContent().skillNamesById[SKILL.id];
    assert.deepStrictEqual(n, { en: { name: 'Registry Skill EN' }, ja: { name: 'Registry Skill JA' } },
      'names reshaped from flat name_en/name_ja');
  });

  // ---- po_def precedence over the pilot/starter overlays ----
  await AT('po_def: the registry overlays ON TOP of the file maps (lockpick -- the starter n dungeon duplicate id)', async () => {
    const before = core.getScheduleContent().itemDefsById['lockpick'];
    assert.ok(before, 'lockpick is a served item id (starter/dungeon overlay)');
    const d = clone(before); d.name = 'Lockpick [REGISTRY]'; d._req0176 = 'precedence';
    await adopt('lockpick', 'po_def', 'po/2', d, 5);
    const after = core.getScheduleContent().itemDefsById['lockpick'];
    assert.strictEqual(after.name, 'Lockpick [REGISTRY]', 'registry beats the starter/pilot file overlay');
    assert.strictEqual(after._req0176, 'precedence', 'served verbatim');
  });

  // ---- fallback ----
  await AT('fallback: a def with NO adopted variant leaves the file entry serving', async () => {
    const other = liveUnits.entries[1];
    const def = await storage.createContentDef({ system_name: other.id, kind: 'unit_def', brief: 'unadopted', schema_ref: 'unit/1' });
    await storage.createVariant(def.id, { data: Object.assign(clone(other), { name: 'NEVER ADOPTED' }), provenance: prov(6) });
    await core.refreshRegistryData();
    assert.deepStrictEqual(core.getScheduleContent().unitDefsById[other.id], other, 'unadopted -> file entry still served');
  });

  // ---- kind filter ----
  await AT('kind filter: a monster_def named as a unit id does not leak into unitDefsById', async () => {
    const u = liveUnits.entries[2];
    const def = await storage.createContentDef({ system_name: u.id, kind: 'monster_def', brief: 'wrong-kind', schema_ref: 'monster/1' });
    const v = await storage.createVariant(def.id, { data: { id: u.id, name: 'WRONG KIND' }, provenance: prov(7) });
    await storage.adoptVariant(u.id, v.variant_no);
    await core.refreshRegistryData();
    assert.deepStrictEqual(core.getScheduleContent().unitDefsById[u.id], u, 'unit stays file-sourced (kind mismatch)');
  });

  // ---- invalidation ----
  await AT('invalidation: one refreshRegistryData() and the next roll sees the new adoption', async () => {
    const before = gacha.resolvePack(PACK.id).cost;
    const d = clone(PACK); d.cost = (PACK.cost || 0) + 4242;
    await adopt(PACK.id, 'gacha_pack', 'gacha_pack/1', d, 8); // adopt() awaits the refresh
    const after = gacha.resolvePack(PACK.id).cost;
    assert.notStrictEqual(after, before, 'roll cost changed after re-adopt');
    assert.strictEqual(after, (PACK.cost || 0) + 4242, 'rolls the newly adopted variant');
  });

  // ---- accounting ----
  await AT('accounting: adopted entities counted as registry, absent from file_only_names', async () => {
    const s = core.getScheduleSources();
    assert.ok(s.unitDefsById.registry >= 1, 'at least one registry unit');
    assert.ok(!s.packDefsById.file_only_names.includes(PACK.id), 'adopted pack not in file_only_names');
    assert.strictEqual(s.packDefsById.registry + s.packDefsById.fallback_file,
      Object.keys(core.getScheduleContent().packDefsById).length, 'counts sum to served packs');
  });

  // ---- the display path and the authority path agree (REQ-0170 parity) ----
  await AT('REQ-0170 parity: /api/content packs and the roll serve the SAME adopted pack', async () => {
    const libContent = require('../lib/content.cjs');
    await libContent.refreshRegistryData();
    const displayed = libContent.getContent().packs[PACK.id];
    const rolled = gacha.resolvePack(PACK.id);
    assert.strictEqual(displayed.cost, rolled.cost, 'display cost == roll cost');
    assert.deepStrictEqual(displayed.pool, rolled.pool, 'display pool == roll pool');
  });

  await storage.clearAllContent();
  await storage.closeContentPool();
  console.log('\nschedule_serving_test: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });


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
