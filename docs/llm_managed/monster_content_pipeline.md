# Monster Content Pipeline

To be authored under **REQ-0111**.

**Route (binding, before this doc is written): `flux2`.** User decision
2026-07-13 (REQ-0150, "Flux2化"): one route for all image generation. Monster art
is the last SDXL island — `tools/gen_monster_art.py` still runs SDXL (30 steps,
cfg 7.0) with a **LoraLoader chain**, and SDXL-trained LoRAs do **not** load on
FLUX. Porting that tool, and answering the LoRA question in writing (port / drop
/ escalate), is scope of REQ-0150. **Do not author this doc around the SDXL
route.**

Common principles, stages, infrastructure, and REQ workflow: see `common_content_pipeline.md`.
