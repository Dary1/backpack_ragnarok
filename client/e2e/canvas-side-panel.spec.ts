// REQ-0140 -- canvas side panel parity (E2E). Verifies the ported MJOLNIR
// right-panel composition: inventory list + filter chips + selected-item
// detail card, selection sync BOTH ways (board tap <-> panel highlight),
// drag from the panel onto the board, the designed empty states, and the
// 1280x800 no-vertical-scroll budget.
//
// Fixtures are SELF-CONTAINED (a berserker BP + real live-content POs,
// mirroring grid-8x8.spec.ts), never derived from the default profile: the
// live starter profile is Longsword ASSEMBLY parts (hilt/blade) with squad
// slots, which do not behave like free 1x1 rows and confound placement.
import { test, expect } from '@playwright/test';
import { bootApp, drag, loadFixtureAndBoot, cx, cy } from './helpers';

// Compact width (<=1500 -> wide Pixi inventory column hidden, side panel IS
// the inventory) but tall (>840 -> board NOT zoomed, so board-local cx/cy
// map 1:1). Used by the interaction tests.
const COMPACT = { width: 1440, height: 950 };

// A 4-row x 2-col BP at origin [1,1] (cells (1,1)..(4,2)); the berserker unit
// sits on (1,1), leaving the rest free for POs.
function baseBp() {
  return {
    id: 'r140_bp',
    name: 'Test Pack',
    color: '#4a90d9',
    shape: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]],
    origin: [1, 1],
    unit: { id: 'berserker', off: [0, 0] },
  };
}
function emptyPages() {
  return Array.from({ length: 5 }, () => ({ bps: [], pos: [], sis: [] }));
}
function fx(overrides: any) {
  return { linked: true, bps: [baseBp()], pos: [], sis: [], layout: { ROWS: 8, COLS: 8 }, inv: { pages: emptyPages() }, ...overrides };
}

test.describe('REQ-0140 canvas side panel parity', () => {
  test('panel + filter chips render with rarity-tinted inventory rows', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    const fixture = fx({});
    fixture.inv.pages[0].pos = [
      { uid: 'inv_dagger', id: 'dagger', loc: 'inv', cell: null, rot: 0 },
      { uid: 'inv_herb', id: 'herb_pouch', loc: 'inv', cell: null, rot: 0 },
    ];
    await loadFixtureAndBoot(page, fixture);
    await page.setViewportSize(COMPACT);

    await expect(page.locator('.canvas-side-panel')).toBeVisible();
    await expect(page.locator('.canvas-inv-filter')).toHaveCount(5);
    await expect(page.locator('.canvas-inv-filter[data-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.canvas-side-panel .item-list .icard')).toHaveCount(2);
    await expect(page.locator('.canvas-side-panel .item-list .icard[class*="rar-"]').first()).toBeVisible();
    // detail card (shared effect-text renderer target) populated from paint.
    await expect(page.locator('.canvas-item-detail')).toBeVisible();
  });

  test('filter chips narrow the list deterministically', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    const fixture = fx({});
    fixture.inv.pages[0].pos = [
      { uid: 'inv_dagger', id: 'dagger', loc: 'inv', cell: null, rot: 0 }, // Weapon/Metal
      { uid: 'inv_herb', id: 'herb_pouch', loc: 'inv', cell: null, rot: 0 }, // tag Relic
    ];
    await loadFixtureAndBoot(page, fixture);
    await page.setViewportSize(COMPACT);

    const rows = page.locator('.canvas-side-panel .item-list .icard');
    await expect(rows).toHaveCount(2);
    await page.locator('.canvas-inv-filter[data-filter="weapon"]').click();
    await expect(page.locator('.canvas-inv-filter[data-filter="weapon"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.canvas-side-panel .icard[data-inv-id="dagger"]')).toHaveCount(1);
    await expect(page.locator('.canvas-side-panel .icard[data-inv-id="herb_pouch"]')).toHaveCount(0);
    await page.locator('.canvas-inv-filter[data-filter="relic"]').click();
    await expect(page.locator('.canvas-side-panel .icard[data-inv-id="herb_pouch"]')).toHaveCount(1);
    await expect(page.locator('.canvas-side-panel .icard[data-inv-id="dagger"]')).toHaveCount(0);
    await page.locator('.canvas-inv-filter[data-filter="all"]').click();
    await expect(rows).toHaveCount(2);
  });

  test('selection syncs both ways: panel click -> board ring, board tap -> panel', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    const fixture = fx({});
    fixture.pos = [
      { uid: 'grid_dagger', id: 'dagger', loc: 'grid', cell: [1, 2], rot: 0 }, // (1,2)+(2,2)
      { uid: 'grid_flame', id: 'flame_tablet', loc: 'grid', cell: [3, 1], rot: 0 }, // (3,1)+(4,1)
    ];
    fixture.inv.pages[0].pos = [{ uid: 'inv_dagger', id: 'dagger', loc: 'inv', cell: null, rot: 0 }];
    await loadFixtureAndBoot(page, fixture);
    await page.setViewportSize(COMPACT);

    const board = page.locator('canvas.board-canvas').first();
    const box = (await board.boundingBox())!;

    // panel -> board: click the inventory row (dagger) -> ring over the
    // placed dagger instance.
    await page.locator('.canvas-side-panel .icard[data-inv-id="dagger"]').first().click();
    await expect(page.locator('.canvas-item-detail[data-detail-id="dagger"]')).toBeVisible();
    expect(await page.locator('.canvas-sel-ring').count()).toBeGreaterThanOrEqual(1);

    // board -> panel: tap a DIFFERENT placed item (flame_tablet) -> the
    // panel detail follows the board selection.
    await page.mouse.click(box.x + cx(1), box.y + cy(3));
    await expect(page.locator('.canvas-item-detail[data-detail-id="flame_tablet"]')).toBeVisible();
  });

  test('drag from panel to board places the item', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    const fixture = fx({});
    fixture.inv.pages[0].pos = [{ uid: 'inv_dagger', id: 'dagger', loc: 'inv', cell: null, rot: 0 }];
    await loadFixtureAndBoot(page, fixture);
    await page.setViewportSize(COMPACT);

    const row = page.locator('.canvas-side-panel .icard[data-inv-uid="inv_dagger"]');
    await expect(row).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const board = page.locator('canvas.board-canvas').first();
    const boardBox = (await board.boundingBox())!;
    // drop onto the free BP cell (3,1) -> a 2x1 dagger fits (3,1)+(4,1).
    await drag(
      page,
      { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height / 2 },
      { x: boardBox.x + cx(1), y: boardBox.y + cy(3) }
    );
    // inv -> canvas is a REFERENCE creation in this engine (the inventory
    // HOME stays listed; a placed reference now sits on the board -- engine
    // consumed as-is). Assert the placement landed: tapping the drop cell
    // surfaces the placed item's tip.
    await expect(page.locator('.canvas-side-panel .icard[data-inv-uid="inv_dagger"]')).toHaveCount(1);
    await page.mouse.click(boardBox.x + cx(1), boardBox.y + cy(3));
    await expect(page.locator('.item-tip[data-tip-id="dagger"]')).toBeVisible();
  });

  test('empty inventory shows guidance copy', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await loadFixtureAndBoot(page, fx({})); // BP present, inventory empty
    await page.setViewportSize(COMPACT);
    await expect(page.locator('.canvas-side-panel .canvas-empty[data-empty-variant="empty-inventory"]')).toBeVisible();
  });

  test('zero-BP canvas shows guidance copy over the board', async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await loadFixtureAndBoot(page, fx({ bps: [], pos: [], sis: [] }));
    await page.setViewportSize(COMPACT);
    await expect(page.locator('.canvas-empty[data-empty-variant="zero-bp"]')).toBeVisible();
  });

  test('1280x800 canvas screen has no vertical scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);
    await expect(page.locator('canvas.board-canvas').first()).toBeVisible();
    await expect(page.locator('.canvas-side-panel')).toBeVisible();
    await expect(page.locator('.canvas-legacy-inv')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(4);
  });
});
