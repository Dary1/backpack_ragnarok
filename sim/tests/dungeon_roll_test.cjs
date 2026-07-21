'use strict';
// sim/tests/dungeon_roll_test.cjs -- REQ-0185: the dive ROLLER determinism +
// structural invariants. rollDungeon(def, level, seed) must be BYTE-IDENTICAL
// for the same (def, level, seed) triple (the replay/seal contract, Open Q3),
// and must emit exactly the concrete shape combat.runDungeon() consumes:
// `nPacks` pack encounters + one final boss, gimic attachments capped 2/encounter,
// every pool reference resolving. DB-free: reads the live corpus relative to the
// repo (no os.homedir()/HOME fakery needed -- the roller takes plain defs).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const roller = require('../dungeon_roll.cjs');

const LIVE = path.join(__dirname, '..', '..', 'content', 'live', 'dungeon');
const dungeons = JSON.parse(fs.readFileSync(path.join(LIVE, 'dungeons.json'), 'utf8'));
const gimicsDoc = JSON.parse(fs.readFileSync(path.join(LIVE, 'gimics.json'), 'utf8'));
const packsDoc = JSON.parse(fs.readFileSync(path.join(LIVE, 'packs.json'), 'utf8'));
const gimicDefsById = {};
for (const g of (gimicsDoc.entries || [])) gimicDefsById[g.id] = g;
const packIds = new Set((packsDoc.entries || []).map((p) => p.id));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; }
}

console.log('== REQ-0185 dungeon roller determinism + structure ==');

T('determinism: the SAME (def, level, seed) triple is byte-identical, across every def + a level ladder', () => {
  for (const def of dungeons.entries) {
    for (const level of [1, def.levelMin, Math.round((def.levelMin + def.levelMax) / 2), def.levelMax, 99]) {
      const a = roller.rollDungeon(def, level, 'det-seed-' + def.id + '-' + level, { gimicDefsById });
      const b = roller.rollDungeon(def, level, 'det-seed-' + def.id + '-' + level, { gimicDefsById });
      assert.strictEqual(JSON.stringify(a), JSON.stringify(b), def.id + ' L' + level + ' must be byte-identical');
    }
  }
});

T('structure: nPacks matches packEncountersForLevel; exactly one boss, pinned LAST; every pack ref resolves', () => {
  for (const def of dungeons.entries) {
    for (const level of [def.levelMin, def.levelMax]) {
      const rolled = roller.rollDungeon(def, level, 's-' + level, { gimicDefsById });
      const packs = rolled.encounters.filter((e) => e.type === 'pack');
      const bosses = rolled.encounters.filter((e) => e.type === 'boss');
      assert.strictEqual(packs.length, roller.packEncountersForLevel(def, level), def.id + ' L' + level + ' pack count');
      assert.strictEqual(bosses.length, 1, def.id + ' exactly one boss');
      assert.strictEqual(rolled.encounters[rolled.encounters.length - 1].type, 'boss', def.id + ' boss is last');
      for (const e of rolled.encounters) {
        assert.ok(packIds.has(e.enemyPack.packId), def.id + ' pack ref resolves: ' + e.enemyPack.packId);
      }
    }
  }
});

T('structure: gimic attachments are capped at 2 per encounter and every attachment kind is trap/chest/door', () => {
  for (const def of dungeons.entries) {
    const rolled = roller.rollDungeon(def, def.levelMax, 'g-seed', { gimicDefsById });
    for (const e of rolled.encounters) {
      const atts = e.attachments || [];
      assert.ok(atts.length <= 2, def.id + ' <=2 attachments/encounter');
      for (const at of atts) assert.ok(['trap', 'chest', 'door'].includes(at.kind), def.id + ' attachment kind ' + at.kind);
    }
  }
});

T('REQ-0276 A2(iii): every rolled attachment keeps a gimicId that resolves to a real gimic def', () => {
  let sawAtt = false;
  for (const def of dungeons.entries) {
    for (const level of [def.levelMin, Math.round((def.levelMin + def.levelMax) / 2), def.levelMax]) {
      for (const seed of ['ga', 'gb', 'gc', 'gd', 'ge']) {
        const rolled = roller.rollDungeon(def, level, 'gimicid-' + seed + '-' + level, { gimicDefsById });
        for (const e of rolled.encounters) {
          for (const at of (e.attachments || [])) {
            sawAtt = true;
            assert.ok(typeof at.gimicId === 'string' && at.gimicId, def.id + ' attachment ' + at.id + ' must carry a gimicId');
            assert.ok(gimicDefsById[at.gimicId], def.id + ' gimicId resolves to a real gimic def: ' + at.gimicId);
          }
        }
      }
    }
  }
  assert.ok(sawAtt, 'the ladder rolled at least one attachment to check');
});

T('monotone: packEncountersForLevel / gimicCountForLevel never decrease as level rises, and clamp to the band max', () => {
  for (const def of dungeons.entries) {
    let prevP = -1, prevG = -1;
    for (let level = 1; level <= def.levelMax + 5; level++) {
      const p = roller.packEncountersForLevel(def, level);
      const g = roller.gimicCountForLevel(def, level);
      assert.ok(p >= prevP, def.id + ' packs monotone at L' + level);
      assert.ok(g >= prevG, def.id + ' gimics monotone at L' + level);
      assert.ok(p <= def.dive.packEncounters.max, def.id + ' packs clamp to max');
      assert.ok(g <= def.dive.gimicSlots.max, def.id + ' gimics clamp to max');
      prevP = p; prevG = g;
    }
  }
});

T('diveSummary: shape is {packs, gimics:{trap,chest,door}, bossPackId, lootPreview[<=5]} for every def', () => {
  for (const def of dungeons.entries) {
    const s = roller.diveSummary(def, { gimicDefsById });
    assert.strictEqual(typeof s.packs, 'number', def.id + ' summary packs');
    for (const k of ['trap', 'chest', 'door']) assert.strictEqual(typeof s.gimics[k], 'number', def.id + ' summary gimics.' + k);
    assert.ok(Array.isArray(s.lootPreview) && s.lootPreview.length <= 5, def.id + ' lootPreview <=5');
    assert.ok(packIds.has(s.bossPackId), def.id + ' bossPackId resolves');
  }
});

console.log('\n== REQ-0185 dungeon roller: ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail === 0 ? 0 : 1);
