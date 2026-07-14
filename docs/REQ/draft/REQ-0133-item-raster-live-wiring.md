# REQ-0133 — item-raster-live-wiring

**Reserved:** 2026-07-12
**Slug:** item-raster-live-wiring
**Blocked by:** REQ-0125a (raster route + resolution chokepoint)
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

> [2026-07-12, REQ-0125 split] REQ-0125 was split: **REQ-0125a**
> (unit-icon-render-base, todo) builds the raster texture route + the single
> resolution chokepoint + the G7 charge ring; **REQ-0125b**
> (unit-skin-resolution, draft) keys that chain to Unit identity and waits on
> REQ-0128s Unit model. This REQs blocker is **REQ-0125a only** — the
> machinery it must reuse — NOT 0125b. Item rasters need the route and the
> fallback chain; they do not need unit identity. Re-pointed accordingly.

> [2026-07-14, REQ-0154 coordination note — appended, NOT a status change]
> REQ-0154 (content-pipeline-registry-reconcile) recasts this REQ's live-wiring
> concern as the **registry EXPORT contract**. With the artwork registry (REQ-0151)
> in place, the adopted PO/SI render for a `system_name` is exported to
> `content/art/<kind>/<name>.png` (and via `tool_integrate` at deploy) — that export
> is what live/mock/client consume. See `docs/llm_managed/common_content_pipeline.md`
> §7.4 (export path) and `item_content_pipeline.md` §0. This REQ remains in `draft/`
> and is NOT moved by REQ-0154; its remaining blocker is REQ-0125a's shared
> resolution machinery (the raster-vs-SVG decision is already RASTER). Recorded per
> the REQ-0154 spec's coordination instruction.

## Ruling (user, 2026-07-14 chat) — REGISTRY-FIRST. Cleared to implement.
The 2026-07-14 session ruled (continuation of the same-day content-wide canon "art is a
registry-level reference; variants resolve via the parent def"):
1. The artwork REGISTRY becomes the single art ledger. Live item rendering resolves
   REGISTRY-FIRST with the chain: def.artwork_ref adopted render → exact-name artwork
   adopted render → SVG sprite icon (the data `icon` field, transitional fallback) →
   placeholder. Reuse the REQ-0125a chokepoint/raster machinery; no parallel resolver.
2. COMPANION (REQ-0175-sprite-svg-art-backfill, same ruling): the existing sprite SVG
   icons are imported INTO the registry as renders and adopted where nothing is adopted
   yet, so the chain's registry tier covers 100% of live items immediately; the sprite
   fallback becomes a safety net, not the norm.
3. The admin (contentadmin EntityPreview) mirrors the SAME chain and labels which source
   won — the admin shows exactly what the game shows.
4. `icon`-field deprecation and sprite-sheet retirement stay OUT of scope (future REQ,
   after coverage holds).

### Implementation scope (settled)
- Server: the game content payload (or an equivalently cacheable single fetch) exposes,
  per served item (po/si/tm), the resolved adopted-render URL following the chain above
  (def.artwork_ref first, exact-name second) — resolution computed server-side at the
  storage chokepoint; no client-side cross-registry joins for the GAME path.
- Client Pixi: sprites.ts/BoardRenderer item-cell textures consume the resolved URL via
  the REQ-0125a raster route; contain-fit, aspect inviolable; sprite-symbol texture kept
  as fallback tier.
- Client DOM: dexIcons gains a resolution-aware entry point (registry URL first, sprite
  data-URL fallback) used by Dex/ShapeGrid consumers; contentadmin EntityPreview labels
  the winning source ("registry art" / "sprite icon").
- e2e: full default suite green + admin suites; a wiring test proving an item with an
  adopted registry render renders from the registry URL and one without falls back to
  the sprite.
