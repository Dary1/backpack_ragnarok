# REQ-0297 - Monster-pack baseDifficulty: arena-derived, auto-balanced, per-pack runtime

**Status:** todo (user-ratified 2026-07-23, in chat). Multi-phase, one file (all phases ship
together as one feature/deploy).
**Builds on:** REQ-0296 (side-agnostic BattleGroup + monster_arena). Supersedes the
DUNGEON-level baseDifficulty of REQ-0295 with a PACK-level, arena-derived model.

## The model (ratified)
- **baseDifficulty is a monster_pack property**, not a dungeon property. It is the pack's
  intrinsic combat power in ladder-Lv (g=1.1), measured troop-FREE by monster-vs-monster.
- **Runtime (confirmed by user):** a pack P appears at `effLevel_P = attackLv - pack.baseDifficulty`;
  a BOSS pack gets an extra ~+15%-equivalent Lv buff on appearance. dungeon.Lv is the
  AUTHORING anchor (which packs to assign) and algebraically cancels at runtime
  ((attackLv-dungeon.Lv)+(dungeon.Lv-pack.baseDifficulty) = attackLv-pack.baseDifficulty).
- **Self-normalising:** every pack is presented at the player's attackLv, so monster strength
  is constant across draws at a given attackLv, regardless of which dungeon/pack is rolled.
- **Auto-balanced:** editing any skill/monster/monster_pack re-runs an all-pairs round-robin
  that RE-DERIVES every pack's baseDifficulty (win-rate-driven, iterative). It is a GENERATOR,
  not a pass/fail gate.

## Phase 1 - Faction-neutral reactive dispatch + verb-firing auto-test
The verb EXECUTION layer is already faction-neutral (skills.cjs applyReactiveVerbToTarget takes
generic ownerActor/target). The remaining gap: the DEFENSIVE-retaliation DISPATCH is organised
per-side (each side's defensive reactions are dispatched from the OPPOSITE side's attack body),
so pure monster-vs-monster misses a struck monster's OnSquadBeenHit/OnBPBeenHit -> reactive-
dependent packs are undervalued by the arena.
- Generalise the defensive dispatch so the STRUCK group fires ITS OWN defensive reactions
  (OnSquadBeenHit/OnBPBeenHit and equivalents) at the attacker, driven by map membership
  (inst.allies()/opponents()), regardless of provenance.
- Add an auto-test (sim/tests): for every trigger kind x every supported reactive/timed verb,
  run it as a MONSTER skill both as ATTACKER and as DEFENDER; assert it fires / has effect.
  This catches any faction-locked verb/trigger by construction.
- HARD: goldens 12/12 BYTE-IDENTICAL (the standard player-vs-enemy path must reproduce today's
  dispatch exactly). Do NOT rebaseline.

## Phase 2 - Per-pack baseDifficulty runtime
- Schema: `baseDifficulty` (number, fractional) on each monster_pack in packs.json. A boss
  marker: bossPool membership in the dungeon def is the boss signal (a pack referenced from
  bossPool appears with the boss buff); no per-pack boss flag needed.
- Runtime: compute effLevel PER PACK at dive time -- `effLevel_P = attackLv - pack.baseDifficulty
  (+ BOSS_LV_BONUS if the pack is the dungeon's boss slot)`. Thread it per-pack through
  runDungeon -> runEncounter -> compileEnemyPack (which already takes effLevel; now the value is
  per-encounter's pack, not one dungeon-wide number). BOSS_LV_BONUS = log_1.1(1.15) ~= 1.474
  (a ~15% strength buff), a named tunable.
- Retire the dungeon-level scaling of REQ-0293/0295 (dungeon.baseDifficulty no longer drives
  runtime). dungeon.Lv stays as an authoring field (pack-assignment anchor). Keep the effLevel-0
  case byte-identical (goldens pass no profile; api_test test_dungeon packs get baseDifficulty
  such that effLevel stays 0 -> unchanged). Coverage/dungeon_roll unaffected.

## Phase 3 - All-pairs round-robin auto-adjuster + content-edit trigger
- Tool `tools/autobalance_pack_basedifficulty.cjs` (evolves REQ-0295's calibrator to the arena):
  ALL-PAIRS round-robin via sim/balance/monster_arena.cjs, N seeds; win-rate-driven update of
  each pack's baseDifficulty; ITERATE ~5 loops (relative system: one edit ripples; fights are
  handicapped by current estimates for measurement precision near the tie). Deterministic
  (fixed seeds). Emits fractional baseDifficulty into packs.json. `--report`/`--emit`/`--check`.
- Content-edit trigger: auto-run when skill/monster/monster_pack content changes (deploy/dirty
  time -- a make/pre-deploy hook keyed off the content hashes in registry.json). The output
  (pack baseDifficulty) is regenerated content, deployed via the surgical dungeons/packs path
  (REQ-0122 lossless kept green).

## Acceptance (whole feature)
- Phase 1: goldens byte-identical; verb-firing auto-test green (every verb/trigger fires as a
  monster attacker & defender); reactive-dependent packs now register in the arena.
- Phase 2: per-pack effLevel live; effLevel-0 byte-identical; goldens/sim/api green.
- Phase 3: round-robin deterministic + reproducible; generated baseDifficulty self-normalises
  (arena win rates across packs within tolerance at a common attackLv); trigger runs on content edit.
- End-to-end: same attackLv -> constant monster strength across draws (empirical arena check).

## Gate results / commit hashes
_(filled per phase on build)_
