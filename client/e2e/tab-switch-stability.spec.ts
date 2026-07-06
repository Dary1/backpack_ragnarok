// REQ-0031 Phase A -- Bug 2: tab-switch freeze.
//
// Root cause (confirmed via live reproduction, not just code reading):
// InventoryBoard.tsx used to destroy+recreate its whole PixiJS Application
// (a new WebGL context on the same <canvas>) on every tab switch.
// WEBGL_lose_context.loseContext() (called by Application.destroy()) is
// ASYNCHRONOUS per spec -- the immediately-following remount's
// canvas.getContext('webgl2', ...) call raced the still-in-progress
// context teardown. Under this server's software GL path (swiftshader,
// no real GPU), that race left the driver permanently failing shader
// compiles, which sent PixiJS's GlLimitsSystem.contextChange() ->
// checkMaxIfStatementsInShader() into its `while(true)` loop forever (a
// genuine infinite busy-loop, confirmed via a CDP Debugger.pause taken
// mid-hang landing on that exact frame every time, and renderer CPU
// pegged near 100% and climbing for 16+ seconds with no recovery
// observed). Fix: BoardRenderer.setOps() re-points an already-mounted
// board at a new BoardOps (and re-registers it under the new BoardId in
// drag.ts's board registry) with NO Application/canvas/context churn at
// all -- see BoardRenderer.setOps's doc comment and InventoryBoard.tsx's
// module comment for the full mechanism.
//
// This test clicks through all 5 tabs, 3 rounds (15 clicks total). Each
// click's evidence gate:
//  - the inventory board's <canvas> stays present (never unmounted),
//  - page.evaluate(() => 1+1) resolves within 2s (a hang here reproduces
//    the bug -- pre-fix this genuinely never recovered within any
//    reasonable window),
//  - total /api/content + /api/profile* fetch count across the WHOLE
//    15-click sequence stays low (boot-time fetches only -- store.ts's
//    setActiveInvPage() never fetches, confirmed by reading store.ts, and
//    this network assertion is the live-evidence backstop for that
//    reading).
import { test, expect } from '@playwright/test';

test('tab switching (15 clicks, 3 rounds) never hangs the page and never refetches', async ({ page }) => {
  let contentReqs = 0;
  let profileReqs = 0;
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/content')) contentReqs++;
    if (url.includes('/api/profile')) profileReqs++;
  });

  await page.goto('/app/#/backpacks');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(300);

  // Boot-time fetches only, before any tab click.
  expect(contentReqs).toBeLessThanOrEqual(1);
  expect(profileReqs).toBeLessThanOrEqual(1);
  const bootContentReqs = contentReqs;
  const bootProfileReqs = profileReqs;

  for (let round = 0; round < 3; round++) {
    for (let tabIdx = 0; tabIdx < 5; tabIdx++) {
      await page.locator('.inv-tab').nth(tabIdx).click();

      // Inventory board canvas must still be present (never torn down to
      // a blank/placeholder state).
      await expect(page.locator('canvas.inventory-board-canvas')).toHaveCount(1, { timeout: 2000 });

      // The hang reproduction check: this must resolve quickly. Pre-fix,
      // this call would never resolve within any bounded window we tried
      // (16+ seconds observed with no recovery) -- 2s is generous slack
      // for a healthy page (typical observed time: well under 200ms).
      const result = await Promise.race([
        page.evaluate(() => 1 + 1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('page hung: evaluate did not resolve within 2s')), 2000)),
      ]);
      expect(result).toBe(2);
    }
  }

  // Total canvas count stays exactly 2 (canvas board + inventory board) --
  // no leaked/duplicate <canvas> elements from a remount pattern.
  await expect(page.locator('canvas')).toHaveCount(2);

  // No tab click ever triggers a content/profile refetch.
  expect(contentReqs).toBe(bootContentReqs);
  expect(profileReqs).toBe(bootProfileReqs);
});
