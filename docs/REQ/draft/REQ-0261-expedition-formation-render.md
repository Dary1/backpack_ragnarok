# REQ-0261 — expedition-formation-render: drawing both `IBattleInstancesFormationMap`s at CELL=40

**Status:** draft — spec written, BLOCKED on user review. Three things need the user before work may
start: (1) §4 — spec (d) 「Backpacks画面をそのまま1/2のサイズにして、持ってきて」 cannot be satisfied by
reusing `BoardRenderer`, and this REQ proposes a new read-only renderer instead; the user asked for
"the same screen", and "the same LOOK, rebuilt read-only" is an interpretation; (2) §8 — the enemy
plane **cannot be drawn at all** today: no static enemy positions exist on the wire, and closing that
needs a server change plus a spoiler ruling; (3) §8.3.1 — monster art EXISTS but its footprints have
**drifted from the art** (REQ-0188 left `derive --write` unrun), so drawing art at the def footprint
is knowingly, visibly wrong for at least `frost_gnoll`.
**Reserved:** 2026-07-18
**Slug:** expedition-formation-render
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec items (d), (e), (f).
**Depends on:** **REQ-0260** (expedition-fullscreen-route) — the shell, the stage, the fit-scale, the
clock, the constants module. **REQ-0258** (formation-map-padding) — `formation4.unit4 = J10:Q17` and
the validator that makes the ring unoccupiable. **REQ-0255** transitively (REQ-0240's roster).
**Blocks:** REQ-0262 (expedition-ray-vfx), REQ-0263 (expedition-instance-hud).
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §2, §6.

## 1. Goal

Fill the two empty planes REQ-0260 draws. Per spec (d)/(e)/(f):

- **(d)** the player plane shows the Backpacks board composition at CELL=40, four squads laid out per
  the adopted formation;
- **(e)** the enemy plane is the SAME size as the player plane;
- **(f)** each plane is 26x18 with a padding-1 ring drawn in a distinct colour, which **no instance
  may occupy** — enforced by the validator (REQ-0258), not merely by the renderer.

**Static composition only.** Rays are REQ-0262. HP bars, cooldown overlays and charge rings are
REQ-0263. This REQ draws the board as it stands and re-draws it when the data changes.

## 2. Verified current state — I read every one of these

| fact | source | evidence |
|---|---|---|
| the Backpacks canvas is **8x8**, not 26x18 | `content/live/scenario.json:249` | `"ROWS": 8` (and `COLS: 8`); `GameData.LAYOUT` (`api/content.ts:51`) feeds `BoardRenderer.mount`'s `PAD*2 + COLS*CELL` = **716x716** |
| `BoardRenderer.render` needs a live engine + GameState | `BoardRenderer.ts:323` | `render(state: GameState)`; `const { engine, items, textures, layout, ops } = this.deps;` |
| …and a `BoardOps` bound to local state | `BoardRenderer.ts:96-108` | `BoardDeps { engine: EngineInstance; …; ops: BoardOps }` |
| the unit core is drawn with a **literal**, not the constant | `BoardRenderer.ts:928` | `core.circle(x, y, 26);` — while `geom.ts:42` exports `UNIT_CORE_RADIUS = 26` |
| the unit art box is also a literal | `BoardRenderer.ts:973` | `fitSpriteToBox(sprite, x - 22, y - 22, 44, 44)` |
| direction dots are literals | `BoardRenderer.ts:1000-1006` | `dot.circle(x + cos*30, y + sin*30, 4)` |
| `chargeRing` IS parameterised | `chargeRing.ts:124-125` | `radius: number = RING_RADIUS, width: number = RING_WIDTH` |
| the monitor already draws 4 squads read-only on 26x18 | `MonitorRenderer.ts:213-300` | `mountSquads()` + `parseBoxToPixelRect(squad.box, FIELD_CELL_PX)` + `computeFootprintCells` |
| …but at a **module-const** cell size | `MonitorRenderer.ts:30-33` | `export const FIELD_CELL_PX = 18;` / `FIELD_W = FIELD_COLS * FIELD_CELL_PX` — 21 references in that one file |
| `parseBoxToPixelRect` IS parameterised by cell px | `fieldGeometry.ts:88` | `parseBoxToPixelRect(box: string, cellPx: number)` |
| ray cells arrive as `[row,col]` NUMBER TUPLES | `fieldGeometry.ts:29-60` | the `RawCell` type + the BUG#4 crash-loop postmortem |
| symbols rasterize at **2x** | `sprites.ts:56` | `const RASTER_SCALE = 2;` |
| the sprite sheet is **v12**, not v11 | `sprites.ts:53` | `import spriteSheetSource from '../../../content/sprite_all_v12.svg?raw';` |
| the texture map is **shared and cached** | `sprites.ts:229-247` | `let boardLoadPromise` — one `Map<string,Texture>` per session for every board |
| Pixi mipmaps are **OFF** by default | `pixi.js@8.19.0` `TextureSource.mjs:75` | `this.autoGenerateMipmaps = false;` |
| monster ids ARE in the art map | `server/lib/content.cjs:230-241` | REQ-0208: `Object.keys(monstersFromCore().monsters || {})` joins `computeArtUrls()` |
| …and reach the board texture map | `store/boot.ts:181` -> `itemArt.ts:47-55` | `setItemArtUrls(gameData.ART_URLS)`; `itemIconRasters()` emits `item:<id>` for EVERY key |
| the enemy side draws a **1x1** rect, not a footprint | `MonitorRenderer.ts:454` (0240) | `graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX)` |
| `MonitorEnemyDef` is **declared but never used** | `MonitorRenderer.ts:101` | zero references tree-wide (`git grep`) |
| footprint is `[fh, fw]` — HEIGHT FIRST | `shared/content_validate.cjs:472-479` | `const fh = fp[0]…; const fw = fp[1]…; for (dr<fh) for (dc<fw) cells.push([row+dr, col+dc])` |
| the roster drops the enemy's POSITION | `server/services/pacing.cjs:226-237` | dedups on a key containing `m.at`, then emits `{id,name,nameJa,hpMax,footprint,packId}` — **no `at`** |
| the enemy's field cells exist server-side | `sim/lib/packs.cjs:38` | `fieldCells: cellsFor(anchor, def.footprint || [1,1])` — never serialised |
| `PLACEABLE` already mirrored client-side | `contentShared.ts:373-374` | `export const FIELD_COLS = 26, FIELD_ROWS = 18;` + `PLACEABLE = {colMin:2,rowMin:2,colMax:25,rowMax:17}` |

## 3. THE BUG: the small monitor has NEVER drawn a real formation box

Found while tracing spec (d)'s squad placement. **This is live on `master`, on `req-0239` and on
`req-0240`.** It is not a finding about the expedition — it is a finding about the code the
expedition was told to copy.

`content/live/dungeon/formations.json` keys each formation's boxes **`unit1`..`unit4`**:

```json
"canvases": { "unit1": "F2:M9", "unit2": "N2:U9", "unit3": "B10:I17", "unit4": "R10:Y17" }
```

`server/services/core.cjs:389-394` (`listDungeonsAndFormations`) passes them through **verbatim**
(`canvases: f.canvases`), and `ApiFormationEntry.canvases` is `Record<string,string>` — so the client
receives `unit1..unit4`. Verified by loading the real file: every one of the 4 formations has exactly
the keys `["unit1","unit2","unit3","unit4"]`.

`client/src/schedule/Monitor.tsx:446` (master; `:180` on the 0240 branch) looks up:

```ts
const withRealBoxes = squads.map((u) => ({ ...u, box: formation?.canvases[`squad${u.slotIndex + 1}`] ?? u.box }));
//                                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^ always undefined
```

**`canvases['squad1']` is `undefined`, always.** `box` therefore stays its placeholder — which
`Monitor.tsx:394` set to the literal string `` `squad${idx + 1}` ``. Traced through the real code
(executed under node against the real `formations.json`, not read):

```
parseBoxToPixelRect("squad1", 18)
  "squad1".split(":")            -> ["squad1"]            (no colon)
  tl = "squad1", br = undefined
  cellIdToColRow("squad1")       -> /^([A-Za-z]+)(\d+)$/ MATCHES: letters "squad", digits "1"
                                 -> col = colLetterToIndex("squad") = 'S' - 'A' + 1 = 19, row = 1
  cellIdToColRow(undefined)      -> {col: 1, row: 1}      (the defensive fallback)
  rect.w = (1 - 19 + 1) * 18 = -306 px
  rect.h = (1 -  1 + 1) * 18 =   18 px
```

`rect.w <= 0`, so `MonitorRenderer.mountSquads:227-238` takes its REQ-0169 M3 degenerate-box branch:
**four dim fallback outlines in a row, plus four `console.warn`s, on every room open.**

Two things make this worse than a typo:

- **REQ-0169 M3 saw the symptom and shipped a fallback.** Its own comment (`MonitorRenderer.ts:228-231`)
  reads: *"a degenerate box (w/h 0) means the formation-canvas JOIN failed silently upstream
  (Monitor.tsx's fetchDungeons lookup returned no real 'F2:M9'-style box, so the placeholder 'squad1'
  string parsed to a zero-size rect)"*. It diagnosed the cause **exactly**, then made the failure
  visible instead of fixing the one word that caused it. The fallback has been rendering ever since,
  and because it draws four plausible 8x8 squares in a row, it looks like it works.
- **The comment two lines from the bug describes the CORRECT key.** `Monitor.tsx:422-423`:
  *"`box` above is a placeholder key (**"unit1".."unit4"**)"* — while `:394` writes `squad${idx+1}`.
  The comment is a fossil of the right design; the code drifted and the comment did not.

**Fix (one word, both sites):** `canvases[`unit${u.slotIndex + 1}`]`, and the placeholder becomes
`unit${idx+1}` to match its own comment. **This REQ owns the fix**, because REQ-0261 must perform this
exact join and shipping the expedition with a copy of the broken key would double the bug. It is the
one and only edit this REQ makes to the small monitor's files, it is a strict bug fix, and it makes
the small monitor start drawing real formation boxes for the first time — a **visible change** to
`#/schedule`, which the user should expect. 「今ある画面は放置して」 means *do not redesign it*; it cannot
mean *keep it broken*.

**Pin it:** a test that for every formation in the dungeons payload, every `canvases` key the client
looks up resolves to a string matching `/^[A-Z]\d{1,2}:[A-Z]\d{1,2}$/`. The reason this survived is
that nothing ever asserted the join produced a BOX — the same shape of failure as REQ-0258's
8x8-only validator, and the same lesson: *a gate that watches one half of a rule watches none of it.*

## 4. What is reused, and what is rebuilt — the real recommendation

Spec (d): 「Backpacks画面をそのまま1/2のサイズにして、持ってきて」 — *take the Backpacks screen as-is at
half size and bring it over*. Three candidate readings; only one survives contact with the source.

### 4.1 Option A — reuse `BoardRenderer` at CELL=40. REJECTED.

Not "it would be awkward" — **it cannot be called.** `BoardRenderer.render(state: GameState)`
(`:323`) requires:

1. **a live `EngineInstance` and a `GameState`** (`BoardDeps`, `:96-108`). The expedition renders a
   **run** — server data reached through `fetchRun(roomId)`. There is no engine instance for a run.
   `ops.container(state)` returns the caller's own local canvas; a run's squads are not that.
2. **a `BoardOps`** (`:105-107`) — the canvas/inventory engine-call surface (`canPlacePO`/`movePO`/…).
   A read-only view has no mutators to bind and no `boardId` to register.
3. **an 8x8 `layout`** — `mount()` sizes the app `PAD*2 + COLS*CELL` = 716x716 for **one** squad.
   The expedition needs **four** squads at formation coordinates on **one shared 26x18** plane. That
   is not a parameter; it is a different scene graph.

And what `render()` actually does is interleave composition with interaction, inseparably:
`core.eventMode = 'static'; core.cursor = 'grab'; core.on('pointerdown', …)` sits **in the middle of
the unit-drawing loop** (`:929-931`); the constructor wires `globalpointermove`, a window `keydown`,
canvas `pointermove`/`pointerleave` and `registerBoard()` into `drag.ts`'s cross-board registry
(`:224-228`, `wireGlobalInteraction()` at `:1409`); drop-target tints, ghosts, `flash()`, link-trace
rings and beam-hover state are threaded through the same 300-line function. 1682 lines, and the
read-only half is not a layer — it is a co-mingled minority.

"Extract the pure composition path" therefore means **rewriting it**, with the *added* constraint of
leaving the interactive board pixel-identical (REQ-0125a golden G7; the e2e suite selects on
`canvas.board-canvas`). That is the worst of both options: all the rewrite cost, plus a regression
surface on the app's single most important screen, plus a permanent coupling between a read-only
spectator view and a drag-and-drop editor whose requirements will diverge forever.

### 4.2 Option B — parameterise `MonitorRenderer` and reuse it. REJECTED.

Tempting, and much closer than A: `mountSquads()` (`:213-300`) **already** draws four squads read-only
on a shared 26x18 plane, already calls `parseBoxToPixelRect` and `computeFootprintCells`, already
resolves PO icons from the shared texture map. It is the closest correct code in the tree, and if the
user had not constrained it, this would be the answer.

It fails on the user's own constraint. `FIELD_CELL_PX = 18` is a **module constant** with `FIELD_W`/
`FIELD_H` derived at load, referenced at **21 sites** in that file and **exported** for the label-fit
logic. Making cell size an instance field edits **every draw site of the small monitor** — the exact
screen the user said to leave alone (「今ある画面は放置して」). The refactor's blast radius is the thing we
were told not to touch, and its reward is sharing one class between a 468px dev-grade dot-plotter and
a 2112px spectator stage whose fidelity requirements are opposite. (Contrast §3: that edit is one
word, is a bug fix, and is unavoidable.)

### 4.3 Option C — ADOPTED. A new read-only renderer that reuses the PURE modules.

**New: `client/src/expedition/ExpeditionRenderer.ts`.** Framework-free, read-only, cell size a
**constructor parameter** from line one.

```ts
export interface ExpeditionRendererOpts {
  cellPx: number;               // EXP_CELL (40) — a PARAMETER, never a module const (§4.2's lesson)
  textures: Map<string, Texture>;
  layout: 'row' | 'column';
}
```

It reuses, **by import and unchanged**, every module that is already pure:

| module | what it gives | why it is safe to share |
|---|---|---|
| `board/sprites.ts` -> `loadBoardTextures()` | the ONE shared texture map (SVG symbols + `unit:*` + `item:*` rasters) | already module-cached and already shared by three consumers; §6 |
| `render/itemCard.ts` -> `computeFootprintCells(shape, rot)`, `fitBoxInBounds(...)` | rotated footprint + the aspect-law contain-fit | explicitly built to be framework-agnostic and shared by Pixi AND the DOM Dex (`itemCard.ts:1-35`); `MonitorRenderer` already uses it |
| `board/unitIcon.ts` -> `resolveUnitIcon`, `unitIconKey` | the ratified G6 skin chain (skin -> default -> legacy glyph -> placeholder) | *"Deliberately pure: no Pixi, no DOM, no I/O. Availability is injected as a `has(key)` predicate"* (`:22-26`) |
| `board/itemArt.ts` -> `resolveItemIcon`, `getItemArtUrl` | registry-first item/monster art | same shape as `unitIcon`; `:41-55` |
| `board/chargeRing.ts` -> `drawChargeRing(g,x,y,c,radius,width)` | the REQ-0125a G7 clockwise ring | radius/width are already parameters (`:124-125`) |
| `schedule/fieldGeometry.ts` -> `parseBoxToPixelRect`, `cellIdToXY`, `cellIdToColRow`, `RawCell`, `FIELD_COLS/ROWS` | all 26x18 <-> pixel math | `cellPx` is already a parameter of both functions; §7.2 |
| `contentadmin/contentShared.ts` -> `PLACEABLE`, `isPlaceable`, `cellsFor`, `parseA1` | the ring predicate + footprint->cells | REQ-0258 §9.1 names this file as REQ-0261's source for the ring |

**What is genuinely new is small:** a scene graph of two planes, a ring/grid backdrop, a squad-box
pass, a BP/PO/unit pass, and a `setLayout`-shaped reposition. The *composition logic* is ported from
`MonitorRenderer.mountSquads` (the closest correct code) and its *fidelity* is raised to Backpacks
level by calling the same pure helpers `BoardRenderer` calls. **Nothing is copy-pasted from
`BoardRenderer`** — every piece of it that matters was already extracted into the pure modules above.
That extraction was done by REQ-0038 R2 / REQ-0125a / REQ-0133 precisely so a second consumer would
not have to fork the board, and this is that second consumer arriving. Judged by the metric those REQs
set — *"both consumers stay byte-for-byte in sync by construction, not by convention"*
(`geom.ts:157-162`) — option C is the one that uses them and A/B are the ones that bypass them.

**Honest cost of C:** a second renderer that must not drift from the first. The mitigation is
structural, not cultural — the shared modules ARE the anti-drift mechanism (change
`computeFootprintCells` and both move), and §14 pins the one number that is not shared
(`EXP_CELL === CELL / 2`).

**Honest read of spec (d):** the user asked for the Backpacks screen at half size. What C delivers is
the Backpacks *composition* at half size, read-only, four squads at once. The word 「そのまま」 (as-is) is
doing work the code cannot honour — the Backpacks screen is one 8x8 interactive canvas and the
expedition is four 8x8 squads on a 26x18 read-only plane. **This is an interpretation and is flagged
as one** (Status blocker 1).

### 4.4 What is deliberately NOT drawn

The Backpacks board draws things that are meaningless on a spectator plane. Dropping them is not
laziness; drawing them would be a lie:

| Backpacks | expedition | why |
|---|---|---|
| drop-target tints, ghosts, reject `flash()` | **no** | there is no drag |
| the BP move-handle badge (`gBadges`, REQ-0042) | **no** | it is a grab handle |
| empty-socket outlines + glyphs (`SOCK_GLYPH`) | **no** | REQ-0263 may add seated SIs; an EMPTY socket is an editing affordance |
| the chain-link toggle | **no** | canvas-only editing control (`ops.isCanvas`) |
| port target ◇ / connection ◆ marks | **deferred to 0263** | meaningful, but they are HUD not composition |
| beams (`traceBeams`) | **deferred to 0262** | a LIVE link beam is one of §6.0's four sanctioned glows and belongs with the VFX budget |
| BP colour grid tint, BP outline, name label | **yes** | composition |
| placed PO art, unit core + icon, dir dots | **yes** | composition |

## 5. Scale constants — and the one that does not do what it says

### 5.1 The table

| `board/geom.ts` | value | expedition | rationale |
|---|---|---|---|
| `CELL` | 80 | **40**, as `EXP_CELL` in `expedition/expeditionGeom.ts` (REQ-0260 §6) | spec (d). **`geom.ts` is NOT edited** — that would halve the live Backpacks board (REQ-0260 §6.2). |
| `PAD` | 38 | **does not exist** | the padding-1 RING is this plane's margin, in cells, inside the grid. The brief's own C5 arithmetic (26*40 x 18*40 = 1040x720) has no PAD term. REQ-0260 §6.1. |
| `UNIT_CORE_RADIUS` | 26 | **13** | half. **But see §5.2 — halving the constant does not halve the circle.** |
| `SOCKET_SEARCH_RADIUS` | 26 | **not ported** | **Interactive-only.** `geom.ts:11-13`: *"Nearest-socket search radius in board-canvas pixels"* — the drop-time nearest-socket search. A read-only plane performs no drops. Not halved: **absent**. |
| `DRAG_ARM_THRESHOLD` 5, `DBLCLICK_WINDOW_MS` 300, `FLASH_MS` 350, `CLAIM_PULSE_*` | | **not ported** | all interaction-only. |
| `BEAM_HOVER_SLOP` | 12 | **not ported** (REQ-0263 may revisit) | hover-only. Note its doc reasons *"still smaller than half a cell (40)"* — at `EXP_CELL=40` half a cell is **20**, so a reflex halving to 6 would silently invalidate the comment's own argument while looking obedient. |
| `BEAM_DIM_ALPHA` 0.16, `INV_UNIT_ALPHA` 0.22 | | reuse **unchanged** | alphas are not lengths. |
| `chargeRing` `RING_RADIUS`/`RING_WIDTH` | 30 / 3 | pass **15 / 1.5** as ARGS | already parameterised (`:124-125`). **The constants must not change** — REQ-0125a golden G7 pins 30/3 for the Backpacks board. (Consumed by REQ-0263; specified here so the halving lives in one place.) |
| the unit art box | `x-22, y-22, 44, 44` | `x-11, y-11, 22, 22` | a literal at `BoardRenderer.ts:973`, not a constant. §5.2. |
| direction dots | radius 30, dot r 4 | 15 / 2 | literals at `:1000-1006`. §5.2. |

### 5.2 `UNIT_CORE_RADIUS` is a lie the codebase already warned about

`geom.ts:38-42`:

```ts
// REQ-0142: the Unit core circle's radius (BoardRenderer draws it with
// core.circle(x, y, 26)). Named here because the link-trace hover hit-test
// needs the SAME number the core is drawn with -- a hover target that does
// not match its own visual is a bug waiting to happen.
export const UNIT_CORE_RADIUS = 26;
```

`BoardRenderer.ts:928`:

```ts
core.circle(x, y, 26);      // <-- the LITERAL. Not UNIT_CORE_RADIUS.
```

**The constant was introduced to name the draw site's number, and the draw site was never changed to
use it.** Every *consumer* uses the constant (`:558`, `:574`, `:590`, `:1367`, `:1371`, `:127-128` —
link-trace rings, the beam-hover hit-test, the dashed-shadow inset); the *producer* does not. It has
been correct only because both happen to be 26.

Consequence for this REQ, stated plainly so nobody follows the task framing off a cliff: **"halve
`UNIT_CORE_RADIUS` 26->13" changes the hit-test and the link-trace rings and leaves the drawn circle
at 26.** On the Backpacks board that becomes, instantly, the exact bug the comment predicts — *"a
hover target that does not match its own visual"* — with the halved value being 2x wrong.

`geom.ts` is not edited (§5.1), so the Backpacks board is not at risk from this REQ. But the latent
bug is real and one well-intentioned edit away from firing. **Recommended here as a zero-risk fix:**
`BoardRenderer.ts:928` becomes `core.circle(x, y, UNIT_CORE_RADIUS);`. Pixel-identical today
(26 === 26), so no golden moves and no test changes; it makes the constant true, which is the only
state in which anyone can safely reason about it. Name the other three literals at the same time and
for the same zero cost: `UNIT_ART_BOX = 44` (`:973`), `UNIT_DIR_DOT_RADIUS = 30`,
`UNIT_DIR_DOT_SIZE = 4` (`:1000-1006`).

**The expedition renderer derives all four from `cellPx`, not from halved literals:**

```
coreRadius   = cellPx * 0.325   // 26/80  -> 13.0 at cellPx=40
artBox       = cellPx * 0.55    // 44/80  -> 22.0
dirDotRadius = cellPx * 0.375   // 30/80  -> 15.0
dirDotSize   = cellPx * 0.05    //  4/80  ->  2.0
```

**Ratios, not magic numbers.** At `cellPx = 40` they give exactly the table's values; at any other
cell size they stay proportionate. The ratio is the actual invariant — the halved integers are a
coincidence of `EXP_CELL` being exactly `CELL/2`, and a renderer whose cell size is a constructor
parameter (§4.3) must not encode that coincidence.

## 6. Texture crispness at CELL=40 — verified, and the question inverts

The task asks: *is the 2x raster enough at CELL=40?* **Yes — overwhelmingly. The real risk is the
opposite one.** Measured, not guessed.

**The sheet.** `content/sprite_all_v12.svg`, 26 `<symbol>`s. Their viewBoxes, counted:

| viewBox | count | cells |
|---|---|---|
| `0 0 64 64` | 13 | 1x1 |
| `0 0 64 128` | 6 | 1w x 2h |
| `0 0 128 128` | 3 | 2x2 |
| `0 0 192 128` | 2 | 3w x 2h |
| `0 0 64 192` | 1 | 1w x 3h |
| `0 0 128 192` | 1 | 2w x 3h |

Every dimension is a multiple of 64 — **the sheet's convention is 64 SVG units per grid cell.**

**The raster.** `sprites.ts:56` `RASTER_SCALE = 2`; `standaloneSvgString` emits
`width = sym.width * RASTER_SCALE`, and `rasterize()` draws onto a canvas of the same size. So a 1x1
symbol becomes a **128x128 px** texture.

**The arithmetic.**

| | box on screen | texture | texture-per-box |
|---|---|---|---|
| Backpacks, `CELL=80` | 80 px | 128 px | **1.6x** |
| Expedition, `EXP_CELL=40` | 40 px | 128 px | **3.2x** |
| Expedition at 1920x1080 (fit-scale 0.909) | 36.36 px | 128 px | **3.52x** |

**So 2x is not merely enough at CELL=40 — the expedition is better supersampled than the board the
art was authored for.** There is no under-sampling question to answer.

**The actual risk: MINIFICATION ALIASING.** Pixi v8.19.0 `TextureSource` sets
`this.autoGenerateMipmaps = false` (verified by reading
`node_modules/.pnpm/pixi.js@8.19.0/node_modules/pixi.js/lib/rendering/renderers/shared/texture/sources/TextureSource.mjs:75`),
and `Texture.from(canvas)` (`sprites.ts:170`) takes that default. A 128px texture drawn into a 36-40px
box is a **~0.3x minification sampled bilinearly with no mip chain** — high-frequency detail (an
icon's 1px outline, hatching) will shimmer and crawl. And it will crawl *while the stage is
animating*, which is the entire point of this screen.

**Three levers, and only one is available:**

1. **Lower `RASTER_SCALE` for the expedition** — **impossible.** `sprites.ts:229` `let boardLoadPromise`
   caches **one** `Map<string,Texture>` for the whole session, shared by `Board`, `InventoryBoard` and
   `MonitorRenderer` alike. There is no per-consumer raster. Changing `RASTER_SCALE` changes it for the
   Backpacks board too. **Worth knowing before anyone proposes it as the obvious fix.**
2. **A second texture map at 1x for the expedition** — rejected. Doubles decode time and VRAM, forks
   the art pipeline, and throws away the 3.2x headroom that makes the *upscaled* portrait case
   (REQ-0260 §8, scale 1.038) crisp.
3. **Turn mipmaps ON for the shared map** — **ADOPTED, pending measurement.**
   `texture.source.autoGenerateMipmaps = true` at the one construction site (`sprites.ts:170`) plus
   `source.updateMipmaps()` after upload. This **helps the Backpacks board too** (1.6x minification
   also aliases, just less) and harms neither; +33% texture memory over a 26-symbol sheet is nothing.

Two things to verify at implementation rather than assume:

- **Non-POT.** 64 and 128 are powers of two; **192 is not** — 2 symbols are 192-wide and 2 are
  192-tall, giving 384px rasters at 2x, also non-POT. Non-POT mipmaps are illegal in WebGL1 and legal
  in WebGL2/WebGPU; Pixi v8's floor is WebGL2, so this should be fine — but `TextureSource._refreshPOT()`
  exists and its interaction with `autoGenerateMipmaps` must be checked on a real context before this
  is called done. If non-POT mipmaps misbehave, the fallback is to leave mipmaps off and accept the
  shimmer (a quality regression, not a correctness one) — **not** to pad the sheet to POT, which would
  re-author every viewBox and break the 64-units-per-cell convention.
- **It must be A/B'd, not assumed.** "Mipmaps fix aliasing" is a general truth, not a measurement.
  Compare the same stage at 36.36px cells with and without and keep the change only if it is visibly
  better. Bilinear-with-mips reads *softer*, which on a 36px icon may be worse than a little crawl.

**Unit and monster RASTERS are a different, worse story** and are NOT covered by the above: they are
registry PNGs (`unit_icon_pipeline.md` §0 — 1x1 cell, 1:1 aspect, **256x256** target), loaded via
`Assets.load` (`sprites.ts:198`), not through `RASTER_SCALE` at all. A 256px unit portrait into a 22px
art box (§5.2) is a **~0.086x** minification — an order of magnitude worse than the symbols, and the
place mipmaps actually matter. REQ-0263 owns unit/monster art on this plane; the number is recorded
here so 0263 does not re-derive it.

## 7. Squad placement (spec d)

### 7.1 The chain

```
room.formationId                                   (ApiRoom, dto.ts:399)
  -> fetchDungeons().formations.find(f => f.id === room.formationId)     (api/schedule.ts:27)
    -> formation.canvases["unit1".."unit4"]        (§3 — NOT "squad1"..)
      -> parseBoxToPixelRect(box, EXP_CELL)        (fieldGeometry.ts:88)
        -> { x, y, w, h } on the 26x18 plane, w === h === 8 * EXP_CELL === 320
room.slots[i].squadIndex
  -> snapshot.state.presets.store[squadIndex]      (the LOCAL client store — see §7.3)
    -> squadCanvas.bps[] / .pos[]                  (8x8 local coords)
```

`parseBoxToPixelRect` is **already** `cellPx`-parameterised and already A1-correct
(`x = (a.col - 1) * cellPx`). At `EXP_CELL = 40`, `"F2:M9"` -> `{x: 200, y: 40, w: 320, h: 320}`. An
8x8 squad box at CELL=40 is **exactly** the Backpacks board's 8x8 grid at half size
(`8*40 = 320 = (8*80)/2`). **Spec (d) falls out of the geometry with nothing to force** — which is
the strongest evidence that CELL=40 is the right logical choice and not an arbitrary halving.

**REQ-0258 dependency:** `formation4.unit4` becomes `J10:Q17` (from `J11:Q18`, which sits on the
row-18 padding ring). This REQ reads whatever the content says and draws it; it does **not**
re-derive or "correct" any box. If 0258 has not landed, formation4's backline draws **on the ring** —
the renderer faithfully drawing an illegal state, which is exactly why (f) is validator-enforced and
not renderer-enforced (§9).

### 7.2 Reuse `fieldGeometry.ts`, do not re-derive it — the crash-loop it remembers

`fieldGeometry.ts` is the client-side mirror of the sim's `parseBox`/`colLetterToIndex`, and its long
doc comment records a real, measured outage this REQ must not repeat. Verbatim (`:36-60`):

> **BUG #4 FIX (REQ-0041)** — root cause: this function used to assume its argument was ALWAYS a
> "M9"-style string and called `cellId.trim()` unconditionally. sim/combat.cjs's actual
> ray_fire/ray_bounce/ray_step events carry `entry`/`at`/`path[]` as raw **`[row,col]` NUMBER TUPLES,
> never strings** … *"TypeError: e.trim is not a function"* … Since Monitor.tsx's poll effect only
> advances `lastEventIndexRef` AFTER applyEvents() returns successfully, this exception fired again on
> **EVERY subsequent ~2s poll tick forever** … pegging the render thread in a **permanent crash-loop**
> … the browser tab's renderer becoming unresponsive within a few poll cycles.

So: **two coordinate spellings coexist on this wire and they are not interchangeable.**
`"F2:M9"`-style STRINGS are authoring/box syntax (formation canvases, pack member anchors `m.at`).
`[row,col]` NUMBER TUPLES are runtime positions (`ray_fire.entry`, `ray_bounce.at`, `ray_step.path[]`).
A `"M9"`-style string id appears in events only as an entity/actor LABEL (`maskLabel`), never as a
position. `cellIdToColRow` accepts both by design and **never throws** on malformed input (falls back
to `{col:1,row:1}` — draw in a corner rather than die).

**`ExpeditionRenderer` imports `fieldGeometry.ts`. It does not re-implement `colLetterToIndex`.** A
third copy of this parser would be a third place for BUG #4 to be rediscovered — and the second copy
already cost a hung tab.

The corollary is equally load-bearing and is recorded here because it is a property of this
renderer's contract even though REQ-0262 owns the loop: **the expedition's event application must not
gate its cursor on success.** The crash-loop's severity came entirely from *"only advances the cursor
AFTER applyEvents() returns successfully"* — one bad event then re-threw forever. Advance the cursor
first, or wrap per-event.

### 7.3 The player data comes from the LOCAL store — a gap the roster does not close

`Monitor.tsx:152-174` (0240) builds its squads from **`snapshot.state.presets`** — the *viewing
client's own* saved squad canvases — joined to the run only by `room.slots[i].squadIndex`. **Nothing
about the squads' composition comes from the server's run view.**

That works today because a room is `visibility: 'self'` (`dto.ts:398`) and the runner is the viewer.
It carries three consequences the expedition inherits, and they should be said out loud rather than
inherited silently:

1. **It is not spectator-safe.** The moment anyone watches someone else's expedition, the player plane
   renders the *viewer's* squads. Not this REQ's problem to solve; this REQ must not deepen it.
2. **It is a snapshot of NOW, not of run start.** Edit a squad on `#/backpacks` mid-run and the
   plane changes under you, while the sim keeps fighting the squads as they were at sortie.
   `ApiRunRosterSlot` (`dto.ts:464-468`) carries `bps: {id, hpMax}[]` from `result.bps.squadSlot` —
   the **real** compiled roster — but only ids and hpMax: **no `shape`, no `origin`, no `pos`.** So the
   run knows *which* BPs fought and the client knows *what they look like*, and neither knows both.
3. **`squadIndex === presets.active` is special-cased** (`Monitor.tsx:158`:
   `slot.squadIndex === squadStore.active ? activeCanvas : squadStore?.store[slot.squadIndex]`)
   because the active squad lives in `state`, not in `presets.store`. The expedition must reproduce
   this or the active squad draws stale.

**This REQ reuses the same join** (do not invent a second source of truth), reproduces the
active-squad special case, and **records the gap** rather than closing it. Closing it means putting
the compiled squad snapshot on the wire — `sim/lib/compile.cjs`'s `compileSquadSnapshot` already
builds exactly this shape server-side — which is a server REQ of its own. Building on REQ-0240's own
honest "Data-gap status" rather than rediscovering it: **this is M1's unstated fifth gap.**

## 8. The enemy plane (spec e, f) — it cannot be drawn today

### 8.1 Spec (e): same size — free

`PLANE_W x PLANE_H` = 1040x720 for both, from REQ-0260 §6. Both planes are the same
`IBattleInstancesFormationMap`; the enemy plane is not a smaller inset. Already true of
`MonitorRenderer` (`drawFieldBackdrop` is called identically for both, `:180-181`). Nothing to decide.

### 8.2 The blocker: there are no enemy POSITIONS on the wire

The enemy's absolute field cells **exist** — `sim/lib/packs.cjs:38` computes
`fieldCells: cellsFor(anchor, def.footprint || [1,1])` at compile time from the pack member's `at`
anchor. They are simply **never serialised**.

`buildRoster` (`server/services/pacing.cjs:220-239`) walks `pack.members`, builds a dedup key
`packId + '/' + m.enemy + '/' + (m.at || '')` — **it holds `m.at` in its hand** — and then emits:

```js
enemies.push({ id: def.id, name: def.name, nameJa: …, hpMax: …, footprint: def.footprint || [1,1], packId });
//             ^ the DEF id, not an instance id                                              ^ no `at`
```

So today the enemy side is drawn **lazily, from ray events**: `addOrUpdateEnemyMarker`
(`MonitorRenderer.ts:440-473`) creates a marker at the **first-seen ray-event cell**, keyed by that
cell. Consequences, all verified:

- **Nothing renders until the first ray lands.** The enemy plane is empty at t=0. Spec (f) asks for a
  formation MAP — a static arrangement present from the start. Fundamentally incompatible.
- **Markers are keyed by CELL, not by enemy** (`mapKey = `${cellId[0]},${cellId[1]}``). Two enemies
  hit at one cell share a marker; one enemy hit at two cells becomes two markers.
- **Footprints are not drawn at all.** `graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX)` — a **1x1**
  rect, whatever the def says. A 2x2 `frostback_bear` draws as one cell.
- **`MonitorEnemyDef` (`:101`), which carries `footprint`, is declared and never referenced anywhere
  in the tree.** It is the fossil of the intent.

> **CORRECTION to the brief.** §6 and `MonitorRenderer.ts`'s module comment describe the enemy side as
> *"simple footprint blobs + name label"* and call it *"the explicit spec, not a placeholder shortcut"*.
> The **name-label** half is accurate and the **spec-not-shortcut** framing is fair. But **there is no
> footprint in the footprint blob**: it is a fixed 1x1 rect at a ray's cell. Anyone reading the brief
> would budget "swap the blob for art"; the actual work is **"obtain positions at all"**.

**The seam (server, additive):** extend `ApiRunRosterEnemy` and `buildRoster`, which already has
everything it needs in scope:

```ts
export interface ApiRunRosterEnemy {
  id: string;                      // the DEF id (unchanged)
  instanceId: string;              // NEW — the sim's own entity id ("frostback_bear#0"); §8.4
  at: string;                      // NEW — the A1 top-left anchor, verbatim from the pack member
  fieldCells: [number, number][];  // NEW — cellsFor(parseA1(at), def.footprint), DERIVED server-side
  name: string; nameJa: string; hpMax: number;
  footprint: number[];             // [fh, fw] — unchanged, DISPLAY ONLY; §8.5
  packId: string | null;
  masked: boolean;                 // NEW — traps/gimics are masked; §8.6
}
```

`fieldCells` is sent **derived** rather than leaving the client to re-run `cellsFor`, for two reasons:
it removes the transpose hazard structurally (§8.5), and `shared/content_validate.cjs`'s `cellsFor` is
the authority that ADJUDICATED the layout. Sending only the anchor and asking the client to re-derive
is asking a mirror to agree with an authority it cannot import — REQ-0258 §9.1's exact anti-pattern.
Send `at` as well, for debuggability and for REQ-0262's entry-cell projection.

**Spoiler surface — a real one.** Static enemy positions at t=0 reveal the whole enemy formation
before the first ray. REQ-0240 chose *"a leak-safe HINT the client reveals on first-seen"*
(`dto.ts:470-472`) precisely to avoid this, and `server/routes/schedule.cjs:234-240` calls the run view
"spectator-safe" in the same spirit. **But the expedition IS a formation map; hiding the formation
defeats the screen.** Recommendation: send positions, honour `masked` per-instance (§8.6), and show
unrevealed enemies as their **footprint silhouette** — shape and size, no art, no name — until
first-seen. The arrangement is visible; the identity is not. **This is a design call the user must
confirm** (Status blocker 2).

### 8.3 Monster art EXISTS — the brief is stale on this

The brief §6 and `MonitorRenderer.ts:12-13` both say enemy art is unbound (*"no real enemy art exists
yet, per the task brief"*). **That was true at REQ-0036/0169 and has not been true since
REQ-0188/0208.** The chain is complete and live, verified end to end:

1. **Artworks exist.** REQ-0188's outcome section: *"Seed run live: **created=19**, re-run no-op"*, and
   `monsters-003-flux2:gnoll` (monster art `{w:3,h:4}`) is **ADOPTED**.
2. **`monster` is a first-class art kind.** `server/services/art_sizing.cjs:24`:
   `const KINDS = ['po','si','unit','monster','bpskin','custom'];` (+ `gimic` after REQ-0255's merge
   of REQ-0211).
3. **Monster ids join `art_urls`.** `server/lib/content.cjs:230-241` (REQ-0208), verbatim: *"monster ids
   join the resolved map for the Dex's monster catalog. resolveItemArtNames is kind-generic … and
   monster artworks follow the exact-name convention (artwork system_name == enemy id — REQ-0184/0188),
   so no new resolver is needed."*
4. **They reach the client.** `api/content.ts:107` `ART_URLS = payload.art_urls ?? {}`;
   `store/boot.ts:181` `setItemArtUrls(gameData.ART_URLS)`.
5. **They reach the BOARD TEXTURE MAP, already.** `itemArt.ts:47-55` `itemIconRasters()` iterates
   **every** key of `ITEM_ART_URLS` — monster ids included, because it is one flat map — and emits
   `item:<id>` entries; `sprites.ts:243` merges them into the shared map. **`textures.get('item:' + enemyId)`
   resolves today, with no new plumbing whatsoever.**
6. **It is proven in production.** `client/src/dex/MonsterCatalog.tsx:11-15, 65` renders monster
   portraits through `getItemArtUrl(monster.id)` on the live Dex.

**So the honest answer to "what can be drawn today":** given §8.2's positions, a monster's **adopted
art** can be drawn immediately through the resolver the board already uses. What is missing is
**geometry and identity, not art.**

**Caveats, both real:**

- **pg-only.** `computeArtUrls()` opens with `if (process.env.STORAGE_BACKEND !== 'pg') return {};` —
  under the files backend the map is empty and every enemy falls through to the placeholder. That is
  the NORMAL degraded state, exactly as `MonsterCatalog` treats it, and must never block a draw.
- **§8.3.1.**

#### 8.3.1 The footprints have DRIFTED FROM THE ART — do not paper over it

REQ-0188's ratified golden 1 is *"**Art is the authority** for a thing's cell geometry"*. Its outcome
section records that the reconciliation was **never completed**:

> `derive --check`: **2 drifts** (`frost_gnoll` `[1,1]->[4,3]` from `monsters-003-flux2:gnoll` — a REAL
> gameplay footprint change that would overlap `enc_pack_1` neighbors and needs pack re-composition +
> user sign-off; …). **`derive --write` NOT run**; stays todo pending the user ruling on those two.

So `content/live/dungeon/enemies.json` says `frost_gnoll` is `"footprint": [1, 1]` (verified by
reading it) while its adopted art is a 3-wide, 4-tall drawing. **Drawing that art into a 1x1 box
squashes a 3x4 monster into one cell**, at any cell size.

**This REQ must not "fix" it by preferring the art's shape.** The footprint is what the SIM fights
with — `packs.cjs:38` derives `fieldCells` from `def.footprint`, and rays hit **those** cells. A
renderer that drew the 4x3 art shape would show the player a monster whose *drawn* body does not match
the body that *gets hit*. That is worse than a squashed icon: it is a lie about the game rules, on the
one screen whose whole purpose is to show the rules operating.

**So: contain-fit the art into the DEF's footprint box** (`fitBoxInBounds` — the aspect law, never
stretch), which for `frost_gnoll` means a 3:4 portrait letterboxed inside one 40x40 cell. It will look
bad. **It is honestly bad**, and it is REQ-0188's open ruling that makes it so, not this renderer.
Recorded as a hard dependency with a clean resolution: **once the user rules on the two drifts and
`tools/derive_def_geometry.cjs --write` runs, `frost_gnoll` becomes `[4,3]`, `fieldCells` becomes 12
cells, and the art fits its box exactly — with zero renderer change.** Art and geometry arrive as
DATA, which is REQ-0188's entire design.

### 8.4 Instance identity — the roster's `id` is not the event's `dst`

The roster's `id` is the **def** id (`buildRoster`: `id: def.id`), and its dedup key includes `at`, so
**a pack with three `ice_archer`s yields three roster entries all carrying `id: 'ice_archer'`.** They
are distinguishable only by the `at` the roster then throws away (§8.2).

Meanwhile the sim's events label entities via `maskLabel(entity)` (`sim/lib/replay.cjs:21-23`):
`return entity.masked ? '?' : entity.id;` — where `entity.id` carries an instance suffix. REQ-0240
deviation 4 names it (*"e.g. `frostback_bear#0` instance suffix"*), and deviation 3 states the
consequence outright:

> **Enemy HP ticks on the stage deferred.** `ray_hit`'s masked `dst` label does not resolve to a roster
> enemy id/hpMax, so per-enemy HP bars are not drawn.

**The roster and the event log are in two different namespaces.** REQ-0263 needs the join for HP;
**REQ-0261 needs it for placement and identity** — without it, a static enemy at `at="R5"` cannot be
connected to the `ray_hit dst="ice_archer#1"` that kills it, so the plane cannot so much as grey out a
dead instance. `instanceId` in §8.2 is that join, and it is not a new fact the server must invent: the
sim already has it, on the entity, at compile time. This is REQ-0240's M-gap list gaining its honest
sixth entry, and closing it here also closes REQ-0263's deviation-3 blocker for free.

### 8.5 The transpose convention — honour it, and the ONE place it is nearly wrong

`enemy/1` spells footprint **`[fh, fw]` = height, width**. Two independent confirmations:

- **REQ-0188's schema table** (`docs/REQ/built/REQ-0188-…:107`): `| enemy/1 | footprint: [fh, fw] = height, width |`,
  under a section titled **"THE risk: the transpose"**, with gate G4 pinning 24 NON-SQUARE fixtures
  across all four spellings and requiring the transposed spelling to FAIL.
- **The code that adjudicates it**, `shared/content_validate.cjs:472-479`:
  ```js
  const fh = fp[0] …; const fw = fp[1] …;
  for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) cells.push([anchor.row + dr, anchor.col + dc]);
  ```
  `fp[0]` expands ROWS. Unambiguous.

**Therefore, in any renderer: `w = footprint[1] * cellPx`, `h = footprint[0] * cellPx`.** Writing
`w = fp[0]` is the silent, ugly bug — for a 2x2 bear it is invisible; for a 3x4 gnoll it is 90° wrong
and still *looks like a monster*, which is why it would ship.

**This REQ sends `fieldCells` (§8.2) precisely so the renderer never touches `footprint` for
geometry.** A cell list cannot be transposed. `footprint` stays on the wire for display only (the Dex
prints it), and the renderer's only footprint-derived value is the bounding box it computes **from the
cells it was given**. That is a structural fix, not a vigilance one — REQ-0188 calls the transpose
*"the whole risk"*, and the way to beat a risk like that is to delete the opportunity, not to be
careful.

> **Adjacent finding, not this REQ's to fix:** `client/src/dex/MonsterCatalog.tsx:53-55` prints
> `` `${fp[0]}×${fp[1]}` `` — i.e. height×width. If its column header reads "W×H" it is displaying a
> transpose. Worth a glance from whoever owns the Dex; recorded so it is not lost.

### 8.6 Gimics (REQ-0259 / REQ-0211)

Spec (f): the enemy plane holds **monsters AND gimics**. Per brief §3 C4/Q4, `monster_pack.members[]`
widens to reference gimic ids, both compiling to `IBattleInstance`, and `validateMonsterPackEntry`
widens with it. **REQ-0259 owns both.**

For this renderer that is nearly free — a gimic on the plane is an instance with `fieldCells`, a
`mode` and art. Three deltas:

1. **Art kind — a gap the brief implies is closed and is not.** `gimic` joins `art_sizing.cjs`'s
   `KINDS` via REQ-0211 (in REQ-0255's merge), and brief §5 records *"art kind gimic == monster"*.
   **But `computeArtUrls()` joins `monstersFromCore().monsters` only** (`content.cjs:240`), and
   `monstersFromCore()` reads `src.enemyDefsById` (`:432-442`). **Gimic ids do not join `art_urls`**,
   so `textures.get('item:' + gimicId)` will miss and every gimic falls to the glyph. The fix is a
   one-line widening of `computeArtUrls`'s `names` concat — **flagged for REQ-0259**, which owns the
   gimic wiring. This REQ must not silently assume it.
2. **Glyph fallback exists and is ratified — reuse it.** REQ-0240 M4: *"`att_*` events carry no
   `gimicId` today, so gimic art binding is not wired; the feed/rail use the spec's class-glyph
   fallback (**ᚦ** trap / **ᚷ** chest / **ᛞ** door)."* Do not invent a fourth vocabulary.
3. **Masked.** Traps are `masked` (`sim/lib/skills.cjs:323`'s `entityDef {…, masked?}`), so `maskLabel`
   yields `'?'`. §8.2's `masked` flag drives the silhouette treatment.

## 9. The padding ring (spec f)

Drawn in a **distinct colour** — the ring is the one part of the plane that is *field* but not
*placeable*, and it is where rays are born (`combat_spec` §2.2 entry cells = row1/row18/colA/colZ,
exactly the ring).

```
ring cells = row 1, row 18, col A, col Z            (26x18 minus B2:Y17)
placeable  = PLACEABLE, imported from contentadmin/contentShared.ts:374 — NOT re-declared
```

Treatment: `--stone (#3D434C)` fill at low alpha with a `--gold-lo (#857038)` inner edge, against the
plane's own `--panel (#131820)` body — legible as "outside", distinct from both the frost player tint
and the ember enemy tint. **It must not glow**: REQ-0260 §11.2 — §6.0 rations glow to four moments and
caps simultaneous sources at 3 per screen; a permanently-lit frame would eat a third of that budget
forever, for decoration.

**Importing `PLACEABLE` rather than deriving it is deliberate.** REQ-0258 §9.1 documents that the
geometry constants already exist in three places under forced module boundaries
(`sim/lib/field.cjs`, `shared/content_validate.cjs`, `client/src/contentadmin/contentShared.ts`),
each pinned by a parity test (`sim/tests/run.cjs:1823/1830/1840`), and names `contentShared.ts` as the
client-side source *"REQ-0261 will need … for rendering"*. **This REQ must not create a fourth copy.**

**Enforcement is NOT the renderer's.** Brief §6, verbatim: *"drawn in a distinct colour, and NO
instance may occupy it — **enforced by the validator, not only by the renderer**"*. That validator is
**REQ-0258**: the strengthened `validateFormationBoxes` (8x8 **AND** inside `PLACEABLE`, as a
load-time assert) plus the existing `validateMonsterPackEntry` bounds check
(`shared/content_validate.cjs:519-522`). This REQ **draws the ring** and **draws whatever it is
given** — including an instance sitting on the ring, if 0258 has not landed.

That is deliberate, and it is the point of the split. A renderer that clipped or hid an illegal
instance would **conceal the bug the validator exists to catch**. REQ-0258 §3.1 shows this exact bug
(`formation4.unit4 = J11:Q18`) surviving a year behind a gate that watched one half of the rule; a
renderer that quietly tidied it away would have hidden the other half too.

**A dev-only assertion is the right middle ground:** on mount, test every instance's cells against
`isPlaceable()` (`contentShared.ts:426`) and `console.warn` on a violation — visible in dev, never
throwing, never hiding. The same posture as `MonitorRenderer.ts:227-238`'s degenerate-box warn, which
is the pattern that *would* have surfaced §3's bug if anyone had read the console. (That it did not
is a lesson about warns, not about this one; a warn is a floor, not a gate.)

## 10. Data gaps — building on REQ-0240's own list

REQ-0240's "Data-gap status (03 §8)" is honest and this REQ extends it rather than re-deriving it:

| REQ-0240's gap | its status | what REQ-0261 needs |
|---|---|---|
| **M1 roster** — DONE | per-slot `bps[{id,hpMax}]` + enemy `{id,name,nameJa,hpMax,footprint,packId}` | **not enough.** No enemy `at`/`fieldCells`/`instanceId`/`masked` (§8.2, §8.4); no player BP `shape`/`origin`/`pos` (§7.3). |
| **M2 pt + pacingVersion** — DONE | events carry `pt`; `durationSecs` is the PRESENTATION duration | irrelevant here; REQ-0260 §9 owns the clock. |
| **M3 charge ticks** — feature-flagged OFF | *"charge events are not slot-attributable without more plumbing"* | **REQ-0263's**, not this REQ's. `chargeRing.ts` is call-ready and every production call site passes `null`. |
| **M4 gimic art** — glyph fallback | `att_*` carries no `gimicId` | §8.6 — plus the separate, unlisted fact that gimic ids never join `art_urls` at all. |

**Two gaps REQ-0240 does not list, found here:**

- **M5 (new) — the player plane's composition has no server source.** §7.3. The roster knows *which*
  BPs fought; only the local store knows what they look like; nothing knows both.
- **M6 (new) — enemy instance identity has no wire representation.** §8.4. The roster's def id and the
  event log's `dst` instance label are different namespaces, which is the unstated root of REQ-0240's
  own deviation 3.

## 11. Corrections to the brief

| brief | reality | evidence |
|---|---|---|
| §6: *"reuse the Backpacks board composition at CELL=40. The board is `BoardRenderer.ts` + `geom.ts` …"* | `BoardRenderer` **cannot be called** without an `EngineInstance` + `GameState` + `BoardOps` + an 8x8 layout; the expedition has none of the four. New read-only renderer over the shared PURE modules. | §4.1, §4.3 |
| §6: *"`board/sprites.ts` (**sprite_all_v11.svg** symbols -> Pixi textures)"* | It is **v12**. `sprites.ts:53` imports `sprite_all_v12.svg`; every prose comment in that file still says v11. The brief inherited a stale comment. | §2 |
| §6: *"UNIT_CORE_RADIUS=26 halves to 13"* | The draw site uses the **literal 26** (`BoardRenderer.ts:928`), not the constant. Halving the constant moves the hit-test and leaves the circle — the exact bug `geom.ts:38-41` predicts. | §5.2 |
| task framing: *"`geom.ts` CELL=80->40, PAD=38"* | Editing `geom.ts` halves the **live Backpacks board**. And this plane has **no PAD** — the brief's own C5 arithmetic proves it. | §5.1, REQ-0260 §6 |
| task framing: *"`SOCKET_SEARCH_RADIUS`=26 (interactive-only — say so)"* | **Confirmed** interactive-only, and therefore **not ported at all** rather than halved. | §5.1 |
| task/brief: *"is the 2x raster enough at CELL=40?"* | **Yes, 3.2x over-sampled.** The question inverts: the risk is minification aliasing, and Pixi v8.19's `autoGenerateMipmaps` is **false** by default. Also: `RASTER_SCALE` **cannot** be changed per-consumer — one cached map, session-wide. | §6 |
| §6 + `MonitorRenderer.ts:12-13`: *"simple footprint blobs + name label … no real enemy art exists yet"* | **Both halves stale.** The blob is a fixed **1x1 rect** at a ray's cell — no footprint at all — and monster art has existed and been wired to the client since REQ-0188/0208 (proven live in the Dex). What is missing is **positions**, not art. | §8.2, §8.3 |
| §6 (silent) | The enemy plane has **no static positions on the wire**; `buildRoster` holds `m.at` and drops it. Nothing renders until the first ray. Needs a server change. | §8.2 |
| §6 (silent) | **`frost_gnoll`'s footprint has drifted from its own art** ([1,1] vs {w:3,h:4}); REQ-0188 left `derive --write` unrun pending a user ruling. | §8.3.1 |
| §6 (silent) | **`Monitor.tsx` looks up `canvases['squad1']` when the payload's keys are `unit1..unit4`.** The small monitor has never drawn a real formation box on any branch. | §3 |
| §6 (silent) | Gimic ids do **not** join `art_urls` (`computeArtUrls` reads `enemyDefsById` only), so "art kind gimic == monster" does not yet mean gimic art reaches the client. | §8.6 |
| §7 map: `0261 depends on 0260, 0258` | **Confirmed** — and 0258 is load-bearing twice (the `J10:Q17` box this renderer draws, and the ring enforcement this renderer deliberately does NOT do). | §7.1, §9 |
| REQ-0211's `[fh, fw]` height-first convention | **Confirmed** twice — REQ-0188's schema table AND `content_validate.cjs:472-479`. Honoured structurally by sending `fieldCells`. | §8.5 |

## 12. Scope

**In:**
1. `client/src/expedition/ExpeditionRenderer.ts` — NEW. Read-only, `cellPx` a constructor param;
   two planes; ring + grid backdrop; squad boxes; BP footprints + outline + label; placed PO art;
   unit core + G6 icon + dir dots; enemy instances (footprint silhouette / art / glyph); a
   `setLayout`-shaped reposition (reposition + `renderer.resize`, never re-init).
2. `client/src/expedition/expeditionGeom.ts` — the §5.2 ratios join REQ-0260's constants.
3. `client/src/expedition/ExpeditionStage.tsx` — REQ-0260's canvas host gains the renderer, the
   texture load (`loadBoardTextures()`), the formation/roster joins, and the dev-only ring assertion.
4. **`client/src/schedule/Monitor.tsx` — the §3 bug fix.** `canvases[`unit${…}`]` at `:446`
   (master) / `:180` (0240); the `:394` placeholder becomes `unit${idx+1}`; the `:422` comment
   corrected. **The only edit to the small monitor.**
5. `client/src/board/BoardRenderer.ts` — §5.2's zero-risk truthing: `:928` uses `UNIT_CORE_RADIUS`;
   `:973`/`:1000-1006`'s literals become named constants in `geom.ts`. **Pixel-identical.**
6. `client/src/board/sprites.ts` — §6.3's `autoGenerateMipmaps`, **if and only if** the A/B shows it
   better.
7. **Server (additive):** `server/services/pacing.cjs` `buildRoster` emits `instanceId`, `at`,
   `fieldCells`, `masked`; `shared/dto.ts` `ApiRunRosterEnemy` widens. Existing fields untouched, so
   the small monitor and every REQ-0240 test are unaffected.

**Out:**
- **Rays / trails / bounce / hit FX** — REQ-0262 (which also inherits §7.2's `RawCell` contract).
- **HP bars, cooldown overlays, charge rings, passive flashes, monster skill icons** — REQ-0263,
  REQ-0264, REQ-0265. §5.1 specifies the ring's halved args; 0263 passes them.
- **Enforcing the ring.** REQ-0258. This REQ draws it and warns. §9.
- **Fixing `frost_gnoll`'s footprint drift.** REQ-0188's open user ruling. §8.3.1.
- **Widening `computeArtUrls` for gimics.** REQ-0259. §8.6.
- **Putting the compiled squad snapshot on the wire.** §7.3 — a server REQ of its own.
- **Parameterising `MonitorRenderer`'s cell size.** §4.2 — 「今ある画面は放置して」.
- **Any spectator/multi-viewer support.** §7.3.

## 13. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7610` static / `7611` api / `7612` proxy.** Reserved by
the numbering rule and machine-enforced by `tools/check_e2e_ports.cjs` (ci step `[0/8]`). **Per ruling
Q2 (「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0258 §10 takes with 7580/7581/7582 and REQ-0260 §14 with
7600-7602.

Unit/typecheck gates that DO apply:

1. **The §3 regression guard.** For every formation in the dungeons payload, every key the client looks
   up resolves to `/^[A-Z]\d{1,2}:[A-Z]\d{1,2}$/`. Fails today; passes after the fix. **This is the
   gate whose absence let the bug live.**
2. **`parseBoxToPixelRect` at `EXP_CELL`.** `"F2:M9"` -> `{x:200, y:40, w:320, h:320}`; all 16 boxes of
   all 4 formations produce `w === h === 320` and land inside `PLANE_W x PLANE_H`.
3. **The transpose gate.** A NON-SQUARE fixture (footprint `[4,3]`) must render 4 rows x 3 cols. Pin
   the failing spelling explicitly, as REQ-0188's G4 does — a square fixture proves nothing.
4. **`EXP_CELL === CELL / 2`** (shared with REQ-0260 §14.2) and the §5.2 ratios: at `cellPx=40` they
   yield 13 / 22 / 15 / 2.
5. **`BoardRenderer` is pixel-identical** after §5.2's truthing — the existing board suite green, no
   golden moved.
6. **No fourth geometry copy.** Assert `ExpeditionRenderer` imports `FIELD_COLS`/`FIELD_ROWS` from
   `fieldGeometry.ts` and `PLACEABLE` from `contentShared.ts`, and declares neither (REQ-0258 §9.1).
7. **The renderer is read-only.** Assert zero `eventMode = 'static'`, zero `.on('pointerdown'`, zero
   `registerBoard` in `client/src/expedition/` — a grep test, because "read-only" is otherwise a
   promise rather than a property.
8. **Server:** existing roster fields unchanged (deep-equal minus the additive fields);
   `server/tests/api/schedule.cjs`'s roster assertions (`:480-485`) still green.
9. `pnpm exec tsc --noEmit` + lint.

## 14. Acceptance criteria

1. At `EXP_CELL=40` the player plane draws **four** 320x320 squad boxes at the adopted formation's
   real A1 coordinates — verified against `formations.json`, not against the fallback outlines.
2. **`Monitor.tsx` no longer console.warns on room open**, and `#/schedule`'s player plane draws real
   formation boxes for the first time. §3's gate fails on the pre-fix code.
3. Each squad box renders **every** BP at its own origin and **every** placed PO at its own cell —
   the REQ-0045 (d) contract, at Backpacks fidelity (unit core + G6-resolved icon + dir dots), not
   `MonitorRenderer`'s colour blobs.
4. The padding ring is drawn in a distinct, **non-glowing** colour on **both** planes; `PLACEABLE` is
   imported, not re-declared; an instance on the ring draws **and** warns.
5. With REQ-0258 landed, formation4's backline draws at `J10:Q17` and no formation box touches the ring.
6. A NON-SQUARE monster renders `footprint[0]` rows by `footprint[1]` columns. The renderer reads
   `fieldCells`, never `footprint`, for geometry.
7. An enemy with adopted art draws that art contain-fitted (never stretched) into its footprint box;
   one with no adopted art draws the silhouette/glyph; **neither path throws** and the files backend
   (empty `art_urls`) renders the whole plane without error.
8. `frost_gnoll` draws its 3:4 art letterboxed in one cell, **and that is recorded as expected** until
   REQ-0188's ruling lands.
9. `BoardRenderer`'s output is byte-identical before and after §5.2.
10. `client/src/expedition/` contains no interaction wiring (gate 13.7).
11. The user has ruled on §4's interpretation of 「そのまま」, §8.2's positions-and-spoilers seam, and
    §8.3.1's known-bad `frost_gnoll` render.
