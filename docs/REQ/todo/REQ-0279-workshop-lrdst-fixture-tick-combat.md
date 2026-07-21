# REQ-0279 - workshop.spec.ts:361 fixture re-tune (tick-loop combat)

- **Status:** Spec. Branch `req-0279-workshop-lrdst-fixture-tick-combat` off master `00befdf`.
  Commissioned by the user 2026-07-22 (sibling of REQ-0278). Scope class: **test-fixture /
  gate-integrity** (no engine/content change). NOT merged (user acceptance later).
- USER RULING (2026-07-22, binding): combat balance is deliberately untuned right now and OUT
  OF SCOPE. Do NOT touch engine combat numbers, enemy stats, or dungeon content. Fix the
  FIXTURE side only (the ac896de discipline: legalize the fixture, never weaken the law).

## 1. Problem (proven)

`client/e2e/workshop.spec.ts:361` -- "a dungeon run reward deposits LRDST into the warehouse"
-- is DETERMINISTICALLY RED on master. Its fixture squad (berserker + an ASSEMBLED blade+hilt
`longsword`, comment claims "WINS 200/200", pre-tick-loop era) now WIPES `niflheim_depths` L1
under REQ-0256`s tick-loop combat. `settleRun` zeroes ALL rewards on a wipe BY DESIGN
(`server/services/runs.cjs`: `if (run.result !== 'wipe')`), so `lrdstRow` is undefined and
`expect(lrdstRow).toBeTruthy()` fails.

Root cause (measured, tools-side via the real `sim/combat.cjs` runDungeon over a rolled
`niflheim_depths` L1): the old squad is UNLINKED under the tick loop -- `linkOut` empty, it
fires NO offensive rays and deals **0 damage** (player damage output = 0 over a full fight),
so it wipes on **every** seed (measured **0/200**). The frost-pack enemies have tiny HP
(15-38), so any real damage would clear them -- the squad simply deals none. hp/weapon-count
do not help (hp5000 + 4 longswords still wiped 40/40): the blade+hilt PARTS assemble but do
not fire under tick-loop combat.

Origin (one line, no blame): REQ-0256 shipped sim-only -- its own doc records "E2E is not a
gate for this program" and reserved-but-never-ran an e2e decade -- so the fleet never
exercised this spec and the red first surfaced at a DEPLOY (REQ-0273`s deploy pass).

## 2. Fix (fixture-side, measured)

Replace the fixture squad with the sanctioned **REQ-0051 "Starter: Arms"** loadout
(`content/s4_boards/starter_arms.json` == the real starter tutorial kit): berserker + 12
COMPLETE weapons (`training_blade` / `hand_axe` / `war_pick` / `sling_stone`), which fire
real rays and clear L1`s low-HP frost packs + the hrimgrimnir boss. Inlined into the spec`s
`squadCanvas(tag)` with per-tag-unique uids (the REQ-0045 same-room deploy gate still passes);
`linked:false`, hpMax 120, exactly the authored loadout`s geometry.

**Measured** (real `runDungeon` over rolled `niflheim_depths` L1 / `formation1`, 4 of this
squad, random (genSeed, masterSeed) pairs): **WINS 500/500** under CURRENT tick-loop combat
(730/730 cumulative across sizing runs; 0 wipes). Damage-scaling was measured, not eyeballed:
2x2 + 2 complete weapons = 0/100, 3x3 + 8 = 97/100, this 5x5 + 12 = 500/500 -- the full
loadout is the robust 100% winner.

Also: update the stale "WINS 200/200 crypto-random seeds" comment to the new measured claim,
and add a spec-level GUARD naming the dependency: "this fixture must beat `niflheim_depths` L1
(dungeons[0]) under WHATEVER combat is live; if a rebalance reddens :361, RE-TUNE HERE (a
stronger loadout / clearable target) -- never weaken settleRun`s wipe->zero-rewards law."

Deterministic-enough to survive future balance drift is impossible (the guard says so); the
follow-up already on record -- REQ-0222 (e2e-harness-load-resilience, todo) -- would absorb
flake bookkeeping. NOT implemented here.

## 3. Gates / done-when

- The spec GREEN in a scoped hermetic fleet run x2 (REQ-0279 decade), and GREEN within a full
  `tools/ci.sh` run on this worktree. (Port note: `e2e_ports.sh` derives base = REQ*10, so the
  scoped decade is 2790/2792/2794 -- NOT the `5000 + REQ*10` that REQ-0256`s doc/legacy note
  used; ci.sh`s [7/7] auto-derives it from the branch name.)
- No engine/enemy/dungeon-content change (git diff = the one spec file only).
