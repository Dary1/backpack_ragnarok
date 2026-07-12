# REQ-0073 — Item icon AI-generation route (batch-003)

Branch: `req-0073-item-icon-gen` (based on `req-0072-redesign-warehouse` @ 032b437).

New AI-raster production route for item icons, fully separate from the live
SVG sprite workflow. Existing docs describing the sprite/defs content
pipeline do NOT apply to this route (explicit user directive, 2026-07-07).
Model note: user specified "Juggernaut XL v6"; it is not installed. User
confirmed substitute: `JuggernautXL_RunDiffusionPhoto2_V9_Final` (ComfyUI,
127.0.0.1:8188).

## Goals

1. Per-item generation prompt + render-shape spec stored IN the item DB
   (`content/live/live_items.json`, schema `po/2`) as additive per-entry
   fields. These are reference exemplars: cheaper LLMs will author future
   items by imitating them (see docs/handoff.md).
2. Local generation via ComfyUI + JuggernautXL V9, 4 candidates per item,
   fixed seeds (reproducible).
3. Mechanical candidate scoring — fit-based ONLY (tool_fit_check solve()),
   zero aesthetic judgement.
4. Adopt the best-scoring candidate per item (separate route; live sprite
   untouched).
5. Report page `web/preview/batch-003/` — all candidates, fit-process
   visualization, scores, winner badges.
6. `docs/handoff.md` so Sonnet 5.0 can continue authoring new items.

## DB field additions (per entry; additive, po/2-compatible)

- `gen_prompt` (string): positive prompt, style-guide compliant
  (`content/batches/batch-003-item-icons/style_guide.md`).
- `gen_negative` (string): negative prompt.
- `gen_render` (object): render-shape spec, deliberately separate from the
  prompt:
  - `cell_px`: 256 — one backpack cell = 256×256 px.
  - `cells`: owned cells, same `[row,col]` convention as `shape`.
  - `bbox_cells`: `[w,h]` cell bounding box.
  - `target_px`: `[w,h]` = bbox_cells × cell_px. Final icon canvas. Always
    rectangular — diffusion models only accept rectangular WxH, even when
    the in-game shape is irregular (e.g. beast_jaw L-shape).
  - `gen_px`: `[w,h]` SDXL generation size: same aspect as target_px,
    ≈1MP area, multiples of 64. Downscaled (Lanczos) to target_px after
    generation.
  - `mask_cells` (optional): cells to bias subject placement into, via
    ComfyUI `ConditioningSetMask` regional conditioning. Best-effort ONLY —
    diffusion gives no placement guarantee, therefore scoring (below)
    remains mandatory and task 3 is NOT skipped.

## Pipeline — `tools/gen_item_icons.py`

Adapted from `tools/gen_monster_art.py` (same ComfyUI API pattern). Reads
entries with `gen_prompt`/`gen_render` from a defs JSON, generates 4
candidates per item at `gen_px`, downsizes to `target_px`, saves:

    content/batches/batch-003-item-icons/candidates/<id>_c<k>_s<seed>.png        (raw)
    content/batches/batch-003-item-icons/candidates/<id>_c<k>_s<seed>_alpha.png  (matted)

Background matting reuses the existing chroma/matte approach
(tools/matte_transparent.py lineage): style guide mandates a plain
near-white backdrop so the alpha content mask is extractable.

## Scoring — `tools/tool_icon_score.py`

IMPORTS `tools/tool_fit_check.py` (REQ-0020 reference port; never forked or
reimplemented). Per candidate: alpha content mask (load_content) → solve()
against the entry's allowed region built from `shape`. Score = geometry
only:

- infeasible → 0.
- else weighted composite of: solve max scale (less shrink is better),
  mean per-owned-cell coverage at the fitted placement, and cross-cell
  coverage uniformity. Weights are constants documented in the tool header;
  fully deterministic; NO aesthetic term (user directive).

Winner per item = argmax score → `content/batches/batch-003-item-icons/selected/`.

## Report — `web/preview/batch-003/`

One card per item: 4 candidates (raw + fitted render via
tool_fit_check.render), per-candidate score breakdown, winner badge. Dark
theme consistent with existing `web/preview/batch-00x` pages. Public URL:
https://backpack-dev.qtie.jp/preview/batch-003/

## Non-goals

- No engine/client/live-sprite (`sprite_all_v11.svg`) changes.
- No aesthetic scoring.
- `web/redesign/dex.html` icon art is NOT a style reference (broken +
  photoreal; wrong direction for the app's mood).
