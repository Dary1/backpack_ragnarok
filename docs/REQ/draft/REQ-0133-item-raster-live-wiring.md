# REQ-0133 — item-raster-live-wiring

**Reserved:** 2026-07-12
**Slug:** item-raster-live-wiring
**Blocked by:** REQ-0125 (skin/sprite resolution machinery) + a user decision
**Split from:** REQ-0109 task 5 (scoped out explicitly rather than left implicit)

## Goal

Decide and implement how live/mock/client render ITEM icons now that the
AI-raster route (REQ-0073/0109) produces per-item raster PNGs: either wire
selected rasters into the renderer, or keep raster as reference-only and
continue the SVG sprite (`content/sprite_all_vN.svg`, `icon-<id>` symbols)
for live.

## Why draft (blocked)

- REQ-0125 builds the sprite/skin resolution chain for Unit icons (active
  skin → default icon → legacy glyph → placeholder). Item raster resolution
  should reuse that machinery, not grow a parallel one — implementing this
  before 0125 lands would duplicate it.
- User decision wanted: rasters live vs SVG-only (registry route open item
  in `unit_icon_pipeline.md` §3 is the same question for units; deciding
  them together keeps one asset story).

## Notes

- Until this REQ, live item rendering stays SVG-sprite; batch-003 rasters
  are reference/preview assets only (web/preview/batch-003/).

> [2026-07-12, REQ-0134 session] The "user decision wanted" half is resolved:
> registry/render route = **RASTER** (unit_icon_pipeline.md §3.2, ratified
> ALL GREEN 2026-07-12; units and items decided together). Remaining blocker:
> REQ-0125 resolution machinery — stays in draft until 0125 lands. Also note
> batch-003 art itself was NG'd at S7 the same day (see REQ-0109, todo);
> wiring work is art-agnostic and unaffected.
