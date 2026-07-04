// REQ-0035 -- Dex admin edit mode E2E coverage.
//
// This file exercises the REAL /api/me + PUT /api/admin/item/:id
// endpoints against the REAL data/config/dev_user.json and content/live/
// *.json files (there is no staging copy of either -- see server/
// README.md's Admin API section and this repo's E2E convention, already
// established for data/profiles/default.json by global-setup.ts/
// global-teardown.ts, now extended to content/live/*.json too). Every
// test that mutates either file restores it in a finally block so a
// failure never leaves the fixture mutated -- on top of the suite-level
// global-teardown.ts safety net that restores content/live/*.json
// (backed up in global-setup.ts) even if a test's own finally somehow
// doesn't run.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bootApp } from './helpers';

const DEV_USER_PATH = join(homedir(), 'backpack_ragnarok', 'data', 'config', 'dev_user.json');

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

test.describe('edit toggle visible + functional for the dev (item_admin) user', () => {
  test('edit an item name via the form, reload, confirm in both dex UI and /api/content, then restore via a second API edit', async ({ page }) => {
    // Ensure the dev user genuinely has item_admin for this test,
    // regardless of what a previous test (or a stale manual edit) left in
    // place -- restore to the ORIGINAL content in finally either way.
    const original = existsSync(DEV_USER_PATH) ? readDevUser() : null;
    writeFileSync(DEV_USER_PATH, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));

    // Capture the pre-edit name from the live API so the restore step
    // puts back the EXACT original value, not a hardcoded guess.
    const beforeResp = await page.request.get('/api/content');
    const beforeContent = await beforeResp.json();
    const originalName = beforeContent.items.dagger.name as string;
    const newName = originalName + ' (e2e-edit)';

    try {
      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Dex' }).click();
      await expect(page.locator('.dex-root')).toBeVisible();

      // Toggle visible for this admin user.
      await expect(page.locator('.dex-mode-toggle-row')).toBeVisible();
      await page.locator('.dex-mode-toggle', { hasText: 'Edit mode' }).or(page.locator('.dex-mode-toggle', { hasText: '編集モード' })).click();
      await expect(page.locator('.dex-admin')).toBeVisible();

      // Select "dagger" from the admin item list and edit its EN name.
      await page.locator('.dex-admin-list-item', { hasText: '(dagger)' }).click();
      const nameInput = page.locator('.dex-admin-field', { hasText: 'Name (EN)' }).locator('input');
      await nameInput.fill(newName);

      await page.locator('.dex-admin-save-btn').click();
      await expect(page.locator('.dex-admin-save-ok')).toBeVisible({ timeout: 10000 });

      // Reload the page entirely -- confirm the new name appears both via
      // a direct /api/content fetch AND in the dex display UI.
      await page.reload();
      await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });

      const afterResp = await page.request.get('/api/content');
      const afterContent = await afterResp.json();
      expect(afterContent.items.dagger.name).toBe(newName);

      await page.locator('.nav-link', { hasText: 'Dex' }).click();
      await expect(page.locator('.dex-root')).toBeVisible();
      await page.locator('.dex-search').fill('dagger');
      await expect(page.locator('.dex-card', { hasText: newName })).toBeVisible();
    } finally {
      // ALWAYS restore the item's original name via a second admin edit
      // (not a raw file copy -- this exercises the same write path, and
      // is what the task spec asks for: "issue a second edit via the same
      // API to RESTORE the original value"). Runs even if an assertion
      // above threw.
      await page.request.put('/api/admin/item/dagger', {
        headers: { 'X-Player-Id': 'dev', 'Content-Type': 'application/json' },
        data: { name: originalName },
      });
      if (original !== null) writeFileSync(DEV_USER_PATH, original);
    }
  });
});
