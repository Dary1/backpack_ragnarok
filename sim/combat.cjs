// sim/combat.cjs -- REQ-0036 P1-A combat simulator core.
//
// =====================================================================
// INVARIANT (read this before touching engine interop):
// This module MAY require('../mock-src/engine.js') READ-ONLY to compile
// static topology facts (assembly/sockets/allConnections/connectionsFrom/
// cellsOf/bpCells/combos/traceBeams). It must NEVER call any engine
// MUTATOR (movePO, moveBP, rotatePO, seatSI, stowSI, invMovePO, etc.) and
// must NEVER share a mutable object reference back into engine state.
// Every squad "snapshot" handed to the compiler is deep-copied first
// (JSON.parse(JSON.stringify(...)) -- fine since scenario/squad state is
// plain data with no functions/cycles) so nothing here can mutate the
// caller's original state object, and nothing engine.js does can leak
// mutation back out either. Combat/HP/damage logic lives ENTIRELY here;
// engine.js has none (its only combat-adjacent addition is the pure
// read-only bpHpMax(st,bpId) accessor added in REQ-0036 P1-A commit (a)).
// =====================================================================
//
// Spec: combat_spec_draft.md v0.3 (RATIFIED), S1-S9, quoted verbatim in
// the REQ-0036 P1-A task brief. Implements event-driven continuous-time
// resolution, formation-ray targeting, skills/attack-profiles, mode-tags
// (battle/detection/unlock), the status system, and run/dungeon
// integration (progress/shortcuts/rewards/wipe/cooldown).
//
// NOTE on source-doc truncation (documented per task instructions, see
// also sim/README.md "Interpretations" section): docs/combat_spec_draft.md
// v0.3 (555 lines) is truncated mid-sentence at line 555 ("| OQ5 (pen) |
// pen = occupied pass-throug"). S9's table is incomplete and S10 (tunables
// consolidation) / S11 (VX list) are entirely missing from the source
// file. This is a genuine gap in the source document -- NOT a mistake on
// this implementation's part. Every constant S10 would have held is
// already given inline via [TUNABLE]/[LOCKED OQn] markers scattered through
// S1-S9's prose, and the VX list (S11) is fully described inline too. All
// such constants are collected in the TUNABLES table below, each with a
// comment citing which spec section/inline mention it is sourced from.
'use strict';

// REQ-0047 (d): this file is now a FACADE. The simulator core was
// decomposed VERBATIM into sim/lib/{core,rng,heap,geometry,formation,
// status,compile,entry,ray,field,replay,skills,packs,encounter,dungeon}
// .cjs. The exported surface below is name-for-name identical to the
// pre-split module.exports (including the read-only engine re-export),
// so every consumer (sim/tests, sim/dungen.cjs, server/services) keeps
// working unchanged. Determinism proof: sim/tests/goldens.cjs.
'use strict';
const path = require('path');
const engine = require(path.join(__dirname, '..', 'mock-src', 'engine.js'));
const core = require('./lib/core.cjs');
const rng = require('./lib/rng.cjs');
const geometry = require('./lib/geometry.cjs');
const formation = require('./lib/formation.cjs');
const status = require('./lib/status.cjs');
const compile = require('./lib/compile.cjs');
const entry = require('./lib/entry.cjs');
const ray = require('./lib/ray.cjs');
const field = require('./lib/field.cjs');
const replay = require('./lib/replay.cjs');
const skills = require('./lib/skills.cjs');
const packs = require('./lib/packs.cjs');
const encounter = require('./lib/encounter.cjs');
const dungeon = require('./lib/dungeon.cjs');
const hpbelow = require('./lib/hpbelow.cjs'); // REQ-0121

module.exports = {
  TUNABLES: core.TUNABLES,
  makeRng: rng.makeRng,
  DIR_VEC: geometry.DIR_VEC,
  EDGE_DIRS: geometry.EDGE_DIRS,
  reflectDir: geometry.reflectDir,
  stepCell: geometry.stepCell,
  outside: geometry.outside,
  mult: geometry.mult,
  chebyshevDist: ray.chebyshevDist,
  parseBox: formation.parseBox,
  colLetterToIndex: formation.colLetterToIndex,
  colIndexToLetter: formation.colIndexToLetter,
  FORMATIONS: formation.FORMATIONS,
  FIELD_ROWS: field.FIELD_ROWS,
  FIELD_COLS: field.FIELD_COLS,
  STATUS_KIND: status.STATUS_KIND,
  DEBUFF_STATUSES: status.DEBUFF_STATUSES,
  BUFF_STATUSES: status.BUFF_STATUSES,
  STATUS_KINDS: status.STATUS_KINDS,
  resolveStatusKind: status.resolveStatusKind,
  resolveVerbStatusSet: status.resolveVerbStatusSet,
  foldBattleStartStatusVerbs: status.foldBattleStartStatusVerbs,
  freshStatusBag: status.freshStatusBag,
  applyStatus: status.applyStatus,
  cleanse: status.cleanse,
  cadenceMultiplier: status.cadenceMultiplier,
  weaknessMultiplier: status.weaknessMultiplier,
  isStunned: status.isStunned,
  tickStatuses: status.tickStatuses,
  consumeSpikes: status.consumeSpikes,
  deepCopy: core.deepCopy,
  compileSquadSnapshot: compile.compileSquadSnapshot,
  cellsChebyshevAdjacent: compile.cellsChebyshevAdjacent,
  centroidRoundHalfUp: entry.centroidRoundHalfUp,
  selectEntryCell: entry.selectEntryCell,
  walkRay: ray.walkRay,
  fireSkillRay: skills.fireSkillRay,
  dealHitOnField: skills.dealHitOnField,
  makeBPActor: skills.makeBPActor,
  makeEnemyActor: skills.makeEnemyActor,
  reduceIncoming: skills.reduceIncoming, // REQ-0121
  registerHpBelowWatchers: hpbelow.registerHpBelowWatchers, // REQ-0121
  checkHpBelow: hpbelow.checkHpBelow, // REQ-0121
  foldFlatBonusInPlace: hpbelow.foldFlatBonusInPlace, // REQ-0121
  compileEnemyPack: packs.compileEnemyPack,
  toJSONL: replay.toJSONL,
  maskLabel: replay.maskLabel,
  runEncounter: encounter.runEncounter,
  runDungeon: dungeon.runDungeon,
  computeEncounterDeltas: dungeon.computeEncounterDeltas,
  distributeRewardsUniform: dungeon.distributeRewardsUniform,
  cooldownForH: dungeon.cooldownForH,
  levelDownOnWipe: dungeon.levelDownOnWipe,
  packBudgetForLevel: dungeon.packBudgetForLevel,
  engine,
};
