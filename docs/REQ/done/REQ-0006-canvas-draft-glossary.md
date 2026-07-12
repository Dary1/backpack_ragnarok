# REQ-0006: Canvas Draft (PBSystem.xlsx) Analysis & Glossary v0.1

- **Status**: Completed (glossary awaiting user ratification)
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Request
User delivered `docs/PBSystem.xlsx` (sheet "PBとPBLinker"). From the orchestrator's own
reading, revise and solidify the glossary.

## Work Done
1. Parsed the xlsx programmatically (values + fill colors): 10×10 canvas with six
   color-coded Backpacks, Dead Space, Linker labels with direction digits, beam arrows,
   and 11 explanation notes (A13–A23).
2. Extracted system rules: backpack pieces; placement objects confined to one backpack;
   size ≠ strength; PB Linker direction codes (0=up, clockwise); beam reception;
   first-hit interception; mutual links; cover interplay; Transmutator randomizes
   Linker position/type; Linkers occupy slots; Backpack-Hero-style object conventions.
3. Wrote `docs/glossary.md` v0.1 — canonical term set (Canvas / Backpack (PB) / Piece /
   Dead Space / Placement Object / PB Linker / Direction Code / Link Beam / Link /
   Interception / Mutual Link / Cover / Transmutator / Unit / Sortie / Preset), decoded
   example map, and 7 open questions (incl. two draft inconsistencies: C8 "013" vs
   row-8 right arrows; F2's receiver-less direction 0).
4. second_golden.md §0.5 now points to glossary.md.

## Next
- User ratifies/corrects glossary v0.1 (esp. the 7 [?] items) → glossary v1.0.
- Pending from user: Link effect spec (what a Link does), Linker type list.
- Orchestrator owes: First Golden improvement proposals (user requested; deliver next).
