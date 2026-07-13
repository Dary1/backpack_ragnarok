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

---

## Findings (2026-07-12) — RECIPE VALIDATED, all gates green

### Verdict

Seamless `fill_texture` generation is **solved** on the existing GPU route.
The S2 risk note ("diffusion models are weak at seamless tiling") was wrong as
stated: the weakness is in the *default sampler/VAE padding*, not in the model.
Switching both to circular padding removes the seam outright — no manual
cleanup, no post-hoc offset-and-heal pass, no inpainting.

REQ-0131 must therefore NOT spend its budget on `fill_texture`. Its real risk
is the part this REQ did not touch: **motif-sheet edge-tile cutting and
`clip_mask` integrity.** Re-scope recorded in REQ-0131.

### Measurement

Metric: mean absolute pixel difference across the **wrap edge** (column 0 vs
column −1, row 0 vs row −1) divided by the mean absolute **interior**
neighbour difference of the same image.

- `ratio ≈ 1.0` — the wrap edge is as continuous as any ordinary interior
  pixel boundary, i.e. the seam is not merely faint but *statistically
  indistinguishable from the texture itself*.
- `ratio >> 1.0` — the wrap edge is a discontinuity, i.e. a visible seam.

Self-normalising by the interior baseline is what makes the number comparable
across motifs: a busy barbarian hide has a far higher absolute pixel delta than
smooth elven brocade, but both are judged against their own texture.

| motif     | seed | leg          | ratio_x | ratio_y | seam |
|-----------|------|--------------|---------|---------|------|
| elven     | 101  | **seamless** |   1.085 |   0.961 | none |
| elven     | 202  | **seamless** |   1.073 |   1.094 | none |
| barbarian | 101  | **seamless** |   1.036 |   0.830 | none |
| barbarian | 202  | **seamless** |   1.018 |   0.989 | none |
| elven     | 101  | control      |   2.779 |   3.136 | HARD |
| elven     | 202  | control      |   2.762 |   3.520 | HARD |
| barbarian | 101  | control      |   3.090 |   3.214 | HARD |
| barbarian | 202  | control      |   3.771 |   3.694 | HARD |

Every seamless leg lands in **0.83–1.09**; every control leg lands in
**2.76–3.77**. The separation is ~3× with zero overlap across 2 contrasting
motifs × 2 seeds — not a marginal win. (`ratio_y = 0.830` on barbarian s101 is
*below* 1.0: the wrap edge is smoother than the average interior edge, which is
what circular padding does to a high-frequency stitched-leather motif.)

Gate — "Offset-check zero-seam on both motifs": **PASS.** Offset images
(half-shift on both axes, which moves the wrap edge to the centre of the frame
where a seam would be unmissable) and 2×2 tile sheets are archived for every
leg.

### Validated recipe (input to REQ-0131 and to skin pipeline S2)

Custom node pack: `spinagon/ComfyUI-seamless-tiling`. Two patches, both
required — patching only one leaves a residual seam, because the sampler and
the VAE decoder each independently pad at the boundary.

1. **`SeamlessTile`** — model patch, inserted **between the checkpoint loader
   and the KSampler**. Swaps every Conv2d padding mode in the UNet to
   circular, so the denoiser sees the tile as a torus from the first step.
   - `tiling: "enable"`, `copy_model: "Make a copy"`
   - `copy_model` matters: without a copy the patch mutates the cached
     checkpoint object in place, and the *next* non-tiling job on the same
     ComfyUI process silently inherits circular padding.
2. **`CircularVAEDecode`** — replaces the ordinary `VAEDecode`. The VAE
   decoder has its own convolutions; a normal decode reintroduces an edge
   discontinuity even from a perfectly toroidal latent.
   - `tiling: "enable"`

Everything else is the incumbent item-route sampler config, unchanged:

| setting     | value                                            |
|-------------|--------------------------------------------------|
| checkpoint  | JuggernautXL V9 (see below — recipe is portable) |
| resolution  | 1024 × 1024 latent (1024 px tile)                |
| steps / cfg | 30 / 6.5                                         |
| sampler     | `dpmpp_2m` + `karras`                            |
| denoise     | 1.0                                              |

Graph shape (control leg = the same graph minus nodes 10 and the circular
decode):

```
CheckpointLoaderSimple ──model──> SeamlessTile(enable, copy) ──> KSampler ──┐
                       ──clip───> CLIPTextEncode (pos / neg) ──────────────>│
                                  EmptyLatentImage 1024x1024 ──────────────>│
                                                                            v
                       ──vae────────────────────> CircularVAEDecode(enable) ──> SaveImage
```

**Prompt discipline (not optional).** Circular padding makes the tile *joinable*;
it does not make it *tileable-looking*. A tile with a focal object or a
lighting gradient wraps seamlessly and still reads as an obvious repeat. The
positive prompt must carry `seamless repeating allover pattern`, `uniform
pattern density edge to edge`, `flat even lighting`, `no focal object`,
`no border`; the negative must carry `vignette`, `gradient`, `spotlight`,
`central object`, `perspective`, `depth of field`. Exact strings:
`tools/req0138_tiling.py` (`STYLE` / `NEG`).

**Checkpoint portability.** Both patches are architectural (Conv2d padding
mode), not weight-specific, so the recipe holds for any SDXL-family checkpoint
— including whichever REQ-0136 ratifies. Validated here on JuggernautXL V9
because that was the incumbent at measurement time; **re-run the offset check
once, on the ratified checkpoint, before the first real skin batch.** FLUX-family
checkpoints use a different UNet and are NOT covered by this validation.

### Reproduce

```
cd ~/backpack_ragnarok_worktrees/req-0138-bpskin-fill-tiling-recipe
~/backpack_ragnarok/.venv/bin/python tools/req0138_tiling.py     # ComfyUI must be up
~/backpack_ragnarok/.venv/bin/python tools/req0138_gallery.py tiling
```

Artifacts (per motif × seed × leg): `_seamless.png` / `_control.png` raw tile,
`_offset.png` half-shift seam check, `_tiled2x2.png` repeat check, plus
`findings.json` with the raw metric.
`content/batches/bpskin-tiling-0138/` · gallery `web/preview/bpskin-tiling-0138/`

### Operating note inherited from REQ-0136

Do not run a tiling batch while a matte job is running. ComfyUI holding a full
SDXL (~11–18 GB RSS) alongside rembg's `alpha_matting` (pymatting, 12–13 GB
RSS) does not fit the 23 GB box — that overlap caused 8 global OOM kills on
2026-07-12. Generation and matting are now separate phases with ComfyUI
stopped in between.


---

## SUPERSEDED — REQ-0150 (Flux2化), user decision 2026-07-13

The user has moved the program to **one route: flux2**; SDXL is retired
(REQ-0150). This REQ's recipe (`SeamlessTile` + `CircularVAEDecode`) patches
**circular Conv2d padding into the SDXL UNet** and is architecture-specific: it
**does not port to FLUX**.

So the only green result in the skin pipeline **does not survive the migration.**

- This recipe is **FROZEN**. Do not run it as production; do not point it at
  flux2 (the patches go silently inert there and the seam comes back).
- Seamless tiling must be **re-solved on FLUX** — a blocking gate of REQ-0150.
- **This file's numbers are the baseline that re-solve must beat**, and they are
  why this REQ still matters: seam ratio **0.83–1.09 seamless vs 2.76–3.77
  control**, 2 motifs × 2 seeds, zero overlap. A FLUX recipe that cannot show
  the same measurement is not a replacement, it is a hope.
