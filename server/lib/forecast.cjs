'use strict';
// server/lib/forecast.cjs -- REQ-0057 Ray Forecast Overlay: the CONTENT
// half of the forecast.
//
// Division of labour (REQ-0057 ratified "client walker preferred -- zero
// server state"):
//   - THIS module answers "which rays does a level-L <type> dungeon throw
//     at the player field, how often, and from where?" -- a pure fold over
//     enemy DEFs. It is content, not run state: it never touches a room, a
//     profile, a seed a player will actually roll, or a hidden placement,
//     so it can never leak a spoiler (REQ-0057: "uses enemy DEFs, never a
//     specific run's hidden placements -- forecast != spoiler").
//   - shared/forecast.mjs (the CLIENT) answers "given those rays and MY
//     board, how hot is each cell?" -- the geometry walk. No server state,
//     no telemetry cache, recomputed client-side on every board edit.
//
// Why the server has to supply the profiles at all: GET /api/content
// serves items/sis/tms/trees/scenario only -- enemy defs and skill
// attack_profiles live in content/live/dungeon/{enemies,skills}.json and
// have never been exposed. The client cannot walk a ray it cannot see the
// edge/pen/aoe of. (The REQ's alternative -- an S4-B2 telemetry heatmap
// cache -- was NOT taken: it would put per-(dungeon,level,formation)
// derived state on the server, which the ratified design explicitly
// prefers to avoid.)
//
// ---------------------------------------------------------------------
// How a (dungeonType, level) becomes a profile list
// ---------------------------------------------------------------------
// A generated dungeon's composition depends on a SEED that does not exist
// yet when the player is building a backpack -- so the honest forecast is
// the MARGINAL over seeds, not one arbitrary draw. We therefore run
// dungen.generate() over a fixed ladder of sample seeds, compile each
// battle encounter's pack with the sim's OWN compileEnemyPack() (so the
// attackers' field placement -- hence their centroids, hence their ray
// entry cells -- is the real thing, not a re-derivation that could drift),
// and fold every (enemy instance, skill) into a profile weighted by
//     weight = (times this attacker appeared) / (battle encounters sampled)
// i.e. the EXPECTED NUMBER of such attackers in a randomly drawn battle of
// this dungeon. Summing pressure over the profiles therefore reads as
// "expected incoming DPS in a typical fight here" -- exactly the
// distribution REQ-0057 asks to be shown, and never a promise about one
// specific run ("label it 'expected pressure', never 'safe/unsafe'").
//
// 'test_fixed' is seed-independent by construction, so it samples ONE seed.
const combat = require('../../sim/combat.cjs');
const dungen = require('../../sim/dungen.cjs');
const { getScheduleContent } = require('../services/core.cjs');

// ---------------------------------------------------------------------
// Tunables (this module's own -- forecast presentation policy, distinct
// from sim TUNABLES which govern real combat math).
// ---------------------------------------------------------------------
const FORECAST_TUNABLES = {
  // [TUNABLE] How many dungen seeds to marginalise over. 24 sampled
  // dungeons x up to 7 encounters is a few ms of node time and is
  // mtime+arg-cached below, while being far more than enough to stabilise
  // a roster of 7 enemies (the pack grammar draws from 3 role buckets).
  SAMPLE_SEEDS: 24,
  // [TUNABLE] Deterministic seed ladder. Fixed strings, NOT time- or
  // request-derived: the same (type, level) must always return the same
  // payload, or the overlay would shimmer between reloads.
  SEED_PREFIX: 'forecast/',
  // Levels are clamped to the same floor dungen.generate() uses.
  LEVEL_MIN: 1,
  // [TUNABLE] Ceiling on the level a caller may ask about -- a guard, not
  // a game rule (the fold is O(level) via packsForLevel's own PACKS_MAX
  // cap, so this is cheap insurance against a silly ?level=1e9).
  LEVEL_MAX: 99,
};

// Verbs that actually put something on the player's field. Everything else
// in the vocab (buff_self, damage_reduction, status_immune, heal...) is an
// enemy-side effect with no incoming ray, so it has no place in an
// INCOMING-pressure map.
const DAMAGE_VERBS = new Set(['strike', 'multi_strike']);
const STATUS_VERBS = new Set(['apply_status', 'add_on_hit_status']);

/** Midpoint of an authored [lo,hi] range. Mirrors shared/forecast.mjs's rangeMid. */
function rangeMid(n) {
  if (!Array.isArray(n) || n.length === 0) return 0;
  if (n.length === 1) return n[0];
  return (n[0] + n[1]) / 2;
}

function expectedDamagePerFire(verb) {
  if (!verb) return 0;
  if (verb.t === 'strike') return rangeMid(verb.n);
  if (verb.t === 'multi_strike') return rangeMid(verb.n) * (verb.hits || 1);
  return 0;
}

function ratePerSec(trigger) {
  if (!trigger || trigger.t !== 'every_secs') return 0;
  const mid = rangeMid(trigger.s);
  return mid > 0 ? 1 / mid : 0;
}

function clampLevel(level) {
  const n = Number.isFinite(level) ? Math.floor(level) : FORECAST_TUNABLES.LEVEL_MIN;
  return Math.max(FORECAST_TUNABLES.LEVEL_MIN, Math.min(FORECAST_TUNABLES.LEVEL_MAX, n));
}

// ---------------------------------------------------------------------
// buildForecast(dungeonType, level) -> the wire payload.
// ---------------------------------------------------------------------
function buildForecast(dungeonType, level) {
  const type = dungeonType || 'default';
  if (!dungen.DUNGEON_TYPES.includes(type)) {
    // House error convention (types/coded-error.d.ts): services throw a
    // plain Error tagged with a machine-readable `code`; the route maps
    // code -> HTTP status. Never an HTTP status on the error itself.
    throw Object.assign(
      new Error('unknown dungeonType ' + JSON.stringify(type) +
        ' (known: ' + dungen.DUNGEON_TYPES.join(', ') + ')'),
      { code: 'BAD_REQUEST' });
  }
  const lvl = clampLevel(level);
  const { enemyDefsById, skillDefsById, skillNamesById, formationsDoc } = getScheduleContent();

  // 'test_fixed' ignores level and seed entirely (it replays batch-002's
  // hand-authored dungeon.json verbatim), so sampling it 24 times would
  // fold 24 byte-identical dungeons -- correct but pointless work.
  const seedCount = (type === 'test_fixed') ? 1 : FORECAST_TUNABLES.SAMPLE_SEEDS;
  const seeds = [];
  for (let i = 0; i < seedCount; i++) seeds.push(FORECAST_TUNABLES.SEED_PREFIX + type + '/' + lvl + '/' + i);

  const enemyFieldBox = {
    rowMin: 1, colMin: 1,
    rowMax: combat.FIELD_ROWS, colMax: combat.FIELD_COLS,
  };

  /** key -> accumulating profile */
  const byKey = new Map();
  let battles = 0;

  for (const seed of seeds) {
    const def = dungen.generate(type, lvl, seed);
    for (const enc of (def.encounters || [])) {
      // Only BATTLE encounters throw damaging rays at the player field.
      // Traps/doors/chests fire in 'detection'/'unlock' mode (a hit is a
      // find, "damage irrelevant" -- sim/lib/skills.cjs dealHitOnField),
      // and REQ-0049 made them parallel ATTACHMENTS on a battle clock
      // rather than standalone rooms, so the battle they ride on is
      // already counted. Excluded, deliberately.
      if (!enc.enemyPack || (enc.type !== 'pack' && enc.type !== 'boss')) continue;
      battles++;

      // Compile with the SIM's own pack compiler so placement (hence
      // centroid, hence entry projection) is identical to what a real run
      // would produce. compileEnemyPack's only RNG use is the HP roll and
      // the REQ-0121 fold streams -- neither touches fieldCells -- so a
      // throwaway seeded rng here cannot make placement non-deterministic.
      const rng = combat.makeRng('forecast/pack/' + seed + '/' + enc.id);
      const enemies = combat.compileEnemyPack(enc.enemyPack, enemyDefsById, skillDefsById, rng, enemyFieldBox);

      for (const en of enemies) {
        const centroid = combat.centroidRoundHalfUp(en.fieldCells);
        const defEntry = enemyDefsById[en.defId] || {};
        for (const skillId of (defEntry.skills || [])) {
          const sk = skillDefsById[skillId];
          if (!sk || !sk.verb) continue;
          const isDamage = DAMAGE_VERBS.has(sk.verb.t);
          const isStatus = STATUS_VERBS.has(sk.verb.t);
          if (!isDamage && !isStatus) continue; // enemy-side buff/ward: no incoming ray
          const modes = sk.modes || ['battle'];
          if (!modes.includes('battle')) continue;
          const rate = ratePerSec(sk.trigger);
          // No every_secs cadence = not a recurring incoming ray (a
          // battle_start passive, or a REQ-0078 OnSquadBeenHit retaliation
          // rider that only exists if YOU hit first). A per-second pressure
          // map has nothing honest to say about those, so they are left out
          // rather than given an invented rate.
          if (!(rate > 0)) continue;

          const ap = sk.attack_profile || {};
          const key = en.defId + '#' + skillId + '@' + centroid[0] + ',' + centroid[1];
          const hit = byKey.get(key);
          if (hit) { hit.count += 1; continue; }
          byKey.set(key, {
            key,
            count: 1,
            enemyId: en.defId,
            skillId,
            i18n: skillNamesById[skillId] || { en: { name: skillId }, ja: { name: skillId } },
            enemyI18n: defEntry.i18n || { en: { name: en.defId }, ja: { name: en.defId } },
            centroid,
            edges: (ap.edge && ap.edge.length) ? ap.edge.slice() : ['top'],
            penetration: ap.penetration || 0,
            aoe: ap.aoe || 0,
            aoeStatuses: !!ap.aoe_statuses,
            damage: expectedDamagePerFire(sk.verb),
            rate,
            statusOnly: !isDamage && isStatus,
          });
        }
      }
    }
  }

  const profiles = Array.from(byKey.values()).map((p) => {
    const out = Object.assign({}, p, { weight: battles > 0 ? p.count / battles : 0 });
    delete out.count;
    return out;
  });
  // Stable order (hottest first, then by key) so the payload is
  // byte-reproducible for a given (type, level) -- the cache and any
  // golden/E2E assertion depend on it.
  profiles.sort((a, b) =>
    (b.weight * b.rate * b.damage) - (a.weight * a.rate * a.damage) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // The IDENTICAL formation shape listDungeonsAndFormations() serves (id +
  // flat name + i18n + canvases), deliberately -- so the client's one
  // ApiFormationEntry type and its one localizedName() helper work against
  // either payload with no widening and no second code path.
  const formations = (formationsDoc.entries || []).map((f) => ({
    id: f.id,
    name: (f.i18n && f.i18n.en && f.i18n.en.name) || f.id,
    i18n: f.i18n || {},
    canvases: f.canvases,
  }));

  return {
    dungeonType: type,
    level: lvl,
    sampleSeeds: seeds.length,
    battlesSampled: battles,
    bounds: { ROWS: combat.FIELD_ROWS, COLS: combat.FIELD_COLS },
    jitterHalfWidth: combat.TUNABLES.ENTRY_JITTER_HALF_WIDTH,
    formations,
    profiles,
  };
}

// ---------------------------------------------------------------------
// Cache. buildForecast() is a pure function of (type, level) + the
// content files, so it is memoised per (type, level) and invalidated
// exactly the way every other content cache in this server is: by
// delegating the freshness question to getScheduleContent(), whose own
// mtime check re-reads content/live/dungeon/* when it changes. We key the
// memo on the object identity of that payload -- a content edit produces a
// NEW payload object, which misses the memo and rebuilds. No mtime logic
// duplicated here, and no way for the two caches to disagree.
// ---------------------------------------------------------------------
let memo = { contentRef: null, byArgs: new Map() };

function getForecast(dungeonType, level) {
  const content = getScheduleContent();
  if (memo.contentRef !== content) memo = { contentRef: content, byArgs: new Map() };
  const type = dungeonType || 
