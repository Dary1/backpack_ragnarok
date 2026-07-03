// Trivial smoke tests — REQ-0031 Phase A, Step 1. Establishes the rig
// works end-to-end (real browser, real network, real API) before any
// bug-specific test is written. Two independent checks:
//   1. GET /api/health (via request context, no browser needed) returns
//      {ok:true,...} -- proves baseURL/tunnel routing is correct.
//   2. The app page itself loads under the SAME baseURL and shows a
//      known element (the header title + the live-data-source badge)
//      once boot() resolves -- proves the SPA + its relative /api/*
//      fetches work when loaded from the tunnel host.
import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('GET /api/health returns ok:true', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  test('app boots and shows the live data-source badge', async ({ page }) => {
    await page.goto('/app/');
    await expect(page.locator('h1')).toHaveText('backpack_ragnarok');
    const badge = page.locator('.data-source-badge');
    await expect(badge).toHaveText('live', { timeout: 10_000 });
    await expect(badge).toHaveClass(/badge-live/);
    // Both boards' canvases should be mounted by the time boot resolves.
    await expect(page.locator('canvas.board-canvas')).toHaveCount(2);
  });
});
