# REQ-0135 — layerdiffuse-matting-spike

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** layerdiffuse-matting-spike
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-4 matte),
`docs/llm_managed/unit_icon_pipeline.md` (S4 matte quality concern).

## Goal

Evaluate replacing the post-hoc matte step (rembg `birefnet-general` + edge-key
fallback) with **LayerDiffuse latent transparency** — alpha generated AT diffusion
time instead of separated afterwards. Expected win: the failure mode the unit
pipeline itself flags (fine silhouettes — hair, weapon tips, wings) disappears,
because no background separation ever happens.

## Rationale (from review)

- rembg is a separation model guessing a boundary that diffusion already knew.
- LayerDiffuse (`huchenlei/ComfyUI-layerdiffuse`) patches SDXL to emit an alpha
  channel natively; works with the CURRENT checkpoint on the 8 GB card, so the
  cost of trying it is one spike, not a stack migration.
- Verified pain: `hilt` smoke-test matte coverage 10.99% (item pipeline
  verification log) and unit S4's explicit "matte quality is part of the review".

## Scope

- Install the LayerDiffuse custom node into the art ComfyUI. **CAUTION:**
  `~/ComfyUI` is the user's art-session infrastructure (PROJECT.md HANDS-OFF);
  obtain fresh user go-ahead for the install before touching it.
- Side-by-side: 4–6 subjects biased to worst cases (hilt, feather/wing, thin
  blade, unit hair) × {current route, LayerDiffuse route}, same seeds.
- Compare matte edges at 256 px AND 64 px; run `tool_fit_check.py` coverage on
  both; note VRAM/time overhead on the RTX 2080.

## Non-goals

No pipeline-doc rewrite yet; no `content/live/` writes; no checkpoint change
(that is REQ-0136).

## Gates

- Numbered side-by-side gallery under `web/preview/` for user verdict.
- Decision recorded here. If green: item/unit pipeline S4/S5-4 doc update and
  `gen_item_icons.py` route flag follow as the implementation of this REQ.
