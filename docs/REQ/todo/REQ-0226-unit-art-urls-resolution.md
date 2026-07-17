# REQ-0226 — unit art joins the server-resolved art_urls map

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: retrospective proposal from REQ-0208; needs
  user review (touches storage resolution + three client surfaces).

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
