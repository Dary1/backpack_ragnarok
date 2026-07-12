# Terminology — Unit / Squad / Troop (glossary of record)

Produced by REQ-0123 (world-model pivot ratified in chat, 2026-07-12).
This file is the authoritative rename map. Anything dated before 2026-07-12
(docs/REQ/done/**, docs/llm_managed/recovered_from_server/**, git history)
uses the OLD vocabulary and is never rewritten.

## Canonical map

| Old term | New term | Meaning after the pivot |
|---|---|---|
| Unit (canvas owner / formation slot / unit_canvas) | **Squad** | one 8×8 canvas entity on the shared battle field |
| Preset | **Squad** | concepts merged: a Squad IS a saved, deployable canvas configuration (inherits the one-item-one-deployed exclusivity) |
| Party (4 canvas entities) | **Troop** | a Troop = 4 Squads |
| Linker | **Unit** | character piece (elf, dwarf, …) occupying exactly ONE cell of a BP; the BP is the Unit's inventory |
| BP Link | **Unit Link** | Unit-to-Unit; ray types keep the first-hit rule; one-sided links valid |
| Canvas | Canvas | unchanged; UI surfaces: "Squad Editor" / "Squad Layout" |
| Inventory | Inventory | unchanged |
| enemy unit | enemy entity | renamed to avoid colliding with the new Unit sense (enemies have no canvases/Units) |

Derived terms in use (proposed by orchestrator, accepted in session):
**Connection Shape** (a Unit's pattern: bishop/rook/lance/queen/knight/adjacency),
**Connection Ray** (ray-type link beam).

## Deliberate legacy survivals (NOT rename failures)

- Serialized state field names and slot-key values in sources
  (`st.presets.{active,store}`, `'unit1'…'unit4'`, replay event fields) stay
  legacy for determinism/back-compat — owned and ledgered by REQ-0124.
- `docs/REQ/done/**` and `recovered_from_server/**` are history; untouched.
- Verbatim user quotes inside live REQs keep original wording under the
  per-file terminology-update header.
- The 13 user-authored roster kits and future unit content are authored in
  the NEW vocabulary only.
