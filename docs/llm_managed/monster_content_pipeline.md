
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
> > `gen_monster_art.py` IS ported — it runs flux2 and the SDXL graph is gone. The
> LoRA question is ANSWERED: dropped (they were generic style/detail boosters,
> not identity LoRAs). REQ-0137 must train its identity LoRA on FLUX.
>
> The NON-art content of this file (schema, data model, review flow) still stands.

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
