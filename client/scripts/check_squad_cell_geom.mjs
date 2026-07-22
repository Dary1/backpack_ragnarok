#!/usr/bin/env node
// client/scripts/check_squad_cell_geom.mjs -- REQ-0286 gate. Pins the squad
// compositor's cell->pixel convention (client/src/board/squadCellGeom.ts) to
// the BOARD canon: 1-indexed local cell (r,c) -> origin + (c-1)*cellPx. Guards
// the REQ-0283 off-by-one (c*cellPx, no -1) from ever returning -- that skew
// padded the squad one cell down-right and overflowed the formation box at the
// bottom-right (owner report). vite ssrLoadModule rig, same as check_po_outline.mjs.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const inside = (inner, outer) =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 &&
  inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;

async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { cellTopLeftPx, cellCenterPx, vertexPx, poBoxPx } = await server.ssrLoadModule('/src/board/squadCellGeom.ts');
    const f = { originX: 100, originY: 200, cellPx: 18 };

    // 1) FLUSH: the top-left cell (1,1) sits exactly on the box origin (the bug
    //    was one cell of padding here).
    eq(cellTopLeftPx(1, 1, f), { x: 100, y: 200 }, 'cell (1,1) top-left FLUSH with box origin (zero padding)');

    // 2) NO OVERFLOW: an 8x8 formation's far corner (cell (8,8) bottom-right)
    //    lands exactly on origin + 8*cellPx -- the box's far edge, not past it.
    const c88 = cellTopLeftPx(8, 8, f);
    eq({ x: c88.x + f.cellPx, y: c88.y + f.cellPx }, { x: 100 + 8 * 18, y: 200 + 8 * 18 },
      'cell (8,8) bottom-right == 8x8 box far edge (no bottom-right overflow)');

    // 3) PO at (1,1), 1x1, sits INSIDE BP cell (1,1).
    const bp11 = cellTopLeftPx(1, 1, f);
    const cellRect = { x: bp11.x, y: bp11.y, w: f.cellPx, h: f.cellPx };
    const po11 = poBoxPx(1, 1, 1, 1, f);
    eq(po11, { x: 100, y: 200, w: 18, h: 18 }, 'PO at (1,1) box == cell (1,1) rect');
    ok(inside(po11, cellRect), 'PO at (1,1) sits INSIDE BP cell (1,1) bounds');

    // 4) The REQ-3 fixture: BP occupies (1,1)-(2,2), PO at (1,1) -> PO inside the
    //    BP footprint bbox, and BP top-left flush with the box origin.
    const bpBox = { x: cellTopLeftPx(1, 1, f).x, y: cellTopLeftPx(1, 1, f).y,
      w: (cellTopLeftPx(2, 2, f).x + f.cellPx) - cellTopLeftPx(1, 1, f).x,
      h: (cellTopLeftPx(2, 2, f).y + f.cellPx) - cellTopLeftPx(1, 1, f).y };
    eq(bpBox, { x: 100, y: 200, w: 36, h: 36 }, 'BP (1,1)-(2,2) bbox == 2x2 flush from origin');
    ok(inside(po11, bpBox), 'PO at (1,1) inside BP (1,1)-(2,2) footprint');

    // 5) seat centre of cell (1,1) is its midpoint.
    eq(cellCenterPx(1, 1, f), { x: 100 + 9, y: 200 + 9 }, 'seat centre == cell (1,1) midpoint');

    // 6) PO-outline vertex 0 maps to the box origin (board canon PAD + x*CELL,
    //    NO +1 -- the outline stays consistent with the fill, not one cell out).
    eq(vertexPx(0, 0, f), { x: 100, y: 200 }, 'PO-outline vertex 0 == box origin (no +1)');
    eq(vertexPx(2, 2, f), { x: 100 + 36, y: 200 + 36 }, 'PO-outline vertex 2 == 2 cells from origin');

    // 7) explicit anti-regression: NONE of the maps use c*cellPx (the bug).
    ok(cellTopLeftPx(1, 1, f).x !== f.originX + 1 * f.cellPx, 'cell (1,1) is NOT origin + c*cellPx (the REQ-0283 skew)');
  } finally {
    await server.close();
  }
  console.log(fails ? `check_squad_cell_geom: ${fails} FAILED` : 'check_squad_cell_geom: all green');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
