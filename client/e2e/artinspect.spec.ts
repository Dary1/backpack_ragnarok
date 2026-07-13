// client/e2e/artinspect.spec.ts -- REQ-0152 gate G4.
// Inspection kits wired into the artwork admin, through the REAL browser UI,
// against a MOCKED ComfyUI backend (ART_ROUTE_MOCK=1, no GPU) and the fast
// model-free matte (ART_KIT_MATTE_METHOD=borderkey). Flow: generate -> kits
// auto-run -> verdict chips visible (PASS green / WARN amber) -> expandable
// metrics -> persisted across reload -> kit_version bump -> stale badge ->
// re-run -> stale cleared -> adoption possible despite a WARN kit (advisory
// doctrine). Run ONLY via tools/e2e_run.sh (box lock) with the isolated
// instance from tools/art_inspect_e2e.sh.
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const NAME = 'e2e_insp_sword';

async function selectArtwork(page: Page) {
  await expect(page.getByTestId('artadmin')).toBeVisible();
  await page.getByTestId('art-select-' + NAME).click();
  await expect(page.getByTestId('art-editor')).toBeVisible();
}

test('inspection kits: generate -> chips -> persist -> stale -> re-run -> adopt despite WARN', async ({ page, request }) => {
  await request.post('/api/art/dev/clear-all');

  await page.goto('/app/#/artadmin');
  await expect(page.getByTestId('artadmin')).toBeVisible();

  // create a po sword: 3 vertical cells -> 256x768
  await page.getByTestId('art-kind').selectOption('po');
  await page.getByTestId('po-cell-0-0').click();
  await page.getByTestId('po-cell-1-0').click();
  await page.getByTestId('po-cell-2-0').click();
  await expect(page.getByTestId('art-resolution')).toHaveText('256x768');
  await page.getByTestId('art-system-name').fill(NAME);
  await page.getByTestId('art-main-object').fill('iron sword');
  await page.getByTestId('art-create').click();
  await expect(page.getByTestId('art-editor')).toBeVisible();

  // generate seed 1 (mock), wait to completion
  await page.getByTestId('art-gen-next').click();
  await expect(page.getByTestId('render-status-1')).toHaveText('[ok]', { timeout: 60000 });

  // kits auto-run -> both po chips appear with their verdicts
  await expect(page.getByTestId('chip-1-po.cell_packing')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('verdict-1-po.cell_packing')).toHaveText('PASS');
  await expect(page.getByTestId('chip-1-matte.coverage_band')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('verdict-1-matte.coverage_band')).toHaveText('WARN');

  // expandable metrics/checks/notes
  await page.getByTestId('chip-1-matte.coverage_band').click();
  await expect(page.getByTestId('kit-details-1-matte.coverage_band')).toBeVisible();
  await expect(page.getByTestId('kit-details-1-matte.coverage_band')).toContainText('image_alpha_coverage');

  // persisted: reload the SPA, re-select -> chips still present (from the DB)
  await page.reload();
  await selectArtwork(page);
  await expect(page.getByTestId('chip-1-po.cell_packing')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('chip-1-matte.coverage_band')).toBeVisible();

  // simulate a kit_version BUMP -> the matte row is now stale (badge + re-run)
  await request.post('/api/art/dev/bump-kit', { data: { kit_id: 'matte.coverage_band', kit_version: '2' } });
  await expect(page.getByTestId('stale-1-matte.coverage_band')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('rerun-1-matte.coverage_band')).toBeVisible();

  // re-run just that kit -> a new row at the current version -> stale clears
  await page.getByTestId('rerun-1-matte.coverage_band').click();
  await expect(page.getByTestId('stale-1-matte.coverage_band')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByTestId('chip-1-matte.coverage_band')).toBeVisible();

  // adoption is possible regardless of the WARN verdict (advisory doctrine)
  await page.getByTestId('adopt-1').click();
  await expect(page.getByTestId('render-1')).toContainText('ADOPTED');

  // served + meta still work after adoption
  const served = await request.get('/api/art/' + NAME);
  expect(served.status()).toBe(200);
});
