# REQ-0003: Derive Expanded Golden from first_golden.md

- **Status**: Completed (awaiting user review of the derived golden)
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Request
User placed `docs/first_golden.md` (one-paragraph concept). Orchestrator derives an
expanded golden through its own reasoning, boldly; user will review everything.
Docs in English; Japanese version output in chat.

## Work Done
- Analyzed first golden. Extracted core promises: (1) build the backpack itself,
  (2) puzzle arrangement → synergy combos, (3) the visible "moment of the strike",
  (4) co-op dungeon conquest, (5) expansions/items as rewards, (6) never-before-seen
  combo discovery.
- Wrote `docs/second_golden.md` (v0.1) with pillars, core loop, backpack/cell system,
  4-layer synergy model, combat staging, co-op (Caravan Seam), Norse post-Ragnarok
  setting, scope tiers T0–T3, tech direction, and 5 open questions.
- Key bold derivations, each marked [DERIVED] and individually revertible:
  backpack-as-HP, buildable backpack from typed cells, hidden constellation recipes
  with world-first name engraving, enemy backpacks (inspect & loot), cross-player
  backpack docking (Caravan Seam), weekly Ragnarok Sieges.

## Next Actions
- User reviews second_golden.md → apply verdicts → freeze golden v1.0.
- Then draft REQ-0004: T0 vertical-slice technical spec (stack decision incl. React/Pixi).
