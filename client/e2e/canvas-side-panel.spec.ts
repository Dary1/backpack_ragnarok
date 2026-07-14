// REQ-0140 -- canvas side panel parity (E2E). Verifies the ported MJOLNIR
// right-panel composition: inventory list + filter chips + selected-item
// detail card, selection sync BOTH ways (board tap <-> panel highlight),
// drag from the panel onto the board, the designed empty states, and the
// 1280x800 no-vertical-scroll budget. Fixtures are derived from the live
// default profile at runtime (no hardcoded content ids).
import { test, expect } from '@playwright/test';
import { bootApp, drag, fetchSavedCanvas, loadFixtureAndBoot, autoSaveAndFetch, cx, cy } from './helpers';

// Compact width (<=1500 -> the wide Pixi inventory column is hidden and the
// side panel IS the inventory) but tall (>840 -> the board is NOT zoomed, so
// board-local cx/cy pixel math maps 1:1). Used by the interaction tests.
const COMPACT = { width: 1440, height: 950 };

function ensureInv(canvas: any) {
  if (!canvas.inv || !Array.isArray(canvas.inv.pages) || canvas.inv.pages.length === 0) {
    canvas.inv = { pages: Array.from({ length: 5 }, () => ({ bps: [], pos: [], sis: [] })) };
  }
  return canvas;
}
function gridPOs(canvas: any): any[] {
  return (canvas.pos || []).filter((p: any) => p.loc === 'grid' && Array.isArray(p.cell));
}

test.describe('REQ-0140 canvas side panel parity', () => {
  test('panel + filter chips render with rarity-tinted inventory rows', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    const pos = gridPOs(canvas);
    expect(pos.length, 'default profile has a placed PO to seed inventory from').toBeGreaterThan(0);
    canvas.inv.pages[0].pos.push({ ...pos[0], uid: pos[0].uid + '_r140a', loc: 'inv', cell: null });
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);

    await expect(page.locator('.canvas-side-panel')).toBeVisible();
    await expect(page.locator('.canvas-inv-filter')).toHaveCount(5);
    await expect(page.locator('.canvas-inv-filter[data-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.canvas-side-panel .item-list .icard').first()).toBeVisible();
    await expect(page.locator('.canvas-side-panel .item-list .icard[class*="rar-"]').first()).toBeVisible();
    await expect(page.locator('.canvas-item-detail')).toBeVisible();
  });

  test('filter chips narrow the list (relic is rarity-deterministic)', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    const pos = gridPOs(canvas);
    expect(pos.length).toBeGreaterThan(0);
    canvas.inv.pages[0].pos.push({ ...pos[0], uid: pos[0].uid + '_r140b', loc: 'inv', cell: null });
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);

    const allCount = await page.locator('.canvas-side-panel .item-list .icard').count();
    expect(allCount).toBeGreaterThan(0);
    await page.locator('.canvas-inv-filter[data-filter="relic"]').click();
    await expect(page.locator('.canvas-inv-filter[data-filter="relic"]')).toHaveAttribute('aria-pressed', 'true');
    const relicCount = await page.locator('.canvas-side-panel .item-list .icard').count();
    expect(relicCount).toBeLessThanOrEqual(allCount);
    await page.locator('.canvas-inv-filter[data-filter="all"]').click();
    await expect(page.locator('.canvas-side-panel .item-list .icard')).toHaveCount(allCount);
  });

  test('selection syncs both ways: panel click -> board ring, board tap -> panel', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    const pos = gridPOs(canvas);
    expect(pos.length).toBeGreaterThan(0);
    const poA = pos[0];
    const poB = pos.find((p: any) => p.id !== poA.id) || poA;
    // inventory copy of poA's def id so selecting it rings poA's placed instance.
    canvas.inv.pages[0].pos.push({ ...poA, uid: poA.uid + '_r140c', loc: 'inv', cell: null });
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);

    const board = page.locator('canvas.board-canvas').first();
    const box = (await board.boundingBox())!;

    // panel -> board: click the inventory row -> ring over the placed instance.
    await page.locator(`.canvas-side-panel .icard[data-inv-id="${poA.id}"]`).first().click();
    await expect(page.locator(`.canvas-item-detail[data-detail-id="${poA.id}"]`)).toBeVisible();
    expect(await page.locator('.canvas-sel-ring').count()).toBeGreaterThanOrEqual(1);

    // board -> panel: tap a DIFFERENT placed item -> the panel detail follows.
    const [rb, cb] = poB.cell;
    await page.mouse.click(box.x + cx(cb), box.y + cy(rb));
    await expect(page.locator(`.canvas-item-detail[data-detail-id="${poB.id}"]`)).toBeVisible();
  });

  test('drag from panel to board places the item', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    const pos = gridPOs(canvas);
    expect(pos.length).toBeGreaterThan(0);
    const po = pos[0];
    const [r, c] = po.cell;
    // Move the placed PO into inventory, FREEING its own (still BP-covered)
    // cell -> a guaranteed-valid drop target when dragged back.
    canvas.pos = (canvas.pos || []).filter((p: any) => p.uid !== po.uid);
    canvas.inv.pages[0].pos.push({ ...po, loc: 'inv', cell: null });
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);

    const row = page.locator(`.canvas-side-panel .icard[data-inv-uid="${po.uid}"]`);
    await expect(row).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const board = page.locator('canvas.board-canvas').first();
    const boardBox = (await board.boundingBox())!;
    await drag(
      page,
      { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height / 2 },
      { x: boardBox.x + cx(c), y: boardBox.y + cy(r) }
    );
    // Left the inventory panel...
    await expect(page.locator(`.canvas-side-panel .icard[data-inv-uid="${po.uid}"]`)).toHaveCount(0);
    // ...and persisted onto the canvas grid.
    const saved = await autoSaveAndFetch(page);
    const back = (saved.pos || []).find((p: any) => p.uid === po.uid);
    expect(back, 'dragged PO is on the canvas grid').toBeTruthy();
    expect(back.loc).toBe('grid');
  });

  test('empty inventory shows guidance copy', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    canvas.inv = { pages: Array.from({ length: 5 }, () => ({ bps: [], pos: [], sis: [] })) };
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);
    await expect(page.locator('.canvas-side-panel .canvas-empty[data-empty-variant="empty-inventory"]')).toBeVisible();
  });

  test('zero-BP canvas shows guidance copy over the board', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await bootApp(page);
    const canvas = ensureInv(await fetchSavedCanvas(page));
    canvas.bps = [];
    canvas.pos = [];
    canvas.sis = [];
    await loadFixtureAndBoot(page, canvas);
    await page.setViewportSize(COMPACT);
    await expect(page.locator('.canvas-empty[data-empty-variant="zero-bp"]')).toBeVisible();
  });

  test('1280x800 canvas screen has no vertical scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);
    await expect(page.locator('canvas.board-canvas').first()).toBeVisible();
    await expect(page.locator('.canvas-side-panel')).toBeVisible();
    // the wide Pixi inventory column is hidden here (not pushed below the fold).
    await expect(page.locator('.canvas-legacy-inv')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(4);
  });
});
