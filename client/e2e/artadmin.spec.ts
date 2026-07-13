// client/e2e/artadmin.spec.ts -- REQ-0151 gate G4, UPDATED by REQ-0156 for
// the overhauled three-pane console: the create flow now opens via art-new
// (dedicated create panel, never fed by selection), adopt/delete go through
// confirm dialogs (confirm-ok), and coverage is ADDED for the lightbox,
// search/filter narrowing, queue-job cancel and failed-render retry.
// Runs against a MOCKED ComfyUI backend (ART_ROUTE_MOCK=1, no GPU) with
// ART_MOCK_DELAY_MS holding jobs in the queue long enough to cancel one.
// Requires the isolated instance from tools/artadmin_e2e.sh (HOME-remapped
// namespace; never the live services). Run ONLY via tools/e2e_run.sh
// (box lock) -- tools/artadmin_e2e.sh does exactly that.
import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';

const NAME = 'e2e_sword';

async function waitStatusOk(page: Page, seed: number) {
  await expect(page.getByTestId('render-status-' + seed)).toHaveText('[ok]', { timeout: 90000 });
}

// confirm-gated click: the action button opens the REQ-0156 confirm dialog
async function confirmClick(page: Page, testId: string) {
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
}

function swordMask(): boolean[][] {
  const m = Array.from({ length: 5 }, () => Array(5).fill(false) as boolean[]);
  m[0][0] = m[1][0] = m[2][0] = true;
  return m;
}

async function apiCreate(request: APIRequestContext, body: Record<string, unknown>) {
  const r = await request.post('/api/art/artworks', { data: body });
  expect(r.status()).toBe(201);
}

test('artwork admin: create (panel) -> generate -> lightbox -> adopt (confirm) -> serve -> delete rules -> re-adopt via lightbox', async ({ page, request }) => {
  await request.post('/api/art/dev/clear-all');

  await page.goto('/app/#/artadmin');
  await expect(page.getByTestId('artadmin')).toBeVisible();

  // REQ-0156: the create flow lives behind art-new (dedicated panel)
  await page.getByTestId('art-new').click();
  await page.getByTestId('art-kind').selectOption('po');
  await page.getByTestId('po-cell-0-0').click();
  await page.getByTestId('po-cell-1-0').click();
  await page.getByTestId('po-cell-2-0').click();
  await expect(page.getByTestId('art-resolution')).toHaveText('256x768');
  await page.getByTestId('art-system-name').fill(NAME);
  await page.getByTestId('art-main-object').fill('iron sword');
  await page.getByTestId('art-create').click();
  await expect(page.getByTestId('art-editor')).toBeVisible();

  // final-prompt preview shows the art_style-templated prompt
  await page.getByTestId('art-preview').click();
  await expect(page.getByTestId('art-final-prompt')).toContainText('anime');

  // generate three candidate seeds (1, 2, 3), each waited to completion
  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 1);
  await expect(page.getByTestId('render-1').locator('img')).toBeVisible();
  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 2);
  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, 3);

  // lightbox (REQ-0156 judging tool): open seed 1 full-size, zoom + bg
  await page.getByTestId('render-thumb-1').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
  expect(await page.getByTestId('lightbox-img').getAttribute('src')).toContain('/renders/1');
  await page.getByTestId('lightbox-zoom-1').click();
  await page.getByTestId('lightbox-bg-white').click();
  await page.keyboard.press('ArrowRight');   // keyboard nav -> seed 2
  expect(await page.getByTestId('lightbox-img').getAttribute('src')).toContain('/renders/2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toHaveCount(0);

  // adopt seed 1 (confirm dialog shows the image + export note); export
  // fires (msg says exported), delete disabled on adopted
  await confirmClick(page, 'adopt-1');
  await expect(page.getByTestId('render-1')).toContainText('ADOPTED');
  await expect(page.getByTestId('delete-1')).toBeDisabled();
  await expect(page.getByTestId('art-msg')).toContainText('exported');

  // API serves the adopted image (ETag = sha256)
  const served = await request.get('/api/art/' + NAME);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image/png');
  expect(served.headers()['etag']).toBeTruthy();

  // delete a NON-adopted seed (2) -> confirm -> allowed
  await confirmClick(page, 'delete-2');
  await expect(page.getByTestId('render-2')).toHaveCount(0);

  // re-adopt seed 3 FROM THE LIGHTBOX -> adopted switches; seed 1 deletable
  await page.getByTestId('render-thumb-3').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await confirmClick(page, 'lightbox-adopt');
  await page.getByTestId('lightbox-close').click();
  await expect(page.getByTestId('render-3')).toContainText('ADOPTED');
  await expect(page.getByTestId('delete-1')).toBeEnabled();

  // meta reflects the newly adopted seed
  const meta = await request.get('/api/art/' + NAME + '/meta');
  expect(meta.status()).toBe(200);
  const body = await meta.json();
  expect(body.seed).toBe(3);
});

test('registry browser: search + kind/adoption filters narrow the list', async ({ page, request }) => {
  await request.post('/api/art/dev/clear-all');
  await apiCreate(request, { system_name: 'e2e_sword', kind: 'po', shape: { mask: swordMask() }, main_object: 'iron sword' });
  await apiCreate(request, { system_name: 'e2e_potion', kind: 'si', main_object: 'red potion' });

  await page.goto('/app/#/artadmin');
  await expect(page.getByTestId('art-select-e2e_sword')).toBeVisible();
  await expect(page.getByTestId('art-select-e2e_potion')).toBeVisible();

  // substring search on system_name
  await page.getByTestId('art-search').fill('sword');
  await expect(page.getByTestId('art-select-e2e_potion')).toHaveCount(0);
  await expect(page.getByTestId('art-select-e2e_sword')).toBeVisible();

  // substring search also matches main_object
  await page.getByTestId('art-search').fill('red pot');
  await expect(page.getByTestId('art-select-e2e_sword')).toHaveCount(0);
  await expect(page.getByTestId('art-select-e2e_potion')).toBeVisible();
  await page.getByTestId('art-search').fill('');

  // kind filter chips
  await page.getByTestId('art-filter-kind-si').click();
  await expect(page.getByTestId('art-select-e2e_sword')).toHaveCount(0);
  await expect(page.getByTestId('art-select-e2e_potion')).toBeVisible();
  await page.getByTestId('art-filter-kind-all').click();

  // adoption filter: nothing adopted yet
  await page.getByTestId('art-filter-adoption-adopted').click();
  await expect(page.getByTestId('art-select-e2e_sword')).toHaveCount(0);
  await expect(page.getByTestId('art-select-e2e_potion')).toHaveCount(0);
  await page.getByTestId('art-filter-adoption-unadopted').click();
  await expect(page.getByTestId('art-select-e2e_sword')).toBeVisible();
});

test('queue: cancel a pending job -> failed \'canceled by user\'; rest complete; retry regenerates the seed', async ({ page, request }) => {
  await request.post('/api/art/dev/clear-all');
  await apiCreate(request, { system_name: 'e2e_q', kind: 'si', main_object: 'blue orb' });

  await page.goto('/app/#/artadmin');
  await page.getByTestId('art-select-e2e_q').click();
  await expect(page.getByTestId('art-editor')).toBeVisible();

  // queue 5 jobs (ART_MOCK_DELAY_MS keeps each in flight ~1.5 s)
  await page.getByTestId('art-n').fill('5');
  await page.getByTestId('art-gen-n').click();

  // the queue panel shows pending jobs; cancel the LAST pending one
  const pendingRows = page.locator('[data-testid^="queue-pending-"]');
  await expect(pendingRows.first()).toBeVisible({ timeout: 10000 });
  const lastRow = pendingRows.last();
  const rowText = await lastRow.innerText();
  const m = /s(\d+)/.exec(rowText);
  expect(m).toBeTruthy();
  const canceledSeed = Number(m![1]);
  await lastRow.locator('[data-testid^="queue-cancel-"]').click();

  // the canceled render becomes failed 'canceled by user'
  await expect(page.getByTestId('render-status-' + canceledSeed)).toHaveText('[failed]', { timeout: 15000 });
  await expect(page.getByTestId('render-' + canceledSeed)).toContainText('canceled by user');

  // every OTHER job still completes (the pump was not disturbed)
  for (let seed = 1; seed <= 5; seed++) {
    if (seed === canceledSeed) continue;
    await waitStatusOk(page, seed);
  }

  // retry the canceled seed: delete + regenerate at that explicit seed
  await page.getByTestId('retry-' + canceledSeed).click();
  await waitStatusOk(page, canceledSeed);
  await expect(page.getByTestId('render-' + canceledSeed).locator('img')).toBeVisible();
});
