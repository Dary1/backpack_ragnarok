# REQ-0289 — BP grab handle at the Unit + Unit-pivot rotation + float-on-blocked-rotation

## Status
draft (spec by orchestrator session 2026-07-22; awaiting user ratification).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`.
**Blocked by REQ-0288** (uses its BP ghost/lift + revertFeedback machinery).

## Origin (user directives, 2026-07-22, chat — verbatim)
3.「BPごと掴むボタンをUnit artの左上に表示し、またBPの回転をUnitを軸にするように
してください。つまり、Unitの場所が固定されている状態で、です。」
4.「もし、回転できない場合は、ドラッグ状態にし、浮かせてください。もし、ドラッグ
アンドドロップに失敗した場合(置く場所がない)は、元の位置に戻るようにしてください。」
Translation: (3) show the grab-whole-BP button at the top-left of the Unit
art, and rotate the BP around the Unit — the Unit's cell stays fixed. (4) if
rotation is impossible in place, lift the BP into a floating drag; a failed
drop returns it to its original position.

## Current state (verified)
- The REQ-0042 move-handle badge (✥) anchors at the BP's top-left CELL
  (r0,c0): BoardRenderer.ts ~L529-565 (`badgeX/Y = PAD + (c0-1|r0-1)*CELL
  + 14`, circle r=12).
- Rotation is bounding-box anchored, not Unit-anchored:
  `computeRotatedBP` (mock-src/engine.js ~L277) rotates offsets [r,c]->
  [c,-r] then RENORMALIZES to put the new bbox top-left back on the
  unchanged `bp.origin`; `bp.unit.off` goes through the same renormalize, so
  the Unit's ABSOLUTE cell moves. Callers: `canRotateBP`/`rotateBP` (~L306/
  L339, canvas) and `invCanRotateBP`/`invRotateBP` (~L1272/L1308, pages).
- A refused rotation red-flashes and stops (handleBPPointerDown dblclick
  branch, BoardRenderer.ts ~L1289-1302).
- REQ-0170 law: Unit connection DIRS do NOT rotate with the bag (dirs are
  board-absolute). This REQ must preserve that.

## Design (binding)

### A. Badge anchors to the Unit
Anchor the ✥ badge to the TOP-LEFT corner of the Unit's SEAT CELL:
`seat = engine.unitCell(bp)`; badge center = `(PAD+(seatC-1)*CELL+14,
PAD+(seatR-1)*CELL+14)`. Glyph/size/layer (gBadges)/pointerdown wiring
unchanged. Fallback for a unit-less BP (stale saves & the live 3x6 walls —
REQ-0284 evidence): keep today's r0,c0 anchor. Both boards.

### B. Unit-pivot rotation (engine)
The Unit's absolute cell is the rotation pivot and MUST be invariant across
a successful rotation.
- `computeRotatedBP` becomes pivot-agnostic: it returns the rotated LOCAL
  layout only — `{shape, unitOff, pos:[{uid,id,local:[r,c],rot,q}]}` — with
  PO cells LOCAL to the new shape origin (today it bakes in `bp.origin`).
  Pure, no legality, exactly one renormalization as today.
- Callers compute the pivot translation:
  `unitAbs = [bp.origin[0]+bp.unit.off[0], bp.origin[1]+bp.unit.off[1]]`;
  `newOrigin = [unitAbs[0]-rot.unitOff[0], unitAbs[1]-rot.unitOff[1]]`.
  Legality = rotated shape cells anchored at `newOrigin` through the SAME
  occupancy/bounds/others-set logic each caller already has; the
  contained-PO-fit re-check keeps its tmpCellBP technique, anchored at
  `newOrigin`. Commit writes `bp.origin = newOrigin` alongside shape/
  unitOff/PO cells+rot. All four call sites (canvas + inv twins).
- Unit-less BP fallback: pivot = today's behavior (origin unchanged,
  bbox-renormalized) — explicitly tested, not accidental.
- DIRS stay board-absolute (REQ-0170) — no touch.
- New pure query `canPlaceBPRotated(st, bpId, origin, steps)` (+ page twin
  `invCanPlaceBPRotated(st, pg, ...)`): legality of the k-step-rotated bag
  anchored at an ARBITRARY origin (steps 1..3; steps=0 must equal
  canMoveBP/invCanPlaceBP exactly). New mutator `moveBPRotated(st, bpId,
  origin, steps)` (+ twin) = validate via the query, then commit rotation +
  translation in ONE mutation. These power the float mode below.
  Export via the engine surface + shared/engine.d.ts (client shim rule).

### C. Blocked rotation floats the bag (client)
In `handleBPPointerDown`'s dblclick branch: when `ops.rotateBP` refuses,
DO NOT flash-and-stop. Instead enter a STICKY carry ("float"):
- drag.ts `CarryState` gains `pendingRot?: 0|1|2|3` and `sticky?: boolean`.
  Start it armed immediately (`kind:'bp'`, pendingRot:1, sticky:true,
  grabOff as beginDrag computes). Repeated blocked dblclicks while floating
  are ignored (carry already active — existing guard).
- Sticky mechanics: `ensurePointerUpWired`'s window pointerup IGNORES a
  sticky carry (the dblclick's own trailing pointerup must not resolve
  it). The bag follows the pointer button-free (globalpointermove already
  updates any active carry). Placement is CLICK-TO-PLACE: a stage
  pointerdown while a sticky carry is active commits at the current drop if
  legal, else cancels with REQ-0288 `revertFeedback` (state untouched — the
  bag returns home, satisfying directive 4). Esc cancels identically;
  window blur cancels. Guard ordering: the sticky-commit pointerdown
  handler must run before (and suppress) the normal `getCarry()`-guarded
  item pointerdown paths.
- Ghost while floating/pending-rot: REQ-0288's BP ghost, but geometry from
  `canPlaceBPRotated(..., steps)` so the ROTATED footprint+unit disc+PO art
  are previewed; ghost also renders while hovering ILLEGAL cells (0288
  law). Origin lift-shadow: unchanged cells (the bag physically still sits
  at its old place until commit).
- Commit path: `BoardCommitApi.commitBP` gains `pendingRot` (default 0 =
  byte-identical today): same-board drop -> `moveBPRotated`; CROSS-board
  drop with pendingRot>0 is refused (drop stays null / red) — transfer with
  rotation is out of scope, document at the commit site.
- A NORMAL drag (pointerdown-move-drop) is unchanged except it now may
  coexist with pendingRot=0 sticky=false paths; plain dblclick rotation
  that SUCCEEDS commits instantly as today (no float).

## Out of scope
Choosing/moving the Unit's seat (minted, canvas_spec law); rotation during
cross-board transfer; multi-step float rotation UI (float always carries
exactly the one refused 90° step); monitor/squadCompositor (consumes
engine state, needs no change).

## Gates
- Engine tests (mock-src/tests/run.cjs): (1) Unit absolute cell invariant
  across every ok rotateBP/invRotateBP; (2) 4x CW = identity (shape, origin,
  unit.off, PO cells, PO rot mod 4); (3) dirs unrotated (REQ-0170 case kept
  green); (4) canPlaceBPRotated steps=0 ≡ canMoveBP on a property sweep;
  (5) moveBPRotated commits atomically or not at all; (6) unit-less BP
  fallback. EXISTING rotation expectations updated to the pivot law — each
  changed literal annotated with the recalculation.
- `ci.sh` green; `bp-rotate.spec.ts` updated to pivot law (annotated);
  goldens/replay: rotateBP is an editor-only op — assert `def_sha256` in
  replay_hashes.json untouched (REQ-0256 precedent).
- New e2e on decade **7890-7899** (`e2e_harness_req 0289 …`): badge sits at
  seat cell (probe/screenshot); blocked rotation floats (ghostProbe shows
  rotated footprint), click legal spot lands the bag rotated with unit cell
  unchanged; click illegal spot / Esc: state hash unchanged + revert
  feedback fired; unit-less wall BP: badge fallback + old-style rotation.
- Screenshots under `web/preview/req-0289/`.

## Dependencies
Blocked by REQ-0288. Independent of REQ-0287/0290/0291.

## Amendments (2026-07-22 rulings, chat — binding)
- Float UX ratified: **sticky float** (release-free follow; click-to-place;
  Esc / illegal click reverts) — as specced in §C.
- REQ-0290 ruling makes the seat-cell core INERT (X cursor, no pointerdown):
  the dblclick-rotate trigger paths for this REQ are the ✥ badge and empty
  BP cells only. §A's badge relocation to the seat's top-left corner is
  what keeps rotation discoverable at the Unit. Order-free with REQ-0290;
  whichever lands second removes the core wiring / keeps it removed.
- Rotation AXIS is unaffected by trigger location: §B pivots on the Unit's
  absolute seat cell regardless of where the rotation is invoked.


## Log

Implemented by the Opus session 2026-07-22/23 (branch
`req-0289-bp-grab-handle-unit-pivot-rotation`, off REQ-0288's `built/` base).

### Summary
- **Engine (mock-src/engine.js).** `computeRotatedBP` is now pivot-agnostic:
  it returns the rotated LOCAL layout `{shape, unitOff, pos:[{uid,id,local,rot,q}]}`
  (renamed `cell`->`local`; `unitOff:null` for unit-less BPs). `rotateLocalOnce`
  is the single-step primitive; `rotatedLayoutK` applies it k times; `pivotOrigin`
  gives `unitAbs - rotatedUnitOff`. `canRotateBP`/`rotateBP` (+ inv twins) re-anchor
  the rotated shape at the pivot origin, so the Unit's ABSOLUTE seat cell is
  invariant across a successful rotation; a unit-less BP keeps the old bbox
  behavior (origin fixed). New pure `canPlaceBPRotated(st,bpId,origin,steps)` +
  `moveBPRotated` (+ `invCanPlaceBPRotated`/`invMoveBPRotated`), with steps=0
  delegating to `canMoveBP`/`moveBP` (byte-identical). `rotatedBPLayout` exported
  as a pure view helper for the client ghost. DIRS never rotate (REQ-0170).
  Surface declared in shared/engine.d.ts (client shim re-exports it).
- **Client.** §A: the move-handle badge anchors at `engine.unitCell(bp)`'s
  top-left corner (r0,c0 fallback for unit-less BPs), inside the REQ-0288
  `if (!lifted)` wrapper. §C: a refused in-place rotation enters a STICKY FLOAT
  (`CarryState.pendingRot`/`sticky`): armed immediately, follows the pointer
  button-free, ignored by `ensurePointerUpWired`, placed by the next stage
  pointerdown (`commitStickyCarry` -> `commitBP(pendingRot)` -> `moveBPRotated`);
  illegal click / Esc / window blur revert with REQ-0288 `revertFeedback` (state
  untouched). `onGlobalPointerMove` previews the ROTATED footprint via
  `canPlaceBPRotated` and feeds `renderGhostBP` a rotated VIEW built from
  `rotatedBPLayout` (renderGhostBP stays dumb). Cross-board drop with pendingRot>0
  is refused (drop stays null). The unit-core pointerdown wiring is deliberately
  KEPT (REQ-0290's removal).

### Gate table
| Gate | Result |
| --- | --- |
| mock-src/tests/run.cjs | **129 passed, 0 failed** (123 baseline + 6 new REQ-0289 cases) |
| engine type-surface drift (tools/check_engine_types.cjs) | **OK** (rotatedBPLayout + canPlaceBPRotated/moveBPRotated/inv twins declared + present) |
| sim/tests + goldens | **untouched** (git-clean); `node sim/tests/goldens.cjs` -> goldens OK (12 cases); the 9 `def_sha256` lines in sim/tests/goldens/replay_hashes.json unchanged |
| server typecheck (tsconfig.server.json, checkJs) | pass (ci.sh [3.5]) |
| client `tsc -b` | pass |
| client build (`pnpm run build`) | pass |
| `node scripts/check_ghost_chain.mjs` | **OK** |
| `tools/ci.sh` (SKIP_PG=1 SKIP_E2E=1) | **CI GREEN** (incl. [0/8] e2e-port rule, all sim/mock/content/vocab gates, client typecheck+build) |
| e2e bp-rotate.spec.ts + bp-rotate-float.spec.ts (scoped, decade 7890-7899, --workers=1) | **10 passed** (E2E_PROXY_PORT=7892 E2E_FLEET_BASE_PORT=7894) |
| Screenshots | web/preview/req-0289/badge-at-seat.png, float-rotated-ghost.png |

### Commits
- `2e7c459` REQ-0289: engine -- Unit-pivot BP rotation + arbitrary-origin placement queries
- `251dd01` REQ-0289: engine tests -- pivot-law recalcs + new gate cases
- `2e19085` REQ-0289: client -- badge at the Unit seat + sticky float on blocked rotation
- `842e5fb` REQ-0289: e2e -- bp-rotate pivot-law update + float spec + screenshots
- `0d2e74f` REQ-0289: rebuild client bundle
- (this file) REQ-0289: log + todo -> built

### Deviations / notes
- **Overlap-rejection fixtures repositioned.** run.cjs's two "rotation blocked by
  overlap" fixtures (canvas + inventory) had the blocker placed for the OLD
  bbox-anchored footprint. Under the pivot law the rotated footprint lands
  elsewhere, so the fixtures were moved (lshape/inv_l origin [2,2]->[2,3], blocker
  / foreign PO -> [2,1]) to keep exercising the same `overlaps another BP` /
  `overlaps free-placed item` rejection; each change is annotated in-file with the
  recalculation.
- **Gate wording "lands rotated bag with unit cell unchanged."** For a FLOAT
  placement the bag physically moves, so the Unit cell lands at the CLICKED drop
  origin (not literally "unchanged"). Read as: the placement is coherent (Unit
  seat = drop origin + rotated off) and the committed footprint matches the ghost
  preview; the e2e asserts exactly that. The literal "Unit cell invariant" claim
  is the IN-PLACE rotation law (§B) and is pinned by bp-rotate.spec.ts and
  run.cjs. No redesign was needed.
- **ci.sh scope.** Run with SKIP_PG=1 SKIP_E2E=1: the pg backend tests need a
  DATABASE_URL and are unaffected by this editor-only, engine/client change; the
  e2e was run SCOPED per the REQ (decade 7890-7899). The cheap [0/8] port rule
  still ran green.
- **rotatedBPLayout typing.** Declared via a named `RotatedBPLayout` interface in
  engine.d.ts because the drift checker's member scanner mis-splits an inline
  object return type containing `Array<{...}>`; the named type sidesteps it with
  identical runtime coverage.
- No merge to master; base left untouched. Known pre-existing flake
  bp-transfer.spec.ts:164 not encountered (targeted --workers=1 run).
