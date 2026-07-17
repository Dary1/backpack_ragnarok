// sim/tests/req0207_wildlands_test.cjs -- REQ-0207 gate suite (DB-free).
// batch-006-wildlands is PURE CONTENT: a beast/vermin/demon roster + 20 skills + 3
// packs, reusing verbs that already exist post-REQ-0203 (strike / multi_strike /
// lifesteal / apply_status / bonus_vs_status). EXPECTED ENGINE DELTA: ZERO -- no
// engine/sim/forecast/vocab change. This suite covers:
//   G1 dialect  -- every batch-006 enemy/skill PASSes; unknown verb / out-of-vocab
//                  status FAIL BY NAME; batch-006 ids disjoint from the live corpus
//                  (and from batch-005) and unique within the batch.
//   G2 layouts  -- all 3 packs PASS the shared validator and derive the spec cells.
//   G3 transpose -- footprint == artwork shape TRANSPOSED [h,w]; non-square pins on
//                  [4,5], [4,6] and a 3x4, plus the [8,8] boss.
//   G5          -- a batch-006 pack encounter runs under the EXISTING engine and is
//                  byte-identical across two same-seed runs (no engine change needed).
//   additive    -- promoting batch-006 on top of the current live (batch-002+005 =
//                  15/30/7) yields 27/50/10, byte-preserves the baseline, leaves the
//                  four non-additive dungeon files untouched, refuses id collisions.
// Wired into tools/ci.sh. DEPLOY-INVARIANT: the additive/uniqueness gates reconstruct
// the PRE-batch-006 baseline by filtering batch-006's own ids out of the live copy, so
// this suite stays green after batch-006 is itself promoted into git-tracked live (the
// staleness trap that bit REQ-0203's suite when its deploy landed -- see the REQ file).
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
const BATCH = path.join(REPO, 'content', 'batches', 'batch-006-wildlands');
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
  alpha_werewolf: { w: 4, h: 4 }, dire_wolf: { w: 5, h: 4 }, boar: { w: 4, h: 3 },
  giant_bat: { w: 4, h: 3 }, giant_spider: { w: 4, h: 3 }, giant_scorpion: { w: 4, h: 3 },
  giant_snake: { w: 4, h: 4 }, basilisk: { w: 6, h: 4 }, imp: { w: 3, h: 4 },
  gargoyle: { w: 4, h: 4 }, dullahan: { w: 4, h: 4 }, demon_lord: { w: 8, h: 8 },
};

// ---- G1: dialect (positive) ----
T('G1: every batch-006 enemy PASSes the monster_def/enemy-1 machine checks', () => {
  for (const e of enemies.entries) {
    const r = runChecks('monster_def', 'enemy/1', e);
    ok(r.overall === 'PASS', e.id + ' -> ' + r.overall + ' :: ' + r.checks.filter(c => c.applicable && !c.ok).map(c => c.name + '=' + c.detail).join('; '));
  }
});
T('G1: every batch-006 skill PASSes the skill_def/skill-1 machine checks (strike/multi_strike/lifesteal/apply_status/bonus_vs_status)', () => {
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
  const bad = JSON.parse(JSON.stringify(skills.entries[6])); // venom_bite (apply_status)
  bad.verb = { t: 'apply_status', status: 'Petrified', n: [2, 4] };
  const r = schemaDetail('skill_def', 'skill/1', bad);
  ok(r.overall === 'FAIL', 'unknown status must FAIL');
  ok(r.detail.includes('Petrified'), 'must name the offending status, got: ' + r.detail);
});

// ---- G1: global id uniqueness (deploy-invariant) ----
// Reconstruct the PRE-batch-006 live corpus by removing batch-006's OWN ids, so this
// gate is correct both before and after batch-006 is promoted into git-tracked live.
function liveIdsExcludingBatch() {
  const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map(e => e.id));
  const liveIds = new Set();
  for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
    for (const e of (doc.entries || [])) if (!batchIds.has(e.id)) liveIds.add(e.id);
  }
  return liveIds;
}
T('G1: batch-006 ids are disjoint from the (pre-006) live corpus and unique within the batch', () => {
  const liveIds = liveIdsExcludingBatch();
  const seen = new Set();
  for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
    ok(!liveIds.has(e.id), 'id "' + e.id + '" collides with other live content');
    ok(!seen.has(e.id), 'id "' + e.id + '" duplicated within batch-006');
    seen.add(e.id);
  }
});
T('G1: batch-006 ids are disjoint from batch-005 (the two rosters stack cleanly at deploy)', () => {
  const b5 = path.join(REPO, 'content', 'batches', 'batch-005-grave-legion');
  const b5ids = new Set();
  for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
    for (const e of (JSON.parse(fs.readFileSync(path.join(b5, f), 'utf8')).entries || [])) b5ids.add(e.id);
  }
  for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
    ok(!b5ids.has(e.id), 'batch-006 id "' + e.id + '" collides with batch-005');
  }
});

// ---- G1: cross-KIND global id uniqueness (system_name is UNIQUE ACROSS KINDS) ----
// The deploy-time backfill (tools/backfill_content_registry.cjs collectAll) FATALs on ANY
// duplicate system_name across ALL live kinds -- po_def / si_def / tm_def / monster_def /
// skill_def / unit_def / gacha_pack / monster_pack -- because content_defs.system_name is
// UNIQUE across kinds. The dungeon-only checks above would MISS a clash against a unit_def /
// po_def / ... id: this is exactly how batch-006's original `werewolf` monster id collided
// with the units003 `werewolf` unit_def and FATALed at deploy (-> renamed to alpha_werewolf).
// So sweep every batch id against every OTHER live kind's source file (the same set the
// backfill reads); batch-006 never writes these files, so this is deploy-invariant, no
// self-exclusion needed.
const CROSS_KIND_FILES = [
  'live_items.json', 'dungeon/items.json', 'live_sis.json', 'live_tms.json',
  'live_units.json', 'live_packs.json', 'starter_items.json',
];
T('G1: batch-006 ids are disjoint from EVERY other live kind (system_name is UNIQUE across kinds)', () => {
  const otherIds = new Map(); // id -> source file
  for (const f of CROSS_KIND_FILES) {
    const p = path.join(REPO, 'content', 'live', f);
    if (!fs.existsSync(p)) continue;
    for (const e of (JSON.parse(fs.readFileSync(p, 'utf8')).entries || [])) {
      // starter_items lockpick/spyglass are backfill-EXCLUDED (dupes of dungeon/items.json),
      // so they are not authoritative system_names -- skip to mirror the backfill dedup.
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
T('G3: every batch-006 footprint == its artwork shape transposed [h,w]', () => {
  for (const e of enemies.entries) {
    const sh = ART_SHAPES[e.id];
    ok(sh, 'no recorded art shape for ' + e.id);
    eq(e.footprint, [sh.h, sh.w], e.id + ' footprint must be [h,w]=[' + sh.h + ',' + sh.w + ']');
  }
});
T('G3: non-square pins -- dire_wolf 5x4->[4,5], basilisk 6x4->[4,6], a 3x4->[3,4]; demon_lord 8x8->[8,8]', () => {
  eq(enemyDefsById.dire_wolf.footprint, [4, 5], 'dire_wolf must be [4,5] (h,w), never [5,4]');
  ok(enemyDefsById.dire_wolf.footprint[0] !== enemyDefsById.dire_wolf.footprint[1], 'dire_wolf footprint is non-square (proves the axis)');
  eq(enemyDefsById.basilisk.footprint, [4, 6], 'basilisk must be [4,6] (h,w), never [6,4]');
  ok(enemyDefsById.basilisk.footprint[0] !== enemyDefsById.basilisk.footprint[1], 'basilisk footprint is non-square (proves the axis)');
  eq(enemyDefsById.boar.footprint, [3, 4], 'boar must be [3,4] (h,w), never [4,3]');
  ok(enemyDefsById.boar.footprint[0] !== enemyDefsById.boar.footprint[1], 'boar footprint is non-square (proves the axis)');
  eq(enemyDefsById.demon_lord.footprint, [8, 8], 'demon_lord 8x8 -> [8,8]');
  // the client board derives the same way (shared cellsFor + [h,w] transpose):
  const cells = cv.cellsFor(cv.parseA1('B7'), enemyDefsById.basilisk.footprint);
  eq(cv.formatA1(cells[cells.length - 1][0], cells[cells.length - 1][1]), 'G10', 'basilisk@B7 far corner is G10 (4 rows x 6 cols)');
});

// ---- G2: packs -- shared validator + derived cells ----
T('G2: each authored layout PASSes shared/content_validate + derives the spec cells', () => {
  const expected = {
    pack_wild_hunt: ['B6:E9', 'G2:K5', 'G12:J14', 'M7:P9'],
    pack_venom_nest: ['B7:G10', 'I3:L5', 'I12:L14', 'N7:Q10'],
    pack_demon_gate: ['B5:I12', 'K3:N6', 'K12:N15', 'P6:R9', 'P11:R14'],
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
    encounterDef: { id: 'req0207-' + pack.id, type: 'pack', mode: 'battle', enemyPack: pack, deadline_secs: 20 },
    seedLabel: seed,
  });
}
T('G5: every batch-006 pack places + fires its skills under the existing engine (no engine change)', () => {
  for (const p of packs.entries) {
    const r = runPack(p, 'req0207-smoke');
    ok(Array.isArray(r.events) && r.events.length > 0, p.id + ' produced no events');
    ok(r.events.some(e => e.ev === 'ray_fire' || e.ev === 'telegraph'), p.id + ' fired no skill');
  }
});
T('G5 determinism: two same-seed runs are byte-identical (per pack)', () => {
  for (const p of packs.entries) {
    const a = runPack(p, 'req0207-determinism');
    const b = runPack(p, 'req0207-determinism');
    eq(JSON.stringify(a.events), JSON.stringify(b.events), p.id + ' same seed -> identical event log');
  }
});

// ---- additive promotion (deploy-invariant, byte-preserving) ----
// [GATE FIX 2026-07-17, REQ-0230 ci pass] Counts were hardcoded (15->27 /
// 30->50 / 7->10) from the moment batch-006 was authored; later batches
// (REQ-0219 deepstone et al.) have since been promoted into live, so the
// reconstructed baseline is no longer 15/30/7. Same staleness, same fix as
// 009582d on the grave-legion gate: the invariant this gate owns is the
// SPLICE (merged = baseline + batch, originals byte-identical), so the
// expectation is delta-based and immune to unrelated live growth.
T('additive promotion: batch-006 merges on top of the current live -- +batch counts, baseline byte-preserved, non-additive files untouched, collision refused', () => {
  const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map(e => e.id));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req0207-promo-'));
  try {
    const liveDir = path.join(tmp, 'dungeon'); fs.mkdirSync(liveDir, { recursive: true });
    // Reconstruct the PRE-batch-006 baseline: the real live with batch-006's own ids
    // filtered out (removes nothing today; removes batch-006 once it is deployed).
    const baseText = {};
    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
      doc.entries = (doc.entries || []).filter(e => !batchIds.has(e.id));
      const text = JSON.stringify(doc, null, 2) + '\n';
      baseText[f] = text;
      fs.writeFileSync(path.join(liveDir, f), text);
    }
    // the four non-additive dungeon files come along verbatim as the untouched reference.
    const other = {};
    for (const f of ['dungeon.json', 'entities.json', 'formations.json', 'items.json']) {
      const t = fs.readFileSync(path.join(LIVE, f), 'utf8');
      other[f] = t; fs.writeFileSync(path.join(liveDir, f), t);
    }
    const regPath = path.join(tmp, 'registry.json');
    fs.writeFileSync(regPath, JSON.stringify({ t: 'test' }, null, 1) + '\n');

    const delta = { 'enemies.json': enemies.entries.length, 'skills.json': skills.entries.length, 'packs.json': packs.entries.length };

    promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath });

    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const merged = fs.readFileSync(path.join(liveDir, f), 'utf8');
      const bDoc = JSON.parse(baseText[f]), mDoc = JSON.parse(merged);
      eq(mDoc.entries.length, bDoc.entries.length + delta[f], f + ' merged == baseline + batch (delta invariant)');
      // byte preservation: the merge is a pure SPLICE -- merged == A + <newblock> + B
      const arrClose = baseText[f].lastIndexOf(']');
      let ip = arrClose; while (ip > 0 && /\s/.test(baseText[f][ip - 1])) ip--;
      const A = baseText[f].slice(0, ip), B = baseText[f].slice(ip);
      ok(merged.startsWith(A) && merged.endsWith(B) && (A + B) === baseText[f], f + ' baseline bytes preserved verbatim (splice)');
      for (let i = 0; i < bDoc.entries.length; i++) eq(mDoc.entries[i], bDoc.entries[i], f + ' entry ' + i + ' unchanged');
      // the appended tail is exactly batch-006, in order
      const appended = mDoc.entries.slice(bDoc.entries.length).map(e => e.id);
      eq(appended, delta[f] === enemies.entries.length ? enemies.entries.map(e => e.id)
        : (f === 'skills.json' ? skills.entries.map(e => e.id) : packs.entries.map(e => e.id)), f + ' appended ids == batch-006');
    }
    // the four non-additive files are NOT touched at all
    for (const f of ['dungeon.json', 'entities.json', 'formations.json', 'items.json']) {
      eq(fs.readFileSync(path.join(liveDir, f), 'utf8'), other[f], f + ' must be left untouched');
    }
    // provenance recorded
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    ok(Array.isArray(reg.live_dungeon_additive) && reg.live_dungeon_additive.length === 1, 'provenance recorded');
    ok(reg.live_dungeon_additive[0].promoted_from === 'batch-006-wildlands', 'provenance names batch-006');
    // re-running now collides (ids exist) and is refused by name
    let threw = null; try { promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath }); } catch (e) { threw = e; }
    ok(threw && /already exists live/.test(threw.message), 'a second additive promote is refused on id collision');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log('----------------------------------');
console.log('REQ-0207 wildlands: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
