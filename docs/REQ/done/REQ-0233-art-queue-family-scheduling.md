# REQ-0233 — art queue family scheduling: never keep two model stacks warm

**Ratified:** 2026-07-17 (user, chat): incident follow-up approved ("go on")
after the llmlocal freeze root-cause session.

## Incident this fixes (2026-07-17 ~05:45 UTC)

llmlocal froze under multi-session load with ZERO oom-kills (kernel + oomd
logs empty for boot -1): swap-thrash starvation, recovered only by hard
reboot. Root cause is structural, and REQ-0158's own scope note names it:
`/free` returns VRAM but "does NOT shrink host RSS". A warm ComfyUI holds
~11 GB host RSS (measured 11.5 GB this day; GPU is 8 GB so flux2 weights
live mostly in RAM), the queue alternates generation jobs with
birefnet-matte jobs (~12 GB RSS each, CPU onnxruntime), so the steady state
during any batch is ~23 GB — the whole box — and any other session's normal
work (one e2e harness, one ci build) tips it into swap thrash. The 7/16
queue-bypass OOM rule ("one job at a time") was necessary but NOT
sufficient: one job at a time still means two model stacks RESIDENT at a
time.

**Invariant this REQ makes real: at most ONE model stack is resident in RAM
at any moment.**

## What

In server/services/art_jobs.cjs pump():
1. FAMILY GROUPING. When both generation-family (genQueue/heldQueue) and
   matte-family (inspectQueue/packQueue) work is waiting, do not alternate:
   drain the family the in-flight job belongs to first. Generation keeps
   its priority when the box is cold, but a generation job must not START
   while matte-family jobs are running-or-waiting ahead of a family switch
   (and vice versa). Kit auto-inspections enqueued by a finishing render
   simply wait for the generation family to finish.
2. FAMILY-SWITCH BARRIER, generation -> matte: before the first
   matte-family job runs after generation work, ask the ComfyUI unit to
   return its RSS: `systemctl --user restart comfyui.service` (the ONLY
   lever that shrinks RSS, per REQ-0158), await the health endpoint, then
   start mattes. Matte -> generation needs no barrier (each matte job is a
   short-lived process; its RSS dies with it) beyond waiting for the
   in-flight matte to exit.
3. The barrier is policy-gated: `ART_FAMILY_BARRIER=0` env kills it (test
   seam + emergency lever); default ON.

## Mitigations already live (2026-07-17, ops — this REQ supersedes none)

- comfyui.service drop-in: MemoryMax=14G, MemorySwapMax=1G (freeze -> kill).
- comfyui-idle-free drop-in: RSS_RESTART_MB=6000 (idle bloat restart).

## Verification

- Unit tests on pump ordering: mixed queue drains family-wise; kit
  inspections enqueued mid-generation-batch do not start until the family
  switch; the barrier fires exactly once per gen->matte switch.
- The barrier itself mocked in tests (no real systemctl); one live check on
  deploy: run a 2-gen + 2-cutout mixed batch, verify via journal that the
  comfyui restart lands between the families and RSS returns to <2 GB
  before the first matte.
- Full ci.sh green.

## Out of scope

- Cross-session locks (e2e box lock and the ci flock already exist).
- Changing REQ-0158's idle watchdog semantics.
- ComfyUI RAM-offload tuning (--lowvram etc.) — separate spike if ever.


## Implementation + gates (2026-07-17)

Implemented in `server/services/art_jobs.cjs`:
- **Family grouping** in `pump()`: a generation family (`genQueue`) and a matte
  family (`packQueue` + `inspectQueue`). The pump drains the in-flight family
  before switching; on a cold/settled box generation keeps its REQ-0151/0152
  priority, but a job of the OTHER family never STARTS while this family still
  has work waiting. Kit inspections auto-enqueued by a finishing render wait for
  the generation family to drain. Within the matte family, REQ-0192/0193 packs
  and cutouts still run ahead of advisory inspections. `currentFamily` persists
  across an idle gap so a matte job after a generation batch still barriers.
- **gen->matte barrier** `familyBarrier()`: before the first matte job after a
  generation batch, `systemctl --user restart comfyui.service` then await the
  ComfyUI health endpoint (`/system_stats`), returning ~11 GB host RSS before a
  birefnet matte loads. matte->generation needs no barrier. `ART_FAMILY_BARRIER=0`
  disables the real restart (unit-test seam + emergency lever); default ON. The
  logical fire is still counted so the invariant stays observable.
- Test observability: `jobs.__test { barrierRuns, dispatchLog, currentFamily,
  reset }` (no effect on production scheduling; `dispatchLog` only recorded when
  `ART_DISPATCH_LOG=1`).

Tests: `server/tests/artfamily_test.cjs` (new) covers family grouping,
inspections waiting for the switch, and the barrier firing exactly once per
gen->matte switch (matte->gen free), with the barrier mocked
(`ART_FAMILY_BARRIER=0`). `artqueue_test.cjs` + `inspection_test.cjs` opt out of
the real restart the same way. Registered in `tools/ci.sh` phase [5.16].

Gates (2026-07-17, llmlocal; master merged into the branch first, clean):
- typecheck `tsc -p tsconfig.server.json`: **PASS**.
- `server/tests/artfamily_test.cjs`: **2/2 PASS**.
- `server/tests/artqueue_test.cjs`: **5/5 PASS** (2 transient timing fails under
  concurrent cutout-sweep load re-passed 5/5 in isolation).
- `server/tests/inspection_test.cjs`: **5/0 PASS**.
- sim suites (run in ci): sim tests, goldens, S4, grave-legion, **wildlands
  13/0** (after the master merge brought the delta-based baseline fix; the
  pre-merge branch failed here on a stale absolute count 15->32 unrelated to
  this REQ), deepstone, unit-charge — all PASS.
- `sim/tests/forecast_parity.cjs` perf-budget: the DOCUMENTED load-flake
  (REQ-0222/REQ-0230); verified **3/3 PASS in isolation** (18/0 each). It is the
  only accepted non-green.
- Every gate that ran under the two full `ci.sh` invocations passed except the
  above two (both explained; neither a REQ-0233 defect). A single uninterrupted
  full run is deferred to the deploy window (quiet box, post-sweep) where the
  perf-budget passes without the load-flake.

Deploy (2026-07-17): PENDING — must run only AFTER the REQ-0193 cutout sweep
finishes (deploy restarts backpack-api, which would kill the in-flight art
queue). At deploy: merge to master, restart backpack-api, then live-verify the
barrier (2 small generations + 2 cutouts; `journalctl --user -u comfyui.service`
shows the restart landing between the families; RSS < 2 GB before the first
matte), then delete the test renders and move built -> done.

## Deploy + live verification (2026-07-18)

Ordering held: the REQ-0193 cutout sweep finished first (deploy restarts
backpack-api, which would have killed the in-flight art queue), then this.

**Full ci.sh, one uninterrupted run — CI GREEN.** The run the gate record above
deferred to "a quiet box, post-sweep" happened here: load 0.32, 19 GB free, no
other session's e2e in flight. Every gate green, including the two the earlier
record could only pass in isolation:
- `sim/tests/forecast_parity.cjs` perf budget: **18/0 inside the full run** — the
  REQ-0222/REQ-0230 load-flake did not fire on a quiet box, exactly as predicted.
- `artqueue_test.cjs` 5/5, `artfamily_test.cjs` 2/2, `inspection_test.cjs` 5/0.
- client e2e **187 passed, 1 skipped**; admin trio green; `CI GREEN` printed.
There is now no accepted non-green for this REQ.

Merged to master, `backpack-api` restarted (queue confirmed idle first), barrier
left at its default (`ART_FAMILY_BARRIER` unset = ON).

**Live barrier check — PASS.** 2 generations + 2 cutouts enqueued back-to-back on
`batch-004-item-icons-flux2:blade` (gens first, then both cutouts, so both
families had work waiting at once):

| time (UTC) | event | comfyui RSS |
|---|---|---|
| 18:16:41 | 2 gens + 2 cutouts enqueued | — |
| 18:16:42 | gen 100405 -> comfyui `got prompt` | 0.9 -> 11.4 -> **14.3 GB** |
| 18:23:57 | gen 100405 `Prompt executed in 435.17s` | |
| 18:28:19 | gen 100406 -> `got prompt` (warm: 10.25 s) | |
| **18:28:31** | **BARRIER: `systemctl --user restart comfyui.service`** | |
| 18:28:32 | comfyui back, health OK, new pid | **0.84 GB** |
| ~18:29:30 | first matte (`cutout_job.py`, birefnet) starts | **0.97 GB** |
| 18:33 | queue drained, all 4 renders `ok` | 0.97 GB (flat) |

Every claim in the Verification section checks out:
- **Family grouping**: both cutouts sat at `inspectDepth` 2 for the entire
  ~12 min generation family and never started — even though REQ-0193 cutouts are
  the highest-priority waiting matte work. The old alternating pump would have
  run one between the two gens, with birefnet loading on top of a warm ComfyUI.
- **Barrier fires once**: exactly ONE comfyui restart in the whole run, landing
  between the last generation (18:28:29) and the first matte. Zero further
  restarts through the rest of the matte family (matte->matte needs none).
- **RSS returns**: 14.3 GB -> **0.84 GB**, under the < 2 GB bar, BEFORE the first
  birefnet loaded, and flat at 0.97 GB for the whole matte family. The invariant
  ("at most ONE model stack resident") held: peak box use stayed ~9 GB of 23,
  against the ~23 GB steady state that froze the box on 2026-07-17.

The 4 test renders (100405, 100406, 100202, 100303) were deleted afterwards;
`blade` is back to its original 5 renders with 100404 adopted, and the live
adopted count is unchanged at 185.

## Defect found BY the live check, fixed here (2026-07-18)

`familyBarrier()` restarts `comfyui.service` — a **live, box-global** systemd
unit. The three admin e2e harnesses launch a real `api.cjs`, and none of them set
`ART_FAMILY_BARRIER=0`, so every gen->matte switch in a spec fired a REAL restart
of the live unit: **15 restarts** during this REQ's own ci.sh run
(`journalctl --user -u comfyui.service`, 18:06:37-18:10:06). REQ-0217 is explicit
that an e2e run never touches live services, and PROJECT.md keeps art sessions
hands-off — a ci.sh from any session would have killed a user's in-flight render,
repeatedly. The unit tests (`artqueue_test.cjs`, `inspection_test.cjs`,
`artfamily_test.cjs`) already opt out through this exact seam; the harnesses were
simply missed when the seam was added.

Fix (b8e6243): `ART_FAMILY_BARRIER=0` in `tools/artadmin_e2e.sh`,
`tools/art_inspect_e2e.sh`, `tools/content_admin_e2e.sh`, next to the isolation
env each already carries (TMPHOME, `ART_ROUTE_MOCK=1`, temp model/export dirs,
`ART_KIT_MATTE_METHOD=borderkey`), with a comment naming why.

Re-gated after the fix — admin trio green and the live unit untouched:
- `artadmin_e2e` **7/7**, `art_inspect_e2e` **1/1**, `content_admin_e2e` **28/28**.
- comfyui restarts during the trio: **0** (was 15); comfyui pid unchanged
  throughout. This is the assertion the fix exists for.
A second full ci.sh was not re-run for it: the change is three env assignments in
test harnesses, touches no shipped code path, and the gates it can affect (the
trio) were re-run in full.

**Disposition:** merged, deployed, live-verified, no known defect. built -> done.
