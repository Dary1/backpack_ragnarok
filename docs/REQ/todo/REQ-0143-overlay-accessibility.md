# REQ-0143 — overlay-accessibility

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** overlay-accessibility
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` (BS-G1 overlays are
renderer-drawn and skin-independent; BS-G2 legibility floor — band width and
contrast budget OPEN), `docs/llm_managed/unit_icon_pipeline.md` (G4 64 px rule),
`docs/user_managed/game_golden.md` (Ragnarok Frame slow-mo).

## Goal

BS-G1 makes the renderer the single enforcement point for every gameplay
signal — use that. One accessibility pass over renderer overlays, plus the
measurement harness that settles BS-G2's open numbers.

## Scope

1. **Colorblind-safe palettes** for team/enemy tint, element tints, damage
   state, charge UI: validate under deuteranopia/protanopia/tritanopia
   simulation; never encode meaning in hue alone (add shape/pattern cues).
2. **Reduced-motion setting** covering the Ragnarok Frame slow-mo, beam
   animations, and charge pulses; honor it app-wide (`prefers-reduced-motion`
   as default seed, explicit toggle in Settings).
3. **Extend G4 discipline to overlays:** automated contrast measurement
   (relative-luminance delta) of overlay-on-skin composites at board scale
   (64 px/cell) across the skin validation shape suite. This harness EMITS the
   numeric recommendation for BS-G2's border band width (px at 256/cell) and
   fill contrast budget — the decision method the user ratified 2026-07-12;
   the final numbers remain a user ratification on this REQ's output.

## Non-goals

No skin-side changes (skins stay cosmetic-only); no full WCAG audit of menu
chrome (worthy, separate); no rebalance of art_golden coverage rules.

## Gates

- CVD simulation screenshots reviewed; palette passes hue-independence check.
- Settings toggle e2e (`pnpm run e2e`).
- Harness outputs BS-G2 numbers + gallery; user ratifies the numbers.
