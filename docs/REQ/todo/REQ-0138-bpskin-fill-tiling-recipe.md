# REQ-0138 — bpskin-fill-tiling-recipe

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** bpskin-fill-tiling-recipe
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` (S2 risk note),
`docs/REQ/todo/REQ-0131-bpskin-tiling-spike.md`.

## Goal

Correct the risk model of the skin pipeline's S2 ("diffusion models are weak at
seamless tiling" — outdated as stated): seamless `fill_texture` generation is a
largely SOLVED problem via circular padding. Deliver the concrete workflow so
REQ-0131 spends its budget on the REAL risk — autotile edge sets + `clip_mask`
integrity.

## Recipe to validate (input to REQ-0131)

- ComfyUI seamless-tiling custom nodes (`spinagon/ComfyUI-seamless-tiling`):
  Seamless Tile model patch between loader and sampler; Make Circular VAE (or
  Circular VAE Decode) for decode-side circular padding.
- Verification: Offset Image node (half-shift both axes) — zero visible seam.
- Works with whatever checkpoint REQ-0136 ratifies (SDXL family confirmed).

## Scope

- Reproduce on 2 contrasting motifs (elven / barbarian), 512–1024 px tiles.
- Append the validated node graph + settings to REQ-0131 and the skin pipeline
  doc S2; explicitly re-scope REQ-0131's emphasis onto motif-sheet edge-tile
  cutting and clip-mask autotrace.

## Non-goals

No skin registry/system work (REQ-0126); no edge-tile generation itself
(REQ-0131 owns the spike).

## Gates

- Offset-check zero-seam on both motifs, screenshots archived under
  `web/preview/`.
- REQ-0131 + skin pipeline S2 updated with the recipe (that update is the
  implementation of this REQ).

---

## WIP state (session end 2026-07-12 ~04:55; unattended completion running)

- Recipe VALIDATED in first measurements: SeamlessTile (model patch,
  tiling=enable) + CircularVAEDecode, V9, 1024px tiles. Numeric offset
  check (wrap/interior discontinuity ratio, ~1.0 = seamless):
  elven s101 seamless rx=1.09 ry=0.96 vs CONTROL rx=2.78 ry=3.14.
  Remaining legs (elven s202 ctrl dup, barbarian x2 x2) finish unattended
  (~/scratch/req_seq5.sh -> galleries to web/preview/bpskin-tiling-0138/).
- Tooling committed here: tools/req0138_tiling.py (gen + PIL half-shift
  offset artifacts + 2x2 sheets + seam metric -> findings.json),
  tools/req0138_gallery.py. Custom node spinagon/ComfyUI-seamless-tiling
  installed 2026-07-12 (provenance -> REQ-0139).
- NEXT SESSION: after req_seq5 DONE run ~/scratch/finalize_fill.py
  (appends full findings tables here + REQ-0131 recipe section + patches
  backpack_skin_pipeline.md S2), commit, deploy previews, then this REQ
  moves todo -> built (gates: zero-seam both motifs + doc updates).
  NOTE: REQ-0131 is ON USER HOLD (2026-07-12) - its recipe append waits.
