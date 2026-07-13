# REQ-0153 — po-shape-control-spike: shape-conditioned generation for PO items on Flux.2 Klein 4B

**State:** draft. The user approved the direction in chat (2026-07-13, "ナイス調査です。REQ-0153として起票お願いします")
after reviewing the orchestrator's investigation; blocked only on ratification of this written
spec (arms, metrics, GREEN criteria). A SPIKE: its deliverable is a verdict + recipe, not
production wiring.

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

## Open questions
- Q1 scaffold tone: mid-gray vs dark-gray vs colored blob (mid-gray proposed; sweep only if A
  underperforms).
- Q2 whether the distilled-4B GGUF we run responds to edit conditioning as well as the base
  variant; if A fails oddly, one diagnostic leg with the fp8 base checkpoint is allowed as
  EVIDENCE ONLY (explicitly not a route change — the route stays Klein 4B as loaded).
- Q3 seed policy for the matrix: fixed {1,2,3,4} proposed.

## Implementation log
(to be filled by the implementing session)
