# REQ-0307 - Re-baseline balance/health gates to the shipped REQ-0293/0297 scaling (green master)

**Status:** todo (RATIFIED 2026-07-25 by user: the post-scaling difficulty is INTENDED; fix is TEST-SIDE only).
Prerequisite to shipping REQ-0304 / REQ-0306 -- master ci.sh is currently RED and REQ-0159 forbids memorized reds.

## Problem (pre-existing on master @079f2c5; unrelated to REQ-0304)
`tools/ci.sh` aborts under `set -euo pipefail`:
- [2.5/7] `sim/tests/s4_test.cjs` exit 1 -- the "threshold classes" meta-test runs a tiny matrix
  (`sparse_glass`, batch002 level 3) through `tools/simulate.cjs` expecting warn-only (exit 0), but the shipped
  enemy scaling makes level 3 trip a HARD S4 band, so the subprocess exits 1.
- [2.95/7] `sim/tests/balance_sim_test.cjs` (d) exit 1 -- injecting an overpowered enemy skill should raise wipe
  rate above baseline, but `starter_arms` at level 3 already has baseline wipeRate = 1.0 (100% wipe) post-scaling,
  so the delta is unmeasurable.
Additionally, the REQ-0304 build diagnostic surfaced DETERMINISTIC failures in [7/7] scoped e2e that also
reproduce on clean master (to be re-verified and dispositioned here), e.g. `forecast.spec.ts:206` (stale:
slot-pressure moved to the sortie page in REQ-0239 but the test still checks `#/schedule`) and one or more
schedule/workshop run-lifecycle specs affected by the shipped scaling. Root cause: REQ-0293/0294/0297 shipped
without re-baselining these gates.

## Decision
The increased difficulty (e.g. a bare starter squad now wipes at level 3) is INTENDED. Therefore fix the GATES,
not the game: re-baseline stale TEST fixtures/expectations to the shipped scaling. Do NOT change enemy scaling,
powerLevel, content, or product thresholds. Preserve each test's real signal.

## Deliverables
1. [2.5] s4_test tiny-matrix meta-test: use a fixture that genuinely exercises the WARN-ONLY (exit 0) path under
   current scaling (e.g. a lower level, or a board/level that only warns), so the hard-vs-warn classification and
   the determinism sub-assertion are both still covered. Do NOT relax the S4 asserter itself.
2. [2.95] balance_sim_test (d): move the baseline to a non-saturated level/board (baseline wipeRate < 1.0) so an
   overpowered enemy-skill injection measurably raises wipe rate AND still trips a flag. Keep intent (OP detection).
3. [7] e2e: re-verify each deterministic red on clean master; fix stale tests (e.g. forecast:206 -> sortie page)
   and any test-isolation/hermeticity defects so the scoped hermetic e2e is green. Do NOT weaken an assertion to
   hide a real product regression -- if any red is a genuine product defect, STOP and report it (do not mask).
4. `tools/ci.sh` prints a literal `CI GREEN` (no memorized/accounted reds), scoped e2e included.

## Acceptance
- ci.sh literal CI GREEN on the worktree; no product balance/scaling/content/threshold change (diff is tests +
  fixtures + stale-test-only client/route touch-ups); sim replay goldens byte-identical.
- The re-baselined tests still FAIL if their real signal regresses (OP-injection detection; S4 warn-vs-hard
  classification; slot-pressure presence on its current page).

## Non-goals
Changing enemy scaling / powerLevel / content difficulty (intended); broad e2e flake-hardening beyond what blocks
a literal green (note parallel-load-flaky canvas specs separately if encountered).

## Gate results

**ci.sh printed `CI GREEN` (rc=0)** on branch `req-0307-balance-gate-rebaseline-post-0297-scaling`
(worktree `~/backpack_ragnarok_worktrees/req-0307-...`), 2026-07-25, full run with nothing the box can
run skipped: [0]..[6.6] green (sim, replay goldens, s4, pg-backend api/artwork/inspection/content,
client typecheck+build + bundle-env tripwire, admin e2e trio + registry-first e2e); and the [7/7] SCOPED
hermetic e2e (REQ-0307 decade, ports 3070+, E2E_PARALLEL=4) -> **204 passed, 0 failed, 1 skipped (4.6m)**.
The single skip is the pre-existing by-design `dex-admin.spec.ts:102` (REQ-0182b registry-served-item
PUT-409): [7/7] runs FILES-mode with an EMPTY registry, so that path is unreachable there and is covered
instead by [6.6] registry_first_e2e.

Commits:
- `6db5bfc` fix(REQ-0307): re-baseline sim gates [2.5] s4 + [2.95] balance to shipped scaling
- `a7d081a` fix(REQ-0307): re-baseline [7/7] scoped e2e to shipped scaling (stale-test + isolation)
- (this commit) docs(REQ-0307): record Gate results

### What was stale, and how each gate was re-baselined (test-side only)

**[2.5] s4_test tiny-matrix -- the spec's stated mechanism was wrong.** The subtest did NOT trip a hard
S4 band; `tools/simulate.cjs` CRASHED (`compileEnemyPack: missing enemy def frost_giant`) for EVERY
board/level. REQ-0303 (ee0bad3) pointed batch-002 packs.json at `frost_giant` ("live roster for batch-002
dungeon tests") and dungen's `default` generator draws the live roster (`troll`, ...), but `simulate.cjs`
loadDefs still sourced enemies/skills from batch-002's 7-enemy pilot set alone. Fix: overlay-if-absent the
`content/live/dungeon` enemy+skill roster in loadDefs -- the SAME REQ-0207 pattern `sim/tests/run.cjs` and
`tools/balance_sim.cjs` already use ("test-only fixture; no engine change"), and idiomatic to simulate.cjs's
own item overlay. The 7 batch-002 niflheim defs are byte-identical in live, so shared ids are unchanged;
only the otherwise-missing ids resolve. The EXISTING sparse_glass/L3 fixture then runs and is genuinely
WARN-ONLY (exit 0; WARN D1 pack duration 2.57s + D2 clear-rate 0; identical summary hash across two runs) --
no fixture edit needed. The S4 asserter + `s4_thresholds.json` are untouched.

**[2.95] balance_sim_test (d).** The default 4-encounter frost-scout arena wipes the `starter_arms`
baseline 100% at EVERY level post-scaling (empirically L1..L3 all -> wipeRate 1.0), so an OP-skill
injection could not measurably RAISE it. Re-baseline the SCENARIO to `arenaEncounters: 1` (a supported
`runMatrix` opt): baseline survivable (wipeRate 0), the injected 500-600/0.5s strike guarantees a wipe
(1.0) and trips `delta_wipe_rate` at flag level -- rock-solid across seeds 3/6/9. `balance_sim.cjs` logic
unchanged; OP-detection intent intact.

**[7/7] e2e (4 deterministic reds; all reproduce on clean master -- the sim commit touches nothing the
client e2e imports).**
- `forecast.spec.ts:206` (STALE): REQ-0239 moved the per-slot pressure summary off `#/schedule` onto the
  sortie DungeonDossier (`SlotPressureSummary` renders in `src/sortie/DungeonDossier.tsx`). Re-pointed the
  test to the sortie page + `sortie-formation-select`; the signal (4 distinct means, one worst, re-ranks
  on formation change) is preserved.
- `workshop.spec.ts:361` (scaling): `settleRun` zeroes rewards on a wipe, so the LRDST-deposit gate needs a
  WON run; the REQ-0279 win-squad now wipes niflheim_depths L1. RE-TUNED the inline fixture per its own
  guard comment (berserker + 12 war_picks, 7x7, hp1000; measured 80/80 clears of the authored -- harder --
  niflheim L1 via `sim/combat.cjs`). The wipe->zero-rewards law is untouched.
- `schedule.spec.ts` REQ-0099 settled-transport (was `:1257`): the "settled non-wipe reward" gate (325) now
  wipes -> hits its victory-skip guard, which `return`s before its room-cancel cleanup, LEAKING an active
  room whose deployed squads 0-3 409'd this later test. Gave 325 a dedicated inline WINNING canvas (its own
  default-profile squads) so it wins, no longer skips, and cleans up -- the shared fixture and the
  warehouse-claim/roster tests that depend on squad 0's small board are untouched.
- `schedule.spec.ts` REQ-0240 (was `:1524`) + REQ-0285 (pre-existing isolation): the REQ-0239 sortie test
  (1451) launches with a DEFERRED cancel policy that a plain guest cannot force-settle, so its room stays
  ACTIVE and its deployed squadIndices stay locked (the deploy gate resolves them live from the profile
  canvas). Selecting the shared squads 0-3 permanently 409'd whichever later guest test redeployed 0-3
  during that window (timing-dependent). Added 4 SMALL dedicated squads at fixture `store[11-14]` and
  pointed the sortie's squad selection at 11-14, so the lingering lock hits only squads no other test uses.

### Invariants confirmed
- **No product balance / scaling / powerLevel / content / threshold change.** Diff = 2 sim test/tool files
  (`tools/simulate.cjs` loadDefs fixture-sourcing; `sim/tests/balance_sim_test.cjs` scenario) + 4 e2e
  test/fixture files (`client/e2e/{forecast,workshop,schedule}.spec.ts` + `fixtures/schedule-fixture.json`).
  No `client/src`, no `server`, no `content/*`, no thresholds/asserters.
- **Sim replay goldens ([2/7]) BYTE-IDENTICAL:** "goldens OK (12 cases, replay determinism intact)". They
  read the FROZEN REQ-0301 fixture, decoupled from content, so nothing here can move a hash.
- **Each re-baselined test still FAILS on a real regression:** balance (d) requires injection to RAISE wipe
  rate AND flag; the s4 tiny matrix requires the tool to RUN and classify WARN-ONLY -> exit 0 AND stay
  deterministic; workshop/325 require an actually WON run to deposit a reward (settleRun's wipe->zero law is
  exactly what they prove); forecast:206 requires 4 distinct per-slot pressures with one worst and a
  re-rank on formation change.
