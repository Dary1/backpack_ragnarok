# Unit Icon Generation Pipeline — v1 (RATIFIED by user, 2026-07-12)

> Companion to REQ-0125. Extends the REQ-0073 AI-raster route
> (verified end-to-end 2026-07-09; see `docs/llm_managed/item_content_pipeline.md`
> v2) to Unit character icons. Golden below ratified by the user 2026-07-12
> ("unit_icon_pipeline green"), including the revised G6 (skinnable identity).
> Authoritative copy: `docs/llm_managed/unit_icon_pipeline.md` on the server.
> Open items in §3 remain undecided and are NOT covered by the ratification.

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
  `backpack_skin_pipeline_proposal.md`. This pipeline emits portrait rasters
  only and never bakes bag art into a unit icon.

## 2. Steps (delta from item pipeline v2 — everything unlisted is reused as-is)

- **S1 Brief.** Roster batch of 6–12 Units. Plain names for generation
  (art_golden rule: gorgeous names do not yield better art). One style guide
  per batch. Per-Unit one-line concept — the user-authored roster (elf,
  dwarf, thief, angel, shieldmaiden, priest, princess towers, light cavalry,
  berserker, necromancer, watcher, squire) is the seed list.
- **S2 Gen fields.** `gen_render` is constant (1×1: target 256×256, gen
  1024×1024, Lanczos downscale). `gen_prompt` from a Unit style template:
  painterly dark-fantasy CHARACTER icon, stylization tokens front-loaded
  (JuggernautXL V9 photorealism bias), near-white background for matting,
  NOT photorealistic. Bust vs full-body is fixed per roster, not per Unit
  (see Open items).
- **S3 Generate.** Same ComfyUI route: checkpoint
  `JuggernautXL_RunDiffusionPhoto2_V9_Final` at `127.0.0.1:8188` (manual
  start), 4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
  dpmpp_2m/karras, long runs via `setsid nohup`. Implementation: a thin
  `gen_unit_icons` wrapper (or a `--defs` pointing at Unit defs) over
  `tools/gen_item_icons.py`. NOTE: route tools live on branch
  `req-0073-item-icon-gen` until REQ-0109 merges — same caveat as items.
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

## 3. Open items (decisions wanted from the user)

1. **Bust vs full-body** — recommend one bakeoff batch (pattern:
   `monsters-002-style-bakeoff`) before freezing. My recommendation: bust,
   for 64 px readability (G4).
2. **Registry route** — raster (like items, recommended) vs SVG sprite
   registry (`sprite_all_v10.svg` world). Raster keeps one pipeline and the
   verified tooling.
3. **Charge-state overlay language** (ring? fill? frame glow?) — renderer
   design, belongs to REQ-0125 implementation, but the overlay vocabulary
   could be reserved here if you want it in the golden.
4. **Enemy side** — enemies have no backpacks (asymmetric combat, golden §4)
   and are OUT of scope; monster art keeps its own pipeline.
