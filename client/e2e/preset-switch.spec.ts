// REQ-0031 Phase B -- preset switch + Preset+ (E2E, input emulation).
//
// Preset model (mock-src/engine.js): st.{linked,bps,pos,sis} is always the
// ACTIVE preset's canvas; st.presets={active,names,store} holds every
// OTHER preset's snapshot. switchPreset() atomically swaps active<->store.
// The client wires this via store.ts's switchActivePreset()/
// addNewPresetAndSwitch(), which mutate state in place and call
// notifyStateChanged() -- Board.tsx's existing render(state)-on-
// stateVersion-bump effect redraws the newly-active preset with NO PixiJS
// Application recreation (confirmed by code reading: canvas ops read
// state.bps/pos/sis directly, container(){return state;} -- see
// client/src/board/boardOps.ts's makeCanvasOps -- so switchPreset()
// mutating those same fields is already everything a render() needs).
//
// This test: drag a free-placed inventory PO onto the canvas BP (preset 1,
// the initially-active one) -> switch to preset 2 (canvas becomes empty,
// preset 2 has no BPs/POs by construction -- addPreset/migrateState never
// copy content into a new preset) -> switch back to preset 1 -> the PO is
// still exactly where it was placed (both configurations preserved by the
// atomic swap).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { autoSaveAndFetch, cx, cy, drag } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/preset-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await page.goto('/app/');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('preset switch', () => {
  test('place PO on preset 1 canvas -> switch to preset 2 (empty) -> switch back (still there)', async ({ page }) => {
    await loadFixtureAndBoot(page);

    // Sanity: 5 preset tabs, preset 1 active.
    await expect(page.locator('.preset-tab')).toHaveCount(5);
    await expect(page.locator('.preset-tab-active')).toHaveText('Preset 1');

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // p900 (blade, free-placed in inv page 0 at [5,5]-[6,5]) -> drag onto
    // BP alpha's free cell (1,2) (occupies (1,2)-(2,2), avoiding the
    // linker cell at (3,2)).
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

    // Switch to preset 2 -- canvas must become empty of the just-placed PO
    // (and of the BP itself: preset 2 has no BPs, constructed empty).
    await page.locator('.preset-tab').nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.preset-tab-active')).toHaveText('Preset 2');

    canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
    expect(canvas.bps.length).toBe(0);
    expect(canvas.pos.length).toBe(0);
    // preset 1's content is preserved in store[0] while inactive.
    expect(canvas.presets.store[0]).toBeTruthy();
    expect(canvas.presets.store[0].bps.some((b: any) => b.id === 'alpha')).toBe(true);
    expect(canvas.presets.store[0].pos.find((p: any) => p.uid === 'p900')?.cell).toEqual([1, 2]);

    // Switch back to preset 1 -- the PO (and BP) must be back exactly
    // where they were.
    await page.locator('.preset-tab').nth(0).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.preset-tab-active')).toHaveText('Preset 1');

    canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(0);
    expect(canvas.bps.some((b: any) => b.id === 'alpha')).toBe(true);
    po = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(po).toBeTruthy();
    expect(po.cell).toEqual([1, 2]);
    // preset 2 (now inactive again) is still empty in store[1].
    expect(canvas.presets.store[1]).toEqual({ linked: true, bps: [], pos: [], sis: [] });
  });

  test('Preset+ appends a new tab and switches to it', async ({ page }) => {
    await loadFixtureAndBoot(page);
    await expect(page.locator('.preset-tab')).toHaveCount(5);

    await page.locator('.preset-add-btn').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.preset-tab')).toHaveCount(6);
    await expect(page.locator('.preset-tab-active')).toHaveText('Preset 6');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names.length).toBe(6);
    expect(canvas.presets.active).toBe(5);
    // the new preset (now active) is empty; preset 1's original content
    // survives in store[0].
    expect(canvas.bps.length).toBe(0);
    expect(canvas.presets.store[0].bps.some((b: any) => b.id === 'alpha')).toBe(true);
  });
});
