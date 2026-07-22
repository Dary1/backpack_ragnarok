// sim/dungeon_roll.cjs -- REQ-0185: the dive ROLLER.
//
// A dungeon def (content kind `dungeon`, schema dungeon/1) is authored,
// PROBABILITY-WEIGHTED references to monster_pack defs and gimic defs
// (user ruling 2026-07-17). rollDungeon() turns one such def + a level +
// a seed into the CONCRETE encounter list combat.runDungeon() consumes --
// deterministically (the SAME (def, level, seed) triple is byte-identical).
// This REPLACES sim/dungen.cjs's runtime generation on the serving path:
// the dive is now a cheap weighted SELECT, not a graph build.
//
// ONE roller, shared by the sim serving path (server/services/runs.cjs) AND
// the forecast fold (server/lib/forecast.cjs), so the forecast can never
// forecast a composition the sim would not run -- the parity contract
// sim/tests/forecast_parity.cjs exists to protect.
//
// The concrete shape produced here is the EXACT shape sim/dungen.cjs already
// emitted (encounters with enemyPack:{packId} + REQ-0049 attachments), so
// sim/lib/{dungeon,encounter}.cjs consume it unchanged. Gimic -> attachment
// resolution mirrors dungen.cjs's own trap/chest/door builders VERBATIM,
// only parameterised by gimic id.
'use strict';

const path = require('path');
const combat = require(path.join(__dirname, 'combat.cjs'));
const { dungeonDoorStage2 } = require(path.join(__dirname, '..', 'shared', 'content_validate.cjs'));

// Reward vocabulary defaults -- the frost roll ids every dungeon def falls
// back to (each resolves through server/services/core.cjs
// REWARD_ROLL_TO_ITEM_ID). A def may override any of these via `rewards`.
const DEFAULT_REWARDS = {
  pack: 'reward_frost_shard_common',
  packHigh: 'reward_frost_shard_uncommon',
  chest: 'reward_frostbound_cache_roll',
  boss: 'reward_boss_relic_roll',
  trapDisarm: 'reward_frost_shard_common',
};

function resolveRewards(def) {
  const r = (def && def.rewards) || {};
  return {
    pack: r.pack || DEFAULT_REWARDS.pack,
    packHigh: r.packHigh || DEFAULT_REWARDS.packHigh,
    chest: r.chest || DEFAULT_REWARDS.chest,
    boss: r.boss || DEFAULT_REWARDS.boss,
    trapDisarm: r.trapDisarm || r.pack || DEFAULT_REWARDS.trapDisarm,
  };
}

// packEncounters(level) / gimicCount(level): simple, monotone-in-level,
// deterministic scaling of the COUNTS (Open Q4). base + one more every
// `perLevels` levels above levelMin, clamped to [floor, max]. NO RNG -- the
// seed only drives WHICH pack/gimic each slot draws, so the battle count a
// (def, level) forecasts is stable across seeds.
function bandCount(band, levelMin, level, floor) {
  const b = band || {};
  const base = Number.isFinite(b.base) ? b.base : floor;
  const per = Number.isFinite(b.perLevels) && b.perLevels > 0 ? b.perLevels : 3;
  const max = Number.isFinite(b.max) ? b.max : base;
  const lo = Number.isFinite(levelMin) ? levelMin : 1;
  const n = base + Math.floor((Math.max(lo, level) - lo) / per);
  return Math.max(floor, Math.min(max, n));
}
function packEncountersForLevel(def, level) {
  return bandCount(def.dive && def.dive.packEncounters, def.levelMin, level, 1);
}
function gimicCountForLevel(def, level) {
  return bandCount(def.dive && def.dive.gimicSlots, def.levelMin, level, 0);
}

// Weighted pick over a pool of {..., weight} rows, driven by one rng stream
// (0..1). Zero/negative/absent weights are ignored; an all-empty pool -> null.
function pickWeighted(pool, stream) {
  const rows = (pool || []).filter((r) => r && Number.isFinite(r.weight) && r.weight > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let x = stream.next() * total;
  for (const r of rows) { x -= r.weight; if (x < 0) return r; }
  return rows[rows.length - 1];
}
// Highest-weight row (for the authored summary's representative boss pack).
function topWeight(pool) {
  let best = null;
  for (const r of (pool || [])) {
    if (!r || !Number.isFinite(r.weight)) continue;
    if (!best || r.weight > best.weight) best = r;
  }
  return best;
}

// Build one REQ-0049 attachment from a gimic def, by its behavior. Mirrors
// sim/dungen.cjs's trapAttachment/chestAttachment/doorAttachment verbatim
// (same fields the sim's encounter.cjs reads), only parameterised by id.
function buildAttachment(gimicId, gimicDefsById, nextId, rewards) {
  const g = gimicDefsById && gimicDefsById[gimicId];
  if (!g) throw new Error('rollDungeon: gimicPool references gimic "' + gimicId + '", which has no def');
  if (g.behavior === 'trap') {
    return {
      id: nextId('att_trap'), gimicId, kind: 'trap', mode: 'detection',
      entity: { footprint: g.footprint, skills: g.skills || [], timeout_secs: g.timeout_secs },
      reward: { roll: rewards.trapDisarm },
    };
  }
  if (g.behavior === 'treasure') {
    return {
      id: nextId('att_chest'), gimicId, kind: 'chest', mode: 'unlock',
      entity: { footprint: g.footprint, hp: [g.hp, g.hp], timeout_secs: g.timeout_secs },
      reward: { roll: rewards.chest },
    };
  }
  if (g.behavior === 'hidden_door') {
    // The pool references the STAGE-1 (detection) id; the sim door attachment
    // is built from the STAGE-2 (unlock) fields (footprint/hp/timeout/skills),
    // exactly as dungen.doorAttachment did. The sim drives stage1->stage2.
    const s2 = dungeonDoorStage2(gimicId, gimicDefsById) || g;
    return {
      id: nextId('att_door'), gimicId, kind: 'door', mode: 'detection',
      entity: { footprint: s2.footprint, hp: [s2.hp, s2.hp], timeout_secs: s2.timeout_secs, skills: s2.skills || [] },
      reward: null,
    };
  }
  throw new Error('rollDungeon: gimic "' + gimicId + '" has unsupported behavior "' + g.behavior + '"');
}

/**
 * rollDungeon(def, level, seed, {gimicDefsById}) -> concrete dungeon def.
 * Deterministic: the SAME (def, level, seed) triple returns a byte-identical
 * (JSON.stringify-equal) encounter list. The returned doc is tagged
 * schema:'dungeon_dive/1' -- the ROLLED transient, distinct from the authored
 * dungeon/1 content kind (runDungeon reads `encounters`, never the schema).
 */
function rollDungeon(def, level, seed, opts) {
  if (!def || typeof def !== 'object') throw new Error('rollDungeon: def is required');
  const gimicDefsById = (opts && opts.gimicDefsById) || {};
  const sd = (seed === undefined || seed === null) ? 'dungeon-roll-default' : String(seed);
  const rng = combat.makeRng(sd);
  const lvl = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const rewards = resolveRewards(def);
  const nPacks = packEncountersForLevel(def, lvl);
  const nGimics = gimicCountForLevel(def, lvl);

  let seq = 0;
  const nextId = (p) => p + '_' + (seq++);

  // Roll the gimic attachments up front, then distribute them (cap 2/enc,
  // spilling onto the boss; overflow beyond capacity is dropped -- the same
  // posture dungen.cjs's own attachment distribution has).
  const atts = [];
  for (let i = 0; i < nGimics; i++) {
    const row = pickWeighted(def.gimicPool, rng.stream('gimic/pick/' + i));
    if (!row) break;
    atts.push(buildAttachment(row.gimic, gimicDefsById, nextId, rewards));
  }

  const encounters = [];
  let ai = 0;
  for (let i = 0; i < nPacks; i++) {
    const row = pickWeighted(def.packPool, rng.stream('pack/pick/' + i));
    const enc = {
      id: nextId('enc_pack'), type: 'pack', mode: 'battle',
      enemyPack: { packId: row ? row.packId : null },
      deadline_secs: 90, rewardItems: [rewards.pack],
    };
    const encAtts = [];
    while (ai < atts.length && encAtts.length < 2) encAtts.push(atts[ai++]);
    if (encAtts.length) enc.attachments = encAtts;
    encounters.push(enc);
  }

  const bossRow = pickWeighted(def.bossPool, rng.stream('boss/pick'));
  const bossEnc = {
    id: nextId('enc_boss'), type: 'boss', mode: 'battle',
    enemyPack: { packId: bossRow ? bossRow.packId : null },
    deadline_secs: 180, rewardItems: [rewards.boss],
  };
  const bossAtts = [];
  while (ai < atts.length && bossAtts.length < 2) bossAtts.push(atts[ai++]);
  if (bossAtts.length) bossEnc.attachments = bossAtts;
  encounters.push(bossEnc);

  return {
    schema: 'dungeon_dive/1',
    id: def.id, name: def.name, i18n: def.i18n || {}, theme: def.theme,
    dungeonDefId: def.id, level: lvl, rollSeed: sd,
    encounters,
  };
}

// diveSummary(def, {gimicDefsById, resolveRewardItemId}) -> the authored
// encounter summary the sortie UI dossier renders (design D3): expected pack
// count + gimic counts by class (a representative fixed-seed "scout" roll at
// the def's top level -- the REQ-0049 scout mechanism, re-keyed to the def),
// the representative boss pack, and a <=5 item-id loot preview.
function countKinds(rolled) {
  const c = { trap: 0, chest: 0, door: 0 };
  for (const e of rolled.encounters) for (const at of (e.attachments || [])) if (c[at.kind] != null) c[at.kind]++;
  return c;
}
function diveSummary(def, opts) {
  const o = opts || {};
  const gimicDefsById = o.gimicDefsById || {};
  const resolveRewardItemId = typeof o.resolveRewardItemId === 'function' ? o.resolveRewardItemId : (x) => x;
  const sampleLevel = Number.isFinite(def.levelMax) ? def.levelMax : (Number.isFinite(def.levelMin) ? def.levelMin : 1);
  const rolled = rollDungeon(def, sampleLevel, 'scout-' + def.id + '-' + sampleLevel, { gimicDefsById });
  const packs = rolled.encounters.filter((e) => e.type === 'pack').length;
  const gimics = countKinds(rolled);
  const bossRow = topWeight(def.bossPool);
  const rewards = resolveRewards(def);
  const rollIds = [rewards.pack, rewards.packHigh, rewards.chest, rewards.boss];
  const seen = new Set();
  const lootPreview = [];
  for (const rid of rollIds) {
    const iid = resolveRewardItemId(rid);
    if (iid && !seen.has(iid)) { seen.add(iid); lootPreview.push(iid); }
    if (lootPreview.length >= 5) break;
  }
  return { packs, gimics, bossPackId: bossRow ? bossRow.packId : null, lootPreview };
}

module.exports = {
  rollDungeon,
  diveSummary,
  packEncountersForLevel,
  gimicCountForLevel,
  pickWeighted,
  DEFAULT_REWARDS,
};
