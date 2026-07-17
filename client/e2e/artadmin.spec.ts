// client/e2e/artadmin.spec.ts -- REQ-0151 gate G4, UPDATED by REQ-0156 for
// the overhauled three-pane console: the create flow now opens via art-new
// (dedicated create panel, never fed by selection), adopt/delete go through
// confirm dialogs (confirm-ok), and coverage is ADDED for the lightbox,
// search/filter narrowing, queue-job cancel and failed-render retry.
// REQ-0252 restructured the ceremony (mask builder, beforeEach clear-all,
// selectArtwork, genNext) WITHOUT touching a single assertion -- same 7 tests,
// same order, same results. The per-REQ rationale comments are load-bearing
// and stay verbatim: they record why each test is shaped the way it is.
// NOTE: artadmin.config.ts's BASE_URL fallback (8903) is outside REQ-0156's
// derived decade, but that drift is REQ-0251's (e2e-harness-dedupe), not this
// file's -- see docs/REQ/todo/REQ-0252-artadmin-spec-restructure.md.
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

// 5x5 footprint grid, row-major: mask[row][col], matching CellBackdrop's read
// (artShared.ts) and the render-cb-<seed>-cell-<row>-<col> testids.
function mask(...cells: ReadonlyArray<readonly [number, number]>): boolean[][] {
  const m = Array.from({ length: 5 }, () => Array(5).fill(false) as boolean[]);
  for (const [row, col] of cells) m[row][col] = true;
  return m;
}

// A full 1x3 rectangle (1 col x 3 rows -> 256x768).
const swordMask = (): boolean[][] => mask([0, 0], [1, 0], [2, 0]);

// REQ-0191: an L-tromino -- the sword above is a full 1x3 rectangle, so its
// bbox has NO unowned cell and cannot show the owned/unowned split at all.
// The L's bbox is 2x2 with (0,1) unowned, which is exactly the awkward
// footprint the backdrop exists for (REQ-0153/0187: the shape-conditioning
// question only bites where the shape does not fill its box).
const lMask = (): boolean[][] => mask([0, 0], [1, 0], [1, 1]);

// REQ-0216: a single cell -- the 1x1 against the L's 2x2 is the whole point,
// see the true-scale test below.
const gemMask = (): boolean[][] => mask([0, 0]);

async function apiCreate(request: APIRequestContext, body: Record<string, unknown>) {
  const r = await request.post('/api/art/artworks', { data: body });
  expect(r.status()).toBe(201);
}

// select an artwork from the registry list and wait for its editor to mount
async function selectArtwork(page: Page, name: string) {
  await page.getByTestId('art-select-' + name).click();
  await expect(page.getByTestId('art-editor')).toBeVisible();
}

// queue one render at the next free seed and wait for it to land ok
async function genNext(page: Page, seed: number) {
  await page.getByTestId('art-gen-next').click();
  await waitStatusOk(page, seed);
}

// every test starts from an empty registry
test.beforeEach(async ({ request }) => {
  await request.post('/api/art/dev/clear-all');
});

test('artwork admin: create (panel) -> generate -> lightbox -> adopt (confirm) -> serve -> delete rules -> re-adopt via lightbox', async ({ page, request }) => {
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
  await genNext(page, 1);
  await expect(page.getByTestId('render-1').locator('img')).toBeVisible();
  await genNext(page, 2);
  await genNext(page, 3);

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

test('REQ-0191 cell backdrop: po renders draw over their footprint (owned vs unowned), toggleable, po-only', async ({ page, request }) => {
  await apiCreate(request, { system_name: 'e2e_axe', kind: 'po', shape: { mask: lMask() }, main_object: 'iron axe' });
  await apiCreate(request, { system_name: 'e2e_orb', kind: 'si', main_object: 'blue orb' });

  await page.goto('/app/#/artadmin');
  await selectArtwork(page, 'e2e_axe');
  await genNext(page, 1);

  // the THUMB carries the backdrop, default ON: the L's 2x2 bbox, 3 owned
  // cells + the unowned corner at (0,1).
  await expect(page.getByTestId('render-cb-1')).toBeVisible();
  await expect(page.getByTestId('render-cb-1-cell-0-0')).toHaveAttribute('data-owned', '1');
  await expect(page.getByTestId('render-cb-1-cell-1-0')).toHaveAttribute('data-owned', '1');
  await expect(page.getByTestId('render-cb-1-cell-1-1')).toHaveAttribute('data-owned', '1');
  await expect(page.getByTestId('render-cb-1-cell-0-1')).toHaveAttribute('data-owned', '0');
  // the render itself is still there, unwrapped-or-not
  await expect(page.getByTestId('render-1').locator('img')).toBeVisible();
  // keying: the mock render is FULLY OPAQUE (art_job.mock_png paints a solid
  // RGBA rect), i.e. the "stored on white" case -> the probe must choose
  // multiply. The alpha case (a batch-backfilled/adopted render, where
  // multiply would needlessly warm-cast the subject) is the other branch of
  // CellBackdrop.useNeedsWhiteKey and cannot be produced by the mock.
  await expect(page.getByTestId('render-cb-1')).toHaveAttribute('data-key', 'white');

  // gallery toggle: off -> plain thumb (the REQ's "the plain view stays
  // reachable"), and the image survives the unwrap
  await page.getByTestId('art-cells').click();
  await expect(page.getByTestId('render-cb-1')).toHaveCount(0);
  await expect(page.getByTestId('render-1').locator('img')).toBeVisible();
  await page.getByTestId('art-cells').click();
  await expect(page.getByTestId('render-cb-1')).toBeVisible();

  // the LIGHTBOX carries the same backdrop, default ON, and the img keeps
  // its REQ-0156 testid + src contract inside the wrap
  await page.getByTestId('render-thumb-1').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-img-cb')).toBeVisible();
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
  expect(await page.getByTestId('lightbox-img').getAttribute('src')).toContain('/renders/1');
  await expect(page.getByTestId('lightbox-img-cb-cell-0-1')).toHaveAttribute('data-owned', '0');
  await expect(page.getByTestId('lightbox-img-cb-cell-1-1')).toHaveAttribute('data-owned', '1');

  // backdrop survives a zoom change (the grid is aspect-locked to the render,
  // not measured off it)
  await page.getByTestId('lightbox-zoom-2').click();
  await expect(page.getByTestId('lightbox-img-cb')).toBeVisible();
  await expect(page.getByTestId('lightbox-img')).toBeVisible();

  // lightbox toggle: off -> plain img, on -> back
  await page.getByTestId('lightbox-cells').click();
  await expect(page.getByTestId('lightbox-img-cb')).toHaveCount(0);
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
  await page.getByTestId('lightbox-cells').click();
  await expect(page.getByTestId('lightbox-img-cb')).toBeVisible();
  await page.keyboard.press('Escape');

  // po-only: an si artwork has no footprint, so no chip and no backdrop
  await selectArtwork(page, 'e2e_orb');
  await expect(page.getByTestId('art-cells')).toHaveCount(0);
  await genNext(page, 1);
  await expect(page.getByTestId('render-cb-1')).toHaveCount(0);
  await page.getByTestId('render-thumb-1').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-cells')).toHaveCount(0);
  await expect(page.getByTestId('lightbox-img-cb')).toHaveCount(0);
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
});

test('registry browser: search + kind/adoption filters narrow the list', async ({ page, request }) => {
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
  await apiCreate(request, { system_name: 'e2e_q', kind: 'si', main_object: 'blue orb' });

  await page.goto('/app/#/artadmin');
  await selectArtwork(page, 'e2e_q');

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

// REQ-0173 (contentadmin-entity-rendering B): the #/artadmin/<system_name>
// deep link selects that artwork once the registry list has loaded (mirror of
// the contentadmin deep link). Consuming is minimal + additive; the existing
// three tests above are untouched.
test('deep link: #/artadmin/<name> selects that artwork on load', async ({ page, request }) => {
  await apiCreate(request, { system_name: 'e2e_deeplink', kind: 'si', main_object: 'ruby amulet' });

  await page.goto('/app/#/artadmin/e2e_deeplink');
  await expect(page.getByTestId('artadmin')).toBeVisible();
  await expect(page.getByTestId('art-editor')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('art-editor')).toContainText('e2e_deeplink');
});

// REQ-0179: the `custom` kind -- operator-SET resolution (/16-snapped) and an
// operator-owned prompt (no per-kind style template appended). This is the
// texture kind linkable to no-art-kind content (e.g. gacha_pack) via contentadmin.
test('custom kind: operator sets resolution (snapped) and the prompt is verbatim (no style tail)', async ({ page }) => {
  await page.goto('/app/#/artadmin');
  await expect(page.getByTestId('artadmin')).toBeVisible();
  await page.getByTestId('art-new').click();
  await page.getByTestId('art-kind').selectOption('custom');
  // operator-set resolution: 1000x700 -> /16-snapped to 1008x704
  await page.getByTestId('art-res-w').fill('1000');
  await page.getByTestId('art-res-h').fill('700');
  await expect(page.getByTestId('art-resolution')).toHaveText('1008x704');
  await page.getByTestId('art-system-name').fill('e2e_custom_tex');
  await page.getByTestId('art-main-object').fill('mossy stone bricks');
  await page.getByTestId('art-create').click();
  await expect(page.getByTestId('art-editor')).toBeVisible();
  // header shows the operator-set (snapped) resolution
  await expect(page.getByTestId('art-editor')).toContainText('1008x704');
  // operator-owned prompt: verbatim main_object, NONE of the entity kinds' style tail
  await page.getByTestId('art-preview').click();
  await expect(page.getByTestId('art-final-prompt')).toContainText('mossy stone bricks');
  await expect(page.getByTestId('art-final-prompt')).not.toContainText('anime');
  await expect(page.getByTestId('art-final-prompt')).not.toContainText('bold outline');
});

test('REQ-0216 true-scale thumbs: constant px-per-cell across footprints', async ({ page, request }) => {
  // 1x1 vs the L's 2x2 bbox: constant px-per-cell means the two stages get
  // inline widths of 1*42 and 2*42 -- the size DIFFERENCE is the feature
  // (before REQ-0216 both were normalized into the same 212x150 cap).
  await apiCreate(request, { system_name: 'e2e_gem', kind: 'po', shape: { mask: gemMask() }, main_object: 'small gem' });
  await apiCreate(request, { system_name: 'e2e_axe2', kind: 'po', shape: { mask: lMask() }, main_object: 'iron axe' });

  await page.goto('/app/#/artadmin');
  await selectArtwork(page, 'e2e_gem');
  await genNext(page, 1);
  await expect(page.getByTestId('render-cb-1')).toBeVisible();
  await expect(page.getByTestId('render-cb-1')).toHaveCSS('width', '42px');

  await selectArtwork(page, 'e2e_axe2');
  await genNext(page, 1);
  await expect(page.getByTestId('render-cb-1')).toBeVisible();
  await expect(page.getByTestId('render-cb-1')).toHaveCSS('width', '84px');
});
