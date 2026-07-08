# REQ-0007: Glossary Ratification Round 1 + First Golden Improvement Proposal

- **Status**: Completed (both docs awaiting user review)
- **Date**: 2026-07-02
- **Owner**: orchestrator

## User answers applied (glossary v0.1 → v0.2)
1. C8 Linker label = "0123" (sheet's "013" was a typo).
2. Receiver-less directions are intentional duds — legal design.
3. Linkers connect ONLY to Linkers; beams ignore everything else.
4. **One-Linker Rule**: every BP contains exactly one Linker (the giant-BP tradeoff).
   Intra-BP links impossible by definition.
5. Linker types/effects: on hold, to be designed together with the item system
   (items first, then Linker applications).
6. Transmutator also rerolls Direction Codes; can never change BP shape;
   direction-shuffle expected as the smallest-denomination operation.
7. "PB" was a typo for **BP**; renamed throughout. "BP = BackPack" re-proposed.
   "Silhouette" dropped.

## Deliverables
- `docs/glossary.md` v0.2 (full rewrite; PB→BP; core structural rules section;
  corrected decoded example).
- `docs/first_golden_improvement.md`: 9 identified gaps (multi-BP canvas invisibility,
  missing Linker layer, unstated size tradeoff, strength=canvas-only, unreplicable
  self, 4-unit caravan fantasy, Transmutator gamble, offline-first, reward wording)
  + revised First Golden v2 draft text.
- second_golden.md §0.5 and §4 updated to BP terminology.

## Next
- User reviews: (a) glossary v0.2 ("BP = BackPack" expansion), (b) First Golden v2 draft.
- Then: item system design begins (items first, Linker effects follow — per answer 5).
