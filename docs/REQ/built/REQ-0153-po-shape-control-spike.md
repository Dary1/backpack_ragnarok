# REQ-0153 — po-shape-control-spike: shape-conditioned generation for PO items on Flux.2 Klein 4B

**Ratified:** 2026-07-13 (user, chat) — direction approved on the investigation
("ナイス調査です"), and the written spec (arms, metrics, GREEN criteria, Q1–Q3 defaults)
approved as proposed the same day. A SPIKE: its deliverable is a verdict + recipe, not
production wiring. The REQ folder is the sole status record.

**Problem (user, 2026-07-13):** PO items with non-rectangular cell shapes (L-shapes etc.) rarely
come out of unconditioned t2i in a silhouette that fits their cells; rerolling seeds until the
shape happens to match is futile. Post-hoc auto-fit (Move/Rotate/Scale + numeric fit scoring)
exists, but controlling the OUTPUT SHAPE up front is far stronger. Constraint: the model stays
**Flux.2 Klein 4B** (the loaded route; model swaps are too heavy). All prior prohibitions were
explicitly lifted for this investigation — think zero-based.

## Background (investigated 2026-07-13, orchestrator-direct)
- The old pipeline's shape control (REQ-0073, commit 8876225) was `ConditioningSetMask` soft
  regional bias: a grayscale mask PNG (mask_cells=1.0, elsewhere ~0.15) → LoadImage →
  ImageToMask → ConditioningSetMask on the positive prompt only. That mechanism rides SDXL
  cross-attention; it does not port to Flux.2's DiT joint attention. NOT an arm of this spike.
- The "server crashes" of that era were RAM OOM kills (ComfyUI ~11 GB + birefnet ~12 GB
  co-resident on the 23 GB box; 8 kills across REQ-0135b/0136/0127), orthogonal to shape
  control and already mitigated by --no-matte → --rematte-only sequencing. No arm below adds a
  resident model.
- **Key finding:** Flux.2 Klein unifies t2i and IMAGE EDITING in one architecture — the very
  weights we run accept reference images natively. The server's ComfyUI (core checkout
  2026-06-29) has the receiving nodes: `ReferenceLatent` (comfy_extras/nodes_edit_model.py),
  `FluxKontextMultiReferenceLatentMethod`, `DifferentialDiffusion`, `SetLatentNoiseMask`,
  `LatentCompositeMasked`. Official ComfyUI 4B image-edit templates exist
  (image_flux2_klein_image_edit_4b_{base,distilled}.json).
- ControlNet is REJECTED: the only FLUX.2 union ControlNet (alibaba-pai Fun-Controlnet-Union)
  targets FLUX.2-dev (32B), not Klein 4B; and the RTX 2080 (8 GB VRAM) has no headroom for a
  resident adapter. ConditioningSetMask port is REJECTED per above.
  Refs: docs.comfy.org/tutorials/flux/flux-2-klein; blog.comfy.org flux2-klein post;
  huggingface.co/alibaba-pai/FLUX.2-dev-Fun-Controlnet-Union.

## Goal
Prove (or kill) up-front shape conditioning for PO polyomino silhouettes on the fixed route,
and if GREEN, hand a production-ready recipe to the admin flow (REQ-0151 PO editor's 5x5 mask
is exactly the input the scaffold builder needs).

## Shared scaffolding
- `tools/spikes/req0153_shape_scaffold.py`: from a PO 5x5 cell mask, render (a) a scaffold
  image — mid-gray flat silhouette on white at gen resolution (aspect + /16 snap per the
  ratified sizing law), (b) a hard mask variant, dilated by D px (sweep D ∈ {0, 8, 16}), for
  Arm C. Cell→px geometry resurrected from 8876225 `build_cell_mask_image` (git history; the
  file is deleted on the flux2 line).
- All arms run through `art_route`/`art_style` AS MODULES (spike-local graph extensions live in
  the spike script; the production route is not modified by this REQ).
- Test set: 4 shapes × 3 subjects × 4 seeds per arm. Shapes: L-tromino, T-tetromino, 1x3
  vertical, 2x2 square (control). Subjects chosen from ratified item vocabulary apt to each
  shape (e.g. axe/hooked blade for L, hammer for T, spear for 1x3, shield for 2x2).
  Prompts follow the ratified PO shape: "{subject}, white background, bold outline" + Anime
  template, with the Arm-A edit-instruction extension where applicable.

## Arms
- **Arm 0 (baseline):** current unconditioned t2i route, same subjects/shapes/seeds. The bar
  the other arms must beat.
- **Arm A (primary): ReferenceLatent shape reference.** scaffold → VAEEncode → ReferenceLatent
  chained into positive conditioning; prompt as edit instruction: "Turn the gray shape into
  {subject}. Keep the silhouette exactly. white background, bold outline" (+ Anime template).
  Latent from EmptyFlux2LatentImage (pure generation, shape given only as reference).
  - A2 (optional, only if A is promising): second ReferenceLatent with an adopted icon as
    style exemplar; compare style drift with/without `FluxKontextMultiReferenceLatentMethod`.
- **Arm B: scaffold img2img init.** scaffold → VAEEncode → sampler latent_image, denoise sweep
  {0.65, 0.75, 0.85}. No reference conditioning. Cheapest possible mechanism.
- **Arm C: A + hard latent mask.** Arm A conditioning + SetLatentNoiseMask over the dilated
  shape region on a white-canvas latent (variant C2: DifferentialDiffusion for a soft-gradient
  mask). Guarantees nothing renders outside the cells; measures whether hard masking hurts
  composition vs A alone.

## Metrics (per render; machine-scored, human-eyeballed)
Fit: run the raster fit/packing scorer (`tool_icon_score` machinery — the future
`po.cell_packing` kit of REQ-0152) on the matted alpha: identity-fit feasibility (does the
silhouette fit the cells with NO transform), best-fit score, per-cell `cell_content_coverage`,
`overflow_px` at identity. Hygiene: white-background purity outside the shape
(`image_alpha_coverage` outside cells ≈ 0), scaffold ghosting (flat mid-gray residue — luma
histogram check + eyeball). Ops: wall time per image, VRAM peak (reference tokens grow the
sequence — verify the 8 GB card holds at 256-512px gen sizes), no OOM, no co-resident matting
(reuse the --no-matte sequencing).

## GREEN criteria (proposed; user may tighten at ratification)
An arm is GREEN when, over the 48-render matrix: ≥70% of renders are identity-fit feasible with
zero deep_overflow (vs Arm 0 baseline, historically near-zero on L/T shapes), median best-fit
score beats Arm 0 by a margin visible in the gallery, and no scaffold ghosting above eyeball
threshold. Verdict may be GREEN-with-recipe (e.g. "A at D=8 dilation"), AMBER (works for some
shape classes), or RED (kill; keep post-hoc fit only).

## Deliverables
- `tools/spikes/req0153_*` scripts + `findings.json` (established spike format: legs, summary,
  per-arm tables, verdict) + a gallery page for the S7 eyeball (same conventions as prior
  spikes; NOT under content/live).
- On GREEN: a written production recipe (graph deltas for `art_route.build_txt2img` — optional
  reference/mask inputs — plus the PO edit-instruction prompt extension for `art_style`), left
  as a spec addendum for a follow-up integration REQ. This spike does NOT modify the
  production route or the admin.
- REQ file records the verdict either way (a RED verdict is a valid, terminal outcome).

## Dependencies / coordination
- Runs after REQ-0150 merges (route modules stable on master). If run earlier, import the
  modules from the 0150 branch read-only and note the hashes; do not fork.
- GPU etiquette: coordinate with the user's own art sessions; serialize; no retry storms.
- Batches/artifacts: spike renders stay in `content/batches/req0153-*/` per convention, but
  keep the committed set SMALL (the winning/illustrative renders + findings, not all 48+ PNGs —
  lesson: 185 MB REQ-0150 history bloat; the full matrix can live in the gitignored data/ or be
  regenerated from recipes).

## Out of scope
- Production wiring (follow-up REQ on GREEN; REQ-0151 admin gains a shape-conditioning toggle
  there, driven by the same 5x5 mask).
- ControlNet, ConditioningSetMask port, model swaps, LoRA training, 9B models.
- Monster grid shapes (monsters are loose canvases; revisit only if PO results are GREEN and
  monsters prove to need it).

## Resolved questions (user rulings, 2026-07-13 — approved as proposed)
- Q1 scaffold tone: mid-gray; sweep only if Arm A underperforms.
- Q2 one diagnostic leg with the fp8 base checkpoint allowed as EVIDENCE ONLY (not a route
  change — the route stays Klein 4B as loaded).
- Q3 seed policy: fixed {1,2,3,4}.
- GREEN criteria: as proposed (identity-fit ≥70%, zero deep_overflow, no ghosting).

## Implementation log

**Implemented 2026-07-14** (user cleared the GPU that day). Branch
`req-0153-po-shape-control-spike`. The production route (`tools/art_route.py`,
`tools/art_style.py`) was NOT modified: every arm imports them AS MODULES and adds
its extra graph nodes only inside the spike script.

### Scripts (`tools/spikes/`)
- `req0153_shape_scaffold.py` — PO cell mask (`[[row,col],…]`, the REQ-0151 editor's
  5×5-mask convention) → (a) mid-gray flat silhouette scaffold on white at gen
  resolution, (b) hard mask dilated by D∈{0,8,16}, (c) white canvas, (d) soft feathered
  mask. Cell→px geometry resurrected from commit 8876225 `build_cell_mask_image`; the
  sizing law (aspect + /16 snap, 256 px/cell) is `art_style.gen_size()`, imported.
- `req0153_spike.py` — Arm 0/A/B/C driver. Spike-local graphs reuse `ROUTE.FLUX`/
  `ROUTE.STEPS`/…: Arm 0 = `ROUTE.build_txt2img` verbatim; Arm A = scaffold → VAEEncode
  → ReferenceLatent into the positive, EmptyFlux2LatentImage latent; Arm B = scaffold
  img2img init via SplitSigmasDenoise; Arm C = A + SetLatentNoiseMask over the dilated
  shape on a white-canvas latent (C2 = DifferentialDiffusion + soft mask). gen and matte
  phases; a VRAM sampler thread; batch-by-prompt ordering; single attempt per job (no
  retry storms).
- `req0153_score.py` — identity-fit (resize matted alpha to the cell grid; overflow &
  deep-overflow per `tool_fit_check`), best-fit via `tool_icon_score.score_candidate`
  (the fit machinery, imported not forked), white-bg purity, and a shape-footprint
  scaffold-ghost metric. Writes `findings.json` + montage contact-sheets + `gallery.html`
  + verdict.

### Feasibility — the 8 GB question (RESOLVED)
Arm A/C add the scaffold's latent tokens to the FLUX.2 DiT sequence. On the RTX 2080
(8 GB) at the FULL 256/cell gen sizes (L 512², T 768×512, 1×3 256×768, sq 512²) VRAM
peaked at **6.7–6.8 GB with NO OOM** across every arm — the reference-latent mechanism
FITS. Throughput, however, is poor: reference-latent jobs cost **~76–130 s each** (the
8 GB card swaps unet↔vae↔encoder per job) vs ~15–50 s for plain t2i; a full
4×3×4×arms matrix is ~3 h on this box. That is an ops cost to budget for in the
integration REQ, not a blocker.

### Matrix actually scored (46 renders)
Arms 0 (baseline t2i), A (ReferenceLatent), B (img2img, denoise 0.75 & 0.85), C
(A + SetLatentNoiseMask, D=8). Coverage: **L-tromino (`battle axe`) complete across all
four arms at 4 seeds** (20 renders); **T-tetromino (`war hammer`)** 0/A/C; **1×3 vertical
(`spear`)** and **2×2 square (`round shield`)** across 0/A/B/C at 2 seeds. Seeds {1,2,3,4}
(fixed, Q3). Full matrix in the gitignored `data/req0153/`; only the small montages +
`findings.json` are committed.

### Results (machine + S7 eyeball)

| arm | n | identity-fit feasible | median best-fit | white-bg purity | ghost (shape gray128) |
| --- | --- | --- | --- | --- | --- |
| 0 (baseline) | 14 | **28.6 %** | 57.79 | 1.000 | 0.004 |
| A (ReferenceLatent) | 10 | 60.0 % | 60.13 | 1.000 | 0.013 |
| B (img2img @0.75) | 8 | 62.5 %* | 58.45 | 0.989 | 0.004 |
| B (img2img @0.85) | 4 | 25.0 % | 56.06 | 1.000 | 0.008 |
| **C (A + latent mask @D=8)** | 10 | **100.0 %** | **61.43** | 1.000 | 0.007 |

- **Arm 0 (baseline): no up-front shape control.** Fails on the AWKWARD shapes — `battle
  axe` overflows the L quadrant (deep-overflow); `war hammer` renders a full anime warrior
  or a garbled "WARMMER" game-**logo** banner. It PASSES on 1×3 and 2×2, but only because
  the ratified aspect-sizing law already gives the subject a natural fit there (a vertical
  spear fills a tall 1×3; a shield fills a square). 28.6 % overall.
- **Arm A (ReferenceLatent) — the mechanism WORKS.** The scaffold latent pulls the render
  onto the cell footprint: blocky shapes (T, square) lock hard to the silhouette; elongated
  shapes (L) follow more loosely and can still spill past the footprint. Beats baseline on
  both feasibility (60 %) and fit (60.13), but MISSES the 70 % identity-fit gate — the
  elongated overflow is what keeps it under 70 %.
- **Arm B (img2img): REJECTED.** At denoise 0.75 the render is essentially the flat gray
  scaffold with an outline (ghosting on L) or the shape distorted (the vertical spear came
  out horizontal); at 0.85 it loses the shape (25 % feasible, below baseline). NOTE: B@0.75's
  62.5 % "feasibility" is an ARTIFACT — a ghost reproduces the scaffold silhouette, so it
  trivially "fits" the cells while containing no real subject; the machine ghost metric
  under-flagged it (the denoised gray drifts out of the tight 118–138 band and birefnet
  re-mattes it cleanly), so the S7 EYEBALL (gallery) is the authoritative reject here.
- **Arm C (A + hard latent mask @D=8) — the WINNER.** Arm A's silhouette conditioning PLUS
  a SetLatentNoiseMask over the dilated shape on a white-canvas latent: nothing renders
  outside the cells, so **100 % identity-fit feasible, zero deep-overflow**, the best median
  best-fit (61.43), and pure-white backgrounds. It is the only arm that clears every GREEN
  gate.

### Verdict: GREEN-with-recipe — **Arm C at D=8 (ReferenceLatent + SetLatentNoiseMask)**
Over the scored matrix Arm C hits 100 % identity-fit feasible with zero deep-overflow (vs
28.6 % baseline), a median best-fit that beats Arm 0 by a gallery-visible margin, and no
scaffold ghosting above the eyeball threshold — all three ratified GREEN criteria. Arm A
is the underlying mechanism and is close (60 %, beats baseline on both axes) but the hard
latent mask is what guarantees containment on elongated shapes and clears the 70 % gate.
Arm B is killed; the post-hoc auto-fit path is unaffected.

### For the S7 eyeball
- **Subject-fidelity vs silhouette-lock trade-off (the main aesthetic call):** the harder
  the shape lock, the more subject legibility is spent. The T `war hammer` under A/C reads
  as an abstract cracked-metal T, not a recognisable hammer; the square `round shield`
  becomes a full round disc (great fill, but it drops the heater-shield character). On
  shapes where the subject's natural aspect already matches the cells (1×3, 2×2) the
  baseline is fine and shape-conditioning mostly buys extra cell coverage, not a rescue.
- **Where shape control actually earns its cost:** the awkward, non-rectangular shapes
  (L-tromino, T-tetromino) where the baseline free-composes and misses.
- Gallery: `content/batches/req0153-shape-control/gallery.html` (montage contact-sheets;
  green border = identity-fit feasible, tile caption = best-fit / deep-overflow px).

---

## Spec addendum — production recipe (for a follow-up integration REQ)

GREEN mechanism: **Arm C = ReferenceLatent (scaffold) + SetLatentNoiseMask (dilated shape
on a white-canvas latent), D=8 dilation.** Arm A (ReferenceLatent alone) is the fallback if
a hard mask is undesirable, at the cost of ~60 % vs 100 % containment. This spike does NOT
wire it; the deltas below are the hand-off.

### `art_route.build_txt2img` — OPTIONAL new inputs (production route stays byte-identical when unused)
Add keyword args, all defaulting to `None` so existing callers are untouched:
`reference_image=None`, `shape_mask_image=None`, `mask_init_image=None`.

- When `reference_image` is set (Arm A): insert
  `LoadImage(reference_image) → VAEEncode(vae) → ReferenceLatent(conditioning=positive)`
  and feed the ReferenceLatent output as the CFGGuider positive. The negative stays the
  `ConditioningZeroOut` of the base text conditioning; `latent_image` stays
  `EmptyFlux2LatentImage`.
- When `shape_mask_image` + `mask_init_image` are ALSO set (Arm C): replace the
  `EmptyFlux2LatentImage` latent with
  `VAEEncode(mask_init_image=white canvas) → SetLatentNoiseMask(mask = LoadImage(shape_mask_image) → ImageToMask(channel=red))`.

Node shape (Arm C), all other route nodes unchanged:
```
10 LoadImage(reference_image=scaffold)      12 ReferenceLatent(cond=[4,0], latent=[11,0])  → positive
11 VAEEncode([10,0],[3,0])                   17 LoadImage(mask_init_image=white)
20 LoadImage(shape_mask_image=mask_dilated)  18 VAEEncode([17,0],[3,0])
21 ImageToMask([20,0], red)                  22 SetLatentNoiseMask([18,0],[21,0])  → latent_image
13 CFGGuider(model=[1,0], positive=[12,0], negative=[5,0], cfg)
```
VRAM verified 6.7–6.8 GB peak at 256/cell on the 8 GB card (no OOM). Reference-latent jobs
are ~2–3× slower than plain t2i — budget generation time accordingly.

### `art_style` — edit-instruction prompt extension
```
def edit_instruction(subject):
    # Anime template applied to a shape-edit instruction (REQ-0153).
    return render("anime",
        "Turn the gray shape into %s. Keep the silhouette exactly. "
        "white background, bold outline" % subject)
```

### Scaffold builder → production module
`tools/spikes/req0153_shape_scaffold.py` (cell mask → mid-gray silhouette + dilated hard
mask at gen resolution) becomes the production scaffold generator, driven directly by the
REQ-0151 PO editor's 5×5 mask. Recommended default: D=8 dilation.

### Recommended default & guard
Use **Arm C @ D=8** when a shape MUST be respected (non-rectangular PO shapes). For shapes
whose subject already fits under the aspect-sizing law (single-column / square footprints
with an aptly-oriented subject) shape-conditioning is optional. Because the hard lock costs
subject legibility on blocky shapes, expose it as a per-item toggle in the REQ-0151 admin
(as already scoped) rather than forcing it globally, and keep the post-hoc numeric fit as
the final gate.

## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed.
- **Disposition**: STAYS in built/ -- spike (GREEN-with-recipe); S7 eyeball close pending. Docs/evidence deliverable; no web deploy.
