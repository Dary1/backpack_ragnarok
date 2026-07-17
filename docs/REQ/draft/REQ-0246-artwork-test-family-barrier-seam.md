# REQ-0246 — artwork-test-family-barrier-seam: REQ-0233's barrier restarts comfyui from a MOCKED unit test

**Reserved:** 2026-07-17 · **Slug:** artwork-test-family-barrier-seam
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」. Found while running REQ-0223's gates post-rebase.

## What happens

`server/tests/artwork_test.cjs` runs with `ART_ROUTE_MOCK=1` and a temp `ART_MODEL_DIR` of
stand-in files: no GPU, no real ComfyUI, by design. But REQ-0233's `familyBarrier()`
(`server/services/art_jobs.cjs`) fires on every generation -> matte family switch and does:

    spawn('systemctl', ['--user', 'restart', 'comfyui.service'])   // then awaitComfyHealth()

Every artwork_test case that generates and then inspects (the matte/cell kits) crosses that
switch, so a MOCKED unit test restarts the box's real ComfyUI — repeatedly — and then blocks
on its health probe. The renders never reach ok/failed inside `waitForRender`'s 20-30 s and
the test reports the symptom as a lie:

    FAIL  G3 provenance ... -- render seed 1 did not finish in time
    FAIL  flow: generate->adopt->export ... -- render seed 2 did not finish in time
    FAIL  REQ-0183 po generation is shape-conditioned ... -- render seed 1 did not finish in time
    FAIL  REQ-0223 TRUE same-seed A/B ... -- render seed 42 variant 1 did not finish in time

Nothing is wrong with the renders. The queue is off restarting a service the test does not use.

## Evidence (2026-07-17, this box, load avg ~9-13)

Same worktree, same commit, same DB, back to back:

| run | result |
|---|---|
| `node server/tests/artwork_test.cjs` | **12 passed, 4 failed** — all four "did not finish in time" |
| `ART_FAMILY_BARRIER=0 node server/tests/artwork_test.cjs` | **16 passed, 0 failed** |

The seam ALREADY EXISTS and REQ-0233's own comment names its purpose:

    // ART_FAMILY_BARRIER=0 disables the real restart (unit-test seam + emergency lever); the
    // logical fire is still counted so the invariant stays observable.

It is simply never set. `grep -rn "ART_FAMILY_BARRIER" server/ tools/` returns the definition
and nothing else — no test, no harness, no ci.sh step opts in.

## Why this matters more than a flaky test

- **It is load-dependent, so it reads as flake.** On a quiet box the restart may finish inside
  the wait and everything passes; under load it fails. That is the worst failure mode — the
  test's verdict tracks the box, not the code, and the next person burns an hour bisecting
  their own diff (this REQ's author did, on REQ-0223's gates).
- **It has a real side effect on a SHARED box.** A unit test restarts `comfyui.service` while
  the user's art session may be using it (PROJECT.md: art assets are HANDS OFF). Under
  `ci.sh`, `artwork_test` sits at step [5.x], so a full CI run bounces ComfyUI repeatedly.
- **It defeats the barrier's own invariant test.** `barrierRuns` exists so the fire stays
  observable with the restart disabled — the seam was designed for exactly this and left unused.

## What to do
- Set `ART_FAMILY_BARRIER=0` in `artwork_test.cjs` beside the existing `ART_ROUTE_MOCK=1`
  (same place, same reason: this test does not use the real stack). Assert `barrierRuns` moved
  where the invariant is under test, per REQ-0233's design.
- Check the same for the admin harnesses (`artadmin_e2e.sh`, `art_inspect_e2e.sh`,
  `content_admin_e2e.sh`): they are `ART_ROUTE_MOCK=1` too, and REQ-0223's e2e run showed the
  same exposure. Their 90 s waits hide it more often, which is worse, not better.
- Consider inverting the default: a barrier that restarts a service should be OPT-IN for any
  process that did not start the service. Decide, do not leave it implicit — that judgement is
  REQ-0233's to make, hence this is filed as a finding, not a fix.

## Out of scope
- The barrier's scheduling logic itself (REQ-0233's family grouping is not in question here).
- The GPU/VRAM policy that motivated the restart.

## Gates
- `artwork_test` green WITHOUT the env override on a loaded box (the failure above is
  reproducible by loading the box, so the fix is testable).
- `grep -rn "ART_FAMILY_BARRIER" server/ tools/` shows the seam set wherever `ART_ROUTE_MOCK=1` is.
- `barrierRuns` still asserts the family-switch invariant with the restart disabled.
