# REQ-0230 - make perf-budget gates immune to box contention

**Reserved:** 2026-07-17 (observed during REQ-0216)
**Slug:** perf-gate-load-immunity

## Problem

`sim/tests/forecast_parity.cjs` asserts a WALL-CLOCK perf budget
(forecastPressure 4-squad recompute < TUNABLE 100ms). Wall clock measures the
BOX, not the code: with several sessions running CI/e2e concurrently
(load avg 7-13), the same unchanged code measured 101.3ms, 141.4ms and
134.2ms on 2026-07-17 -- and the identical test failed on the untouched
master checkout at the same moment. Because ci.sh is fail-fast and this gate
sits early (step 2.6), one contention flake kills a whole CI cycle and its
queue slot; REQ-0216 burned two full cycles + a 5-retry loop on it.

## Proposal (pick one at ratification)

- (a) Measure `process.cpuUsage()` (user+sys) instead of wall clock -- load-
  independent, still catches real regressions. Budget re-tuned once.
- (b) Best-of-N (e.g. 3) wall-clock runs -- cheap, keeps the current meaning,
  tolerates scheduler noise but not sustained saturation.
- (c) Split ALL perf budgets out of the correctness ci.sh into a separate
  perf gate run only on a quiet box (its own lock, loadavg guard).

Recommendation: (a), optionally + (c) later; (b) is the minimal patch.

## Gates

- The perf assertion passes 5/5 under an artificial CPU-load harness while
  correctness assertions stay untouched.
- ci.sh green.

## Decision + implementation (2026-07-17, ratified via REQ-0234 report §5)
- Landed (a)+(b) combined: the forecastPressure budget measures
  process.cpuUsage (user+sys) over BEST-OF-3 samples against a once-retuned
  [TUNABLE 150ms] budget. Measured basis: 71.8ms quiet best-of-3; cpu-time
  alone at the old 100ms budget still flaked 3/5 under a full 8-way CPU burn
  (SMT/cache inflation 72 -> ~112ms) -- bounded, unlike wall-clock queueing,
  hence floor(2x quiet) headroom rather than a wall-clock rescue.

## Gate results (2026-07-17)
- 5/5 PASS under an artificial 8-way CPU burn (spin loops, load ~3.5+ on 8
  threads); correctness assertions untouched (18/18 forecast_parity).
- Quiet: best-of-3 cpu 71.8ms (samples 78.6/71.8/78.1).

## Deploy record (2026-07-17)
- Merged to master bc6c012 (--no-ff, user go-ahead in chat). No runtime paths touched (tools/, sim/tests, client/e2e, docs only): no service restart, no dist rebuild needed.
- Live verification: full ci.sh GREEN on the identical tree pre-merge (FULLCI2 09:52:59-10:00:40, incl. admin trio 7/1/28, registry stage 4/4 no-skip, scoped e2e 187/1/0); backpack-web/api healthy post-merge (200/200). Main-checkout quick gates green EXCEPT the PRE-EXISTING [3.8] art-export red: the in-flight art session's untracked content/art mirror lacks the items005 renders (gate self-skips in any tree without that mirror; this merge touches no content paths) -- flagged to the user, not caused here.
