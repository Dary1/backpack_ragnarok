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
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT, E2E_CLI_ENV } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'dev.json');
const CLI_INVITE_PATH = join(E2E_CODE_ROOT, 'server', 'cli_invite.cjs');

interface MintedPlayer { playerId: string; token: string; name: string; }

/** Mints a real invite player via the operator CLI (byte-for-byte the
 * helper guest-auth.spec.ts uses). Returns {playerId, token, name}. */
function mintInvite(name: string): MintedPlayer {
  // Positional name arg + process.execPath + cwd REPO_ROOT, byte-for-byte
  // guest-auth.spec.ts's createGuestPlayer (the CLI prints "playerId: X"
  // and an "#/invite/<token>" URL).
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: E2E_CODE_ROOT, env: E2E_CLI_ENV, encoding: 'utf8' });
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
// Accumulates each seller's seeded inv items ACROSS calls (keyed by
// playerId) so a test that lists >1 item for the SAME seller (BUY:
// browse renders listing cards seeds two) doesn't have its earlier
// item(s) wiped by a later call's canvas PUT. Bug found by that exact
// test on the real live suite (2026-07-07): the canvas PUT here used to
// carry ONLY the single new item, so seedSellerListing's second call
// for a seller overwrote the first item clean out of their inventory --
// the server's market browse view derives a listing's live state from
// the seller's CURRENT canvas (services/market.cjs's deriveView:
// !findInventoryPO(...) -> autoWithdrawItemGone), so the first listing
// silently self-withdrew as "item_gone" the moment the second PUT
// landed, well before the test ever asserted anything. Each fresh
// seller (mintInvite mints a new playerId every call) starts this
// tracker empty, so single-item callers are unaffected.
const sellerSeedInv = new Map<string, Array<{ uid: string; id: string }>>();

async function seedSellerListing(page: Page, seller: MintedPlayer, itemUid: string, itemId: string, qty: number): Promise<string> {
  const invPos = [...(sellerSeedInv.get(seller.playerId) ?? []), { uid: itemUid, id: itemId }];
  sellerSeedInv.set(seller.playerId, invPos);
  const canvas = devBuyerCanvas(0, invPos);
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

// REQ-0195a: the furnace wire is per-tm rows now ({totals:[{tm,total,count}]}).
// Sum every row for the single scalar the footer + these checks compare.
async function furnaceTotalOf(page: Page): Promise<number> {
  const body = await (await page.request.get('/api/market/furnace')).json();
  const totals = (body.furnace?.totals ?? []) as Array<{ total: number }>;
  return totals.reduce((s, r) => s + r.total, 0);
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
    // Seed the dev buyer with an item AND deploy it (assign a squad with
    // that item to an active room slot) so the server refuses to list it.
    const canvas = devBuyerCanvas(0, [{ uid: 'e2e_dep_1', id: 'tower_shield' }]);
    // Put a copy of the item into squad store index 1's board so the
    // deploy gate sees it as deployed when that squad is assigned.
    canvas.presets.store[1] = { linked: true, bps: [{ id: 'bp_dep', name: 'BP', color: '#888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], unit: { id: 'berserker', off: [0, 0] }, hpMax: 500 }], pos: [{ uid: 'e2e_dep_1', id: 'tower_shield', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] } as never;
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    // Create a room + assign squad 1 to a slot -> the item is deployed.
    const room = await page.request.post('/api/schedule/rooms', { data: { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' } });
    let roomId: string | null = null;
    if (room.ok()) {
      roomId = (await room.json()).room.id;
      await page.request.put(`/api/schedule/rooms/${roomId}/slots/0`, { data: { squadIndex: 1 } });
    }
    try {
      await gotoMarket(page);
      await page.locator('[data-testid="market-tab-sell"]').click();
      const item = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_dep_1"]');
      await expect(item).toBeVisible();
      // Attempt to select+list -> server 409 deployed -> the card locks
      // with the mock's deployed word rather than vanishing.
      await item.click();
      // If selectable-then-rejected: list it and observe the lock, else
      // the card may already be locked. Either way it must END
      // locked+visible.
      const listBtn = page.locator('[data-testid="market-list-btn"]');
      if (await listBtn.count()) { await listBtn.click().catch(() => {}); }
      await expect(item).toHaveAttribute('data-locked', 'true', { timeout: 10000 });
      await expect(item.locator('[data-testid="market-sell-lockword"]')).toBeVisible();
    } finally {
      // Fixed post-full-suite-run E2E (2026-07-07): this room's squad-1
      // deploy assignment used to outlive the test (no cleanup at all),
      // permanently poisoning every LATER test's "is squad 1 deployed"
      // check for the rest of that run (ragnarok.spec.ts's BLAST
      // MANIFEST / FULL RITE / HALL STRIP all failed downstream of this
      // exact leftover, only in a full-suite run -- never running
      // market.spec.ts alone, and never caught before that first
      // full-suite pass). Same cleanup ragnarok.spec.ts's own DEVOTION
      // PICKER test already uses.
      if (roomId) await page.request.delete(`/api/schedule/rooms/${roomId}`).catch(() => {});
    }
  });

  // REQ-0198 (C): a board-/preset-REFERENCED instance is "in use, not in my
  // inventory" -- the picker locks it (shown, not hidden) and createListing
  // 409s in_use. Content-agnostic: keys off data-item-uid / data-locked, not
  // any specific def name.
  test('SELL REQ-0198: board-/preset-referenced instances lock (in use); only the stowed one is sellable; createListing 409 in_use', async ({ page }) => {
    // Three same-def POs, all HOMED in inv page 0 (the reference model keeps
    // the home): one purely STOWED, one also REFERENCED by the active board
    // (top-level canvas.pos), one also REFERENCED by a squad PRESET snapshot
    // (presets.store[1]).
    const canvas = devBuyerCanvas(50, [
      { uid: 'e2e_ref_stow', id: 'tower_shield' },
      { uid: 'e2e_ref_board', id: 'tower_shield' },
      { uid: 'e2e_ref_preset', id: 'tower_shield' },
    ]);
    canvas.pos = [{ uid: 'e2e_ref_board', id: 'tower_shield', loc: 'grid', cell: [1, 1], rot: 0 }] as never;
    canvas.presets.store[1] = { linked: true, bps: [{ id: 'bp_ref', name: 'BP', color: '#888', shape: [[0, 0]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30 }], pos: [{ uid: 'e2e_ref_preset', id: 'tower_shield', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] } as never;
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-sell"]').click();
    await expect(page.locator('[data-testid="market-pane-sell"]')).toBeVisible();

    const stow = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_ref_stow"]');
    const board = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_ref_board"]');
    const preset = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_ref_preset"]');
    await expect(stow).toHaveAttribute('data-locked', 'false');
    await expect(board).toHaveAttribute('data-locked', 'true');
    await expect(preset).toHaveAttribute('data-locked', 'true');
    await expect(board.locator('[data-testid="market-sell-lockword"]')).toBeVisible();
    await expect(preset.locator('[data-testid="market-sell-lockword"]')).toBeVisible();
    // The stowed one selects into the carve panel; the referenced ones cannot.
    await stow.click();
    await expect(page.locator('[data-testid="market-carve-name"]')).toBeVisible();

    // Server truth behind the UI: a referenced uid 409s in_use (the dev buyer
    // is the caller, so createListing reads its own referenced canvas).
    for (const uid of ['e2e_ref_board', 'e2e_ref_preset']) {
      const res = await page.request.post('/api/market/listings', { data: { itemUid: uid, price: { tm: 'lrdst', qty: 10 } } });
      expect(res.status()).toBe(409);
      expect((await res.json()).reason).toBe('in_use');
    }
  });

  // REQ-0198 (A): the SELL picker renders a per-instance RollBar; the card
  // carries data-roll-pct = round(instance-q * 100).
  test('SELL REQ-0198: a picker card carries the instance roll % (data-roll-pct)', async ({ page }) => {
    const canvas = devBuyerCanvas(50, [{ uid: 'e2e_roll_1', id: 'tower_shield' }]);
    (canvas.inv.pages[0].pos[0] as { q?: number }).q = 0.42; // REQ-0063 instance quality roll
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-sell"]').click();
    const bar = page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_roll_1"] [data-testid="market-rollbar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-roll-pct', '42'); // round(0.42 * 100)
  });

  // REQ-0198 (B): the '#/market?sell=<uid>&kind=' deep link (FloatingItemTip's
  // "sell this" target) opens the SELL pane with the instance preselected.
  test('SELL REQ-0198: the #/market?sell= deep link opens the SELL pane preselected', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(50, [{ uid: 'e2e_dl_1', id: 'tower_shield' }]) });
    await bootApp(page);
    await page.evaluate(() => { window.location.hash = '#/market?sell=e2e_dl_1&kind=po'; });
    await expect(page.locator('[data-testid="market-page"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="market-loading"]')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('[data-testid="market-pane-sell"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-sell-item"][data-item-uid="e2e_dl_1"]')).toHaveClass(/is-selected/);
    await expect(page.locator('[data-testid="market-carve-name"]')).toBeVisible();
  });

  test('MINE: withdraw pulls a listing off the hearth (free, no burn), and the row leaves the browse', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(0, [{ uid: 'e2e_wd_1', id: 'dagger' }]) });
    const listRes = await page.request.post('/api/market/listings', { data: { itemUid: 'e2e_wd_1', price: { tm: 'lrdst', qty: 8 } } });
    const listingId = (await listRes.json()).listing.id;

    const furnaceBefore = await furnaceTotalOf(page);

    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-mine"]').click();
    const row = page.locator(`[data-testid="market-mine-row"][data-listing-id="${listingId}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await page.locator(`[data-testid="market-withdraw-btn-${listingId}"]`).click();
    // The row's state flips to withdrawn (or leaves the active set) after
    // the refetch.
    await expect(page.locator(`[data-testid="market-mine-row"][data-listing-id="${listingId}"][data-state="withdrawn"]`)).toBeVisible({ timeout: 10000 });

    // Withdrawal is free: the furnace total is unchanged.
    const furnaceAfter = await furnaceTotalOf(page);
    expect(furnaceAfter).toBe(furnaceBefore);

    // And it no longer appears in browse.
    const browse = await page.request.get('/api/market/listings');
    expect(((await browse.json()).listings as Array<{ id: string }>).some((l) => l.id === listingId)).toBeFalsy();
  });

  test('WIRE: dtoVersion 2 envelope carries tms[] (live TM registry) + PO listings carry kind:po (REQ-0195a)', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(0, [{ uid: 'e2e_kind_1', id: 'dagger' }]) });
    const listRes = await page.request.post('/api/market/listings', { data: { itemUid: 'e2e_kind_1', price: { tm: 'lrdst', qty: 9 } } });
    expect(listRes.status()).toBe(200);
    const created = await listRes.json();
    expect(created.dtoVersion).toBe(2);
    expect(created.listing.kind).toBe('po');
    const browse = await (await page.request.get('/api/market/listings')).json();
    expect(browse.dtoVersion).toBe(2);
    expect(browse.tms).toEqual(['lrdst']);
    expect(browse.tm).toBeUndefined();
  });

  test('BROWSE: an SI listing is visible in the browse with kind:si (REQ-0195c)', async ({ page }) => {
    // Discover a live SI id from the content payload (content-agnostic).
    const content = await (await page.request.get('/api/content')).json();
    const siId = Object.keys((content.sis ?? {}) as Record<string, unknown>)[0];
    test.skip(!siId, 'no SI content available in this environment');
    // Seed the dev player with one loose inventory SI, then list it.
    const canvas = devBuyerCanvas(0, []);
    canvas.inv.pages[0].sis = [{ uid: 'e2e_si_1', id: siId, host: 'inv', q: 0.5 }] as never;
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    const listRes = await page.request.post('/api/market/listings', { data: { kind: 'si', itemUid: 'e2e_si_1', price: { tm: 'lrdst', qty: 7 } } });
    expect(listRes.status()).toBe(200);
    expect((await listRes.json()).listing.kind).toBe('si');
    const browse = await (await page.request.get('/api/market/listings')).json();
    expect((browse.listings as Array<{ itemUid: string; kind: string }>).some((l) => l.itemUid === 'e2e_si_1' && l.kind === 'si')).toBeTruthy();
  });

  test('BUY: content-bound KIND chips appear for live kinds and filter by listing kind (REQ-0195a, review fix F1)', async ({ page }) => {
    // Content-agnostic: discover a live PO + SI id from the content payload.
    const content = await (await page.request.get('/api/content')).json();
    const poId = Object.keys((content.items ?? {}) as Record<string, unknown>)[0] as string;
    const siId = Object.keys((content.sis ?? {}) as Record<string, unknown>)[0] as string;
    test.skip(!poId || !siId, 'need at least one PO and one SI in content for the kind-chip test');
    // The dev buyer seeds one inventory PO + one loose SI and lists both,
    // so its afterEach canvas-restore auto-withdraws them (no cross-test
    // residue). Both listings are the dev buyer's own; the cards still
    // render -- chips do not depend on buyability. Assertions scope to
    // THESE uids only, so leftover listings from earlier tests can't skew
    // them.
    const canvas = devBuyerCanvas(0, [{ uid: 'e2e_chip_po', id: poId }]);
    canvas.inv.pages[0].sis = [{ uid: 'e2e_chip_si', id: siId, host: 'inv', q: 0.5 }] as never;
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    const poRes = await page.request.post('/api/market/listings', { data: { itemUid: 'e2e_chip_po', price: { tm: 'lrdst', qty: 8 } } });
    expect(poRes.status()).toBe(200);
    const siRes = await page.request.post('/api/market/listings', { data: { kind: 'si', itemUid: 'e2e_chip_si', price: { tm: 'lrdst', qty: 7 } } });
    expect(siRes.status()).toBe(200);

    await gotoMarket(page);
    // Both KIND chips are shown (content-bound: a live listing of each kind).
    await expect(page.locator('[data-testid="market-chip-po"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-chip-si"]')).toBeVisible();
    const poCard = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_chip_po"]');
    const siCard = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_chip_si"]');
    await expect(poCard).toBeVisible();
    await expect(siCard).toBeVisible();
    // The si chip narrows to si-kind cards -> my po card drops, my si stays.
    await page.locator('[data-testid="market-chip-si"]').click();
    await expect(poCard).toHaveCount(0);
    await expect(siCard).toBeVisible();
    // The po chip narrows to po-kind cards -> my si card drops, my po stays.
    await page.locator('[data-testid="market-chip-po"]').click();
    await expect(siCard).toHaveCount(0);
    await expect(poCard).toBeVisible();
  });

  test('BROWSE+BUY: a unit (BP) listing is visible with kind:unit and buying delivers a kind:bp warehouse row carrying the verbatim payload (REQ-0195d)', async ({ page }) => {
    // Discover a live unit id from the content payload (content-agnostic).
    const content = await (await page.request.get('/api/content')).json();
    const unitId = Object.keys((content.units ?? {}) as Record<string, unknown>)[0];
    test.skip(!unitId, 'no unit content available in this environment');
    // A seller lists an EMPTY inventory BP (nothing homed within its footprint).
    const seller = mintInvite('unit-seller');
    const canvas = devBuyerCanvas(0, []);
    canvas.inv.pages[0].bps = [{ id: 'e2e_unit_1', name: 'BP', color: '#888', shape: [[0, 0], [0, 1]], origin: [3, 3], unit: { id: unitId, off: [0, 0] }, hpMax: 42, cellCount: 2, bonuses: [] }] as never;
    const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, { headers: { 'X-Auth-Token': seller.token }, data: canvas });
    expect(put.ok()).toBeTruthy();
    const listRes = await page.request.post('/api/market/listings', { headers: { 'X-Auth-Token': seller.token }, data: { kind: 'unit', itemUid: 'e2e_unit_1', price: { tm: 'lrdst', qty: 11 } } });
    expect(listRes.status()).toBe(200);
    const created = await listRes.json();
    expect(created.listing.kind).toBe('unit');
    expect(created.listing.itemId).toBe(unitId);
    // Visible in the browse with kind:unit.
    const browse = await (await page.request.get('/api/market/listings')).json();
    expect((browse.listings as Array<{ itemUid: string; kind: string }>).some((l) => l.itemUid === 'e2e_unit_1' && l.kind === 'unit')).toBeTruthy();
    // The dev buyer (funded) buys it -> a kind:bp warehouse row with the verbatim BP payload.
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(50, []) });
    const buyRes = await page.request.post(`/api/market/listings/${created.listing.id}/buy`);
    expect(buyRes.status()).toBe(200);
    const wh = await (await page.request.get('/api/warehouse')).json();
    const row = (wh.items as Array<{ kind?: string; bp?: { unit?: { id?: string }; hpMax?: number }; sourceListingId?: string }>).find((it) => it.sourceListingId === created.listing.id);
    expect(row?.kind).toBe('bp');
    expect(row?.bp?.unit?.id).toBe(unitId);
    expect(row?.bp?.hpMax).toBe(42);
  });

  test('SELL: the tm (currency) tab reflects the single-live-TM reality -- lrdst held, no other currency to price in; same_tm is 400 (REQ-0195b)', async ({ page }) => {
    // API: pricing a TM in itself -> 400 {reason:'same_tm'} (user ruling).
    const sameTm = await page.request.post('/api/market/listings', { data: { kind: 'tm', itemId: 'lrdst', tmQty: 5, price: { tm: 'lrdst', qty: 5 } } });
    expect(sameTm.status()).toBe(400);
    expect((await sameTm.json()).reason).toBe('same_tm');
    // UI: the dev player holds lrdst; the currency sell tab lets them pick it
    // but shows the dormant 'no other currency to price in' state, because
    // lrdst is the only live TM (a 2nd live TM would enable a real listing).
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(20, []) });
    await gotoMarket(page);
    await page.locator('[data-testid="market-tab-sell"]').click();
    await page.locator('[data-testid="market-sell-kind-tm"]').click();
    await expect(page.locator('[data-testid="market-pane-sell-tm"]')).toBeVisible();
    const lrdstItem = page.locator('[data-testid="market-sell-tm-item"][data-tm-id="lrdst"]');
    await expect(lrdstItem).toBeVisible();
    await lrdstItem.click();
    await expect(page.locator('[data-testid="market-sell-tm-noprice"]')).toBeVisible();
  });

  test('ROLL BAR: a po card shows a % bar equal to the seeded instance q, and a unit card with no roll container shows the unmeasured badge (REQ-0195e)', async ({ page }) => {
    const content = await (await page.request.get('/api/content')).json();
    const unitId = Object.keys((content.units ?? {}) as Record<string, unknown>)[0];
    const seller = mintInvite('roll-seller');
    // A seller canvas: one PO carrying q=0.5, plus (if units exist) one
    // EMPTY BP with NO roll container (the REQ-0196 field absent).
    const canvas = devBuyerCanvas(0, []);
    canvas.inv.pages[0].pos = [{ uid: 'e2e_roll_po', id: 'dagger', loc: 'grid', cell: [1, 1], rot: 0, q: 0.5 }] as never;
    if (unitId) canvas.inv.pages[0].bps = [{ id: 'e2e_roll_bp', name: 'BP', color: '#888', shape: [[0, 0]], origin: [4, 4], unit: { id: unitId, off: [0, 0] }, hpMax: 30, cellCount: 1 }] as never;
    const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, { headers: { 'X-Auth-Token': seller.token }, data: canvas });
    expect(put.ok()).toBeTruthy();
    // po rollPct is the instance q; unit rollPct is null (unmeasured).
    const poList = await page.request.post('/api/market/listings', { headers: { 'X-Auth-Token': seller.token }, data: { kind: 'po', itemUid: 'e2e_roll_po', price: { tm: 'lrdst', qty: 6 } } });
    expect(poList.status()).toBe(200);
    expect((await poList.json()).listing.rollPct).toBe(0.5);
    if (unitId) {
      const uList = await page.request.post('/api/market/listings', { headers: { 'X-Auth-Token': seller.token }, data: { kind: 'unit', itemUid: 'e2e_roll_bp', price: { tm: 'lrdst', qty: 6 } } });
      expect(uList.status()).toBe(200);
      expect((await uList.json()).listing.rollPct).toBeNull();
    }
    // In the BUY grid the po card carries a 50% roll bar; the unit card
    // shows the unmeasured badge instead (never a 0% bar).
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(20, []) });
    await gotoMarket(page);
    const poCard = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_roll_po"]');
    await expect(poCard).toBeVisible();
    const bar = poCard.locator('[data-testid="market-rollbar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-roll-pct', '50');
    await expect(bar).toContainText('50%');
    if (unitId) {
      const unitCard = page.locator('[data-testid="market-listing-row"][data-item-uid="e2e_roll_bp"]');
      await expect(unitCard).toBeVisible();
      await expect(unitCard.locator('[data-testid="market-roll-unmeasured"]')).toBeVisible();
      await expect(unitCard.locator('[data-testid="market-rollbar"]')).toHaveCount(0);
    }
  });


  test('FOOTER: the seasonal furnace total renders with the lore copy', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devBuyerCanvas(10, []) });
    await gotoMarket(page);
    const furnace = page.locator('[data-testid="market-furnace"]');
    await expect(furnace).toBeVisible();
    // Matches the API's own total (formatted with thousands separators).
    const total = await furnaceTotalOf(page);
    await expect(furnace).toContainText(total.toLocaleString());
    await expect(page.locator('.market-foot .lore')).toBeVisible();
  });
});
