// REQ-0070 -- MJOLNIR canvas page chrome (E2E). Verifies the redesigned
// #/backpacks chrome renders around the SAME two always-mounted PixiJS
// boards, and that the relocated/re-skinned controls are wired to the
// same behavior contracts other spec files cover in depth (preset
// gestures: preset-switch/long-press-rename/tab-reorder-trash; board
// drags: baseline-smoke/grid-8x8/bp-*; auto-save: auto-save.spec) --
// this file asserts only the NEW chrome's presence and wiring, without
// duplicating those flows.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

test.describe('REQ-0070 canvas page chrome (MJOLNIR)', () => {
  test('board stages, coord rails, boardfoot presets + save seal render around live boards', async ({ page }) => {
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
    // Preset tabs live in the canvas stage's boardfoot now (same
    // .preset-tab class contract every preset spec selects on).
    await expect(page.locator('.board-wrap-canvas .boardfoot .preset-tab').first()).toBeVisible();
    await expect(page.locator('.board-wrap-canvas .boardfoot .preset-add-btn')).toBeVisible();
    // Boardfoot auto-save seal settles on 'saved'; the header's own
    // .auto-save-status indicator remains a separate, unique element.
    await expect(page.locator('.boardfoot-saved')).toHaveAttribute('data-save-state', 'saved');
    await expect(page.locator('.auto-save-status')).toHaveCount(1);
    // Stagehead stats chip shows live board counts (real numbers).
    await expect(page.locator('.stagehead-chip')).toContainText(/\d/);
  });

  test('item panel: icard catalog + click-to-select detail card; hover tooltip contract intact', async ({ page }) => {
    await bootApp(page);
    const cards = page.locator('.item-panel .icard');
    expect(await cards.count()).toBeGreaterThan(0);
    // Detail card defaults to the first catalog item, then follows clicks.
    await expect(page.locator('.item-detail')).toHaveCount(1);
    const secondName = (await cards.nth(1).locator('.icard-nm').textContent()) ?? '';
    expect(secondName.length).toBeGreaterThan(0);
    await cards.nth(1).click();
    await expect(page.locator('.item-detail .item-detail-nm')).toHaveText(secondName);
    await expect(cards.nth(1)).toHaveClass(/is-selected/);
    // The pre-REQ-0070 hover tooltip still appears with the same anatomy.
    const thirdName = (await cards.nth(2).locator('.icard-nm').textContent()) ?? '';
    await cards.nth(2).hover();
    await expect(page.locator('.tooltip')).toHaveCount(1);
    await expect(page.locator('.tooltip h3')).toContainText(thirdName);
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
