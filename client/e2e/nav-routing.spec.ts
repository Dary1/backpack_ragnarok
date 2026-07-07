// REQ-0034 -- global nav + hash routing E2E coverage.
//
// Two things this file proves:
//  1. Clicking through all 5 nav routes updates the URL hash, highlights
//     the active nav item, and shows the right route content.
//  2. The WebGL-churn regression guard: navigating away from #/backpacks
//     and back 5 times in a row must NOT destroy/recreate either board's
//     PixiJS Application (see docs/REQ/REQ-0034-global-navigation.md's
//     "Hard constraint" section, and the REQ-0031 Phase A bug this
//     re-guards against). Verified empirically, not just by reading code:
//     after 5 round trips, both boards must still be interactive (a
//     drag/drop still works, matching the existing baseline-smoke drag
//     assertions' own success criteria).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootApp, cx, cy, drag, waitForAutoSave } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await bootApp(page);
}

test('clicking through all 5 nav routes updates hash + active highlight + content', async ({ page }) => {
  await bootApp(page);

  // Default app locale is 'en' (store.ts's initial snapshot) -- nav
  // labels render in English unless the JA/EN toggle is clicked, which no
  // test in this file does, so labels/placeholder titles below match the
  // EN side of Nav.tsx's NAV_ITEMS / App.tsx's PlaceholderPage calls.
  const routes: Array<{ label: string; hash: string; contentCheck: () => Promise<void> }> = [
    {
      label: 'Backpacks',
      hash: '#/backpacks',
      contentCheck: async () => {
        await expect(page.locator('.backpacks-view')).not.toHaveClass(/route-hidden/);
      },
    },
    {
      label: 'Schedule',
      hash: '#/schedule',
      contentCheck: async () => {
        // REQ-0036 P1-C: #/schedule now renders the real SchedulePage
        // instead of the generic PlaceholderPage. REQ-0086: Warehouse
        // moved out to its own route (below), so this now asserts on the
        // Rooms view directly rather than a tab chip (retired).
        await expect(page.locator('.schedule-page')).toBeVisible();
        await expect(page.locator('.schedule-rooms-view')).toBeVisible();
      },
    },
    {
      label: 'Warehouse',
      hash: '#/warehouse',
      contentCheck: async () => {
        // REQ-0086: promoted from a Schedule-page tab to its own route.
        await expect(page.locator('[data-testid="schedule-warehouse-topstrip"]')).toBeVisible({ timeout: 10000 });
      },
    },
    {
      label: 'Friends',
      hash: '#/friends',
      contentCheck: async () => {
        await expect(page.locator('.placeholder-page h2')).toHaveText('Friends');
      },
    },
    {
      label: 'Dex',
      hash: '#/dex',
      contentCheck: async () => {
        await expect(page.locator('.dex-root')).toBeVisible();
      },
    },
    {
      label: 'Settings',
      hash: '#/settings',
      contentCheck: async () => {
        // REQ-0037: #/settings now renders the dedicated Settings.tsx
        // component (account block + REQ-0039 bot-mode placeholder)
        // instead of the generic PlaceholderPage -- assert on its own
        // root class + heading instead.
        await expect(page.locator('.settings-page h2')).toHaveText('Settings');
      },
    },
  ];

  // Start from a NON-default route first (Schedule) so every click in
  // the loop below -- including the eventual click back onto Backpacks,
  // the default route -- is a genuine route CHANGE. setRoute() in
  // store.ts intentionally no-ops (including skipping the location.hash
  // write) when asked to switch to the ALREADY-active route -- clicking
  // Backpacks as literally the first action on a fresh boot (where
  // Backpacks is already active with no hash present yet) would never
  // observe a hash write, which is correct app behavior, not a bug to
  // route around by weakening the assertion.
  await page.locator('.nav-link', { hasText: 'Schedule' }).click();
  await expect(page).toHaveURL(/#\/schedule$/);

  for (const r of routes) {
    await page.locator('.nav-link', { hasText: r.label }).click();
    await expect(page).toHaveURL(new RegExp(r.hash.replace('/', '\\/') + '$'));
    await expect(page.locator('.nav-link', { hasText: r.label })).toHaveClass(/nav-link-active/);
    await r.contentCheck();
  }
});

test('reload on a deep-linked hash (#/dex) loads directly into that route', async ({ page }) => {
  await page.goto('/app/#/dex');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await expect(page.locator('.dex-root')).toBeVisible();
  await expect(page.locator('.nav-link', { hasText: 'Dex' })).toHaveClass(/nav-link-active/);
});

test('backpacks board round-trip: navigate away and back 5 times, boards stay interactive (WebGL-churn guard)', async ({ page }) => {
  await loadFixtureAndBoot(page);

  // Sanity: exactly 2 canvases at boot (canvas board + inventory board).
  await expect(page.locator('canvas')).toHaveCount(2);

  for (let i = 0; i < 5; i++) {
    await page.locator('.nav-link', { hasText: 'Dex' }).click();
    await expect(page.locator('.dex-root')).toBeVisible();
    await page.locator('.nav-link', { hasText: 'Backpacks' }).click();
    await expect(page.locator('.backpacks-view')).not.toHaveClass(/route-hidden/);
  }

  // Still exactly 2 canvases -- no leaked/duplicate elements from a
  // destroy+recreate pattern anywhere in the 5 round trips.
  await expect(page.locator('canvas')).toHaveCount(2);

  // The page must not have hung (the exact same "did the renderer wedge"
  // check tab-switch-stability.spec.ts uses for the analogous Phase A bug).
  const result = await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, reject) => setTimeout(() => reject(new Error('page hung after nav round trips')), 2000)),
  ]);
  expect(result).toBe(2);

  // Prove real interactivity, not just DOM presence: drag p200 (hilt, at
  // inv page0 cell (4,4) per the baseline fixture) onto canvas BP
  // "gamma"'s free cell (6,3), then verify the move actually committed.
  const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
  const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
  await drag(page, { x: invBox.x + cx(4), y: invBox.y + cy(4) }, { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) });

  await waitForAutoSave(page);
  const resp = await page.request.get('/api/profile/default/canvas');
  const canvas = (await resp.json()).canvas;
  const po = canvas.pos.find((p: any) => p.uid === 'p200');
  expect(po).toBeTruthy();
  expect(po.loc).toBe('grid');
  expect(po.cell).toEqual([6, 3]);
});
