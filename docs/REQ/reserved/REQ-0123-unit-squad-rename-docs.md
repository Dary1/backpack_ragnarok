# REQ-0123 — unit-squad-rename-docs

**Status:** todo (world-model pivot ratified by user in chat, 2026-07-12; user assigned execution to the orchestrator)
**Reserved:** 2026-07-11
**Slug:** unit-squad-rename-docs
**Blocks:** REQ-0124, REQ-0125
**Precedent:** REQ-0021 (terminology audit), REQ-0022 (terminology apply)

## Background — the world-model pivot (user decisions, 2026-07-12 chat)

The game moves from "backpacks with Linkers" to a unit-centric model:

- A **Unit** is a character piece (elf, dwarf, thief, ...) occupying exactly ONE
  cell of a BP — the former Linker's seat. The BP is the Unit's inventory.
- Units link **Unit-to-Unit** via per-unit connection shapes (bishop/rook/lance/
  queen rays, knight offsets, adjacency). Ray-type connections keep the
  **first-hit rule** (formerly "first-hit linker"). One-sided links are valid.
- The old canvas-owning entity ("Unit" in battle spec / formations) becomes
  **Squad**. Squad absorbs **Preset**: Squad = a saved, deployable canvas
  configuration, inheriting the one-item-cannot-be-in-two-deployed-presets
  exclusivity. formation1–4 in backpack_battle_spec are reused as-is; their
  "unitN" slots become Squads.
- **Party** (4 canvas entities) becomes **Troop** (4 Squads).
- NOTE: restricting connection patterns (from always-queen 8-dir beams to
  per-unit shapes) is a mechanics change INDEPENDENT of this rename (user
  ruling 2026-07-12: "旧システムのリンカーでも発生しえた仕様変更"). It is NOT
  part of this REQ and lands in its own future REQ.

## Canonical rename map (ratified)

| Old | New | Notes |
|---|---|---|
| Unit (canvas owner / formation slot / unit_canvas) | Squad | battle-spec sense |
| Preset | Squad | concepts merged; the word "preset" is retired |
| Party | Troop | a Troop = 4 Squads |
| Linker | Unit | character piece; occupies exactly 1 BP cell |
| BP Link | Unit Link | first-hit rule preserved; Unit-to-Unit; one-sided valid |
| Canvas | Canvas | unchanged; UI surfaces are "Squad Editor" / "Squad Layout" |
| Inventory | Inventory | unchanged |

Derived terms PROPOSED during execution (flag for user ratification, never
invent silently): "Connection Shape" (the per-unit pattern), "Connection Ray"
(ray-type link beam).

## Scope

In scope:
- `docs/llm_managed/**` — full conversion to the new vocabulary.
- `docs/REQ/{reserved,draft,todo,built}/**` — live REQs only; update wording
  where the old vocabulary would mislead future work.
- New `docs/llm_managed/terminology_unit_squad.md` — the map above as the
  glossary of record, plus a note that `docs/REQ/done/**` and anything dated
  before 2026-07-12 uses the old vocabulary.

Out of scope:
- `docs/user_managed/**` — golden, user-edited only. Instead deliver
  `docs/llm_managed/user_managed_rename_suggestions.md` with concrete
  suggested edits for game_golden.md, canvas_spec.md, backpack_battle_spec.md,
  worldview_ragnarok_tentative.md, and formation.xlsx labels.
- `docs/REQ/done/**` — history is never rewritten.
- Source code / i18n / content registry → REQ-0124.
- Icon & art changes → REQ-0125.

## Method

1. Build an occurrence inventory (grep per file). "unit" is sense-ambiguous
   (old canvas-owner vs new character piece) — classify every hit before
   touching anything.
2. Two-phase rename to avoid the swap hazard:
   - **Phase A:** unit(old sense)→squad, preset→squad, party→troop. Commit.
   - **Phase B:** only after A is fully committed: linker→unit.
   Never both in one pass.
3. Historical quotes and decision logs inside live REQs keep their original
   wording, annotated "(pre-rename terminology)".

## Acceptance gates

- grep gate: zero old-sense occurrences of preset/party/linker in
  `docs/llm_managed` + live REQ folders, excluding the glossary, the
  suggestions file, and annotated historical quotes.
- Every remaining "unit" occurrence verifiably means the NEW sense.
- `terminology_unit_squad.md` and `user_managed_rename_suggestions.md` exist.
- Proposed derived terms ratified (or replaced) by the user.
