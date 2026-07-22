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

---

## 4. Outcome -- built 2026-07-22

### 4.1 Commits (branch `req-0279-workshop-lrdst-fixture-tick-combat`, off master `00befdf`)

| commit | what |
|---|---|
| `d7c614b` | reserve stub (allocator) |
| `331c67d` | this spec |
| `734e204` | reserved -> todo (user commissioned 2026-07-22) |
| `ad0b8b2` | implementation: re-tune `client/e2e/workshop.spec.ts` squadCanvas |

### 4.2 What changed

`client/e2e/workshop.spec.ts` ONLY (git diff master...HEAD = one file: +49/-21; zero
engine/enemy/dungeon-content delta). The `squadCanvas(tag)` fixture is swapped from the old
berserker + assembled blade+hilt `longsword` (UNLINKED under tick-loop -> 0 damage -> 0/200)
to the sanctioned REQ-0051 "Starter: Arms" loadout (berserker + 12 complete weapons). The
stale "WINS 200/200" comment is replaced with the new measured claim + a spec-level GUARD
naming the dependency (re-tune the fixture if combat drifts; never weaken settleRun).

### 4.3 Measurement (tools-side, real `sim/combat.cjs` runDungeon over rolled `niflheim_depths` L1)

Method: for each trial, `dungeon_roll.rollDungeon(niflheim_depths, 1, randomGenSeed)` then
`combat.runDungeon({ ..., squadSnapshots: 4x this squad, formationId: 'formation1', level: 1 })`
-- the EXACT call `server/services/runs.cjs` startRun makes. Content via the server`s own
`getScheduleContent()` (files backend), so the maps match production.

| squad | victories |
|---|---|
| old (berserker + blade+hilt longsword), hp800 | **0 / 200** (unlinked, 0 player damage) |
| old + hp5000 / +4 longswords | still 0 / 40 (hp/weapon-count irrelevant) |
| 2x2 + 2 complete weapons | 0 / 100 |
| 3x3 + 8 complete weapons | 97 / 100 |
| **starter_arms (5x5 + 12), the shipped fixture** | **500 / 500** (730/730 cumulative, 0 wipes) |

### 4.4 Gates (HOME-remap bridge /tmp/h0279; DATABASE_URL from main server/.env; art-worker
recipe per REQ-0278: ART_JOB_PYTHON=main .venv, ART_KIT_MATTE_METHOD=borderkey, ART_KIT_PYTHON
left to ci.sh`s per-step default via a worktree .venv symlinked to main, removed after)

- **DB-free sweep** `SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh` -> **CI GREEN**.
- **Scoped hermetic fleet x2** (REQ-0279 decade: proxy 2792, fleet 2794+; the roller/combat use
  fresh random seeds each run, so this is a real repeat): `workshop.spec.ts` **11 passed / 0
  failed BOTH runs**, `:361` green (215 ms, then 226 ms).
- **Full `tools/ci.sh`**: green through [6.6/8] -- sim / goldens / mock / typecheck / DB-free;
  [5/7] pg api + the full art suite ([5.1] artwork 16/0, [5.15] artqueue incl. G5 5/0, [5.16]
  artfamily 2/0, [5.2] inspection 5/0); [6/7] client build; [6.5/8] admin trio + [6.6/8]
  registry-first. **[7/7] scoped fleet: 194 passed / 2 failed** -- the 2 are
  `forecast.spec.ts:206` and `schedule.spec.ts:1451`, the documented tolerable load flakes
  (signature-verified by name). **`workshop.spec.ts:361` is GREEN (spec 189, 458 ms)** -- the
  RED this REQ fixes. (This tree carries no REQ-0278 change, so ci.sh has no [6.1/7] step.)

### 4.5 Notes

- Origin of the red: REQ-0256 (tick-loop combat) shipped sim-only and its doc records "E2E is
  not a gate for this program"; the fleet never exercised `:361`, so the fixture-vs-combat
  regression only surfaced at REQ-0273`s deploy. The durable fix for that class (combat drift
  silently reddening an e2e fixture) is REQ-0222`s remaining scope -- NOT implemented here.
- Port-formula anomaly: REQ-0256`s doc and the commissioning brief use `5000 + REQ*10 + idx`,
  but current master`s `tools/e2e_ports.sh` derives `base = REQ*10` (proxy 2792 for REQ-0279,
  confirmed live). Followed the repo authority (ci.sh auto-derives from the branch name).

Deliverable: `built`, worktree clean, NOT merged (user acceptance later).
