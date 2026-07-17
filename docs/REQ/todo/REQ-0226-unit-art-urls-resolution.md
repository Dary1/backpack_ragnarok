# REQ-0226 — unit art joins the server-resolved art_urls map

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: retrospective proposal from REQ-0208; needs
  user review (touches storage resolution + three client surfaces).
- 2026-07-17 draft -> todo: user ratified ("do REQ-0226").
- 2026-07-17 todo -> built: implemented on branch
  req-0226-unit-art-urls-resolution, all gates green (see Outcome).

## Origin (REQ-0208 retrospective)
REQ-0208 put monsters on the payload's art_urls map (server-resolved, SPARSE
-- an absent id means "no adopted art" and no request is ever fired) but had
to leave units on the OLD convention: every unit surface (Workshop pool list
+ roll result, the new Dex unit catalog, board rasters) builds
`/api/art/<def.icon>.png` client-side and uses the 404/onError as its
fallback signal.

## Problem
- Every unit whose artwork has no adopted render costs one HTTP 404 per card
  per view (the Dex unit tab fires up to 42 at once), and DevTools noise
  makes real failures harder to see.
- "No adopted art" is indistinguishable client-side from a transient fetch
  failure -- the exact ambiguity art_urls was designed to remove (REQ-0133).
- Two art-resolution conventions now coexist; every future unit surface must
  know which one to use.

## Proposal
- storage: an icon-aware resolution rung for unit_def -- def.icon IS the
  artwork reference (a FREE reference, two units may share one artwork --
  REQ-0170), so resolveItemArtNames' system_name/artwork_ref chain does not
  cover it. Resolve unit id -> def.icon -> adopted render in the same one
  cross-table round-trip style.
- server/lib/content.cjs computeArtUrls: unit ids join the batch (keyed by
  UNIT id, exactly like monsters).
- client: unit surfaces read getItemArtUrl(unit.id) first and keep
  unitArtUrl(def.icon) only as the boot-raster path's URL builder; <img>
  elements render the placeholder without ever probing when the map has no
  entry.

## Non-goals
Board raster loading (unitIconRasters) keeps its own pipeline -- it already
tolerates missing textures by design; this REQ is about the DOM <img>
surfaces and the 404 probing.

## Gates (when implemented)
- api test: art_urls carries a unit id whose icon has an adopted render and
  omits one whose icon does not.
- e2e: Dex unit tab renders with ZERO /api/art 404s in the network log when
  no unit art is adopted (files backend).

## Outcome (implementation record)

Branch `req-0226-unit-art-urls-resolution`, implementation commit
3c0cfe6 (docs move commits around it).

**server**
- `server/storage_content.cjs` `resolveUnitArtIcons(iconByUnit)` -- the
  icon-aware rung: { unitId -> icon } in, { unitId -> icon } out for every
  unit whose icon artwork has an ADOPTED render; omitted otherwise. One
  round-trip (unnest + LEFT JOIN artworks), same graceful posture as
  resolveItemArtNames. The free reference survives: two units sharing one
  icon artwork BOTH resolve (proved in the api gate with the live
  littleprincess/princess pair).
- `server/lib/content.cjs` computeArtUrls: unit ids join the batch, keyed
  by UNIT id exactly like monsters. Icons are read REGISTRY-FIRST (adopted
  unit_def data when present, file entry otherwise), so an adopted variant
  that re-points `icon` resolves consistently with what the client shows.

**client** (DOM surfaces only; board raster pipeline untouched per non-goal)
- `dex/UnitCatalog.tsx` UnitPortrait: `getItemArtUrl(unit.id)` from the
  sparse map; absent -> rune placeholder, NO <img> mounted, no probe.
- `schedule/WorkshopPage.tsx` pool list + roll result: new `UnitArt`
  helper, same map-first read; absent -> same-size placeholder disc
  (`span.workshop-pool-art` rule added in workshop.css).
- `board/unitIcon.ts` unitArtUrl(): UNCHANGED -- remains the boot-raster
  path's URL builder (its 404 tolerance is by design there).

**Gates (all green)**
- api test: `server/tests/item_art_wiring_test.cjs` +2 REQ-0226 tests --
  resolveUnitArtIcons keys by unit id through the shared icon, and
  /api/content art_urls carries the adopted-icon unit ids (both wearers of
  a shared icon) while omitting a unit whose icon has no adopted render.
  7 passed / 0 failed (pg backend).
- `server/tests/api_test.cjs` (files backend): 186 passed / 0 failed.
- client typecheck + build (`tsc -b && vite build`): green.
- e2e: `client/e2e/dex.spec.ts` +1 -- Dex units tab renders with ZERO
  /api/art 404s in the network log when no unit art is adopted (files
  backend). GREEN: dex.spec.ts 11 passed / 0 failed (26.4s, box-lock run).

**Not done here (deliberate)**
- No merge to master, no deploy, no restart of live services (built, not
  done).
- Board raster loading (unitIconRasters) keeps its own pipeline (spec
  non-goal).
