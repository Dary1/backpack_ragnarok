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
