# REQ-0116 — self_test_vocab.cjs as a ci.sh gate

Opened + BUILT 2026-07-09. User-ratified in chat ("ゲート市民として追加してよい / お願いします").
Stacked on REQ-0081 (which made the self-test green).

## Problem
`tools/self_test_vocab.cjs` was never wired into the quality gate `tools/ci.sh`
(`test:quick` = `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh`). Confirmed: no
reference in `ci.sh`, no root `package.json` script, no git hook, no CI workflow. Because
nothing ran it automatically, its pre-existing 2-failure gap sat RED across many REQs
without ever blocking a merge (REQ-0077 "not re-run", REQ-0102 "RED but pre-existing").
REQ-0081 made it green — but a green check with no gate can silently regress.

## Decision
Add the self-test as a first-class `ci.sh` step. It is a good gate citizen now: pure Node
(only requires `content/vocab.json` + `tools/eff_render.cjs` — no `node_modules`), fast,
and deterministic. Placed as `[3.7/7]`, right after the engine type-surface drift check
and before the server-api step — i.e. in the always-run, dependency-free cluster, ahead
of the SKIP-gated client/e2e steps. `set -euo pipefail` makes a non-zero exit fail the gate.

Diff (`tools/ci.sh`):
```
 echo "==== [3.6/7] engine type-surface drift check ===="
 node tools/check_engine_types.cjs
+echo "==== [3.7/7] vocab self-test (verbs/triggers/render + range validation) ===="
+node tools/self_test_vocab.cjs
 echo "==== [4/7] server api tests (files backend) ===="
```

## Dependency
Requires REQ-0081 (self-test green) present, else `ci.sh` fails at `[3.7/7]`. This branch
is STACKED on `req-0081-vocab-self-test-green` (base `27715d2`), so it carries the fix.
Merge order: REQ-0081 then REQ-0116 (or merge REQ-0116, which has 0081 as an ancestor).

## Gate results
`SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` → **CI GREEN** (exit 0):
- [1] sim 74/0 · [2] goldens OK (determinism) · [3] engine 101/0 · [3.5] typecheck OK · [3.6] type-drift OK
- **[3.7] vocab self-test: ALL GREEN, failures 0**  ← new step
- [4] server api 153/0 · [4.5] pg_sync 4/0 · [5]/[6]/[7] SKIPPED

## Status
BUILT — server branch `req-0116-selftest-vocab-ci-gate` @ `7d08566` (stacked on `27715d2`).
Not merged; merge → master is HANDS-OFF per PROJECT.md and awaits explicit user go-ahead.
