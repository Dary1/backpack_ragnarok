# REQ-0216 - artadmin: true-scale po thumbnails (constant px per cell)

**Reserved:** 2026-07-17
**Slug:** artadmin-thumb-true-scale

## Problem

The REQ-0191 cell backdrop draws each po render over its footprint, but the
gallery thumbnail normalizes every footprint into one fixed cap
(`.aa-cb--thumb { max-width:212px; max-height:150px }` over
`widthPx = cols * 256`). The on-screen size of ONE game cell therefore varies
inversely with the footprint: a 1x1 item shows a ~150px cell, a 4x2 item a
~53px cell. A 1x1 sword and a 2x2 shield look the same size in the gallery,
which contradicts the "cell = fixed game-grid unit" intuition the backdrop
exists to build.

## Decision (user, 2026-07-17)

Prioritize REAL-SIZE intuition over uniform card layout (option a of the two
proposed): thumbnails render at a CONSTANT px-per-cell, so a 1x1 render is
visibly small and a 5x2 render visibly wide, at the same scale on every card.
Cell-count badges (option b) were rejected.

## Spec

- `THUMB_CELL_PX = 42`, a module constant in `client/src/artadmin/Workspace.tsx`.
  Why 42: the po mask is 5x5 max (artShared.emptyMask), and the card thumb
  well is 212px wide (230px card - 2*8 padding - 2*1 border), so 42 is the
  largest integer cell that still fits the widest possible footprint
  (5 * 42 = 210 <= 212). Every footprint fits with NO downscale cap, which is
  what keeps the scale constant.
- Workspace passes `widthPx = bb.cols * THUMB_CELL_PX` to the thumb CellStage
  (was `bb.cols * 256` + CSS cap).
- `.aa-cb--thumb` drops its max-width/max-height cap (the stage is now sized
  exactly; a cap would reintroduce per-footprint scale variance). The score
  badge font tweak stays.
- SCOPE: gallery thumbs with the cell backdrop ON (po only, default ON).
  The lightbox is untouched (fit/zoom is explicitly a magnifier, not a size
  reference). The plain `<img>` fallback (cells toggled OFF, or no mask)
  keeps the old 212x150 caps -- toggling `cells` off intentionally returns
  to "fill the card" viewing.

## Gates

- G1: client typecheck + build green.
- G2: artadmin e2e harness green (tools/artadmin_e2e.sh), including a new
  REQ-0216 assertion: the thumb stage inline width equals cols*42 for two
  artworks of different footprint (1x1 -> 42px, L-mask 2x2 bbox -> 84px),
  pinning constant px-per-cell across cards.
- ci.sh green.

## Log

- (pending)
