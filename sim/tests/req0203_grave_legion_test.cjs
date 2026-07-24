// sim/tests/req0203_grave_legion_test.cjs -- REQ-0203 gate suite (DB-free).
// Covers G1 (skill/1 + enemy/1 dialect: batch-005 PASSes; unknown verb / out-of-vocab
// status FAIL by name; ids globally unique), G2 (the three enemy verbs execute
// deterministically), G4 (footprint == artwork shape TRANSPOSED, non-square pins),
// the authored pack layouts (shared validator), and the ADDITIVE promotion (batch-002
// live content survives byte-for-byte; counts 7->15 / 14->30 / 4->7; id collision
// refused). Wired into tools/ci.sh.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));
const skillsLib = require(path.join(__dirname, '..', 'lib', 'skills.cjs'));
const cv = require(path.join(__dirname, '..', '..', 'shared', 'content_validate.cjs'));
const { runChecks } = require(path.join(__dirname, '..', '..', 'server', 'services', 'content_checks.cjs'));
const { promoteAdditive } = require(path.join(__dirname, '..', '..', 'tools', 'promote_dungeon_batch.cjs'));

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + e.message); fail++; } }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

const REPO = path.join(__dirname, '..', '..');
const BATCH = path.join(REPO, 'content', 'batches', 'batch-005-grave-legion');
const enemies = JSON.parse(fs.readFileSync(path.join(BATCH, 'enemies.json'), 'utf8'));
const skills = JSON.parse(fs.readFileSync(path.join(BATCH, 'skills.json'), 'utf8'));
const packs = JSON.parse(fs.readFileSync(path.join(BATCH, 'packs.json'), 'utf8'));
const enemyDefsById = {}; for (const e of enemies.entries) enemyDefsById[e.id] = e;
const skillDefsById = {}; for (const s of skills.entries) skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };

// artwork shapes as verified read-only against the live registry (artworks.shape),
// 2026-07-17. footprint MUST equal [h, w] (the REQ-0029 transpose canon).
const ART_SHAPES = {
  zombie: { w: 3, h: 4 }, ghost: { w: 3, h: 4 }, mummy: { w: 3, h: 4 },
  skeleton_warrior: { w: 3, h: 4 }, wight: { w: 3, h: 4 }, necromancer: { w: 3, h: 4 },
  lich: { w: 4, h: 5 }, bone_dragon: { w: 10, h: 10 },
};

// ---- G1: dialect (positive) ----
T('G1: every batch-005 enemy PASSes the monster_def/enemy-1 machine checks', () => {
  for (const e of enemies.entries) {
    const r = runChecks('monster_def', 'enemy/1', e);
    ok(r.overall === 'PASS', e.id + ' -> ' + r.overall + ' :: ' + r.checks.filter(c => c.applicable && !c.ok).map(c => c.name + '=' + c.detail).join('; '));
  }
});
T('G1: every batch-005 skill PASSes the skill_def/skill-1 machine checks (incl. lifesteal, bonus_vs_status, heal_ally)', () => {
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
  bad.verb = { t: 'necrotic_smite', n: [3, 5] };
  const r = schemaDetail('skill_def', 'skill/1', bad);
  ok(r.overall === 'FAIL', 'unknown verb must FAIL');
  ok(r.detail.includes('necrotic_smite'), 'must name the offending verb, got: ' + r.detail);
});
T('G1: an OUT-OF-VOCAB status still FAILs by name', () => {
  const bad = JSON.parse(JSON.stringify(skills.entries[0]));
  bad.verb = { t: 'apply_status', status: 'Doom', n: [2, 4] };
  const r = schemaDetail('skill_def', 'skill/1', bad);
  ok(r.overall === 'FAIL', 'unknown status must FAIL');
  ok(r.detail.includes('Doom'), 'must name the offending status, got: ' + r.detail);
});

// ---- G1: global id uniqueness vs the live corpus ----
// DEPLOY-INVARIANT (REQ-0207 found-in-flight): batch-005 has since been promoted into
// git-tracked content/live/dungeon (commit dc80295), so its ids now ARE live. Reconstruct
// the PRE-batch-005 corpus by removing batch-005's OWN ids, so this gate asserts "no
// collision with OTHER live content" both before and after batch-005's own deploy.
T('G1: batch-005 ids are disjoint from the (pre-005) live corpus and unique within the batch', () => {
  const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map((e) => e.id));
  const liveIds = new Set();
  for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', f), 'utf8'));
    for (const e of (doc.entries || [])) if (!batchIds.has(e.id)) liveIds.add(e.id);
  }
  const seen = new Set();
  for (const e of [].concat(enemies.entries, skills.entries, packs.entries)) {
    ok(!liveIds.has(e.id), 'id "' + e.id + '" collides with other live content');
    ok(!seen.has(e.id), 'id "' + e.id + '" duplicated within batch-005');
    seen.add(e.id);
  }
});

// ---- G4: transpose (footprint == [h, w]); non-square pins ----
T('G4: every batch-005 footprint == its artwork shape transposed [h,w]', () => {
  for (const e of enemies.entries) {
    const sh = ART_SHAPES[e.id];
    ok(sh, 'no recorded art shape for ' + e.id);
    eq(e.footprint, [sh.h, sh.w], e.id + ' footprint must be [h,w]=[' + sh.h + ',' + sh.w + ']');
  }
});
T('G4: non-square pins -- lich {w:4,h:5}->[5,4] and a 3x4->[4,3], NOT the transposed answer', () => {
  eq(enemyDefsById.lich.footprint, [5, 4], 'lich must be [5,4] (h,w), never [4,5]');
  ok(enemyDefsById.lich.footprint[0] !== enemyDefsById.lich.footprint[1], 'lich footprint is non-square (proves the axis)');
  eq(enemyDefsById.zombie.footprint, [4, 3], 'zombie must be [4,3] (h,w), never [3,4]');
  // the client board derives the same way (shared cellsFor + [h,w] transpose):
  const cells = cv.cellsFor(cv.parseA1('N6'), enemyDefsById.lich.footprint);
  eq(cv.formatA1(cells[cells.length - 1][0], cells[cells.length - 1][1]), 'Q10', 'lich@N6 far corner is Q10 (5 rows x 4 cols)');
});

// ---- packs: the shared validator + derived cells ----
T('packs: each authored layout PASSes shared/content_validate + derives the spec cells', () => {
  const expected = {
    pack_grave_shamble: ['B2:E6', 'F2:H5', 'I2:K5', 'L2:N5', 'O2:Q5', 'R2:T5', 'U2:W5', 'F6:H9', 'I6:K9', 'L6:N9'],
    pack_grave_legion: ['B2:E6', 'F2:H5', 'I2:K5', 'L2:N5', 'O2:Q5', 'R2:T5', 'U2:W5', 'F6:H9', 'I6:K9', 'L6:N9'],
    pack_bone_court: ['B4:K13', 'N6:Q10', 'N12:P15', 'S8:U11'],
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

// ---- G2: sim executor -- lifesteal, bonus_vs_status (active), heal_ally ----
function fakeActor(id, hp) {
  const o = { id: id, statusBag: {}, _hp: hp, _hpMax: hp, alive: true, ref: { id: id, masked: false } };
  o.hp = () => o._hp; o.hpMax = () => o._hpMax;
  o.applyDamage = (a) => { o._hp = Math.max(0, o._hp - a); if (o._hp <= 0) o.alive = false; };
  o.heal = (a) => { o._hp = Math.min(o._hpMax, o._hp + a); };
  return o;
}
const fixedRng = () => combat.makeRng('req0203-unit').stream('dmg'); // range(x,x) === x, deterministic

T('G2 lifesteal: strike n, heal SELF by frac of damage dealt; heals nobody when no self actor', () => {
  const target = fakeActor('tgt', 100);
  const self = fakeActor('caster', 50); self._hpMax = 100; // headroom -> the heal is visible, not hp-capped
  const events = [];
  combat.dealHitOnField(target, { verb: { t: 'lifesteal', n: [10, 10], frac: 0.5 } }, 1, fixedRng(), 'battle', events, [], self);
  eq(target._hp, 90, 'target takes 10');
  eq(self._hp, 55, 'caster heals 5 (0.5 * 10)');
  const heal = events.find(e => e.ev === 'lifesteal_heal');
  ok(heal && heal.heal === 5, 'lifesteal_heal event carries the 5 heal');
  // no attacker actor -> damage lands, no heal, no crash
  const t2 = fakeActor('t2', 100); const ev2 = [];
  combat.dealHitOnField(t2, { verb: { t: 'lifesteal', n: [10, 10], frac: 0.5 } }, 1, fixedRng(), 'battle', ev2, []);
  eq(t2._hp, 90, 'still deals damage with no self actor');
  ok(!ev2.some(e => e.ev === 'lifesteal_heal'), 'no heal event without a self actor');
});

T('G2 bonus_vs_status: x mult ONLY when the target carries the named status', () => {
  const clean = fakeActor('clean', 100); const e1 = [];
  combat.dealHitOnField(clean, { verb: { t: 'bonus_vs_status', status: 'Chill', n: [10, 10], mult: 1.5 } }, 1, fixedRng(), 'battle', e1, []);
  eq(clean._hp, 90, 'no status -> plain 10');
  const chilled = fakeActor('chilled', 100); chilled.statusBag = { Chill: { stacks: 1 } }; const e2 = [];
  combat.dealHitOnField(chilled, { verb: { t: 'bonus_vs_status', status: 'Chill', n: [10, 10], mult: 1.5 } }, 1, fixedRng(), 'battle', e2, []);
  eq(chilled._hp, 85, 'Chill present -> 10 * 1.5 = 15');
});

T('G2 heal_ally target: lowest-HP LIVING ally, NEVER self unless alone', () => {
  const caster = fakeActor('c', 50), a1 = fakeActor('a1', 30), a2 = fakeActor('a2', 20);
  eq(skillsLib.selectHealAllyTarget(caster, [caster, a1, a2]).id, 'a2', 'picks the lowest-HP ally (a2)');
  // caster is the most wounded but still must not pick itself while an ally lives
  const hurt = fakeActor('hurt', 5), ally = fakeActor('ally', 40);
  eq(skillsLib.selectHealAllyTarget(hurt, [hurt, ally]).id, 'ally', 'never self while an ally lives');
  // alone (all allies dead) -> self
  const dead = fakeActor('dead', 40); dead.alive = false;
  eq(skillsLib.selectHealAllyTarget(caster, [caster, dead]).id, 'c', 'self only when alone');
  eq(skillsLib.selectHealAllyTarget(caster, [caster]).id, 'c', 'a lone caster heals itself');
});

// ---- G2: integration + determinism through the real encounter loop ----
const scenario = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItems = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {}; for (const e of liveItems.entries) itemDefsById[e.id] = e;
function compiled() { return combat.compileSquadSnapshot(scenario, itemDefsById, 'formation1', 'unit1'); }
function runLegion(seed) {
  const c = compiled();
  return combat.runEncounter({
    rng: combat.makeRng(seed), encIndex: 0,
    troopBps: c.bps, troopPos: c.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById, skillDefsById,
    encounterDef: { id: 'req0203-legion', type: 'pack', mode: 'battle', enemyPack: packs.entries[1], deadline_secs: 22 },
    seedLabel: seed,
  });
}
T('G2 integration: heal_ally routes as SUPPORT -- fires no ray, targets a pack ally, emits the event', () => {
  // Synthetic pack with NO enemy offense (so the player is never wiped) and a fast
  // healer, so the wiring is exercised deterministically regardless of combat timing.
  const synthEnemies = {
    test_healer: { id: 'test_healer', name: 'Healer', hp: [300, 300], footprint: [1, 1], skills: ['test_heal'] },
    test_dummy: { id: 'test_dummy', name: 'Dummy', hp: [300, 300], footprint: [1, 1], skills: [] },
  };
  const synthSkills = {
    test_heal: { trigger: { t: 'every_secs', s: [0.5, 0.5] }, verb: { t: 'heal_ally', n: [10, 14] },
      attack_profile: { edge: [], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false }, modes: ['battle'] },
  };
  const c = compiled();
  const r = combat.runEncounter({
    rng: combat.makeRng('req0203-heal-ally'), encIndex: 0,
    troopBps: c.bps, troopPos: c.pos, formationBox: { formationId: 'formation1' },
    enemyDefsById: synthEnemies, skillDefsById: synthSkills,
    encounterDef: { id: 'req0203-heal', type: 'pack', mode: 'battle',
      enemyPack: { members: [{ enemy: 'test_healer', at: 'B2' }, { enemy: 'test_dummy', at: 'D2' }] }, deadline_secs: 5 },
    seedLabel: 'req0203-heal-ally',
  });
  const heals = r.events.filter(e => e.ev === 'heal_ally');
  ok(heals.length >= 2, 'the recurring healer must emit heal_ally events, got ' + heals.length);
  ok(heals.every(h => h.src === 'test_healer' && typeof h.dst === 'string' && h.dst.length > 0), 'each heal_ally names its caster + a target');
  ok(heals.every(h => h.dst !== 'test_healer#0'), 'never self while an ally lives (targets the dummy)');
  ok(!r.events.some(e => e.ev === 'telegraph' && e.skill === 'heal_ally'), 'heal_ally is support -- never telegraphs a ray');
  ok(!r.events.some(e => e.ev === 'ray_fire' && e.src === 'test_healer'), 'the healer fires NO ray at the player field');
});
T('G2 real content: a batch-005 pack encounter exercises all three new verbs (deterministic seed)', () => {
  // REQ-0303 (pack-underfill-fix) re-picked this deterministic seed: growing
  // grave_legion to >=30% formation fill shifted the RNG timeline, so the old
  // 'req0203-legion-fixed' seed no longer lands heal_ally in-window. This seed
  // exercises all three verbs on the new composition (verified; heal_ally is
  // the scarce verb -- it only fires when a pack ally is wounded).
  const r = runLegion('req0203-legion-fixed-6');
  ok(r.events.some(e => e.ev === 'heal_ally'), 'dark_mending heal_ally fired');
  ok(r.events.some(e => e.ev === 'lifesteal_heal'), 'lifesteal (spectral_touch/life_drain) fired');
  ok(r.events.some(e => e.ev === 'telegraph' && e.skill === 'bonus_vs_status'), 'bone_cleaver/grave_blade bonus_vs_status fired');
});
T('G2 determinism: two same-seed runs are byte-identical', () => {
  const a = runLegion('req0203-determinism');
  const b = runLegion('req0203-determinism');
  eq(JSON.stringify(a.events), JSON.stringify(b.events), 'same seed -> identical event log');
});

// ---- additive promotion: batch-002 survives byte-for-byte; counts; collision ----
// [GATE FIX 2026-07-17] Counts were hardcoded (7->15 / 14->30 / 4->7) from the
// moment batch-005 was authored; REQ-0207/0208 have since promoted OTHER batches
// into live, so the reconstructed baseline is no longer 7/14/4. The invariant this
// gate owns is the SPLICE (merged = baseline + batch, originals byte-identical),
// so the expectation is now delta-based and immune to unrelated live growth.
T('additive promotion: merges batch-005 into a live COPY -- +batch counts, batch-002 byte-identical, collision refused', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req0203-promo-'));
  try {
    const liveDir = path.join(tmp, 'dungeon'); fs.mkdirSync(liveDir, { recursive: true });
    const realLive = path.join(REPO, 'content', 'live', 'dungeon');
    // DEPLOY-INVARIANT (REQ-0207 found-in-flight): batch-005 has since been promoted into
    // git-tracked live (dc80295), so the real live already contains it. Reconstruct the
    // PRE-batch-005 baseline by filtering batch-005's OWN ids out of the live copy -- the
    // 7->15 / 14->30 / 4->7 splice is then exercised identically whether or not batch-005
    // is live (removing nothing pre-deploy; removing batch-005 post-deploy).
    const batchIds = new Set([].concat(enemies.entries, skills.entries, packs.entries).map((e) => e.id));
    const before = {};
    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(realLive, f), 'utf8'));
      doc.entries = (doc.entries || []).filter((e) => !batchIds.has(e.id));
      const text = JSON.stringify(doc, null, 2) + '\n';
      before[f] = text; fs.writeFileSync(path.join(liveDir, f), text);
    }
    const other = {};
    for (const f of ['dungeon.json', 'gimics.json', 'formations.json', 'items.json']) {
      const t = fs.readFileSync(path.join(realLive, f), 'utf8');
      other[f] = t; fs.writeFileSync(path.join(liveDir, f), t);
    }
    const regPath = path.join(tmp, 'registry.json'); fs.writeFileSync(regPath, JSON.stringify({ t: 'test' }, null, 1) + '\n');

    const r = promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath });
    const delta = { 'enemies.json': enemies.entries.length, 'skills.json': skills.entries.length, 'packs.json': packs.entries.length };
    for (const f of ['enemies.json', 'skills.json', 'packs.json']) {
      const merged = fs.readFileSync(path.join(liveDir, f), 'utf8');
      const bDoc = JSON.parse(before[f]), mDoc = JSON.parse(merged);
      eq(mDoc.entries.length, bDoc.entries.length + delta[f], f + ' merged count = baseline + batch');
      // byte preservation: the merge is a pure SPLICE -- merged == A + <newblock> + B
      // where A|B are the original file text either side of the last existing entry.
      const arrClose = before[f].lastIndexOf(']');
      let ip = arrClose; while (ip > 0 && /\s/.test(before[f][ip - 1])) ip--;
      const A = before[f].slice(0, ip), B = before[f].slice(ip);
      ok(merged.startsWith(A) && merged.endsWith(B) && (A + B) === before[f], f + ' original bytes preserved verbatim (splice)');
      for (let i = 0; i < bDoc.entries.length; i++) eq(mDoc.entries[i], bDoc.entries[i], f + ' entry ' + i + ' unchanged');
    }
    // the four non-additive files are NOT touched at all
    for (const f of ['dungeon.json', 'gimics.json', 'formations.json', 'items.json']) {
      eq(fs.readFileSync(path.join(liveDir, f), 'utf8'), other[f], f + ' must be left untouched');
    }
    // provenance recorded
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    ok(Array.isArray(reg.live_dungeon_additive) && reg.live_dungeon_additive.length === 1, 'provenance recorded');
    // re-running now collides (ids exist) and is refused by name
    let threw = null; try { promoteAdditive(BATCH, { liveDir: liveDir, registryPath: regPath }); } catch (e) { threw = e; }
    ok(threw && /already exists live/.test(threw.message), 'a second additive promote is refused on id collision');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log('----------------------------------');
console.log('REQ-0203 grave-legion: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
