// REQ-0031 Phase A -- Bug 1: BP inventory<->canvas transfer.
//
// Root cause (confirmed via live reproduction + CDP-captured evidence, not
// just code reading): BoardRenderer.onGlobalPointerMove is wired per-board
// via `this.app.stage.on('globalpointermove', ...)`, but PixiJS's
// EventSystem attaches its OWN native `pointermove` listener on
// `document` itself (see node_modules/pixi.js's EventSystem.addEvents:
// `globalThis.document.addEventListener('pointermove', this._onPointerMove,
// true)`), NOT scoped to that Application's own <canvas> bounds. Since the
// canvas board and the inventory board are TWO independent PixiJS
// Applications (REQ-0030 Phase 2), every single mouse move during a drag
// fires `globalpointermove` on BOTH boards' stages -- including whichever
// board the pointer is NOT physically over. That board maps the pointer's
// (foreign) screen coordinates into ITS OWN local cell space, computes a
// (meaningless) cell, and unconditionally calls updateCarry(), which can
// CLOBBER a `carry.drop` the correct board had just set correctly moments
// earlier for the SAME native event. Listener registration order made
// this a real ~50% failure-rate race depending on drag speed/sample
// count (confirmed via 16 repeated identical rapid-fire drag attempts
// pre-fix: exactly the back half failed every time, matching a
// last-listener-wins race, not random noise).
//
// Fix (client/src/board/BoardRenderer.ts's onGlobalPointerMove): a board
// only acts as the authority for a given pointermove event when the
// pointer is ACTUALLY within its own canvas's current
// getBoundingClientRect(); otherwise it clears its own ghost/target
// visuals but does not touch `carry.drop`, leaving that decision to
// whichever board's handler for the SAME event finds the pointer
// genuinely inside its own bounds.
//
// This engine-level legality itself was ALREADY CORRECT (verified via a
// direct mock-src/engine.js sanity script before ever touching the
// client: canTransferBP() and transferBP() both behaved exactly as
// specified for the empty-BP, contents-carrying, and overlap-rejection
// cases) -- so no engine changes were needed or made; this is a pure
// client interaction-layer fix.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE_PATH = new URL('./fixtures/bp-transfer-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await page.goto('/app/');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(400);
}

const CELL = 80;
const PAD = 38;
const cx = (c: number) => PAD + (c - 1) * CELL + CELL / 2;
const cy = (r: number) => PAD + (r - 1) * CELL + CELL / 2;

/** Drags from (screen) grabX/Y to dropX/Y with >=5 intermediate move
 * steps, matching the task spec's "multi-step move" requirement. */
async function drag(
  page: import('@playwright/test').Page,
  grab: { x: number; y: number },
  drop: { x: number; y: number },
  steps = 8
) {
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(grab.x + (drop.x - grab.x) * t, grab.y + (drop.y - grab.y) * t, { steps: 1 });
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function saveAndFetch(page: import('@playwright/test').Page) {
  await page.locator('button:has-text("Save")').click();
  await page.waitForTimeout(400);
  const resp = await page.request.get('/api/profile/default/canvas');
  return (await resp.json()).canvas;
}

test.describe('BP inventory <-> canvas transfer', () => {
  test('1. empty BP: inventory -> canvas (originally-reported case)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // test_empty: 1x2 BP at inv page0 origin (1,1) -- grab via its linker
    // core cell (1,1), drop so the origin lands on free canvas cells
    // (6,5)-(6,6).
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(5), y: canvasBox.y + cy(6) }
    );

    const canvas = await saveAndFetch(page);
    const moved = canvas.bps.find((b: any) => b.id === 'test_empty');
    expect(moved).toBeTruthy();
    expect(moved.origin).toEqual([6, 5]);
    expect(canvas.inv.pages[0].bps.some((b: any) => b.id === 'test_empty')).toBe(false);
  });

  test('2. BP with 1 PO + seated SI: inventory -> canvas (contents travel with it)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // test_full: 1x1 BP at inv page0 origin (1,4), hosting PO p100 (hilt)
    // with SI a100 (acc_gem) seated on its gem socket. Grab via its only
    // cell (also the linker cell), drop onto free canvas cell (6,4).
    await drag(
      page,
      { x: invBox.x + cx(4), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(4), y: canvasBox.y + cy(6) }
    );

    const canvas = await saveAndFetch(page);
    const moved = canvas.bps.find((b: any) => b.id === 'test_full');
    expect(moved).toBeTruthy();
    expect(moved.origin).toEqual([6, 4]);

    const po = canvas.pos.find((p: any) => p.uid === 'p100');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([6, 4]); // travelled with the BP (same delta)

    const si = canvas.sis.find((s: any) => s.uid === 'a100');
    expect(si).toBeTruthy();
    expect(si.host).toEqual({ po: 'p100', si: 0 }); // host unchanged (keyed by uid)

    expect(canvas.inv.pages[0].bps.some((b: any) => b.id === 'test_full')).toBe(false);
    expect(canvas.inv.pages[0].pos.some((p: any) => p.uid === 'p100')).toBe(false);
    expect(canvas.inv.pages[0].sis.some((s: any) => s.uid === 'a100')).toBe(false);
  });

  test('3. round trip: canvas -> inventory -> canvas (no state corruption)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Step A: test_empty inv -> canvas at (6,5).
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(5), y: canvasBox.y + cy(6) }
    );
    let canvas = await saveAndFetch(page);
    expect(canvas.bps.find((b: any) => b.id === 'test_empty')?.origin).toEqual([6, 5]);

    // Reload to get a fresh boot reading the just-saved state (Save/Load
    // round trip, same as a real user closing and reopening the app).
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);

    // Step B: drag it back canvas -> inventory page0, landing at a free
    // page-local region, e.g. origin (3,3)-(3,4) (both free per the
    // fixture's inventory page0 layout).
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: canvasBox2.x + cx(5), y: canvasBox2.y + cy(6) },
      { x: invBox2.x + cx(3), y: invBox2.y + cy(3) }
    );
    canvas = await saveAndFetch(page);
    expect(canvas.bps.some((b: any) => b.id === 'test_empty')).toBe(false);
    const backInInv = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(backInInv).toBeTruthy();
    expect(backInInv.origin).toEqual([3, 3]);

    // Step C: drag it forward again canvas... no wait, it's in inventory
    // now -- drag inv -> canvas once more to complete the "round trip"
    // (canvas -> inventory -> canvas), landing back at (6,5).
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    const invBox3 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox3 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: invBox3.x + cx(3), y: invBox3.y + cy(3) },
      { x: canvasBox3.x + cx(5), y: canvasBox3.y + cy(6) }
    );
    canvas = await saveAndFetch(page);
    const finalBp = canvas.bps.find((b: any) => b.id === 'test_empty');
    expect(finalBp).toBeTruthy();
    expect(finalBp.origin).toEqual([6, 5]);
    expect(canvas.inv.pages[0].bps.some((b: any) => b.id === 'test_empty')).toBe(false);

    // No state corruption: the OTHER fixture BP (test_full, never
    // touched) and its PO/SI must be exactly as the fixture left them.
    const untouchedBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_full');
    expect(untouchedBp?.origin).toEqual([1, 4]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p100')?.cell).toEqual([1, 4]);
  });

  test('4. illegal overlap: BP dropped onto an occupied canvas region is rejected', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Attempt to drop test_empty onto canvas cell (1,1) -- already
    // occupied by BP "alpha" in the fixture. Grab via linker cell (1,1).
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(1), y: canvasBox.y + cy(1) }
    );

    const canvas = await saveAndFetch(page);
    // Transfer must NOT have happened: test_empty stays in inventory,
    // canvas BP set is unchanged, no corruption on either side.
    expect(canvas.bps.some((b: any) => b.id === 'test_empty')).toBe(false);
    expect(canvas.bps.map((b: any) => b.id).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    const stillInInv = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(stillInInv).toBeTruthy();
    expect(stillInInv.origin).toEqual([1, 1]);
    // alpha's own footprint must be exactly as before (no partial
    // overlap/corruption from the rejected transfer attempt).
    const alpha = canvas.bps.find((b: any) => b.id === 'alpha');
    expect(alpha.origin).toEqual([1, 1]);
  });
});
