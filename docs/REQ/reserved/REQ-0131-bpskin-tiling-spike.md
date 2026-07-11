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
