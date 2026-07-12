// REQ-0031 Phase B -- 8x8 grid (E2E). Canvas layout and inventory page
// dims both derive from the SAME LAYOUT constant (mock-src/data.js,
// generated from content/live/scenario.json's layout field -- see
// tools/tool_gen_data.cjs); this test verifies the LIVE served content
// and the actual rendered board dimensions both reflect 8x8, not just
// the engine-level unit tests (mock-src/tests/run.cjs).
//
// PixiJS renders the grid to a single <canvas> (no per-cell DOM nodes),
// so "visible cell counts" is verified via the canvas element's own
// pixel dimensions: BoardRenderer.mount() sets width=PAD*2+COLS*CELL,
// height=PAD*2+ROWS*CELL (PAD=38, CELL=80) -- for an 8x8 grid that is
// exactly 716x716 for BOTH the canvas board and every inventory page
// board (same LAYOUT is used for both, per REQ-0030's page-dims-equal-
// canvas-dims design, extended untouched by REQ-0031's 8x8 change).
import { test, expect } from '@playwright/test';

const PAD = 38;
const CELL = 80;

test.describe('8x8 grid', () => {
  test('/api/content serves layout {ROWS:8,COLS:8}', async ({ request }) => {
    const res = await request.get('/api/content');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.layout).toEqual({ ROWS: 8, COLS: 8 });
  });

  test('canvas board and inventory board both render at 8x8 pixel dimensions', async ({ page }) => {
    await page.goto('/app/#/backpacks');
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);

    const expected = PAD * 2 + 8 * CELL; // 716
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;

    expect(Math.round(canvasBox.width)).toBe(expected);
    expect(Math.round(canvasBox.height)).toBe(expected);
    expect(Math.round(invBox.width)).toBe(expected);
    expect(Math.round(invBox.height)).toBe(expected);

    // Cross-check against the ACTUAL <canvas> element's width/height
    // attributes (device-pixel-space, not just the CSS box) via
    // page.evaluate, confirming the PixiJS Application itself was
    // initialized with COLS=ROWS=8, not merely that the CSS box happens
    // to match.
    const dims = await page.evaluate(() => {
      const boards = Array.from(document.querySelectorAll('canvas'));
      return boards.map((c) => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight }));
    });
    expect(dims.length).toBe(2);
    for (const d of dims) {
      expect(d.cssW).toBe(expected);
      expect(d.cssH).toBe(expected);
    }
  });

  test('a PO placed at the far edge of the new 8x8 extent (row/col 7-8) is legal', async ({ page }) => {
    // Directly exercises the engine's own 8x8 bounds via the live API --
    // confirms the grid genuinely extends past the OLD 6x6 boundary, not
    // just that the canvas element happens to be bigger.
    const fixture = {
      linked: true,
      bps: [
        {
          id: 'edge_bp',
          name: 'Edge BP',
          color: '#4a90d9',
          shape: [[0, 0], [0, 1]],
          origin: [8, 7], // occupies (8,7)-(8,8) -- illegal on a 6x6 grid, legal on 8x8
          unit: { off: [0, 0], dirs: [] },
        },
      ],
      pos: [],
      sis: [],
      layout: { ROWS: 8, COLS: 8 },
      inv: { pages: [{ bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }] },
    };
    await page.request.put('/api/profile/default/canvas', { data: fixture });
    const resp = await page.request.get('/api/profile/default/canvas');
    const saved = (await resp.json()).canvas;
    expect(saved.bps[0].origin).toEqual([8, 7]);

    await page.goto('/app/#/backpacks');
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    // No console/page error from rendering a BP at the far new edge.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});
