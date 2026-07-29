// client/e2e/claim-pulse.spec.ts -- REQ-0346.
//
// The warehouse claim pulse (ghosts.ts pulseCellsSuccess, REQ-0041's "received
// an item" cue) is the third of the three out-of-render animations REQ-0345
// catalogued, and the only one that had NEVER reached a screen: it drew into
// gTarget, and both of its call sites call notifyStateChanged() on the very
// next line, which re-enters BoardRenderer.render(state), whose first act is
// gTarget.removeChildren(). REQ-0346 gives it gPulse -- the one layer
// render(state) does not clear -- and this spec is the assertion that was
// missing for the pulse's whole life.
//
// It has to be a PIXEL test, and it has to run the REAL claim, because every
// cheaper assertion available here is green on the broken code:
//   - the claim POST succeeds,
//   - the item lands in the inventory,
//   - the "Moved to your inventory." toast appears (it is set on the line
//     after the notifyStateChanged() that was eating the pulse),
//   - pulseCellsSuccess() is entered and its Graphics are constructed.
// All of that happened for a year while the player saw nothing. So: Playwright
// screenshots the COMPOSITED inventory canvas and the #59d68a population is
// counted in-page -- the probe pattern from unit-skin-fallback.spec.ts test 4
// via board-render-ondemand.spec.ts, which is where the pulse's two siblings
// (the reject flash and the drop-target tint) are asserted the same way.
//
// Differential in both directions, so it cannot pass on a pre-existing pixel of
// the same hue and cannot pass on a pulse that never ends:
//   before the claim  -> 0
//   during the pulse  -> painted, WITH the claim toast on screen (which is what
//                        proves the state-driven re-render that used to destroy
//                        it has already run)
//   after ~2s         -> 0, sampled repeatedly across more than one blink
//                        period so an "off" half-blink cannot be mistaken for
//                        the pulse being over.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DATA_ROOT } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { bootApp } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const DEV_USER_PATH = join(REPO_ROOT, 'data', 'config', 'dev_user.json');
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');

/** ghosts.ts pulseCellsSuccess's stroke colour. */
const PULSE_GREEN: [number, number, number] = [0x59, 0xd6, 0x8a];
/** geom.ts CLAIM_PULSE_TOTAL_MS / CLAIM_PULSE_BLINK_MS, mirrored so this spec
 * can reason about the window without importing client source into e2e. */
const PULSE_TOTAL_MS = 2000;
const PULSE_BLINK_MS = 330;

const INV_CANVAS = 'canvas.inventory-board-canvas';

/**
 * How many pixels of a board canvas sit within `tol` of `rgb`, over the WHOLE
 * canvas -- byte-for-byte the helper board-render-ondemand.spec.ts uses (see
 * its doc): Playwright hands back a PNG of the composited element, it goes
 * back into the page as a data URL and the browser decodes it, so there is no
 * decoder to maintain and no dependency to add.
 */
async function colourHits(page: Page, selector: string, rgb: [number, number, number], tol = 24): Promise<number> {
  const canvas = page.locator(selector).first();
  await expect(canvas).toBeVisible();
  const b64 = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, rgb, tol }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const el = document.createElement('canvas');
      el.width = img.width;
      el.height = img.height;
      const ctx = el.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let hits = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) hits++;
      }
      return hits;
    },
    { b64, rgb, tol },
  );
}

/** One empty 4x4 BP whose inventory HOME is page 0 -- the page the client opens
 * on (store/core.ts's activeInvPage default). That is the whole fixture design:
 * applyWarehouseClaim first-fits from `openPage`, so an empty BP on page 0
 * guarantees the claim lands on the DISPLAYED page and takes the
 * pulseCellsSuccess branch rather than useWarehouseData's pulseTab fallback.
 * The BP is empty of POs so the claimed hilt is the only item drawn and the
 * baseline is as quiet as possible. (A canvas BP with no inventory home at all
 * is a state no real client could produce -- migrateCanvasToReferencesV3 would
 * first-fit it onto a page mid-boot and move what this spec measures. Same
 * reason bp-rotate.spec.ts and board-render-ondemand.spec.ts home theirs.) */
function makeCanvas() {
  const shape: number[][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) shape.push([r, c]);
  const bp = { id: 'e2e_pulse_bp', name: 'Pulse', color: '#4a90d9', origin: [2, 2], shape, unit: { id: 'dwarf', off: [0, 0] } };
  const empty = () => ({ bps: [], pos: [], sis: [], tms: [] });
  return {
    linked: true,
    bps: [bp],
    pos: [],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [{ bps: [bp], pos: [], sis: [], tms: [] }, empty(), empty(), empty(), empty()],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

test.describe('REQ-0346 -- the warehouse claim pulse is painted', () => {
  // dev_user.json flip -> item_admin: the only grant path that works under
  // BOTH storage backends. Same convention as warehouse-mjolnir.spec.ts /
  // schedule.spec.ts's REQ-0041 describe, copied deliberately.
  let devUserBackup: string | null = null;
  test.beforeEach(async () => {
    devUserBackup = existsSync(DEV_USER_PATH) ? readFileSync(DEV_USER_PATH, 'utf8') : null;
    writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));
  });
  test.afterEach(async () => {
    if (devUserBackup !== null) writeFileSync(DEV_USER_PATH, devUserBackup);
    else if (existsSync(DEV_USER_PATH)) rmSync(DEV_USER_PATH);
  });

  test('claiming a granted row paints #59d68a over the placement cells, while the claim toast is up -- and takes it away when the 2s pulse ends', async ({ page }) => {
    const devProfileExisted = existsSync(DEV_PROFILE_PATH);
    const devProfileBackup = devProfileExisted ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    // pg-aware restore, exactly as warehouse-mjolnir.spec.ts does it: under
    // STORAGE_BACKEND=pg a dev.json FILE restore is a silent no-op, so the
    // original canvas is re-PUT through the API instead.
    const origCanvasResp = await page.request.get('/api/profile/default/canvas');
    const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null;
    try {
      await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
      const grantResp = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
      expect(grantResp.status()).toBe(200);
      const grantUid = (await grantResp.json()).item.itemUid as string;

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Warehouse' }).click();
      await expect(page.locator('[data-testid="schedule-warehouse-topstrip"]')).toBeVisible({ timeout: 10000 });
      // The inventory board is the SAME Pixi Application, portaled into the
      // warehouse tab's slot (App.tsx's REQ-0041 portal) -- it is the renderer
      // useWarehouseData reaches through getInventoryRenderer().
      await expect(page.locator(INV_CANVAS)).toBeVisible({ timeout: 10000 });
      // Park the pointer off both canvases: hover is a legitimate repaint
      // trigger and a link-trace highlight is its own colour on the board.
      await page.mouse.move(5, 5);

      // BEFORE: nothing on this board is the pulse's green.
      expect(await colourHits(page, INV_CANVAS, PULSE_GREEN)).toBe(0);

      const claimBtn = page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`);
      await expect(claimBtn).toBeVisible({ timeout: 10000 });
      await claimBtn.click();

      // DURING: sample faster than the 330ms blink so an "off" half cannot be
      // read as an absence. On the pre-REQ-0346 code this poll runs out its
      // whole timeout at 0 -- that is the regression this spec exists for.
      await expect
        .poll(async () => colourHits(page, INV_CANVAS, PULSE_GREEN), {
          timeout: 10000,
          intervals: [60, 60, 60, 60, 80, 80, 80, 100, 100, 150],
        })
        .toBeGreaterThan(100);
      const seenAt = Date.now();

      // ...and the state-driven re-render that used to destroy the pulse has
      // already happened by now: useWarehouseData sets this toast on the line
      // AFTER the notifyStateChanged() that re-enters render(state). Green
      // pixels co-existing with this toast is the whole point of the fix.
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });

      // AFTER: the pulse started no later than `seenAt`, so it is certainly
      // over PULSE_TOTAL_MS after it. Then sample across more than a full
      // blink period -- a single zero could be an "off" half of a pulse still
      // running, six zeros spanning ~900ms cannot be.
      await page.waitForTimeout(PULSE_TOTAL_MS + 400);
      const tail: number[] = [];
      for (let i = 0; i < 6; i++) {
        tail.push(await colourHits(page, INV_CANVAS, PULSE_GREEN));
        await page.waitForTimeout(Math.ceil(PULSE_BLINK_MS / 2));
      }
      expect(Math.max(...tail)).toBe(0);
      expect(Date.now() - seenAt).toBeGreaterThan(PULSE_TOTAL_MS);

      // The claim itself really did happen -- this is the REAL path, not a
      // renderer poked in isolation.
      const canvas = (await (await page.request.get('/api/profile/default/canvas')).json()).canvas;
      expect(canvas.inv.pages.flatMap((p: { pos: { uid: string }[] }) => p.pos).some((p: { uid: string }) => p.uid === grantUid)).toBe(true);
    } finally {
      if (origCanvas) await page.request.put('/api/profile/default/canvas', { data: origCanvas });
      if (devProfileExisted && devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
      else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    }
  });
});
