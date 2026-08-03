> ART SUPERSEDED (REQ-0150, 2026-07-13): every image-generation detail below is dead --
> route / style / tools live in `art_pipeline.md`. NON-art content (schema, data model,
> review flow) still stands. The full original banner and text: git history.

# Unit Icon Generation Pipeline — v1 (RATIFIED by user, 2026-07-12)

> Companion to REQ-0125. Extends the REQ-0073 AI-raster route
> (verified end-to-end 2026-07-09; see `docs/llm_managed/item_content_pipeline.md`
> v2.1) to Unit character icons. Golden below ratified by the user 2026-07-12
> ("unit_icon_pipeline green"), including the revised G6 (skinnable identity).
> Authoritative copy: `docs/llm_managed/unit_icon_pipeline.md` on the server.
> v1.3 (2026-07-14, REQ-0128b/0129): §4.2 **RATIFIED** — the `unit/1` schema is no
> longer provisional. Connection semantics (occluder set = Units only; pierce = link
> every Unit in range; NO propagation) and the charge grammar are both frozen in
> `content/vocab.json` v13. `sockets` REMOVED from the schema → REQ-0163 (draft).
> `icon` is a free reference — the `icon-<id>` convention is dead. Ratified ≠
> implemented: there is still no `unit` validator kind and no live unit target.
> v1.2 (2026-07-14, REQ-0154; registry era): §4 added — unit artwork/data
> registry facets + the absorbed REQ-0130 def sketch (provisional at the time; see
> v1.3); shared contracts reference `common_content_pipeline.md` §7. Art stays
> superseded by `art_pipeline.md`.
> > v1.1 (2026-07-12, REQ-0134): §3 items 1–3 DECIDED (ratified via the
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
  JuggernautXL V9 workaround and applies only to the FROZEN `sdxl` route
  (historical reproduction only).
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

## 4. Registry era + Unit def pipeline (REQ-0154; absorbs REQ-0130)

> **Absorbs REQ-0130** (unit-def-content-pipeline; Q1 ruling 2026-07-13): its schema
> sketch, validation chain, live target and the REQ-0054/0061 rescued material are folded
> in here as the DEF side of this pipeline. REQ-0130 is closed as superseded and lives in
> `done/`.
>
> **RATIFIED 2026-07-14.** The provisional flag this section used to carry is **LIFTED**.
> Both blockers are closed: **REQ-0128b** (connection mechanics — `todo/`) and **REQ-0129**
> (charge grammar — `todo/`), shipped as `content/vocab.json` **v13**. The schema below is
> the ratified `unit/1`, not a sketch.
>
> **What is still NOT true, stated plainly:** there is no live `unit` target, no `unit`
> kind in `validateBody`, and no charge AST in the engine. **Ratified ≠ implemented.**
> Def authoring is REQ-0149's job and is blocked on REQ-0149's own OPEN content gaps — not
> on this schema.

### 4.1 Registry facets (shared contracts: spine §7)

- **Artwork facet** — `artworks.kind = unit`, **locked 512×512**
  (`server/services/art_sizing.cjs`; sizing gate G2). Upright forever (G3). The icon this
  pipeline produces is the unit's **DEFAULT SKIN** (G6), not a hard-wired asset.
  Inspection: `matte.coverage_band` (applies to po/si/**unit**), advisory, WARN-capped
  (`art_pipeline.md` §8). Seed/variant, adoption, export: spine §7.2–§7.4; the adopted
  unit render exports to `content/art/unit/<name>.png`.
- **Data facet** — `content_defs.kind = unit_def`. Variant-as-record; a `unit_def` variant
  runs the content-data registry machine checks (§4.3) + a separate-agent advisory review.
  **There is no live `unit` target yet** — `content/live/live_units.json` is the agreed
  target name and does NOT exist on master.

### 4.2 Schema `unit/1` — RATIFIED 2026-07-14

| field | notes |
|---|---|
| `id` | |
| `name` | |
| `rarity` | from `vocab.rarities` |
| `icon` | **a free reference — NOT derived from `id`.** The old `"icon-<id>"` 1:1 convention is **DEAD** (REQ-0149 G14: Princess and Little Princess are two defs sharing one artwork). The validator **must not** assert `icon == "icon-" + id`. Always 1×1. |
| `connection_shape` | a key of `vocab.connection_shapes`. Every ray shape is `{dirs, range, pierce}`; offset shapes (`chess_knight_move`, `shougi_keima_move`) are `{offsets}`. Semantics: **REQ-0128b**. |
| `charge` | `{trigger, gain, capacity, spend}` in the **REQ-0129** grammar (`vocab.charge`). |
| `effects` | AST, verbs from `vocab.verbs` (incl. `grant_charge`). |
| ~~`sockets`~~ | **REMOVED 2026-07-14 by user ruling.** The one-socket concept is demoted to **REQ-0163** (`draft/`, unratified). **No unit def may carry `sockets`** until REQ-0163 is ratified. |
| `flavor` | |
| `i18n.ja` | mandatory on every entry |

**Illustration-first:** a unit def may only be authored against S7-accepted art.

**The connection model in one line (REQ-0128b, ratified):** a ray is stopped **only by a
Unit** — BP and PO cells are transparent. `pierce: false` links the **first** Unit hit;
`pierce: true` links **every** Unit within range. `range: 0`/`null` = unlimited. `range`
and `pierce` are **invalid on offset shapes**. Connections are **canvas-local** (Squad
only). **There is NO propagation** — a link is a static graph edge, and a Unit never
relays. `PULSE_CAP`, the visited-set, the hop budget and hop latency are all **retired**;
**charge capacity is the only rate limit.**

**The charge model in one line (REQ-0129, frozen):** `spend` is **CLOSED at three** —
`fire_on_full` / `passive_per_stack` / `transform`. `gain` is `count` or `damage`.
Targets: `self`, `units_connected` (user-ratified) plus `bp_connected`,
`units_connected_distributed` (agent-defined under delegation). **Giving charge away is an
effect verb (`grant_charge`), not a spend mode** — and with propagation retired it is the
only way a chain is expressed.

### 4.3 Validation chain (mirrors the item pipeline)

Static validate (unit ALLOWED_KEYS, closed vocab) → engine integrate (occupies exactly
1 BP cell; connection-resolution smoke test) → preview gallery on backpack-dev → **STOP
for user review**. In the registry era these become the content-data registry checks:
`schema_vocab` / `engine_types` / `gen_data` / `integrate` on each `unit_def` variant.
`i18n.ja` mandatory; nothing enters a live target before green.

**Honest gap (unchanged by the ratification):** `validateBody` has **no `unit` kind**
(`item | si` only), and the engine has no charge AST or link walker. A first-class unit
validator is a **code REQ**, now unblocked by REQ-0128b/0129. Until it lands:

- `charge.triggers` deliberately sit **outside** the top-level `vocab.triggers` list —
  the REQ-0081 self-test demands a fixture per trigger, and a unit trigger cannot be
  rendered by one. That code REQ must graduate them and add the fixtures.
- `pulse` / `on_link_pulse` / `buff_linked` are **deprecated, not deleted**:
  `content/s4_boards/s4_fixture_items.json` and `tools/self_test_vocab.cjs` still use them.
  Removing them must re-baseline the S4 sim gate (REQ-0050).

### 4.4 Rescued design material — final disposition (2026-07-14)

- **Unit sockets** — **REMOVED from this schema; demoted to REQ-0163 (`draft/`).** The
  2026-07-06 「採用です」 was given for a *Linker*, which no longer exists, and has not been
  re-affirmed post-pivot. The three launch lenses (`hop_lens` / `dye_lens_burn` /
  `guard_lens`) are **dead** — every one was defined in terms of a pulse.
- **REQ-0061 8-type connective axis** (delay / divider / junction / toggle / terminal /
  amplifier / splitter / condenser) — **RETIRED (供養), user ruling 2026-07-14.** Each was a
  definition of *what a Unit does to a pulse passing through it*. With propagation retired
  they have no referent, and they are **not** re-derived as charge verbs. Roster identity
  comes from **charge + connection shape**.
- **Roster seed** — superseded by **REQ-0149** (`draft/`), which is the real home of the
  kits: **12 units** (not the 13 REQ-0130's gate text claimed — necromancer was cut,
  Watcher and Squire added), served by **11 S7-accepted icons**.

### Ratified generation route (REQ-0136, SDXL era) -- removed

Superseded by REQ-0150 flux2; removed by REQ-0358. Text: git history. Current route: `art_pipeline.md`.
