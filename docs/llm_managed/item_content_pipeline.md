
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

# Item Content Pipeline — v2.1 (PO / SI batch procedure + verification log)

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
