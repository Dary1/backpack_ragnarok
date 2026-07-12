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

### 2026-07-12 (later) — first real run FAILED; root cause found in the LD node

The arm-#1 watcher did fire (10:05:12 UTC, once the box went quiet) and ran both
routes. Both failed. Nothing usable was produced; the results it published have
been deleted.

**Route A — OOM-killed.** `gen_item_icons.py` completed exactly one job
(`blade c1 s101`, 336.6 s, birefnet matte coverage 11.50%) and was SIGKILLed on
job 2/10 (`exit=137`, kernel OOM-killer, PID 990134). This is the *third* OOM on
this box today: the 23 GB host cannot hold ComfyUI (~11 GB RSS with SDXL
resident) plus a second heavy python (rembg/birefnet) plus whatever a concurrent
session is running. dmesg shows repeated `Killed process … (pt_main_thread)` —
ComfyUI itself was OOM-killed at 05:01:53, which is also why the arm-#1 watcher
had earlier appeared to hang (see below).

**Route B — 10/10 jobs failed, and the cause is a real bug, not the box.**
Every job returned a ComfyUI execution error from node
`LayeredDiffusionDecodeRGBA`:

    AttributeError: 'JoinImageWithAlpha' object has no attribute
                    'join_image_with_alpha'
    custom_nodes/ComfyUI-layerdiffuse/layered_diffusion.py:132

ComfyUI core has migrated `JoinImageWithAlpha` to the v3 schema API — it is now
`io.ComfyNode` with a `@classmethod execute(cls, image, alpha)`. The old
instance method the custom node calls no longer exists. Upstream
ComfyUI-layerdiffuse (HEAD `b4f6a9e`) has not caught up. So REQ-0135a's
"verified live" check (all 8 `LayeredDiffusion*` nodes present in
`/object_info`) was necessary but **not sufficient**: the nodes register fine
and only fail at execution time.

**Fix — in our code, not in ComfyUI.** PROJECT.md holds third-party checkouts as
infrastructure ("use them, do not modify") and the art ComfyUI as HANDS-OFF, so
patching `layered_diffusion.py` was rejected. Instead
`tools/scratch_req0135_ld_spike.py` now builds the RGBA tail from **core** nodes,
which are unaffected by the Python-level API drift:

    LayeredDiffusionDecode  -> (IMAGE, MASK)
    InvertMask(mask)        -> alpha
    JoinImageWithAlpha(image, alpha) -> RGBA -> SaveImage

Equivalence is exact. The broken node computed `alpha = 1.0 - mask` and passed
that to core's join, whose `alpha` input is itself a mask that it inverts again
(`alpha = 1.0 - resize_mask(alpha)`), so the alpha actually emitted was just
`mask`. `InvertMask` + `JoinImageWithAlpha` reproduces that double inversion
node-for-node. Route B therefore stays a like-for-like A/B against route A.

**Two harness bugs also fixed (both had produced false confidence):**

1. *The watcher could park forever.* `qlen()` fell back to `echo 1` (= "queue
   busy") whenever `curl` failed, so a **dead** ComfyUI was indistinguishable
   from a busy queue. After ComfyUI was OOM-killed at 05:01:53 the watcher sat
   waiting on a service that no longer existed, silently. The runner
   (`~/scratch/req0135_run.sh`) now checks liveness, queue, competing processes
   and free RAM separately, names its blocker in the log every time it changes,
   and heartbeats — it can never park mutely again. A `MIN_AVAIL_MB=8000` guard
   was added so it will not start a route into a box that is about to OOM.
2. *The postprocess published a failed run.* It fired on the completion marker
   without checking that anything had been generated, scored the single
   surviving route-A image (`scored=1 skipped=4`), and built a "gallery" from
   it. It now refuses to score or publish unless both routes produced all 10
   candidates, and drops `tmp/req0135_post_incomplete` instead.

The busy-process guard also had `req0131_` dropped from its regex during a
rewrite; it was caught by a self-test before arming, but it would have started
route A on top of REQ-0131's live generation. Restored.

**State:** all false artifacts (partial `base/`, empty `ld/`, `scores_*.json`,
`web/preview/req-0135-layerdiffuse/`) deleted. Spike script fixed. Harness
hardened. Nothing has been re-run yet — the box is still contested (a concurrent
session is running `req0131_spike.py`, and ComfyUI is currently down again).
REQ-0135b stays in `todo/`: still no evaluation data, still no verdict.

**Blocking on infra, and this is now REQ-0139's case in full.** Three ComfyUI
OOM kills, a false "seq5 DONE" (its REQ-0136 dsxl/flux legs no-opped in 9
seconds against a dead ComfyUI, so that bakeoff did not actually run), and a
route-A kill — all in one day, all from multiple agent sessions sharing one
un-owned ComfyUI. A single-owner queue is not cosmetic.

### 2026-07-12 (exclusive run) — LD works; two blocking defects found and fixed

User directive: take the box exclusively and run to completion. REQ-0127's
`gen_unit_icons --rematte-only` was in flight — it is CPU-only (no GPU, no
ComfyUI queue), real work, and 9 minutes from finishing, so it was **waited out,
not killed**. ComfyUI was then started (it had been OOM-dead since 05:01:53).

**The graph fix is confirmed working.** A 1-job smoke test (added precisely
because 0135a's "nodes are registered" check proved insufficient) passed:
`exit=0 alphas=1`, 236.3 s, VRAM peak 6482 MiB. LayerDiffuse emits RGBA through
`LayeredDiffusionDecode -> InvertMask -> JoinImageWithAlpha`, no ComfyUI
modification. Source confirms the wiring is exactly equivalent to the broken
node's intent: `decode()` returns `pixel_with_alpha[..., 0]` as the MASK — i.e.
the true opacity — and the old code's `1.0 - mask` was undone again inside
core's join, which inverts its `alpha` input.

#### Defect 1 — the spec's "A/B fairness" clause silently voids route B

The smoke test's alpha came back **essentially solid**: coverage 99.93% (route A
on the same subject: 11.50%), alpha mean 0.962, 96.6% of pixels > 0.5, corners
(background) 0.55, centre (subject) 0.21 — not a matte at all.

The cause is in the ratified spec. All five spike prompts carry
`plain uniform near-white background` and `clean flat backdrop`, deliberately
kept on both routes "for A/B fairness". But that clause is the one instruction
that forecloses what this REQ exists to measure. Told to paint a near-white
backdrop, SDXL+LayerDiffuse paints one **and marks it opaque**. There is no
transparency to compare, and the run would have produced a confident, false
"LayerDiffuse is useless" verdict.

Fairness is not "identical prompts"; it is "each route configured the way it
would actually ship". So a third arm was added, and the misleading one kept as
evidence:

| arm | prompt | matte |
|---|---|---|
| A | with bg clause | rembg birefnet-general + edge-key (production) |
| B | with bg clause (as specced) | LayerDiffuse latent alpha |
| C | **bg clause stripped** | LayerDiffuse latent alpha |

`content/batches/req-0135-layerdiffuse-spike/spike_defs_nobg.json` +
`tools/scratch_req0135_build_nobg_defs.py` (only the positive prompt is touched;
`gen_negative` is byte-identical). The gallery builder now renders A/B/C and
carries a note telling the reviewer to read B and C together — B is a
misconfiguration, not a verdict on the technique.

#### Defect 2 — route A cannot run on this box at all (reproducible OOM)

Route A was OOM-killed at job 2/10 **twice**, at 10:12:35 and 14:34:36, both at
~12.3 GB RSS (kernel `Killed process … (python)`, exit 137). Not contention,
not bad luck — arithmetic. `gen_item_icons` mattes *in-process*, so the SDXL
checkpoint inside ComfyUI (~11 GB RSS) and birefnet (~12 GB RSS) are resident at
the same time on a 23 GB box.

REQ-0127 had already demonstrated the escape hatch without anyone noticing: its
`--rematte-only` pass ran birefnet at 13 GB perfectly happily **because ComfyUI
was not running**. `--rematte-only` was half of a split that had no other half.

Added `--no-matte` to `tools/gen_item_icons.py` (additive, opt-in, default off —
every existing caller behaves byte-identically). The run is now ordered so the
two big models are never co-resident:

    1. arm C   : LayerDiffuse, no bg clause     (ComfyUI, no rembg)
    2. route A : generation only, --no-matte    (ComfyUI, no rembg)
    3. stop ComfyUI                             (frees ~11 GB)
    4. route A : --rematte-only                 (rembg, no ComfyUI)
    5. score all three arms -> A/B/C gallery

This is a genuine finding for the item pipeline beyond this spike: on this
host, generation and matting must be separate passes.

#### Status

Arm B running; phase 2 armed and chained. Nothing published yet — the
completeness gate refuses to score or build a gallery unless every arm produced
its full 10 candidates. REQ-0135b stays in `todo/` until the gallery exists and
the user has given a verdict.

### 2026-07-12 (exclusive run, cont.) — STOP: LayerDiffuse is inert on this ComfyUI

The run was halted mid-flight. LayerDiffuse is not merely misconfigured on this
host — **it does nothing at all**, and no arm of this spike was measuring it.

#### The tell

Arm B (LD, background clause kept) came back essentially solid on every subject:

    blade 99.93%   hilt 100.00%   hilt 100.00%
    dagger 99.91%  dagger 90.28%  wing 100.00%   (route A, same subjects: 11.50%)

The working hypothesis was the background clause (see previous entry), so arm C
stripped it. **Arm C's first result was 99.98% — the hypothesis was wrong.**
That is what sent the investigation into the ComfyUI log, where the real cause
was sitting in plain sight, 7,840 times:

    WARNING: patch type not recognized lora
             diffusion_model.input_blocks.4.1.transformer_blocks.1.attn2.to_q.weight
             (… x7840, i.e. every LD attention weight)

#### Root cause — a second, SILENT ComfyUI API drift

`LayeredDiffusionApply` injects its attention weights as LoRA-style patches:

    lib_layerdiffusion/utils.py :: to_lora_patch_dict()
        patch_flat[model_key] = (patch_type, weight_list)   # patch_type == "lora"
    layered_diffusion.py:272
        work_model.add_patches(layer_lora_patch_dict, weight)

ComfyUI core has since moved LoRA-family patches out into a weight-adapter
subsystem (`comfy/weight_adapter/`: lora, loha, lokr, glora, oft, boft…).
What remains in `comfy/lora.py::calculate_weight()` accepts only `diff`, `set`
and `model_as_lora`; everything else falls through to:

    comfy/lora.py:496
        logging.warning("patch type not recognized {} {}".format(patch_type, key))

So core **warns and skips**. The model is never patched. KSampler runs plain
SDXL, the transparent VAE decoder is then handed an image that has no latent
transparency in it, and it returns an alpha that is ~1 everywhere. No error, no
failed job, a plausible-looking RGBA file — and a number (coverage ~100%) that
is the only thing that gave it away.

This is the second independent breakage against the same ComfyUI build, and the
dangerous one:

| | failure | visibility |
|---|---|---|
| `LayeredDiffusionDecodeRGBA` | AttributeError (v3 schema migration) | **loud** — 10/10 jobs failed |
| `LayeredDiffusionApply` | patch silently dropped (LoRA patch-API rework) | **silent** — jobs "succeed" |

**There is no upstream fix.** `git fetch` shows our checkout (`b4f6a9e`) is
already at upstream HEAD, behind by 0 commits. huchenlei/ComfyUI-layerdiffuse
has not tracked ComfyUI's patch-API rework.

#### What this invalidates

- REQ-0135a's acceptance ("all 8 LayeredDiffusion* nodes present in
  `/object_info`") was never sufficient: node registration says nothing about
  whether the node *does* anything.
- My own smoke test (added specifically to catch that) was **also** not
  sufficient. It asserted "exit 0 and an RGBA file appeared" — both true while
  LD was completely inert. A liveness gate for a model patch must assert on the
  *effect* (e.g. alpha is not ~fully opaque; or the patched model's output
  differs from the unpatched one), not on the artifact's existence.
- Arms B and C measured plain SDXL with a meaningless alpha. Deleted, not
  published — they would have produced a confident, false "LayerDiffuse is
  useless" verdict. Route A (baseline) never completed either (OOM, see below).

#### Kept regardless of the decision

- `tools/gen_item_icons.py --no-matte` (additive, opt-in) and the generate/matte
  split. Route A was OOM-killed at job 2/10 **twice** (10:12:35, 14:34:36, both
  ~12.3 GB RSS) because ComfyUI (~11 GB) and birefnet (~12 GB) cannot be
  co-resident on this 23 GB box. Generation and matting must be separate passes
  on this host — a real item-pipeline finding, independent of LayerDiffuse.
- Harness hardening: liveness/RAM guards, named blockers, completeness gate.
- `spike_defs_nobg.json` + the A/B/C gallery builder, should the technique ever
  become runnable.

#### Blocked — decision required

REQ-0135b cannot proceed on the current stack. Options, none of them free:

1. **Fork + port the node** — translate LD's `("lora", [...])` patches onto
   core's weight-adapter API (or materialise them as `diff` patches). Contained
   and probably the smallest real fix, but it means maintaining a fork of a
   third-party checkout, which PROJECT.md currently forbids ("use them, do not
   modify").
2. **Pin ComfyUI to a pre-rework commit** — rejected on its face: the art
   ComfyUI is shared and HANDS-OFF, and REQ-0127/0136/0138 all run on it.
3. **Drop LayerDiffuse** — record a NO-GO (upstream incompatible), keep rembg
   birefnet-general, and answer the matte-quality pain (hilt 10.99% coverage,
   unit-hair silhouettes) some other way.

Moving `todo/` -> `draft/`: the spec is ratified but is now blocked on a
decision, which is exactly what `draft/` is for.

## Decision — 2026-07-12: NO-GO (option 3, drop LayerDiffuse)

**User directive, 2026-07-12, after an independent re-verification of the whole
LayerDiffuse setup.** Of the three options above, option 3 is taken.

### Re-verification (independent, read-only)

The install itself is *correct* — nothing is misconfigured:

- node `ComfyUI-layerdiffuse` at upstream HEAD `b4f6a9e`, tree clean;
- `diffusers==0.31.0` pin intact and holding under `torch 2.4.1+cu121`;
- LD weights present (`layer_xl_transparent_attn` 743 MB,
  `vae_transparent_decoder` 208 MB);
- all 8 `LayeredDiffusion*` nodes register in `/object_info`.

And it is nevertheless **inert**, confirmed at source on ComfyUI `0.26.0`:

- `layered_diffusion.py:272` calls `add_patches()` with raw `("lora", [...])`
  tuples (built by `lib_layerdiffusion/utils.py :: to_lora_patch_dict()`);
- core `comfy/lora.py::calculate_weight()` accepts only a
  `weight_adapter.WeightAdapterBase` instance or the literal patch types
  `diff` / `set` / `model_as_lora` — the LoRA family was moved out into
  `comfy/weight_adapter/`;
- everything else hits `comfy/lora.py:496` → `patch type not recognized`.
  **7,840 such warnings in the last run — every LD attention weight, dropped.**

So `LayeredDiffusionApply` is a no-op, KSampler runs plain SDXL, and the
transparent decoder returns an alpha that is ~1 everywhere. No error is raised.

### Rationale for NO-GO

1. Upstream (huchenlei/ComfyUI-layerdiffuse) has not tracked ComfyUIs patch-API

## Decision — 2026-07-12: NO-GO (option 3, drop LayerDiffuse)

**User directive, 2026-07-12, after an independent re-verification of the whole
LayerDiffuse setup.** Of the three options above, option 3 is taken.

### Re-verification (independent, read-only)

The install itself is *correct* — nothing is misconfigured:

- node `ComfyUI-layerdiffuse` at upstream HEAD `b4f6a9e`, tree clean;
- `diffusers==0.31.0` pin intact and holding under `torch 2.4.1+cu121`;
- LD weights present (`layer_xl_transparent_attn` 743 MB,
  `vae_transparent_decoder` 208 MB);
- all 8 `LayeredDiffusion*` nodes register in `/object_info`.

And it is nevertheless **inert**, confirmed at source on ComfyUI `0.26.0`:

- `layered_diffusion.py:272` calls `add_patches()` with raw `("lora", [...])`
  tuples (built by `lib_layerdiffusion/utils.py :: to_lora_patch_dict()`);
- core `comfy/lora.py::calculate_weight()` accepts only a
  `weight_adapter.WeightAdapterBase` instance or the literal patch types
  `diff` / `set` / `model_as_lora` — the LoRA family was moved out into
  `comfy/weight_adapter/`;
- everything else hits `comfy/lora.py:496` -> `patch type not recognized`.
  **7,840 such warnings in the last run — every LD attention weight, dropped.**

So `LayeredDiffusionApply` is a no-op, KSampler runs plain SDXL, and the
transparent decoder returns an alpha that is ~1 everywhere. No error is raised.

### Rationale for NO-GO

1. Upstream (huchenlei/ComfyUI-layerdiffuse) has not tracked ComfyUI's patch-API
   rework and our checkout is already at its HEAD. There is no fix to pull.
2. Option 1 (fork + port the patches onto the weight-adapter API) is
   mechanically small but creates a **permanent fork-maintenance liability
   against a moving core, on shared HANDS-OFF art infrastructure**. Not worth it
   for a technique we have never measured a win from.
3. Option 2 (pin ComfyUI to a pre-rework commit) was rejected on its face:
   REQ-0127 / 0136 / 0138 and the user's own art sessions run on that ComfyUI.

**Production matting stays on rembg `birefnet-general` + edge-key fallback.**

### What survives this REQ (merged, independent of LayerDiffuse)

- `tools/gen_item_icons.py --no-matte` (additive, opt-in, default off) and the
  **generate-then-matte split**. Real item-pipeline finding: ComfyUI (~11 GB RSS
  with SDXL resident) and birefnet (~12 GB) cannot be co-resident on this 23 GB
  host — route A was OOM-killed at job 2/10 **twice** (10:12:35, 14:34:36). On
  this box the two passes must be sequential, never concurrent.
- The methodological lesson, which is the expensive one: **node registration is
  not liveness, and neither is "exit 0 + an artifact appeared".** A liveness gate
  for a model patch must assert on the *effect* (alpha is not ~fully opaque; or
  the patched model's output differs from the unpatched one). Both weaker gates
  passed here while LD did nothing, and nearly published a confident, false
  "LayerDiffuse is useless" verdict.
- The evidence base for **REQ-0139** (comfyui-service-provenance): three ComfyUI
  OOM kills, a false "seq5 DONE" (its REQ-0136 legs no-opped in 9 s against a
  dead ComfyUI), a killed route A, and sshd down ~10 min — all in one day, all
  from multiple agent sessions sharing one un-owned ComfyUI.
- `spike_defs_nobg.json` + the A/B/C gallery builder, kept should the technique
  ever become runnable.

### The original pain is NOT closed by this NO-GO

The matte-quality pain that motivated REQ-0135 is untouched: `hilt` coverage
10.99% (item pipeline), unit-hair / thin-silhouette failures (unit S4). Note that
every spike prompt carries `plain uniform near-white background` /
`clean flat backdrop` — **the worst possible condition for separating pale
metallic blades and light hair with birefnet.** Arm C was built to test exactly
that suspicion and never produced valid data, because LD was inert throughout.

That experiment does not need LayerDiffuse at all: route A (rembg) alone, with
the background clause varied (near-white / mid-grey / chroma). It is cheap, it
is GPU-light, and it may show the pain is partly self-inflicted by our own
prompt. Filed as a separate REQ — see the matte-background-clause A/B sibling.

### Residue (deliberately left in place)

- ComfyUI `~/ComfyUI/models/layer_model/` (908 MB) and the
  `ComfyUI-layerdiffuse` custom node are **left installed**. They are inert and
  harmless; ComfyUI is HANDS-OFF and their removal needs a separate go-ahead.
- The `diffusers==0.31.0` pin **stays, and should stay.** It is not LD residue:
  per REQ-0135a, diffusers 0.39.0 fails to import at all under this venv's
  `torch 2.4.1+cu121`. The only other consumer of diffusers in this ComfyUI is
  `ComfyUI-Frame-Interpolation`'s momo VFI model, which was therefore broken
  before the pin and is not broken now. Reverting the pin would be a regression.
- The orphaned ComfyUI process this REQ started (PID 1768504, 12.3 GB RSS, idle)
  was **stopped 2026-07-12 with user go-ahead** — 8.9 GB -> 20.8 GB available.
  Manual-start policy is restored until REQ-0139.

### Status

`draft/` -> `done/`. The deliverable of an evaluation REQ is its verdict, not
code; the verdict (NO-GO) is recorded here and accepted by the user, and the one
piece of production code it produced (`--no-matte`) is merged. Terminal.
