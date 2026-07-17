// REQ-0031 Phase B -- squad switch + Squad+ (E2E, input emulation).
//
// Squad model (mock-src/engine.js): st.{linked,bps,pos,sis} is always the
// ACTIVE squad's canvas; st.presets={active,names,store} holds every
// OTHER squad's snapshot. switchSquad() atomically swaps active<->store.
// The client wires this via store.ts's switchActiveSquad()/
// addNewSquadAndSwitch(), which mutate state in place and call
// notifyStateChanged() -- Board.tsx's existing render(state)-on-
// stateVersion-bump effect redraws the newly-active squad with NO PixiJS
// Application recreation (confirmed by code reading: canvas ops read
// state.bps/pos/sis directly, container(){return state;} -- see
// client/src/board/boardOps.ts's makeCanvasOps -- so switchSquad()
// mutating those same fields is already everything a render() needs).
//
// This test: drag a free-placed inventory PO onto the canvas BP (squad 1,
// the initially-active one) -> switch to squad 2 (canvas becomes empty,
// squad 2 has no BPs/POs by construction -- addSquad/migrateState never
// copy content into a new squad) -> switch back to squad 1 -> the PO is
// still exactly where it was placed (both configurations preserved by the
// atomic swap).
import { test, expect } from '@playwright/test';
import { autoSaveAndFetch, cx, cy, drag, loadFixtureFileAndBoot } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/squad-fixture.json', import.meta.url);


test.describe('squad switch', () => {
  test('place PO on squad 1 canvas -> switch to squad 2 (empty) -> switch back (still there)', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);

    // Sanity: 5 squad tabs, squad 1 active.
    await expect(page.locator('.squad-tab')).toHaveCount(5);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 1');

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // p900 (blade, free-placed in inv page 0 at [5,5]-[6,5]) -> drag onto
    // BP alpha's free cell (1,2) (occupies (1,2)-(2,2), avoiding the
    // unit cell at (3,2)).
    await drag(
      page,
      { x: invBox.x + cx(5), y: invBox.y + cy(5) },
      { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) }
    );

    let canvas = await autoSaveAndFetch(page);
    let po = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([1, 2]);
    expect(canvas.presets.active).toBe(0);

    // Switch to squad 2 -- canvas must become empty of the just-placed PO
    // (and of the BP itself: squad 2 has no BPs, constructed empty).
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 2');

    canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
    expect(canvas.bps.length).toBe(0);
    expect(canvas.pos.length).toBe(0);
    // squad 1's content is preserved in store[0] while inactive.
    expect(canvas.presets.store[0]).toBeTruthy();
    expect(canvas.presets.store[0].bps.some((b: any) => b.id === 'alpha')).toBe(true);
    expect(canvas.presets.store[0].pos.find((p: any) => p.uid === 'p900')?.cell).toEqual([1, 2]);

    // Switch back to squad 1 -- the PO (and BP) must be back exactly
    // where they were.
    await page.locator('.squad-tab').nth(0).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 1');

    canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(0);
    expect(canvas.bps.some((b: any) => b.id === 'alpha')).toBe(true);
    po = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(po).toBeTruthy();
    expect(po.cell).toEqual([1, 2]);
    // squad 2 (now inactive again) is still empty in store[1].
    expect(canvas.presets.store[1]).toEqual({ linked: true, bps: [], pos: [], sis: [] });
  });

  test('Squad+ appends a new tab and switches to it', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    await expect(page.locator('.squad-tab')).toHaveCount(5);

    await page.locator('.squad-add-btn').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.squad-tab')).toHaveCount(6);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 6');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names.length).toBe(6);
    expect(canvas.presets.active).toBe(5);
    // the new squad (now active) is empty; squad 1's original content
    // survives in store[0].
    expect(canvas.bps.length).toBe(0);
    expect(canvas.presets.store[0].bps.some((b: any) => b.id === 'alpha')).toBe(true);
  });
});
