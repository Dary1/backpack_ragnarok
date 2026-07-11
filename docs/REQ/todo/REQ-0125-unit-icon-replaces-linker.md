# REQ-0125 — unit-icon-replaces-linker

**Status:** todo — Unit Icon pipeline golden RATIFIED by user 2026-07-12
("unit_icon_pipeline green"; see `docs/llm_managed/unit_icon_pipeline.md`).
The only remaining dependency is ordering: REQ-0124 Phase B naming
(linker→unit) must land first.
**Reserved:** 2026-07-11
**Slug:** unit-icon-replaces-linker
**Blocked by:** REQ-0124 (Phase B)

## Goal

Make the client render a Unit's character icon in the cell the Linker glyph
occupies today, with a graceful fallback chain, so the roster art (Unit Icon
pipeline) can ship surface by surface.

## Scope

- Sprite resolution: `client/src/board/sprites.ts` + `BoardRenderer.ts`
  resolve the icon by unit id (raster route per the pipeline doc). Per the
  ratified golden G6 (skinnable identity), resolution is SKIN resolution:
  the pipeline's base icon is the Unit's default skin. Fallback chain:
  active unit skin → default unit icon → legacy linker glyph → placeholder.
  Missing art must never block rendering.
- Surfaces: `InventoryBoard`, dex `BpDiagram` / `ShapeGrid`, market `BuyPane`,
  workshop — every current linker-glyph call site (attach the grep list at
  implementation start; REQ-0092 inv-linker-cell-guard and REQ-0096
  si-icon-shapegrid-fallback are prior art).
- Renderer overlays (connection-shape markers, charge state, link lines) stay
  data-driven — never baked into art (ratified golden G2).
- Contain-fit uniform scaling only (`art_golden.md`: aspect inviolable). Unit
  icons are 1×1 / 1:1 by definition.
- Related but out of scope: Backpack