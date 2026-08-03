// client/e2e/signed-out.spec.ts -- REQ-0365.
//
// Runs ONLY under tools/signed_out_e2e.sh, which boots a one-worker fleet with
// E2E_DEV_MODE_OFF=0 so this backend seeds data/config/dev_user.json with
// dev_mode:false. Every other spec in the suite depends on the OPPOSITE (the
// dev_mode fallback IS their identity), which is why this file is excluded from
// the default run via its own config rather than a skip.
import { test, expect } from '@playwright/test';

test.describe('signed out (dev_mode off)', () => {
  test('the server refuses to identify an anonymous caller', async ({ request }) => {
    // The premise of every assertion below. If this ever returns 200, the
    // harness lost its dev_mode:false seed and the rest of this file would pass
    // vacuously against a signed-IN app.
    const me = await request.get('/api/me');
    expect(me.status(), '/api/me must 401 with dev_mode off').toBe(401);

    // Content serving stays public -- this is exactly why boot() could not
    // simply treat "load failed" as "signed out": the content load SUCCEEDS.
    expect((await request.get('/api/content')).status()).toBe(200);
    // And the canvas does not, which is the 401 resolveGameData swallows.
    expect((await request.get('/api/profile/default/canvas')).status()).toBe(401);
  });

  test('an anonymous caller has no item_admin rights', async ({ request }) => {
    // REQ-0362 review finding: with dev_mode ON the dev player is handed out
    // unauthenticated WITH roles:['item_admin'], so anyone who could reach the
    // tunnel was an admin. Turning dev_mode off is what closes it; this pins it.
    const res = await request.put('/api/admin/item/definitely-not-a-real-item', {
      data: {}, headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'the item_admin gate must reject an anonymous caller').toBe(403);
  });

  test('the landing locks its deep-link entries and offers sign-in instead', async ({ page }) => {
    await page.goto('/app/#/');
    await expect(page.locator('.landing-stage')).toBeVisible({ timeout: 10000 });

    // The signed-out chip replaces the "Signed in as <name>" savechip.
    await expect(page.getByTestId('landing-signed-out')).toBeVisible();
    await expect(page.locator('.landing-savechip')).toHaveCount(0);

    // The three deep-link entries are REALLY disabled -- not merely styled, and
    // not routed-then-bounced. A button that looks pressable and does nothing is
    // the defect REQ-0362 was filed for; this is the assertion that it did not
    // come back in a new costume.
    for (const route of ['backpacks', 'schedule', 'ragnarok']) {
      await expect(page.getByTestId('landing-mi-' + route)).toBeDisabled();
    }
    // Settings stays live: it is where sign-in is.
    await expect(page.getByTestId('landing-mi-settings')).toBeEnabled();
  });

  test('boot does NOT fall through to an unsaveable scenario board', async ({ page }) => {
    // The regression this whole REQ exists for. /api/content 200s and the canvas
    // 401 is swallowed by resolveGameData, so boot() used to reach status:'ready'
    // with a pristine board. Asserting the ROUTE is not enough -- a forced route
    // could hide a booted engine -- so this drives the deep link directly.
    await page.goto('/app/#/backpacks');
    // App.tsx sends every non-landing, non-settings route back to the landing.
    await expect(page).toHaveURL(/#\/$/, { timeout: 10000 });
    await expect(page.locator('.landing-stage')).toBeVisible();
    // And no board ever mounted: the HUD badge only renders off the landing,
    // and status:'signed_out' is not 'ready', so the boards stay in their
    // guard branch.
    await expect(page.locator('.data-source-badge')).toHaveCount(0);
  });

  test('Settings is reachable and reports "not signed in", not a load error', async ({ page }) => {
    await page.goto('/app/#/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('settings-account-signedout')).toBeVisible();
    // A 401 must not be dressed up as an outage.
    await expect(page.locator('.settings-account-error')).toHaveCount(0);
    // And the sign-in block is right there, configured (the fleet serves
    // synthetic Supabase config to every worker -- see runtime-config.spec.ts).
    await expect(page.getByTestId('settings-signin')).toBeVisible();
    await expect(page.getByTestId('settings-continue-discord')).toBeVisible();
  });
});
