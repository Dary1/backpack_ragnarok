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
Built 2026-07-23 on branch `req-0296-battlegroup-side-agnostic-fire` (base `20ee8a2`).

Commits:
- `3454590` feat: add side-agnostic opponents()/allies() binding to map + instance (inert plumbing)
- `28ddfdb` feat: fireInstanceSlot targets via inst.opponents()/allies(); wire standard encounter maps (byte-identical)
- `9fc821e` refactor: extract enemy timed-fire body to shared fireEnemyInstanceSlot (byte-identical)
- `cbd6591` feat: sim/balance/monster_arena.cjs -- headless monster-vs-monster via shared battle tick

HOW the standard player-vs-enemy path stayed BYTE-IDENTICAL (the opponents()/allies() wiring):
- formation_map.cjs gained `opponents()`/`allies()` accessors (default null). battle.cjs
  propagates each map's accessors onto that map's instances, LATE-BOUND (so a map wired
  after construction -- the arena -- still resolves at fire time).
- encounter.cjs wires the STANDARD maps: a player-map instance's `opponents()` ==
  `enemyActorList()` (entity included, exactly what the bp body read) and `allies()` ==
  `playerActors`; an enemy-map instance's `opponents()` == `playerActors` and `allies()` ==
  `enemyActors`' actors -- the SAME lists in the SAME ORDER as the hardcoded args they
  replaced.
- fireInstanceSlot now reads `inst.opponents()`/`inst.allies()` for the 4 target LISTS only
  (bp main fire, bp-body OnSquadBeenHit retaliation -> allies, enemy heal_ally -> allies,
  enemy main fire). All BP-only MACHINERY (charge ops, pulse/links, dispatchPlayerOffensive,
  dispatchPlayerDefensive, PO lookups, attachment/trap volleys, trap timeout) stays gated on
  provenance and keeps its literal player/enemy lists. Result: identical event log, stream
  order and hashes.

Gates (all green):
- `node sim/tests/goldens.cjs` -> goldens OK (12 cases, replay determinism intact). The
  sim/tests/goldens/ fixtures are UNTOUCHED (`git diff 20ee8a2 -- sim/tests/goldens` empty).
- `node sim/tests/run.cjs` -> 130 passed, 0 failed (incl. AC13: encounter.cjs still owns no
  instance-fire walk; extraction did not reintroduce one).
- `node tools/check_scaling_coverage.cjs --gate` -> OK (14/14 live numeric leaves covered).
- `node sim/balance/monster_arena.cjs pack_frost_scouts pack_rime_choir` -> winner=A in 4.07s,
  deterministic=true (double-run equal). effLevel handicap verified: pack_bone_court
  eff0-vs-eff4 -> the eff4 side wins in BOTH orientations, by a wider margin than the neutral
  mirror -- the tie-search payoff (design step 4) is reachable.

## Implementation note -- the known limitation (phase-2, NOT silently dropped)
The enemy timed-fire body was extracted VERBATIM into the module-level
`fireEnemyInstanceSlot` (sim/lib/encounter.cjs, exported) so the standard encounter AND the
arena drive the SAME fire logic -- no forked combat. The reactive OnSquadBeenHit RETALIATION
dispatch still lives ONLY in the BP fire body (it runs when a BP hits enemies), so pure
monster-vs-monster does NOT retaliate; the arena therefore measures TIMED-SKILL combat
(+ offensive OnHit/OnSquadHit riders + status DoTs + heal_ally). This is documented in a
comment at both the retaliation site (fireInstanceSlot) and on `fireEnemyInstanceSlot`.
Generalising the retaliation dispatch symmetrically -- so a struck group fires its
OnSquadBeenHit back at its own `inst.allies()` from the enemy body too -- is the clean
phase-2 (its target LIST is already `inst.allies()`, so only the DISPATCH needs moving).


## Merged + deployed (2026-07-23)
- Merged to master in the REQ-0296+0297 merge commit c374176 (--no-ff). Byte-identical refactor; monster_arena.cjs live. Gates on merged master: goldens 12/12 byte-identical, sim 177/0, coverage green. Enabled REQ-0297.
