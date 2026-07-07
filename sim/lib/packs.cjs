'use strict';
// sim/lib/packs.cjs -- REQ-0047 (d): enemy pack compilation (enemy def schema v2).
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { freshStatusBag, foldBattleStartStatusVerbs } = require('./status.cjs');

function compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, enemyFieldBox) {
  // enemyFieldBox: {rowMin,colMin,rowMax,colMax} region of the enemy field
  // this pack occupies (bosses/packs placed within the shared A1:Z18
  // enemy plane; for simplicity/documented-interpretation this sim places
  // pack members left-to-right starting at the box's top-left corner,
  // spaced by footprint width, wrapping rows as needed).
  const hpStream = rng.stream('pack/hp');
  let cursorRow = enemyFieldBox.rowMin, cursorCol = enemyFieldBox.colMin;
  const enemies = packDef.enemyIds.map((eid, idx) => {
    const def = enemyDefsById[eid];
    if (!def) throw new Error('compileEnemyPack: missing enemy def ' + eid);
    const hpMax = Math.round(hpStream.range(def.hp[0], def.hp[1]));
    const [fh, fw] = def.footprint || [1, 1];
    if (cursorCol + fw - 1 > enemyFieldBox.colMax) { cursorCol = enemyFieldBox.colMin; cursorRow += fh; }
    const fieldCells = [];
    for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) fieldCells.push([cursorRow + dr, cursorCol + dc]);
    cursorCol += fw;
    const skills = (def.skills || []).map(sid => {
      const sdef = skillDefsById[sid];
      if (!sdef) throw new Error('compileEnemyPack: missing skill def ' + sid);
      return sdef;
    });
    // REQ-0093: battle_start status_immune / bonus_vs_status fold, from
    // this enemy's own skills list (an EnemySkill's own innate passive,
    // e.g. bone-and-sinew undead immune to Poison).
    const statusBag = freshStatusBag();
    const { immuneSet, bonusVsStatus } = foldBattleStartStatusVerbs(skills);
    statusBag._immune = immuneSet;
    return {
      id: eid + '#' + idx, defId: eid, name: def.name, hp: hpMax, hpMax,
      footprint: [fh, fw], fieldCells, skills, statusBag,
      alive: true, ownerId: eid + '#' + idx, bonusVsStatus,
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
