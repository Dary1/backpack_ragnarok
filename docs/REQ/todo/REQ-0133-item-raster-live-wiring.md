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

## Implementation log

### Session 2026-07-14 (implementing engineer) — SHIPPED (branch `req-0133-item-raster-live-wiring`, rides with REQ-0177)

**Wire-shape decision (documented in `shared/dto.ts`)** — a payload-level, additive, SPARSE
`art_urls: Record<string,string>` on `/api/content`: served entity id (po/si/tm, one-name-one-
entity → globally unique) → resolved adopted-render URL `/api/art/<artwork>.png`. Only ids that
resolve to an adopted render appear; an ABSENT id means "no registry art" → the client falls
back to the SVG sprite (that fallback tier is the CLIENT's). Chosen over a per-entry `art_url`
because it is one object the client reads once and keeps every existing entry shape byte-
unchanged. **Delivery**: `/api/content` is SYNCHRONOUS + file-mtime-cached and read synchronously
by dex.cjs and both api_test backends — so the DB-derived `art_urls` live in their own WARM CACHE
that `getContent()` attaches synchronously, refreshed (a) fire-and-forget on a 15s TTL, (b)
`setImmediate` at boot, and (c) AWAITED on the two mutations that change resolution: adopt
(`routes/art.cjs`) and artwork_ref change (`routes/content.cjs`). Awaiting on adopt is what makes
the wiring e2e deterministic. Registry is pg-only; under the files backend the map is `{}` and
every item uses the sprite (post-0177, the same pixel). No client-side cross-registry join on the
game path.

**Server** — `storage.resolveItemArtNames(names)` (in `storage_content.cjs`, re-exported via the
`...contentStore` spread) resolves the batch at the storage chokepoint in ONE cross-table round-
trip: rung 1 = adopted render of `def.artwork_ref`, rung 2 = adopted render of the exact-name
artwork, else omitted. A ref to an unadopted/deleted artwork degrades to exact-name then omission
(graceful, same posture as `resolveArtworkFacetName`).

**Client — Pixi board** — `board/itemArt.ts` reuses the REQ-0125a machinery (NOT a parallel
resolver): raster keys namespaced `item:<id>` share the ONE texture map with `unit:<id>` / SVG
`icon-*`; `resolveItemIcon(id, spriteKey, has)` is the rung walker registry → sprite →
placeholder. `sprites.loadBoardTextures()` merges `itemIconRasters()` alongside the unit rasters;
`BoardRenderer` routes all 6 item draw sites (placed PO, blade, hilt, seated SI, free SI, carry
drag preview) through `itemTex()` — registry-first, sprite fallback, contain-fit preserved (a
non-square raster is fitted, never stretched). `store/boot.ts` calls `setItemArtUrls(gameData.
ART_URLS)` before any board mounts (art as DATA; the renderer is untouched). A registry raster
that 404s / fails to decode is absent from the map → falls through to the sprite; missing art
never blocks a draw.

**Client — DOM** — `dexIcons.resolveIconUrl(id, iconId)` → `{url, source: 'registry'|'sprite'}`
(registry URL first, sprite data-URL fallback), wired into `Dex`, `DexDetail`, `DexCardWindow`,
`DexAdmin`. `contentadmin/EntityPreview` mirrors the SAME chain and LABELS the winning source
(fed the def's adopted-render URL via `contentShared.defAdoptedArtUrl` → `VariantCard`/`Workspace`/
adopt-confirm — adopted-only, so the admin shows exactly what the game draws).

**testid delta** — ADDED `entity-art-source-<idBase>` (text `registry art` | `sprite icon`) in
EntityPreview's po/si/tm heads. No existing testid removed or repurposed; all existing
contentadmin/dex testids and assertions unchanged (verified: contentadmin 22/22, artadmin 4/4).

**Gate results (counts + logs)**
- **G1**: client `pnpm exec tsc -b` EXIT 0; `pnpm run build` EXIT 0 (`/tmp/req0133_build2.log`).
  Server pg tests (isolated namespaces): `artwork_test` 7/0, `content_test` 18/0, `contentagg_test`
  5/0, `backfill_sprite_art_test` 12/0, **new `item_art_wiring_test` 5/0** (exact / ref-first /
  ref-degrade / omit / payload art_urls). `api_test` BOTH backends 176/0 (files) + 176/0 (pg),
  1367 assertions each — the additive `art_urls` breaks nothing. New client unit check
  `check_item_icon.mjs` 11/11 (registry→sprite→placeholder incl. failed-raster fall-through).
- **G2**: dist rebuilt (EXIT 0) so the harnesses serve the worktree bundle. `content_admin_e2e.sh`
  **22 passed** (`/tmp/req0133_ca_e2e.log`) — incl. the new DOM-tier wiring test
  `REQ-0133 wiring:` (registry def → `entity-art-source-1` = "registry art" + `.shape-grid-cell-icon`
  src `/api/art/blade…`; no-artwork def → "sprite icon" + `data:image/svg…`). `artadmin_e2e.sh`
  **4 passed** (`/tmp/req0133_art_e2e.log`). FULL default suite: see the deploy note below.
- **G3**: `git diff <merge-base>...HEAD --stat` = only intended files (server storage/lib/routes/
  tests, tools/backfill, client board/dex/contentadmin/api/store/styles, shared/dto, REQ docs);
  `content/sprite_all_v12.svg` UNTOUCHED; no web/dist/lockfile churn; isolated pg namespaces only.

**Commits**: `7471679` (server resolver + /api/content art_urls + wiring test), `481edf0` (client
Pixi + DOM registry-first), plus the e2e harness-seed + wiring spec and these logs.

**Deviations / notes the orchestrator MUST know before merge/deploy/restart**
- The **FULL default e2e suite is a POST-DEPLOY gate**, not runnable meaningfully from this branch:
  per `client/playwright.config.ts` it drives the LIVE services (backpack-web :8801 = MAIN
  checkout `web/app`; backpack-api :8802), and global-setup manipulates the live api directly.
  This branch's server+client are undeployed, so a branch run tests the OLD live code (a baseline,
  not this REQ). AFTER merging BOTH server + client, rebuilding + committing `web/app` dist, and
  restarting `backpack-api` + `backpack-web`, run `cd client && pnpm run e2e` — the game renderer
  changed, so the whole suite must hold (expect the REQ-0159-accounted set: nav-routing:26,
  dex-card:65, schedule:1065 flake, the admin 403-by-design). A branch baseline run was started
  for box health; see the final report.
- **Order of live deploy**: apply nothing new schema-wise (migration 016 already live). Deploy the
  code, restart api+web, THEN run the REQ-0177 backfill (dry-run then real) against the LIVE
  namespace, THEN the post-deploy full e2e. The warm-cache `art_urls` self-heals within 15s of the
  backfill, but a clean api restart after the backfill guarantees the first client sees registry art.
- `art_urls` is empty under the files backend by design (registry is pg-only) — the client sprite
  fallback covers it (same pixel post-0177).
