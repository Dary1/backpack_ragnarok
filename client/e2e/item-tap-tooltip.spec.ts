// REQ-0119 -- single-tap on a board item icon floats the styleguide
// tooltip panel (.item-tip, FloatingItemTip.tsx). Covers the CLIENT
// interaction wiring: a plain tap (no drag-arm, no double-tap) on a PO
// icon floats the panel with the item's name/tags/effect/flavor + honest
// dex No. and 分解値 line; an empty-board tap dismisses it; tapping another
// item switches its content; it works on the inventory board as well as the
// canvas board (the "spans multiple pages" requirement -- both are the same
// BoardRenderer); and a DRAG (armed move) does NOT float a panel.
//
// NOTE: items are placed on BP cells that are NOT the unit cell. canvas_l's
// unit sits at abs (4,3) and the unit core is drawn ABOVE the PO layer
// (gUnits after gItems), so a tap there hits the BP, not the PO (the same
// z-order bp-rotate.spec.ts relies on). The POs live at (2,2)/(3,2) instead.
import { test, expect } from '@playwright/test';
import { bootApp, cx, cy, drag } from './helpers';

function makeCanvas() {
  const lShape = { shape: [[0, 0], [1, 0], [2, 0], [2, 1]], linker: { off: [2, 1], dirs: [0, 2] } };
  const canvasPos = [
    { uid: 'canvas_hilt', id: 'hilt', loc: 'grid', cell: [2, 2], rot: 0 },
    { uid: 'canvas_dagger', id: 'dagger', loc: 'grid', cell: [3, 2], rot: 0 },
  ];
  return {
    linked: false,
    bps: [{ id: 'canvas_l', name: 'Canvas L', color: '#4a90d9', origin: [2, 2], ...lShape }],
    pos: canvasPos,
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        {
          bps: [{ id: 'inv_l', name: 'Inv L', color: '#d9904a', origin: [2, 2], ...lShape }],
          pos: [{ uid: 'inv_hilt', id: 'hilt', loc: 'grid', cell: [2, 2], rot: 0 }],
          sis: [], tms: [],
        },
        {
          bps: [{ id: 'canvas_l', name: 'Canvas L', color: '#4a90d9', origin: [2, 2], ...lShape }],
          pos: canvasPos,
          sis: [], tms: [],
        },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

async function tap(page: import('@playwright/test').Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('REQ-0119 -- single-tap floats the item tooltip', () => {
  test('tapping a canvas PO icon floats the panel with name, dims and dex No.', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await expect(page.locator('.item-tip')).toHaveCount(0);
    await tap(page, box.x + cx(2), box.y + cy(2)); // hilt @ (2,2)

    const tip = page.locator('.item-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-tip-id', 'hilt');
    await expect(tip.locator('.item-tip-name')).not.toHaveText('');
    await expect(tip.locator('.item-tip-tags')).toContainText('1×1');
    await expect(tip.locator('.item-tip-sell')).toContainText('No.'); // honest dex chip
  });

  test('tapping empty board space dismisses the panel', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await tap(page, box.x + cx(2), box.y + cy(2)); // open on hilt
    await expect(page.locator('.item-tip')).toBeVisible();

    await tap(page, box.x + cx(7), box.y + cy(7)); // empty cell
    await expect(page.locator('.item-tip')).toHaveCount(0);
  });

  test('tapping a different item switches the panel content', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await tap(page, box.x + cx(2), box.y + cy(2)); // hilt @ (2,2)
    await expect(page.locator('.item-tip')).toHaveAttribute('data-tip-id', 'hilt');

    await tap(page, box.x + cx(2), box.y + cy(3)); // dagger @ (3,2)
    await expect(page.locator('.item-tip')).toBeVisible();
    await expect(page.locator('.item-tip')).toHaveAttribute('data-tip-id', 'dagger');
  });

  test('tap floats on the INVENTORY board too (spans multiple boards)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const inv = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;

    await tap(page, inv.x + cx(2), inv.y + cy(2)); // inv hilt @ (2,2)
    await expect(page.locator('.item-tip')).toBeVisible();
    await expect(page.locator('.item-tip')).toHaveAttribute('data-tip-id', 'hilt');
  });

  test('a DRAG (armed move) does not float the panel', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await drag(page, { x: box.x + cx(2), y: box.y + cy(2) }, { x: box.x + cx(6), y: box.y + cy(6) });
    await expect(page.locator('.item-tip')).toHaveCount(0);
  });
});
