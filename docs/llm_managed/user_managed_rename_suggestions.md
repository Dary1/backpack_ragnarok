# user_managed rename suggestions (REQ-0123 deliverable — USER applies these)

docs/user_managed/** is golden and user-edited only. Below are the concrete
edits the 2026-07-12 pivot implies. Apply, adapt, or reject freely.

## game_golden.md
- "Every pack speaks through a single Linker." → "Every pack speaks through
  a single Unit." (The metaphor gains its literal speaker.)
- Consider adding the session-agreed guardrail as a pillar note under P5:
  "A Unit is the vessel; strength always derives from the pack's contents
  and arrangement, never from the Unit alone."
- "bind pack to pack with directional Linkers" → "bind pack to pack through
  your Units' connection shapes".

## canvas_spec.md
- "Canvas — the full placement field of one Unit." → "…of one Squad."
- §BackPack Extra Function - Linker → retitle "Unit (ex-Linker)": a BP may
  contain one Unit or none; the Unit occupies exactly ONE cell; connection
  resolution = per-Unit Connection Shape (rays keep the first-hit rule,
  Unit-to-Unit, one-sided valid). Link effects section now points to the
  Unit roster + REQ-0128/0129/0130.
- "Preset — a saved Canvas configuration…" → "Squad — a saved Canvas
  configuration…" (same exclusivity sentence, word swapped).
- PO/Socket layers: unchanged.

## backpack_battle_spec.md
- `unit_canvas` → `squad_canvas`; "each unit owns a fixed 8x8 sub-grid" →
  "each squad owns…"; formations' `unit1..unit4` → `squad1..squad4`
  (formations 1–4 reused as-is otherwise, per your ruling).
- "party" phrasing (if any) → Troop (a Troop = 4 Squads).

## worldview_ragnarok_tentative.md
- Already character-based ("devoted character") — reads correctly post-pivot.
  Optional: "character" → "Unit" for consistency when you next touch it.

## formation.xlsx
- Sheet labels Unit1–Unit4 → Squad1–Squad4 (positions unchanged).

## Not suggested
- No changes to the Pay-to-Kill single-axis monetization ruling; skins remain
  capability-only/UGC (your 2026-07-12 ruling) and units/packs unaffected.
