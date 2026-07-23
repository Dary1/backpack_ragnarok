# REQ-0296 - Side-agnostic BattleGroup: generalise fire targeting (native monster-vs-monster)

**Status:** todo (user-directed 2026-07-23: finish the BattleGroup interface so sides are
interchangeable; the abstraction was specified in REQ-0256).
**Depends on / builds on:** REQ-0256 (IBattleInstance / IBattleInstancesFormationMap /
Battle / shared fire closure). Enables the REQ-0295 baseDifficulty calibration to be re-derived
troop-FREE (monster-vs-monster), replacing the scenario-troop reference.

## Current state (REQ-0256 already did the hard part)
- battle.cjs: `IBattleInstance` (ONE per BP OR per enemy/entity; flat cooldownSkills;
  "same interface, different provenance"), `Battle` holding playerMap + enemyMap (both
  `IBattleInstancesFormationMap`), the SAME `fire` closure attached to BOTH sides'
  instances, and a symmetric `tick()` (player then enemy tickInstances/tickRays).
- compile.cjs: `buildInstances(bps,pos,sis)` (player provenance) and
  `buildEnemyInstance(raw,actor)` (enemy provenance) both yield the same IBattleInstance shape.

## The ONE remaining asymmetry
`encounter.cjs fireInstanceSlot(inst, cd)` selects targets by PROVENANCE, not by group:
- `inst.kind === 'bp'` branch fires with `targetActors: enemyActorList()`.
- else (enemy) branch fires with `targetActors: playerActors`; `heal_ally` targets own
  `enemyActors`; reactive OnSquadBeenHit fires back at `playerActors`.
The instance/map/tick/fire-closure are already side-agnostic; only WHO a fire targets is
hardcoded to player/enemy. Generalising that to "the opposing group / own group" (derived
from map membership) makes monster-vs-monster native.

## Design
1. **Opponent/ally binding on the map (or Battle).** Give each IBattleInstancesFormationMap
   an `opponents()` and `allies()` accessor returning the live target ACTOR list. In the
   standard encounter wire `playerMap.opponents = () => enemyActorList()`,
   `enemyMap.opponents = () => playerActors`, `*.allies = own actors`. This MUST reproduce
   today's lists in the SAME ORDER -> byte-identical.
2. **fireInstanceSlot reads the group, not the kind, for TARGETS.** Replace the literal
   `enemyActorList()` / `playerActors` target args inside the fire bodies with the firing
   instance's `opponents()` (and `allies()` for heal_ally). KEEP the `inst.kind === 'bp'`
   branch for the BP-only MACHINERY (charge, pulse/links, dispatchPlayerOffensive, POs) --
   that stays gated on provenance; only the target LIST is generalised. An enemy instance
   keeps the enemy fire body; a bp instance keeps the bp fire body; both now aim at their
   map's opponents.
3. **Monster arena builder (sim/balance/).** A harness that builds TWO enemy-provenance maps
   (each from a monster_pack via buildEnemyInstance + makeEnemyActor + field placement) set
   as each other's opponents/allies, drives them with the SAME battle.tick(), and reports the
   surviving side + BP/HP-free margin. No BP side, no live-engine edit beyond (1)+(2).
4. **effLevel handicap tie-search** (the payoff, may be phase b or a follow-up REQ): fight
   pack A (effLevel eA) vs pack B (eB); binary-search the eA-eB where they tie (50%);
   that gap IS the ladder-Lv power difference -> troop-free baseDifficulty. Re-derives
   REQ-0295's numbers without the scenario troop.

## HARD constraint (non-negotiable)
Every existing replay golden (sim/tests/goldens.cjs, 12 cases) and S4 baseline stays
BYTE-IDENTICAL. The generalisation is a pure refactor of target-list plumbing; the standard
player-vs-enemy path must emit identical events/streams/order. Prove it: goldens unchanged,
full sim/tests/run.cjs green, determinism intact. If any hash moves, the refactor changed
behaviour and must be corrected -- do NOT rebaseline goldens for this REQ.

## Known limitation (document, do not silently drop)
Reactive retaliation (OnSquadBeenHit) is currently dispatched only inside the BP fire body.
Pure monster-vs-monster (enemy hitting enemy) will not fire the struck group's reactive
skills unless that dispatch is also generalised. For v1 the arena may measure timed-skill
combat only (note it); generalising reactive dispatch symmetrically is a clean phase-2.

## Acceptance
- goldens 12/12 byte-identical; sim suite green; coverage/dungeon_roll green; api_test 194/0.
- A determinism test: the standard encounter's event log is unchanged (hash) after the refactor.
- sim/balance monster-arena runs A-vs-B deterministically and returns a winner + margin.
- (phase b) tie-search reproduces sane per-dungeon ladder gaps.

## Gate results / commit hashes
_(filled on build)_
