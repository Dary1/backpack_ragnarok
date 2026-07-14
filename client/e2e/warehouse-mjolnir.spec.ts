// REQ-0072 -- MJOLNIR re-skin of the #/schedule WAREHOUSE tab (mock:
// web/redesign/warehouse.html). These tests cover the NEW chrome plus
// the claim / claim-all / staged-capacity behaviors ON that chrome; the
// deep two-phase claim contracts (cross-page fallback, tab pulse,
// no-space posture, server finalization arithmetic) are already covered
// by schedule.spec.ts's REQ-0041 describe on the SAME selectors, all of
// which REQ-0072 kept verbatim.
//
// Two data strategies, deliberately:
//  - claim/claim-all drive the REAL backend via the item_admin grant
//    hook against the DEV_MODE fallback player (the only grant path
//    that works under both storage backends -- see schedule.spec.ts's
//    REQ-0041 describe comment, whose dev_user.json flip convention
//    this file copies). Grant debris is finalized away by the claims
//    themselves; anything left on a failure is swept by global setup/
//    teardown's POST /api/warehouse/dev/clear-debris.
//  - the presentation-state test (staged capacity warning, DECAYING
//    SOON split, NEW badge, market provenance, TM rows) mocks GET
//    /api/warehouse via page.route: those states are pure client
//    derivations of row timestamps/counts, and fabricating 140+ real
//    rows through the HTTP grant hook just to tint a bar would be slow
//    and leave debris for nothing. Row shapes mirror ApiWarehouseItem
//    (+ the market lane's sourceListingId) with REAL content ids
//    ('hilt', 'lrdst') so icon/rarity resolution runs the real path.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DATA_ROOT } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const SCHEDULE_FIXTURE_PATH = new URL('./fixtures/schedule-fixture.json', import.meta.url);
const DEV_USER_PATH = join(REPO_ROOT, 'data', 'config', 'dev_user.json');
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'dev.json');

const fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));

async function gotoWarehouseTab(page: Page): Promise<void> {
  // REQ-0086: Warehouse is its own top-level nav route now, not a
  // Schedule-page tab -- navigate straight there.
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Warehouse' }).click();
  await expect(page.locator('[data-testid="schedule-warehouse-topstrip"]')).toBeVisible({ timeout: 10000 });
}

/** Shared MJOLNIR-chrome assertions both describes reuse: the pagehead
 * identity swap + the ornate topstrip anatomy. */
async function expectWarehouseChrome(page: Page): Promise<void> {
  // REQ-0086: the vault identity is now WarehousePage's own permanent
  // pagehead (Schedule/Expeditions keeps its own, separately asserted by
  // schedule-mjolnir.spec.ts).
  await expect(page.locator('.schedule-pagehead-title')).toHaveText('Treasure Vault');
  await expect(page.locator('.schedule-pagehead-kicker')).toHaveText("MUNINN'S HOARD");
  await expect(page.locator('.warehouse-bgart')).toHaveCount(1);
  await expect(page.locator('.expedition-bgart')).toHaveCount(0);

  // Topstrip: ornate panel + 4 gold knots, den capacity readout with
  // the /200 cap, theme bar, filter chips, forge-gold claim-all.
  const strip = page.locator('[data-testid="schedule-warehouse-topstrip"]');
  await expect(strip).toHaveClass(/panel/);
  await expect(strip).toHaveClass(/ornate/);
  await expect(strip.locator('> .k')).toHaveCount(4);
  await expect(page.locator('[data-testid="schedule-warehouse-cap"]')).toContainText('/200');
  await expect(page.locator('[data-testid="schedule-warehouse-capacity-bar"]')).toHaveClass(/bar/);
  await expect(page.locator('[data-testid="schedule-warehouse-filter-all"]')).toHaveClass(/is-on/);
  const claimAll = page.locator('[data-testid="schedule-claim-all-btn"]');
  await expect(claimAll).toBeVisible();
  await expect(claimAll).toHaveClass(/btn-forge/);
}

test.describe('REQ-0072: warehouse claim + claim-all on the MJOLNIR chrome (real backend, dev grant)', () => {
  // dev_user.json flip -> item_admin, same convention as
  // schedule.spec.ts's REQ-0041 describe / dex-admin.spec.ts.
  let devUserBackup: string | null = null;
  test.beforeEach(async () => {
    devUserBackup = existsSync(DEV_USER_PATH) ? readFileSync(DEV_USER_PATH, 'utf8') : null;
    writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));
  });
  test.afterEach(async () => {
    if (devUserBackup !== null) writeFileSync(DEV_USER_PATH, devUserBackup);
    else if (existsSync(DEV_USER_PATH)) rmSync(DEV_USER_PATH);
  });

  async function grantHiltToDev(page: Page): Promise<string> {
    const res = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.item.itemUid as string;
  }

  test('a granted row renders as a rarity-framed shelf card (thumb, TTL ring, NEW badge, theme claim button) and claiming it on the new chrome moves it to inventory', async ({ page }) => {
    const devProfileExisted = existsSync(DEV_PROFILE_PATH);
    const devProfileBackup = devProfileExisted ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    // pg-aware restore: the live API runs STORAGE_BACKEND=pg, where a
    // dev.json FILE restore is a silent no-op -- re-PUT the original
    // canvas through the API instead (the file backup above still
    // covers a files-mode box). Leaving the RAW fixture behind is not
    // an option: its squad-store BPs are references the next booted
    // client repairs into inventory pages on its first auto-save, which
    // poisons workshop.spec's own before/after BP-diff assertions
    // (observed: the roll test counting 10 phantom new BPs).
    const origCanvasResp = await page.request.get('/api/profile/dev/canvas');
    const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null;
    try {
      await page.request.put('/api/profile/dev/canvas', { data: fixture });
      const grantUid = await grantHiltToDev(page);

      await gotoWarehouseTab(page);
      await expectWarehouseChrome(page);

      // The freshly-granted row: full 7-day TTL, so it sits on the
      // stone SHELF (not the DECAYING SOON strip) and wears the wcard
      // anatomy -- theme rarity frame + corner gem, 64px icon well with
      // a real sprite, the Joermungandr TTL ring, and the NEW badge
      // (harvested seconds ago -> within the 24h window).
      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      const shelf = page.locator('[data-testid="schedule-warehouse-shelf"]');
      await expect(shelf).toHaveClass(/panel/);
      await expect(shelf).toHaveClass(/ornate/);
      await expect(shelf.locator(`[data-item-uid="${grantUid}"]`)).toHaveCount(1);
      await expect(row).toHaveClass(/rar/);
      await expect(row.locator('.gem')).toHaveCount(1);
      await expect(row.locator('.schedule-warehouse-icon-frame img')).toBeVisible();
      await expect(row.locator('.schedule-warehouse-ring')).toBeVisible();
      await expect(row.locator('[data-testid="schedule-warehouse-badge-new"]')).toBeVisible();
      await expect(row.locator('.schedule-warehouse-item-expiry')).not.toHaveClass(/schedule-warehouse-item-expiry-soon/);

      // The embedded inventory board (REQ-0041 portal target) is still
      // mounted inside the re-skinned tab -- same Pixi canvas.
      await expect(page.locator('[data-testid="schedule-warehouse-board-slot"] .board-wrap canvas')).toBeVisible({ timeout: 10000 });

      // Claim on the new chrome: same testid, theme .btn skin.
      const claimBtn = page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`);
      await expect(claimBtn).toHaveClass(/btn/);
      await claimBtn.click();
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });

      // Auto-save finalization (no manual save exists): the item landed
      // in the dev canvas and the warehouse row is gone -- from the API
      // and (via the poll reload) from the shelf.
      await waitForAutoSave(page);
      const canvasResp = await page.request.get('/api/profile/dev/canvas');
      const canvas = (await canvasResp.json()).canvas;
      const placed = canvas.inv.pages.flatMap((p: any) => p.pos).find((p: any) => p.uid === grantUid);
      expect(placed).toBeTruthy();
      expect(placed.id).toBe('hilt');
      const whRes = await page.request.get('/api/warehouse');
      expect((await whRes.json()).items.some((i: any) => i.itemUid === grantUid)).toBe(false);
      await expect(row).toHaveCount(0, { timeout: 10000 });
    } finally {
      if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: origCanvas });
      if (devProfileExisted && devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
      else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    }
  });

  test('claim-all (forge CTA) walks every row and empties the shelf into the inventory', async ({ page }) => {
    const devProfileExisted = existsSync(DEV_PROFILE_PATH);
    const devProfileBackup = devProfileExisted ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    const origCanvasResp = await page.request.get('/api/profile/dev/canvas');
    const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null; // pg-aware restore, see test 1
    try {
      await page.request.put('/api/profile/dev/canvas', { data: fixture });
      const uidA = await grantHiltToDev(page);
      const uidB = await grantHiltToDev(page);

      await gotoWarehouseTab(page);
      await expect(page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${uidA}"]`)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${uidB}"]`)).toBeVisible({ timeout: 10000 });

      const claimAllBtn = page.locator('[data-testid="schedule-claim-all-btn"]');
      await claimAllBtn.click();
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });

      // Wait for the WHOLE claim-all walk to finish first (the button
      // re-enables when claimingAll clears) -- every sequential claim
      // RESETS the 800ms auto-save debounce, so waiting the fixed
      // debounce window from the first toast would sample the canvas
      // BEFORE the final PUT fires (a real race, observed).
      await expect(claimAllBtn).toBeEnabled({ timeout: 20000 });

      // Both rows placed (sequential two-phase claims through the same
      // handleClaim path) + finalized off the warehouse by the auto-save.
      await waitForAutoSave(page);
      const canvasResp = await page.request.get('/api/profile/dev/canvas');
      const canvas = (await canvasResp.json()).canvas;
      const allPos = canvas.inv.pages.flatMap((p: any) => p.pos);
      expect(allPos.find((p: any) => p.uid === uidA)).toBeTruthy();
      expect(allPos.find((p: any) => p.uid === uidB)).toBeTruthy();
      const whRes = await page.request.get('/api/warehouse');
      const whItems = (await whRes.json()).items;
      expect(whItems.some((i: any) => i.itemUid === uidA || i.itemUid === uidB)).toBe(false);
      await expect(page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${uidA}"]`)).toHaveCount(0, { timeout: 10000 });
      await expect(page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${uidB}"]`)).toHaveCount(0, { timeout: 10000 });
    } finally {
      if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: origCanvas });
      if (devProfileExisted && devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
      else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    }
  });

  test('REQ-0091: claim press flashes the row + chime, blocks a rapid second press, and fades the flash out once the (real, delayed) response returns', async ({ page }) => {
    const devProfileExisted = existsSync(DEV_PROFILE_PATH);
    const devProfileBackup = devProfileExisted ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    const origCanvasResp = await page.request.get('/api/profile/dev/canvas');
    const origCanvas = origCanvasResp.ok() ? (await origCanvasResp.json()).canvas : null; // pg-aware restore, see test 1
    try {
      await page.request.put('/api/profile/dev/canvas', { data: fixture });
      const grantUid = await grantHiltToDev(page);

      // Delay (never fabricate) the REAL claim response so this test has
      // a deterministic window to observe the in-flight flash and the
      // double-press guard before the actual server reply comes through.
      // Also counts requests that actually reach the route, to prove a
      // rapid second press never becomes a second network call.
      let claimRequests = 0;
      await page.route('**/api/warehouse/claim', async (route) => {
        claimRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 900));
        await route.continue();
      });

      await gotoWarehouseTab(page);
      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      const claimBtn = page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`);

      // REQ-0159 (class B -- FLAKE, root cause: the test raced a 450ms
      // transient class; the app was never at fault).
      //
      // The fade-out is a ONE-SHOT that lives for exactly FLASH_FADEOUT_MS
      // = 450ms (useWarehouseData.ts's beginClaimFadeOut sets fx='fadeout'
      // and schedules clearClaimFx 450ms later). The old assertion here was
      // `expect(row).toHaveClass(/schedule-claim-fadeout/)` -- a POLLING
      // check, which can only pass if a poll happens to land inside that
      // 450ms window. Under E2E_PARALLEL=4 the polls are not that punctual:
      // the observed failure logged 6 polls seeing `schedule-claim-flash`
      // and the next 4 seeing the fx already cleared, i.e. it stepped clean
      // over the window. Retrying/lengthening the timeout does NOT fix that
      // (a longer timeout just waits longer on a class that is already
      // gone), and neither does relaxing what we assert.
      //
      // So: RECORD the class transitions instead of sampling them. A
      // MutationObserver installed BEFORE the click captures every class
      // the row passes through, so the 450ms state cannot be missed no
      // matter how loaded the box is. The assertions below are strictly
      // STRONGER than the ones they replace -- they pin the actual hand-off
      // (flash on -> fadeout on -> everything cleared) AND the exclusivity
      // of flash vs fadeout, which the old polling pair could only ever
      // sample two disconnected instants of.
      await row.evaluate((el: Element) => {
        const w = window as unknown as { __claimFxSeq?: string[]; __claimFxStop?: () => void };
        w.__claimFxSeq = [el.className];
        const mo = new MutationObserver(() => {
          // Re-read from the live node each time: React re-renders this
          // <article> in place (same node, mutated class attribute), and if
          // it ever DID swap the node, pushing 'REMOVED' is a louder, more
          // honest signal than a silently dead observer.
          const seq = w.__claimFxSeq as string[];
          seq.push(el.isConnected ? el.className : 'REMOVED');
        });
        mo.observe(el, { attributes: true, attributeFilter: ['class'] });
        w.__claimFxStop = () => mo.disconnect();
      });

      // Two native clicks dispatched back-to-back in the SAME task, i.e.
      // before React has any chance to repaint the disabled attribute --
      // exercises the synchronous claimLockRef guard in WarehousePage.tsx
      // (a race the disabled={isClaiming} attribute alone cannot close,
      // since state updates are batched/async).
      await claimBtn.evaluate((el: HTMLButtonElement) => {
        el.click();
        el.click();
      });

      // In flight: the row's OWN frame is flashing (distinct from the
      // button's .placing pulse, already covered by the test above). This
      // one is safe to poll -- the flash LOOPS for the whole ~900ms the
      // route handler above holds the response, so it is not a transient.
      await expect(row).toHaveClass(/schedule-claim-flash/);
      await expect(claimBtn).toHaveClass(/placing/);

      // Settle: the delayed response lands, the flash hands off to the
      // one-shot fade-out, and the fx state is cleared. Poll only for the
      // stable END state (no fx classes at all) -- never for the 450ms
      // fade-out itself.
      await expect(row).not.toHaveClass(/schedule-claim-flash/, { timeout: 5000 });
      await expect(row).not.toHaveClass(/schedule-claim-fadeout/, { timeout: 5000 });

      // Now assert the RECORDED path, which cannot have missed the window.
      const fxSeq: string[] = await page.evaluate(() => {
        const w = window as unknown as { __claimFxSeq?: string[]; __claimFxStop?: () => void };
        w.__claimFxStop?.();
        return w.__claimFxSeq ?? [];
      });
      // The row really did flash while the claim was in flight...
      expect(fxSeq.some((c) => c.includes('schedule-claim-flash'))).toBe(true);
      // ...and really did hand off to the one-shot fade-out when the
      // response came back. If beginClaimFadeOut ever stopped firing, this
      // is the assertion that catches it -- the old polling check could not
      // distinguish "never happened" from "happened between two polls".
      expect(fxSeq.some((c) => c.includes('schedule-claim-fadeout'))).toBe(true);
      // The hand-off is exclusive: the two effects never coexist on the row.
      expect(fxSeq.some((c) => c.includes('schedule-claim-flash') && c.includes('schedule-claim-fadeout'))).toBe(false);

      // The rapid second press never reached the server as its own claim.
      expect(claimRequests).toBe(1);

      // Underneath the FX, the single real claim still completed
      // normally (same finalization path the test above verifies).
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });
      await waitForAutoSave(page);
      const canvasResp = await page.request.get('/api/profile/dev/canvas');
      const canvas = (await canvasResp.json()).canvas;
      const placed = canvas.inv.pages.flatMap((p: any) => p.pos).find((p: any) => p.uid === grantUid);
      expect(placed).toBeTruthy();
    } finally {
      if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: origCanvas });
      if (devProfileExisted && devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
      else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
    }
  });
});

test.describe('REQ-0072: staged capacity + decay presentation states (mocked warehouse payload)', () => {
  // A plain (token-less) boot resolves to the dev player, whose profile
  // must exist for the boot to reach the 'live' badge. These tests
  // never mutate board state (the warehouse payload is route-mocked and
  // nothing is claimed), so the LEAST-intrusive setup is to leave the
  // dev profile completely alone when one exists -- writing the raw
  // schedule fixture here and "restoring" it via the dev.json FILE is a
  // no-op under the pg backend and leaves orphaned squad references
  // behind for the NEXT spec to trip over (see the grant describe's
  // pg-aware-restore comment). Only a profile-less box gets the fixture.
  test.beforeEach(async ({ page }) => {
    const existing = await page.request.get('/api/profile/dev/canvas');
    if (!existing.ok()) await page.request.put('/api/profile/dev/canvas', { data: fixture });
  });

  // Fabricated ApiWarehouseItem rows with REAL content ids so the
  // client's icon/rarity/name resolution follows its real path. Times
  // are computed per-test relative to now.
  function whRow(over: Record<string, unknown>): Record<string, unknown> {
    const now = Date.now();
    return {
      itemUid: `mockwh_${Math.random().toString(36).slice(2, 10)}`,
      playerId: 'dev',
      itemId: 'hilt',
      harvestedAt: new Date(now - 3600_000).toISOString(), // 1h ago
      expiresAt: new Date(now + 6.9 * 86400_000).toISOString(), // ~7d out
      sourceRoomId: null,
      sourceRunId: null,
      status: 'claimable',
      ...over,
    };
  }

  async function mockWarehouse(page: Page, items: Array<Record<string, unknown>>): Promise<void> {
    await page.route('**/api/warehouse', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items }) })
    );
  }

  test('>=70% fill renders the WARNING stage; a <48h row splits into DECAYING SOON with the red ring treatment and the near-expiry chip counts it', async ({ page }) => {
    const now = Date.now();
    const rows: Array<Record<string, unknown>> = [];
    // 139 calm rows + 1 decaying row = 140/200 = 70% -> 'warning'.
    for (let i = 0; i < 139; i++) rows.push(whRow({}));
    rows.push(
      whRow({
        itemUid: 'mockwh_decaying',
        harvestedAt: new Date(now - 6 * 86400_000).toISOString(),
        expiresAt: new Date(now + 86400_000).toISOString(), // 1 day left
      })
    );
    await mockWarehouse(page, rows);
    await gotoWarehouseTab(page);
    await expectWarehouseChrome(page);

    await expect(page.locator('[data-testid="schedule-warehouse-cap"]')).toContainText('140');
    await expect(page.locator('[data-testid="schedule-warehouse-capacity-bar"]')).toHaveClass(/schedule-warehouse-capacity-warning/);
    await expect(page.locator('[data-testid="schedule-warehouse-capacity-warning"]')).toContainText(/running low/i);

    // Near-expiry chip counts the ONE decaying row; the DECAYING SOON
    // colhead + grid carry it with the danger card treatment while the
    // shelf keeps the other 139.
    await expect(page.locator('[data-testid="schedule-warehouse-warnchip"]')).toContainText('1');
    await expect(page.locator('[data-testid="schedule-warehouse-danger-head"]')).toBeVisible();
    const dangerRow = page.locator('[data-testid="schedule-warehouse-danger-grid"] [data-item-uid="mockwh_decaying"]');
    await expect(dangerRow).toHaveCount(1);
    await expect(dangerRow).toHaveClass(/is-danger/);
    await expect(dangerRow.locator('.schedule-warehouse-item-expiry')).toHaveClass(/schedule-warehouse-item-expiry-soon/);
    await expect(page.locator('[data-testid="schedule-warehouse-shelf"] [data-item-uid="mockwh_decaying"]')).toHaveCount(0);
  });

  test('a FULL (200/200) warehouse renders the data-loss stage; TM + market rows wear their own marks; the kind filter narrows the shelf', async ({ page }) => {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 198; i++) rows.push(whRow({}));
    // One TM proceeds row (market settlement shape: kind:'tm' + qty +
    // sourceListingId) and one market-delivered item row.
    rows.push(whRow({ itemUid: 'mockwh_tm', itemId: 'lrdst', kind: 'tm', qty: 12, sourceListingId: 'lst_mock1' }));
    rows.push(whRow({ itemUid: 'mockwh_market', sourceListingId: 'lst_mock2' }));
    await mockWarehouse(page, rows);
    await gotoWarehouseTab(page);

    await expect(page.locator('[data-testid="schedule-warehouse-capacity-bar"]')).toHaveClass(/schedule-warehouse-capacity-full/);
    await expect(page.locator('[data-testid="schedule-warehouse-capacity-warning"]')).toContainText(/full/i);

    // TM stack row: real content.tms name resolution + stack count in
    // the thumb corner + the gold market provenance chip (settlement
    // rows carry sourceListingId; seller names do not exist in the data
    // -- see docs/REQ-0072-redesign-warehouse.md).
    const tmRow = page.locator('[data-item-uid="mockwh_tm"]');
    await expect(tmRow).toBeVisible();
    await expect(tmRow.locator('.schedule-warehouse-qcnt')).toHaveText('×12');
    await expect(tmRow.locator('[data-testid="schedule-warehouse-src"]')).toHaveClass(/schedule-warehouse-src-market/);
    await expect(tmRow.locator('[data-testid="schedule-warehouse-src"]')).toContainText(/market/i);
    const marketRow = page.locator('[data-item-uid="mockwh_market"]');
    await expect(marketRow.locator('[data-testid="schedule-warehouse-src"]')).toHaveClass(/schedule-warehouse-src-market/);

    // Kind filter: 'currency' shows ONLY the TM row; 'all' restores.
    await page.locator('[data-testid="schedule-warehouse-filter-currency"]').click();
    await expect(page.locator('[data-testid="schedule-warehouse-row"]')).toHaveCount(1);
    await expect(page.locator('[data-item-uid="mockwh_tm"]')).toBeVisible();
    await page.locator('[data-testid="schedule-warehouse-filter-all"]').click();
    await expect(page.locator('[data-item-uid="mockwh_market"]')).toBeVisible();
  });
});
