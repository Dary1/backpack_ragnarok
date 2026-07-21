# REQ-0273 - Inventory unit-art opacity, PO/unit-cell overlap, per-PO cell outlines

**Slug:** inventory-unit-art-po-outlines
**Commissioned:** 2026-07-21, by the user in the post-REQ-0266-deploy review session
(three items reported together; all three are client board-display work).

## 1. Goal

Three items on the client board stack, in the user's severity order:

1. **BUG** - unit art renders semi-transparent ONLY on the inventory board. It must
   render at full opacity there, as everywhere else.
2. **BUG** - a PO (placeable object) was seen overlapping a unit's own cell on an
   inventory page. The user's words: 絶対にあり得てはいけない. Root-caused below as a
   DATA-level placement bug, with a read-time normalization rule for poisoned saves.
3. **FEATURE** - per-PO cell-footprint outlines, so players can read which cells
   belong to which item on a crowded board.

## 2. Investigation - root causes and regression verdicts

### 2.1 Bug 1: inventory unit art at alpha 0.44

`client/src/board/BoardRenderer.ts` (unit draw site):

    sprite.alpha = ops.isCanvas ? 1 : INV_UNIT_ALPHA * 2;   // 0.22 * 2 = 0.44

Git evidence (`git log -L`): the line landed in **REQ-0030 Phase 2 (`b1d5e2b`)** as
`INV_LINKER_ALPHA * 2` (renamed REQ-0124, `5b876c7`). REQ-0266's merge (`5da7883`)
did not touch it. **Verdict: NOT a REQ-0266 code regression - pre-existing dimming
rule, newly visible.** Before REQ-0266 no unit raster existed on any board
(`check_unit_icon.mjs:107` pinned `unitIconRasters().length === 0`; REQ-0226, which
would feed default unit art into `art_urls`, is still draft), so the only thing this
line ever dimmed was the legacy `icon-unit_core` SVG glyph - dim-rune-as-dormancy, the
deliberate REQ-0030 "dormant unit" visual. REQ-0266 fed the `skin` rung for real, so
actual character art started flowing through the same line at 0.44 and reads as a
rendering defect.

Fix (render layer, where the defect is): real art (resolver rungs `skin`/`default`)
draws at alpha 1 on every board. The legacy glyph keeps the REQ-0030 dormancy dim in
the inventory - it is a placeholder UI symbol, not art, and boards with no unit art
stay pixel-identical.

### 2.2 Bug 2: PO on the unit cell - a DATA-level placement bug (verdict a, not b)

Reproduced against the real engine (node, `mock-src/engine.js` driven with the
verbatim client logic): **`client/src/lib/placement.ts` `firstFitPlaceBp()`** - the
gacha/workshop/market "claim a rolled BP" path (WorkshopPage.tsx:239,
useWarehouseData.ts:185) - pushes its placeholder BP record at **`origin:[1,1]`**
before scanning. `engine.invMoveBP()` then infers the BP's travelling contents
GEOMETRICALLY: `inside = container.pos.filter(p => poInBPIn(p, bp))` against the
placeholder's fake [1,1] footprint. Any unrelated free-placed PO inside that
footprint is captured as "contents", excluded from the legality check (`exclUids`),
and **teleported by the move delta into the new BP's footprint**. The relative
offsets are preserved, and the destination footprint is otherwise clear, so the ONE
illegal outcome the capture can produce is exactly a PO landing on the unit cell
(the unit cell is not in `invOccupancy`; everything else in the footprint was
verified free). Repro transcript (engine answers, not client guesses):

    scan found origin: [1,3]; invMoveBP: {ok:true}
    BP origin [1,3], unit cell [3,4]; dagger was [3,2] -> AFTER: [3,4]  == unit cell
    engine.invCanPlacePO(st,0,'p1',0,[3,4]) -> {ok:false, why:'Unit cell'}

The engine's own placement law is NOT the gap: `invCanPlaceCells` has refused
'Unit cell' since REQ-0092 (which fixed the direct-placement gap block-new-only and
left no read-time rule). The renderer is innocent: it draws the unit at
`engine.unitCell(bp)`, the same cell validation uses - there is no offset.

Git evidence: `firstFitPlaceBp` predates REQ-0266 (`git log --follow
client/src/lib/placement.ts`: REQ-0145b move, REQ-0170 unit shape; REQ-0195d wired
the market path). REQ-0266's merge touched neither `placement.ts` nor `engine.js`.
**Verdict: NOT a REQ-0266 regression - pre-existing data-level bug, made obvious by
REQ-0266** (the unit cell now visibly carries opaque art in the inventory; before,
the collision hid under a 0.44-alpha rune).

A second, race-only producer was found while auditing every mutation path:
`commitPODrop()`'s inv->inv branch (client/src/board/commits.ts) splices the PO into
the destination page FIRST and validates after; a commit-time refusal (possible only
if state mutated between hover-preview and pointerup - e.g. a background claim)
strands the PO at its stale source-page coordinates unvalidated. Hardened in the
same change (splice back on refusal). All other paths audited clean: invMovePO /
invRotatePO (REQ-0092 law), invMoveBP/invRotateBP on real BPs (rigid transforms),
canTransferBP* (footprint occ checks include the unit cell), migrateStateV2/V3 +
firstFitCell (route through invCanPlaceCells), firstFitPlace po/si (placeholder is
self-excluded only), TM paths (1x1, BP-overlap refused).

**Persisted poison rule (house precedent: resolve at READ time, never rewrite user
data silently):** `migrateState()` (mock-src/engine.js - the one read-time chokepoint
every boot already runs) gains a v4 normalization pass: any page-resident grid PO
whose footprint intersects that page's unit-cell map is RELOCATED first-fit (same
page first, then following pages - the exact overflow discipline migrateStateV2
already uses), rot preserved, uid/id untouched. If no page can host it, it is LEFT
IN PLACE: a visibly-overlapped-but-draggable item beats silent data loss. The pass
is idempotent (clean states have no overlaps) and documented at the function. Canvas
containers are not swept: the canvas law has refused 'Unit cell' since the beginning
and no canvas producer was found.

### 2.3 Feature: per-PO cell-shape outlines - design

Existing language studied first: BP = 3px OWN-COLOUR outline centred ON the footprint
boundary (gBase); merged assembly = #d7dfe6 1.5px boundary trace; cel-shaded flat
fills, dark grid (#191919 cells / #242424 lines), BP tint washes at 0.26, REQ-0033
usage washes (OVERLAY palette) at ~0.35, REQ-0266 skin rasters under gItems.

Decisions (documented as built):

- **Geometry:** each placed PO gets its footprint boundary traced (same neighbour-
  edge walk as the BP outline), then **inset 3px INSIDE the footprint**. Inset is
  what makes two adjacent POs read as two: each keeps its own closed loop with a
  dark seam between them, and the PO line can never sit on top of the BP's own
  boundary-centred 3px colour outline.
- **Stroke: two-tone "ink + rim"**, the cel look's own trick: a 4px near-black ink
  band (#0e0d0b, alpha 0.85) with a 1.5px pale-steel rim (#d7dfe6, alpha 0.8 - the
  merged-assembly outline's exact colour family) centred on the same path. The dark
  halo separates the rim from bright backgrounds (BP tints, skins, washes); the
  light rim separates it from the dark grid. One calm neutral for every item - item
  identity stays the art's job; the outline's job is only "these cells are mine".
- **Layering:** drawn into gItems ABOVE the PO's own sprite. Art is contain-fit into
  the footprint BOUNDING BOX, so an L/T-shaped PO's art can overhang cells outside
  its true footprint - the outline must cut that lie, or it is decoration. gUnits
  stays above gItems (REQ-0266 invariant untouched).
- **States:** normal = the outline. dragging = unchanged existing language (the
  carried PO vanishes from the board; the OVERLAY ok/bad cell tints + ghost already
  own that state; adding a second boundary system there would be noise). invalid-
  at-rest = structurally impossible after item 2 (engine law + read-time
  normalization); the transient invalid preview stays the red OVERLAY tint.
- **Scope:** POs only (both boards - same draw loop). Free SIs/TMs are 1x1 chips
  with their own contained visuals; outlining them would wireframe a TM-heavy page
  for zero disambiguation gain. Merged-assembly keeps its own existing outline.

## 3. Ships - file by file

1. `client/src/board/poOutline.ts` (new) - pure rectilinear footprint-boundary
   tracer + 3px inward inset + the two-tone stroke constants; node-testable.
2. `client/src/board/BoardRenderer.ts` - (bug 1) alpha rule by resolver rung;
   (feature) outline draw in the placed-PO loop, eventMode='none'.
3. `client/src/lib/placement.ts` - (bug 2 producer) placeholder BP origin sentinel
   [-100,-100]: off-grid, so invMoveBP's geometric contents-inference can capture
   nothing. invCanPlaceBP never reads the placeholder origin (verified).
4. `client/src/board/commits.ts` - (bug 2 hardening) inv->inv PO splice rolls back
   when the destination page refuses at commit time.
5. `mock-src/engine.js` - (bug 2 read-time rule) migrateState v4 normalization pass.
6. `mock-src/tests/run.cjs` - engine tests: v4 relocates a poisoned PO (same page /
   overflow / full-everywhere leaves in place), idempotent, no-op on clean states.
7. `client/scripts/check_placement.mjs` (new) - drives the REAL placement.ts +
   engine.js: a rolled-BP claim with a free PO near [1,1] must not move that PO;
   result must satisfy invCanPlacePO for every page PO.
8. `client/scripts/check_po_outline.mjs` (new) - loop/inset geometry goldens: 1x1,
   2x2, L (rot 0..3), two touching-corner cells; closure + collinear merge + inset
   arithmetic.
9. `client/e2e/inventory-art-integrity.spec.ts` (new) - four tests, pixel-probe
   pattern of unit-skin-fallback.spec.ts test 4:
   1. inventory unit art full opacity (injected skin raster; probe = full-strength
      colour, not the 0.44 blend);
   2. drag a free PO onto an inventory unit cell -> refused, state unchanged;
   3. poisoned save (PUT with PO on unit cell) boots un-overlapped - unit cell shows
      no PO art, PO renders at its relocated cell;
   4. busy board (adjacent POs, skinned BP, usage wash) - rim present along the
      inset boundary band, absent at cell centres.
   Screenshots env-gated via REQ0273_SHOTS for the visual-evidence deliverable.
10. `web/app` - committed rebuild (worktree build lacks client/.env.local supabase
    env by convention; deploy rebuilds on main - noted per house rule).

## 4. Gates

- `SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh`, then full `tools/ci.sh`
  (HOME-remap bridge /tmp/h0273, DATABASE_URL from server/.env). Known tolerable
  e2e reds (signature-verified only): forecast.spec.ts:206, schedule.spec.ts:1451,
  reference-model.spec.ts:125.
- Scoped hermetic e2e, REQ-0273 decade: proxy 7732, fleet 7734+.
- New node gates: check_placement.mjs, check_po_outline.mjs, run.cjs additions.

## 5. Landmines

- BoardRenderer invariants (REQ-0266): unit core disc = BP drag handle, hit-testable;
  gUnits after gItems; decorative sprites eventMode='none'; only real-art skins
  paint; usage wash in gSkins. bp-rotate/bp-transfer specs fail loudly if slipped.
- mock-src/engine.js is gate-guarded (engine.d.ts parity check, run.cjs, sim
  goldens); v4 adds no export and changes no existing function's semantics.
- e2e serves the COMMITTED web/app build - rebuild before any e2e run.
- Unit raster URLs must end .png for Pixi's loader (unitIcon.ts unitArtUrl note);
  e2e injects art via route-fulfilled /api/art/e2e_*.png, not data: URLs.
- placement.ts sentinel relies on invCanPlaceBP never reading placeholder origin -
  check_placement.mjs pins the whole behaviour, not the implementation detail.


---

## 7. Outcome — verification pass, 2026-07-21

### 7.1 Commits (oldest first, branch `req-0273-inventory-unit-art-po-outlines`)

| commit | what |
|---|---|
| `3a28ffe` | reserve stub (allocator) |
| `f922dfd` | this spec |
| `7125aba` | reserved -> todo (user commissioned all three items this session) |
| `76cfad3` | the implementation: BoardRenderer alpha rule + outlines, poOutline.ts, placement.ts sentinel, commits.ts rollback, engine v4 + run.cjs tests, check_placement/check_po_outline, e2e spec |
| `b2ff252` | e2e fixture hardening (pick-rung skin injection) + web/app rebuild |
| `9ec6b3c` | ci.sh wiring: [5.9e/7] check_placement, [5.9f/7] check_po_outline |
| `ac896de` | deliberate legalization of two e2e fixtures that DEPENDED on the forbidden overlap (bp-rotate, workshop covered-BP) |
| `95c8a2c` | pixel probes poll for board steady state (async raster decode vs fleet load) |

### 7.2 Investigation addenda (found while building; all verified)

- **The engine-test fixture was poisoned too.** `mock-src/tests/run.cjs`'s REQ-0033
  exclusion-set test used a 2-cell box BP holding two POs — one necessarily ON the
  unit cell. v4 relocates it at read time and the exclusion dissolved. Fixture
  legalized to a 3-cell box (assertions unchanged, including the [3,4] nested-slot
  negative). Same treatment for `bp-rotate.spec.ts` (contained PO (4,3) -> (4,2),
  rigid-rotation assertions remapped) and `workshop.spec.ts`'s covered-BP (4 POs ->
  3; "fully covered" is redefined by law — the unit cell is not coverable).
- **e2e skin injection must use the PICK rung.** The live corpus already ships a
  default `slot:"unit"` skin per unit (`uskin_<unit>`); an injected rival default
  loses `defaultUnitSkinId`'s first-match and resolves to UNADOPTED art — the chain
  then answers null, correctly. `inventory-art-integrity.spec.ts` injects a
  non-default def and picks it via the stubbed prefs route.
- **PixiJS v8 loads board textures in a dedicated worker** (`WorkerManager.
  loadImageBitmap`); its fetch bypasses Playwright `page.route()`. Route-fulfilled
  `/api/art/*.png` art can never reach the board in e2e — inject `data:image/png`
  URLs instead (sprites.ts names its parser explicitly, so no extension sniffing).
- **Scoped e2e runs need `E2E_GPU=1` on this box.** ci.sh's [7/7] sets it by
  default; a scoped run without it renders on SwiftShader, runs ~3x slower and
  drowns in interaction-window flakes. (One 12-red run mid-investigation was a
  self-inflicted double-launch port collision; discarded as evidence.)

### 7.3 Gate results

- `HOME=/tmp/h0273 SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh` -> **CI GREEN**.
- Full `HOME=/tmp/h0273 DATABASE_URL=… tools/ci.sh` (run 3, final code): every step
  through [6.5/8] green (`[art_jobs] numpy` noise inside passing steps, documented
  benign); [7/7] fleet (GPU, 4 workers): **194 passed / 1 skipped / 2 failed — both
  the documented load flakes, signatures verified: `forecast.spec.ts:206`
  (slot-pressure toBeVisible timeout) and `schedule.spec.ts:1451`.**
  `inventory-art-integrity.spec.ts` 4/4 green inside the fleet; `bp-rotate`,
  `bp-transfer`, `workshop` green.
- mock-src/tests/run.cjs: **123 passed, 0 failed** (4 new v4 tests).
- check_placement.mjs / check_po_outline.mjs: all green (now ci steps 5.9e/5.9f).
- Stability: bp-transfer + baseline-smoke 9/9 x3 consecutive GPU rounds (one
  earlier bp-transfer:103 red at P4 mid-thermal did not reproduce; drag-commit
  timeout signature, not an assertion diff).
- Pre-fix baseline (master bundle, final spec): tests 1/3/4 fail exactly on the
  three defects (fullGreen 0; unit-cell itemBackdrop 0.98; rim 0), test 2 passes
  (the engine law predates this REQ). That asymmetry IS the regression pin.

### 7.4 Visual evidence (before = master bundle, after = this branch)

`req0273_screens/`: `before/after_inventory_unit_alpha.png` (dim 0.44 green art vs
full opacity), `before/after_po_unit_overlap.png` (hilt stacked on the unit cell vs
the same poisoned save booting with the hilt relocated to (1,1), unit cell clean),
`before_busy_no_outlines.png` / `after_busy_outlines.png` (adjacent blade|dagger
fuse vs two rims + seam; beast-jaw L traces its true concave footprint; shield
outline reads over the usage wash; flask outlined inside the BP without touching
the BP's own 3px colour boundary; centres stay clean — no wireframe).

### 7.5 Landmines confirmed/added

- BoardRenderer invariants held: unit core disc = BP drag handle (bp-rotate/
  bp-transfer green), gUnits after gItems, outline + all decorations
  `eventMode='none'`, skin guard untouched, usage wash in gSkins.
- migrateState v4 is the ONLY read-time rewrite and only for the unit-cell
  overlap class; leaves data in place when no page can host; idempotent.
- Any FUTURE fixture that parks a PO on a unit cell will drift at boot BY DESIGN —
  legalize the fixture, do not weaken v4.

## 8. State log
- 2026-07-21 reserved (stub, 3a28ffe).
- 2026-07-21 reserved -> todo (7125aba; ratified by the user's same-day report).
- 2026-07-21 implemented + gates green (76cfad3..95c8a2c, see 7.1/7.3).
- 2026-07-21 todo -> built. NOT merged, NOT deployed; user acceptance pending.
