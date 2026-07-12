# REQ-0136 — icon-checkpoint-bakeoff

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** icon-checkpoint-bakeoff
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-2),
`docs/llm_managed/unit_icon_pipeline.md` (S2); pattern: `monsters-002-style-bakeoff`.

## Goal

Stop paying the "NOT photorealistic" tax. JuggernautXL V9 is a photoreal-biased
checkpoint being prompt-corrected toward painterly output on every generation —
a structural mismatch that caps the style ceiling. Run ONE bakeoff batch to pick
the default icon checkpoint on merit.

## Contenders

1. Baseline: JuggernautXL V9 + current anti-photoreal prompting (control).
2. A stylized SDXL checkpoint (painterly/fantasy-native), optionally + style LoRA.
3. FLUX.2 klein 4B, GGUF-quantized — reported to run within 8 GB VRAM at
   few-step speed (2026 low-VRAM guides). Verify locally before judging.

## Scope

- Same subjects across all contenders (2 items + 2 unit busts), same
  candidates/seed discipline as the item route; gallery at 256 px AND 64 px.
- Record VRAM headroom and s/image on the RTX 2080 for each contender.
- **License gate:** verify commercial-use terms of any new checkpoint BEFORE
  adoption; record the finding here. No adoption on unclear terms.

## Non-goals

No pipeline-doc rewrite until a winner is ratified; no live writes. **Run this
bakeoff with the incumbent matte (rembg birefnet-general + edge-key) — that is
now permanent, not provisional: REQ-0135b returned NO-GO on LayerDiffuse
(2026-07-12) and the node has been removed.** The only live matte question left
is REQ-0147 (background-clause A/B), which is a prompt change, not a route
change, and does not gate this bakeoff.

## Gates

- Numbered gallery; user verdict selects the default checkpoint.
- License verification recorded. Findings + winner appended here; pipeline docs
  updated as implementation of this REQ.
