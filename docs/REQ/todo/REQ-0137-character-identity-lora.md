# REQ-0137 — character-identity-lora

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** character-identity-lora
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/unit_icon_pipeline.md` (G5 roster coherence,
G6 skinnable identity), `docs/llm_managed/backpack_skin_pipeline.md` (BS-G3 sets).

## Goal

Shared style tokens alone are a weak guarantee of character identity (2026
review finding). Build the identity pipeline: from ONE approved unit icon,
derive a reusable character identity so the same character can be re-rendered
consistently — themed skin variants (elf unit + elven set), bust icon AND
full-body dex/splash art as two assets of one identity.

## Approach (current SOTA)

approved icon → edit-model-generated variation/multi-view dataset
(Qwen-Image-Edit-class or FLUX-Kontext-class; hosted API permissible for the
dataset step if license/cost clear — decision point for the user) → train a
per-character (or per-roster-style) SDXL LoRA locally (kohya-class tooling fits
8 GB) → generate variants with identity locked.

## Scope

- Pilot with 1 approved unit character (after the first unit roster gallery).
- Validate identity retention across 4+ poses/outfits in a numbered gallery,
  each at 256 px + 64 px (G4).
- Document VRAM/time and the exact dataset recipe; fold into
  `unit_icon_pipeline.md` as implementation of this REQ.

## Non-goals

No roster production, no def authoring, no skin-set production (REQ-0126/0131
own the skin system); no checkpoint decision (REQ-0136).

## Gates

- User gallery verdict on identity retention.
- Recipe reproducible end-to-end on the server GPU (or documented hosted-API
  step with license note); findings appended here.


---

## Preparation findings (2026-07-12, session batch REQ-0136/0138/0131/0127/0137)

### Dataset step — edit-model selection (input to the user decision point)

- **Local option now exists and is preferred by default: FLUX.2 klein 4B**
  (Black Forest Labs). Verified 2026-07-12: **Apache 2.0** ("open weights
  available for commercial use" — model card), unifies text-to-image AND
  **multi-reference image editing** in one 4B checkpoint; GGUF Q8_0
  (4.3 GB, unsloth/FLUX.2-klein-4B-GGUF, ComfyUI-GGUF loader) is installed
  on llmlocal for the REQ-0136 bakeoff and runs on the RTX 2080 8 GB.
  This is exactly the "FLUX-Kontext-class" slot in the Approach section —
  license and cost are clear, and no hosted API is required.
- The user decision point therefore narrows to: **local klein 4B (default)
  vs a hosted Qwen-Image-Edit-class API (only if local edit quality proves
  insufficient on the pilot)**. Edit-mode smoke test on a real icon is the
  first pilot step (blocked, see below).

### Trainer — kohya sd-scripts, SDXL LoRA on 8 GB (recipe)

Feasible per current guidance (kohya-ss/sd-scripts discussions + 2026
low-VRAM guides): `train_network.py` (SDXL), batch_size 1,
`gradient_checkpointing`, `cache_latents` (+ cache to disk),
`optimizer AdamW8bit` (bitsandbytes), fp16 mixed precision, fused backward
pass (sd-scripts >= 0.9.0), `network_dim` 16–32, train res 1024 (bucket
768–1024). Expected wall time on the RTX 2080 for a 20–40 image identity
set: single-digit hours. Trainer install is deliberately deferred to the
pilot (no speculative env on the box; ~scratch discipline).

### Dataset recipe (to validate in the pilot)

1. ONE approved unit icon (256 px master + its 1024 px raw) as reference.
2. klein 4B edit mode, multi-reference: prompt matrix over pose (front
   bust, 3/4 bust, profile, action), outfit variant (default, themed-set),
   framing (bust master + full-body dex/splash) -> 16–24 candidates.
3. Manual cull to 12–20 keepers; captions from a fixed template
   (`<name>, <pose>, <outfit>, painterly dark-fantasy character` +
   roster style block).
4. LoRA train (recipe above); validate identity retention: numbered
   gallery, 4+ poses/outfits, each at 256 px + 64 px (G4), user verdict.

### Status

- **Pilot BLOCKED** on the first approved unit icon (REQ-0127 S7 gallery
  verdict; REQ-0127 main batch itself waits on the REQ-0136 checkpoint
  verdict). No GPU work performed under this REQ yet.
- Checkpoint interaction: if REQ-0136 ratifies a non-SDXL default (e.g.
  klein), the LoRA target family follows the ratified UNIT checkpoint —
  kohya supports SDXL today; FLUX-family LoRA via sd-scripts' flux branch
  tooling would need its own feasibility pass. Recorded as an open pilot
  question, NOT a blocker for the dataset step.
