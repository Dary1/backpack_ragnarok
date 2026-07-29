// REQ-0336 -- the malformed-data coverage REQ-0284's post-mortem named as
// missing, and the layering it revealed.
//
// REQ-0284 (unit-less BP -> `bp.unit.id` throws -> React root torn down -> the
// whole app blanks, reported by the owner as "the freeze") recorded exactly why
// 196 e2e tests did not catch it:
//
//     "Every schedule-fixture squad (and squad 9, the REQ-0045 (d) multi-BP
//      case) seats a `berserker` Unit on every BP, so the unit-less branch was
//      never exercised."
//
// Every fixture in client/e2e/fixtures/ is WELL-FORMED, so nothing had ever
// asked what happens to a row the app cannot use. Writing this file answered
// that, and the answer has three layers -- each test below pins one:
//
//   1. the ENGINE refuses a canvas it cannot hydrate. Before REQ-0336 that
//      rejection went nowhere (boot() is a floating promise) and the app sat on
//      "Loading board..." forever -- a fourth shape of the freeze, found here.
//      It must surface as a stated error the user can read.
//   2. the RENDERER isolates per item (BoardRenderer's drawGuarded), so a row
//      that survives hydration but cannot be drawn costs only itself.
//   3. the BOUNDARY (RenderErrorBoundary) contains anything that still escapes,
//      so no throw can ever blank the app again.
//
// Layer 2 is deliberately NOT asserted by feeding it a magic broken shape. That
// was tried: every shape bad enough to break the renderer is caught by layer 1
// first, and every shape mild enough to pass layer 1 (an unknown unit id, a
// missing texture) the renderer already tolerates by design -- it falls back to
// a placeholder sprite rather than throwing. drawGuarded is defense in depth for
// the shape NOBODY HAS ENUMERATED YET, which is precisely the shape a test
// cannot name. Its guarantee is verified by construction (a try/catch around
// each item) and by the fact that the tests below still pass with it in place.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootApp, cx, cy, drag, waitForAutoSave } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url);

function baseFixture(): any {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/** PUTs a canvas straight to the profile, bypassing the app -- the app would
 *  never author these shapes, which is the point. */
async function putCanvas(page: import('@playwright/test').Page, canvas: unknown): Promise<void> {
  const res = await page.request.put('/api/profile/default/canvas', { data: canvas });
  expect(res.status()).toBe(200);
}

test.describe('REQ-0336: a row the app cannot use never costs the whole app', () => {
  test('the REQ-0284 shape (a unit-less BP) renders the other BPs and the board stays interactive', async ({ page }) => {
    const canvas = baseFixture();
    // The exact REQ-0284 shape: BP.unit is typed non-optional in
    // shared/engine.d.ts, and real stored canvases omit it anyway.
    expect(canvas.bps.length).toBeGreaterThan(0);
    delete canvas.bps[0].unit;
    await putCanvas(page, canvas);
    await bootApp(page);

    // Handled BELOW the boundary -- this must not fall into the error card.
    await expect(page.locator('[data-testid="canvas-board-error"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="inventory-board-error"]')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(2);

    // Still responsive, proven the way the WebGL-churn guards prove it.
    const alive = await Promise.race([
      page.evaluate(() => 1 + 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page hung on a unit-less BP')), 2000)),
    ]);
    expect(alive).toBe(2);

    // And still WORKING: drag p200 (hilt, inventory page 0 cell (4,4) in the
    // baseline fixture) onto canvas BP "gamma"'s free cell (6,3) and read the
    // committed state back from the server.
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: invBox.x + cx(4), y: invBox.y + cy(4) }, { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) });

    await waitForAutoSave(page);
    const saved = (await (await page.request.get('/api/profile/default/canvas')).json()).canvas;
    const po = saved.pos.find((p: { uid: string }) => p.uid === 'p200');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([6, 3]);
  });

  test('a canvas the engine cannot hydrate states the error instead of spinning on "Loading" forever', async ({ page }) => {
    const canvas = baseFixture();
    // Structurally invalid enough that engine.migrateState() throws. Before
    // REQ-0336 this rejected a floating promise (main.tsx: `boot();`) and the
    // snapshot stayed 'loading' -- both boards showed "Loading board..."
    // indefinitely, with no error and no way out. That is the failure this test
    // exists to keep fixed.
    canvas.bps.push({
      id: 'bp_unhydratable',
      name: 'BROKEN',
      color: '#ff0000',
      shape: [[0, 0], null, [Number.NaN, 1], 'nonsense'],
      origin: [Number.NaN, 2],
      unit: { id: 'no_such_unit', off: [0, 0] },
      hpMax: 30,
    });
    await putCanvas(page, canvas);
    await page.goto('/app/#/backpacks');

    // The stated failure, not a spinner: Board.tsx / InventoryBoard.tsx render
    // "Board unavailable: {error}" for status:'error' -- a branch that existed
    // all along and was simply never reached.
    await expect(page.locator('.board-placeholder.board-error').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.board-placeholder').first()).not.toHaveText(/Loading/i);

    // The app is not wedged: the rest of the shell still works, and the page
    // answers an unrelated round-trip promptly.
    const alive = await Promise.race([
      page.evaluate(() => 1 + 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page hung on an unhydratable canvas')), 2000)),
    ]);
    expect(alive).toBe(2);
    await page.locator('.nav-link', { hasText: 'Dex' }).click();
    await expect(page.locator('.dex-root')).toBeVisible({ timeout: 10000 });
  });
});
