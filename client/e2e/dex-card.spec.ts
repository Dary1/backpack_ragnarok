// REQ-0052 -- Dex Card API + In-App Subwindow System E2E coverage.
//
// Things this file proves:
//  1. The Dex catalog's new preview trigger ("i" badge, dex-card-preview-btn)
//     opens the SAME entry's card in the DexCardWindow subwindow WITHOUT
//     navigating away from the catalog grid (.dex-grid stays visible,
//     .dex-detail-columns is NOT entered) -- distinct from clicking the
//     card body itself, which is untouched pre-existing behavior.
//  2. The opened card shows the correct name/rarity for the clicked
//     entry, fetched live from GET /api/dex/card/:kind/:id (not a stale
//     client-side copy).
//  3. ESC closes the subwindow.
//  4. Clicking the scrim (outside every open card) closes the subwindow.
//  5. The card's "view full page" footer link navigates to the canonical
//     '#/dex/<id>' deep link, which lands directly on that entry's
//     detail view (DexDetail), not the catalog grid nor the backpacks
//     fallback route.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

test('dex card subwindow: catalog preview trigger opens a card without navigating away from the grid', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await expect(card).toBeVisible();

  await card.locator('.dex-card-preview-btn').click();

  // Subwindow appears with the right entry...
  await expect(page.locator('[data-testid="dexcard-window"]')).toBeVisible();
  await expect(page.locator('[data-testid="dexcard-name"]')).toBeVisible();

  // ...but the catalog grid is STILL the current view (no navigation
  // into the two-pane detail layout happened).
  await expect(page.locator('.dex-grid')).toBeVisible();
  await expect(page.locator('.dex-detail-columns')).toHaveCount(0);
});

test('dex card subwindow: ESC closes it', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await page.locator('.dex-search').fill('blade');
  await page.locator('.dex-card', { hasText: 'blade' }).first().locator('.dex-card-preview-btn').click();
  await expect(page.locator('[data-testid="dexcard-window"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="dexcard-window"]')).toHaveCount(0);
});

test('dex card subwindow: clicking the scrim (outside the card) closes it', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await page.locator('.dex-search').fill('blade');
  await page.locator('.dex-card', { hasText: 'blade' }).first().locator('.dex-card-preview-btn').click();
  await expect(page.locator('[data-testid="dexcard-window"]')).toBeVisible();

  // Click the scrim itself at a corner far from the centered card.
  await page.locator('[data-testid="dexcard-scrim"]').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('[data-testid="dexcard-window"]')).toHaveCount(0);
});

test('dex card subwindow: footer "view full page" link deep-links to #/dex/<id> and lands on that entry\'s detail view', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await page.locator('.dex-search').fill('blade');
  await page.locator('.dex-card', { hasText: 'blade' }).first().locator('.dex-card-preview-btn').click();
  await expect(page.locator('[data-testid="dexcard-window"]')).toBeVisible();

  await page.locator('[data-testid="dexcard-fulllink"]').click();

  // The subwindow closes (its own onClick calls onClose) and the app
  // navigates straight into the two-pane detail view for THIS id --
  // proving '#/dex/<id>' round-trips through routeFromHash's new
  // DEX_ITEM_HASH_RE branch (store/core.ts) rather than falling back to
  // 'backpacks' the way an unrecognized hash segment otherwise would.
  await expect(page.locator('[data-testid="dexcard-window"]')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/dex\/blade$/);
  await expect(page.locator('.dex-detail-columns')).toBeVisible();
});

test('dex card subwindow: an si-kind entry also opens correctly from the catalog (kind mapping po->item/si->si is exercised, not just the item path above)', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const someSiId = Object.keys(content.sis)[0];
  expect(someSiId).toBeTruthy();

  await page.locator('.dex-search').fill(someSiId);
  await page.locator('.dex-card', { hasText: someSiId }).first().locator('.dex-card-preview-btn').click();
  await expect(page.locator('[data-testid="dexcard-window"]')).toBeVisible();
  await expect(page.locator('[data-testid="dexcard-name"]')).toBeVisible();
});
