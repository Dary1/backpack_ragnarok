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
