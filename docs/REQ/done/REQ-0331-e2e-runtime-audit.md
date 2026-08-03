# REQ-0331 — E2E runtime audit: where the wall time actually goes

## Status
built — audit measured and all accepted findings implemented on this branch
(2026-07-28), gates green. Awaiting user acceptance / merge.

Ratified by user directive (2026-07-28): "全て直してください" (fix everything),
with explicit go-ahead to stop `comfyui.service` for the GPU repair.

**Method:** five measured hermetic scoped runs from this REQ worktree
(`req-0331-e2e-runtime-audit`, branch off master 0129152) plus a static read of
the harness. Port decades rented via `tools/port_desk.sh`. No live service, live
data row, or foreign worktree touched.

---

## 1. Verdict

**The suite is not bloated for its scale.** 198 tests for real-browser,
WebGL-rendering end-to-end coverage, and nothing in it is obviously dead weight.
Coverage growth since the REQ-0234 audit is +5% tests.

**What had regressed was the box, not the suite.** The GPU path REQ-0080
delivered had silently died: Chromium was rendering on llvmpipe (CPU software
rasterizer) because the NVIDIA kernel module and userspace libraries no longer
matched. Fixing that plus one helper recovered a third of the wall time.

| | REQ-0234 (07-17) | this REQ, before (07-28) | this REQ, after (07-28) |
|---|---|---|---|
| result | 187 passed / 1 skipped | 195 passed / **2 failed** / 1 skipped | **197 passed / 0 failed / 1 skipped** |
| wall (4 workers) | 207.5 s | 269 s | **182.7 s** |
| per test | 1.11 s | 1.36 s | **0.92 s** |
| WebGL renderer | ANGLE (NVIDIA, RTX 2080) | ANGLE (Mesa, **llvmpipe**) | ANGLE (NVIDIA, RTX 2080) |
| box load peak | 13.9 / 8 cores | 21.4 / 8 cores | ~12 / 8 cores |

Net: **−32% wall vs the degraded state, and −12% vs the best number this suite
has ever recorded** (−17% per test), with the suite 5% larger than at that
record. The one skip is the long-standing REQ-0221 registry skip
(`dex-admin.spec.ts:102`), identical to REQ-0234's.

---

## 2. Findings and what was done

### F1 (High) — The GPU was unusable box-wide; e2e had silently fallen back to CPU rendering. FIXED.

`--use-angle=vulkan` was not reaching the RTX 2080. Measured with the exact
`GPU_ARGS` from `playwright.config.ts`:

    before: {"renderer":"ANGLE (Mesa, Vulkan 1.4.335 (llvmpipe (LLVM 21.1.8 256 bits)), llvmpipe)"}
    after:  {"renderer":"ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 2080 (0x00001ED0)), NVIDIA)"}

REQ-0080 recorded the working string as `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA
GeForce RTX 2080), NVIDIA)` — i.e. the after-state is the documented one.

Root cause — an unrebooted driver upgrade:

| | version |
|---|---|
| kernel module (`/proc/driver/nvidia/version`) | 595.71.05 (loaded at the 07-18 boot) |
| userspace (`dpkg -l`) | 595.84 (installed **2026-07-24 06:58**) |

`nvidia-smi` failed outright with `Failed to initialize NVML: Driver/library
version mismatch`. Four days of drift. During a run, 8 Chromium processes carried
`--use-angle=swiftshader-webgl` despite the vulkan flag, and each worker
gpu-process burned 100-135% CPU. This was **not e2e-specific**: nothing on the
box could reach the GPU, the art pipeline included.

**Repair (no reboot needed):** `systemctl --user stop comfyui.service` (the only
process holding `/dev/nvidia*`), then
`rmmod nvidia_uvm nvidia_drm nvidia_modeset nvidia && modprobe nvidia nvidia_uvm
nvidia_modeset nvidia_drm`, then restart comfyui. Kernel module now reports
595.84; `nvidia-smi` healthy (RTX 2080, 595.84); comfyui back up on :8188 and
now *visible* to `nvidia-smi` (112 MiB) — which it could not be before.
backpack-api / backpack-web / backpack-tunnel were never touched.

**Guard added (`client/e2e/global-setup.ts`):** with `E2E_GPU=1` the run now
probes `UNMASKED_RENDERER_WEBGL` once (~0.5 s) and prints
`GPU rendering CONFIRMED -- <renderer>`. If it is not NVIDIA it prints a
78-column banner naming the likely kernel/userspace drift and the exact repair
commands. Warns by default; `E2E_REQUIRE_GPU=1` makes it an abort — the same
seam shape as the existing `E2E_REQUIRE_WORKTREE`. A silent 25% tax is now a
printed line.

### F2 (High) — 4 workers saturated the box under CPU rendering. RESOLVED BY F1; keep 4.

Same spec, same tree, before the repair:

| `dex.spec.ts` (11 tests) | serial, quiet box | inside the 4-worker run |
|---|---|---|
| total | 25.4 s | 49.3 s |

**1.94x inflation purely from self-contention** — each llvmpipe browser needed
more than a core, so 4 workers already exceeded 8. Raising `E2E_PARALLEL` would
have made per-test time worse, not better.

After the repair the same 11 tests run 14.1 s serially (−44%), and the 4-worker
run peaks at ~12/8 load instead of 21/8. `E2E_PARALLEL=4` stays the default; the
renderer assertion is now the precondition for ever revisiting 6.

### F3 (High) — Both reds were environmental or a test defect. NEITHER was a product bug.

This corrects the first pass of this report, which called them a genuine
regression and a product race. Both readings were wrong, and both were wrong
because the only environment available to test in was the degraded one.

1. **`warehouse-sell.spec.ts:40` (REQ-0328) — NOT a regression.** It failed under
   llvmpipe both in parallel AND serially, which is why the first pass called it
   load-independent. On the restored GPU it passes: alone (2.9 s), after
   `dex.spec.ts`, and in the full suite. Re-verified against **unmodified
   master** with the GPU restored (`git stash`, rebuild, 23/23 green) — so it
   was the renderer, not this branch's changes, and there is nothing to fix in
   REQ-0328. The sell button was always rendered; the DOM probe confirmed it.

2. **`workshop.spec.ts:121` — a stale-baseline test defect, not a double-mint.**
   The symptom (`expect(newBpIds.size).toBe(1) // Received: 2`) *is* real and
   still reproduced at 4 workers after the GPU repair, so it earned its
   investigation. But it is not a double-mint. Evidence, from the failing run's
   own trace (`test-results/.../trace.zip`, final
   `GET /api/profile/default/canvas`):

   - the two "new" BPs were `bp_7300dd2f2961360c` (princess, 6 cells) and
     `canvas_bp2` (berserker, 18 cells);
   - `canvas_bp2` is a **committed fixture** BP — it lives in
     `client/e2e/fixtures/profiles/e2e_ci.json` alongside `canvas_bp1` and
     `homebp`. Minted BP uids are `bp_<hex>` (`genId('bp')`,
     `server/services/gacha.cjs:201`); no fixture BP is;
   - the assertion two lines earlier, `expect(totalLrdst).toBe(989)`, had
     already **passed** — exactly 10 lrdst charged, i.e. exactly one roll;
   - bonus slots cannot explain it either: every declared bonus pool in
     `content/live` is `po` or `si`, never `bp`.

   So the server minted one BP and charged for one. The test's baseline is
   whatever `/api/profile/default/canvas` happened to hold when
   `seedDevLrdstBalance` read it, and a fixture BP can re-enter the profile
   between that read and the read-back, where the diff counts it as freshly
   minted.

   **Fix:** restrict the diff to minted (`bp_`-prefixed) ids. This removes the
   false positive without weakening the invariant — a genuine double-mint would
   still produce two `bp_` ids and still fail. No product code touched.

### F4 (Medium) — App boot dominates the per-test budget; its fixed sleep is gone. FIXED.

Before the repair, steady-state per test on a quiet box was ~2.0 s and for
read-and-assert specs essentially all of it was boot: fresh context, 1.56 MB JS
bundle, PixiJS init, first render. ~180 of the 198 tests boot the app, so roughly
340 s of the 914.8 s test-time budget (~37%) was boot, not assertion. Per-test
isolation is the right default and most of that is the price of it.

The removable slice was the fixed sleep ending `bootApp`:

    await page.waitForTimeout(400);   // helpers.ts, after the badge already reads "live"

~180 executions x 400 ms = ~72 s of assertion-free sleep per suite, and the
suite's most load-sensitive wait — the badge only proves the STORE is live, while
the PixiJS boards mount asynchronously after it, so on a busy box 400 ms could
elapse before the first frame and the failure would surface later as an unrelated
pixel-coordinate miss.

**Fix, in the shape REQ-0234 gave `waitForAutoSave`:** `Board.tsx` and
`InventoryBoard.tsx` set `data-board-ready="1"` on their canvas **after the first
real `render()`** (and drop it on teardown) — purely additive, a data attribute
nothing in the app reads. `bootApp` waits for every `canvas.board-canvas` to
carry it, with the same quiet fallthrough `waitForAutoSave` uses (5 s budget,
then proceed; the caller's own assertions remain the real gate).

Measured on `dex.spec.ts`, serial, quiet box: 25.4 s (llvmpipe, fixed sleep) →
**14.1 s** (GPU + event wait). Drag-heavy specs (`baseline-smoke`, `bp-transfer`,
`tab-reorder-trash`) re-run green, which is the coverage that would have caught a
too-early board.

Suite-wide there remain 85 `waitForTimeout` sites totalling 27.3 s nominal —
next on the list is `drag()`'s per-step 25 ms.

### F5 (Low) — Per-file boot duplication: deliberately NOT taken.

Files where every test re-boots the same state: `dex.spec.ts` 11,
`link-trace.spec.ts` 8 (each re-PUTs an identical `makeCanvas()` then boots),
`canvas-side-panel.spec.ts` 7, `item-tap-tooltip.spec.ts` 5, `dex-card.spec.ts` 5,
`canvas-chrome.spec.ts` 3. Sharing one page per file would save ~30 boots.

But these specs are not read-only — `dex.spec.ts` alone performs 25 click
operations. That trades a known ~15 s for an unknown state-leakage risk across
tests, and after F1+F4 the wall time no longer justifies it. **Held, on purpose.**
If it is ever taken, take it one file at a time with a deliberate-regression check.

---

## 3. Changes on this branch

| file | change |
|---|---|
| `client/e2e/global-setup.ts` | F1 renderer assertion (`E2E_GPU=1` probe, warn / `E2E_REQUIRE_GPU=1` abort) |
| `client/e2e/helpers.ts` | F4 `bootApp` waits for board readiness instead of sleeping 400 ms |
| `client/src/board/Board.tsx` | F4 publishes `data-board-ready` after first render; clears on teardown |
| `client/src/board/InventoryBoard.tsx` | F4 same |
| `client/e2e/workshop.spec.ts` | F3(2) diff restricted to minted `bp_` uids |
| `web/app/**` | rebuilt docroot (tracked build output) |

Box-side, not in git: nvidia kernel modules reloaded to 595.84.

## 4. Evidence appendix

- All runs from `~/backpack_ragnarok_worktrees/req-0331-e2e-runtime-audit`
  @ master 0129152.
- `/tmp/req0331_e2e.log` + `.json` — before, 4 workers, llvmpipe: 269 s, 195/2/1.
- `/tmp/req0331_serial.log` — before, serial: 80.8 s, 22 passed / 1 failed.
- `/tmp/req0331_base.log` — **unmodified master**, GPU restored, serial: 23/23
  green (this is what disproved the REQ-0328 "regression").
- `/tmp/req0331_f4check.log` — GPU + F4, serial, 4 drag-heavy files: 28/28 green.
- `/tmp/req0331_w4.log` + `.json` — GPU + F4, 4 workers: 183.7 s, 196/1/1 (the
  remaining 1 is F3(2), fixed after this run).
- `/tmp/req0331_gate.log` — **final gate**, 4 workers, `E2E_REQUIRE_GPU=1`:
  **182.7 s, 197 passed / 0 failed / 1 skipped**, renderer CONFIRMED NVIDIA.
- Renderer probes: standalone Playwright launch with `playwright.config.ts`'s
  own `GPU_ARGS`, reading `WEBGL_debug_renderer_info`.
- Driver evidence: `/proc/driver/nvidia/version`, `dpkg -l | grep nvidia`,
  `zgrep 595.84 /var/log/dpkg.log*`, the `nvidia-smi` NVML error,
  `ps -eo args | grep -o "use-angle=[a-z-]*"`.
- Double-mint disproof: `trace.zip` resource bodies decoded with `zipfile`;
  `client/e2e/fixtures/profiles/e2e_ci.json`; `server/services/gacha.cjs:201`.

## Log
- 2026-07-28 reserved as REQ-0331 (77cb161) on branch req-0331-e2e-runtime-audit.
- 2026-07-28 audit executed (2 measured runs + static read); report written;
  reserved -> draft (5ae24f2, b98039e).
- 2026-07-28 user ratified all findings; GPU repaired on the box; F1 guard, F4
  and F3(2) implemented; F3(1) disproved against unmodified master; F5 held.
  draft -> built.

## Deploy record (2026-07-28)
- Merged to master b99d297 (--no-ff), together with REQ-0333 whose fix this
  REQ's own release gate uncovered. Combined gate before the merge:
  `tools/release.sh` **CI GREEN**, 505 s wall (42 stages; admin trio 8/1/28,
  registry stage 4/4 no-skip, scoped e2e 197 passed / 0 failed / 1 skipped),
  `dist unchanged -- nothing to commit`.
- `systemctl --user restart backpack-api` (REQ-0333 touches server/storage).
  backpack-api / backpack-web / backpack-tunnel / comfyui all active
  afterwards; api 200, web 200, tunnel /app 200, tunnel /api/health 200.
- Live verification that THIS change shipped, not just that the box is up:
  https://backpack-dev.qtie.jp/app/ serves assets/index-DRsciBYG.js, which is
  HEAD's committed bundle, and that bundle contains `data-board-ready` -- the
  F4 readiness marker. built -> done.
- Note for the next deployer: the main checkout's web/app carried an
  UNCOMMITTED rebuild (mtime 09:31, from another session) before this merge.
  It was restored to HEAD and discarded -- a build artifact, reproducible from
  source, and the merge replaced it anyway. Worth watching: a service serving
  an uncommitted dist is invisible until someone looks.
