# REQ-0081 — vocab self-test green (tool_validate.cjs + trigger coverage)

Opened 2026-07-07. Found during the REQ-0078 → master merge verification.

## Problem
`node tools/self_test_vocab.cjs` fails on master (post REQ-0078 merge, commit 52da31d):

```
verbs covered: 16 / triggers covered (incl. extras): 7 of 10
failures: 2
SELF-TEST FAILED
```

This is NOT a merge regression — the `req-0078-onhit-taxonomy` branch fails identically.
It is the pre-existing state REQ-0078 Phase-1 carried onto master. Core gates are green
(sim 63/0, engine 97/0); this is a tooling/coverage gate, not a runtime break.

## The two failures
1. **`tools/tool_validate.cjs` missing.** `self_test_vocab.cjs` requires it and throws
   `MODULE_NOT_FOUND`. This validator has been "rebuild queued" since the S2
   content-pipeline work and was never built. Either build it (schema / vocab / range
   validator) or decouple `self_test_vocab.cjs` from it.
2. **Trigger coverage 7 of 10.** REQ-0078 introduced the reactive-trigger taxonomy
   (`OnHit` / `OnPOHit` / `OnBPHierarchyHit` / `OnUnitHit` / `OnBPBeenHit` /
   `OnUnitBeenHit` + existing). 3 of the 10 declared triggers are not yet exercised /
   implemented — Phase-1 wired 7. The remaining 3 overlap REQ-0079
   (linker-destination-triggers) / Phase-2.

## Done-when
- `node tools/self_test_vocab.cjs` exits 0 (0 failures) on master.
- Either `tool_validate.cjs` exists and passes, or `self_test_vocab.cjs` no longer
  depends on it.
- All 10 triggers covered, OR the 3 uncovered ones are formally deferred and the test
  asserts only the intended Phase-1 set.

## Open questions
- Build `tool_validate.cjs` now, or defer and decouple the self-test? (Depends on whether
  the S4 simulate-gate / content-validator work is being picked up.)
- Is trigger completion owned here or by REQ-0079? If REQ-0079, this REQ narrows to just
  the `tool_validate.cjs` dependency.

## Related
- REQ-0078 (onhit-taxonomy, merged to master 2026-07-07).
- REQ-0079 (linker-destination-triggers).
- Long-standing missing `tool_validate.cjs` (flagged in content_pipeline S2).

---

## Outcome — BUILT 2026-07-09 (server branch `req-0081-vocab-self-test-green` @ `27715d2`)

**Open questions — resolved**
- *Build `tool_validate.cjs` now, or decouple?* → **DECOUPLED.** The full schema/vocab/range
  validator is deferred to REQ-0050 (S4 simulate-gate / content-validator); building it here
  would pre-empt that REQ's rule design (the file header has warned against guessing it since
  the S2 pipeline). `self_test_vocab.cjs` no longer HARD-depends on it: a new `runValidate()`
  shells out to `tools/tool_validate.cjs` when it exists (so REQ-0050's validator is adopted
  automatically the moment it lands) and otherwise uses an in-process `inlineValidate()` that
  enforces exactly the two checks' contract — ranged verb params must be `[lo,hi]` integer
  ranges, and an entry tagged `_expect_reject` must be caught (negative bare-int test →
  `PASS(expected-reject)`, exit 0).
- *Trigger coverage owned here or by REQ-0079?* → **COVERED HERE.** `eff_render.cjs` already
  renders the full REQ-0078 taxonomy and `trigger_domains` lists PO for all three uncovered
  triggers, so the gap was only missing self-test fixtures — not engine/renderer work. Added PO
  fixtures for `OnBPHierarchyHit` / `OnUnitHit` / `OnUnitBeenHit` (→ 10/10) and promoted the
  informational "N of 10" line into a HARD assertion (fails if any `vocab.triggers` entry has no
  fixture). Engine wiring of those reactive triggers stays REQ-0079 / Phase-2; the self-test only
  builds + renders + range-checks fixtures, which is what "trigger covered" means here.

**Done-when — all met**
- `node tools/self_test_vocab.cjs` → `ALL GREEN`, `failures: 0`, exit 0.
- No dependency on a missing `tool_validate.cjs` (now a soft/optional dependency).
- 10/10 triggers covered and regression-proofed by assertion.

**Gate results (worktree @ `27715d2`)**
- `tools/self_test_vocab.cjs`: ALL GREEN — 0 failures; verbs 18/18, triggers 10/10, negative
  bare-int correctly rejected.
- `sim/tests/run.cjs`: 74 passed / 0 failed.
- `sim/tests/goldens.cjs`: OK (12 cases, replay determinism intact).
- `mock-src/tests/run.cjs`: 101 passed / 0 failed.
- Diff: `tools/self_test_vocab.cjs` only (+115 / −26).

**Status:** BUILT, not merged. Merge branch → master (which makes the gate green *on master* and
promotes this to DONE) is HANDS-OFF per PROJECT.md and awaits explicit user go-ahead.
