# REQ-0125a — unit-icon-render-base

**Status:** todo — cleared to implement.
**Reserved:** 2026-07-11 (as REQ-0125)
**Slug:** unit-icon-render-base
**Split from:** REQ-0125 (unit-icon-replaces-linker), 2026-07-12 — see "Why split".
**Sibling:** REQ-0125b (unit-skin-resolution, draft, blocked by REQ-0128)
**Blocked by:** nothing. REQ-0124 Phase B (linker→unit naming) is done and merged.
**Blocks:** REQ-0133 (item-raster-live-wiring) — the raster loading + resolution
chain this REQ builds is the machinery REQ-0133 must reuse rather than duplicate.

## Why split (user decision, 2026-07-12)

REQ-0125 as written assumed a Unit identity ("resolve the icon by unit id") that
does not exist. Verified on master at split time:

- A BP def is `{id, name, color, shape, origin, linker:{off,dirs}, hpMax}` —
  see `content/live/scenario.json`. There is no unit id, no unit def, no skin
  field. The real Unit model is owned by REQ-0128 (draft); the def content
  pipeline by REQ-0130 (draft).
- No unit art exists. REQ-0127's main batch is on hold pending the REQ-0136
  checkpoint bakeoff verdict.
- The client has no raster path at all: `client/src/board/sprites.ts` loads SVG
  `<symbol>`s from `content/sprite_all_v12.svg` and rasterizes them to Pixi
  Textures. Item rasters (REQ-0073/0109) are reference/preview assets only.
- Every BP renders the SAME hardcoded glyph: `BoardRenderer.ts` does
  `textures.get('icon-unit_core')` at the unit cell, for every BP, on both boards.

So the identity-keyed half cannot be built yet, but the *machinery* under it can,
and REQ-0133 is waiting on exactly that machinery. The user's call (2026-07-12):
split, ship the machinery now (this file), park identity-keyed skin resolution in
`draft/` until REQ-0128 lands (REQ-0125b).

## Goal

Build the Unit-cell render base: a raster-capable texture route, a single
resolution chokepoint with a graceful fallback chain, and the G7 charge-ring
overlay — so that when unit art (REQ-0127) and unit identity (REQ-0128) arrive,
they are *data* dropped into an existing seam, not a renderer rewrite.

## Scope

### 1. Raster texture route
- Extend the sprite loader so a Unit cell can be filled by a raster PNG
  (`target_px` 256×256 per `unit_icon_pipeline.md` §0) as well as by an SVG
  symbol. One texture map, two producers; callers stay agnostic.
- Contain-fit, uniform scale only. Aspect is inviolable
  (`common_content_pipeline.md` §2, the surviving art_golden rules — art_golden.md
  itself was abolished 2026-07-12 by REQ-0134). Unit icons are 1×1 / 1:1 by
  definition, so contain-fit is a no-op today; it must still be the code path,
  because REQ-0133 will route non-square item rasters through it.
- Missing/failed art must NEVER block rendering: a raster that 404s or fails to
  decode falls through the chain, it does not throw.

### 2. Resolution chokepoint + fallback chain
- ONE function resolves what texture a Unit cell shows. Per the ratified golden
  G6 (skinnable identity), resolution is SKIN resolution:

      active unit skin → default unit icon → legacy linker glyph (icon-unit_core)
      → placeholder

- Today every input to the chain above `icon-unit_core` is absent, so every BP
  resolves to the legacy glyph and the board looks EXACTLY as it does now. That
  is the intended, shippable end state of this REQ: **no visual change on the
  board, no art, no schema churn** — a seam plus a proof it falls through.
- The chain's upper rungs (skin id, unit id) are typed and unit-tested against a
  fake registry; wiring them to real data is REQ-0125b's job. Do not invent a
  `unitId` field on BP defs here — REQ-0128 owns that schema (explicit user
  decision, 2026-07-12).

### 3. G7 charge-ring overlay
- Ratified G7 (`unit_icon_pipeline.md` §1): the Unit charge-state overlay is a
  **ring fill** (radial progress around the icon), renderer-drawn, identical
  across all skins.
- Implement it as a complete, data-driven, unit-tested overlay taking a
  normalized `charge: number | null` (0–1). `null` = no ring.
- **There is no charge data source anywhere in the codebase.** Verified at split
  time: `mock-src/engine.js` is the placement engine and has no time axis at all
  (no `charge`/`cooldown`/`timer`); `sim/` has no per-unit charge; the only
  `cooldown` in the tree is `sim/lib/dungeon.cjs cooldownForH()`, which is the
  ROOM re-entry cooldown (60–600s) and belongs to REQ-0098's room ring, not here.
  Canvas units are dormant (out of combat) and hold no charge by construction.
- Therefore: production call sites pass `null` and no ring is drawn. The ring is
  proven by tests + a `web/preview/` harness showing every fill step. REQ-0129
  (charge trigger taxonomy) fills in the value. **Do not fabricate a dummy charge
  value on the board** (explicit user decision, 2026-07-12: "描画は完成させ、値は null").
- Per G2 (no gameplay state in art) the ring is renderer-drawn and never baked
  into an icon. G7 exists precisely so no icon bakes in ring-like framing.

### 4. Call sites
Grep list, captured at implementation start (master @ 09455a8):

- `client/src/board/BoardRenderer.ts:755` — `textures.get('icon-unit_core')`, the
  ONLY live unit-glyph draw. Serves both boards (canvas + inventory; inventory is
  the same renderer dimmed, per REQ-0030 spec item 1). `InventoryBoard.tsx` and
  `Board.tsx` delegate here — they hold no glyph of their own.
- `client/src/dex/BpDiagram.tsx` + `client/src/dex/ShapeGrid.tsx` — DOM/SVG unit
  TILE marker (highlighted cell), not the glyph. Dex, market BuyPane and workshop
  all reuse these two; they have no unit-glyph call site of their own. Route them
  through the same resolver so the icon can appear here later without a second
  chain (prior art: REQ-0092 inv-linker-cell-guard, REQ-0096
  si-icon-shapegrid-fallback).
- `mock-src/ui.js:313` + `web/mock/index.html:3280` — legacy mock UI
  (`<use href="#icon-unit_core">`). LEGACY, out of scope; left as-is, noted here
  so the grep list is complete.

### 5. Out of scope
- Unit identity / `unitId` schema → REQ-0128, consumed by REQ-0125b.
- Unit art generation → REQ-0127 (on hold behind REQ-0136).
- Backpack skins (bag edge-design pattern) → REQ-0126 / `backpack_skin_pipeline.md`.
- Charge trigger data → REQ-0129.
- Item raster wiring → REQ-0133 (reuses this REQ's chain; do not fork it).
- Connection-shape mechanics → REQ-0128.

## Gates

- `tools/ci.sh` green (sim, goldens, mock 101, server tsc, vocab self-test, api
  fs+pg, client build).
- New unit tests: resolution chain falls through every rung in order, including
  raster-decode failure; ring geometry at 0 / partial / 1 / null.
- e2e via `tools/e2e_run.sh` only (exclusive box lock; never call playwright
  directly). Expect NO board diff — this REQ is a seam, not a visual change. The
  known pre-existing suite debt (dex-card.spec:65, nav-routing.spec:26 — see
  REQ-0124's gate ledger) is not ours.
- pnpm only, never npm.
- Visual: `web/preview/` ring harness on backpack-dev, every fill step.

## Execution ledger

(to be filled at implementation)
