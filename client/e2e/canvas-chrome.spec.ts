// REQ-0070 -- MJOLNIR canvas page chrome (E2E). Verifies the redesigned
// #/backpacks chrome renders around the SAME two always-mounted PixiJS
// boards, and that the relocated/re-skinned controls are wired to the
// same behavior contracts other spec files cover in depth (squad
// gestures: squad-switch/long-press-rename/tab-reorder-trash; board
// drags: baseline-smoke/grid-8x8/bp-*; auto-save: auto-save.spec) --
// this file asserts only the NEW chrome's presence and wiring, without
// duplicating those flows.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootApp, bx, by, cx, cy, drag } from './helpers';

test.describe('REQ-0070 canvas page chrome (MJOLNIR)', () => {
  test('board stages, coord rails, boardfoot squads + save seal render around live boards', async ({ page }) => {
    await bootApp(page);
    // Both Pixi boards alive, each inside an ornate MJOLNIR stage.
    await expect(page.locator('canvas.board-canvas')).toHaveCount(2);
    await expect(page.locator('.backpacks-view .board-wrap.board-stage')).toHaveCount(2);
    await expect(page.locator('.board-wrap-canvas.board-stage.ornate')).toHaveCount(1);
    // Four gold-knot corners on the canvas stage.
    await expect(page.locator('.board-wrap-canvas > .k')).toHaveCount(4);
    // Coordinate rails over the canvas board (A.. columns / 1.. rows,
    // driven by the real LAYOUT -- 8x8 since REQ-0031 Phase B).
    await expect(page.locator('.board-coords-cols span')).toHaveCount(8);
    await expect(page.locator('.board-coords-rows span')).toHaveCount(8);
    await expect(page.locator('.board-coords-cols span').first()).toHaveText('A');
    // Squad tabs live in the canvas stage's boardfoot now (same
    // .squad-tab class contract every squad spec selects on).
    await expect(page.locator('.board-wrap-canvas .boardfoot .squad-tab').first()).toBeVisible();
    await expect(page.locator('.board-wrap-canvas .boardfoot .squad-add-btn')).toBeVisible();
    // Boardfoot auto-save seal settles on 'saved'; the header's own
    // .auto-save-status indicator remains a separate, unique element.
    await expect(page.locator('.boardfoot-saved')).toHaveAttribute('data-save-state', 'saved');
    await expect(page.locator('.auto-save-status')).toHaveCount(1);
    // Stagehead stats chip shows live board counts (real numbers).
    await expect(page.locator('.stagehead-chip')).toContainText(/\d/);
  });

  test('REQ-0114: the item/SI catalog panel (ItemList) is NOT rendered on the backpacks view', async ({ page }) => {
    await bootApp(page);
    // REQ-0114: the ItemPanel (item/SI catalog, the "ItemList") was removed
    // from the backpacks view per user request. The two always-mounted Pixi
    // boards (Canvas + Inventory) stay; only this third panel is gone.
    await expect(page.locator('.item-panel')).toHaveCount(0);
    await expect(page.locator('.item-panel .icard')).toHaveCount(0);
    // The detail card lived only inside that panel, so it is gone too.
    await expect(page.locator('.item-detail')).toHaveCount(0);
    // Canvas + Inventory boards remain mounted.
    await expect(page.locator('canvas.board-canvas')).toHaveCount(2);
  });

  test('embark dock navigates to the expedition page; boards survive the round trip', async ({ page }) => {
    await bootApp(page);
    await expect(page.locator('.embark-dock .btn-forge')).toBeVisible();
    await page.locator('.embark-dock .btn-forge').click();
    await expect(page).toHaveURL(/#\/schedule$/);
    // The dock is canvas-page chrome -- hidden along with the route.
    await expect(page.locator('.embark-dock')).not.toBeVisible();
    // Back to backpacks: both boards still present (never torn down).
    await page.locator('.nav-link', { hasText: 'Backpacks' }).click();
    await expect(page).toHaveURL(/#\/backpacks$/);
    await expect(page.locator('canvas.board-canvas')).toHaveCount(2);
    await expect(page.locator('.embark-dock .btn-forge')).toBeVisible();
  });
});

// REQ-0371: the stats chip's HP + REFERENCE power readout ("place a BP ->
// chip updates" gate). Reuses bp-transfer's fixture + its case-1 move so the
// drag mechanics stay pinned by that spec, not re-proven here.
test.describe('REQ-0371 build power readout', () => {
  test('chip shows HP + power; both rise by exactly the BP\'s HP when an empty BP lands on canvas', async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/bp-transfer-fixture.json', import.meta.url), 'utf8'));
    await page.request.put('/api/profile/default/canvas', { data: fixture });
    await bootApp(page);
    const hpChip = page.locator('[data-testid="canvas-stat-hp"]');
    const powerChip = page.locator('[data-testid="canvas-stat-power"]');
    await expect(hpChip).toContainText(/\d/);
    await expect(powerChip).toContainText(/\d/);
    const num = async (loc: import('@playwright/test').Locator) =>
      parseInt((await loc.innerText()).replace(/\D/g, ''), 10);
    const hp0 = await num(hpChip);
    const pw0 = await num(powerChip);
    // bp-transfer case-1's own move: test_empty (1x2, no POs, no hpMax -> the
    // sim's 100 default) from inv (1,1) via its ✥ badge onto canvas (6,5).
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: invBox.x + bx(1), y: invBox.y + by(1) },
      { x: canvasBox.x + cx(5), y: canvasBox.y + cy(6) },
    );
    // An empty BP contributes exactly its HP to both numbers.
    await expect(hpChip).toContainText(String(hp0 + 100));
    await expect(powerChip).toContainText(String(pw0 + 100));
  });
});
