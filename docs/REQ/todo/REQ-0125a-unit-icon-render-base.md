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
- `client/src/dex/BpDiagram.tsx` + `client/src/dex/ShapeGrid.tsx` — these draw
  NO unit glyph. `ShapeGrid`'s `unitTile` prop only adds a CSS class
  (`shape-grid-cell-unit`) that highlights the unit's cell; there is no `<img>`,
  no icon, nothing for a resolver to resolve. Dex, market BuyPane and workshop
  all reuse these two components and have no unit-glyph call site of their own.
  **Corrected at implementation (2026-07-12):** the original REQ text said "route
  them through the same resolver". Doing that TODAY would mean rendering the
  legacy glyph into the dex/market/workshop unit cell where no art is shown at
  present — a visual change, and one that contradicts this REQ's own no-diff
  contract (and risks the `shape-grid-cell-unit` e2e assertions). So the DOM
  surfaces are deliberately left untouched here. What guarantees they will not
  fork a second chain is that `resolveUnitIcon` is FRAMEWORK-AGNOSTIC by
  construction: it takes availability as an injected `has(key)` predicate and
  returns a key, so a DOM adapter (key → URL, over `dexIcons.ts`) is a thin
  wrapper, not a reimplementation. REQ-0125b adds that adapter at the same time
  it adds the identity that would make it show anything. Prior art for the
  fallback discipline: REQ-0092 inv-linker-cell-guard, REQ-0096
  si-icon-shapegrid-fallback.
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

## Execution ledger (2026-07-12)

**Branch:** `req-0125a-unit-icon-render-base`, worktree
`~/backpack_ragnarok_worktrees/req-0125a-unit-icon-render-base`, off master @ 09455a8.

**Shipped**
- `client/src/board/unitIcon.ts` — THE resolver. G6 chain (skin → default →
  legacy → placeholder). Pure, framework-agnostic: availability is an injected
  `has(key)` predicate, so plain Node drives it and the DOM side can reuse it.
  A rung is taken only if its key is BOTH declared AND available — which is how
  a 404'd/undecodable raster falls THROUGH rather than throwing. Also
  `unitIconKey()` (namespaces raster keys as `unit:<id>` / `unit:<id>@<skin>`,
  so they can never collide with the SVG route's `icon-*` symbol ids — this is
  what lets REQ-0133 share the same texture map) and `unitIconRasters()`, the
  art manifest, **empty by design** — the single place art plugs in.
- `client/src/board/sprites.ts` — raster route added as a SECOND producer into
  the same texture map (`loadBoardTextures()` = SVG symbols + rasters, cached).
  A raster that 404s / times out / decodes empty is WARNED and SKIPPED, never
  thrown.
- `client/src/board/chargeRing.ts` — G7 ring fill. `chargeRingArc()` is pure
  geometry (12 o'clock start, clockwise); `drawChargeRing()` paints track + fill
  into a Pixi Graphics, `eventMode='none'` so it can never eat the pointer events
  that make the unit core a BP drag handle. Out-of-band charge is CLAMPED and
  NaN/Infinity draw nothing — a renderer must not take the board down because a
  gameplay value drifted.
- `client/src/board/BoardRenderer.ts` — the hardcoded
  `textures.get('icon-unit_core')` (one string literal, every BP, both boards)
  now goes through the resolver; the sprite goes through the SHARED contain-fit
  (`fitSpriteToBox` → `itemCard.fitBoxInBounds`) instead of hard-setting
  `width/height`, which would stretch non-square art. Ring drawn with `null`.
- `Board.tsx` / `InventoryBoard.tsx` / `Monitor.tsx` — the three texture-map call
  sites moved from `loadSpriteTextures()` to `loadBoardTextures()`.

**The no-diff contract (the deliverable, proven not argued)**
Every BP today has no skin and no default icon, so every BP falls through to the
legacy glyph; and the shared contain-fit of the 1:1 glyph (64×64 viewBox @
RASTER_SCALE 2 = 128×128) into the 44×44 art box lands on EXACTLY the old
`44×44 @ (x-22, y-22)`. Both are pinned by assertions in the new gate, so a future
change that silently alters the board goes red here.

**Charge data: NONE EXISTS (audit, 2026-07-12)**
- `mock-src/engine.js` is the PLACEMENT engine — no time axis at all (no
  `charge`, `cooldown`, `timer`, tick).
- `sim/` has no per-unit charge. The tree's only `cooldown` is
  `sim/lib/dungeon.cjs cooldownForH()` — the ROOM re-entry cooldown (60–600 s).
  Different quantity, different granularity, and it is REQ-0098's ring.
- Canvas/inventory units are DORMANT by construction (REQ-0030 spec item 1).
So `charge` is `null` at every production call site and no ring is drawn. **User
ruling 2026-07-12:** finish the drawing, do not fabricate a value
("描画は完成させ、値は null"). REQ-0129 supplies it and changes one argument.

**Gates**
- `tools/ci.sh` **GREEN** (`SKIP_E2E=1`): sim, replay goldens, S4, mock engine,
  server tsc, engine type-drift, vocab self-test, api fs 155 + pg 155, pg_sync,
  new [5.6/7] unit-icon gate, client typecheck+build.
- New: `client/scripts/check_unit_icon.mjs` — 24 assertions (every rung incl. the
  decode-failure fall-through; ring geometry incl. clamp/NaN/monotonicity; the
  no-diff contract). Wired into `ci.sh` as step [5.6/7]. Drives the REAL modules
  via vite `ssrLoadModule` — same rig as `check_sprites.mjs`, no forked logic.
- New: `client/scripts/build_ring_preview.mjs` → `web/preview/unit-charge-ring/`.
  Renders the ring at 10 charge steps FROM the real `chargeRingArc()` (the math is
  not duplicated on the page, or the preview would be a picture of a second
  implementation). This is the only way to look at an overlay that correctly draws
  nothing in production.
- `oxlint`: 0 errors (34 pre-existing warnings, untouched).
- **e2e: a POST-DEPLOY gate on this rig.** The harness proxies to the LIVE
  services (`client/e2e/local-proxy.cjs`: `*` → backpack-web :8801, which serves
  the MAIN checkout's `web/app/`), so a worktree branch cannot be e2e'd without
  deploying it — same constraint REQ-0124 hit. Results below.

## Deploy + post-deploy e2e (2026-07-12, user GO)

- Merged to master (`60073a7`, --no-ff), client dist rebuilt + committed
  (`58f7940`), `backpack-api` / `backpack-web` restarted; api/web/tunnel all
  **active**.
- **e2e vs the deployed code: 140 passed / 3 failed.**
  - `schedule.spec:1065` (REQ-0041 monitor freeze regression guard) — **GREEN on
    retry** (serial, `--last-failed`). Not a regression. This one was checked
    deliberately rather than waved through as "known debt": REQ-0125a changes
    `Monitor.tsx` (`loadSpriteTextures` → `loadBoardTextures`), so a monitor
    freeze was exactly the failure this REQ could plausibly have caused. It did
    not — `loadBoardTextures()` is `loadSpriteTextures()` plus an empty raster
    list, and the spec passes clean in isolation. Same state-pollution flake
    REQ-0124's ledger recorded for this spec.
  - `dex-card.spec:65` + `nav-routing.spec:26` — **PRE-EXISTING suite debt**,
    unchanged. They assert `.dex-detail-columns` / `.schedule-rooms-view`, classes
    no master component emits (they live in index.css + the unmerged Dex-R3 /
    REQ-0120 branch commits). They fail identically against pre-REQ-0125a code and
    go green when that work merges. Not ours — see REQ-0124's gate ledger, which
    documents the same two.
- **No board diff observed**, as designed: every BP still resolves to the legacy
  glyph.

**Not committed on this branch:** the `web/app/` dist churn produced by ci.sh's
client build. Dist is rebuilt + committed at DEPLOY time on master (REQ-0124's
pattern); committing it on a feature branch is merge-conflict noise.

**Awaiting user go-ahead:** merge to master + deploy + post-deploy e2e. The main
checkout and the live services are HANDS-OFF without a fresh go-ahead (PROJECT.md).

**Flagged, not touched (out of scope):** `tools/ci.sh` invokes `npm run build` /
`npm run e2e` inside `client/`, which contradicts PROJECT.md's "NEVER USE NPM"
(pnpm-only, `packageManager` pinned). Pre-existing; changing the shared CI entry
point is not this REQ's business. The new [5.6/7] step deliberately calls
`node scripts/...` directly, sidestepping the package manager entirely.
