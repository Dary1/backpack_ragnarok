'use strict';
// sim/balance/inject.cjs -- REQ-0269: enemy/skill candidate injection + arena.
//
// Combat has no in-battle decisions, so enemy-side candidates are evaluated by
// injecting them into a live monster pack and running that pack against a
// player squad. The injection is structural and deterministic (no RNG):
//   skill candidate -> the member at `slot` is swapped for a clone of its enemy
//     whose skills list is REPLACED by [candidateSkillId] (skill + enemy clone
//     registered under sentinel ids; the member's board position is unchanged).
//   enemy candidate  -> the candidate enemy is appended to the pack at a fixed
//     board slot (`at`), its def registered (referenced skills must resolve).
// The baseline arm is the SAME arena with the UNMODIFIED pack, so a metric delta
// is attributable solely to the candidate.
//
// arenaDungeon builds a boss-less run of N pack encounters referencing the pack,
// which isolates the candidate's combat effect from trap/door/chest/boss noise.
// (computeEncounterDeltas splits 100% evenly with no boss, so surviving all N
// reaches victory; dying is a wipe -- exactly the win/wipe signal we compare.)

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function arenaDungeon(packId, n) {
  const encounters = [];
  for (let i = 0; i < n; i++) encounters.push({ id: 'arena_pack_' + i, type: 'pack', mode: 'battle', enemyPack: { packId }, deadline_secs: 90 });
  return { schema: 'dungeon/1', id: 'balance_arena', name: 'Balance Arena', encounters };
}

// Returns augmented { enemyDefsById, skillDefsById, monsterPackDefsById,
// injectedMember } for the CANDIDATE arm. Base maps are shallow-copied; only the
// target pack (and sentinel enemy/skill) are added -- callers keep the originals
// for the baseline arm.
function injectIntoPack(opts) {
  const { kind, candidateDef, enemyDefsById, skillDefsById, monsterPackDefsById, packId } = opts;
  const slot = opts.slot || 0;
  const pack = monsterPackDefsById[packId];
  if (!pack) throw new Error('inject: unknown pack "' + packId + '"');
  const packClone = clone(pack);
  const eById = Object.assign({}, enemyDefsById);
  const sById = Object.assign({}, skillDefsById);
  let injectedMember;
  if (kind === 'skill') {
    if (!packClone.members || !packClone.members.length) throw new Error('inject: pack "' + packId + '" has no members to swap');
    const skId = candidateDef.id;
    sById[skId] = { trigger: candidateDef.trigger, verb: candidateDef.verb, attack_profile: candidateDef.attack_profile, modes: candidateDef.modes || ['battle'] };
    const mslot = Math.max(0, Math.min(slot, packClone.members.length - 1));
    const member = packClone.members[mslot];
    const baseEnemy = enemyDefsById[member.enemy];
    if (!baseEnemy) throw new Error('inject: member enemy "' + member.enemy + '" not found');
    const enemyClone = clone(baseEnemy);
    enemyClone.id = '__cand_skill_host_' + member.enemy;
    enemyClone.skills = [skId];
    eById[enemyClone.id] = enemyClone;
    member.enemy = enemyClone.id;
    injectedMember = { slot: mslot, enemy: enemyClone.id, skill: skId };
  } else if (kind === 'enemy') {
    const enemyClone = clone(candidateDef);
    eById[enemyClone.id] = enemyClone;
    const at = opts.at || 'D2';
    packClone.members = (packClone.members || []).slice();
    packClone.members.push({ enemy: enemyClone.id, at });
    injectedMember = { slot: packClone.members.length - 1, enemy: enemyClone.id, at };
  } else {
    throw new Error('inject: kind must be "skill" or "enemy", got "' + kind + '"');
  }
  const pById = Object.assign({}, monsterPackDefsById, { [packId]: packClone });
  return { enemyDefsById: eById, skillDefsById: sById, monsterPackDefsById: pById, injectedMember };
}

module.exports = { arenaDungeon, injectIntoPack };
