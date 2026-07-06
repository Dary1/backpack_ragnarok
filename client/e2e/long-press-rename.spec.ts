// REQ-0031 Phase B -- long-press rename (E2E, input emulation), both tab
// kinds (inventory page tabs + canvas preset tabs). Shared implementation:
// client/src/LongPressTabs.tsx (~600ms pointerdown hold with no move
// arms an inline rename input; a plain/short click still switches).
//
// Persistence: renames go through engine.renameInvPage/renamePreset ->
// store.ts's renameInventoryPage/renameActivePreset -> notifyStateChanged()
// -> auto-save (same debounced-PUT path as every other mutation), so a
// rename must survive a full page reload with NO manual save action.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { autoSaveAndFetch, longPress } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/preset-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await page.goto('/app/#/backpacks');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('long-press rename', () => {
  test('inventory tab: long-press renames inline, persists after reload via auto-save', async ({ page }) => {
    await loadFixtureAndBoot(page);

    const tab = page.locator('.inv-tab').nth(2); // page index 2 (0-based) -- "3"
    const box = (await tab.boundingBox())!;
    await longPress(page, box);

    const input = page.locator('.inv-tab-rename-input');
    await expect(input).toHaveCount(1);
    await input.fill('Materials');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('.inv-tab').nth(2)).toHaveText('Materials');

    // Persistence via auto-save: wait out the debounce, then reload the
    // page WITHOUT clicking anything, and confirm the name survived.
    await autoSaveAndFetch(page);
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    await expect(page.locator('.inv-tab').nth(2)).toHaveText('Materials');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.inv.names[2]).toBe('Materials');
  });

  test('preset tab: long-press renames inline, persists after reload via auto-save', async ({ page }) => {
    await loadFixtureAndBoot(page);

    const tab = page.locator('.preset-tab').nth(0);
    const box = (await tab.boundingBox())!;
    await longPress(page, box);

    const input = page.locator('.preset-tab-rename-input');
    await expect(input).toHaveCount(1);
    await input.fill('Boss Loadout');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('.preset-tab').nth(0)).toHaveText('Boss Loadout');

    await autoSaveAndFetch(page);
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    await expect(page.locator('.preset-tab').nth(0)).toHaveText('Boss Loadout');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names[0]).toBe('Boss Loadout');
  });

  test('a normal (short) click on a tab still switches, and does NOT arm rename', async ({ page }) => {
    await loadFixtureAndBoot(page);

    const tab1 = page.locator('.inv-tab').nth(1);
    const box1 = (await tab1.boundingBox())!;
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80); // well under the 600ms long-press threshold
    await page.mouse.up();
    await page.waitForTimeout(150);

    await expect(page.locator('.inv-tab-rename-input')).toHaveCount(0);
    await expect(page.locator('.inv-tab-active')).toHaveText('2');
  });

  test('Escape cancels a rename with no persisted change', async ({ page }) => {
    await loadFixtureAndBoot(page);

    const tab = page.locator('.inv-tab').nth(3);
    const box = (await tab.boundingBox())!;
    await longPress(page, box);

    const input = page.locator('.inv-tab-rename-input');
    await expect(input).toHaveCount(1);
    await input.fill('Should Not Persist');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // reverted to the original label, no rename input remains
    await expect(page.locator('.inv-tab-rename-input')).toHaveCount(0);
    await expect(page.locator('.inv-tab').nth(3)).toHaveText('4');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.inv.names[3]).toBe('4');
  });
});
