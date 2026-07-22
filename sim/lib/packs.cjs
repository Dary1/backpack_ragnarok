'use strict';
// sim/lib/packs.cjs -- REQ-0047 (d): enemy pack compilation (enemy def schema v2).
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { freshStatusBag, foldBattleStartStatusVerbs } = require('./status.cjs');
const { deepCopy } = require('./core.cjs'); // REQ-0121
const { foldFlatBonusInPlace } = require('./hpbelow.cjs'); // REQ-0121
// REQ-0184: the A1 layout grammar. sim/ and server/ both import this from
// shared/ so there is exactly ONE definition of where a member stands --
// the placer and the machine check can never disagree about a cell.
const { parseA1, cellsFor } = require('../../shared/content_validate.cjs');

// REQ-0184: a pack def may now carry an explicit LAYOUT -- members[{enemy, at}]
// where `at` is an A1 top-left anchor -- which is the whole point of the
// monster_pack content kind: WHERE a monster stands is authored content, not a
// side effect of the order it happened to be listed in.
//
// Both spellings are accepted, and the choice is per-pack, not global:
//   * members[]  -> LAYOUT path: each member sits exactly where the def says.
//   * enemyIds[] -> LEGACY path: the pre-REQ-0184 cursor fill, kept
//     BYTE-IDENTICAL. sim/dungen.cjs still emits this shape at runtime, and
//     REQ-0185 (dungeons become pre-generated content) is what retires it. Until
//     then, deleting this path would break every generated dive.
// Normalising both to one member list up front keeps the HP/skill/status fold
// below untouched -- the golden contract is that a pack with no layout compiles
// exactly as it did before this REQ.
function packMembers(packDef, enemyDefsById, enemyFieldBox) {
  if (Array.isArray(packDef.members)) {
    return packDef.members.map((m) => {
      const def = enemyDefsById[m.enemy];
      if (!def) throw new Error('compileEnemyPack: missing enemy def ' + m.enemy);
      const anchor = parseA1(m.at);
      // shared/content_validate.cjs is what ADJUDICATES a layout (bounds,
      // overlap, references) and the machine check runs it before a variant is
      // ever adoptable. Here we only guard the one thing that would otherwise
      // throw a TypeError deep in the ray code instead of naming itself.
      if (!anchor) throw new Error('compileEnemyPack: pack ' + (packDef.id || '?') + ' member "' + m.enemy + '" has a malformed A1 anchor: ' + JSON.stringify(m.at));
      return { eid: m.enemy, def: def, fieldCells: cellsFor(anchor, def.footprint || [1, 1]) };
    });
  }
  // ---- legacy cursor fill (pre-REQ-0184, verbatim) ----
  let cursorRow = enemyFieldBox.rowMin, cursorCol = enemyFieldBox.colMin;
  return packDef.enemyIds.map((eid) => {
    const def = enemyDefsById[eid];
    if (!def) throw new Error('compileEnemyPack: missing enemy def ' + eid);
    const fp = def.footprint || [1, 1];
    const fh = fp[0], fw = fp[1];
    if (cursorCol + fw - 1 > enemyFieldBox.colMax) { cursorCol = enemyFieldBox.colMin; cursorRow += fh; }
    const fieldCells = [];
    for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) fieldCells.push([cursorRow + dr, cursorCol + dc]);
    cursorCol += fw;
    return { eid: eid, def: def, fieldCells: fieldCells };
  });
}

function compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, enemyFieldBox) {
  // enemyFieldBox: {rowMin,colMin,rowMax,colMax} region of the enemy field
  // this pack occupies. REQ-0184 corrected the caller to hand over the
  // PLACEABLE area (B2:Y17) rather than the whole A1:Z18 plane -- see
  // encounter.cjs. Only the legacy cursor path reads the box; a member with an
  // explicit anchor sits where the def says, and the machine check is what
  // keeps that anchor inside the placeable area.
  const hpStream = rng.stream('pack/hp');
  const members = packMembers(packDef, enemyDefsById, enemyFieldBox);
  const enemies = members.map((mem, idx) => {
    const eid = mem.eid, def = mem.def, fieldCells = mem.fieldCells;
    const hpMax = Math.round(hpStream.range(def.hp[0], def.hp[1]));
    const fp = def.footprint || [1, 1];
    const fh = fp[0], fw = fp[1];
    let skills = (def.skills || []).map(sid => {
      const sdef = skillDefsById[sid];
      if (!sdef) throw new Error('compileEnemyPack: missing skill def ' + sid);
      return sdef;
    });
    // REQ-0280: a PARALLEL id list (skills[i] <-> skillIds[i]) so ray_fire can
    // label the ray with its skills.json def id WITHOUT copying the shared skill
    // objects (REQ-0121's shared-ref invariant, asserted in sim/tests/run.cjs).
    const skillIds = (def.skills || []).slice();
    // REQ-0121: any buff_self on this enemy (battle_start fold now, or
    // on_hp_below fold at crossing time) mutates strike/multi_strike
    // n-ranges of THIS INSTANCE's skills -- deep-copy the whole skills
    // list up front so shared content defs are never touched. Enemies
    // without buff_self keep shared refs (zero golden impact).
    const hasBuffSelf = skills.some(s => s && s.verb && s.verb.t === 'buff_self');
    if (hasBuffSelf) skills = deepCopy(skills);
    // REQ-0093: battle_start status_immune / bonus_vs_status fold, from
    // this enemy's own skills list (an EnemySkill's own innate passive,
    // e.g. bone-and-sinew undead immune to Poison).
    const statusBag = freshStatusBag();
    const { immuneSet, bonusVsStatus, damageReductionRanges, buffSelfRanges } = foldBattleStartStatusVerbs(skills);
    statusBag._immune = immuneSet;
    // REQ-0121: resolve battle_start-folded scalars via a per-instance
    // named stream (named streams are independent -- adding these pulls
    // nothing from any existing stream, so goldens stay byte-identical
    // for content without the new verbs).
    let damageReduction = 0;
    for (const n of damageReductionRanges) {
      damageReduction += rng.stream('pack/fold/' + eid + '#' + idx).range(n[0], n[1]);
    }
    let buffSelfFlat = 0;
    for (const n of buffSelfRanges) {
      buffSelfFlat += rng.stream('pack/fold/' + eid + '#' + idx).range(n[0], n[1]);
    }
    if (buffSelfFlat) foldFlatBonusInPlace(skills, buffSelfFlat);
    return {
      id: eid + '#' + idx, defId: eid, name: def.name, hp: hpMax, hpMax,
      footprint: [fh, fw], fieldCells, skills, skillIds, statusBag, // REQ-0280: skillIds parallels skills
      alive: true, ownerId: eid + '#' + idx, bonusVsStatus,
      damageReduction, // REQ-0121 (0 when absent -- reduceIncoming no-ops)
    };
  });
  return enemies;
}

// =====================================================================
// Skill scheduling -- every_secs firing timers with mode-filter pause
// semantics (S6.2): a skill/effect whose modes don't match the active
// encounter's mode does not fire and its next-fire timer does not
// accumulate/backlog. Mechanism (documented interpretation, see
// sim/README.md): each schedulable effect tracks nextFireAt in "active
// time" (time actually spent in a matching-mode encounter). When a new
// encounter opens, every schedulable effect whose modes now match gets
// its timer RE-ANCHORED to the encounter's start time (nextFireAt =
// encounterStart + firstInterval) rather than carrying over any stale
// absolute-time value from a previous (possibly non-matching) encounter.
// This guarantees no backlog: elapsed wall-clock time in a non-matching
// encounter never counts for OR against a paused effect.

module.exports = {
  compileEnemyPack,
};
