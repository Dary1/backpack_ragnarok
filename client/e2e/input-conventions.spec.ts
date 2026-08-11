// REQ-0369 -- Input conventions: keyboard shortcuts + unified modal behavior.
//
// Gates (docs/REQ/.../REQ-0369-input-conventions.md):
//  - Esc closes the market BuyModal (lib/useModalConventions adoption; the
//    other adopters' Esc surfaces are covered by their own suites plus the
//    hook's single implementation).
//  - R rotates the piece under float AND under drag. REQ-0289 has not
//    landed, so R maps to the CURRENT dblclick-rotate call path
//    (BoardRenderer's rotate core via drag.ts's rotatePieceOnBoard) -- the
//    fixture and the rot 0->1 assertion are byte-for-byte the ones
//    bp-rotate.spec.ts pins for the dblclick trigger, which is the point:
//    same core, new trigger.
//  - 1..5 switch the active squad on the backpacks route, and do NOT fire
//    while typing in the seal-token input.
//  - ? opens the shortcut-reference overlay in BOTH locales; Esc closes it.
//
// Selector contract (REQ-0369 item 3): additive only -- this spec uses
// pre-existing selectors plus the NEW shortcut-help-* testids.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_CODE_ROOT, E2E_CLI_ENV } from './e2e-env';
import { autoSaveAndFetch, bootApp, cx, cy, loadFixtureAndBoot } from './helpers';

const CLI_INVITE_PATH = join(E2E_CODE_ROOT, 'server', 'cli_invite.cjs');

interface MintedPlayer { playerId: string; token: string; name: string; }

/** Mints a real invite player via the operator CLI -- byte-for-byte
 * market.spec.ts's helper (which is itself guest-auth.spec.ts's). */
function mintInvite(name: string): MintedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: E2E_CODE_ROOT, env: E2E_CLI_ENV, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  return { playerId: playerIdMatch[1], token: tokenMatch[1], name };
}

/** One seller with ONE inventory PO, listed on the market -- the minimal
 * slice of market.spec.ts's seeding (single listing per seller here, so
 * no cross-call inventory accumulator is needed). */
async function seedSellerListing(page: Page, seller: MintedPlayer, itemUid: string, itemId: string, qty: number): Promise<void> {
  const canvas = {
    linked: true, bps: [], pos: [], sis: [],
    layout: { ROWS: 8, COLS: 8 },
    inv: {
      names: ['1', '2', '3', '4', '5'],
      pages: [
        { bps: [], pos: [{ uid: itemUid, id: itemId, loc: 'grid', cell: [1, 1], rot: 0 }], sis: [], tms: [] },
        { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] },
      ],
    },
    presets: { active: 0, names: ['S1'], store: [null] },
  };
  const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, { headers: { 'X-Auth-Token': seller.token }, data: canvas });
  expect(put.ok()).toBeTruthy();
  const res = await page.request.post('/api/market/listings', { headers: { 'X-Auth-Token': seller.token }, data: { itemUid, price: { tm: 'lrdst', qty } } });
  expect(res.status()).toBe(200);
}

async function gotoMarket(page: Page): Promise<void> {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Market' }).click();
  await expect(page.locator('[data-testid="market-page"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="market-loading"]')).toHaveCount(0, { timeout: 10000 });
}

/** Byte-for-byte the fixture bp-rotate.spec.ts's "a PO sitting on a BP
 * keeps its OWN dblclick-rotate behavior" test uses: a simple 3-cell BP +
 * a 1-cell PO (hilt) at (3,4). The same rotate core is what R must reach,
 * so the same fixture pins the same math (hilt rot 0 -> 1). */
function rotateFixture() {
  return {
    linked: true,
    bps: [{ id: 'simple_bp', name: 'Simple', color: '#4a90d9', shape: [[0, 0], [0, 1], [0, 2]], origin: [3, 3], unit: { id: 'berserker', off: [0, 0] } }],
    pos: [{ uid: 'po_on_bp', id: 'hilt', loc: 'grid', cell: [3, 4], rot: 0 }],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

async function tap(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('REQ-0369: input conventions', () => {
  test('Esc closes the market BuyModal (useModalConventions adoption)', async ({ page }) => {
    const seller = mintInvite('E2E 0369 Seller');
    await seedSellerListing(page, seller, 'e2e_0369_esc', 'tower_shield', 5);
    // The dev buyer needs a spendable lrdst balance: BuyPane renders the
    // Purchase button DISABLED (not merely short-noted) when the buyer
    // can't afford the price, and the fleet's seeded e2e_ci profile
    // carries none. Same posture as market.spec.ts's devBuyerCanvas.
    await page.request.put('/api/profile/default/canvas', {
      data: {
        linked: true, bps: [], pos: [], sis: [],
        layout: { ROWS: 8, COLS: 8 },
        inv: {
          names: ['1', '2', '3', '4', '5'],
          pages: [
            { bps: [], pos: [], sis: [], tms: [{ id: 'lrdst', qty: 100, cell: [8, 1] }] },
            { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] },
          ],
        },
        presets: { active: 0, names: ['S1'], store: [null] },
      },
    });
    await gotoMarket(page);
    await page.locator('[data-testid="market-buy-btn-e2e_0369_esc"]').click();
    const modal = page.locator('[data-testid="market-buy-modal"]');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });

  test('R rotates the FLOATED piece via the dblclick-rotate call path (tap -> tip -> R)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: rotateFixture() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await tap(page, box.x + cx(4), box.y + cy(3)); // po_on_bp @ (3,4) -> tip floats (REQ-0119)
    await expect(page.locator('.item-tip')).toBeVisible();
    await page.keyboard.press('r');
    await page.waitForTimeout(200);

    const canvas = await autoSaveAndFetch(page);
    const po = canvas.pos.find((p: any) => p.uid === 'po_on_bp');
    expect(po.rot).toBe(1); // same assertion bp-rotate.spec.ts pins for dblclick
    const bp = canvas.bps.find((b: any) => b.id === 'simple_bp');
    expect(bp.shape).toEqual([[0, 0], [0, 1], [0, 2]]); // BP untouched
  });

  test('R rotates the DRAGGED piece mid-carry, and the drop still commits', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: rotateFixture() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Arm a carry on po_on_bp, rotate mid-drag, drop back on its own cell.
    await page.mouse.move(box.x + cx(4), box.y + cy(3));
    await page.mouse.down();
    await page.mouse.move(box.x + cx(5), box.y + cy(3), { steps: 8 }); // arm (free BP cell (3,5))
    await page.keyboard.press('r');
    await page.mouse.move(box.x + cx(4), box.y + cy(3), { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const canvas = await autoSaveAndFetch(page);
    const po = canvas.pos.find((p: any) => p.uid === 'po_on_bp');
    expect(po.rot).toBe(1);
    expect(po.cell).toEqual([3, 4]); // dropped home; the carry survived the rotate
  });

  test('1..5 switch the active squad on backpacks, but NOT while typing in the seal-token input', async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/squad-fixture.json', import.meta.url), 'utf8'));
    await loadFixtureAndBoot(page, fixture);

    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 1');
    await page.keyboard.press('2');
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 2');

    // The guard: digits typed INTO the seal-token input must not switch.
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const seal = page.locator('[data-testid="seal-join-input"]');
    await expect(seal).toBeVisible({ timeout: 10000 });
    await seal.click();
    await seal.press('3');
    await expect(seal).toHaveValue('3'); // the keystroke typed, it did not shortcut
    await page.locator('.nav-link', { hasText: 'Squad' }).click();
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 2'); // unchanged
  });

  test('? opens the shortcut reference in BOTH locales; Esc closes it', async ({ page }) => {
    await bootApp(page);
    const overlay = page.locator('[data-testid="shortcut-help-overlay"]');

    await page.keyboard.press('?');
    await expect(overlay).toBeVisible();
    await expect(page.locator('[data-testid="shortcut-help-title"]')).toHaveText('Keyboard shortcuts');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);

    await page.locator('.lang-toggle').click(); // EN -> JA
    await page.keyboard.press('?');
    await expect(page.locator('[data-testid="shortcut-help-title"]')).toHaveText('\u30ad\u30fc\u30dc\u30fc\u30c9\u30b7\u30e7\u30fc\u30c8\u30ab\u30c3\u30c8');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  });
});
