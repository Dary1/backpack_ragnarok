# REQ-0227 — Dex card API + subwindow for unit / monster kinds

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: explicit REQ-0208 non-goal, now specced;
  needs user prioritization.

## Origin (REQ-0208 retrospective)
REQ-0208 gave units/monsters full catalog tabs + detail panes but declared
the dex card surface a non-goal: GET /api/dex/card/:kind/:id (REQ-0052)
still allowlists item/si/tm/pack only. On the Items grid every card carries
the "i" preview button (DexCardWindow -- the shareable, deep-linkable card);
unit/monster cards have nothing in that spot, a visible asymmetry the tabs
now expose.

## Problem
- No render-ready public card DTO exists for the two newest kinds, so
  nothing (market hovers, forecast tooltips, future chat/share links) can
  show a unit or monster card without re-implementing the detail pane.
- '#/dex/<unit|monster id>' deep links land on the right tab (REQ-0208) but
  cannot produce the compact card window the other kinds get.

## Proposal
- server/routes/dex.cjs: add 'unit' and 'monster' to KIND_TO_CONTENT_KEY
  (payload keys units/monsters -- both already served registry-first).
  DTO slices mirror the REQ-0208 detail panes: unit = names/rarity/icon/
  connection_shape/flavor; monster = names/rarity/hp/footprint/skills +
  the referenced monster_skills name entries riding along.
- client DexCardWindow: two new kind renderers reusing UnitCatalog/
  MonsterCatalog's detail building blocks (portrait well, connection row,
  stat rows) -- shared components, not copies.
- Catalog cards in both new tabs gain the same .dex-card-preview-btn the
  Items grid has.
- Dismantle overlay stays po/si-only (kinds are not dismantlable).

## Gates (when implemented)
- api tests: 200 + DTO shape for both kinds; 404 for unknown ids.
- e2e: preview button opens the card window from each new tab.
