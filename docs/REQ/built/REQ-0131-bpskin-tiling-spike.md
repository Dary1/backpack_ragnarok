# REQ-0131 — bpskin-tiling-spike

**Status:** todo (mandated by the ratified Backpack Skin pipeline v1.0, step
S2: "Highest-risk step; run a spike/bakeoff first")
**Reserved:** 2026-07-11
**Slug:** bpskin-tiling-spike
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` v1.0 (golden
ratified "all green", 2026-07-12)

## Goal

Prove or deny the AI-raster route for Backpack Skin assets BEFORE any real
skin batch: (a) seamless/tileable `fill_texture` generation, (b) motif-sheet
→ edge-tile cutting (straight / outer corner / inner corner), (c) `clip_mask`
derivation by contour auto-trace. Deliver findings, not shipping assets.

## Scope

- Try tiling-specific ComfyUI workflows (seamless/tiling nodes) on the
  existing GPU route (JuggernautXL V9); 2 contrasting motifs (e.g. elven /
  barbarian) as test subjects.
- Prototype the S3 harness minimally: composite fill + tiles + masks on the
  validation shape suite (must include inner corner + one holed shape) over
  contrasting canvas backgrounds; screenshot grid.
- Evaluate BS-G5 rotation exception in practice (ratified as proposed:
  90° rotation allowed for edge tiles only).
- Output: a findings section appended to this file + a recommended workflow
  (or a documented failure with the fallback recommendation: hand-authored
  tiles or procedural edges) folded back into the pipeline doc.

## Explicit non-goals

No registry entries, no `content/live/` writes, no client integration
(REQ-0126 owns the system; this spike may run before or in parallel).

## Gates

- Sample tiles pass the prototype harness (zero seams, zero clip leakage) OR
  the failure is documented with concrete alternatives.
- Findings reviewed by the user before the first real skin batch is briefed.

---

## RE-SCOPE (2026-07-12) — delivered by REQ-0138; hold lifted by the user

### What changed

Scope item (a), "seamless/tileable `fill_texture` generation", is **DONE — do
not re-litigate it.** REQ-0138 validated a circular-padding ComfyUI recipe and
measured it: seam ratio **0.83–1.09** (seamless) vs **2.76–3.77** (control)
across 2 motifs × 2 seeds, zero overlap. Full recipe, metric definition, and
node graph: `docs/REQ/*/REQ-0138-bpskin-fill-tiling-recipe.md`.

Short form, so this file stands alone:

- `spinagon/ComfyUI-seamless-tiling`.
- `SeamlessTile` (`tiling: enable`, `copy_model: "Make a copy"`) between the
  checkpoint loader and the KSampler.
- `CircularVAEDecode` (`tiling: enable`) in place of `VAEDecode`.
- Both patches, or the seam survives. Sampler config otherwise unchanged
  (1024², 30 steps, cfg 6.5, dpmpp_2m/karras).
- Prompt must still enforce allover-pattern framing (no focal object, no
  vignette/gradient) — circular padding makes a tile *joinable*, not
  *tileable-looking*.
- Recipe is architectural, so it carries to any SDXL checkpoint REQ-0136
  ratifies. Re-run the offset check once on that checkpoint before the first
  real skin batch. NOT valid for FLUX-family.

### Where REQ-0131's budget now goes

The spike's real risk was never the fill. It is everything downstream of it:

1. **Motif-sheet → edge-tile cutting** (straight / outer corner / inner
   corner). Unlike the fill, this has no known one-node answer: the sheet is
   generated art, the cut points are not marked in it, and the three tile
   classes must agree at their shared boundaries or the border visibly breaks
   at every polyomino corner.
2. **`clip_mask` derivation by contour auto-trace**, and its integrity — a
   leaking mask is worse than a seam because it paints outside the cell.
3. **BS-G5 rotation exception** in practice (90° rotation for edge tiles only):
   whether a single straight tile can serve all four sides once the motif has a
   direction (studs, stitching, filigree run).
4. **S3 harness** on the validation shape suite — must include an inner corner
   and one holed shape, over contrasting canvas backgrounds.

Gate (a) of this REQ is satisfied by REQ-0138's offset check. The remaining
gates — zero clip leakage on the harness, and user review of the findings —
stand unchanged.

### Status note

Excluded from the 2026-07-12 unattended recovery run (`~/scratch/req_seq6.sh`)
under a user hold. Hold **lifted by the user on 2026-07-12**; the checkpoint
choice remains gated on the REQ-0136 verdict, so the spike builds its harness
and cutting/tracing work on the incumbent V9 and re-runs the one offset check
on the ratified checkpoint afterwards.
## Findings (2026-07-12) — spike RUN. Fill: solved. Edge tiles: **FAILED, and the failure is instructive.**

### Summary

| scope item | outcome |
|---|---|
| (a) seamless `fill_texture` | **SOLVED** — delivered by REQ-0138 (circular padding; seam ratio 0.83–1.09 vs 2.76–3.77 control) |
| (b) motif-sheet → edge-tile cutting | **FAILED** — the frame-sheet route does not produce tileable edges. See below. |
| (c) `clip_mask` by contour auto-trace | **BLOCKED by (b)** — the trace is only as good as the tile, and the tiles are wrong |
| BS-G5 rotation exception (90° for edge tiles) | **not yet testable** — needs a valid straight tile first |

Harness reported `composites=42, leaking=0`. **That number is worthless and must
not be quoted as a pass.** Zero fill pixels leaked outside the silhouette
because there was almost no fill drawn *anywhere* — the clip masks were huge
irregular blobs and the edge art covered the cells. A leakage metric cannot
distinguish "masked correctly" from "nothing rendered". Caught by looking at the
composites, not by reading the JSON.

### The actual failure

`cmd_gen` asks the model for a "frame sheet": an ornate square frame with a
uniform border band on all four edges. `cmd_cut` then assumes that band exists
and cuts:

- `straight` = centre crop of the top band
- `outer corner` = top-left crop
- `inner corner` = procedural miter of two straights

**A diffusion model does not paint a uniform border band. It paints a decorative
arch / vignette.** The elven sheet's "top band" is a sweeping curved arc whose
thickness and content vary enormously along its length. So:

1. The cut "straight" tile **is an arch, not a straight run**. Repeat it along an
   edge and you get a scalloped, discontinuous ribbon — the one property a
   straight edge tile must have (periodicity along its run) is exactly the
   property a frame sheet cannot supply.
2. `band_thickness()` reported **463 px of 1024** as the "median per-column
   thickness" — i.e. 45 % of the sheet. That is not a band measurement failing;
   that is a band measurement applied to something that is not a band. The
   subsequent rescale (463 px → 64 px at cell scale) then crushed the art.
3. `clip_from_art()` flood-fills the non-art region from the tile interior. With
   an arch instead of a band, that region is a large irregular blob (41.8 % of
   the straight tile), so the "clip mask" clips almost the whole cell — which is
   why the composites came out as edge art over bare background.

This is a real spike result, and it is the outcome REQ-0131 explicitly allowed
for: *"or a documented failure with the fallback recommendation"*.

### Recommendation — generate the edge, do not cut it out of a frame

The fix follows directly from REQ-0138, and it is cheap. A straight edge tile
needs to be **periodic along one axis**. That is exactly what circular padding
gives, and REQ-0138 already proved circular padding works on this GPU route:

- Generate the straight edge as a **1-D seamless strip**: a wide, short canvas
  (e.g. 1024 × 256) with the *same* `SeamlessTile` + `CircularVAEDecode` recipe,
  prompted for a continuous ornamental border running left-to-right. It then
  tiles along its run **by construction**, exactly as `fill_texture` tiles in
  two dimensions. Cut a cell-width piece; every piece joins.
- Corners are the genuinely hard part and should be **authored or derived**, not
  cut from a sheet. A frame sheet has no concave corner to cut at all — the
  current tool already concedes this by mitering the inner corner procedurally.
  Derive both corner classes from the ratified straight tile so they share its
  motif by construction.
- Only then is `clip_mask` auto-trace worth testing, and only then is BS-G5
  (90° rotation of edge tiles) a meaningful question.

The harness itself is sound and reusable — it composites the full stack over the
validation shape suite (inner corner + holed shape included) on three
backgrounds. Its leakage metric needs a companion **coverage** metric ("did the
fill actually render inside the silhouette?") so that "nothing drawn" can never
again be reported as "no leakage".

**Measured (2026-07-13 review — re-verification of the artifacts).** The
degeneracy is worse than the prose above admits. Of the six generated
`clip_mask`s, **four are uniformly black** — one grey level, 0.0 % of pixels
passing:

| clip_mask | pass % | grey levels |
|---|---|---|
| barbarian_straight | 0.0 | 1 |
| barbarian_outer | 0.0 | 1 |
| barbarian_inner | 0.0 | 1 |
| elven_inner | 0.0 | 1 |
| elven_outer | 22.5 | 2 |
| elven_straight | 41.8 | 2 |

An all-black clip mask admits **no fill pixel anywhere**, so the barbarian motif
rendered zero `fill_texture` on every shape over every background. The two
non-degenerate masks are pure binary blobs (2 levels). Against masks that pass
~0 % of their area, `leaking: 0 / 42` is not a weak pass — it is a tautology, in
the strict sense that no configuration of the fill could have produced any other
number. `results.json` carries exactly one field per composite (`leak_px`) and no
coverage field, so the harness was structurally incapable of noticing.

The coverage metric is therefore not a refinement: **until it exists, a green
harness run carries no information at all**, and no skin — hand-authored or UGC —
may be gated on this harness. Pipeline doc §6 requires every S3 gate to be a
machine gate (UGC keeps no human in the loop), which makes this the blocking
defect for REQ-0126's harness, not merely a footnote to this spike.

### Status

- Fill route: green, via REQ-0138.
- Edge-tile route: **red**. The frame-sheet approach is abandoned; the
  strip-generation approach above is the recommendation.
- Gate "sample tiles pass the harness (zero seams, zero clip leakage) OR the
  failure is documented with concrete alternatives" → **met by the second
  branch.**
- Gate "findings reviewed by the user before the first real skin batch is
  briefed" → **MET 2026-07-13** — the user reviewed these findings, including
  the struck flux2 claim and the measured mask degeneracy above, and cleared the
  merge to master. No skin batch may be briefed on the frame-sheet route.

### Checkpoint note (CORRECTED 2026-07-13)

This spike ran on JuggernautXL V9, the incumbent.

**Correction, and a correction OF the correction (2026-07-13).**

An earlier revision claimed "REQ-0136 has since ratified **flux2**" and sent the
strip re-run to flux2. A later revision struck that as false, asserting REQ-0136
was still in `todo/` with no bakeoff run and no winner ratified. **That second
assertion was itself wrong**, and is what stands corrected here:

- REQ-0136's bakeoff **was** run (48 candidates, `content/batches/bakeoff-0136/`,
  gallery `web/preview/bakeoff-0136/`) and the user **did** ratify **flux2** on
  2026-07-12, reconfirmed 2026-07-13. REQ-0136 is in `built/`.
- It looked unratified from master only because REQ-0136's branch was not yet
  merged. **Lesson: a REQ's folder tells you its status on YOUR branch, not in
  the program.** Before declaring that work never happened, check the other
  branches — `git log --all`, `git branch --contains` — not just `ls docs/REQ/*/`.

What the struck revision got RIGHT, and what still holds: **sending the strip
re-run to flux2 would have been wrong anyway.** This same file records that the
circular-padding recipe is **NOT valid for FLUX-family** checkpoints, so pointing
the follow-up at flux2 would have aimed it at a checkpoint on which its own
recipe is documented not to work. The right reason, not the wrong one, keeps the
strip on SDXL.

What actually holds:

- The frame-sheet failure is a **geometry** failure, not a checkpoint failure —
  a prettier frame is still not a tileable band. The recommendation (generate a
  1-D seamless strip; do not cut edges out of a frame) stands regardless of
  checkpoint.
- **The strip re-run must use an SDXL-family checkpoint** (JuggernautXL V9) —
  because circular padding is SDXL-UNet-specific, NOT because flux2 is unratified
  (it is ratified, for icons). Icons and skins may therefore have to run on
  different checkpoints; that divergence is an open user decision, and the strip
  re-run must not be taken as having settled it. The strip
  route depends on `SeamlessTile` + `CircularVAEDecode`, and REQ-0138 validated
  those on SDXL only.

**Cross-risk, previously unrecorded — READ BEFORE RUNNING REQ-0136.** Both
patches are SDXL UNet-specific. If REQ-0136 ratifies flux2 (or any FLUX-family
checkpoint) as the default, it does not merely block the strip route — it also
**invalidates REQ-0138's `fill_texture` recipe, which is currently the only
green result in the entire skin pipeline.** The whole circular-padding route,
fill and edge alike, would need re-validation on FLUX before any skin batch.
REQ-0136's checkpoint verdict is therefore not icon-local: it is a load-bearing
dependency of the Backpack Skin pipeline, and its bakeoff should weigh
seamless-tiling support, not painterly quality alone.

Artifacts: `content/batches/bpskin-spike-0131/` (sheets/, tiles/, harness/,
cut_report.json, harness/results.json).
