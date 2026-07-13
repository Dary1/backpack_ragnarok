
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
> > REQ-0127's roster (S7 ALL GREEN) is **superseded**: it is Norse painterly and
> the direction is now anime. It is regenerated, not reused. Framing note: gear
> nouns ("dagger", "belts", "leather armor") widen the shot out of a bust even
> with `portrait` present — name the character, not the kit (`art_pipeline.md` §5).
>
> The NON-art content of this file (schema, data model, review flow) still stands.

# Unit Icon Generation Pipeline — v1 (RATIFIED by user, 2026-07-12)

> Companion to REQ-0125. Extends the REQ-0073 AI-raster route
> (verified end-to-end 2026-07-09; see `docs/llm_managed/item_content_pipeline.md`
> v2.1) to Unit character icons. Golden below ratified by the user 2026-07-12
> ("unit_icon_pipeline green"), including the revised G6 (skinnable identity).
> Authoritative copy: `docs/llm_managed/unit_icon_pipeline.md` on the server.
> v1.1 (2026-07-12, REQ-0134): §3 items 1–3 DECIDED (ratified via the
> 2026-07-12 review session, user verdict ALL GREEN); G7 reserved in §1;
> stale filename fixed (backpack_skin_pipeline_proposal.md, renamed →
> backpack_skin_pipeline.md). `art_golden` references resolve to
> `common_content_pipeline.md` §2 (art_golden.md abolished as a separate doc
> by user directive, 2026-07-12). Item 4 of §3 stays as recorded.

## 0. What a Unit icon is

- A Unit occupies exactly ONE BP cell, so every Unit icon is shape 1×1,
  aspect 1:1, `target_px` 256×256, `gen_px` 1024×1024 — the already-verified
  1×1 row of the item pipeline table. No other geometry exists in this
  pipeline.
- The icon is the character's identity (face + silhouette). It is NOT a
  gameplay diagram: it is what the player becomes attached to when the Unit
  drops, fights, and is Devoted.

## 1. Unit Icon Golden (RATIFIED 2026-07-12)

- **G1 — art_golden applies unchanged.** Coverage ≥ 20% per owned cell
  (`tool_fit_check.py` CHECK), aspect ratio inviolable, illustration-first:
  the icon exists and is approved BEFORE the Unit's stats, connection shape,
  or charge data are authored.
- **G2 — No gameplay state in art.** Connection shapes, charge progress,
  link rays, team/enemy tint are renderer overlays. An icon containing an
  arrow, gauge, or beam is a FAIL regardless of beauty.
- **G3 — Upright forever.** Unit art is never rotated by any fixer, build
  step, or renderer. Directional data (lance-forward etc.) rotates as data;
  the character stays upright.
- **G4 — Cell-size readability.** The silhouette must be identifiable at
  64 px (one board cell). Proposal galleries show every candidate at 256 px
  AND 64 px side by side; unreadable at 64 px = FAIL.
- **G5 — Roster coherence.** All Units share one style token block
  (`style_guide.md` per batch). A character that does not sit in the roster
  lineup is a FAIL even if beautiful alone.
- **G6 — Skinnable identity (revised per user, 2026-07-12).** The icon this
  pipeline produces is the Unit's DEFAULT SKIN, not a hard-wired asset:
  sprite resolution must treat unit icons as swappable skins (REQ-0125's
  fallback chain generalizes into skin resolution). Unit Skins pair with
  Backpack Skins as a SET (elf unit + elven bag; barbarian unit + barbarian
  bag). Bag theming — the BP's EDGE DESIGN PATTERN, itself replaceable — is
  a separate asset class with its own pipeline: see
  `backpack_skin_pipeline.md`. This pipeline emits portrait rasters
  only and never bakes bag art into a unit icon.

- **G7 — Charge overlay language (reserved 2026-07-12).** The Unit
  charge-state overlay is a **ring fill** (radial progress around the icon),
  renderer-drawn per G2 and identical across all skins. Reserved here so no
  icon bakes in ring-like framing that would collide with it; implementation
  belongs to REQ-0125. (Ratified via 2026-07-12 review, ALL GREEN.)

## 2. Steps (delta from item pipeline v2 — everything unlisted is reused as-is)

- **S1 Brief.** Roster batch of 6–12 Units. Plain names for generation
  (art_golden rule: gorgeous names do not yield better art). One style guide
  per batch. Per-Unit one-line concept — the user-authored roster (elf,
  dwarf, thief, angel, shieldmaiden, priest, princess towers, light cavalry,
  berserker, necromancer, watcher, squire) is the seed list. **UPDATE
  2026-07-13 (REQ-0127 S7): necromancer was CUT as a unit by the user; the
  shipped roster is the remaining 11.**
- **S2 Gen fields.** `gen_render` is constant (1×1: target 256×256, gen
  1024×1024, Lanczos downscale). `gen_prompt` from a Unit style template:
  painterly dark-fantasy CHARACTER icon, near-white background for matting.
  Bust framing, roster-wide (§3 item 1). **On the ratified flux2 route the
  NEGATIVE PROMPT IS INACTIVE (cfg 1.0) — steer style from the POSITIVE.**
  Front-loading stylization tokens against a photorealism bias was a
  JuggernautXL V9 workaround and applies only to the `sdxl` fallback route.
- **S3 Generate.** Same ComfyUI route as items, on the **ratified `flux2`
  route** (REQ-0136, user verdict 2026-07-12, reconfirmed 2026-07-13):
  `flux-2-klein-4b-Q8_0.gguf` at `127.0.0.1:8188` (manual start), 4 candidates,
  seeds 101/202/303/404, **4 steps, cfg 1.0, euler**. `--route sdxl` still
  exists but is **FROZEN — historical reproduction only, not a production route**
  (REQ-0150, user 2026-07-13: one route, flux2). Long runs via
  `setsid nohup`; **stop ComfyUI before the matte phase** (rembg ~12 GB will not
  fit beside a resident model on the 23 GB box — use `--no-matte` then
  `--rematte-only`). Implementation: `tools/gen_unit_icons.py`, a thin wrapper
  over `tools/gen_item_icons.py`. (The old "route tools live on branch
  req-0073-item-icon-gen" caveat is OBSOLETE: merged via REQ-0109.)
- **S4 Matte.** rembg `birefnet-general` + edge-key fallback, valid band
  2–90%. Characters have finer silhouettes than items (hair, weapon tips,
  wings) — matte quality is explicitly part of the review gallery;
  fail → `--rematte-only` rerun.
- **S5 Score & filter.** `tool_icon_score.py` geometry scoring FILTERS ONLY
  (coverage < 20% = auto-FAIL). It does NOT pick the winner. For characters
  the user's gallery verdict is the selection — a deliberate deviation from
  the item route, per art_golden illustration-first rule 2 (user evaluates
  via numbered galleries and returns accepted numbers).
- **S6 Preview.** Gallery to `web/preview/units-NNN/` on backpack-dev, each
  candidate at 256 px and 64 px (G4), numbered.
- **S7 STOP — user review.** Accepted numbers recorded in the batch notes.
  Only after acceptance may Unit defs (connection shape, charge trigger,
  effects, `i18n.ja`) be authored against the approved art
  (illustration-first). Def authoring itself is a separate, future pipeline
  doc — out of scope here.

## 3. Open items — Decision log (updated 2026-07-12)

All decisions below were ratified 2026-07-12 (review session, user verdict
ALL GREEN) unless noted.

1. **Bust vs full-body — DECIDED: bust** for the 1×1 board icon (G4 64 px
   readability wins). Full-body art of the same character is permitted as a
   SEPARATE dex/splash asset sharing one identity (see REQ-0137
   character-identity-lora); it is never the board icon.
2. **Registry route — DECIDED: raster** (like items — one pipeline, the
   verified tooling). This also resolves the route half of REQ-0133's open
   user decision (units and items decided together).
3. **Charge-state overlay language — DECIDED: ring fill**, reserved as G7 in
   §1; renderer implementation stays with REQ-0125.
4. **Enemy side** — unchanged: enemies have no backpacks (asymmetric combat,
   golden §4) and are OUT of scope; monster art keeps its own pipeline.

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

The `sdxl` route (JuggernautXL V9, 30 steps, cfg 6.5, dpmpp_2m/karras) is kept
working for fallback and for reproducing historical batches:
`gen_item_icons.py --route sdxl`.
