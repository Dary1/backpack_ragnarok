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

## Obsolescence note (2026-07-14, user ruling)
User ruling (orchestrator session, 2026-07-14): the LoRA route is no longer used —
the pipeline adopted FLUX2 (REQ-0150) and the identity-LoRA approach is considered
obsolete. Moved todo -> draft as a retirement candidate; formal retirement (or a
FLUX2-native identity re-spec) is a future user decision.
