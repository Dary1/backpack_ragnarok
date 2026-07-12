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
