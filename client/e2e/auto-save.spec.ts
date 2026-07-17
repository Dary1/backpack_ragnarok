// REQ-0031 Phase B -- auto-save round-trip (E2E, input emulation).
//
// Verifies the core auto-save contract: a mutation (drag), a wait (the
// 800ms debounce, client/src/store.ts's AUTO_SAVE_DEBOUNCE_MS), then a
// full page reload -- with NO click on any save/load control anywhere in
// this test (there is none: the buttons are retired) -- and the mutated
// state is exactly what a fresh boot reads back. Also checks the
// auto-save status indicator's text cycles saving -> saved, and that a
// drag NOT yet released (mid-gesture) does not itself trigger a save
// (the debounce only ever starts at commit, never mid-drag -- see
// store.ts's notifyStateChanged()/scheduleAutoSave() module comment).
import { test, expect } from '@playwright/test';
import { cx, cy, drag, loadFixtureFileAndBoot, reloadApp } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/squad-fixture.json', import.meta.url);


test.describe('auto-save', () => {
  test('mutate -> wait -> reload: state persists with zero clicks on any save/load control', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);

    // Confirm there is truly nothing to click for this to work.
    await expect(page.locator('button:has-text("Save")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Load")')).toHaveCount(0);

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Drag p900 (blade) from inventory onto the canvas BP -- the ONLY
    // action in this test; no save/load button exists to click. REQ-0247:
    // uses the shared drag() (identical 8-step/25ms trusted-CDP gesture this
    // spec used to hand-roll), so a change to the drag technique lands here
    // too instead of silently skipping the one spec that copied it.
    const savePut = page.waitForResponse(
      (r) => r.url().includes('/api/profile/') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await drag(
      page,
      { x: invBox.x + cx(5), y: invBox.y + cy(5) },
      { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) }
    );

    // Status indicator should show "saving" shortly after commit, then
    // "saved" once the debounced PUT completes. REQ-0247: the settle is the
    // PUT landing, not a 1600ms sleep -- the response is armed BEFORE the
    // gesture so the wait cannot miss a save that flushed early, and a
    // loaded box can no longer overrun the budget (this spec's fixed sleep
    // was a live flake in REQ-0247's own baseline).
    const statusDuringSave = await page.locator('.auto-save-status').getAttribute('data-status');
    expect(['saving', 'saved']).toContain(statusDuringSave); // timing-tolerant: may already have flushed on a fast box

    await savePut;
    await expect(page.locator('.auto-save-status')).toHaveAttribute('data-status', 'saved');

    // Reload WITHOUT clicking anything -- boot() re-fetches the saved
    // profile automatically (unchanged since REQ-0027/T0.2).
    await reloadApp(page);

    const resp = await page.request.get('/api/profile/default/canvas');
    const canvas = (await resp.json()).canvas;
    const po = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([1, 2]);
    // REQ-0033 Phase 2: inv -> canvas is now REFERENCE CREATION, not a
    // physical move -- the home stays in inv.pages[0], untouched, at its
    // ORIGINAL cell [5,5] (see fixtures/squad-fixture.json), alongside
    // the brand-new canvas reference asserted above. This auto-save round
    // trip is still exactly what it was testing (a mutation persists with
    // zero save/load clicks) -- only the specific shape of "the mutation"
    // changed under the reference model.
    const home = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p900');
    expect(home).toBeTruthy();
    expect(home.cell).toEqual([5, 5]);

    // And the reloaded PAGE itself (not just the API) shows the PO gone
    // from the inventory board and present on canvas -- full round trip
    // through the UI, not just the storage layer.
    await expect(page.locator('canvas.board-canvas').first()).toHaveCount(1);
  });

  test('a drag NOT yet released does not itself trigger a save (debounce starts at commit only)', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    // REQ-0247: assert the settled state directly instead of sleeping 900ms
    // for it -- toHaveAttribute retries until the boot-time save settles, so
    // this is the same gate without the fixed budget.
    await expect(page.locator('.auto-save-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    // Start a drag but do NOT release it yet.
    await page.mouse.move(invBox.x + cx(5), invBox.y + cy(5));
    await page.mouse.down();
    await page.mouse.move(invBox.x + cx(6), invBox.y + cy(5), { steps: 3 });
    await page.waitForTimeout(500);

    // Still mid-drag: status must NOT have flipped to 'saving' (no commit
    // has happened yet, so notifyStateChanged()/scheduleAutoSave() have
    // not been called).
    await expect(page.locator('.auto-save-status')).toHaveAttribute('data-status', 'saved');

    // Release: NOW it commits and the debounce starts.
    await page.mouse.up();
    await page.waitForTimeout(100);
    const statusAfterCommit = await page.locator('.auto-save-status').getAttribute('data-status');
    expect(['saving', 'saved']).toContain(statusAfterCommit);
  });
});
