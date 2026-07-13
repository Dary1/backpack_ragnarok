# Monster Content Pipeline — v1.0 (2026-07-14, REQ-0154)

> **Scope**: enemies (flat tunable defs), their skills, formations and dungeon
> encounter sequences, and monster illustration art. Shared principles, infra,
> vocab, build, the registry-era operating model and all shared contracts
> (seed/variant, adoption, export, advisory-inspection, dependency map, promotion):
> see `common_content_pipeline.md` §6–§9. Art route/style: `art_pipeline.md`.
> PO/SI: `item_content_pipeline.md`. TM: `tm_content_pipeline.md`. Units:
> `unit_icon_pipeline.md`.
>
> **Absorbs REQ-0111** (monster-content-pipeline-doc, draft; Q1 ruling 2026-07-13):
> the placeholder stub and REQ-0111's intent (enemies / dungeon encounters /
> monster art; real precedents; honest "no dedicated validator" note) are folded in
> here; REQ-0111 is closed with a supersession note and moved to `done/`.
>
> **ART is superseded by `art_pipeline.md`.** `tools/gen_monster_art.py` **IS
> ported to flux2** (REQ-0150) — it imports the one route and uses the **Concept Art
> (Fantasy)** template; the old SDXL/LoRA route is FROZEN (`--route sdxl`, historical
> `monsters-001`/`monsters-002` reproduction only). Do not follow any SDXL/Norse
> painterly guidance for monsters.

## 0. What a monster/enemy is (and is not)

- Enemies are the game's **flat, tunable combat defs** (schema `enemy/1`). They
  fight in dungeons; **asymmetric combat — enemies have NO backpacks** (game golden
  §4), so a monster never enters the BP placement engine and has no sockets/ports.
- A monster has a **`footprint` `[w,h]`** (its dungeon-grid size), not a polyomino
  cell shape. Illustration-first still applies (`common_content_pipeline.md` §2):
  the art is approved before stats are tuned.
- Enemy content lives under **`content/live/dungeon/`**, loaded by
  **`server/services/core.cjs`** (`ENEMIES_PATH` → `enemyDefsById`):
  `enemies.json` (`enemy/1`), `skills.json` (`skill/1`), `formations.json`
  (`formation/1`, matching `sim/combat.cjs`'s FORMATIONS table byte-for-byte),
  `dungeon.json` (`dungeon/1`), plus `entities.json` / `items.json`.

## 1. Registry facets (REQ-0154)

One monster `system_name` has two facets — see the spine §7 for all shared contracts:
- **Artwork facet** — `artworks.kind = monster`. Shape input is a **numeric w×h grid
  (each 1..12)**; resolution derives at **128 px/cell, /16-snap**
  (`server/services/art_sizing.cjs`): goblin 3×4 → 384×512, chimera 6×4 → 768×512,
  ancient dragon 10×10 → 1280×1280 (REQ-0151 ruling 1, sizing gate G2). Style: the
  **Concept Art (Fantasy)** template (`art_pipeline.md` §3/§5).
- **Data facet** — `content_defs.kind = monster_def`. Variant-as-record; seed/variant
  policy, adoption (human-only, adopted-undeletable), export: spine §7.2–§7.4. The
  adopted monster render exports to `content/art/monster/<name>.png`.

## 2. Data model (as built)

`content/live/dungeon/enemies.json` → `{ "schema": "enemy/1", "batch": …,
"entries": [ … ] }`. Per entry (live exemplars, batch-002-dungeon-pilot):

| field | rule |
| --- | --- |
| `id` | snake/lower, unique across enemies |
| `name` / `i18n` | EN + `i18n.ja` REQUIRED (`i18n.en`/`i18n.ja` `{name}`) |
| `hp` | `[lo, hi]` integer range |
| `footprint` | `[w, h]` dungeon-grid size (drives the artwork w×h grid) |
| `skills` | array of `skill/1` ids (defined in `skills.json`) |
| `rarity` | e.g. `common` (enemy rarity vocabulary) |
| `pack_role` | e.g. `line` (encounter role) |

Companions: `skills.json` (`skill/1` — **reuses EXISTING `vocab.json` verbs/statuses
only**; attack profiles vary edge/direction/penetration/aoe), `formations.json`
(the 4 ratified formation defs), `dungeon.json` (`dungeon/1` encounter theme +
sequence).

**Honest gap (carried from REQ-0111):** there is **no dedicated enemy schema
validator** — `shared/content_validate.cjs` `validateBody` accepts `kind` =
`item | si` ONLY. Enemy defs were historically **hand-checked against
`content/vocab.json` + prior batches**. In the registry era the **content-data
registry** now provides machine checks for `monster_def` variants (§3), but a
first-class `enemy` validator kind remains a future code REQ (own it where first
needed; do NOT bolt it on inside a content batch).

## 3. Machine checks & inspection (all advisory — spine §7.5)

- **Data (content-data registry, REQ-0155):** a `monster_def` variant runs
  `schema_vocab` (self_test_vocab conventions vs `schema_ref`) + `engine_types`
  (check_engine_types conventions) + `gen_data` (in-process eff_render/serialize
  convention — monsters are not consumed by `tool_gen_data`) + `integrate`
  (**`applicable:false`** — monsters have no canvas placement). Then a separate-agent
  advisory review with mandatory rationale.
- **Artwork (inspection kits, REQ-0152):** `monster.render_sanity` v1 — the ONLY
  monster kit (monsters had zero inspection before). Metrics `image_alpha_coverage`
  (non-white subject fraction), `white_bg_fraction`, `subject_bbox_fill`; thresholds
  **[S7]** (content 0.02–0.92, white_bg ≥ 0.05) pending user ratification. Advisory,
  WARN-capped, never gates adoption. Note: monster renders are **not matted** (no
  transparency step); `render_sanity` measures the white-background render directly.

## 4. Pipeline (registry era + the underlying CLI)

The spine §6.1 flow applies. For monsters concretely:
1. **Brief** — theme/family, roster, per-enemy `footprint`, formation + dungeon
   placement, rarity/pack_role budget. Precedents: `content/batches/batch-002-dungeon-pilot/`,
   `monsters-002`, `monsters-003-flux2/` (`jobs.json` job-list + `candidates/`);
   proposal galleries under `content/proposals/monsters-00N/`.
2. **Art** — the artwork registry (generate w×h-grid renders on flux2, kits auto-run,
   human adopts) OR the CLI `tools/gen_monster_art.py` (job-list driven). Concept Art
   (Fantasy) style; illustration-first.
3. **Data** — author `monster_def` variants (enemy/1 + skills/formation/dungeon);
   machine checks + advisory agent review in the content-data registry.
4. **Preview** — `tools/build_dungeon_preview.py` builds the encounter preview to
   `web/preview/…` on backpack-dev.
5. **STOP (S7)** — user review; nothing enters `content/live/dungeon/` before green.
6. **Merge/export** — adopted render + adopted def export (spine §7.4); the
   git-branch/live-merge half is the deploy step.

## 5. Open items (tracked; do not solve in a content batch)

- A first-class `enemy` validator kind in `shared/content_validate.cjs` — future code
  REQ; until then §3's generic content-data checks + hand review.
- No artwork-registry monster→canvas wiring is needed (enemies are dungeon-side, not
  BP-placed); monster art serves via the registry API / export like other kinds.
