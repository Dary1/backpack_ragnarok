// client/e2e/artadmin.spec.ts -- REQ-0151 gate G4.
// Full admin flow through the REAL browser UI against a MOCKED ComfyUI
// backend (ART_ROUTE_MOCK=1, no GPU): create -> generate -> adopt -> API
// serves it -> delete non-adopted OK / adopted refused -> re-adopt another
// seed -> export step fires. Requires an isolated pg-backed instance of THIS
// worktree (see the REQ implementation log "G4 isolated-run recipe").
// dev_mode makes the item_admin gate accept the no-token dev fallback, so no
// token setup is needed. Run ONLY via tools/e2e_run.sh (box lock).
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const NAME = 'e2e_sword';

async function waitStatusOk(page: Page, seed: number) {
  await expect(page.getByTestId('render-status-' + seed)).toHaveText('[ok]', { timeout: 60000 });
}

test('artwork admin: create -> generate -> adopt -> serve -> delete rules -> re-adopt -> export', async ({ page, request }) => {
  await request.post('/api/art/dev/clear-all');

  await page.goto('/app/#/artadmin');
  await expect(page.getByTestId('artadmin')).toBeVisible();

  await page.getByTestId('art-kind').selectOption('po');
  await page.getByTestId('po-cell-0-0').click();
  await page.getByTestId('po-cell-1-0').click();
  await page.getByTestId('po-cell-2-0').click();
  await expect(page.getByTestId('art-resolution')).toHaveText('256x768');
  await page.getByTestId('art-system-name').fill(NAME);
  await page.getByTestId('art-main-object').fill('iron sword');
  await page.getByTestId('art-create').click();
  await expect(page.getByTestId('art-editor')).toBeVisible();

  await page.getByTestId('art-preview').click();
  await expect(page.getByTestId('art-final-prompt')).toContainText('anime');

  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 1);
  await expect(page.getByTestId('render-1').locator('img')).toBeVisible();

  await page.getByTestId('adopt-1').click();
  await expect(page.getByTestId('render-1')).toContainText('ADOPTED');
  await expect(page.getByTestId('delete-1')).toBeDisabled();
  await expect(page.getByTestId('art-msg')).toContainText('exported');

  const served = await request.get('/api/art/' + NAME);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image/png');
  expect(served.headers()['etag']).toBeTruthy();

  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 2);
  await page.getByTestId('delete-2').click();
  await expect(page.getByTestId('render-2')).toHaveCount(0);

  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 3);
  await page.getByTestId('adopt-3').click();
  await expect(page.getByTestId('render-3')).toContainText('ADOPTED');
  await expect(page.getByTestId('delete-1')).toBeEnabled();

  const meta = await request.get('/api/art/' + NAME + '/meta');
  expect(meta.status()).toBe(200);
  const body = await meta.json();
  expect(body.seed).toBe(3);
});
