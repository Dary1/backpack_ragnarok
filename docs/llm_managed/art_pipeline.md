# Art Pipeline — v2.0 (2026-07-13, REQ-0150)

> **This doc replaces the art halves of `item_content_pipeline.md`,
> `unit_icon_pipeline.md`, `monster_content_pipeline.md` and
> `backpack_skin_pipeline.md`.** There is now ONE route, ONE style layer and ONE
> set of tools for every kind of image the program generates. Per-kind deltas are
> small and live in §5. Stage numbering S0–S8 (`common_content_pipeline.md` §4) is
> unchanged; this doc is S5 (Art) in full.

## 0. What changed, and what you must not undo

Two user decisions, both taken 2026-07-13, both binding:

1. **One route: `flux2`.** FLUX.2 klein 4B distilled, GGUF Q8_0, Apache 2.0.
   **SDXL is retired and its code is deleted** — Juggernaut XL, DreamShaper XL,
   `rpg_v5`, `CheckpointLoaderSimple`, `LoraLoader`, `KSampler`, hires-fix. All of
   it is in git history and none of it is in the tools.
2. **A new art direction**, reached by the user in InvokeAI Community Edition and
   ratified by looking at the results. It **supersedes** the Norse dark-fantasy
   painterly direction — *including REQ-0127's ratified, S7-ALL-GREEN unit roster
   style*. Do not reintroduce it, and do not treat REQ-0127's roster as current.

Three things in this pipeline are counter-intuitive and get "fixed" back by
someone who has not read this. They are not bugs:

- **Steps 30, not 4.** klein is a *distilled 4-step* model. The user's verdict was
  reached at 30 and 30 is what ships. Do not optimise it back.
- **There is no negative prompt.** Distilled klein samples at cfg 1.0 and the
  graph feeds a `ConditioningZeroOut` of the positive in as the negative. Anything
  you pass is discarded, so `art_route.build_txt2img` **refuses** a negative
  rather than accepting and dropping it. Steer style from the POSITIVE. Any legacy
  `gen_negative` in a defs file is dead — rewrite it into `gen_prompt`, do not
  copy it.
- **There are no LoRAs.** SDXL/SD1.5 LoRAs are a different architecture and do not
  load. The two the program used (`detail_tweaker`, `cel_shaded_art_style`) were
  generic style/detail boosters, **not** identity LoRAs — dropped, and the style
  they bought now comes from the POSITIVE prompt. A job that asks for `loras` gets
  a hard error, not a silent drop. (REQ-0137, character-identity LoRA, must now
  train on FLUX.)

## 1. The tools

| file | what it is |
| --- | --- |
| **`tools/art_route.py`** | **THE route.** Models, sampler settings, `submit`/`wait_done`, and the ONE graph (`build_txt2img`). Nothing else may declare a model name or a sampler default. |
| **`tools/art_style.py`** | **THE style layer.** The ratified prompt templates, the InvokeAI→ComfyUI emphasis conversion, the fill-texture style, and `gen_size()`. |
| `tools/gen_item_icons.py` | item + unit icons, defs-driven (`--defs`), N candidates × seeds, matte, `--rematte-only`. |
| `tools/gen_unit_icons.py` | thin wrapper: the unit roster's defs + outdir. Inherits everything else. |
| `tools/gen_monster_art.py` | monster illustrations, job-list driven. |
| `tools/gen_bpskin.py` | backpack skins: generate a frame source → **GATE** → generate a fill → compose. |
| `tools/bpskin_compose.py` | fill + welt → skin, over any polyomino. |
| `tools/tool_icon_score.py`, `tools/tool_fit_check.py` | scoring/fit. **FILTER ONLY** — they never pick a winner. |
| `tools/spikes/` | REQ-0150's spikes. History. Their findings are encoded in `art_route.py` / `art_style.py`. Not part of the pipeline. |

Anything with a `DEPRECATED (REQ-0150)` banner is not part of the pipeline. Do not
extend it, copy from it, or cite it as precedent.

Python client: `~/backpack_ragnarok/.venv/bin/python` (worktrees have no own venv).
ComfyUI is started manually: `~/ComfyUI/venv/bin/python main.py` (service-ification
is REQ-0139).

## 2. The route (binding)

```
FLUX.2 klein 4B distilled · GGUF Q8_0        flux-2-klein-4b-Q8_0.gguf
text encoder  Qwen3-4B                        qwen_3_4b.safetensors
VAE           flux2                           flux2-vae.safetensors
sampler euler · steps 30 · cfg 1.0 · seed 1 · NO LoRAs · NO negative
```

The graph is ComfyUI's official *Text to Image (Flux.2 Klein 4B Distilled)*
template with `UNETLoader` swapped for `UnetLoaderGGUF`:

```
UnetLoaderGGUF ─┐
CLIPLoader(flux2) → CLIPTextEncode ─┬→ CFGGuider → SamplerCustomAdvanced → VAEDecode → SaveImage
                                    └→ ConditioningZeroOut  (this IS the "negative")
EmptyFlux2LatentImage · Flux2Scheduler · KSamplerSelect · RandomNoise
```

### Seamless tiling (fills only)

`build_txt2img(..., tiling=True)` swaps `VAEDecode` for **`CircularVAEDecode`**.
That is the entire recipe on FLUX. Measured (REQ-0150 §2, 2 motifs × 2 seeds,
1024 px, same metric as REQ-0138): **seam ratio 0.76–1.43, mean 1.00**, against a
plain-decode control of 0.92–2.73.

**Do not add `SeamlessTile`.** SDXL needed it; on FLUX it is a **NO-OP** — it
patches `torch.nn.Conv2d` and FLUX's denoiser is a DiT that holds none. Proved:
with and without it, the output was **bit-identical on 4/4 pairs (max diff 0)**.

Two post-process routes were also measured and **rejected** — both hit the number
and both fail the eye, which is why the half-shift offset check is mandatory
alongside the ratio: *wrap-crossfade* (heavy ghosting) and *offset + inpaint*
(starburst/smear artifacts on the seam cross).

The seam metric is a ratio against local contrast, so it **reads high on
low-contrast tiles**: one measurement at 1.43 was inspected at 6× and has no
visible seam. It stays a **FILTER**, never a verdict. Reroll the seed on a genuine
seam — a reroll costs ~10 s.

### The box: batch by PROMPT, not by seed

RTX 2080, **8 GB VRAM** (23 GB is *system RAM*). FLUX.2 and the Qwen3-4B encoder
do not co-reside in 8 GB, so ComfyUI swaps them per prompt. Measured:

| | cost |
| --- | --- |
| first generation of a run (cold load) | **450–540 s** |
| later generation, **same** prompt | 2–20 s |
| **prompt change** (text-encoder reload) | 30–170 s |

So: **group work by prompt**, and never judge throughput on the first image.

Still true, still bites:
- **Stop ComfyUI before the matte phase.** rembg `alpha_matting` peaks at 12–13 GB
  RSS and will not fit beside a resident model. Run `--no-matte`, stop ComfyUI,
  then `--rematte-only`. This OOM has killed three runs.
- Check nothing else holds the GPU before launching.

## 3. The style layer (binding)

The user's direction, from InvokeAI's default prompt templates. `art_style.py`
holds them verbatim and applies them:

| kind | template | subject shape |
| --- | --- | --- |
| item | **Anime** | `<subject>, white background, bold outline` |
| unit | **Anime** | `<subject>, portrait, looking at viewer, white background` |
| monster | **Concept Art (Fantasy)** | `<subject>, white background` |
| fill texture | **none** — `FILL_STYLE` | `<material> texture, <detail>, ` + `FILL_STYLE` |

```
Anime                 {prompt} anime++, bold outline, cel-shaded coloring, shounen, seinen
Concept Art (Fantasy) concept artwork of a {prompt}. (digital painterly art style)++,
                      mythological, (textured 2d dry media brushpack)++, glazed
                      brushstrokes, otherworldly. painting+, illustration+
```

### `++` is InvokeAI's syntax, not ComfyUI's

InvokeAI weights with trailing `+`/`-` (each `+` is ×1.1, compounding). **ComfyUI
does not understand it** — pasted verbatim, the plus signs tokenise as text.
`art_style.to_comfy()` converts to `(text:weight)`.

This is not cosmetic. Weighted vs weights-stripped on the same seed are **not the
same image** (mean abs diff 38.9 on the sword, 8.8 on the goblin), and the weighted
leg is visibly better — the sword fills its 1×3 cell footprint; the flattened one
floats small in the frame.

**The regex has a trap.** A naive `(\S+)(\++|-+)` reads the hyphen in
`cel-shaded coloring` as a *de-emphasis* marker and emits `(cel:0.909)shaded
coloring`, and it leaves `anime++` as `(anime+:1.1)`. The trailing-boundary
lookahead in `art_style._EMPH` prevents both. It is invisible unless you print the
prompt, and it would have poisoned every anime-template asset. **Do not
"simplify" it.**

### Fills do not use a template

The Anime template's *"bold outline"* + cel-shading turn a fill brief into a
discrete bordered **object**: asked for a leather texture, it produced a stitched,
black-outlined leather patch. A fill must say, positively, that it is a fill —
allover, edge to edge, **no focal object, no border, no outline, no frame**. That
is `art_style.FILL_STYLE`.

## 4. Generation size = the CELL FOOTPRINT's aspect ratio

**Square-then-downscale is retired.** It is what made a 1×3 sword float in the
middle of its own icon. Generate at the intended footprint's **aspect ratio**:

```python
art_style.gen_size(cells_w, cells_h, px_per_cell)   # snapped to /16
```

`px_per_cell` is a *resolution* knob, not a law — the user used **256 for items**
(few cells, the model needs pixels to work with) and **128 for monsters and
textures** (many cells, already big enough). Both are fine. **Only the ratio is
binding.** Sizes snap to /16: a latent cannot be 756 px tall, which is why the
user's `256×756` sword is generated at `256×768`.

The coverage floor (≥ 20% draw coverage per owned cell) and the aspect-ratio law
(`common_content_pipeline.md` §2) are unchanged and still binding.

## 5. Per-kind deltas

### Items — `tools/gen_item_icons.py`
Defs-driven: `gen_prompt` / `gen_render` per entry (`gen_negative` is DEAD).
N candidates at fixed seeds. `gen_render.mask_cells` biases placement via
`ConditioningSetMask` on the positive — a **hint**, never a guarantee; fit scoring
stays mandatory. Matte: rembg `birefnet-general` + a border-key fallback, with a
coverage validity band. `batch-003-item-icons` was NG'd at S7 and is regenerated
on this direction.

### Units — `tools/gen_unit_icons.py`
The item tool with the roster's defs. Upright forever, never rotated.

**Framing: gear nouns break the bust.** "dagger", "belts and pouches", "leather
armor" name things below the shoulders and the model widens the shot to show them
— even with `portrait, looking at viewer` present. Proved with a falsifier: adding
`leather armor` to a working bust prompt widens it to torso + belt; removing it
restores the bust. So: **name the character, not the kit.** The cost is real — the
armour stops being visible. If a unit must show its kit, generate half-body and
crop to bust in post.

### Monsters — `tools/gen_monster_art.py`
Job-list driven. `ckpt`, `loras`, `negative`, `hires` are all **rejected** (they
were SDXL-era fields). Style comes from the Concept Art (Fantasy) template.

### Backpack skins — `tools/gen_bpskin.py` + `tools/bpskin_compose.py`
A skin is **fill + edge**, and both are generated. See §6.

## 6. Backpack skins: generate → GATE → compose

A backpack is an arbitrary **polyomino** (I, L, T, S/Z, inner-corner, holed;
REQ-0126). So the fill must genuinely **tile** — a crop of a fixed patch cannot
cover a shape whose size it does not know — and the edge must run correctly around
straights, outer corners **and inner corners**.

**S1 — generate a frame source.** A patch of the material with an explicit border,
on white, **with a margin**. The margin is in the brief, not left to luck.

**S2 — GATE it. A frame source is only usable if the extractor can find it.** Five
machine checks, all numeric, all reported (`gen_bpskin.validate`):

| check | rule | why |
| --- | --- | --- |
| `margin` | outer 4% ring of the image is ≥ 95% background, **on every side** | the flood fill needs somewhere to start |
| `solidity` | area / convex-hull ≥ 0.88 | a panel, not a blob with fingers the welt cannot follow |
| `single` | largest connected component ≥ 95% of the mask | one patch, not scattered pieces |
| `coverage` | silhouette is 45–93% of the frame | not a postage stamp, not edge-to-edge |
| `rim` | mean \|luma(ring) − luma(interior)\| ≥ 8 **or** ring gradient energy ≥ 1.25× interior | there IS a border to extract |

FAIL → reroll the seed. **A failing candidate never reaches the tool.** This gate
is not theoretical: it rejects the *original* accidental frame source (margin
0.047, coverage 0.996 — that one only worked by luck), and in its first run it
rejected 1 of 6 fresh candidates.

**S3 — compose** (`bpskin_compose.py`):
1. **Silhouette** — flood-fill the near-white background *inward from the four
   corners*, so only background connected to the border is removed. Rounded
   corners and keeper-tabs survive as alpha.
2. **Ring** — Euclidean distance transform; `ring = silhouette AND dist ≤ band`.
   That is the keyline + the welt + the stitch line and nothing else. `band` is
   the only knob (**75 px at 1024**), and it is swept, not guessed.
3. **Welt** — scipy's *feature* transform gives, for every ring pixel, the nearest
   background pixel. That offset yields **depth** (which row of the welt strip) and
   **normal** (which strip, horizontal or vertical). So straights, outer corners,
   inner corners and holes all fall out of the same three lines — **no tile atlas,
   no autotile lookup table, no renderer rotation.** (This supersedes the BS-G5
   "author all orientations at build time" plan; the exception in
   `common_content_pipeline.md` §2 is now moot for fills and unused for edges.)
4. **Compose** — fill inside, welt on top, feathered; transparent outside.

Two bugs are baked into the code as comments because neither is visible without
looking at a rendered image:
- The distance transform must be run on a **padded** mask. A patch that runs to
  the image border has no background pixel beside it there, so the EDT measures to
  the far-away corner white and the ring appears **only at the rounded corners**.
- The welt must be **directional**. Tiling one `band × band` swatch isotropically
  reads as a repeating chain of blobs; a welt has an orientation and a swatch does
  not.

Known rough edges: the corner miter is whatever the nearest-edge heuristic gives
(fine at 128 px cells, not an authored miter), and the mirror-tiled welt run has a
faint symmetry at its midpoint. Slicing an authored edge-tile set is
**REQ-0146 (bpskin-edge-strip-spike)**.

Fill and frame are generated independently, so **their palettes can drift** (the
wood pair is noticeably light-frame / dark-fill). Colour-matching them is open.

## 7. Scoring, review, and the stop

Scoring is a **FILTER ONLY** (coverage ≥ 20% auto-FAIL). It never picks a winner.
**The user's gallery verdict does.** Every batch ships a numbered gallery to
`web/preview/<batch>/` on backpack-dev, at 256 px **and** 64 px, and where a
predecessor exists the new art is shown **next to** it — a migration is judged
against what it replaced.

**S7 is a USER STOP.** Nothing enters `content/live/` before the user rules.

## 8. Registry era — the artwork registry + inspection kits (REQ-0151/0152/0153)

> Cross-reference only; this section does not restate the route (§1–§4), the style
> layer (§3) or the stop (§7). The operating model and the shared contracts live in
> `common_content_pipeline.md` §6–§9.

**The artwork registry (REQ-0151) is now the system-of-record for renders and
adoption.** §1–§7 above describe the ROUTE and STYLE the registry drives; the
registry stores every render (PNG bytes + sha256, seed, verbatim `final_prompt`,
full `params` incl. model filenames AND content hashes) in Postgres behind
`storage.cjs`, and adoption picks exactly one render per `system_name`. Seed policy,
adoption, export: `common_content_pipeline.md` §7.2–§7.4. Generation goes through
THE route AS MODULES — `server/services/art_jobs.cjs` (serialized single-GPU queue)
spawns `tools/art_job.py`, which imports `art_route`/`art_style`; no fork, no
duplicated constants.

**§7 scoring is a FILTER; REQ-0152 kits are its machine layer, persisted and
advisory.** After every successful render the kits registered for the artwork's
kind auto-run on the same single-GPU-safe queue at **LOW priority** (CPU-only; they
never delay a pending GPU job), and each writes one `render_inspections` row
(migration 008, behind `storage.cjs`; `UNIQUE(render_id, kit_id, kit_version)`;
cascades on render delete). **Advisory kits top out at WARN and NEVER gate adoption**
(`common_content_pipeline.md` §7.5). A kit_version bump or an input change flips a
**stale** badge; a re-run button re-executes just that kit
(`POST /api/art/artworks/<name>/renders/<seed>/inspect`).

### Kit roster v1 (REQ-0152; thresholds marked [S7] await user ratification)

| kit_id | applies_to | measures | verdict rule |
| --- | --- | --- | --- |
| `bpskin.frame_gate` v1 | bpskin | the `gen_bpskin.validate()` 5-check (margin / silhouette_coverage / single-component / solidity / rim) | **BLOCKING** inside the recipe (can emit FAIL); compose consumes only PASS frames |
| `matte.coverage_band` v1 | po · si · unit | `image_alpha_coverage` (whole-image α>8 fraction) | in band **0.02–0.90** → PASS, else WARN — never rejects |
| `po.cell_packing` v1 | po | `tool_icon_score` metrics: score, scale/coverage/uniformity, `cell_content_coverage` | advisory; `winner` **demoted to a note** (scoring is a filter, §7) |
| `tiling.seam` v1 | bpskin fills | wrap-edge/interior gradient ratio (ratio_x, ratio_y) | band **[0.83, 1.10]** [S7] → PASS, else WARN + **mandatory half-shift eyeball** (reads high on low-contrast tiles) |
| `monster.render_sanity` v1 | monster | `image_alpha_coverage`, `white_bg_fraction`, `subject_bbox_fill` | [S7]: content 0.02–0.92, white_bg ≥ 0.05 |
| `si.subject_frame` v1 | si | single-centered-subject + margin for 256×256 SIs | [S7]: content 0.03–0.92, largest_component ≥ 0.80, centroid_offset ≤ 0.25, margin ≥ 0.02 |

**Metric naming is disambiguated everywhere** (three quantities were all once called
"coverage"): `image_alpha_coverage` (whole-image matte band / gallery floor),
`cell_content_coverage` (per-owned-cell packing/fit), `silhouette_coverage`
(bpskin frame-silhouette fraction).

**Deprecated, deliberately NOT wired:** `tool_fit_check.py` (check mode) +
`build_fit_report.py` are SVG-sprite-era (they inspect `<symbol>`s), so they cannot
run on a flux2 raster; left untouched for the legacy SVG sprite. A raster
overflow-vs-cells check (`po.cell_overflow`) is a proposed follow-up REQ, not built.

### PO shape conditioning (REQ-0153) — available recipe, not wired

REQ-0153's spike verdict is **GREEN-with-recipe**: up-front silhouette control for
non-rectangular PO shapes via **ReferenceLatent (scaffold) + SetLatentNoiseMask
(dilated shape, D=8)** — the §4 generation size gains an OPTIONAL shape input.
It is **NOT wired into `art_route.build_txt2img`**; the production route stays
byte-identical. Full recipe and the per-item-toggle recommendation:
`item_content_pipeline.md` §Shape conditioning and REQ-0153. Do not treat it as
live until a follow-up integration REQ wires it.
