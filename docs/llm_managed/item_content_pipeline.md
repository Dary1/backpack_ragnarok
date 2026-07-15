
> ## ART: SUPERSEDED by `art_pipeline.md` (REQ-0150, 2026-07-13)
>
> Everything in this file about **image generation** — checkpoints, LoRAs, samplers,
> steps, prompts, negative prompts, tiling, generation sizes, tool names — is
> **out of date and must not be followed**. It describes the retired SDXL route
> and/or the retired Norse dark-fantasy painterly art direction.
>
> The current route, style and tools are in **`art_pipeline.md`**. Two user
> decisions (2026-07-13) supersede this file's art content:
> **(1) one route: flux2** — SDXL is retired and its code is deleted;
> **(2) a new art direction** (InvokeAI Anime / Concept Art (Fantasy) templates,
> euler / 30 steps / cfg 1.0 / no LoRAs / no negative), which supersedes the Norse
> painterly direction **including REQ-0127's ratified unit roster style**.
>
> > `batch-003-item-icons` was NG'd at S7 and is being regenerated on the new
> direction. Its `gen_negative` fields are DEAD (this route has no negative) —
> rewrite them into `gen_prompt`, do not copy them.
>
> The NON-art content of this file (schema, data model, review flow) still stands.

# Item Content Pipeline — v3.0 (2026-07-14, REQ-0154; registry era) — PO / SI

> **v3.0 (2026-07-14, REQ-0154; registry era):** §0 below makes the two
> registries (artwork REQ-0151 / content-data REQ-0155) the operating model and
> references the spine §7 for all shared contracts; PO/SI split stated per
> REQ-0151 ruling 8. The CLI Steps 1–8 are kept as the underlying tool sequence.
> Art content stays superseded by `art_pipeline.md` (banner above).
>
> **v2.1 (2026-07-12, REQ-0134):** translated to English per the language
> policy (user directive 2026-07-02); content identical to v2 except:
> references updated (`art_golden.md` → `common_content_pipeline.md` §2;
> `common_content_pipeline.md` now exists), and the route-location notes
> updated after REQ-0109's merge to master (2026-07-12). v2 (Japanese) lives
> in git history.
>
> **Scope**: PO (`content/live/live_items.json`, `po/2`) and SI
> (`content/live/live_sis.json`, `si/2`). Executing the steps top-to-bottom
> adds one batch of items. Shared principles, infra, REQ workflow, vocab,
> build (`tool_gen_data.cjs`) and quality gates (`ci.sh`):
> see `common_content_pipeline.md`.
> **Operator**: Opus executes all steps solo.
> **Icon stage** = the REQ-0073 AI-raster route, **verified end-to-end on V9,
> 2026-07-09** (see "Verification log" at the end). The route was recovered
> and merged to master by REQ-0109 (2026-07-12). NOTE: the batch-003 ART
> outcome was rejected by the user at S7 (2026-07-12, "NG"); candidate
> regeneration restarts on the refreshed pipeline — which now means the
> **REQ-0136 checkpoint outcome only**: REQ-0135 is settled (LayerDiffuse
> NO-GO, matte route unchanged) and is no longer a blocker. See REQ-0109 (todo).

## 0. Registry era — PO and SI as registry facets (REQ-0154)

Items are now produced through the **two registries** described in
`common_content_pipeline.md` §6–§9, not by hand-running the CLI steps below. The
CLI steps (§Prerequisites … Step 8) remain **valid and are the underlying tool
sequence** the registries wrap — read them for what each tool does; read this
section and the spine §7 for the operating model.

**PO / SI split (REQ-0151 ruling 8 — canvas_spec.md canon).** An item is one
`system_name` with two facets:

| facet | PO — Placement Object | SI — Socket Item |
| --- | --- | --- |
| artwork kind (`artworks.kind`) | `po` | `si` |
| shape input (admin) | **5×5 click grid** (active cells) | **none** |
| render resolution | **derived** from the active-cell bounding box: 256 px/cell, /16-snap (`server/services/art_sizing.cjs`) — e.g. sword 3 vertical cells → 256×768, shield 2×2 → 512×512, potion 1×2 → 256×512 | **locked 256×256** |
| data kind (`content_defs.kind`) | `po_def` | `si_def` |
| data schema | `po/2` (`content/live/live_items.json`): `shape`/`tags`/`effects`/`sockets`/`ports`/… (Step 2) | `si/2` (`content/live/live_sis.json`): `slot`/`reqTags`/`effects` — **no shape/sockets** |

**Seed / variant, adoption, export, advisory inspection: see the spine — do NOT
restate here.**
- Seed vs variant, recipe-vs-asset-of-record: `common_content_pipeline.md` §7.2.
- Adoption (one adopted render + one adopted variant per `system_name`; human-only;
  adopted-undeletable): §7.3.
- Export: the adopted PO/SI render exports to `content/art/po/<name>.png` /
  `content/art/si/<name>.png`; the adopted def variant exports via `tool_integrate`
  into `content/live/live_items.json` / `live_sis.json`. The git-branch/live-merge
  half is the deploy step (§7.4).
- Advisory inspection kits (§7.5; roster + thresholds in `art_pipeline.md` §8):
  a **PO** render auto-runs `matte.coverage_band` + `po.cell_packing`; an **SI**
  render auto-runs `matte.coverage_band` + `si.subject_frame`. All advisory (top
  out at WARN); results in `render_inspections`; never gate adoption.

- **REQ-0133 (item-raster-live-wiring, draft) coordination:** its live-render
  wiring concern is now the **registry export contract** (§7.4) — the adopted
  PO/SI render is what live/mock/client consume via the export. REQ-0133 stays
  in `draft/`, still blocked on REQ-0125a’s shared resolution machinery; the
  raster-vs-SVG half is already ruled RASTER.

**Where the CLI steps map onto the registries:** Step 5 (art) is now the **artwork
registry** — generate seeds, kits auto-run, human adopts (`art_pipeline.md`; REQ-0151).
Step 3–4 validators (static validate / engine integrate) are now the **content-data
registry**'s machine checks run on every variant (`schema_vocab` / `engine_types` /
`gen_data` / `integrate` dry-run; REQ-0155). Step 8 (merge) is now the **export**
step on adoption (§7.4). The manual steps still work unchanged for a one-off batch.


## 0.1 Shape conditioning (REQ-0153 recipe — LIVE since REQ-0183/0186)

REQ-0153 was a spike; its verdict is **GREEN-with-recipe**. Up-front silhouette
control for **non-rectangular PO shapes** (L, T, …) works on the fixed Flux.2 Klein
4B route, but the recipe is a **spec addendum handed to a follow-up integration REQ**
— **the production route (`art_route.build_txt2img`) is untouched and byte-identical**.
**Status 2026-07-15: LIVE.** REQ-0183 wired Arm C @ D=8 into the production route; REQ-0186 exposed it as po params **`shape_lock`** (`off|guide|strict|auto`, default `auto` = strict only when the shape underfills its bounding box) and **`shape_dilation_px`** (0-16, default 8), plus a one-shot generate override that never mutates the artwork. The historical spike spec below is preserved as-is; the authoring rules the lock does NOT cover are §0.2.

**Problem it solves.** Unconditioned t2i rarely lands an awkward silhouette inside its
cells; rerolling seeds until the shape happens to fit is futile. Measured baseline
identity-fit on the scored matrix was **28.6 %** (a `battle axe` overflows the L
quadrant; a `war hammer` renders a full warrior or a garbled logo banner).

**Winner — Arm C @ D=8:** **ReferenceLatent (gray scaffold) + SetLatentNoiseMask
(dilated shape, D=8, on a white-canvas latent).** Over the matrix: **100 % identity-fit
feasible, zero deep-overflow, pure-white backgrounds, best median best-fit** — clears
every ratified GREEN gate. The scaffold is a **mid-gray flat silhouette on white at
gen resolution** (aspect + /16 snap, 256 px/cell), driven directly by the REQ-0151 PO
**5×5 mask**. **Arm A** (ReferenceLatent alone, ~60 % containment) is the fallback if a
hard mask is undesirable. **Arm B** (scaffold img2img) was **REJECTED** (ghosts the
gray scaffold / distorts the subject).

**Recipe deltas (the hand-off; do NOT apply here):**
- `art_route.build_txt2img` gains OPTIONAL `reference_image` / `shape_mask_image` /
  `mask_init_image`, all defaulting to `None` (route byte-identical when unused). Arm A
  inserts `LoadImage → VAEEncode → ReferenceLatent` into the positive; Arm C also
  replaces `EmptyFlux2LatentImage` with `VAEEncode(white canvas) → SetLatentNoiseMask(mask)`.
- `art_style.edit_instruction(subject)` → Anime template applied to
  `"Turn the gray shape into <subject>. Keep the silhouette exactly. white background,
  bold outline"`.
- `tools/spikes/req0153_shape_scaffold.py` (cell mask → scaffold + dilated hard mask)
  becomes the production scaffold generator.

**Recommendation (per REQ-0153):** use **Arm C @ D=8 when a shape MUST be respected**
(non-rectangular PO). For shapes whose subject already fits under the aspect-sizing law
(single-column / square footprints with an aptly-oriented subject) shape-conditioning is
**optional** — the baseline already fills those. Because the hard lock **spends subject
legibility** on blocky shapes (the T hammer reads as an abstract cracked-metal T),
expose it as a **per-item toggle in the REQ-0151 admin** (already scoped there), never
force it globally, and keep the **post-hoc numeric fit as the final gate**.

**Ops cost to budget:** VRAM peaked **6.7–6.8 GB at 256/cell on the 8 GB card (no OOM)**,
but reference-latent jobs are **~2–3× slower** than plain t2i (~76–130 s each).

## 0.2 Shape & prompt authoring doctrine (REQ-0187 S7 findings, 2026-07-15)

REQ-0183/0186 made the lock live; REQ-0187's eyeball of real production renders
found the lock is **necessary but not sufficient**. Containment held on every
strict render (deep_overflow_px = 0) while the composition was still unusable.
These rules bind the AUTHORING step (choosing the mask + writing the prompt);
no lock rescues a violation of them after the fact. They were articulated by
the user against renders `req0187_l_axe` seeds 1 / 11-14 / 21-24 and verified
in-session.

**1. Imagine first.** Visualize the CONCRETE item, mentally axis-align it, and
only then derive mask and prompt — both from that one mental image. Never pick
a shape from a word association ("an axe is L-ish"): the concrete image decides
the topology (a double-edged axe puts the handle at the head's vertical center
— that is a T-object, whatever the word suggested). Evidence: the word-first
L-order produced four renders that all fit the T footprint by translation alone.

**2. Fit-feel is violation-based, not additive.** GOLDEN aggregation rule
(user, 2026-07-15): *"discomfort is decided by the WORST spot, not the average
-- one cell's grave violation is not diluted by the other cells' goodness."*
Never average violations across cells. Within a cell, violations OR-combine
(v = 1 - prod(1 - v_i): the largest dominates, co-occurring ones compound);
across cells, aggregate worst-dominated (max, or a high-p norm). Averaging is
only meaningful for additive experiences; fit-feel is negative-elimination.
Validated same day: the averaging meter ranked the user-best render 4th; the
worst-spot meter ranked it 1st and sank the border-skimming renders to the
bottom (tools/spikes/req0187_fit_meter.py v4, findings in REQ-0187).
 The backpack "snug fit" is
not a positive quantity to maximize; it is the ABSENCE of specific violations.
A blob-like subject with no long straight part raises no expectation and may
sit loosely without discomfort. The violations, in severity order:
- **Misaligned long part.** A long straight part (>= ~1 cell) that is not
  parallel to a grid axis. Sensitivity is highest for SMALL deviations of LONG
  parts (a handle at 10 degrees hurts more than a short edge at 30).
  Promptable: orientation wording took axis-alignment from 0/1 to 7/8 renders.
- **Border-skimming (center-line rule).** A part owns a cell only when it runs
  near the cell row/column CENTER-LINE. Content skimming a cell border is owned
  by no cell and the "fits" reading collapses. Metric shape: per-owned-cell
  centroid distance from cell center; medial-axis deviation from the row
  center-line.
- **Empty owned cells.** deep_overflow catches spill-OUT; nothing catches a
  near-empty owned cell (seed 1 passed containment at per-cell coverage
  0.53/0.09/0.17, composed diagonally). Low per-cell coverage on a tool-like
  subject is a re-generation signal.
- **Spill into unowned cells** — the existing deep_overflow gate (works).

**3. Topology-prompt consistency.** The footprint is the subject's part-
skeleton. L = TERMINAL attachment (arm meets bar at an end); T = MEDIAL
(arm meets bar mid-span). The prompt must state the attachment anatomy
("handle extending from the base of the head"), not just pose. Subjects whose
archetype already matches the footprint are far cheaper than fighting the
archetype (a war hammer / double-bit axe IS a T-object; a boot IS an L).

**4. Mask orientation is part of authoring.** In-game rotation makes all
orientations of a footprint equivalent in play, so CHOOSE the orientation that
matches the subject's natural axis-aligned pose. The axe's native L has its
notch at the BOTTOM-right (vertical handle, head atop, blade projecting
sideways); ordering the notch-top-right L forced the handle onto the row
boundary (a center-line violation) in every round-2 render, because axe
anatomy runs the handle through the head's centered eye.

**5. Aspect ratio is generation-owned.** The model's natural aspect is optimal;
anisotropic stretch degrades visibly past small corrections (user-verified on a
hand-fitted render). A misfit is a re-generation signal, never a transform fix.

**6. Legibility drift.** Pose words are taken literally ("blade upright" drifts
a battle axe into a spearhead). Re-anchor the archetype with anatomy words
(single-edged, bearded) alongside pose words.

**7. Instruments are optimizers, not gates** (extends the §7 "score filters,
human adopts" posture). Kits should emit STRUCTURED findings an LLM can act on
— per-cell coverage, centroid offset from cell center, long-part angle — not
just a scalar. Proposed revision loop (user design, this session):
instruction -> 3 seeds -> instruments -> revised instruction -> 3 seeds ->
instruments -> revised -> 4 seeds -> present all ~10 renders WITH findings as
artwork variations; the user may adopt from any round. The target is YIELD
(the problem is 1-in-10 usable at scale, not the existence of rejects).
Constraints measured: warm strict render 40-130 s / no OOM at ~6.7 GB;
ComfyUI cold start after idle-free (REQ-0158) cost ~508 s of model reload
(880 s first-render wall) — run a loop warm, never judge on the first render;
`renders.seed` is UNIQUE per artwork, so same-seed A/B across rounds needs
render deletion or distinct seeds.

**Revision discipline** (measured, scythe loop 2026-07-15): change ONE
geometric constraint per round and keep every clause that measurably worked
VERBATIM. Round 2 added "tip plunging steeply downward, reaching the middle
height" and the tip cell went v=0.96 -> 0.00 on two renders (fit 66.1 best).
Round 3 additionally asked the blade to run "level along the very top all the
way to the far right corner" -- the model obeyed the level clause and DROPPED
the plunge (two renders: five cells at v=0.00, tip cell back to v=1.00, fit
25.8). Competing geometric clauses are not merged by the model; one wins.
Corollary: a render failing ONLY one cell is also evidence the FOOTPRINT may
be wrong for the archetype (those round-3 renders are ~perfect for the
5-cell Gamma footprint without the tip-dip cell) -- reshaping the mask is
sometimes cheaper than re-prompting (rule 4).

Implementation of the loop + the new instruments is a follow-up REQ
(REQ-0187 observes; it does not modify the route).

## Prerequisites

- Connected to the server. Work in worktree
  `~/backpack_ragnarok_worktrees/req-00NN-slug`, branch `req-00NN-slug`.
- Vocabulary is CLOSED to `content/vocab.json` (currently v7). New vocab is a
  design event = requires user approval.
- Every entry requires `i18n.ja`. **Nothing is written into `content/live/`
  until Step 7 is green.**

## Step 1 — Decide the brief

Theme / count (8–16) / shape distribution / rarity distribution
(`vocab.rarities`) / tag & socket budget / new-vocab allowance (default:
none). Write the intent at the top of `notes.md`.

## Step 2 — Write `draft.json`

Location: `content/batches/batch-NNN-slug/draft.json`, shape
`{ "items": [ /*PO*/ ], "sis": [ /*SI*/ ] }`.

**PO (po/2)**: `id` / `name` / `rarity` / `shape` (array of `[row,col]`) /
`icon` (`"icon-<id>"`) / `tags` (`tags[0]` = kind root, rest = attributes) /
`effects` / `sockets` (`[{t,tags,ax,ay}]`) / `ports` (`[{tiles,tag}]`) /
`part` (assembly items only) / `flavor` / `i18n.ja` / `align` / `stretch`.

**SI (si/2)**: `id` / `name` / `slot` (gem/edge/coat/bond) / `reqTags` /
`icon` / `rarity` / `effects` / `flavor` / `i18n.ja` (no shape/sockets).

**Effect AST**: trigger = `vocab.triggers` (`every_secs` takes `s:[lo,hi]`
seconds; `adjacent` takes `tagKind:"type"|"element"` + `tag`;
`battle_start`/`passive`/`OnHit` etc.), verb = `vocab.verbs` (numbers are
`n:[lo,hi]`, statuses from `vocab.statuses`). Examples:

```json
{"trigger":{"t":"every_secs","s":[1.8,2.2]},"verb":{"t":"strike","n":[22,38]}}
{"trigger":{"t":"adjacent","tagKind":"element","tag":"Oil"},"verb":{"t":"amp_status","status":"Burn","mult":2}}
```

## Step 3 — Static validation (semantic fields)

`shared/content_validate.cjs` (`validateBody(body, kind, vocab)`,
`kind`=`'item'|'si'`, semantic fields only). There is no standalone CLI, so
run a throwaway harness from the repo root:

```js
// tools/scratch_validate_batch.cjs
const V = require('../shared/content_validate.cjs');
const fs = require('fs');
const vocab = JSON.parse(fs.readFileSync('content/vocab.json','utf8'));
const batch = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pick = (o,ks)=>Object.fromEntries(Object.keys(o).filter(k=>ks.has(k)).map(k=>[k,o[k]]));
let bad=0;
for (const e of batch.items||[]) { try{V.validateBody(pick(e,V.ITEM_ALLOWED_KEYS),'item',vocab);}catch(err){bad++;console.error('ITEM',e.id,err.message);} }
for (const e of batch.sis  ||[]) { try{V.validateBody(pick(e,V.SI_ALLOWED_KEYS ),'si',  vocab);}catch(err){bad++;console.error('SI',  e.id,err.message);} }
console.log(bad?`FAIL ${bad}`:'S2 OK'); process.exit(bad?1:0);
```

`node tools/scratch_validate_batch.cjs content/batches/batch-NNN-slug/draft.json`.
Structural fields (shape/ports/part/icon/align/id) are covered by Steps 4–5.
Additionally hand-check id/name collisions (including vs live).

## Step 4 — Engine integration check

```
node tools/tool_integrate.cjs content/vocab.json \
  content/live/live_items.json content/live/live_sis.json \
  content/batches/batch-NNN-slug/draft.json
```

Placement / 4 rotations / socket consistency against the real engine. Any red
→ back to Step 2.

## Step 5 — Icon generation (AI raster route, V9)

> The route (tools, `gen_*` fields, batch-003) lives on **master** since
> REQ-0109's merge (2026-07-12). **Use `~/backpack_ragnarok/.venv/bin/python`
> for the client** (`requests`/`PIL`/`numpy`/`scipy`/`rembg`/`onnxruntime`
> installed; worktrees have no own `.venv`). ComfyUI is NOT a persistent
> service — start it manually (`~/ComfyUI/venv/bin/python main.py`,
> `127.0.0.1:8188`); service-ification is REQ-0139.

**5-1. Compute `gen_render` (never guess).** `cell_px`=256; `cells` =
normalized copy of the shape; `bbox_cells`=[w,h]; `target_px`=[w×256, h×256]
(the final canvas; always rectangular even for irregular shapes); `gen_px` =
same aspect, ~1 MP, both sides multiples of 64 (generate, then Lanczos
downscale to `target_px`). **Never generate small** (e.g. direct 256 px for a
1×1 loses quality; always ~1 MP → downscale). Irregular shapes use the bbox
row and put owned cells into `mask_cells` for placement bias (best-effort).

| shape (bbox w×h) | example | aspect | `target_px` (=bbox×256) | `gen_px` (~1 MP, ×64) |
|---|---|---|---|---|
| 1×1 | gem / reagent | 1:1 | 256×256 | **1024×1024** ✓verified |
| 2×1 | wide weapon | 2:1 | 512×256 | 1408×704 |
| 1×2 | blade / vertical weapon | 1:2 | 256×512 | **704×1408** ✓verified |
| 3×1 | polearm (horizontal) | 3:1 | 768×256 | 1728×576 |
| 1×3 | greatsword (vertical) | 1:3 | 256×768 | 576×1728 |
| 2×2 | shield / large / L-shape | 1:1 | 512×512 | **1024×1024** ✓verified |
| 3×2 | wide large / T/Z | 3:2 | 768×512 | 1152×768 |
| 2×3 | tall large / T/Z | 2:3 | 512×768 | 768×1152 |
| 3×3 | largest | 1:1 | 768×768 | 1024×1024 |

(✓ = confirmed with real branch data / this verification. Others are values
from the same formula, auto-computed by `gen_item_icons.py`. Aspect is
inviolable = no anisotropic scaling / `common_content_pipeline.md` §2.)

**5-2. `gen_prompt` / `gen_negative`.** Follow the template in
`content/batches/batch-003-item-icons/style_guide.md`. Specify a **near-white
background** for matting. Keep names plain (`common_content_pipeline.md` §2,
illustration-first).

**On the ratified `flux2` route (REQ-0136, user verdict 2026-07-12): the
NEGATIVE PROMPT IS INACTIVE** — distilled klein samples at cfg 1.0, where no
classifier-free guidance is applied. `gen_negative` is accepted and DISCARDED;
**steer style from the POSITIVE prompt.** FLUX also obeys a painterly brief
directly, so the old "NOT photorealistic" prompting tax is gone. Front-loading
stylization tokens against a photorealism bias was a **JuggernautXL V9 (sdxl
route)** workaround — it still applies if you deliberately run `--route sdxl`.

*(Historical: the checkpoint re-evaluation is CLOSED — REQ-0136 ratified flux2.
See the ratified-route section at the end of this doc.)*

**5-3. Generate** (ComfyUI at `127.0.0.1:8188`; the route is **flux2** —
`flux-2-klein-4b-Q8_0.gguf`, 4 steps, cfg 1.0, euler — per the ratified-route
section at the end of this doc. `--route sdxl` still exists but is **FROZEN:
historical reproduction only, not a production route** (REQ-0150, user
2026-07-13: one route for all image generation). For >30 s runs use
`setsid nohup ... &` and poll the log):

```
cd <worktree>
setsid nohup ~/backpack_ragnarok/.venv/bin/python tools/gen_item_icons.py \
  --defs content/live/live_items.json --ids <id> \
  --outdir content/batches/<batch>/candidates > tmp/gen.log 2>&1 &
```

Defaults: 4 candidates / seeds 101·202·303·404 / 30 steps / cfg 6.5 /
dpmpp_2m·karras. `--rematte-only` reruns matte only.

**5-4. Matte (transparency)**: rembg `birefnet-general` (cached at
`~/.u2net/birefnet-general.onnx`) + edge-color-key fallback, valid band
2–90%. **This is the route, and it is not under review.** LayerDiffuse
(generation-time alpha) was evaluated and rejected — **REQ-0135b: NO-GO**
(2026-07-12). The node injects raw `("lora", ...)` patches that current ComfyUI
silently drops, so it does nothing at all; upstream is at HEAD with no fix. The
node and its weights have been removed from the art ComfyUI. Do not go looking
for it.

> **On this host, generation and matting MUST be separate passes.** ComfyUI
> (~11 GB RSS with SDXL resident) and birefnet (~12 GB) cannot be co-resident on
> the 23 GB box — it OOM-kills. Use `gen_item_icons.py --no-matte` to generate,
> stop ComfyUI, then `--rematte-only` to matte. (REQ-0135b.)

The open question about this step is no longer *which model* but *what we feed
it*: every live prompt carries `plain uniform near-white background`, which is
the worst possible contrast condition for separating pale steel and light hair.
That is **REQ-0147** (draft) — and it is the reason matte coverage on `hilt`
(10.99%) and `blade` (11.50%) may be self-inflicted.

**5-5. Score & select (geometry only)**:

```
~/backpack_ragnarok/.venv/bin/python tools/tool_icon_score.py \
  --defs content/live/live_items.json \
  --candidates-dir content/batches/<batch>/candidates \
  --out content/batches/<batch>/scores.json \
  --render-dir content/batches/<batch>/fit_renders \
  --select-dir content/batches/<batch>/selected
```

`tool_icon_score.py` imports `tool_fit_check.py`.
`score = 100·(0.35·scale + 0.50·coverage + 0.15·uniformity)`,
`MIN_CONTENT_FRAC=0.02`, winner = argmax. The per-cell coverage floor
**≥20%** must hold (`common_content_pipeline.md` §2).

## Step 6 — Preview deploy

Apply `tools/build_batch003_report.py` to the batch →
`web/preview/batch-NNN/index.html` (self-contained, relative paths, dark
theme) → verify `https://backpack-dev.qtie.jp/preview/batch-NNN/`.

## Step 7 — USER REVIEW (STOP here)

Numbered gallery; verdicts per entry (green/fix/cut) or per rule. **Nothing
touches live until green.** (This is where illustration-first —
`common_content_pipeline.md` §2: no stats before approved art — is enforced.)

## Step 8 — Merge, build, register

1. Append approved entries to `content/live/live_items.json`
   (/`live_sis.json`) `entries[]`.
2. `node tools/tool_gen_data.cjs content/vocab.json content/live/live_items.json content/live/live_sis.json content/live/scenario.json mock-src/data.js`
3. Append id / counts / review outcome / provenance (drafting = opus) to
   `content/registry.json`.
4. `bash tools/ci.sh` (with `SKIP_PG=1`/`SKIP_CLIENT=1`/`SKIP_E2E=1` as
   needed) to green.
5. Commit (batch changes together). Rollback = git history.

---

## Verification log (2026-07-09, V9)

As part of REQ-0109, the icon route was smoke-tested **end-to-end on V9**.

**Environment**
- Model: `JuggernautXL_RunDiffusionPhoto2_V9_Final` (installed; V6 was not
  installed — user decided to adopt V9). NOTE 2026-07-12: superseded by the
  batch-003 S7 NG + REQ-0136 checkpoint bakeoff.
- Client: `~/backpack_ragnarok/.venv/bin/python` (deps installed; the
  worktree had NO own `.venv`, so the main checkout's was used).
- ComfyUI: was down; started manually (`~/ComfyUI/venv/bin/python main.py`,
  `127.0.0.1:8188`). Not a persistent service.
- Matte: `~/.u2net/birefnet-general.onnx` (972 MB) cached → no download.

**Run & results**
- Generate: `gen_item_icons.py --ids hilt --candidates 1` (`hilt` = 1×1,
  `gen_px 1024×1024 → target_px 256×256`, seed 101).
  - Output: `hilt_c1_s101.png` (raw, 72 KB) + `hilt_c1_s101_alpha.png`
    (matte, birefnet, coverage **10.99%**).
  - Time: **298.7 s** (incl. first SDXL load; 8 GB RTX 2080; warm ~23 s/img).
- Score: `tool_icon_score.py` → `hilt` feasible, **score 53.35**
  (`content_frac 0.116` / `scale 0.383` / per-cell coverage `0.134`, weights
  0.35/0.50/0.15). Artifacts: `scores.json`, `fit_renders/hilt_c0_fit.png`,
  `selected/hilt.png`.

**Conclusion**: generate → matte → geometry score → select works
**end-to-end** on V9. Tools healthy.

**Notes**
- Worktree `.venv` missing → use the main `.venv` (or rebuild a worktree
  venv).
- ComfyUI needs manual start. First image ~5 min for model load; warm is fast.
- `hilt` matte coverage 10.99% is below the 20% floor
  (`common_content_pipeline.md` §2) — expected for a small 1×1 pommel
  (per-case redraw or waiver; not a pipeline defect).
- This test was a single-item smoke check. Full batch (8 items × 4
  candidates) and report regeneration were completed under REQ-0109
  (see `web/preview/batch-003/`); the batch-003 ART was subsequently NG'd at
  S7 (2026-07-12) — regeneration restarts on the refreshed pipeline.

### RATIFIED GENERATION ROUTE (REQ-0136, user verdict 2026-07-12)

**Default route: `flux2` — FLUX.2 klein 4B distilled, GGUF Q8_0.**

    unet    flux-2-klein-4b-Q8_0.gguf     (Apache 2.0, unsloth GGUF)
    clip    qwen_3_4b.safetensors         (type: flux2)
    vae     flux2-vae.safetensors
    4 steps / cfg 1.0 / euler + Flux2Scheduler / SamplerCustomAdvanced

Selected on merit over JuggernautXL V9 (incumbent) and DreamShaperXL Turbo v2.1
in a 48-candidate bakeoff (2 items + 2 unit busts x 4 seeds x 3 checkpoints):

| axis | flux2 | dsxl | v9 |
|---|---|---|---|
| near-white background (the brief) | **16/16** | 1/16 | 5/16 |
| warm s/image (RTX 2080, 1024px) | **10 s** | 20 s | 40 s |
| 48-candidate roster batch | **14.8 min** | 21.3 min | 35.5 min |
| VRAM peak | 6842 MiB | 6388 MiB | 6516 MiB |
| licence | **Apache 2.0** | OpenRAIL++-M | incumbent terms |

The "NOT photorealistic" prompting tax is gone: FLUX obeys the painterly brief
directly instead of being argued into it. Switching to a *different SDXL*
checkpoint did NOT fix it -- DreamShaperXL, the nominally stylized contender,
was the most photoreal of the three. The whole SDXL family fights this brief.

**Three things that are NOT optional on this route:**

1. **The negative prompt is INACTIVE.** Distilled klein samples at cfg 1.0,
   where the guider applies no classifier-free guidance, and the official graph
   feeds a ConditioningZeroOut of the positive in as the negative. Defs keep
   their `gen_negative` (the sdxl route still uses it), but on flux2 it is
   accepted and DISCARDED. **Steer style from the POSITIVE prompt.** The tool
   prints a warning once per run so this cannot rot silently.

2. **Lower seed variety.** Near-deterministic sampling means 4 seeds yield 4
   close variants, not 4 alternatives (measured pairwise pixel delta 14.6 vs
   41.1 for v9). The flip side: all 4 are usable, whereas v9's "variety" was
   substantially multiple-object and cropped brief violations. Budget re-rolls
   by changing the PROMPT, not the seed.

3. **RESTART ComfyUI between routes/legs -- `/free` is not enough.** ComfyUI's
   `unload_models` returns weights to the Python allocator, not to the OS. A
   long-lived process that has served SDXL and then FLUX reaches ~19 GB RSS,
   fills swap, and the box stops responding (observed 2026-07-12). Generation
   and matting must also be separate phases (`--phase gen|matte`) with ComfyUI
   DOWN during matte: rembg `alpha_matting` peaks at 12-13 GB RSS, which does
   not fit alongside a resident model on the 23 GB box. Eight global OOM kills
   on 2026-07-12 came from exactly that overlap.

The `sdxl` route (JuggernautXL V9, 30 steps, cfg 6.5, dpmpp_2m/karras) is
**FROZEN — NOT a fallback, NOT a production route.** User decision 2026-07-13
(REQ-0150, "Flux2化"): one route for all image generation. It is kept runnable
for exactly one purpose — **reproducing historical SDXL-era batches**:
`gen_item_icons.py --route sdxl`. Reaching for it because flux2 is inconvenient
is a regression, not a fallback; if flux2 cannot do something, that is a finding
for the user, not a reason to go back.
