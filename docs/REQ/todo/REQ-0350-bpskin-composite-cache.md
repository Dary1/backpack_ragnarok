# REQ-0350 — the BP-skin cache never actually cached the composite

## Status
built — 2026-07-30. All gates green; NOT merged and NOT deployed. Awaiting user
acceptance. Commits: `dcd1cb2c` (spec), `d4c44e85` (reserved→todo), `f4867de5`
(implementation + gates). See §7.

`bpSkinTexture.ts`'s module header promised "composite once per (cell-set,
skin)". It composited on **every** `render(state)`, for **every** skinned BP, on
**both** mounted boards — three Euclidean distance transforms plus a full W×H
per-pixel pass each, 11.2ms to 23.1ms per BP. Only the `Texture` upload was ever
being cached.

Two independent mistakes, in four lines, both of which had to be fixed for the
cache to do anything at all:

1. `compositeSkin()` ran **before** the cache was consulted, so a hit paid the
   full composite anyway.
2. the cache key carried **absolute** cell coordinates, so moving or rotating a
   BP minted a fresh entry for byte-identical pixels — which thrashed a
   64-entry cache during ordinary play, and is what kept (1) recurring instead
   of amortising.

Found while auditing the WebGL/PixiJS surface at the user's request. Nothing
reported it, because nothing could: the board rendered **correctly** throughout.

---

## 0. What was asked, and what came back

| | question | answer |
|---|---|---|
| **A** | is the recomposite real, or dead code? | **real, and live.** `/api/content` serves 54 `slot:"bpskin"` skins with adopted `art_urls`, so `declaresFillTexture()` is true and the composite path fires for any BP whose unit has a default pack skin |
| **B** | what does it cost? | **11.2ms (1×1) to 23.1ms (2×3, six cells)** per BP per `render(state)`, measured through the real module |
| **C** | is the wholesale eviction safe? | **no.** `destroy(true)` on a module-global cache shared by two live boards could destroy an on-screen texture the other board still held |
| **D** | can the key be normalised? | **yes.** The compositor is translation-invariant by construction; `check_bpskin.mjs` now pins that |
| **E** | would any existing gate have caught this? | **no.** Nothing asserted the cache was read. §6 is the gate that would have |

---

## 1. The bug, from source

`client/src/board/skin/bpSkinTexture.ts:88-107` (as it stood):

```ts
const key = def.id + '|r|' + cells.map((c) => c[0] + ',' + c[1]).sort().join(';');
const comp = compositeSkin(cells, def, def.palette.canvas || '#000000', { cellPx: CELL, margin: MARGIN }, raster);
const hit = textures.get(key);
if (hit) return { tex: hit, r0: comp.r0, c0: comp.c0 };
```

`comp` is computed unconditionally, one line above the lookup that was supposed
to make it unnecessary. It is needed on the hit path only for `r0`/`c0` — and
those are `Math.min` over the cell set (`composite.ts:93`), not a product of the
distance transforms.

What `compositeSkin` actually does per call (`composite.ts:90-130`): builds a
silhouette over W×H, then `edtToTrue()` **three times** (`:106`, `:108`,
`:111`), then a full per-pixel composite loop (`:117`).

Call site: `BoardRenderer.ts:663`, inside `render(state)`'s per-BP loop —
`bpSkinSprite(cells, bpSkinDefs()[bpSkin.skinId], …)` → `textureFor`.
`render(state)` runs on every state change, every squad switch, and on drag-arm
(`BoardRenderer.onGlobalPointerMove:1770`), and `App.tsx` keeps the canvas board
and the inventory board mounted together, so both pay it.

### Measured

Real module via `vite ssrLoadModule`, `CELL=80`, `margin=1`, 20 iterations after
a warm-up:

| BP shape | composite canvas | per call |
|---|---|---|
| 1×1 | 240×240 = 57,600 px | **11.2 ms** |
| 1×2 | 320×240 = 76,800 px | **13.4 ms** |
| L-tromino | 320×320 = 102,400 px | **18.2 ms** |
| 2×3 (six cells) | 400×320 = 128,000 px | **23.1 ms** |

A canvas holding four skinned BPs was therefore spending on the order of
**50-90ms of main-thread work inside every single `render(state)`**, and again
on the inventory board. REQ-0345 had just removed the always-on Ticker to stop
exactly this class of waste; this was quietly eating the proceeds.

---

## 2. Why the key was wrong too

`compositeSkin` is translation-invariant, and not by accident of the inputs:
`composite.ts:93` takes `r0`/`c0` to be the cell set's own min row/col and the
whole function then works in that relative frame (`:102` derives its cell index
as `(cr - r0) * 1000 + (cc - c0)`). Two translations of one shape produce
identical `rgba`, `layer`, `width` and `height`, and differ **only** in
`r0`/`c0`.

So the old key was strictly more specific than the pixels it named. A player
nudging a BP one cell got a brand-new 128,000-pixel composite for an image the
cache already held, and 64 such entries later the cache flushed itself.

This is the half that made the cost *recurring* rather than a one-off per
session, and it is why fixing only the ordering would have left most of the
regression in place.

---

## 3. Why the eviction was a correctness bug, not just a blunt one

```ts
if (textures.size >= MAX_TEXTURES) { for (const t of textures.values()) t.destroy(true); textures.clear(); }
```

The comment defended this as "Wholesale eviction is fine — the next render
rebuilds whatever is actually on screen." That reasoning holds for **one**
board. There are two:

- `textures` is module-global.
- `App.tsx:158` and `:253` keep the inventory board and the canvas board mounted
  simultaneously.
- A board repaints on **its own** state changes (REQ-0345: on demand, no
  Ticker).

So a flush triggered by whichever board rendered second destroyed textures whose
`Sprite`s were still parented in the *other* board's `gSkins` — and that board
had no reason to repaint, so it went on holding destroyed textures. With the old
position-keyed cache, reaching 64 entries took only a few dozen BP moves.

`invalidateBpSkinTextures()` keeps its `destroy(true)`: that one is a
caller-driven full reset for a runtime skin swap, where a re-render is
guaranteed to follow. Left as-is deliberately, and noted here rather than
silently changed.

---

## 4. Scope

`client/src/board/skin/bpSkinTexture.ts` only, plus its gates.

- **Cache before composite.** `r0`/`c0` are computed once at the top of
  `textureFor` from the cell set, and serve **both** the normalised key and the
  caller's board placement. `compositeSkin()` moves below the lookup and runs
  only on a miss.
- **Shape-normalised key.** Cells are offset by `r0`/`c0` before the key is
  built, so every translation of a shape shares one entry. The key space becomes
  (skin × shape) — bounded and small.
- **LRU eviction that cannot destroy a live texture.** A hit re-inserts its key
  (JS `Map` preserves insertion order, so this is the whole LRU), and eviction
  takes the coldest key and **drops the map entry without `destroy()`**. That
  hands the `Texture` to Pixi's `GCSystem`, which unloads it only once nothing
  has drawn it for `gcMaxUnusedTime`; an on-screen sprite keeps touching it and
  so keeps it alive. Bounded map, and no path left to destroy something still
  being drawn.
- **Stale comments corrected.** The header claimed BoardRenderer was "1664
  lines" (it is 1995) and the tile note said "CELL=48" (it is 80). Both now say
  the thing that stays true.

### Explicitly NOT in scope

Named here so they are not silently lost — each wants its own REQ:

- `MonitorRenderer.mount()` still calls `app.init()` with no `autoStart:false`,
  so REQ-0345's on-demand rule was never applied to it. Its `destroy()` is one
  line against `BoardRenderer.destroy()`'s 26 and releases no tickers,
  subscriptions or sinks of its own.
- `BoardRenderer.render()` is 959 lines (`:518-1476`). REQ-0145b deferred that
  split as known debt to "that rework", pointing at REQ-0125b — which sits in
  `draft/`, is blocked on REQ-0128, and is about unit-skin resolution. **The
  deferral has no owner REQ any more.**
- Three orphaned JSDoc blocks in `BoardRenderer.ts` describe functions that now
  live elsewhere (`:128` `mapPt` → `geom.ts:74`; `:1978` cross-board socket
  preview → `commits.ts:360`; `:1986` ghost PO art).
- No `max-lines` / `complexity` rule in `eslint.config`, so file-size debt has
  no automatic brake.
- No app-level `webglcontextlost` handling. Pixi's `GlContextSystem:103-104`
  registers its own, but the externally-created `Texture.from(canvas)` rasters
  this module makes have no tested restore path — and REQ-0031's freeze lived in
  this exact area.

---

## 5. Risks

| risk | mitigation |
|---|---|
| normalisation over-collapses two different shapes | `check_bpskin.mjs` asserts same-cell-count/different-shape composites differ, and that the normalised key keeps them distinct |
| a future compositor stops being translation-invariant, silently serving a wrong texture | the invariant is now an assertion, not an assumption: `check_bpskin.mjs` pins pixel/layer/extent equality across translations for four shapes, and that `r0`/`c0` are the cell set's own mins |
| `r0`/`c0` recomputed here drift from `composite.ts`'s | same gate asserts the equality |
| not destroying on evict leaks GPU memory | it does not: `GCSystem` (`gcMaxUnusedTime` 60s) unloads an untouched texture. The map stays bounded at `MAX_TEXTURES` |
| the e2e probe reads zero because the fixture never had a skin at all | `waitForFirstComposite()` fails loudly on that, and both tests assert `hits > 0` in the same test as the zero — paintProbe.ts's stated lesson, applied |

---

## 6. Gates

- `client/scripts/check_bpskin.mjs` — 21 new assertions: translation-invariance
  (extent, pixels, layer map, origin tracking, `r0`/`c0` = mins) across 1×1,
  1×2, L-tromino and a holed 8-cell shape; shape-distinctness; and the
  normalised key builder mirrored as data.
- `client/e2e/bpskin-composite-cache.spec.ts` — new. Counts composites instead
  of timing renders, because a wall-clock threshold for "fast enough" is exactly
  what CI reports as a flake on a loaded box.
  1. six inventory-tab switches over an unmoved board → **0 composites**, `hits`
     climbing.
  2. dragging the BP to a new cell → **0 composites**, `hits` climbing, and the
     move proved by reading the saved profile back.
- `client/src/board/skin/bpSkinProbe.ts` — new. Pure-data counters on
  `__backpackDebug`, the shape `paintProbe.ts` established.

The fleet is files-backed and serves **no** adopted skin artwork, so the spec
adopts art for every `slot:"bpskin"` default by mutating `/api/content` in
flight — the same technique, and the same reason, as
`unit-skin-fallback.spec.ts`.

---

## 7. Results

Recorded 2026-07-30 on llmlocal, branch `req-0350-bpskin-composite-cache`.

**Deliberate-regression check — each test guards its own half.** The fix was
un-done one half at a time, rebuilt, and re-run:

| build | test 1 (repeat renders) | test 2 (BP moved) |
|---|---|---|
| both halves fixed | **pass** (0 composites) | **pass** (0 composites) |
| key reverted to absolute cells | pass | **fail — 1 composite** |
| composite moved back above the lookup | **fail — 3 composites** | **fail — 4 composites** |

Test 1 stays green under the absolute key, which is correct and is the point:
an unmoved board never changes its key, so that half is invisible to it. Test 2
is the one that sees it.

**Suite.** `pnpm run build` (tsc -b) clean. `oxlint`: 45 warnings / 0 errors,
**identical to the master baseline**, and 0 warnings on all four touched files.
`check_bpskin.mjs`: ALL GREEN. Full scoped e2e (213 tests): **210 passed, 1
skipped, 2 failed — and the 2 were this REQ's own spec run against a stale
`web/app/` bundle before the docroot was rebuilt.** After the rebuild, both
pass; the other 210 were green throughout, i.e. no regression anywhere in the
suite.

**Not committed here:** the `web/app/` dist rebuild. The e2e serves the built
docroot, so a rebuild is required to run the gates, but this repo carries dist
rebuilds as their own `tools/release.sh` commit — so that is left for release
rather than mixed into a source REQ.
