# Style Guide — Batch-003 Item Icons (REQ-0073)

Scope: the AI-raster generation route for the 8 backpack item icons in
`content/live/live_items.json` (schema `po/2`). This is a **separate route**
from the live SVG sprite (`content/sprite_all_v11.svg`) — that pipeline and
its docs do NOT apply here. These entries are **reference exemplars**: cheaper
LLMs will author new items by copying the pattern below, so keep every prompt
literal, ordered, and copy-pasteable.

Generation model: `JuggernautXL_RunDiffusionPhoto2_V9_Final` (SDXL, via
ComfyUI at 127.0.0.1:8188). This model is **photo-biased** — left alone it
renders glossy photoreal product shots. That is the wrong look. Every prompt
MUST front-load strong stylization tokens (below) to pull it painterly.

---

## 1. Art direction

Target look: **stylized painterly dark-fantasy game icon.** A hand-painted
quality upgrade of the existing SVG icon set — same subjects, same silhouette
language, same centered single-object framing — but rendered with soft
painterly volume and rim light instead of flat vector fills. It must read at
a glance in an inventory grid and sit comfortably inside the MJOLNIR
dark-iron / gold / Norse UI.

**Explicitly NOT photorealistic.** No product photography, no studio render,
no glossy CGI, no 3D-engine output. When in doubt, push more painterly.

Draw from the current SVG set (do not photo-reference `web/redesign/dex.html`
— broken and photoreal, wrong direction):

- **Silhouette-first.** One clear, bold, readable object shape, centered.
- **Palette (matches the MJOLNIR app tokens):**
  - Night-iron / weathered steel greys: `#3D434C` `#28313E` `#131820`
  - Aged bone / ivory cream: `#E9E3D3` `#A8A193`
  - Worn leather & wood browns: `#3A3229` `#221c15`
  - Muted heraldic gold accents: `#C9A959` `#8C6D1A` (highlights `#EBD9A4`)
  - Ember orange, used only for fire/heat: `#E25822` `#FF8A3D`
  Keep colors muted and desaturated — aged, forged, weathered, not shiny.
- **Rendering:** painterly brushwork, soft cel-shading, gentle top-left key
  light with a subtle cool rim light to separate the object from the pale
  background. Restrained detail — enough texture (grain, patina, forge marks)
  to feel crafted, never busy.
- **Mood:** grim, ancient, Norse-forged. Runes/knotwork only where the item
  itself calls for them (e.g. the flame tablet).

Upgrade over the SVG set is encouraged (real material texture, volumetric
form). Do NOT drift into realism, cartoon/chibi, cluttered fantasy splash
art, or neon.

---

## 2. Background & framing mandate (hard requirement)

Downstream alpha matting (`tools/matte_transparent.py` lineage) keys the
object out of the background to build the content mask that scoring depends
on. If the background is not clean, matting fails. Therefore **every** prompt
MUST enforce:

- **Plain, uniform, near-white background** (flat off-white / very light warm
  grey). No scene, no environment, no props.
- **Exactly one object**, centered.
- **NO cast shadow** on the background (a small amount of self-shading /
  contact darkening on the object itself is fine; nothing thrown onto the
  backdrop).
- **NO background gradient**, vignette, texture, or lighting falloff.
- **NO frame, border, panel, card, inset, or rounded plate.**
- **NO text, letters, numbers, watermark, signature, logo, or UI chrome.**

These live in both the positive prompt (background clause) and the standard
negative prompt. Do not weaken them.

---

## 3. Composition per shape

The icon canvas is always rectangular (`gen_render.target_px`) even when the
in-game cell shape is irregular — diffusion only outputs rectangular W×H. The
object must **fill the canvas** and leave only a small even margin
(**~5% padding**, roughly a 5% empty band on each side); do not float a tiny
object in a sea of white. Match the composition to the cell footprint
(`bbox_cells` = `[w,h]` in cells):

| Footprint | Cells | Canvas aspect | Composition line to embed in `gen_prompt` |
|-----------|-------|---------------|-------------------------------------------|
| **1×1** (hilt) | 1w × 1h | square (1:1) | *compact single object centered, filling the square frame with a small even margin* |
| **1 wide × 2 tall** (blade, dagger, oil_flask, flame_tablet, herb_pouch) | 1w × 2h | tall (1:2) | *strong vertical composition, the object standing upright and filling the tall frame from top to bottom with a small even margin* |
| **2×2** (tower_shield) | 2w × 2h | square (1:1) | *broad object filling the square frame edge to edge with a small even margin* |
| **L-shape** (beast_jaw) | 3 cells in a 2×2 bbox | square (1:1) | *the object's main mass biased toward the lower-left and right cells (an L-shaped footprint), filling the square frame with a small even margin* |

For the L-shape, `gen_render.mask_cells` also drives ComfyUI regional
conditioning (`ConditioningSetMask`) to bias the subject into the owned cells.
That is best-effort only; the composition line in the prompt still matters,
and mechanical fit scoring remains mandatory regardless.

---

## 4. Prompt template (reusable exemplar)

Assemble the positive prompt in this fixed order. Fill the two `{…}` slots;
keep everything else verbatim. Comma-separated, no sentences.

**Positive template:**

```
{OBJECT}, {COMPOSITION},
stylized painterly dark-fantasy game item icon, hand-painted illustration,
digital painting, concept art, soft cel-shading, matte finish,
weathered forged materials, muted desaturated palette of aged iron grey worn leather and tarnished gold,
Norse mythology aesthetic, grim and ancient,
gentle top-left key light, subtle cool rim light, crisp readable silhouette,
single centered object, plain uniform near-white background, clean flat backdrop,
no shadow, no gradient, high detail, sharp focus
```

- `{OBJECT}` — a concrete, faithful description of the one item (material,
  form, wear, key features), driven by the entry's `name` / `flavor` / `tags`.
  Describe **only** that object. If a name implies a part, render only the
  part (e.g. `blade` = a bare blade with **no** hilt; `hilt` = a grip and
  crossguard with **no** blade).
- `{COMPOSITION}` — the exact composition line for the entry's shape from the
  table in §3.

**Standard negative prompt** (use verbatim for every item; extend per-item
only if a specific failure appears):

```
photograph, photorealistic, realistic, 3d render, cgi, octane render, ray tracing,
product photography, studio lighting, glossy, plastic, hyperreal,
text, letters, numbers, words, watermark, signature, logo, label,
frame, border, panel, card, ui, inset, rounded corners,
cast shadow, drop shadow, background gradient, vignette, scenery, background objects,
multiple objects, duplicate, collage, cropped, out of frame, cut off,
blurry, low quality, jpeg artifacts, deformed, extra parts, cartoon, chibi, anime, neon, oversaturated
```

Key stylization tokens (the load-bearing ones that fight the photo bias):
`stylized painterly dark-fantasy game item icon`, `hand-painted illustration`,
`digital painting`, `concept art`, `soft cel-shading`, `matte finish` — plus
the negatives `photograph`, `photorealistic`, `3d render`, `product
photography`, `glossy`. Do not drop these.

---

## 5. How to author a new item (checklist)

For each new entry in `content/live/live_items.json`, add three additive
fields (touch nothing else; `ensure_ascii=False`, preserve key order/indent):

1. **`gen_prompt`** — the §4 positive template with `{OBJECT}` written from
   the item's `name`/`flavor`/`tags` and `{COMPOSITION}` picked from §3 by the
   item's `shape`. Keep the style + background clauses verbatim.
2. **`gen_negative`** — the §4 standard negative, verbatim (extend only if a
   real failure shows up).
3. **`gen_render`** — the render-shape spec (REQ-0073), independent of the
   prompt:
   - `cell_px`: **256** (one backpack cell = 256×256 px). Always.
   - `cells`: copy of `shape`, normalized to its bbox, **`[row,col]`**
     convention (same as `shape`; see `tools/tool_fit_check.shape_to_cellset`).
   - `bbox_cells`: `[w, h]` in cells — `w = maxcol−mincol+1`,
     `h = maxrow−minrow+1`.
   - `target_px`: `[w, h] = bbox_cells × cell_px`. The final icon canvas,
     always rectangular.
   - `gen_px`: `[w, h]` SDXL generation size — **same aspect as `target_px`**,
     area **≈1MP**, both dimensions **multiples of 64**. Downscaled (Lanczos)
     to `target_px` after generation. Standard values:
     - 1:1 (1×1, 2×2, L in a 2×2 bbox) → **[1024, 1024]**
     - 1:2 (1 wide × 2 tall) → **[704, 1408]**
   - `mask_cells`: **only for irregular (non-rectangular) shapes** — the owned
     cells to bias the subject into (e.g. `beast_jaw`'s 3 cells). Omit for
     rectangular 1×1 / 1×2 / 2×2 items.

Sanity check after editing: `target_px == bbox_cells × 256`, and `gen_px`
aspect equals `target_px` aspect. Then run the fit tooling; scoring is
geometry-only and always required.
