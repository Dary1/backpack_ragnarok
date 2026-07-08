# REQ-0004: Golden Review Round 1 — Verdicts Applied

- **Status**: Completed
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Request
User reviewed `second_golden.md` v0.1 section by section. Fold all verdicts into the
docs and answer: what format should the user's upcoming Canvas (backpack system) draft
take (PNG / mermaid / Google Spreadsheet)?

## Work Done
1. `second_golden.md` rewritten as **v0.2** with status tags (GREEN/HOLD/NEXT/CUT/TENTATIVE).
   Highlights: emotional beat 5 "The Unreplicable Self" added; multiple Backpacks
   (each with HP) inside one Canvas, cover/tanking between them; player-craftable
   Silhouettes; 4-unit sorties with flexible player fill and item-exclusive presets;
   offline-first + scheduled auto-runs; codex/loot-council/ghost-packs/special-rooms CUT;
   Market + Transmutator currency added [NEXT]; provisional glossary added pending the
   user's terminology pass.
2. Created `worldview_ragnarok_tentative.md` (Devotion/Einherjar/season-end Ragnarok,
   Pay-to-Kill monetization concept) — TENTATIVE, to be pulled out at Ragnarok
   implementation time.
3. Canvas draft format: recommended **spreadsheet workflow** (see below). MCP registry
   has no Google Sheets connector → user authors in Google Sheets, exports .xlsx (or
   CSV) into `docs/canvas/`. Orchestrator reads xlsx cell-level including fill colors.
   Fallback: Chrome tools can read a shared Sheet URL directly. Mermaid rejected
   (poor for spatial grids); PNG accepted only as supplementary mockups.

## Pending / Next
- User delivers Canvas system draft + terminology overhaul (next turn) → REQ-0005:
  canvas system spec consultation (incl. Linker system, Transmutator).
- Future action noted: inventory generation tools on ssh.qtie.jp for art-style experiments.
