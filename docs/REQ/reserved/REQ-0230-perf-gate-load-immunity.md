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
