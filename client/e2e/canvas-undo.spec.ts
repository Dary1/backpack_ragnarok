// client/e2e/canvas-undo.spec.ts -- REQ-0367: single-step undo (Ctrl+Z).
//
// Gate 1: drag a canvas PO to a new cell, Ctrl+Z -> the PO is back at its
// origin, and the restore persisted through the NORMAL auto-save (the
// boardfoot seal cycles saving -> saved after the undo -- design rule 5:
// the auto-save PUT stays the one writer). The boardfoot's own ↩ button is
// the same action and its disabled state tracks the slot.
//
// Gate 2: a warehouse claim (an EXCLUDED, server-authoritative op) clears
// the slot -- a Ctrl+Z right after it does NOTHING: neither the claim nor
// the earlier move is reverted, and no save is even scheduled.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DATA_ROOT } from './e2e-env';
import { bootApp, cx, cy, drag, fetchSavedCanvas, waitForAutoSave } from './helpers';

const DEV_USER_PATH = join(E2E_DATA_ROOT, 'data', 'config', 'dev_user.json');
const UNDO_BTN = '[data-testid="canvas-undo-btn"]';

/** One 4x4 BP homed on page 0 (claim-pulse.spec.ts's fixture design: the
 * canvas BP and its inventory home share the record, so migrateState moves
 * nothing mid-boot) plus ONE canvas-referenced hilt at [3,3] whose home
 * sits at page-0 [7,7] -- the reference model's post-drop shape (canvas
 * record AND inventory home coexist under one uid, see auto-save.spec.ts's
 * REQ-0033 note). The BP is otherwise empty so the drag target cells are
 * free. */
function makeCanvas() {
  const shape: number[][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) shape.push([r, c]);
  const bp = { id: 'e2e_undo_bp', name: 'Undo', color: '#4a90d9', origin: [2, 2], shape, unit: { id: 'dwarf', off: [0, 0] } };
  const empty = () => ({ bps: [], pos: [], sis: [], tms: [] });
  return {
    linked: true,
    bps: [bp],
    pos: [{ uid: 'u_po', id: 'hilt', loc: 'grid', cell: [3, 3], rot: 0 }],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        { bps: [bp], pos: [{ uid: 'u_po', id: 'hilt', loc: 'grid', cell: [7, 7], rot: 0 }], sis: [], tms: [] },
        empty(), empty(), empty(), empty(),
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

const canvasPO = (canvas: any, uid: string) => canvas.pos.find((p: any) => p.uid === uid);

test.describe('REQ-0367 -- single-step undo', () => {
  test('drag -> Ctrl+Z: PO back at origin, auto-save cycles saving -> saved; the ↩ button mirrors', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const undoBtn = page.locator(UNDO_BTN);
    await expect(undoBtn).toBeDisabled(); // fresh boot: the slot is empty

    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: box.x + cx(3), y: box.y + cy(3) }, { x: box.x + cx(4), y: box.y + cy(4) });
    await waitForAutoSave(page);
    let canvas = await fetchSavedCanvas(page);
    expect(canvasPO(canvas, 'u_po').cell).toEqual([4, 4]); // the move committed + persisted
    await expect(undoBtn).toBeEnabled(); // the commit armed the slot

    await page.keyboard.press('Control+z');
    // The restore goes through the NORMAL auto-save choke point: the
    // boardfoot seal must cycle saving -> saved (spec e2e gate). 'saving'
    // holds for at least the 800ms debounce, so this catch is not racy.
    await expect(page.locator('.boardfoot-saved')).toHaveAttribute('data-save-state', 'saving');
    await expect(page.locator('.boardfoot-saved')).toHaveAttribute('data-save-state', 'saved', { timeout: 8000 });
    canvas = await fetchSavedCanvas(page);
    expect(canvasPO(canvas, 'u_po').cell).toEqual([3, 3]); // back at origin
    await expect(undoBtn).toBeDisabled(); // one step: the slot is consumed

    // The ↩ button is the same action.
    await drag(page, { x: box.x + cx(3), y: box.y + cy(3) }, { x: box.x + cx(5), y: box.y + cy(5) });
    await waitForAutoSave(page);
    canvas = await fetchSavedCanvas(page);
    expect(canvasPO(canvas, 'u_po').cell).toEqual([5, 5]);
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();
    await waitForAutoSave(page);
    canvas = await fetchSavedCanvas(page);
    expect(canvasPO(canvas, 'u_po').cell).toEqual([3, 3]);
    await expect(undoBtn).toBeDisabled();
  });

  test.describe('excluded op', () => {
    // dev_user.json flip -> item_admin: the only grant path that works under
    // both storage backends -- same convention as claim-pulse.spec.ts /
    // warehouse-mjolnir.spec.ts, copied deliberately.
    let devUserBackup: string | null = null;
    test.beforeEach(async () => {
      devUserBackup = existsSync(DEV_USER_PATH) ? readFileSync(DEV_USER_PATH, 'utf8') : null;
      writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));
    });
    test.afterEach(async () => {
      if (devUserBackup !== null) writeFileSync(DEV_USER_PATH, devUserBackup);
      else if (existsSync(DEV_USER_PATH)) rmSync(DEV_USER_PATH);
    });

    test('a warehouse claim clears the slot: Ctrl+Z after it does NOTHING', async ({ page }) => {
      const origCanvasResp = await page.request.get('/api/profile/default/canvas');
      const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null;
      try {
        await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
        const grantResp = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
        expect(grantResp.status()).toBe(200);
        const grantUid = (await grantResp.json()).item.itemUid as string;

        await bootApp(page);
        // Arm the slot with an in-scope move first -- the gate is that the
        // claim (not merely the route change) leaves nothing undoable.
        const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;
        await drag(page, { x: box.x + cx(3), y: box.y + cy(3) }, { x: box.x + cx(4), y: box.y + cy(4) });
        await waitForAutoSave(page);
        await expect(page.locator(UNDO_BTN)).toBeEnabled();

        await page.locator('.nav-link', { hasText: 'Warehouse' }).click();
        const claimBtn = page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`);
        await expect(claimBtn).toBeVisible({ timeout: 10000 });
        await claimBtn.click();
        await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });
        await waitForAutoSave(page);

        const before = await fetchSavedCanvas(page);
        expect(before.inv.pages.flatMap((p: any) => p.pos).some((p: any) => p.uid === grantUid)).toBe(true);

        await page.keyboard.press('Control+z');
        // An undo WOULD schedule a PUT inside the 800ms debounce; give one
        // room to (not) happen, then compare the whole saved canvas.
        await page.waitForTimeout(1600);
        const after = await fetchSavedCanvas(page);
        expect(after).toEqual(before); // NOTHING: claim intact, move intact
        expect(canvasPO(after, 'u_po').cell).toEqual([4, 4]);

        // Back on the canvas page the button agrees: the slot is empty.
        await page.locator('.nav-link', { hasText: 'Backpacks' }).click();
        await expect(page.locator(UNDO_BTN)).toBeDisabled();
      } finally {
        if (origCanvas) await page.request.put('/api/profile/default/canvas', { data: origCanvas });
      }
    });
  });
});
