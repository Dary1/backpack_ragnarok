# REQ-0291 — bp_skin renders its authored frame: edge_padding band as the welt

## Status
draft (spec by orchestrator session 2026-07-22; awaiting user ratification).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`.

## Origin (user directive, 2026-07-22, chat — verbatim)
「bp_skinの表示のされ方が提示した仕様と異なっています。(恐らく最後に上書きした
セッションが間違えた仕様に書き換えてしまった。本来bp_skinのテキスチャーを使って、
padding分をフレームとして使用することになっています)」
Translation: bp_skin rendering diverges from the presented spec — the
bp_skin texture's padding band is supposed to be used as the frame.

## The ratified spec being violated (paper trail)
- REQ-0151 (built), resolution table: "bpskin: locked **1024x1024** (tiling
  fill + **frame route**; `edge_padding` feeds compose)". The artworks table
  carries `edge_padding INT NULL — bpskin only; compose band thickness in px`
  (server/storage_art.cjs), authored per artwork in artadmin
  ("edge_padding (compose band, px)", CreatePanel/Workspace).
- The compose ALGORITHM was user-briefed 2026-07-13 with a hand-edited
  mock-up and encoded in `tools/bpskin_compose.py`: interior = tiled fill;
  the band = a DIRECTIONAL welt cut from the source's edge (`welt_strips`:
  a horizontal strip from a top-edge run, a vertical strip from a left-edge
  run, rows/cols ordered outer->inner), painted along an arbitrary
  polyomino via the EDT feature transform (`welt_render`: depth = distance
  to nearest background -> strip row; |dy|>=|dx| of the offset to the
  nearest background -> which strip; along-edge coord mirror-tiled) — no
  autotile atlas, straights/outer/inner corners for free.

## Current wrong state (verified)
`client/src/board/skin/composite.ts` (REQ-0126/0266) ignores the authored
band entirely: the ring (`dRs <= B`) is painted PROCEDURALLY from
`palette.welt` with a `(x+y)%12<5` notch pattern, and the raster path tiles
the WHOLE artwork — `bpSkinTexture.ts decode()` downsamples the full
1024^2 to `TILE_PX = CELL*2 = 96` and `sampleTile` wraps it. The frame art
that lives in the texture's padding is thus consumed as fill noise and the
frame shown is palette plastic. `edge_padding` never reaches the client:
`/api/content`'s `unit_skins` projection (server/lib/content.cjs
`unitSkinsFromCore`, ~L512-543) does not carry it.

## Design (binding)

### 1. Serve the band (server, additive)
In server/lib/content.cjs, for `unit_skin/1` entries with `slot==='bpskin'`,
attach `edge_padding: number|null` read from the referenced artwork row
(resolve alongside the existing `artUrlNameBatch`/art_urls machinery; the
value is content-level, so the public shared-cache route stays legal).
Additive DTO field on the unit_skins entry type (shared/dto.ts). Recompute
where art_urls recomputes (adopt / artwork_ref change).

### 2. Carry it to the def (client)
skinRegistry.ts: `UnitSkinEntryLike` + the bpskin projection gain
`frame_band_px?: number|null` (= edge_padding, px at 1024 scale) stored
under `def.art`. Null/0/absent => legacy def, zero behavior change.

### 3. Slice at decode (bpSkinTexture.ts)
For a def with `frame_band_px > 0`, decode() slices the SOURCE image once
(then discards it — no 4MB retention):
- `fill`: the interior region inset by frame_band_px on all four sides,
  downsampled to TILE_PX^2 (as today, but interior-only — the frame no
  longer pollutes the tile).
- `stripH`: rows `0..band` x cols `30%..70%` of the source (outer->inner
  order preserved); `stripV`: cols `0..band` x rows `30%..70%` — exactly
  `welt_strips` with the full square as silhouette (top=0, left=0).
Cache these per URL; texture cache keys gain frame_band_px (a def toggling
art must not reuse a stale composite).

### 4. Compose the frame from the strips (composite.ts)
`compositeSkin` raster path, ring region only (`rs && dRs <= B`):
- Extend the EDT helpers to also return the NEAREST-FEATURE INDEX maps
  (Felzenszwalb parabola winner propagation in `edt1d`, threaded through
  `edtToTrue`'s two passes) — the TS port of scipy's
  `distance_transform_edt(return_indices=True)`. Same module, pure, Node-
  runnable (the three offline harnesses ssr-load this file; no DOM).
- Per ring pixel: `dy,dx` = offset to nearest outside pixel;
  `depth = clip(round(dist / B * (band-1)), 0, band-1)` (board band B
  linearly resampled from the native strip depth);
  `horiz = |dy| >= |dx|`; along = `_mirror(x, Lh)` for stripH else
  `_mirror(y, Lv)` (mirror-tiling per the tool). Sample the strip; alpha
  composites over `palette.fill` like `sampleTile` does.
- The authored band contains its own keyline/stitches: the procedural
  notch/weltDark pattern is NOT painted on the strip path. `LAYER.welt`
  keeps labeling the ring (checks.ts reads layers, not colors).
- Board band width: `B = clamp(round(frame_band_px * TILE_PX / 1024), 3,
  cellPx)` — the SAME downscale factor as the fill tile, so frame and fill
  stay one material; when strips are absent, `B = border_band * cellPx/64`
  and the procedural welt path runs BYTE-IDENTICAL to today (the pinned
  neutral/devornate goldens are the proof).
- No feather in v1: crisp ring/fill boundary (deterministic goldens);
  divergence from the tool's 2px feather is accepted and recorded here.

### 5. Consumers
BoardRenderer (canvas+inventory) and squadCompositor/monitor all flow
through resolveBpSkin -> bpSkinSprite -> compositeSkin — one fix, three
surfaces. The REQ-0266 guard ("only a skin with REAL ART paints") is
untouched.

## Out of scope
Art (re)generation and artadmin UI; the autotile `edge_tiles`/`clip_masks`
route (REQ-0131/0146 lineage stays a separate spike); palette-procedural
skins; per-BP-color tint rules.

## Gates
- Node harness (the bpskin S3 harness + checks.ts): neutral/devornate
  goldens byte-identical (no-art path untouched); NEW golden: synthetic
  64px source with analytically-colored band vs interior asserts every ring
  pixel samples band colors (correct depth ordering outer->inner on all
  four sides + both corner types) and every interior pixel samples
  interior colors; EDT index maps property-checked against a brute-force
  nearest-background scan on small masks.
- `ci.sh` green; e2e `inventory-art-integrity.spec.ts` + monitor specs
  green; server test: unit_skins payload carries edge_padding (additive,
  older clients unaffected).
- Live-shaped verification on decade **7910-7919** (`e2e_harness_req 0291
  …`) with an adopted bpskin fixture; before/after screenshots under
  `web/preview/req-0291/`.

## Dependencies
None (independent of 0287-0290). Touches server/lib/content.cjs — if it
lands alongside REQs that also touch the content payload, merge order is
free but rebuild/api-restart is required on deploy (client+server change).

## Log

### Implemented (2026-07-22, session req-0291, branch `req-0291-bpskin-padding-frame-compose`, base `req-canvas-inventory-ux-spec`)

Built to §1-§5. The authored `edge_padding` band now renders as the welt; when a
skin declares no band EVERYTHING is byte-identical to before (pinned goldens hold).

- **§1 Serve the band (additive).** `server/storage_content.cjs` gains
  `resolveSkinEdgePaddings(names)` — the SAME ref-first/exact-name chain
  `resolveItemArtNames` walks, reading `edge_padding` from whichever artwork won;
  omitted unless the art resolves (adopted) AND `edge_padding` is non-null (so the
  served band never advertises a frame the `fill_texture` would not paint).
  `server/lib/content.cjs` carries a warm map `skinEdgePaddings`, recomputed inside
  `refreshArtUrls` (the adopt / artwork_ref-change trigger art_urls already uses),
  and `getContent()` overlays `edge_padding` onto each `slot:"bpskin"` unit_skins
  entry via a per-call shallow copy (the identity-memoized cache is never mutated).
  pg-only; under files backend the map is empty and payload is byte-identical.
  `shared/dto.ts` `ApiUnitSkinEntry` gains additive `edge_padding?: number|null`.
- **§2 Carry to the def.** `skinRegistry.ts`: `UnitSkinEntryLike` +
  `ApiUnitSkinEntry` gain `edge_padding`; `BpSkinArt` gains `frame_band_px`;
  `bpSkinDefFromUnitSkin` projects `edge_padding -> def.art.frame_band_px` (null/0
  => legacy def). Flows through `content.ts` -> `boot.ts loadSkinDefs` unchanged.
- **§3 Slice at decode.** `bpSkinTexture.ts decode()` slices the source ONCE (then
  discards it): interior-only fill (inset by band, downsampled to TILE_PX=CELL*2)
  + `stripH` (top rows 0..band x cols 30%-70%) + `stripV` (left cols 0..band x
  rows 30%-70%) — `welt_strips` with the full square as silhouette. Decode/texture
  cache keys fold in the frame band.
- **§4 Compose the frame.** `composite.ts` gains `nearestFeatureEDT` (the TS port
  of scipy `distance_transform_edt(return_indices=True)` — `edt1dIdx` propagates
  the winning vertex through both passes). Ring path: `dy,dx` = offset to nearest
  outside pixel; `depth = clip(round(dRs/B*(band-1)),0,band-1)`; `|dy|>=|dx|` picks
  stripH else stripV; along-coord mirror-tiled (`_mirror` port); alpha over
  `palette.fill` like `sampleTile`. `B = clamp(round(band*tileW/1024), 3, cellPx)`.
  Procedural notch/weltDark is NOT painted on the strip path; `LAYER.welt` still
  labels the ring (checks.ts reads layers). No feather in v1.
- **§5 Consumers.** Untouched: BoardRenderer / squadCompositor(monitor) / inventory
  all flow through `bpSkinSprite` (signature unchanged). REQ-0266 paint guard kept.

### Accepted deviations (within spec latitude)
1. **No feather in v1** — as the spec pre-authorizes; the tool's 2px Gaussian is
   dropped for deterministic goldens. Crisp ring/fill boundary.
2. **TILE_PX sourced from the fill raster width**, not a `geom` import — keeps
   `composite.ts` pure/DOM-free. `B = clamp(round(band * tile.width / 1024), 3,
   cellPx)`; `tile.width` IS TILE_PX (CELL*2), so this is a faithful realization of
   the spec formula.
3. **B and the depth resample both use the CLAMPED native band** (`frame.frameBandPx`
   from decode), not the raw `def.art.frame_band_px`, so B and depth stay consistent
   if a pathological `edge_padding` is clamped at slice time. `def.art.frame_band_px`
   only gates the strip path (>0) and drives decode's slice extent.
4. **edge_padding served only when the art resolves (adopted).** Consistent with
   "resolve alongside the art_urls machinery"; a band with no fill_texture would
   paint nothing anyway.

### Gate table
| Gate | Result |
| --- | --- |
| client typecheck (`tsc -b`) | PASS |
| client build (`pnpm run build`) | PASS |
| `check_bpskin.mjs` — resolver/compositor/checks | PASS (ALL GREEN) |
| `check_bpskin.mjs` — NEW EDT-index property vs brute force (219 cells) | PASS |
| `check_bpskin.mjs` — NEW synthetic-band golden (ring=band, interior=fill, monotone depth on 4 edges, square/L/holed) | PASS |
| `bpskin_harness.mjs` — neutral/devornate/devraster golden BYTE-IDENTICAL (`0944dbd9…`) | PASS (unchanged) |
| `mock-src/tests/run.cjs` | PASS (123/123) |
| `sim/tests/run.cjs` | PASS (121/121) |
| server `unit_skin_edge_padding_test.cjs` (pg; additive field) | PASS (5/5) |
| e2e `inventory-art-integrity.spec.ts` (decade 7910-7919) | PASS (4/4) |
| e2e `unit-skin-fallback.spec.ts` | PASS (4/4) |
| e2e `canvas-chrome.spec.ts` (board surface) | PASS (3/3) |
| e2e `squad-switch.spec.ts` (monitor/squad surface) | PASS (2/2) |
| Full `ci.sh` | NOT RUN — deliberately (see note) |

**ci.sh note (honest).** During the gate window box load spiked to ~7 (another
session running heavy work), so per the task's instruction the FULL `ci.sh` was
not run; instead every ci.sh stage relevant to this change was run individually
and scoped (typecheck, build, both bpskin node harnesses, mock-src, sim, the
pg-backed additive-payload test, and the skin-touching e2e on this REQ's own
decade). Load later fell back to ~0.3. The pg server test and e2e fleet are
namespace-isolated (TMPHOME remap / STORAGE_BACKEND=files fleet) — no live row,
profile, or service was touched.

### Visual evidence
`web/preview/req-0291/` — `before_*` (procedural palette welt) vs `after_*` (authored
frame band: keyline -> stitch -> leather welt), for square + L (both corner types),
plus `before_after_grid.png`. Rendered offline through the real `compositeSkin`
(`req0291_frame_preview.mjs`).

### Commits (branch `req-0291-bpskin-padding-frame-compose`)
- `97271ac` REQ-0291: serve edge_padding on bpskin unit_skins (additive payload field)
- `cff38e5` REQ-0291: render the authored frame band as the welt (compose from strips)
- `1386f91` REQ-0291: check_bpskin gates — EDT index property + synthetic-band golden
- `15bc259` REQ-0291: pg server test — unit_skins carries edge_padding (additive)
- `11f2946` REQ-0291: before/after visual evidence (offline preview script + PNGs)

Not merged; branch left for review (built, not deployed).
