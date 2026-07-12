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

### Status

- Fill route: green, via REQ-0138.
- Edge-tile route: **red**. The frame-sheet approach is abandoned; the
  strip-generation approach above is the recommendation.
- Gate "sample tiles pass the harness (zero seams, zero clip leakage) OR the
  failure is documented with concrete alternatives" → **met by the second
  branch.**
- Gate "findings reviewed by the user before the first real skin batch is
  briefed" → **OPEN.** No skin batch may be briefed on the frame-sheet route.

Checkpoint note: this spike ran on JuggernautXL V9, the incumbent at the time.
REQ-0136 has since ratified **flux2**. The failure above is a *geometry* failure,
not a checkpoint failure — a prettier frame is still not a tileable band — so
the recommendation stands regardless. The strip re-run should use flux2.

Artifacts: `content/batches/bpskin-spike-0131/` (sheets/, tiles/, harness/,
cut_report.json, harness/results.json).
