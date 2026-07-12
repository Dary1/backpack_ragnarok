# REQ-0102 — PO Icon Alignment (data-driven; Longsword blade/hilt flush seam)

- **Status**: DONE — merged + deployed live (`645c957` + dist `994ccef`). The render-time
  align shipped; its residual seam gap was then closed by REQ-0104 (align-aware padding flush,
  sprite v12). Accepted through iteration.
- **Date**: 2026-07-09 (orchestrator)
- **Worktree/branch**: `~/backpack_ragnarok_worktrees/req-0102-po-icon-align`, branched from
  `master` @ `fc415bf`.
- **Numbering note**: 0101 was already claimed by a concurrent branch
  (`req-0101-styleguide-fx-catalogue`), so this work took **0102** to avoid collision.

## Request (user)
1. PO icons are middle/center-aligned within the placeable area derived from the cell
   shape. Add a per-PO alignment field to the item DB (up/down/left/right) with values:
   Longsword Blade → vertical **bottom**, Sword Hilt → vertical **top**, everything else →
   middle/center. (Schema shape defined at the same time, per user.)
2. Audit item icons for whether whitespace is trimmed to content.

## ② Whitespace audit — all 22 symbols in `content/sprite_all_v11.svg`
Method: rasterize each `<symbol>` (cairosvg, alpha), measure the tight content bbox vs the
symbol viewBox; report empty margin per edge.

- **No icon is fully trimmed.** Most carry intentional padding; `frost_orb`, `linker_core`,
  `acc_guard` are exactly 10% empty on every edge (a deliberate design pad).
- **blade** (viewBox 64×128): empty L 31% / R 33% / **T 2.5% / B 2.5%** — vertically tight,
  horizontally padded (a thin blade centered in a wide box).
- **hilt** (viewBox 64×64): empty L 33% / R 35% / **T 5.5% / B 5.0%** — vertically near-tight,
  horizontally padded.
- **Consequence:** the requested aligns are on the **vertical** axis, and both parts are
  effectively trimmed vertically, so vertical alignment moves *visible art* (not whitespace)
  to the seam. The feature therefore produces the intended visual. (Horizontal padding is
  baked into the art but is not exercised by these values.)

## Root cause / context
Originally the assembled Longsword drew hilt with a top-flush asymmetric inset and blade with
a near-symmetric one. **REQ-0028 (aspect law)** unified all art to a single *centered*
contain-fit, which removed directional placement (the seam gained a ~0.3-cell gap). REQ-0102
reintroduces directional placement, now as **data** rather than hard-coded per item.

## Design
- **Schema `po/2`** gains optional `align: { v?: 'top'|'middle'|'bottom', h?: 'left'|'center'|'right' }`.
  Absent / `middle`+`center` == the existing centered behavior.
- **Rendering**: the contain-fit box is computed exactly as before (icon **size unchanged**),
  then re-anchored to a footprint edge per `align` by **pure translation** — never rescaled
  or distorted, so the aspect law still holds. `bottom` ⇒ icon bottom = footprint bottom
  (its seam side); `top` ⇒ icon top = footprint top.
- **Values**: `blade` → `{v:'bottom'}`, `hilt` → `{v:'top'}`; all others default.

## Implementation (commit `645c957`, 17 files)
- **Core math**: `client/src/render/itemCard.ts` — new `applyAlign()`, wired into
  `computeItemCardLayout`; `ItemCardShapeInput.align`. `client/src/board/geom.ts` —
  `fitSpriteToBox` gains optional `align` + `foot` (footprint) params (default path
  byte-identical to before).
- **Board consumers**: `BoardRenderer.ts` (placed-PO draw + merged-Longsword blade/hilt),
  `ghosts.ts`.
- **Catalog consumers**: `ShapeGrid.tsx` (new `iconAlign` prop), `Dex.tsx`, `DexDetail.tsx`
  (`ShapeMountedThumb`), `DexDiagram.tsx`, `DexAdmin.tsx`, `DexCardWindow.tsx`,
  `market/marketShared.tsx`, `schedule/DismantlePanel.tsx` (+ `alignOf` helpers mirroring
  `stretchOf`).
- **Types / plumbing**: `shared/engine.d.ts` (`IconAlign` + `ItemDef.align`), `shared/dto.ts`
  (`ApiItemEntry` + unified card DTO), `client/src/api.ts` (map-through),
  `tools/tool_integrate.cjs` (passthrough in `toItemDef`). Server `lib/content.cjs` already
  passes DB entries through via `Object.assign` — **no server edit needed**.
- **Admin safe**: `server/admin.cjs` writes edits via `Object.assign({}, original, body)`
  (merge) — `align` survives item edits made through the Dex admin form.
- **Data**: `content/live/live_items.json` — `blade.align = {v:'bottom'}`,
  `hilt.align = {v:'top'}` (minimal diff; round-trip verified byte-identical otherwise).

## Gates
- **client `tsc -b`**: green (TypeScript 6.0.3).
- **`tools/check_engine_types.cjs`**: green (49 declared members verified vs runtime).
- **Seam verification** (merged-sword geometry, CELL=90): blade-bottom↔hilt-top gap
  **27px → 0px (flush)**. Non-aligned control box **byte-identical** with/without the align
  path (regression-safe).
- **Visual** before/after: `outputs/req0102_seam_compare.png`.
- **Not run / N.A.**: full Playwright e2e (recommended before merge).
  `tools/self_test_vocab.cjs` is RED but **pre-existing** — it fails identically on the
  untouched `master` checkout; it is a vocab verb/trigger-coverage test unrelated to REQ-0102.

## Open / next
- Merge + deploy require explicit user go-ahead (HANDS-OFF `master` + live services).
- Optional future: expose an `align` control in the Dex admin edit form (align is data-only
  today; merge-write already preserves it).
- The `h` (left/center/right) axis is implemented and typed but unused by current data.

## Deploy (2026-07-09)
- Fast-forward merge `req-0102-po-icon-align` → `master`: `fc415bf` → `645c957`. The
  co-resident REQ-0077 dirty files (`vocab.json`, `build_dungeon_preview.py`) were left
  untouched.
- `client && npm run build` → regenerated `web/app` (vite outDir); committed as `994ccef`.
- No service restart needed: `backpack-web` (python http.server) serves `web/app` straight
  from disk, and `backpack-api` hot-reloads `content/live/*` by mtime — so the new bundle and
  the `blade`/`hilt` align data went live without touching REQ-0077's in-progress state.
- Live checks: `/api/content` returns `blade.align={v:bottom}`, `hilt.align={v:top}`,
  `tower_shield` none (default); served bundle == freshly-built `index-DiO2MAKQ.js`;
  `backpack-api` / `backpack-web` / `backpack-tunnel` all active.
- Not run: full `tools/ci.sh` sim/e2e/pg passes (change surface is compile-time types +
  render + one optional data field; server typecheck, client build, and engine drift all
  green).
