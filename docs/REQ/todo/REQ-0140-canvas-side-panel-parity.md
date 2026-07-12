# REQ-0140 — canvas-side-panel-parity

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** canvas-side-panel-parity
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `web/redesign/canvas.html` (design mock "MJÖLNIR" v1.0),
client Canvas screen (`client/src/` board + ItemPanel).

## Goal

Close the largest design→implementation gap found in review: at 1280×800 the
live app's Canvas screen shows a bare board with a mostly unused right region
and the inventory pushed below the fold, while the ratified MJÖLNIR mock puts
an inventory panel (filter chips, rarity-tinted entries) plus a selected-item
detail card on the right. Port that right-panel composition into the app.

## Scope

- React panel: inventory list w/ filter chips (all / weapon / element / link /
  relic per mock), selected-entry detail card (icon, rarity, effect lines via
  the shared effect-text renderer, flavor, dex ref).
- Selection wiring both ways: board (Pixi) selection ⇄ panel highlight; drag
  from panel to board preserved.
- Empty states designed, not blank: zero-BP canvas and empty inventory get
  guidance copy (ties into REQ-0141).
- Engine consumed AS-IS (adapter only); `i18n.ja` for all new strings; keep
  1280×800 fully usable without vertical scroll on the canvas screen.

## Non-goals

No visual re-theme beyond MJÖLNIR tokens already in the app; no first-run tour
(REQ-0141); no BoardRenderer rework beyond what selection wiring needs.

## Gates

- e2e green via `pnpm run e2e` (box-lock discipline; never raw playwright).
- Side-by-side screenshot vs `web/redesign/canvas.html` at 1280×800 for user
  acceptance.
