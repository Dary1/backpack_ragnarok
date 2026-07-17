// REQ-0035 -- Dex admin edit mode E2E coverage, extended REQ-0038, then
// RETIRED by REQ-0182b. The Dex Edit UI is gone (the Dex is now read-only):
// the friendly PO/SI editor was ported to the content admin (#/contentadmin)
// in REQ-0182a, and PUT /api/admin/item/:id now REFUSES (409) any registry-
// served id, pointing the operator to the content admin -- where variant
// adoption, not a live-file write, is what changes the game.
//
// What remains in this file:
//   - the role-less security assertion: no edit UI client-side, and the
//     server independently 403s a raw PUT (still true; the 403 gate still
//     precedes the new 409 in server/routes/admin.cjs, so a role-less caller
//     never learns which ids are adopted);
//   - a positive regression guard that even an item_admin now sees NO edit
//     toggle and NO admin panel (the retired surface must not creep back);
//   - the 409 refusal for a registry-served item, with the #/contentadmin
//     redirect hint. This is a pg-backend behaviour: under the files-backed
//     DEFAULT fleet the registry is always empty (server/lib/content.cjs
//     computeRegistryData is pg-only), so the guard cannot fire and the test
//     SKIPS there -- it runs for real against the LIVE api (bare `pnpm run
//     e2e`, post-deploy) and is exercised deterministically, seeded, in the
//     pg contentadmin harness (client/e2e/contentadmin.spec.ts) and the pg
//     server api_test (server/tests/api/ragnarok.cjs);
//   - the chrome language toggle (unrelated to edit mode; kept verbatim).
//
// The four edit-mode UI tests (edit name via the form, REQ-0038 locale-only
// fields, the effect add/delete round trip, and the edit-mode list thumbnails)
// were DELETED with the UI they drove.
//
// Every test that mutates data/config/dev_user.json restores it in a finally.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DATA_ROOT } from './e2e-env';
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

const DEV_USER_PATH = join(E2E_DATA_ROOT, 'data', 'config', 'dev_user.json');

function readDevUser(): string {
  return readFileSync(DEV_USER_PATH, 'utf8');
}

test.describe('edit toggle hidden for a role-less user', () => {
  test('no edit UI shown client-side, and the server independently 403s a raw PUT', async ({ page }) => {
    const original = existsSync(DEV_USER_PATH) ? readDevUser() : null;
    // The dev server auto-creates this file on boot if missing (server/
    // admin.cjs's ensureDevUser()) -- it is always present by the time
    // any test runs against a live-booted server, so `original` here is
    // always a real backup, never null in practice; the null branch below
    // is a defensive no-op-restore path only.
    try {
      writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: [] }));

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Dex' }).click();
      await expect(page.locator('.dex-root')).toBeVisible();

      // No mode-toggle row at all (the toggle is the ONLY way into edit
      // mode -- its absence is sufficient to prove no edit UI is reachable).
      await expect(page.locator('.dex-mode-toggle-row')).toHaveCount(0);
      await expect(page.locator('.dex-mode-toggle')).toHaveCount(0);
      await expect(page.locator('.dex-admin')).toHaveCount(0);

      // Independent server-side check: a raw PUT with this role-less
      // user's id must still 403, regardless of what the client shows.
      const resp = await page.request.put('/api/admin/item/dagger', {
        headers: { 'X-Player-Id': 'dev', 'Content-Type': 'application/json' },
        data: { name: 'Should Not Apply' },
      });
      expect(resp.status()).toBe(403);
    } finally {
      if (original !== null) writeFileSync(DEV_USER_PATH, original);
    }
  });
});

test.describe('REQ-0182b: the Dex has no edit toggle even for an item_admin', () => {
  test('an item_admin user still sees a READ-ONLY Dex -- no mode toggle, no admin panel (Dex Edit is retired)', async ({ page }) => {
    // Before REQ-0182b an item_admin saw the mode-toggle row, could flip into
    // edit mode, and got the .dex-admin panel. All three are gone now; the
    // content editor lives in #/contentadmin. This is the regression guard: if
    // any of them reappears for an item_admin, the retired surface has crept
    // back. (With the toggle deleted the counts are trivially zero today --
    // that is the point: the assertion pins the surface as removed.)
    const original = existsSync(DEV_USER_PATH) ? readDevUser() : null;
    try {
      writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Dex' }).click();
      await expect(page.locator('.dex-root')).toBeVisible();

      await expect(page.locator('.dex-mode-toggle-row')).toHaveCount(0);
      await expect(page.locator('.dex-mode-toggle')).toHaveCount(0);
      await expect(page.locator('.dex-admin')).toHaveCount(0);
    } finally {
      if (original !== null) writeFileSync(DEV_USER_PATH, original);
    }
  });
});

test.describe('REQ-0182b: admin PUT refuses a registry-served item (409 -> content admin)', () => {
  test('PUT /api/admin/item/:id returns 409 with a #/contentadmin/<id> hint for a registry-served (adopted) item', async ({ page }) => {
    // The 409 guard fires ONLY when the item is served from the registry (an
    // adopted po/si of a covered kind) -- a pg-backend fact. Under the files-
    // backed default fleet the registry is empty BY DESIGN, so the guard can
    // never fire and there is nothing to assert; skip with a pointer to where
    // it IS exercised deterministically. Against the LIVE api the registry is
    // populated, so this runs for real. It never mutates: the 409 returns
    // BEFORE the route reads the body or writes any file.
    //
    // Registry-served item ids are those present in /api/content but NOT in
    // the public dev/sources file_only_names list (i.e. not served from file).
    const sourcesResp = await page.request.get('/api/content/dev/sources');
    expect(sourcesResp.ok()).toBeTruthy();
    const sources = await sourcesResp.json();
    const contentResp = await page.request.get('/api/content');
    const content = await contentResp.json();
    const fileOnly = new Set<string>((sources.items && sources.items.file_only_names) || []);
    const served = Object.keys(content.items || {}).filter((k) => !fileOnly.has(k));

    test.skip(
      served.length === 0,
      'registry empty (files backend / empty pg namespace): the 409 guard is pg-only; ' +
      'exercised in the pg contentadmin harness + server api_test, and live post-deploy'
    );

    const targetId = served[0];
    const original = existsSync(DEV_USER_PATH) ? readDevUser() : null;
    try {
      // Must be an item_admin to pass the 403 gate and reach the 409.
      writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));

      const resp = await page.request.put('/api/admin/item/' + targetId, {
        headers: { 'X-Player-Id': 'dev', 'Content-Type': 'application/json' },
        data: { name: 'must not apply -- this id is registry-served' },
      });
      expect(resp.status()).toBe(409);
      const body = await resp.json();
      expect(body.edit_at).toBe('#/contentadmin/' + targetId);
      expect(['po_def', 'si_def']).toContain(body.registry_kind);
    } finally {
      if (original !== null) writeFileSync(DEV_USER_PATH, original);
    }
  });
});

test.describe('REQ-0038: chrome language toggle', () => {
  test('flips nav labels and dex button text between EN and JA using client/src/i18n.ts', async ({ page }) => {
    await bootApp(page);

    // Default locale is EN -- Dex nav label reads "Dex".
    await expect(page.locator('.nav-link', { hasText: 'Dex' })).toBeVisible();

    await page.locator('.lang-toggle').click();

    // After toggling, the SAME nav link now renders its JA dictionary
    // value ("図鑑") -- proves the toggle actually re-renders chrome text
    // via i18n.ts's t(), not just a cosmetic flag with no visible effect.
    await expect(page.locator('.nav-link', { hasText: '図鑑' })).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Dex' })).toHaveCount(0);

    await page.locator('.nav-link', { hasText: '図鑑' }).click();
    await expect(page.locator('.dex-root')).toBeVisible();
    // A dex-specific chrome string (the "Items" catalog tab) also flips.
    await expect(page.locator('.dex-tab-active', { hasText: 'アイテム' })).toBeVisible();

    // Toggle back to EN -- everything flips back.
    await page.locator('.lang-toggle').click();
    await expect(page.locator('.nav-link', { hasText: 'Dex' })).toBeVisible();
    await expect(page.locator('.dex-tab-active', { hasText: 'Items' })).toBeVisible();
  });
});
