# REQ-0125 — unit-icon-replaces-linker

**Status:** draft — blocked on:
  (1) user ratification of the Unit Icon pipeline golden (proposal delivered
      on the FS for review, 2026-07-12),
  (2) REQ-0124 Phase B naming (linker→unit) being live.
**Reserved:** 2026-07-11
**Slug:** unit-icon-replaces-linker

## Goal

Make the client render a Unit's character icon in the cell the Linker glyph
occupies today, with a graceful fallback chain, so the roster art (Unit Icon
pipeline) can ship surface by surface.

## Scope

- Sprite resolution: `client/src/board/sprites.ts` + `BoardRenderer.ts`
  resolve the icon by unit id (raster route per the pipeline doc). Fallback
  chain: unit icon → legacy linker glyph → placeholder. Missing art must never
  block rendering.
- Surfaces: `InventoryBoard`, dex `BpDiagram` / `ShapeGrid`, market `BuyPane`,
  workshop — every current linker-glyph call site (attach the grep list at
  implementation start; REQ-0092 inv-linker-cell-guard and REQ-0096
  si-icon-shapegrid-fallback are prior art).
- Renderer overlays (connection-shape markers, charge state, link lines) stay
  data-driven — never baked into art (pipeline golden G2).
- Contain-fit uniform scaling only (`art_golden.md`: aspect inviolable). Unit
  icons are 1×1 / 1:1 by definition.

## Gates

- e2e: existing linker-related specs updated, plus one new spec proving the
  fallback renders when the unit icon is missing.
- Visual check on backpack-dev preview (board + dex + market).
- No regression in `tools/tool_fit_check.py` coverage gates for adjacent art.
