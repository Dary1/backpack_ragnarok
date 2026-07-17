// sim/tests/req0219_deepstone_test.cjs -- REQ-0219 gate suite (DB-free).
// batch-007-deepstone-legions is PURE CONTENT: a tide/petrify/greenskin/titan roster +
// 31 skills + 4 packs, reusing verbs that already exist (strike / multi_strike /
// lifesteal / apply_status / bonus_vs_status / heal_ally). EXPECTED ENGINE DELTA: ZERO --
// no engine/sim/forecast/vocab change. This suite covers:
//   G1 dialect  -- every batch-007 enemy/skill PASSes; unknown verb / out-of-vocab
//                  status FAIL BY NAME; batch-007 ids disjoint from the live corpus,
//                  from batch-005/006, from EVERY other live kind (cross-kind sweep),
//                  and unique within the batch.
//   G2 layouts  -- all 4 packs PASS the shared validator and derive the spec cells.
//   G3 transpose -- footprint == artwork shape TRANSPOSED [h,w]; non-square pins on
//                  [6,5] (cyclops), [5,4] (troll), [3,4] (giant_crab), plus the [10,10]
//                  square boss sanity.
//   G5          -- a batch-007 pack encounter runs under the EXISTING engine and is
//                  byte-identical across two same-seed runs (no engine change needed).
//   additive    -- promoting batch-007 on top of the current live (batch-002+005+006 =
//                  27/50/10) yields 44/81/14, byte-preserves the baseline, leaves the
//                  four non-additive dungeon files untouched, refuses id collisions.
// Wired into tools/ci.sh. DEPLOY-INVARIANT: the additive/uniqueness gates reconstruct
// the PRE-batch-007 baseline by filtering batch-007 own ids out of the live copy, so
// this suite stays green after batch-007 is itself promoted into git-tracked live.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));
const cv = require(path.join(__dirname, '..', '..', 'shared', 'content_validate.cjs'));
const { runChecks } = require(path.join(__dirname, '..', '..', 'server', 'services', 'content_checks.cjs'));
const { promoteAdditive } = require(path.join(__dirname, '..', '..', 'tools', 'promote_dungeon_batch.cjs'));

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

const REPO = path.join(__dirname, '..', '..');
const BATCH = path.join(REPO, 'content', 'batches', 'batch-007-deepstone-legions');
const LIVE = path.join(REPO, 'content', 'live', 'dungeon');
const enemies = JSON.parse(fs.readFileSync(path.join(BATCH, 'enemies.json'), 'utf8'));
const skills = JSON.parse(fs.readFileSync(path.join(BATCH, 'skills.json'), 'utf8'));
const packs = JSON.parse(fs.readFileSync(path.join(BATCH, 'packs.json'), 'utf8'));
const enemyDefsById = {}; for (const e of enemies.entries) enemyDefsById[e.id] = e;
const skillDefsById = {}; for (const s of skills.entries) skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };

// artwork shapes as verified READ-ONLY against the live registry (artworks.shape),
// 2026-07-17 (session ns 88d662ca20e5289b stripped per REQ-0174 ref-first canon).
// footprint MUST equal [h, w] (the REQ-0029 transpose canon).
const ART_SHAPES = {
  kraken: { w: 10, h: 10 }, sea_serpent: { w: 6, h: 6 }, sahuagin: { w: 3, h: 4 },
  giant_crab: { w: 4, h: 3 }, medusa: { w: 4, h: 4 }, cockatrice: { w: 3, h: 4 },
  lamia: { w: 4, h: 4 }, stone_golem: { w: 4, h: 5 }, goblin: { w: 3, h: 4 },
  goblin_shaman: { w: 3, h: 4 }, kobold: { w: 3, h: 4 }, orc_warrior: { w: 3, h: 4 },
  ogre: { w: 4, h: 4 }, behemoth: { w: 8, h: 8 }, frost_giant: { w: 5, h: 6 },
  cyclops: { w: 5, h: 6 }, troll: { w: 4, h: 5 },
};

// ---- G1: dialect (positive) ----
T('G1: every batch-007 enemy PASSes the monster_def/enemy-1 machine checks', () => {
  for (const e of enemies.entries) {
    const r = runChecks('monster_def', 'enemy/1', e);
    ok(r.overall === 'PASS', e.id + ' -> ' + r.overall + ' :: ' + r.checks.filter(c => c.applicable && !c.ok).map(c => c.name + '=' + c.detail).join('; '));
  }
});
T('G1: every batch-007 skill PASSes the skill_def/skill-1 machine checks (strike/multi_strike/lifesteal/apply_status/bonus_vs_status/heal_ally)', () => {
  for (const s of skills.entries) {
    const r = runChecks('skill_def', 'skill/1', s);
    ok(r.overall === 'PASS', s.id + ' -> ' + r.overall + ' :: ' + r.checks.filter(c => c.applicable && !c.ok).map(c => c.name + '=' + c.detail).join('; '));
  }
});

// ---- G1: dialect (negative -- fail BY NAME) ----
function schemaDetail(kind, schema, data) {
  const r = runChecks(kind, schema, data);
  const sv = r.checks.find(c => c.name === 'schema_vocab');
  return { overall: r.overall, detail: sv ? sv.detail : '' };
}
T('G1: an UNKNOWN verb still FAILs by name', () => {
  const bad = JSON.parse(JSON.stringify(skills.entries[0]));
  bad.verb = { t: 'rabid_maul', n: [3, 5] };
  const r = schemaDetail('skill_def', 'skill/1', bad);
  ok(r.overall === 'FAIL', 'unknown verb must FAIL');
  ok(r.detail.includes('rabid_maul'), 'must name the offending verb, got: ' + r.detail);
});
T('G1: an OUT-OF-VOCAB status still FAILs by name', () => {
  const bad = JSON.parse(JSON.stringify(skills.entries[1])); // abyssal_grip (apply_status)
  bad.verb = { t: 'apply_status', status: 'Petrified', n: [3, 5] };
  const r = schemaDetail('skill_def', 'skill/1', bad);
  ok(r.overall === 'FAIL', 'unknown status must FAIL');
  ok(r.detail.includes('Petrified'), 'must name the offending status, got: ' + r.detail);
});

// ---- G1: global id uniqueness (deploy-invariant) ----
function liveIdsExcludingBatch() {
  const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map(e => e.id));
  const liveIds = new Set();
  for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
    for (const e of (doc.entries || [])) if (!batchIds.has(e.id)) liveIds.add(e.id);
  }
  return liveIds;
}
T('G1: batch-007 ids are disjoint from the (pre-007) live corpus and unique within the batch', () => {
  const liveIds = liveIdsExcludingBatch();
  const seen = new Set();
  for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
    ok(!liveIds.has(e.id), 'id "' + e.id + '" collides with other live content');
    ok(!seen.has(e.id), 'id "' + e.id + '" duplicated within batch-007');
    seen.add(e.id);
  }
});
T('G1: batch-007 ids are disjoint from batch-005 and batch-006 (the rosters stack cleanly at deploy)', () => {
  for (const b of ['batch-005-grave-legion', 'batch-006-wildlands']) {
    const dir = path.join(REPO, 'content', 'batches', b);
    const bids = new Set();
    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      for (const e of (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries || [])) bids.add(e.id);
    }
    for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
      ok(!bids.has(e.id), 'batch-007 id "' + e.id + '" collides with ' + b);
    }
  }
});

// ---- G1: cross-KIND global id uniqueness (system_name is UNIQUE ACROSS KINDS) ----
// The deploy-time backfill (tools/backfill_content_registry.cjs collectAll) FATALs on ANY
// duplicate system_name across ALL live kinds because content_defs.system_name is UNIQUE
// across kinds. This is the batch-006 alpha_werewolf lesson: units003 has unit_defs orc,
// shaman, vampire, etc. -- sweep every batch id against every OTHER live kind source file
// (the same set the backfill reads). batch-007 never writes these files, so deploy-invariant.
const CROSS_KIND_FILES = [
  'live_items.json', 'dungeon/items.json', 'live_sis.json', 'live_tms.json',
  'live_units.json', 'live_packs.json', 'starter_items.json',
];
T('G1: batch-007 ids are disjoint from EVERY other live kind (system_name is UNIQUE across kinds)', () => {
  const otherIds = new Map();
  for (const f of CROSS_KIND_FILES) {
    const p = path.join(REPO, 'content', 'live', f);
    if (!fs.existsSync(p)) continue;
    for (const e of (JSON.parse(fs.readFileSync(p, 'utf8')).entries || [])) {
      if (f === 'starter_items.json' && (e.id === 'lockpick' || e.id === 'spyglass')) continue;
      otherIds.set(e.id, f);
    }
  }
  for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
    ok(!otherIds.has(e.id), 'id "' + e.id + '" collides with a live ' + otherIds.get(e.id) +
      ' entry (content_defs.system_name is UNIQUE across kinds -- would FATAL the deploy backfill)');
  }
});

// ---- G3: transpose (footprint == [h, w]); non-square pins ----
T('G3: every batch-007 footprint == its artwork shape transposed [h,w]', () => {
  for (const e of enemies.entries) {
    const sh = ART_SHAPES[e.id];
    ok(sh, 'no recorded art shape for ' + e.id);
    eq(e.footprint, [sh.h, sh.w], e.id + ' footprint must be [h,w]=[' + sh.h + ',' + sh.w + ']');
  }
});
T('G3: non-square pins -- cyclops 5x6->[6,5], troll 4x5->[5,4], giant_crab 4x3->[3,4]; kraken 10x10->[10,10]', () => {
  eq(enemyDefsById.cyclops.footprint, [6, 5], 'cyclops must be [6,5] (h,w), never [5,6]');
  ok(enemyDefsById.cyclops.footprint[0] !== enemyDefsById.cyclops.footprint[1], 'cyclops footprint is non-square (proves the axis)');
  eq(enemyDefsById.troll.footprint, [5, 4], 'troll must be [5,4] (h,w), never [4,5]');
  ok(enemyDefsById.troll.footprint[0] !== enemyDefsById.troll.footprint[1], 'troll footprint is non-square (proves the axis)');
  eq(enemyDefsById.giant_crab.footprint, [3, 4], 'giant_crab must be [3,4] (h,w), never [4,3]');
  ok(enemyDefsById.giant_crab.footprint[0] !== enemyDefsById.giant_crab.footprint[1], 'giant_crab footprint is non-square (proves the axis)');
  eq(enemyDefsById.kraken.footprint, [10, 10], 'kraken 10x10 -> [10,10]');
  // the client board derives the same way (shared cellsFor + [h,w] transpose):
  const cells = cv.cellsFor(cv.parseA1('L10'), enemyDefsById.cyclops.footprint);
  eq(cv.formatA1(cells[cells.length - 1][0], cells[cells.length - 1][1]), 'P15', 'cyclops@L10 far corner is P15 (6 rows x 5 cols)');
});

// ---- G2: packs -- shared validator + derived cells ----
T('G2: each authored layout PASSes shared/content_validate + derives the spec cells', () => {
  const expected = {
    pack_deep_tide: ['B4:K13', 'N3:S8', 'N11:P14', 'R11:U13'],
    pack_petrifying_court: ['B5:E9', 'H4:K7', 'H10:J13', 'M7:P10'],
    pack_greenskin_warband: ['B6:E9', 'G3:I6', 'G9:I12', 'G14:I17', 'L7:N10'],
    pack_titan_ridge: ['B5:I12', 'L3:P8', 'L10:P15', 'S6:V10'],
  };
  for (const p of packs.entries) {
    cv.validateMonsterPackEntry(p, enemyDefsById); // throws on any violation
    const ranges = p.members.map(m => {
      const c = cv.cellsFor(cv.parseA1(m.at), enemyDefsById[m.enemy].footprint);
      return cv.formatA1(c[0][0], c[0][1]) + ':' + cv.formatA1(c[c.length - 1][0], c[c.length - 1][1]);
    });
    eq(ranges, expected[p.id], p.id + ' derived cells');
  }
});

// ---- G5: the content runs under the EXISTING engine, deterministically ----
const scenario = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {}; for (const e of liveItems.entries) itemDefsById[e.id] = e;
function compiled() { return combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1'); }
function runPack(pack, seed) {
  const c = compiled();
  return combat.runEncounter({
    rng: combat.makeRng(seed), encIndex: 0,
    troopBps: c.bps, troopPos: c.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById, skillDefsById,
    encounterDef: { id: 'req0219-' + pack.id, type: 'pack', mode: 'battle', enemyPack: pack, deadline_secs: 20 },
    seedLabel: seed,
  });
}
T('G5: every batch-007 pack places + fires its skills under the existing engine (no engine change)', () => {
  for (const p of packs.entries) {
    const r = runPack(p, 'req0219-smoke');
    ok(Array.isArray(r.events) && r.events.length > 0, p.id + ' produced no events');
    ok(r.events.some(e => e.ev === 'ray_fire' || e.ev === 'telegraph'), p.id + ' fired no skill');
  }
});
T('G5 determinism: two same-seed runs are byte-identical (per pack)', () => {
  for (const p of packs.entries) {
    const a = runPack(p, 'req0219-determinism');
    const b = runPack(p, 'req0219-determinism');
    eq(JSON.stringify(a.events), JSON.stringify(b.events), p.id + ' same seed -> identical event log');
  }
});

// ---- additive promotion (deploy-invariant, byte-preserving) ----
T('additive promotion: batch-007 merges on top of the current live -- 27->44 / 50->81 / 10->14, baseline byte-preserved, non-additive files untouched, collision refused', () => {
  const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map(e => e.id));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req0219-promo-'));
  try {
    const liveDir = path.join(tmp, 'dungeon'); fs.mkdirSync(liveDir, { recursive: true });
    const baseText = {};
    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
      doc.entries = (doc.entries || []).filter(e => !batchIds.has(e.id));
      const text = JSON.stringify(doc, null, 2) + '\n';
      baseText[f] = text;
      fs.writeFileSync(path.join(liveDir, f), text);
    }
    const other = {};
    for (const f of ['dungeon.json', 'entities.json', 'formations.json', 'items.json']) {
      const t = fs.readFileSync(path.join(LIVE, f), 'utf8');
      other[f] = t; fs.writeFileSync(path.join(liveDir, f), t);
    }
    const regPath = path.join(tmp, 'registry.json');
    fs.writeFileSync(regPath, JSON.stringify({ t: 'test' }, null, 1) + '\n');

    const expect = { 'enemies.json': [27, 44], 'skills.json': [50, 81], 'packs.json': [10, 14] };
    const delta = { 'enemies.json': enemies.entries.length, 'skills.json': skills.entries.length, 'packs.json': packs.entries.length };

    promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath });

    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const merged = fs.readFileSync(path.join(liveDir, f), 'utf8');
      const bDoc = JSON.parse(baseText[f]), mDoc = JSON.parse(merged);
      eq(bDoc.entries.length, expect[f][0], f + ' baseline count');
      eq(mDoc.entries.length, expect[f][1], f + ' merged count');
      eq(mDoc.entries.length, bDoc.entries.length + delta[f], f + ' merged == baseline + batch (delta invariant)');
      const arrClose = baseText[f].lastIndexOf(']');
      let ip = arrClose; while (ip > 0 && /\s/.test(baseText[f][ip - 1])) ip--;
      const A = baseText[f].slice(0, ip), B = baseText[f].slice(ip);
      ok(merged.startsWith(A) && merged.endsWith(B) && (A + B) === baseText[f], f + ' baseline bytes preserved verbatim (splice)');
      for (let i = 0; i < bDoc.entries.length; i++) eq(mDoc.entries[i], bDoc.entries[i], f + ' entry ' + i + ' unchanged');
      const appended = mDoc.entries.slice(bDoc.entries.length).map(e => e.id);
      eq(appended, delta[f] === enemies.entries.length ? enemies.entries.map(e => e.id)
        : (f === 'skills.json' ? skills.entries.map(e => e.id) : packs.entries.map(e => e.id)), f + ' appended ids == batch-007');
    }
    for (const f of ['dungeon.json', 'entities.json', 'formations.json', 'items.json']) {
      eq(fs.readFileSync(path.join(liveDir, f), 'utf8'), other[f], f + ' must be left untouched');
    }
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    ok(Array.isArray(reg.live_dungeon_additive) && reg.live_dungeon_additive.length === 1, 'provenance recorded');
    ok(reg.live_dungeon_additive[0].promoted_from === 'batch-007-deepstone-legions', 'provenance names batch-007');
    let threw = null; try { promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath }); } catch (e) { threw = e; }
    ok(threw && /already exists live/.test(threw.message), 'a second additive promote is refused on id collision');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log('----------------------------------');
console.log('REQ-0219 deepstone-legions: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
