// REQ-0328 -- e2e for the DIRECT warehouse->market sell (item 9's player
// UI). A claimable warehouse drop is listed STRAIGHT onto the market from
// the Warehouse screen's Sell action, WITHOUT first claiming it to the
// canvas -- the warehouse row is consumed and the result shows up under
// the Market page's My Listings.
// REQ-0366: the Sell action opens the price-carve MODAL (the market's
// own price UI + the REQ-0369 modal conventions) -- the old browser
// price prompt is gone, and this spec's source-scan test is the gate
// that keeps it gone. Mirrors
// warehouse-mjolnir.spec.ts's real-backend dev-grant strategy
// (dev_user.json -> item_admin, then POST /api/admin/warehouse/grant --
// the only grant path that works under both storage backends). Grant /
// return debris is swept by global setup/teardown's POST
// /api/warehouse/dev/clear-debris.
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { bootApp } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const DEV_USER_PATH = join(REPO_ROOT, 'data', 'config', 'dev_user.json');
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');

async function gotoWarehouseTab(page: Page): Promise<void> {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Warehouse' }).click();
  await expect(page.locator('[data-testid="schedule-warehouse-topstrip"]')).toBeVisible({ timeout: 10000 });
}

test.describe('REQ-0328: direct warehouse -> market sell (real backend, dev grant)', () => {
  // dev_user.json flip -> item_admin (grant hook), same convention as
  // warehouse-mjolnir.spec.ts / schedule.spec.ts's REQ-0041 describe.
  let devUserBackup: string | null = null;
  test.beforeEach(async () => {
    devUserBackup = existsSync(DEV_USER_PATH) ? readFileSync(DEV_USER_PATH, 'utf8') : null;
    writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));
  });
  test.afterEach(async () => {
    if (devUserBackup !== null) writeFileSync(DEV_USER_PATH, devUserBackup);
    else if (existsSync(DEV_USER_PATH)) rmSync(DEV_USER_PATH);
  });

  test('Sell lists a claimable drop directly onto the market and consumes the warehouse row', async ({ page }) => {
    const devProfileExisted = existsSync(DEV_PROFILE_PATH);
    const devProfileBackup = devProfileExisted ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    // pg-aware canvas restore, same rationale as warehouse-mjolnir.spec.ts:
    // the live API may run STORAGE_BACKEND=pg where a file restore is a
    // no-op. Selling never touches the canvas, but bootApp's first
    // auto-save can, so we restore the original canvas afterwards.
    const origCanvasResp = await page.request.get('/api/profile/default/canvas');
    const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null;
    // The REQ-0366 gate's own price (worker backends are isolated, so a
    // same-price collision with another run is impossible).
    const PRICE = 25;
    let listingId: string | null = null;
    try {
      // Grant a CLAIMABLE warehouse drop to the dev player (unclaimed --
      // never routed to a canvas cell).
      const grantRes = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
      expect(grantRes.status()).toBe(200);
      const grantUid = (await grantRes.json()).item.itemUid as string;

      await gotoWarehouseTab(page);
      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });

      // REQ-0366: the Sell action opens the price-carve modal (the
      // market's own price UI -- no browser dialog). The anchor line must
      // be present (this fresh grant has no settled history, so it reads
      // the codex empty-state); carve the price into the numeric input
      // and confirm. The modal closes only once the row is listed.
      await page.locator(`[data-testid="schedule-sell-btn-${grantUid}"]`).click();
      const modal = page.locator('[data-testid="warehouse-sell-modal"]');
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal.locator('[data-testid="market-carve-anchor"]')).toBeVisible();
      await modal.locator('[data-testid="market-price-input"]').fill(String(PRICE));
      await modal.locator('[data-testid="warehouse-sell-confirm"]').click();
      await expect(modal).toHaveCount(0, { timeout: 10000 });

      // Feedback toast, then the consumed row leaves the warehouse list.
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });
      await expect(row).toHaveCount(0, { timeout: 10000 });

      // Server truth: the warehouse row is consumed (gone), and an ACTIVE
      // listing now exists under the dev player's My Listings -- created
      // WITHOUT the item ever occupying a canvas cell.
      const whRes = await page.request.get('/api/warehouse');
      expect((await whRes.json()).items.some((i: { itemUid: string }) => i.itemUid === grantUid)).toBe(false);

      const mineRes = await page.request.get('/api/market/listings?filter=mine');
      const listings = (await mineRes.json()).listings as Array<{ id: string; itemId: string; state: string; kind: string; price: { tm: string; qty: number } }>;
      const listed = listings.find((l) => l.itemId === 'hilt' && l.state === 'active' && l.price && l.price.qty === PRICE);
      expect(listed).toBeTruthy();
      listingId = listed!.id;
      expect(listed!.kind).toBe('po');
      expect(listed!.price.tm).toBe('lrdst');
    } finally {
      // Leave the shared market clean: withdraw our listing (the item
      // returns to the warehouse; teardown's clear-debris sweeps it).
      if (listingId) await page.request.post(`/api/market/listings/${listingId}/withdraw`);
      if (origCanvas) await page.request.put('/api/profile/default/canvas', { data: origCanvas });
      if (devProfileExisted && devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
      else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    }
  });

  test('REQ-0366: Esc and the cancel action close the sell modal without listing', async ({ page }) => {
    // Grant debris is swept by teardown's clear-debris, same as above.
    const grantRes = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
    expect(grantRes.status()).toBe(200);
    const grantUid = (await grantRes.json()).item.itemUid as string;

    await gotoWarehouseTab(page);
    const sellBtn = page.locator(`[data-testid="schedule-sell-btn-${grantUid}"]`);
    await expect(sellBtn).toBeVisible({ timeout: 10000 });
    const modal = page.locator('[data-testid="warehouse-sell-modal"]');

    // Esc-to-close (the REQ-0369 conventions via useModalConventions).
    await sellBtn.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    // The explicit cancel action closes too.
    await sellBtn.click();
    await expect(modal).toBeVisible();
    await modal.locator('[data-testid="warehouse-sell-cancel"]').click();
    await expect(modal).toHaveCount(0);

    // Neither dismissal listed anything: the row is still claimable in
    // the warehouse and no active hilt listing exists for this player.
    const whRes = await page.request.get('/api/warehouse');
    expect((await whRes.json()).items.some((i: { itemUid: string }) => i.itemUid === grantUid)).toBe(true);
    const mineRes = await page.request.get('/api/market/listings?filter=mine');
    const listings = (await mineRes.json()).listings as Array<{ itemId: string; state: string }>;
    expect(listings.some((l) => l.itemId === 'hilt' && l.state === 'active')).toBe(false);
  });
});

// REQ-0366 gate: the raw-dialog price entry is GONE and cannot regress --
// client/src must contain no raw browser prompt call anywhere (the modal
// replaced the product's only raw browser dialog). A source-level
// tripwire in the same spirit as check_auth.mjs's VITE_SUPABASE scan;
// the scanned tree is E2E_CODE_ROOT, i.e. the code under test.
test('REQ-0366 gate: no raw browser prompt anywhere in client/src', () => {
  const NEEDLE = 'window.' + 'prompt'; // split so this spec never matches itself
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && readFileSync(p, 'utf8').includes(NEEDLE)) hits.push(p);
    }
  };
  walk(join(E2E_CODE_ROOT, 'client', 'src'));
  expect(hits).toEqual([]);
});
