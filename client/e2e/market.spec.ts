// REQ-0064 -- Market screen (交易の火床 / Hearth of Barter), #/market.
// End-to-end coverage of the REAL, already-merged market backend
// (server/routes/market.cjs) through the NEW client pane. Data strategy
// mirrors the sibling specs exactly:
//
//  - A second, real player (the SELLER) is minted over SSH via the same
//    operator CLI guest-auth.spec.ts drives (server/cli_invite.cjs), and
//    that seller's token seeds real listings straight through the market
//    HTTP API (page.request + X-Auth-Token) -- the same "drive the real
//    backend over the same typed surface" posture warehouse-mjolnir.spec
//    uses for its grant hook. The BUYER is the dev_mode fallback player
//    (the browser's own identity with no token stored), whose canvas we
//    seed with a TM balance + inventory POs via the profile PUT.
//  - Self-buy / sell / mine / withdraw all act as the dev buyer against
//    listings the dev buyer itself created, so no cross-identity dance is
//    needed for those.
//
// The CRITICAL post-buy assertion (balance debits server-side AND the
// item lands in the buyer's warehouse) is checked via the API the same
// way schedule.spec.ts checks settlement -- reading /api/profile/dev/
// canvas + /api/warehouse back after the UI buy, proving the client's
// loadGame() race-guard left the server's debit intact (no stale auto-
// save resurrected the spent balance).
//
// STATUS: authored + selector-traced against the implementation, but NOT
// yet executed against a live deploy (the shared baseURL points at the
// live site, which the main checkout owns; the orchestrator runs this
// for real right after deploy). See docs/REQ-0064-market-client.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

const REPO_ROOT = join(homedir(), 'backpack_ragnarok');
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'dev.json');
const CLI_INVITE_PATH = join(REPO_ROOT, 'server', 'cli_invite.cjs');

interface MintedPlayer { playerId: string; token: string; name: string; }

/** Mints a real invite player via the operator CLI (byte-for-byte the
 * helper guest-auth.spec.ts uses). Returns {playerId, token, name}. */
function mintInvite(name: string): MintedPlayer {
  // Positional name arg + process.execPath + cwd REPO_ROOT, byte-for-byte
  // guest-auth.spec.ts's createGuestPlayer (the CLI prints "playerId: X"
  // and an "#/invite/<token>" URL).
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: REPO_ROOT, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  return { playerId: playerIdMatch[1], token: tokenMatch[1], name };
}

/** A dev-buyer canvas with a market-TM (lrdst) balance + a set of
 * inventory POs (for the SELL pane) on inventory page 0. Board is empty
 * (nothing deployed) so every inventory PO is sell-eligible. */
function devBuyerCanvas(lrdst: number, invPos: Array<{ uid: string; id: string }>) {
  return {
    linked: true,
    bps: [],
    pos: [],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    inv: {
      names: ['1', '2', '3', '4', '5'],
      pages: [
        {
          bps: [],
          pos: invPos.map((p, i) => ({ uid: p.uid, id: p.id, loc: 'grid', cell: [1, 1 + i], rot: 0 })),
          sis: [],
          tms: lrdst > 0 ? [{ id: 'lrdst', qty: lrdst, cell: [8, 1] }] : [],
        },
        { bps: [], pos: [], sis: [] },
        { bps: [], pos: [], sis: [] },
        { bps: [], pos: [], sis: [] },
        { bps: [], pos: [], sis: [] },
      ],
    },
    presets: { active: 0, names: ['Slot1', 'Slot2', 'Slot3', 'Slot4', 'Slot5', 'Slot6', 'Slot7', 'Slot8', 'Slot9', 'Slot10'], store: [null, null, null, null, null, null, null, null, null, null] },
  };
}

/** Seeds a seller with an inventory PO then lists it, returning the
 * created listing id. All via the real market/profile API using the
 * seller's own token. */
async function seedSellerListing(page: Page, seller: MintedPlayer, itemUid: string, itemId: string, qty: number): Promise<string> {
  const canvas = devBuyerCanvas(0, [{ uid: itemUid, id: itemId }]);
  const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, {
    headers: { 'X-Auth-Token': seller.token },
    data: canvas,
  });
  expect(put.ok()).toBeTruthy();
  const res = await page.request.post('/api/market/listings', {
    headers: { 'X-Auth-Token': seller.token },
    data: { itemUid, price: { tm: 'lrdst', qty } },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).listing.id;
}

async function gotoMarket(page: Page): Promise<void> {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Market' }).click();
  await expect(page.locator('[data-testid="market-page"]')).toBeVisible({ timeout: 10000 });
  // wait out the initial fetch (browse/mine/furnace)
  await expect(page.locator('[data-testid="market-loading"]')).toHaveCount(0, { timeout: 10000 });
}

async function readDevLrdst(page: Page): Promise<number> {
  const resp = await page.request.get('/api/profile/dev/canvas');
  const canvas = (await resp.json()).canvas;
  let total = 0;
  for (const pg of canvas.inv?.pages ?? []) for (const tm of pg.tms ?? []) if (tm.id === 'lrdst') total += tm.qty;
  return total;
}

test.describe('REQ-0064: Market screen on the real backend', () => {
  // Back up + restore the dev profile around each test (pg-aware, same
  // convention as warehouse-mjolnir.spec.ts: a dev.json file restore is a
  // silent no-op under STORAGE_BACKEND=pg, so re-PUT the original canvas
  // through the API too).
  let devProfileBackup: string | null = null;
  let origCanvas: unknown = null;

  test.beforeEach(async ({ page }) => {
    devProfileBackup = existsSync(DEV_PROFILE_PATH) ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    const resp = await page.request.get('/api/profile/dev/canvas');
    origCanvas = resp.ok() ? (await resp.json()).canvas : null;
  });

  test.afterEach(async ({ page }) => {
    if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: origCanvas });
    if (devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
    else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    // sweep any market debris the dev buyer accrued (warehouse deliveries)
    await page.request.post('/api/warehouse/dev/clear-debris').catch(() => {});
  });

  test('BUY: browse renders listing cards; a No.-query deep-links by Dex No.; a name substring filters', async ({ page }) => {
    const seller = mintInvite('MarketSellerBrowse');
    // Two distinct items so filter/search have something to discriminate.
    await seedSellerListing(page, seller, 'e2e_browse_1', 'tower_shield', 46);
    await seedSellerListing(page, seller, 'e2e_browse_2', 'dagger', 12);

    // dev buyer boots with a fat balance (so nothing is short-gated here).
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(500, []) });
    await gotoMarket(page);

    // Cards present, price + burn breakdown line rendered.
    const grid = page.locator('[data-testid="market-grid"]');
    await expect(grid).toBeVisible();
    await expect(page.locator('[data-testid="market-listing-row"]')).toHaveCount(2);
    const cleaver = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_browse_1"]');
    await expect(cleaver).toContainText('×46');
    await expect(cleaver.locator('.burn')).toContainText('4'); // burn of 46 = 4

    // Search by a bare Dex No. -> only the matching card remains. Read the
    // rendered Dex-No chip off the cleaver card so the assertion is not
    // hardcoded to a content-order that can drift.
    const dexText = (await cleaver.locator('[data-testid="market-dexno"]').textContent())?.trim() ?? '';
    const dexDigits = dexText.replace(/[^\d]/g, '').replace(/^0+/, '');
    await page.locator('[data-testid="market-search"]').fill(dexDigits);
    await expect(page.locator('[data-testid="market-listing-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_browse_1"]')).toBeVisible();

    // Name substring (EN) -> filters to the Dagger card.
    await page.locator('[data-testid="market-search"]').fill('dagger');
    await expect(page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_browse_2"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_browse_1"]')).toHaveCount(0);
  });

  test('BUY happy path: the oath modal settles, the balance debits server-side, and the item lands in the buyer warehouse', async ({ page }) => {
    const seller = mintInvite('MarketSellerBuy');
    await seedSellerListing(page, seller, 'e2e_buy_1', 'tower_shield', 46);
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(100, []) });
    await gotoMarket(page);

    const before = await readDevLrdst(page);
    expect(before).toBe(100);

    await page.locator('[data-testid="market-buy-btn-e2e_buy_1"]').click();
    const modal = page.locator('[data-testid="market-buy-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-testid="market-buy-body-form"]')).toBeVisible();
    // breakdown: pay 46 / burn 4 / seller receives 42
    await expect(modal).toContainText('46');
    await expect(modal).toContainText('42');
    await page.locator('[data-testid="market-buy-confirm"]').click();
    await expect(page.locator('[data-testid="market-buy-body-done"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="market-buy-done-close"]').click();

    // CRITICAL: the client re-GET (loadGame) must leave the server debit
    // intact -- wait out the auto-save debounce, then read the profile.
    await waitForAutoSave(page);
    const after = await readDevLrdst(page);
    expect(after).toBe(before - 46); // 54: buyer debited, NOT resurrected

    // The item is a claimable row in the dev buyer's warehouse.
    const wh = await page.request.get('/api/warehouse');
    const items = (await wh.json()).items as Array<{ itemId: string; sourceListingId?: string }>;
    expect(items.some((it) => it.itemId === 'tower_shield' && it.sourceListingId)).toBeTruthy();
  });

  test('BUY 409 self_buy: a card the buyer listed themselves is not buyable (button disabled), and a forced buy 409s', async ({ page }) => {
    // dev buyer both owns the item AND lists it -> self purchase blocked.
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(200, [{ uid: 'e2e_self_1', id: 'dagger' }]) });
    const listRes = await page.request.post('/api/market/listings', { data: { itemUid: 'e2e_self_1', price: { tm: 'lrdst', qty: 12 } } });
    expect(listRes.status()).toBe(200);
    const listingId = (await listRes.json()).listing.id;

    await gotoMarket(page);
    // The card shows "you" and the buy button is disabled.
    const row = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_self_1"]');
    await expect(row).toBeVisible();
    await expect(page.locator('[data-testid="market-buy-btn-e2e_self_1"]')).toBeDisabled();

    // And the API itself refuses a self buy (server truth behind the UI).
    const buy = await page.request.post(`/api/market/listings/${listingId}/buy`);
    expect(buy.status()).toBe(409);
    expect((await buy.json()).reason).toBe('self_buy');
  });

  test('BUY 409 insufficient_balance: an unaffordable card is short-gated in the grid, and the modal poor-body shows if forced', async ({ page }) => {
    const seller = mintInvite('MarketSellerPoor');
    await seedSellerListing(page, seller, 'e2e_poor_1', 'beast_jaw', 120);
    // dev buyer has only 10 lrdst -> cannot afford the 120 listing.
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(10, []) });
    await gotoMarket(page);

    const row = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_poor_1"]');
    await expect(row).toBeVisible();
    await expect(page.locator('[data-testid="market-buy-btn-e2e_poor_1"]')).toBeDisabled();
    await expect(row).toContainText('110'); // burn breakdown still shown (transparency before the oath)

    // The server enforces it too (the UI gate is a courtesy, not the law).
    const listingId = (await row.getAttribute('data-listing-id')) ?? '';
    const buy = await page.request.post(`/api/market/listings/${listingId}/buy`);
    expect(buy.status()).toBe(409);
    expect((await buy.json()).reason).toBe('insufficient_balance');
  });

  test('SELL: an eligible inventory PO can be listed (live receipt estimate + stepper), and it then appears under Mine', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(50, [{ uid: 'e2e_sell_1', id: 'tower_shield' }]) });
    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-sell"]').click();
    await expect(page.locator('[data-testid="market-pane-sell"]')).toBeVisible();

    // Pick the item.
    const item = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_sell_1"]');
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('[data-testid="market-carve-name"]')).toBeVisible();

    // Stepper: set price to 46 -> live estimate burn 4, receive 42.
    await page.locator('[data-testid="market-price-input"]').fill('46');
    await page.locator('[data-testid="market-price-input"]').blur();
    await expect(page.locator('[data-testid="market-est-pay"]')).toHaveText('46');
    await expect(page.locator('[data-testid="market-est-burn"]')).toHaveText('4');
    await expect(page.locator('[data-testid="market-est-get"]')).toHaveText('42');

    await page.locator('[data-testid="market-list-btn"]').click();
    await expect(page.locator('[data-testid="market-sell-toast"]')).toBeVisible({ timeout: 10000 });

    // Mine pane now shows it (active), and the API agrees.
    await page.locator('[data-testid="market-tab-mine"]').click();
    const mineRow = page.locator('[data-testid="market-mine-row"][data-state="active"]');
    await expect(mineRow.first()).toBeVisible({ timeout: 10000 });
    await expect(mineRow.first()).toContainText('×46');
    const mine = await page.request.get('/api/market/listings?filter=mine');
    expect(((await mine.json()).listings as Array<{ itemUid: string }>).some((l) => l.itemUid === 'e2e_sell_1')).toBeTruthy();
  });

  test('SELL: a deployed item is shown LOCKED (not hidden) once the server rejects listing it', async ({ page }) => {
    // Seed the dev buyer with an item AND deploy it (assign a preset with
    // that item to an active room slot) so the server refuses to list it.
    const canvas = devBuyerCanvas(0, [{ uid: 'e2e_dep_1', id: 'tower_shield' }]);
    // Put a copy of the item into preset store index 1's board so the
    // deploy gate sees it as deployed when that preset is assigned.
    canvas.presets.store[1] = { linked: true, bps: [{ id: 'bp_dep', name: 'BP', color: '#888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], linker: { off: [0, 0], dirs: [] }, hpMax: 500 }], pos: [{ uid: 'e2e_dep_1', id: 'tower_shield', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] } as never;
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    // Create a room + assign preset 1 to a slot -> the item is deployed.
    const room = await page.request.post('/api/schedule/rooms', { data: { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' } });
    if (room.ok()) {
      const roomId = (await room.json()).room.id;
      await page.request.put(`/api/schedule/rooms/${roomId}/slots/0`, { data: { presetIndex: 1 } });
    }

    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-sell"]').click();
    const item = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_dep_1"]');
    await expect(item).toBeVisible();
    // Attempt to select+list -> server 409 deployed -> the card locks with
    // the mock's deployed word rather than vanishing.
    await item.click();
    // If selectable-then-rejected: list it and observe the lock, else the
    // card may already be locked. Either way it must END locked+visible.
    const listBtn = page.locator('[data-testid="market-list-btn"]');
    if (await listBtn.count()) { await listBtn.click().catch(() => {}); }
    await expect(item).toHaveAttribute('data-locked', 'true', { timeout: 10000 });
    await expect(item.locator('[data-testid="market-sell-lockword"]')).toBeVisible();
  });

  test('MINE: withdraw pulls a listing off the hearth (free, no burn), and the row leaves the browse', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(0, [{ uid: 'e2e_wd_1', id: 'dagger' }]) });
    const listRes = await page.request.post('/api/market/listings', { data: { itemUid: 'e2e_wd_1', price: { tm: 'lrdst', qty: 8 } } });
    const listingId = (await listRes.json()).listing.id;

    const furnaceBefore = (await (await page.request.get('/api/market/furnace')).json()).furnace.total as number;

    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-mine"]').click();
    const row = page.locator(`[data-testid="market-mine-row"][data-listing-id="${listingId}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await page.locator(`[data-testid="market-withdraw-btn-${listingId}"]`).click();
    // The row's state flips to withdrawn (or leaves the active set) after
    // the refetch.
    await expect(page.locator(`[data-testid="market-mine-row"][data-listing-id="${listingId}"][data-state="withdrawn"]`)).toBeVisible({ timeout: 10000 });

    // Withdrawal is free: the furnace total is unchanged.
    const furnaceAfter = (await (await page.request.get('/api/market/furnace')).json()).furnace.total as number;
    expect(furnaceAfter).toBe(furnaceBefore);

    // And it no longer appears in browse.
    const browse = await page.request.get('/api/market/listings');
    expect(((await browse.json()).listings as Array<{ id: string }>).some((l) => l.id === listingId)).toBeFalsy();
  });

  test('FOOTER: the seasonal furnace total renders with the lore copy', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(10, []) });
    await gotoMarket(page);
    const furnace = page.locator('[data-testid="market-furnace"]');
    await expect(furnace).toBeVisible();
    // Matches the API's own total (formatted with thousands separators).
    const total = (await (await page.request.get('/api/market/furnace')).json()).furnace.total as number;
    await expect(furnace).toContainText(total.toLocaleString());
    await expect(page.locator('.market-foot .lore')).toBeVisible();
  });
});
