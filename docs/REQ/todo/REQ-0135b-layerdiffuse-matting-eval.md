# REQ-0135b — layerdiffuse-matting-eval

**Split:** 2026-07-12 from REQ-0135 (layerdiffuse-matting-spike). The install
phase is complete and recorded in REQ-0135a-layerdiffuse-node-install (done).
This file carries the ratified, still-pending evaluation. Spec below is the
original REQ-0135 goal unchanged; it was cleared (todo) on ratification.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-4 matte),
`docs/llm_managed/unit_icon_pipeline.md` (S4 matte quality concern).

## Goal (unchanged from REQ-0135)

Evaluate replacing the post-hoc matte step (rembg `birefnet-general` +
edge-key fallback) with **LayerDiffuse latent transparency** — alpha
generated AT diffusion time instead of separated afterwards. Expected win:
the failure mode the unit pipeline itself flags (fine silhouettes — hair,
weapon tips, wings) disappears, because no background separation ever
happens.

## Rationale (from review)

- rembg is a separation model guessing a boundary that diffusion already knew.
- LayerDiffuse patches SDXL to emit an alpha channel natively; works with
  the CURRENT checkpoint on the 8 GB card (now installed — REQ-0135a).
- Verified pain: `hilt` smoke-test matte coverage 10.99% (item pipeline
  verification log) and unit S4's explicit "matte quality is part of the
  review".

## Remaining scope

- Side-by-side: 5 subjects × seeds 101/202 × {route A = production
  `gen_item_icons.py`, route B = LayerDiffuse}, same checkpoint
  (JuggernautXL V9), same sampler settings (30 steps, cfg 6.5,
  dpmpp_2m/karras). Subjects biased to worst cases per the original REQ:
  `hilt`, `blade`, `dagger` (verbatim live prompts), `wing` (feather probe),
  `elf_bust` (unit-hair probe).
- Compare matte edges at 256 px AND 64 px; run the production scorer
  (`tool_icon_score.py`, which imports `tool_fit_check.py`) on both routes;
  note VRAM/time overhead on the RTX 2080 (route B watcher logs both).
- Numbered side-by-side gallery under `web/preview/req-0135-layerdiffuse/`.

## Staged assets (committed on branch req-0135-layerdiffuse-matting-spike)

- `content/batches/req-0135-layerdiffuse-spike/spike_defs.json` — the 5
  subjects (blade/hilt/dagger copied verbatim from live defs; wing +
  elf_bust custom probes following the batch-003 style-guide template,
  near-white background clause KEPT on both routes for A/B fairness).
- `tools/scratch_req0135_ld_spike.py` — route-B generator: reuses
  gen_item_icons submit/wait/coverage, adds LayeredDiffusionApply
  ("SDXL, Attention Injection", weight 1.0) + LayeredDiffusionDecodeRGBA,
  writes `<id>_c<k>_s<seed>[_alpha].png` so `tool_icon_score.py` runs
  unchanged; logs per-job time + VRAM peak (nvidia-smi sampler thread).
- `tools/scratch_req0135_build_defs.py` — spike_defs builder (rerunnable).
- `tools/scratch_req0135_build_gallery.py` — numbered gallery builder
  (A raw / A matte 256 / A matte 64+4x / B 256 / B 64+4x, coverage + method
  + time + VRAM per row, checkerboard alpha, dark theme, relative paths).
- Server-side automation on llmlocal (`~/scratch/`, NOT in git):
  `req0135_watch_and_run.sh` (waits until no req0136_bakeoff process AND
  ComfyUI queue empty for 120 s → route A → route B → marker
  `tmp/req0135_gen_complete`) and `req0135_postprocess.sh` (marker →
  scores_base.json / scores_ld.json → gallery into worktree
  `web/preview/req-0135-layerdiffuse/` → marker `tmp/req0135_post_complete`).
  **Disarmed 2026-07-12** (processes killed on close). Re-arm:
  `setsid nohup ~/scratch/req0135_watch_and_run.sh > ~/scratch/req0135_watch.log 2>&1 &`
  and same for `req0135_postprocess.sh`.
- ComfyUI: LayerDiffuse nodes live (REQ-0135a). First route-B job also
  downloads LD weights (~1.5 GB) — allow extra time (spike script default
  `--timeout 1200`).

## Preconditions

- **Quiet GPU box.** REQ-0136 bakeoff (or any other art workload) must not
  share the ComfyUI queue — see REQ-0135a incident log (history clears break
  wait_done; checkpoint swaps poison timing; OOM risk). Coordinate via the
  user before running.
- ComfyUI up at `127.0.0.1:8188` (manual start policy until REQ-0139).

## Non-goals (unchanged)

No pipeline-doc rewrite yet; no `content/live/` writes; no checkpoint change
(that is REQ-0136).

## Gates (unchanged from REQ-0135)

- Numbered side-by-side gallery under `web/preview/` for user verdict.
- Decision recorded here. If green: item/unit pipeline S4/S5-4 doc update
  and `gen_item_icons.py` route flag follow as the implementation.

## Execution log

### 2026-07-12 — re-armed (automation parked on a busy box)

Session resumed REQ-0135. Precondition "quiet GPU box" was NOT met at resume
time: the RTX 2080 was at 99% / 6.4 GB, driven by a concurrent sequencer
`~/scratch/req_seq5.sh` (REQ-0138 tiling running -> REQ-0136 dsxl bakeoff ->
REQ-0136 flux bakeoff -> galleries). Per the REQ-0135a incident log, running
into that contention is what broke the first attempt. Nothing was forced onto
the queue; the automation was re-armed to fire itself when the box goes quiet
(user directive, 2026-07-12).

**Gating bug found and fixed in `~/scratch/req0135_watch_and_run.sh`.**
The original quiet predicate was `no req0136_bakeoff process` AND `ComfyUI
queue empty for 120 s`. That is unsafe against the current box: `req0138_tiling.py`
does long CPU-side seam analysis between its GPU jobs, so the queue can read
empty for well over 120 s while a run is still in flight — the watcher would
have started route A on top of REQ-0138 and re-created exactly the failure
0135a documented. The predicate now also watches the owning processes:

    BUSY_RE="req_seq5|req0136_bakeoff|req0138_tiling|req0137_|req0131_"

plus a final re-check (`exec "$0"` back into the wait) after the 120 s quiet
window, so a job that slips in on the last tick cannot be raced. Regex was
self-tested against the live process table (matches seq5 + both tiling procs).

**Stale state cleared** before arming: the aborted first attempt left route A
dead at `[2/10] blade s202` (killed by the concurrent session). Removed
`content/batches/req-0135-layerdiffuse-spike/{base,ld}/` and
`tmp/req0135_{base,ld}.log` + both markers, so route A restarts from scratch
on a clean slate.

**Armed** (both detached, PPID 1, verified alive after session close):

- `req0135_watch_and_run.sh` (PID 257662) — parked in the wait loop, correctly
  reporting the box busy. On quiet: route A (`gen_item_icons.py`, production)
  -> route B (`scratch_req0135_ld_spike.py`, LayerDiffuse) over the 5 spike
  entries (blade, hilt, dagger, wing, elf_bust) x 2 candidates x seeds 101/202,
  then marker `tmp/req0135_gen_complete`.
- `req0135_postprocess.sh` (PID 257688) — blocked on that marker. On fire:
  `tool_icon_score.py` on both routes -> `scores_base.json` / `scores_ld.json`
  -> numbered gallery into `web/preview/req-0135-layerdiffuse/` -> marker
  `tmp/req0135_post_complete`.

Route B first job also pulls the ~1.5 GB LD weights from HF (allow extra time).

**Next check-in:** `tmp/req0135_post_complete` present -> gallery ready for the
user verdict gate. Until then this REQ stays in `todo/` (no work has run).
