# REQ-0286 — /schedule monitor squad off-by-one (top-left padding + PO/BP skew, box overflow)

## Origin (owner report, 2026-07-22, live bundle index-Da45OMSh.js)
"The squad (canvas) has padding at the top-left, and placed POs are shifted one
cell LEFT and UP each — because of this, the bottom-right overflows the box."

## Root cause — a uniform 1-vs-0 base mismatch vs the BOARD canon
The board (Canvas/Inventory, BoardRenderer.ts — pixel-correct in production) is
CANON. Its cell -> pixel convention, verified:

| what                    | board canon (file:line)                                             | px for 1-indexed cell (r,c)                    |
|-------------------------|---------------------------------------------------------------------|------------------------------------------------|
| BP cell fill top-left   | BoardRenderer.ts:411,435  PAD + (c-1)*CELL, PAD + (r-1)*CELL         | origin + (c-1)*cell, (r-1)*cell                |
| PO footprint box        | BoardRenderer.ts:791-793,872-874  PAD + (p.cell[1]-1)*CELL           | origin + (c-1)*cell                            |
| PO outline vertex map   | poOutline.ts:64  PAD + x*CELL  (x already 0-based grid vertex)       | origin + x*cell   (NO +1)                       |
| unit seat centre        | geom.ts:67-72  cx=PAD+(c-1)*CELL+CELL/2  cy=PAD+(r-1)*CELL+CELL/2    | origin + (c-0.5)*cell                           |
| enemy field cell        | fieldGeometry.ts  cellIdToXY = (col-1)*cellPx  (already canon)       | origin + (c-1)*cell — why enemies looked right |

Engine cell model (all ABSOLUTE 1-indexed, one space) — mock-src/engine.js:
bpCells = origin+shape (:102), unitCell = origin+off (:103),
cellsOf = po.cell+shapeOff (:109). Cell = "[row,col], 1-based" (shared/engine.d.ts:28).

Monitor.tsx:182,178-181,189 builds BP cells (origin+shape), seatCell
(origin+off) and PO origin (po.cell) all in that ONE absolute 1-indexed
space — internally consistent, correct input.

THE BUG is entirely in the shared compositor + the monitor's muzzle-flash
handle, which drew every cell at origin + c*cellPx (NO -1):

| site                                             | before (buggy, +1 cell)     | after (board canon)             |
|--------------------------------------------------|-----------------------------|---------------------------------|
| squadCompositor.ts:116 cellTopLeft (BP fill)     | originX + c*cellPx          | originX + (c-1)*cellPx          |
| squadCompositor.ts:182 PO outline vertex         | originX + (x+1)*cellPx      | originX + x*cellPx              |
| squadCompositor.ts:208-209 PO sprite box         | originX + originC*cellPx    | originX + (originC-1)*cellPx    |
| squadCompositor.ts:246-247 seat centre           | originX + (sc+0.5)*cellPx   | originX + (sc-0.5)*cellPx       |
| squadCompositor.ts:164-165 bp-skin sprite        | originX + (c0-MARGIN)*cellPx| originX + (c0-MARGIN-1)*cellPx  |
| MonitorRenderer.ts:514 ray_fire muzzle handle    | rect.x + originC*cellW      | rect.x + (originC-1)*cellW      |

The (x+1) on the outline was deliberately introduced (REQ-0283) to stay
consistent with the BP fill's c*cellPx, so the whole compositor was a UNIFORM
+1 vs canon: every layer shifted one cell down-right together. That padded the
top-left by one cell and overflowed an 8x8 box by one cell at the bottom-right
(owner symptom). POs read as "one cell left/up" against where they belong —
the correction direction. parseBoxToPixelRect (fieldGeometry.ts) already maps
the box top-left cell to (col-1)*cellPx = rect.x, so canon makes local cell
(1,1) FLUSH with the box origin.

## Fix
1. New pixi-free module client/src/board/squadCellGeom.ts — THE single,
   explicitly-documented source of truth for the convention (1-indexed local
   cell -> origin + (c-1)*cellPx). Consumed by both squadCompositor.ts (draw)
   and MonitorRenderer.ts (muzzle handle), so a future consumer cannot
   re-introduce the skew. Pure -> node-gate-testable like poOutline.ts.
2. squadCompositor.ts: BP fill, bp-skin, PO sprite box, PO outline vertex, seat
   centre all routed through squadCellGeom; convention note rewritten.
3. MonitorRenderer.ts:514: muzzle-flash handle uses poBoxPx (same source).
4. Enemy fieldCells UNTOUCHED (already canon; enemies looked right).

## Regression test
client/scripts/check_squad_cell_geom.mjs (ci.sh client gate): flush top-left
(cell (1,1) == box origin), no bottom-right overflow (cell (8,8) far corner ==
origin+8*cell), PO at (1,1) sits INSIDE BP cell (1,1) and inside a BP (1,1)-(2,2)
footprint, seat centre = cell midpoint, outline vertex 0 == origin.

## Gates / deploy
tsc + oxlint + scoped schedule e2e (ports 7862) green; visual harness screenshot
(flush + PO-on-cell) vs the same squad on the board. Merge --no-ff to master,
rebuild web in MAIN checkout, verify bundle hash change local + tunnel.
