// REQ-0069 -- landing (title) screen + MJOLNIR chrome E2E coverage.
//
// Four things this file proves:
//  1. The empty hash ('/app/', i.e. '#/') renders the landing, with the
//     app chrome (rail/HUD) absent and the backpacks boards still
//     MOUNTED (hidden via .route-hidden), never unmounted -- the
//     REQ-0034 one-Pixi-app-per-board rule extended to the new route.
//     The landing menu deep-links into real app routes, and the two new
//     placeholder routes (#/market, #/ragnarok) resolve.
//  2. The rail LOGO returns to the landing from anywhere (backpacks,
//     schedule, dex), normalizing the hash back to bare '#/'.
//  3. Boards survive landing round-trips: after bouncing
//     backpacks->landing->backpacks repeatedly there are still exactly 2
//     board canvases and a real drag still commits (same interactivity
//     bar as nav-routing.spec.ts's WebGL-churn guard).
//  4. The cold-boot-on-landing path: boards that BOOTED while hidden
//     (display:none backpacks-view under the landing route) come up
//     interactive after entering the app -- a codepath no pre-REQ-0069
//     spec exercised (they all booted straight into #/backpacks).
//
// Particles note: the ember field is hard-gated OFF under automation
// (navigator.webdriver -- see client/src/landing/particles.ts), so these
// tests run with zero decorative rAF work; test 1 sanity-checks the gate
// input really is set in this rig.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootApp, cx, cy, drag, waitForAutoSave } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url);

async function putFixture(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
}

/** Drags p200 (inv page0 cell (4,4) in the baseline fixture) onto canvas
 * BP gamma's free cell (6,3) and asserts the move persisted -- the exact
 * interactivity bar nav-routing.spec.ts's round-trip guard uses. */
async function assertBoardsInteractive(page: import('@playwright/test').Page) {
  const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
  const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
  await drag(page, { x: invBox.x + cx(4), y: invBox.y + cy(4) }, { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) });
  await waitForAutoSave(page);
  const resp = await page.request.get('/api/profile/default/canvas');
  const canvas = (await resp.json()).canvas;
  const po = canvas.pos.find((p: { uid: string }) => p.uid === 'p200');
  expect(po).toBeTruthy();
  expect(po.loc).toBe('grid');
  expect(po.cell).toEqual([6, 3]);
}

test('empty hash renders the landing; menu deep-links; boards stay mounted (hidden)', async ({ page }) => {
  await page.goto('/app/');

  // Landing is up: logo lockup + menu, and NO app chrome.
  await expect(page.locator('.landing-stage')).toBeVisible();
  await expect(page.locator('h1.landing-logo-main')).toHaveText('RAGNARÖK');
  await expect(page.locator('.nav-rail')).toHaveCount(0);
  await expect(page.locator('.app-header')).toHaveCount(0);

  // Sanity: the particles E2E gate's input holds in this rig.
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);

  // The backpacks view is HIDDEN, not unmounted -- and boot() proceeds in
  // the background: both board canvases appear in the DOM (Pixi mounts
  // fine under display:none -- fixed-size canvases, no layout measuring).
  await expect(page.locator('.backpacks-view')).toHaveClass(/route-hidden/);
  await expect(page.locator('canvas.board-canvas').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('canvas.inventory-board-canvas')).toBeAttached();

  // Ragnarok (REQ-0066) and Market (REQ-0064) rail routes resolve by deep
  // link. Both were PlaceholderPage stubs when this test was first
  // written; both now render their real pages (fixed post-deploy,
  // 2026-07-07 -- this assertion was stale, not the app).
  await page.goto('/app/#/ragnarok');
  await expect(page.locator('[data-testid="ragnarok-page"]')).toBeVisible();
  await page.goto('/app/#/market');
  await expect(page.locator('[data-testid="market-page"]')).toBeVisible();

  // Back to the landing; a menu entry deep-links into a real app route.
  await page.goto('/app/#/');
  await expect(page.locator('.landing-stage')).toBeVisible();
  await page.locator('.landing-mi', { hasText: 'Watch expeditions' }).click();
  await expect(page).toHaveURL(/#\/schedule$/);
  await expect(page.locator('.schedule-page')).toBeVisible();
});

test('rail logo returns to the landing from backpacks, schedule and dex', async ({ page }) => {
  await bootApp(page); // boots #/backpacks

  // From backpacks.
  await page.locator('.nav-logo').click();
  await expect(page.locator('.landing-stage')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.nav-rail')).toHaveCount(0);

  // From schedule.
  await page.locator('.landing-mi', { hasText: 'Continue' }).click();
  await expect(page).toHaveURL(/#\/backpacks$/);
  await page.locator('.nav-link', { hasText: 'Schedule' }).click();
  await expect(page.locator('.schedule-page')).toBeVisible();
  await page.locator('.nav-logo').click();
  await expect(page.locator('.landing-stage')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);

  // From dex.
  await page.locator('.landing-mi', { hasText: 'Continue' }).click();
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();
  await page.locator('.nav-logo').click();
  await expect(page.locator('.landing-stage')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test('boards survive landing round-trips (canvas still interactive after return)', async ({ page }) => {
  await putFixture(page);
  await bootApp(page);
  await expect(page.locator('canvas')).toHaveCount(2);

  for (let i = 0; i < 3; i++) {
    await page.locator('.nav-logo').click();
    await expect(page.locator('.landing-stage')).toBeVisible();
    await page.locator('.landing-mi', { hasText: 'Continue' }).click();
    await expect(page.locator('.backpacks-view')).not.toHaveClass(/route-hidden/);
  }

  // Still exactly 2 canvases (no leaked/duplicate boards; the landing's
  // own particle canvas unmounted with it), and the page didn't wedge.
  await expect(page.locator('canvas')).toHaveCount(2);
  const result = await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, reject) => setTimeout(() => reject(new Error('page hung after landing round trips')), 2000)),
  ]);
  expect(result).toBe(2);

  await assertBoardsInteractive(page);
});

test('cold boot ON the landing: boards initialized while hidden are interactive after Continue', async ({ page }) => {
  await putFixture(page);
  await page.goto('/app/');
  await expect(page.locator('.landing-stage')).toBeVisible();

  // Let boot() finish while the landing is showing (boards mount hidden).
  await expect(page.locator('canvas.board-canvas').first()).toBeAttached({ timeout: 15_000 });

  await page.locator('.landing-mi', { hasText: 'Continue' }).click();
  await expect(page.locator('.backpacks-view')).not.toHaveClass(/route-hidden/);
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10_000 });
  await page.waitForTimeout(400);

  await assertBoardsInteractive(page);
});
