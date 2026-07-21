#!/usr/bin/env node
// client/scripts/check_po_outline.mjs -- REQ-0273 gate. Pins the pure outline
// geometry (client/src/board/poOutline.ts): boundary loops with interior on
// the left, collinear merge, touching-corner disambiguation, hole handling,
// and the exact rectilinear inset arithmetic. vite ssrLoadModule rig, same as
// check_bpskin.mjs.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const sortLoop = (l) => l.map((p) => p.join(',')).sort();
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { boundaryLoops, insetLoop, PO_OUTLINE_INSET } = await server.ssrLoadModule('/src/board/poOutline.ts');
    ok(PO_OUTLINE_INSET * 2 < 80, 'inset sane vs CELL');

    const one = boundaryLoops([[1, 1]]);
    eq(one.length, 1, '1x1: one loop');
    eq(one[0].length, 4, '1x1: four corners');
    eq(sortLoop(one[0]), ['0,0', '0,1', '1,0', '1,1'], '1x1: unit square vertices');

    const block = boundaryLoops([[1, 1], [1, 2], [2, 1], [2, 2]]);
    eq(block.length, 1, '2x2: one loop');
    eq(block[0].length, 4, '2x2: collinear mids merged, four corners');

    const ell = boundaryLoops([[1, 1], [1, 2], [2, 1]]);
    eq(ell.length, 1, 'L: one loop');
    eq(ell[0].length, 6, 'L: six corners');

    const diag = boundaryLoops([[1, 1], [2, 2]]);
    eq(diag.length, 2, 'diagonal touch: TWO loops (left-turn preference)');
    ok(diag.every((l) => l.length === 4), 'diagonal touch: each a plain square');

    const ring = boundaryLoops([[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3]]);
    eq(ring.length, 2, 'ring: outer loop + hole loop');
    eq(ring.map((l) => l.length).sort().join(), '4,4', 'ring: both rectilinear squares');

    // inset arithmetic on the 1x1, scaled to px (CELL=80): every vertex moves
    // exactly (+-d,+-d) toward the interior.
    const px = one[0].map(([x, y]) => [x * 80, y * 80]);
    const ins = insetLoop(px, 3);
    const round = (l) => l.map(([x, y]) => [Math.round(x), Math.round(y)]);
    eq(sortLoop(round(ins)), sortLoop([[3, 3], [77, 3], [3, 77], [77, 77]]), '1x1 inset: square shrunk by d on every side');

    // inset stays inside for the L too: all inset points within the L bbox,
    // none inside the missing quadrant beyond the inset margin.
    const insL = insetLoop(ell[0].map(([x, y]) => [x * 80, y * 80]), 3);
    ok(insL.every(([x, y]) => x >= 3 && y >= 3 && x <= 157 && y <= 157), 'L inset: within bbox margins');
    ok(!insL.some(([x, y]) => x > 83 && y > 83), 'L inset: nothing in the missing quadrant');
  } finally {
    await server.close();
  }
  console.log(fails ? `check_po_outline: ${fails} FAILED` : 'check_po_outline: all green');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
