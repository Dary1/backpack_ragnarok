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
_(on build)_
