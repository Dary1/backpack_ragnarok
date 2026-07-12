// sim/dungen.cjs -- REQ-0043 dungeon auto-generation.
//
// generate(dungeonType, level, seed) -> dungeon def, in EXACTLY the shape
// sim/combat.cjs's runDungeon() consumes (see sim/README.md's "Dungeon
// def (informal, this implementation's own schema)" section):
//   { id, name, encounters: [ {id,type,mode,enemyPack?,entityDef?,
//     timeout_secs?,deadline_secs?,rewardItems?}, ... ] }
//
// Two dungeonTypes:
//   - 'default': procedurally generated via the pack grammar below,
//     scaled by `level`. Deterministic: the SAME (dungeonType, level,
//     seed) triple always produces a byte-identical def (same encounter
//     count/order/composition/rewards) -- proven by a JSON.stringify
//     equality test in sim/tests/dungen_test.cjs.
//   - 'test_fixed': returns batch-002's own hand-authored dungeon.json
//     VERBATIM (deep-copied, so a caller can never mutate the cached
//     source doc) -- generator-independent fixed spawns, for
//     tests/dev that want a known, stable encounter sequence regardless
//     of seed/level.
//
// Uses sim/combat.cjs's OWN seeded RNG (makeRng) so the generator's rolls
// live in the same "named sub-stream, never desyncs an unrelated roll"
// discipline as every other roll in this codebase (S1.2) -- the
// generator's master seed is caller-supplied and independent of (never
// derived from) a run's own masterSeed; callers that want a dev-fixed
// dungeon LAYOUT and a separately-random combat RNG pass two different
// seeds to dungen.generate() and combat.runDungeon() respectively (see
// server/schedule.cjs wiring).
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const combat = require(path.join(__dirname, 'combat.cjs'));

// Content root resolution: os.homedir()-based, NOT __dirname-based --
// matches server/schedule.cjs's OWN REPO_ROOT convention exactly (see
// that file's header: `path.join(os.homedir(), 'backpack_ragnarok')`).
// This matters for more than style consistency: server/tests/
// api_test.cjs (and any other test harness that fakes os.homedir() to
// point at a synthetic fixture repo) relies on EVERY content-reading
// module resolving paths through os.homedir() so a faked home
// transparently redirects ALL content reads to the test fixture, not
// just schedule.cjs's own. An __dirname-relative path here would silently
// keep reading the REAL repo's content even while every other module
// was redirected to a fake one -- exactly the bug this comment now
// documents against regressing.
function repoRoot() { return path.join(os.homedir(), 'backpack_ragnarok'); }
function batchDir() { return path.join(repoRoot(), 'content', 'batches', 'batch-002-dungeon-pilot'); }
function dungeonFixedPath() { return path.join(batchDir(), 'dungeon.json'); }
function enemiesPath() { return path.join(batchDir(), 'enemies.json'); }
function entitiesPath() { return path.join(batchDir(), 'entities.json'); }

function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

// mtime-cached (same convention as server/schedule.cjs's own
// getScheduleContent()) rather than a load-once-forever cache -- a
// process that starts with one os.homedir() and later has it repointed
// (or whose on-disk fixture file changes, e.g. content hot-reload in
// dev) must not keep serving a stale first read forever. Each cache
// entry is keyed by the RESOLVED path itself, so a homedir change (which
// changes the resolved path) naturally misses the old cache entry
// instead of needing an explicit invalidation call.
const _fileCache = new Map(); // resolvedPath -> {mtimeMs, parsed}
function loadJsonCached(resolvedPath) {
  const mtimeMs = fs.statSync(resolvedPath).mtimeMs;
  const hit = _fileCache.get(resolvedPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.parsed;
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  _fileCache.set(resolvedPath, { mtimeMs, parsed });
  return parsed;
}

function loadFixedDungeon() {
  return loadJsonCached(dungeonFixedPath());
}

function loadEnemyRoster() {
  return loadJsonCached(enemiesPath()).entries;
}

function loadEntityTemplates() {
  const raw = loadJsonCached(entitiesPath());
  const byId = {};
  for (const e of raw.entries) byId[e.id] = e;
  return byId;
}

// =====================================================================
// Level-scaling knobs (all documented interpretations -- REQ-0043 gives
// no exact formulas beyond "scaled by level", matching the same
// AMBIGUITY RULE precedent sim/combat.cjs's own TUNABLES section
// already sets: pick a simple, monotone-in-level, deterministic scheme
// and cite it here rather than in a scattered inline comment).
// =====================================================================
const DUNGEN_TUNABLES = {
  // Number of pack (battle) encounters before the boss. Grows every 3
  // levels, capped so a generated dungeon never runs unboundedly long.
  PACKS_BASE: 2,
  PACKS_PER_3_LEVELS: 1,
  PACKS_MAX: 6,

  // Trap encounters: 0-2, more likely as level rises (soft scaling via
  // a level-derived probability curve, capped at 2 per the task brief).
  TRAP_MAX: 2,

  // Hidden-door chain (stage1 detection + stage2 unlock): 0 or 1.
  DOOR_CHAIN_MAX: 1,

  // Chest: 0 or 1.
  CHEST_MAX: 1,

  // Pack composition: base member count (before rarity/level bonuses)
  // and the extra members a higher pack rarity roll adds -- mirrors
  // combat.cjs's PACK_RARITY_WEIGHTS common/magic/rare tiers (S4.6) but
  // there is no magic/rare enemy roster yet in batch-002 (every entry is
  // "common"), so this generator's documented interpretation is: a
  // magic/rare rarity ROLL still draws from the same common roster, but
  // adds extra pack members (a tougher pack, not a tougher individual
  // enemy) -- consistent with "no formula given" per S4.6's own gap.
  PACK_BASE_MEMBERS: 2,
  PACK_RARITY_BONUS_MEMBERS: { common: 0, magic: 1, rare: 2 },
  PACK_MAX_MEMBERS: 5,

  // Reward roll ids -- reused verbatim from batch-002's own reward
  // vocabulary (server/schedule.cjs's REWARD_ROLL_TO_ITEM_ID already
  // resolves every one of these to a real live item id, so a generated
  // dungeon's rewards resolve through the EXACT SAME table with zero
  // server-side changes).
  REWARD_PACK_LOW: 'reward_frost_shard_common',
  REWARD_PACK_HIGH: 'reward_frost_shard_uncommon',
  REWARD_CHEST: 'reward_frostbound_cache_roll',
  REWARD_BOSS: 'reward_boss_relic_roll',

  // REQ-0049: probability (per run) of retaining ONE detection objective as a
  // standalone pure puzzle room (§6.2 pause-not-accumulate) instead of an attachment.
  PURE_ROOM_P: 0.1,
};

function packsForLevel(level) {
  const n = DUNGEN_TUNABLES.PACKS_BASE + Math.floor((level - 1) / 3) * DUNGEN_TUNABLES.PACKS_PER_3_LEVELS;
  return Math.max(1, Math.min(DUNGEN_TUNABLES.PACKS_MAX, n));
}

// rollCount: deterministic "0..max" roll whose probability of a higher
// count increases with level (documented interpretation: level/(level+4)
// chance per extra squad, i.e. asymptotically approaches max as level
// grows, staying near 0 at level 1). Uses its own named sub-stream so it
// never desyncs any other roll.
function rollCountForLevel(rng, streamName, max, level) {
  if (max <= 0) return 0;
  const stream = rng.stream(streamName);
  let count = 0;
  for (let i = 0; i < max; i++) {
    const pLevelUp = level / (level + 4);
    if (stream.next() < pLevelUp) count++;
    else break; // once a level fails to add one more, stop (monotone-ish, simple, deterministic)
  }
  return count;
}

function rollPackRarity(rng, streamName) {
  const stream = rng.stream(streamName);
  const r = stream.next();
  const w = combat.TUNABLES.PACK_RARITY_WEIGHTS;
  if (r < w.rare) return 'rare';
  if (r < w.rare + w.magic) return 'magic';
  return 'common';
}

function enemyWeight(def) {
  // "per-enemy hp-weight" (S4.6) -- midpoint of the def's [lo,hi] hp
  // range, the simplest single-number stand-in for "how much budget one
  // copy of this enemy costs" (documented interpretation, consistent
  // with combat.cjs's own hp-range-rolling convention elsewhere).
  return (def.hp[0] + def.hp[1]) / 2;
}

// buildPack: picks enemyIds for one pack encounter, bounded by the level
// budget (packBudgetForLevel) and the pack's own rolled rarity (extra
// member slots per DUNGEN_TUNABLES.PACK_RARITY_BONUS_MEMBERS). Always
// includes at least one 'line'-role enemy (a pack needs a front line);
// fills remaining slots by cycling role preference line -> support ->
// anchor, stopping once either the member cap or the hp-weight budget
// would be exceeded. Picks WITHIN each role via the seeded RNG so two
// different (type,level,seed) combos can differ in exact composition
// while staying deterministic for a FIXED seed.
function buildPack(rng, streamPrefix, roster, level) {
  const budget = combat.packBudgetForLevel(level);
  const rarity = rollPackRarity(rng, streamPrefix + '/rarity');
  const targetMembers = Math.min(
    DUNGEN_TUNABLES.PACK_MAX_MEMBERS,
    DUNGEN_TUNABLES.PACK_BASE_MEMBERS + DUNGEN_TUNABLES.PACK_RARITY_BONUS_MEMBERS[rarity]
  );

  const byRole = { line: [], support: [], anchor: [] };
  for (const def of roster) {
    if (def.pack_role === 'boss') continue; // boss roster never appears in a regular pack
    const role = byRole[def.pack_role] ? def.pack_role : 'line';
    byRole[role].push(def);
  }

  const pickStream = rng.stream(streamPrefix + '/pick');
  function pickFrom(list) {
    if (list.length === 0) return null;
    const idx = Math.floor(pickStream.next() * list.length);
    return list[Math.min(idx, list.length - 1)];
  }

  const roleOrder = ['line', 'support', 'anchor'];
  const chosen = [];
  let weightSum = 0;
  let roleIdx = 0;
  let guard = 0;
  while (chosen.length < targetMembers && guard < 50) {
    guard++;
    const role = roleOrder[roleIdx % roleOrder.length];
    roleIdx++;
    const candidates = byRole[role].length > 0 ? byRole[role] : byRole.line;
    const def = pickFrom(candidates);
    if (!def) continue;
    const w = enemyWeight(def);
    // Always accept the FIRST (line) member even if it alone would
    // exceed budget (a pack of zero enemies makes no sense); afterwards
    // respect the budget strictly.
    if (chosen.length > 0 && weightSum + w > budget) continue;
    chosen.push(def.id);
    weightSum += w;
  }
  if (chosen.length === 0) {
    // Degenerate roster guard (should not happen with batch-002's real
    // roster, which always has >=1 'line' entry) -- fall back to the
    // cheapest enemy available so a pack is never empty.
    const cheapest = roster.filter(d => d.pack_role !== 'boss').sort((a, b) => enemyWeight(a) - enemyWeight(b))[0];
    if (cheapest) chosen.push(cheapest.id);
  }
  return chosen;
}

function bossIdFor(roster) {
  const boss = roster.find(d => d.pack_role === 'boss');
  return boss ? boss.id : null;
}

// generateDefault: the procedural 'default' dungeonType. Builds the full
// encounter list per REQ-0043: pack count/composition scaled by level
// (via the pack grammar above), 0-2 traps, 0-1 hidden-door chain, 0-1
// chest, boss final. Interleave order (documented interpretation: no
// spec given for encounter ORDER beyond "boss final") -- packs and
// traps/doors/chest are interleaved in a fixed, seed-independent
// STRUCTURAL order (packs first with traps/door/chest woven in after
// every other pack once rolled) so the generated def's SHAPE (which
// indices hold which types) is stable and easy to reason about, while
// WHICH enemies/rarity/reward each slot gets is what the seed varies.
function generateDefault(level, seed) {
  const rng = combat.makeRng(seed);
  const roster = loadEnemyRoster();
  const entityTemplates = loadEntityTemplates();

  const nPacks = packsForLevel(level);
  const nTraps = rollCountForLevel(rng, 'dungen/traps/count', DUNGEN_TUNABLES.TRAP_MAX, level);
  const nDoorChains = rollCountForLevel(rng, 'dungen/doors/count', DUNGEN_TUNABLES.DOOR_CHAIN_MAX, level);
  const nChests = rollCountForLevel(rng, 'dungen/chest/count', DUNGEN_TUNABLES.CHEST_MAX, level);

  const encounters = [];
  let encSeq = 0;
  function nextId(prefix) { return prefix + '_' + (encSeq++); }

  // REQ-0049: traps/chests/doors are ATTACHMENTS on pack encounters (parallel
  // objectives on the battle clock), not standalone sequential encounters. We
  // build an attachment pool from the rolled counts and distribute it across
  // packs (cap <=2 per encounter, spilling onto the boss). A rare pure puzzle
  // room (PURE_ROOM_P) keeps ONE detection objective standalone.
  function trapAttachment() {
    const t = entityTemplates.trap_frost_deadfall;
    return { id: nextId('att_trap'), kind: 'trap', mode: 'detection',
      entity: { footprint: t.footprint, skills: t.skills, timeout_secs: t.timeout_secs },
      reward: { roll: DUNGEN_TUNABLES.REWARD_PACK_LOW } };
  }
  function chestAttachment() {
    const c = entityTemplates.chest_frostbound_cache;
    return { id: nextId('att_chest'), kind: 'chest', mode: 'unlock',
      entity: { footprint: c.footprint, hp: [c.hp, c.hp], timeout_secs: c.timeout_secs },
      reward: { roll: DUNGEN_TUNABLES.REWARD_CHEST } };
  }
  function doorAttachment() {
    const s2 = entityTemplates.door_rimefast_stage2;
    return { id: nextId('att_door'), kind: 'door', mode: 'detection',
      entity: { footprint: s2.footprint, hp: [s2.hp, s2.hp], timeout_secs: s2.timeout_secs, skills: s2.skills },
      reward: null };
  }
  const mkAttachment = (kind) => kind === 'trap' ? trapAttachment() : kind === 'chest' ? chestAttachment() : doorAttachment();

  const pool = [];
  for (let i = 0; i < nTraps; i++) pool.push('trap');
  for (let i = 0; i < nDoorChains; i++) pool.push('door');
  for (let i = 0; i < nChests; i++) pool.push('chest');

  // Rare pure puzzle room: pull one trap out of the pool (if any) and emit it
  // as a standalone detection encounter (entityDef path, retained by the sim).
  let pureRoom = false;
  if (pool.indexOf('trap') >= 0 && rng.stream('dungen/pureroom').next() < DUNGEN_TUNABLES.PURE_ROOM_P) {
    pool.splice(pool.indexOf('trap'), 1);
    pureRoom = true;
  }

  let pi = 0;
  for (let i = 0; i < nPacks; i++) {
    const enemyIds = buildPack(rng, 'dungen/pack/' + i, roster, level);
    const atts = [];
    while (pi < pool.length && atts.length < 2) atts.push(mkAttachment(pool[pi++]));
    const enc = { id: nextId('enc_pack'), type: 'pack', mode: 'battle', enemyPack: { enemyIds }, deadline_secs: 90, rewardItems: [DUNGEN_TUNABLES.REWARD_PACK_LOW] };
    if (atts.length) enc.attachments = atts;
    encounters.push(enc);
  }

  // A rare pure puzzle room sits just before the boss (its own encounter).
  if (pureRoom) {
    const t = entityTemplates.trap_frost_deadfall;
    encounters.push({
      id: nextId('enc_pureroom'), type: 'trap', mode: 'detection',
      entityDef: { id: t.id, name: t.name, hp: t.hp, footprint: t.footprint, masked: t.masked, timeout_secs: t.timeout_secs, skills: t.skills },
      timeout_secs: t.timeout_secs, deadline_secs: t.timeout_secs + 0.5,
    });
  }

  // Boss, always final, always present, always 100% pinned (S8.2). Any pool
  // overflow beyond pack capacity attaches here (still cap <=2).
  const bossId = bossIdFor(roster);
  const bossAtts = [];
  while (pi < pool.length && bossAtts.length < 2) bossAtts.push(mkAttachment(pool[pi++]));
  const bossEnc = { id: nextId('enc_boss'), type: 'boss', mode: 'battle', enemyPack: { enemyIds: bossId ? [bossId] : [] }, deadline_secs: 180, rewardItems: [DUNGEN_TUNABLES.REWARD_BOSS] };
  if (bossAtts.length) bossEnc.attachments = bossAtts;
  encounters.push(bossEnc);

  return {
    schema: 'dungeon/1',
    id: 'generated_default_lv' + level,
    name: 'Generated Dungeon (Lv.' + level + ')',
    i18n: {
      en: { name: 'Generated Dungeon (Lv.' + level + ')' },
      ja: { name: '自動生成ダンジョン（Lv.' + level + '）' },
    },
    dungeonType: 'default',
    level,
    generatorSeed: seed,
    encounters,
  };
}

// generateTestFixed: returns batch-002's hand-authored dungeon.json
// VERBATIM (deep-copied so the cache is never mutated by a caller), per
// REQ-0043's "generator-independent fixed spawns for tests/dev" -- level
// and seed are accepted but IGNORED (the whole point of this type is a
// known, stable sequence regardless of either), except that the doc's
// own `level`/`generatorSeed` echo fields are still set for caller
// introspection/logging symmetry with generateDefault's return shape.
function generateTestFixed(level, seed) {
  const fixed = deepCopy(loadFixedDungeon());
  fixed.dungeonType = 'test_fixed';
  fixed.level = level;
  fixed.generatorSeed = seed;
  return fixed;
}

// REQ-0049: scouting report -- expected trap/chest/door counts for a
// dungeon+level (room-create / dungeon-info hint). A fixed per-level scouting
// seed makes the report a stable, representative preview.
function countAttachments(def) {
  const c = { trap: 0, chest: 0, door: 0 };
  for (const e of def.encounters) {
    for (const at of (e.attachments || [])) if (c[at.kind] != null) c[at.kind]++;
    if (e.entityDef && c[e.type] != null) c[e.type]++; // rare standalone pure-room
  }
  return c;
}
function scoutingReport(dungeonType, level) {
  const gen = GENERATORS[dungeonType];
  if (!gen) throw new Error('scoutingReport: unknown dungeonType ' + dungeonType);
  return countAttachments(gen(level, 'scout-' + dungeonType + '-' + level));
}

const GENERATORS = {
  default: generateDefault,
  test_fixed: generateTestFixed,
};

const DUNGEON_TYPES = Object.keys(GENERATORS);

/**
 * generate(dungeonType='default', level, seed) -> dungeon def.
 * Deterministic: the SAME (dungeonType, level, seed) triple always
 * returns a byte-identical (JSON.stringify-equal) def. Throws on an
 * unknown dungeonType (caller's job to validate against DUNGEON_TYPES
 * first if a friendlier 400 is wanted -- see server/schedule.cjs).
 */
function generate(dungeonType, level, seed) {
  const type = dungeonType || 'default';
  const gen = GENERATORS[type];
  if (!gen) throw new Error('dungen.generate: unknown dungeonType ' + JSON.stringify(type) + ' (known: ' + DUNGEON_TYPES.join(', ') + ')');
  const lvl = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const sd = (seed === undefined || seed === null) ? 'dungen-default-seed' : String(seed);
  return gen(lvl, sd);
}

module.exports = {
  generate,
  scoutingReport,
  DUNGEON_TYPES,
  DUNGEN_TUNABLES,
  packsForLevel,
  rollCountForLevel,
  rollPackRarity,
  buildPack,
  loadEnemyRoster,
  loadEntityTemplates,
  loadFixedDungeon,
};
