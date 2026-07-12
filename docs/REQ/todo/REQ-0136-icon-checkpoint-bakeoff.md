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

No pipeline-doc rewrite until a winner is ratified; no live writes; matting
route comparison is REQ-0135 (run this bakeoff with the incumbent matte).

## Gates

- Numbered gallery; user verdict selects the default checkpoint.
- License verification recorded. Findings + winner appended here; pipeline docs
  updated as implementation of this REQ.

---

## WIP state (session end 2026-07-12 ~04:55; unattended completion running)

- Contenders + licenses VERIFIED: DreamShaperXL Turbo v2.1 (OpenRAIL++-M,
  HF Lykon) and FLUX.2 klein 4B distilled GGUF Q8_0 (Apache 2.0, BFL;
  9B is non-commercial - do not confuse) downloaded byte-verified;
  ComfyUI-GGUF installed. v9 leg 7/16 done + resume running; dsxl/flux
  legs queued behind it via ~/scratch/req_seq5.sh (waits for v9+0138,
  then dsxl -> flux -> galleries to web/preview/, all detached).
- Tooling committed here: tools/req0136_bakeoff.py (sequential legs,
  perf/VRAM stats, matte_light for unit busts - alpha_matting pymatting
  spikes >12GB RSS on characters and OOMed the shared box: dmesg 02:42,
  03:25 ComfyUI itself, 04:14, 04:33), tools/req0136_gallery.py,
  content/batches/bakeoff-0136/unit_defs.json.
- NEXT SESSION: check ~/scratch/req_seq5.log DONE; run
  ~/scratch/finalize_fill.py (renders findings tables from runstats
  JSONs + patches skin pipeline S2); commit artifacts; rsync
  web/preview/bakeoff-0136 into the main checkout docroot; verify URL;
  ASK USER VERDICT (checkpoint selection). Roster batch (REQ-0127) runs
  only after that verdict.
