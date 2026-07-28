# REQ-0331 — E2E runtime audit: where the wall time actually goes

## Status
draft — measured audit delivered 2026-07-28; findings await owner ratification.
No product or harness code changed by this REQ. Each finding is problem /
evidence / recommendation so accepted items can be lifted into their own REQs.

**Method:** two measured hermetic scoped runs from this REQ worktree
(`req-0331-e2e-runtime-audit`, branch off master 0129152), plus a static read of
the harness. Port decades rented via `tools/port_desk.sh`. No live service, live
data row, or foreign worktree touched.

---

## 1. Verdict

**The suite is not bloated for its scale.** 198 tests / 269 s wall = **1.36 s per
test** for real-browser, WebGL-rendering end-to-end tests. REQ-0234 measured
1.11 s/test on the same rig while the GPU still worked. Nothing in the suite is
obviously dead weight; coverage growth since REQ-0234 is +5% tests.

**What regressed is the box, not the suite.** The GPU path REQ-0080 delivered is
silently gone: Chromium renders on **llvmpipe (CPU software rasterizer)** because
the NVIDIA kernel module and userspace libraries no longer match. That inflates
every render-bearing test, saturates the box at 4 workers, and is already
producing a load-dependent failure.

| | REQ-0234 (2026-07-17) | this run (2026-07-28) |
|---|---|---|
| tests | 187 passed / 1 skipped | 195 passed / 2 failed / 1 skipped |
| wall (4 workers) | 207.5 s | **269 s** |
| per test | 1.11 s | **1.36 s (+23%)** |
| WebGL renderer | ANGLE (NVIDIA, Vulkan, RTX 2080) | **ANGLE (Mesa, Vulkan, llvmpipe)** |
| box load peak | 13.9 / 8 cores | **21.4 / 8 cores** |

---

## 2. Findings

### F1 (High) — The GPU is unusable box-wide; e2e silently fell back to CPU rendering

`--use-angle=vulkan` no longer reaches the RTX 2080. Measured directly with the
exact `GPU_ARGS` from `playwright.config.ts`:

    {"renderer":"ANGLE (Mesa, Vulkan 1.4.335 (llvmpipe (LLVM 21.1.8 256 bits)), llvmpipe)",
     "vendor":"Google Inc. (Mesa)"}

REQ-0080 recorded the working string as
`ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 2080), NVIDIA)`.

Root cause — an unrebooted driver upgrade:

| | version |
|---|---|
| kernel module (`/proc/driver/nvidia/version`) | **595.71.05** |
| userspace (`dpkg -l`: `nvidia-driver-595-open`, `libnvidia-gl-595`) | **595.84** |

`nvidia-smi` fails outright: `Failed to initialize NVML: Driver/library version
mismatch. NVML library version: 595.84`. Box uptime 10 days.

During the run, 8 Chromium processes carried `--use-angle=swiftshader-webgl`
despite the vulkan flag, and each worker gpu-process burned **100-135% CPU**.

**This is not e2e-specific**: the GPU art pipeline (ComfyUI, stable-fast-3d,
UniRig) cannot reach the GPU either while the mismatch stands.

**Recommend:** reboot llmlocal (or reload the nvidia kernel modules) to realign
kernel and userspace, then re-assert the renderer string. Expected recovery
~20-25% of e2e wall time on the REQ-0234 comparison, plus the flake headroom in
F2. Because a silent fallback cost a week of slow runs unnoticed, add a
**one-line renderer assertion in `global-setup.ts`** when `E2E_GPU=1`: read
`UNMASKED_RENDERER_WEBGL` once and warn (or abort) if it is not NVIDIA. Cheap,
and it converts a silent 25% tax into a printed line.

### F2 (High) — 4 workers already saturate the box under CPU rendering; more workers would hurt

Same spec, same tree, two runs:

| `dex.spec.ts` (11 tests) | serial, quiet box | inside the 4-worker run |
|---|---|---|
| total | **25.4 s** | **49.3 s** |
| steady-state per test | ~2.0 s | ~4.5 s |

**1.94x inflation purely from self-contention.** Across the suite: sum of test
durations 914.8 s at 4 workers vs 269 s wall = 3.4x nominal, but the
contention-free work is roughly half that, so parallelism really buys ~1.75x of
a theoretical 4x. Raising `E2E_PARALLEL` (6 slots are available per decade) would
make per-test time worse, not better, while the GPU is down.

Consequence already realized: `workshop.spec.ts:121` FAILED in the parallel run
and PASSED serially — see F3.

**Recommend:** keep `E2E_PARALLEL=4` until F1 is fixed; revisit 6 only after the
renderer assertion confirms NVIDIA. Do not treat slowness as a worker-count
problem.

### F3 (High) — Two reds on master, and one of them is not a timing flake

Both runs, master 0129152:

1. **`warehouse-sell.spec.ts:40` (REQ-0328) — genuine RED.** Fails in the
   parallel run AND serially on a quiet box.
   `locator.click: Timeout 10000ms exceeded` waiting for
   `[data-testid="schedule-sell-btn-wh_778110e8a86a90d4"]` — the sell button for
   the granted warehouse row never appears. Reproducible, load-independent.

2. **`workshop.spec.ts:121` — load-dependent, but the symptom is a product race,
   not a slow selector.** Failed only under load with
   `expect(newBpIds.size).toBe(1) // Received: 2` — **one gacha roll minted two
   BPs**. A pure timing flake would surface as a timeout; minting twice points at
   a missing debounce / idempotency guard on the roll action that only loses the
   race when the box is slow. Passed at 5.3 s serially, failed at 8.0 s parallel.

**Recommend:** file (1) as a REQ-0328 regression. Investigate (2) as a roll
idempotency defect rather than re-running until green — with `retries: 0` (the
correct policy), a real double-fire and a flake are indistinguishable from the
summary line alone.

### F4 (Medium) — App boot dominates the per-test budget; the cheap part of it is a fixed sleep

Steady-state per test on a quiet box is ~2.0 s, and for read-and-assert specs
essentially all of it is boot: fresh context, 1.56 MB JS bundle (`web/app` 2.0 MB
total), PixiJS init, first render. ~180 of the 198 tests boot the app (79
`bootApp` + 48 `loadFixtureAndBoot` call sites, several inside loops), so roughly
**340 s of the 914.8 s test-time budget (~37%) is app boot, not assertion**.
Per-test isolation is the right default and this is mostly the price of it.

The removable slice is the fixed sleep at the end of `bootApp`:

    await page.waitForTimeout(400);   // helpers.ts, after the badge already reads "live"

~180 executions x 400 ms = **~72 s of pure sleep** in the test-time budget (~18 s
of wall at 4 workers) with no assertion attached, immediately after an
event-based wait already proved the app is live. `drag()` adds a further fixed
`8 x 25 ms + 150 + 250 = 600 ms` per drag (~40 call sites, several in loops);
`longPress()` 900 ms.

Suite-wide there are **85 `waitForTimeout` sites totalling 27.3 s nominal** — a
count that is flat versus the ~76 REQ-0234 found only because REQ-0234 already
fixed the single worst one (`waitForAutoSave`, now event-based).

**Recommend:** replace the trailing 400 ms in `bootApp` with whatever it is
actually waiting for (first board frame, or a render-complete flag), the same
treatment REQ-0234 gave `waitForAutoSave`. One helper, ~18 s of wall, and it
removes a load-sensitive sleep from ~90% of the suite. The 25 ms per drag step is
second on the list.

### F5 (Low) — Per-file boot duplication is real but not free to remove

Files where every test re-boots the same state: `dex.spec.ts` 11,
`link-trace.spec.ts` 8 (each re-PUTs an identical `makeCanvas()` then boots),
`canvas-side-panel.spec.ts` 7, `item-tap-tooltip.spec.ts` 5, `dex-card.spec.ts` 5,
`canvas-chrome.spec.ts` 3. Sharing one page per file
(`describe.configure({mode:'serial'})` + `beforeAll`) would save ~30 boots
(~60 s test time, ~15 s wall).

**But** these specs are not purely read-only — `dex.spec.ts` alone performs 25
click operations (tab switches, locale toggles, selection). Sharing a page trades
a known 15 s for an unknown state-leakage risk across tests. **Recommend: do F4
first and leave F5 alone** unless the wall time still hurts afterwards; if taken,
take it one file at a time with a deliberate-regression check.

---

## 3. Recommended action order

1. **F1** — reboot / reload the NVIDIA modules, then add the renderer assertion.
   Highest payoff, lowest risk, and it unblocks the art pipeline too.
2. **F3** — the `warehouse-sell` red is on master right now; the workshop
   double-mint is a product-level race worth its own REQ.
3. **F4** — the trailing 400 ms in `bootApp`. One helper, suite-wide payoff.
4. **F2** — revisit `E2E_PARALLEL` only after F1 is confirmed.
5. **F5** — hold.

## 4. Evidence appendix

- Runs from `~/backpack_ragnarok_worktrees/req-0331-e2e-runtime-audit` @ master
  0129152. Parallel run: `/tmp/req0331_e2e.log` + `/tmp/req0331_e2e.json`
  (E2E_PARALLEL=4, E2E_GPU=1, 269 s wall, 195/2/1). Serial cross-check:
  `/tmp/req0331_serial.log` (E2E_PARALLEL=1, dex + warehouse-sell + workshop,
  80.8 s wall, 22 passed / 1 failed).
- Renderer probe: standalone Playwright launch with the exact `GPU_ARGS` from
  `playwright.config.ts`, reading `WEBGL_debug_renderer_info`.
- Driver evidence: `/proc/driver/nvidia/version`, `dpkg -l | grep nvidia`, the
  `nvidia-smi` NVML error, `ps -eo args | grep -o "use-angle=[a-z-]*"`.
- Files read: `client/playwright.config.ts`, `client/e2e/{helpers,global-setup,
  e2e-env}.ts`, all 38 `*.spec.ts` (grep metrics), `tools/{ci.sh,e2e_ports.sh,
  e2e_fleet.cjs,port_desk.sh}`, REQ-0080 and REQ-0234 (done).

## Log
- 2026-07-28 reserved as REQ-0331 (77cb161) on branch req-0331-e2e-runtime-audit.
- 2026-07-28 audit executed (2 measured runs + static read); report written;
  reserved -> draft pending owner ratification.
