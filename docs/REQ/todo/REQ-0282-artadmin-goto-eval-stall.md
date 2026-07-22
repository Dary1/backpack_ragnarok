# REQ-0282 — artadmin goto load-stall: lazy-init pixi's module-scope canvas probe

## Origin (2026-07-22 commission)
User standing directive "tackle the goto problem", continued: REQ-0281 removed the
external Google-Fonts load-blocker, but a controlled A/B on the CURRENT master
bundle (`index-D0--QoC6.js`, REQ-0276 monitor overhaul + REQ-0280 schedule-ray-vfx,
merge `5160a91`) still reproduced `artadmin.spec.ts:124`/`:273`
`page.goto: Timeout 20000ms exceeded ... waiting until "load"` — 3/3 at start
loadavg <1 on the new bundle, while the pre-0276 bundle passed 8/8 under loadavg 8.
This REQ root-causes and fixes that stall. It is the remaining blocker for
REQ-0281's done-stamp (see State log).

## Root cause (evidence-first; all probes retained under /tmp/hprobe on the box)
1. **Not a network resource.** Playwright traces of both failing tests show every
   load-blocking subresource (html, css, entry + 5 modulepreloaded chunks) complete
   within ~35 ms of navigation, then **zero page activity for ~26.1–26.2 s** before
   the app boots (`/api/me` etc. start 26 s after nav; goto times out at 20 s).
   The once-suspected hanging `GET /api/profile/dev/canvas` starts AFTER the goto
   timeout (`_monotonicTime` proof) — red herring. `/redesign/assets/bg_canvas.jpg`
   404s harmlessly (hermetic proxy, no such route).
2. **A single blocked module-evaluation task withholds DCL + load.** Longtask
   instrumentation reproduced the gap as ONE main-thread task (2.4–6.8 s in probe
   rigs) starting at script-eval time; `domContentLoadedEventStart` moves with it.
3. **Exact site (CPU profile).** Running the real spec pair (test :49 then :124)
   with a CDP sampling profiler attributes 6.77 s of a 7.0 s goto to
   `canvasUtils` chunk module evaluation: pixi.js v8.19.0
   `lib/rendering/renderers/canvas/utils/canvasUtils.(m)js` evaluates
   `canUseMultiply: canUseNewCanvasBlendModes()` at MODULE SCOPE — two 6x1 canvas
   rasters + a synchronous `getImageData()` readback — plus an eager
   `canvasUtils.tintMethod = canvasUtils.canUseMultiply ? ...` tail. The chunk is
   in the entry's STATIC import graph (modulepreload), so this readback sits inside
   the load-blocking path of EVERY page, including `#/artadmin`.
4. **Why it stalls in e2e.** The admin harness browser is headless-shell
   (`--headless=old`) on SwiftShader (`--use-angle=swiftshader-webgl`); /proc
   sampling during a live failing run shows the shared GPU process burning ~10
   CPU-cores continuously (software raster + `trace: retain-on-failure`
   screencast) while the fresh renderer's eval task sits at ~0 CPU in
   `futex_wait` — the synchronous canvas op queues behind a saturated raster
   path. Tests :124/:273 are exactly the gotos that immediately follow the two
   heaviest prior tests (:49 adopt-flow, :231 queue/renders) inside the same
   browser — the historical "goto-under-load family" (REQ-0222 lineage) is this
   one mechanism; external fonts (REQ-0281) were an additional, independent
   load-blocker on top.
5. **Bundle correlation explained.** The pre-0276 bundle contains the SAME eager
   probe (identical `canvasUtils-BobTNIDZ.js` chunk); A/B probes in an identical
   rig stall BOTH bundles ~6.5 s. The 0276/0280 bundle did not introduce the
   defect — it shifted timing/raster load enough to push the same stall past the
   20 s navigationTimeout deterministically. Killed hypotheses: new-bundle-only
   code path (both stall), Google Fonts (stripped, still fails), hanging API
   route (post-timeout artifact), V8 eager-compile (rounds 3+ fast, wrong shape),
   `--disable-gpu` rescue (stall persists), idle CSS/JS animation
   (`document.getAnimations()` empty on artadmin, 0 canvases).

## Production impact
Production serves the same static graph: every real-user page load runs this
synchronous raster+readback before `load`/`onload` fires. On healthy GPU-composited
browsers it is ~1 ms (upstream pixi ships it to everyone), so no user-visible
production incident is claimed — but clients on software raster / contended GPU
(VMs, remote desktops, low-end machines under load) pay the same seconds-scale
`load` delay. The fix removes the probe from the load path in production too;
strictly an improvement, no behaviour change until the first canvas-tint use.

## Fix (honest layer: the load-blocking client bundle)
`client/patches/pixi.js.patch` (pnpm `patchedDependencies`, recorded in
`client/pnpm-workspace.yaml` + `pnpm-lock.yaml`): make `canvasUtils.canUseMultiply`
and `canvasUtils.tintMethod` lazy cached getters (with setters preserving the
public API) and drop the eager tail assignment, in both `canvasUtils.mjs` and
`canvasUtils.js`. `canUseNewCanvasBlendModes()` is already internally memoised;
first canvas-tint use performs the identical probe with identical semantics.
Nothing else in the graph performs module-scope canvas work (bundle audit).
- Not chosen: route-level lazy-loading of pixi (board/monitor/dex icon graph is
  woven through most pages — out of proportion to the defect, real vfx-regression
  risk); harness browser flags (`--disable-gpu` empirically does not rescue);
  goto/waitUntil weakening (forbidden as primary fix).
- e2e assertions, `waitUntil`, `navigationTimeout` are untouched.

## Verification
- Probe rig (real :49 + :124 pair, tracing on): goto 6.5–7.2 s before → **322 ms** after.
- `tools/artadmin_e2e.sh` on THIS worktree's rebuilt env-carrying bundle: see
  Gates below (8/8 x3 consecutive).
- VFX no-regression: canvas-tint getters are exercised only by pixi's canvas
  renderer fallback (app uses WebGL renderer); scoped client e2e monitor/schedule
  specs (ray pulses, attachment badges, enemy actors) green — see Gates.

## State log
- 2026-07-22 reserved (192c7d8), commissioned under the "tackle the goto problem"
  directive, ACT TWO (post-REQ-0281 A/B).
- **REQ-0281 dependency note:** REQ-0281's done-stamp was gated on the artadmin
  gate being green on the real master bundle; that gate goes green only once THIS
  REQ reaches master. Stamp REQ-0281 done together with/after this merge.
