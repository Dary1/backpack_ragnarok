// client/e2e/release-polish.spec.ts -- REQ-0377 (the P2 release-polish bundle).
//
// One file per REQ rather than five edits scattered across five specs: these
// items share nothing but the REQ that bought them, and keeping them together
// means the day one is reverted, the coverage that argued for it is in the
// same place. Item 2 (build identity) lives in landing.spec.ts / smoke.spec.ts
// because it is about the landing footer and /api/health; item 6 rides
// schedule.spec.ts's settled-run transport test because it needs a real
// settled run; item 9 moved the existing nav selectors in place.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

test.describe('REQ-0377 item 1: the Friends rail entry is hidden until the feature exists', () => {
  test('no Friends rail button, but the #/friends deep link still resolves', async ({ page }) => {
    await bootApp(page);

    // The defect: a permanent "coming soon" door occupying one of nine rail
    // slots. Asserted by ABSENCE from the rail, not by absence from the app.
    await expect(page.locator('.nav-rail')).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Friends' })).toHaveCount(0);

    // ...and by the route still working, which is what makes reviving the
    // entry a one-line change instead of a re-implementation. If this half
    // ever fails, someone deleted the route while "hiding" the button.
    await page.goto('/app/#/friends');
    await expect(page.locator('.placeholder-page h2')).toHaveText('Friends');
  });
});

test.describe('REQ-0377 item 3: the sign-in controls carry the MJOLNIR button primitives', () => {
  test('Settings sign-in buttons are themed, not browser-default', async ({ page }) => {
    await bootApp(page);
    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await expect(page.locator('.settings-page')).toBeVisible();

    // The e2e build has no Supabase env, so AuthBlock renders its
    // "unconfigured" branch and the Discord/guest pair is not on screen. The
    // block itself must still be there -- that is the anchor for the class
    // assertion below when a configured build DOES render them.
    const signin = page.locator('[data-testid="settings-signin"]');
    await expect(signin).toBeVisible();

    // Whichever sign-in buttons this build renders, EVERY one of them must
    // carry .btn. The regression being locked out is the pre-REQ state where
    // .settings-discord-btn / -guest-btn / -link-btn had no CSS rule anywhere
    // and rendered as grey browser chrome next to a styled sign-out button.
    const candidates = signin.locator(
      '[data-testid="settings-continue-discord"], [data-testid="settings-play-guest"], [data-testid="settings-link-discord"]'
    );
    const n = await candidates.count();
    for (let i = 0; i < n; i++) {
      await expect(candidates.nth(i)).toHaveClass(/(^|\s)btn(\s|$)/);
    }
  });
});

test.describe('REQ-0377 item 4: UI scale', () => {
  test('the S/M/L control drives :root[data-ui-scale] and survives a reload', async ({ page }) => {
    await bootApp(page);
    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await expect(page.locator('[data-testid="settings-a11y"]')).toBeVisible();

    // Default is 'm' == scale 1.0, which is what keeps every OTHER spec in
    // this suite (all of which assume unscaled coordinates) unaffected.
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'm');
    await expect(page.locator('[data-testid="settings-ui-scale-m"]')).toHaveAttribute('aria-checked', 'true');

    await page.locator('[data-testid="settings-ui-scale-l"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'l');
    // The whole point of a size setting is that the page actually resizes, so
    // assert the computed effect, not just the attribute.
    const zoom = await page.evaluate(() => getComputedStyle(document.body).zoom);
    expect(zoom === '1.15' || zoom === '115%').toBeTruthy();

    // A preference that forgets itself between sessions is not a preference.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'l');

    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await page.locator('[data-testid="settings-ui-scale-m"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', 'm');
  });
});

test.describe('REQ-0377 item 5: board zoom on small screens', () => {
  test('the toggle is absent on a desktop viewport and zooms the stage on a narrow one', async ({ page }) => {
    await bootApp(page);
    const toggle = page.locator('[data-testid="board-zoom-toggle"]');
    const stage = page.locator('.board-wrap-canvas');

    // Desktop: the stage already fits, so the control must not be offered.
    // An inert control is the same dead-door defect item 1 removed.
    await expect(toggle).toBeHidden();

    await page.setViewportSize({ width: 420, height: 780 });
    await expect(toggle).toBeVisible();
    // Unzoomed the stage must compute to exactly 1 -- the two factors
    // (--board-fit for the short-viewport rule, --board-zoom for this toggle)
    // multiply, and a regression there would silently scale every board.
    await expect(stage).not.toHaveAttribute('data-board-zoom', 'in');

    await toggle.click();
    await expect(stage).toHaveAttribute('data-board-zoom', 'in');
    const zoomed = await stage.evaluate((el) => getComputedStyle(el).zoom);
    expect(zoomed === '1.4' || zoomed === '140%').toBeTruthy();

    // Two steps, and the second one comes back.
    await toggle.click();
    await expect(stage).toHaveAttribute('data-board-zoom', 'fit');
  });
});

test.describe('REQ-0377 item 7: data export', () => {
  test('Settings exports the account + saved canvas as one JSON download', async ({ page }) => {
    await bootApp(page);
    await page.locator('.nav-link', { hasText: 'Settings' }).click();

    const btn = page.locator('[data-testid="settings-data-export"]');
    await expect(btn).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), btn.click()]);

    // The filename must name the player and the day: repeated exports land in
    // one downloads folder and must not overwrite each other.
    expect(download.suggestedFilename()).toMatch(/^backpack_ragnarok_.+_\d{4}-\d{2}-\d{2}\.json$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const doc = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(doc.kind).toBe('backpack_ragnarok.profile_export');
    expect(doc.version).toBe(1);
    expect(typeof doc.exportedAt).toBe('string');
    // An export is only worth having if it can be read back, and the reader
    // needs to know which code wrote it (REQ-0377 item 2's build identity).
    expect(typeof doc.build).toBe('string');
    expect(typeof doc.account.playerId).toBe('string');
    // bootApp has saved a canvas by now, so this is the real profile doc --
    // null here would mean the export silently dropped the part that matters.
    expect(doc.profile).not.toBeNull();
    expect(doc.profile.canvas).toBeTruthy();
    expect(doc.profile.profile_id).toBe(doc.account.playerId);
  });
});
