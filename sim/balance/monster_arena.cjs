'use strict';
// sim/balance/monster_arena.cjs -- REQ-0296: headless monster-vs-monster arena.
//
// Builds TWO enemy-provenance IBattleInstancesFormationMaps (each from a
// monster_pack via the EXISTING enemy compile path -- compileEnemyPack +
// makeEnemyActor + buildEnemyInstance), sets them as mutual opponents/allies
// (REQ-0296 side-agnostic binding), and drives them with the SHARED battle tick
// (battle.cjs -> formation_map.cjs -> IBattleInstance.tick -> fire). The `fire`
// is the SHARED fireEnemyInstanceSlot lifted out of encounter.cjs -- NO forked
// combat logic. Returns a deterministic { winner, ...margin } for a given
// (packA, packB, effLevelA, effLevelB, seed).
//
// KNOWN LIMITATION (REQ-0296, documented -- not silently dropped): the struck
// group's reactive OnSquadBeenHit RETALIATION is dispatched only inside the BP
// fire body, so pure monster-vs-monster measures TIMED-SKILL combat (+ offensive
// OnHit/OnSquadHit riders + status DoTs + heal_ally) only; a struck monster group
// does NOT fire its OnSquadBeenHit skills back. Generalising that dispatch
// symmetrically is a clean phase-2 (see the REQ). Timed-skill combat is what the
// effLevel handicap tie-search (REQ design step 4) needs.
const fs = require('fs');
const path = require('path');
const { makeRng } = require('../lib/rng.cjs');
const { compileEnemyPack } = require('../lib/packs.cjs');
const { makeEnemyActor, effectStreamName } = require('../lib/skills.cjs');
const { buildEnemyInstance } = require('../lib/compile.cjs');
const { createBattle } = require('../lib/battle.cjs');
const { createFormationMap } = require('../lib/formation_map.cjs');
const { fireEnemyInstanceSlot, tickAndEmit } = require('../lib/encounter.cjs');
const { TUNABLES, secsToTicks } = require('../lib/core.cjs');
const { FIELD_ROWS, FIELD_COLS } = require('../lib/field.cjs');
const { SeqCounter } = require('../lib/seq.cjs');
const levelScale = require('../lib/level_scale.cjs');

const REPO = path.join(__dirname, '..', '..');

// Load the live dungeon content the same way tools/balance_sim.cjs loadDefs does.
function loadContent() {
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'dungeon', f), 'utf8'));
  const enemies = rd('enemies.json');
  const enemyDefsById = {}; for (const e of enemies.entries) enemyDefsById[e.id] = e;
  const skillsRaw = rd('skills.json');
  const skillDefsById = {}; for (const s of skillsRaw.entries) skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
  const packs = rd('packs.json');
  const monsterPackDefsById = {}; for (const p of packs.entries) monsterPackDefsById[p.id] = p;
  let scaling = null;
  try { scaling = levelScale.loadProfile(JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'scaling_profile.json'), 'utf8'))); } catch (e) { scaling = null; }
  return { enemyDefsById, skillDefsById, monsterPackDefsById, scaling };
}

// Place side B in the lower field band: no live pack is 9 rows tall, so the two
// packs never share a cell. Targeting filters by the opponents() actor LIST (not
// geometry), and the ray's 5-bounce hit-all reaches every live opponent, so exact
// placement is not load-bearing -- this just keeps the two footprints disjoint.
const ARENA_ROW_OFFSET = 9;

// Compile one enemy-provenance side from a monster_pack. `tag` prefixes the
// instance ids so the two sides' per-owner RNG streams AND event ids stay
// independent; `rowOffset` drops the whole side into a distinct field band.
function buildSide(packDef, defs, rng, effLevel, tag, rowOffset) {
  const box = { rowMin: 2, colMin: 2, rowMax: FIELD_ROWS - 1, colMax: FIELD_COLS - 1 };
  const scaleOpts = defs.scaling ? { scaling: defs.scaling, effLevel } : { effLevel };
  const compiled = compileEnemyPack(packDef, defs.enemyDefsById, defs.skillDefsById, rng, box, scaleOpts);
  const pairs = compiled.map((en) => {
    en.ownerId = tag + en.ownerId;
    en.id = tag + en.id;
    if (rowOffset) en.fieldCells = en.fieldCells.map(([r, c]) => [r + rowOffset, c]);
    return { raw: en, actor: makeEnemyActor(en) };
  });
  const actors = pairs.map((p) => p.actor);
  const instances = pairs.map((p) => buildEnemyInstance(p.raw, p.actor));
  return { pairs, actors, instances };
}

function runMonsterArena(opts) {
  const {
    packA, packB, effLevelA = 0, effLevelB = 0, seed = 'arena',
    deadlineSecs = 180, defs: injectedDefs, keepEvents = false,
  } = opts;
  const defs = injectedDefs || loadContent();
  const packDefA = defs.monsterPackDefsById[packA];
  const packDefB = defs.monsterPackDefsById[packB];
  if (!packDefA) throw new Error('monster_arena: unknown packA "' + packA + '"');
  if (!packDefB) throw new Error('monster_arena: unknown packB "' + packB + '"');

  // Independent, seed-derived sub-streams: compile A, compile B, and the battle
  // (fire timing/damage). All deterministic functions of `seed`.
  const rngA = makeRng(seed + '|packA');
  const rngB = makeRng(seed + '|packB');
  const rng = makeRng(seed + '|battle');

  const A = buildSide(packDefA, defs, rngA, effLevelA, 'A|', 0);
  const B = buildSide(packDefB, defs, rngB, effLevelB, 'B|', ARENA_ROW_OFFSET);

  const events = [];
  const seq = new SeqCounter();
  const TICK = TUNABLES.TICK_SECS;
  const tickT = (k) => k * TICK;
  const LEAD_TICKS = secsToTicks(TUNABLES.TELEGRAPH_LEAD_SECS);
  const STATUS_TICK_TICKS = secsToTicks(TUNABLES.STATUS_TICK_PERIOD_SECS);
  const deadlineTicks = secsToTicks(deadlineSecs);
  const NOOP = () => {};

  // The shared fire: every instance is enemy-provenance, so every slot runs the
  // extracted enemy body. dispatchDefensive is a no-op and chargeMgr is null
  // (both are player-side machinery, inert here).
  let curNow = 0, curTick = 0;
  const fire = (inst, cd) => fireEnemyInstanceSlot(inst, cd, {
    rng, events, seq, t: curNow, simTick: curTick, LEAD_TICKS, tickT,
    dispatchDefensive: NOOP, chargeMgr: null, feedCharge: NOOP,
  });
  // Enemy-path cooldown roll (mult 1.0, no mode filter) -- mirrors runEncounter's
  // enemy initCooldowns/rollCooldownTicks branch exactly.
  const rollTicks = (inst, cd) => {
    const sRange = cd.effect.trigger.s;
    const stream = rng.stream(effectStreamName(cd.ownerUid, cd.effIdx) + '/timing');
    return secsToTicks(stream.range(sRange[0], sRange[1]) * 1.0);
  };

  // Mutual opponents/allies (REQ-0296 side-agnostic binding); Battle propagates
  // them onto each map's instances (late-bound, resolved at fire time).
  const mapA = createFormationMap({ instances: A.instances, opponents: () => B.actors, allies: () => A.actors });
  const mapB = createFormationMap({ instances: B.instances, opponents: () => A.actors, allies: () => B.actors });
  const battle = createBattle({ playerMap: mapA, enemyMap: mapB, modeConfig: null, fire, rollCooldownTicks: rollTicks });
  battle.initCooldowns(rollTicks);

  const aDead = () => A.actors.every((a) => !a.alive);
  const bDead = () => B.actors.every((a) => !a.alive);

  let winner = null, endTick = 0;
  for (; battle.tickIndex <= deadlineTicks; battle.tickIndex++) {
    const t = battle.t();
    curNow = t; curTick = battle.tickIndex;
    if (battle.tickIndex > 0 && battle.tickIndex % STATUS_TICK_TICKS === 0) {
      for (const p of A.pairs) if (p.actor.alive) tickAndEmit(p.actor, t, events);
      for (const p of B.pairs) if (p.actor.alive) tickAndEmit(p.actor, t, events);
    }
    battle.tick(); // THE shared chain (mapA fires, then mapB fires, then ray phases)
    const ad = aDead(), bd = bDead();
    if (ad || bd) { endTick = battle.tickIndex; winner = (ad && bd) ? 'draw' : (bd ? 'A' : 'B'); break; }
  }
  if (winner === null) { winner = 'timeout'; endTick = Math.min(battle.tickIndex, deadlineTicks); }

  const sumHp = (arr) => arr.reduce((s, a) => s + a.hp(), 0);
  const sumMax = (arr) => arr.reduce((s, a) => s + a.hpMax(), 0);
  const aHp = sumHp(A.actors), bHp = sumHp(B.actors), aMax = sumMax(A.actors), bMax = sumMax(B.actors);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const aFrac = aMax ? aHp / aMax : 0, bFrac = bMax ? bHp / bMax : 0;
  return {
    winner, packA, packB, effLevelA, effLevelB, seed,
    endTick, seconds: r4(tickT(endTick)),
    a: { pack: packA, alive: A.actors.filter((a) => a.alive).length, total: A.actors.length, hp: Math.round(aHp), hpMax: aMax, hpFrac: r4(aFrac) },
    b: { pack: packB, alive: B.actors.filter((a) => a.alive).length, total: B.actors.length, hp: Math.round(bHp), hpMax: bMax, hpFrac: r4(bFrac) },
    hpMargin: r4(Math.abs(aFrac - bFrac)),
    eventCount: events.length,
    events: keepEvents ? events : undefined,
  };
}

module.exports = { runMonsterArena, loadContent, ARENA_ROW_OFFSET };

// CLI smoke: `node sim/balance/monster_arena.cjs [packA] [packB] [seed] [effA] [effB]`
if (require.main === module) {
  const args = process.argv.slice(2);
  const defs = loadContent();
  const ids = Object.keys(defs.monsterPackDefsById);
  const packA = args[0] || ids[0];
  const packB = args[1] || ids[1];
  const seed = args[2] || 'arena-smoke';
  const effA = args[3] != null ? Number(args[3]) : 0;
  const effB = args[4] != null ? Number(args[4]) : 0;
  const res = runMonsterArena({ packA, packB, effLevelA: effA, effLevelB: effB, seed, defs });
  // Determinism demonstration: a second identical run must match.
  const res2 = runMonsterArena({ packA, packB, effLevelA: effA, effLevelB: effB, seed, defs });
  const deterministic = JSON.stringify(res) === JSON.stringify(res2);
  console.log('[monster_arena] ' + packA + ' (eff ' + effA + ') vs ' + packB + ' (eff ' + effB + ') seed=' + seed);
  console.log('  winner=' + res.winner + '  seconds=' + res.seconds + '  ticks=' + res.endTick + '  deterministic=' + deterministic);
  console.log('  A ' + packA + ': ' + res.a.alive + '/' + res.a.total + ' alive, hp ' + res.a.hp + '/' + res.a.hpMax + ' (frac ' + res.a.hpFrac + ')');
  console.log('  B ' + packB + ': ' + res.b.alive + '/' + res.b.total + ' alive, hp ' + res.b.hp + '/' + res.b.hpMax + ' (frac ' + res.b.hpFrac + ')');
  console.log('  hpMargin=' + res.hpMargin + '  events=' + res.eventCount);
}
