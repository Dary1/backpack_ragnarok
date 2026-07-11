# REQ-0127 — unit-icon-generation

**Status:** todo (user-cleared without further approval, 2026-07-12 chat)
**Reserved:** 2026-07-11
**Slug:** unit-icon-generation
**Reference:** `docs/llm_managed/unit_icon_pipeline.md` v1 (golden RATIFIED
2026-07-12)
**Ordering caveat:** the AI-raster route tools live on branch
`req-0073-item-icon-gen` until REQ-0109 merges — same operating caveat as
item icon batches; not a blocker (run from that branch as items do today).

## Goal

Implement the ratified Unit Icon pipeline end to end and run the first
roster batch up to the S7 user-review stop.

## Scope

1. **Tooling**: `gen_unit_icons` as a thin wrapper (or `--defs` mode) over
   `tools/gen_item_icons.py`; `gen_render` constant for 1×1 (target 256×256,
   gen 1024×1024, Lanczos downscale); ComfyUI route unchanged
   (JuggernautXL V9, 4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
   dpmpp_2m/karras, `setsid nohup` for long runs).
2. **Style guide**: unit style template per pipeline S2 (painterly
   dark-fantasy CHARACTER icon, stylization tokens front-loaded, near-white
   background, NOT photorealistic). Bust vs full-body: resolve via the
   bakeoff below before the main batch (pipeline open item 1).
3. **Bakeoff batch** (pattern: monsters-002-style-bakeoff): 2–3 units
   rendered bust AND full-body; user picks the roster-wide framing. This
   settles pipeline open item 1; record the ruling in this file and in the
   pipeline doc.
4. **First roster batch**: the user-authored roster seed list (elf, dwarf,
   thief, angel, shieldmaiden, priest, princess towers, light cavalry,
   berserker, necromancer, watcher, squire — final list at batch brief).
   Matte via rembg `birefnet-general` + edge-key fallback; matte quality
   shown in gallery; `--rematte-only` reruns.
5. **Scoring as FILTER only**: `tool_icon_score.py` auto-FAILs coverage
   < 20% (art_golden); it never picks winners — user gallery verdict selects
   (ratified golden deviation from the item route).
6. **Gallery**: `web/preview/units-NNN/` on backpack-dev, every candidate at
   256 px AND 64 px side by side (golden G4), numbered.
7. **STOP at S7**: user review; accepted numbers recorded in batch notes.
   Def authoring (connection shape, charge, effects, `i18n.ja`) stays OUT of
   this REQ (illustration-first: art precedes data; defs get their own REQ).

## Out of scope

- Client rendering of unit icons (REQ-0125).
- Backpack skins (REQ-0126 system; art has its own pipeline proposal).
- Unit def/content pipeline (future doc + REQ).

## Gates

- Bakeoff ruling recorded before main batch generation starts.
- Every shipped candidate passes coverage ≥ 20% and shows correctly in the
  256/64 px gallery.
- S7 stop honored: nothing enters `content/live/` in this REQ.
