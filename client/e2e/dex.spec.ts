// REQ-0035 -- Dex (図鑑) display view E2E coverage.
//
// Two things this file proves:
//  1. The Dex grid renders exactly as many cards as /api/content's
//     combined PO+SI item count (no items dropped/duplicated).
//  2. A spot-check on "blade" (a Longsword Blade PO with a non-trivial
//     assembled-strike effect -- "Every 1.8-2.2s: Strike 22-38 (when
//     assembled)." / the JA equivalent, per the task's "pick one with an
//     effect that renders non-trivial JA text, e.g. a 'blade' item"
//     suggestion) -- confirms name/id/rarity/rendered JA effect text all
//     appear correctly once expanded.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

test('dex item count matches /api/content combined PO+SI count', async ({ page }) => {
  await bootApp(page);

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const expectedCount = Object.keys(content.items).length + Object.keys(content.sis).length;

  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();
  await expect(page.locator('.dex-count')).toHaveText(`${expectedCount} / ${expectedCount}`);
  await expect(page.locator('.dex-card')).toHaveCount(expectedCount);
});

test('dex spot-check: "blade" card shows correct id/rarity/tags/rendered JA effect text', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  // Search narrows to just this item.
  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await expect(card).toBeVisible();

  await card.locator('.dex-card-summary').click();
  const detail = card.locator('.dex-detail');
  await expect(detail).toBeVisible();

  await expect(detail).toContainText('blade'); // id shown verbatim
  await expect(card.locator('.dex-card-summary .rarity')).toContainText('Common');

  // Tags-with-hierarchy section shows the root tag (WeaponPart's parent
  // is Weapon per content/vocab.json, both should appear somewhere in the
  // ancestry path text).
  await expect(detail.locator('.dex-tag-list')).toContainText('Weapon');

  // Both rendered effect strings (EN and JA) must appear verbatim --
  // fetched fresh from /api/content so this test does not hardcode
  // wording that could drift from tools/eff_render.cjs's actual output.
  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const bladeEffEn = content.items.blade.eff_en;
  const bladeEffJa = content.items.blade.eff_ja;
  expect(bladeEffEn).toBeTruthy();
  expect(bladeEffJa).toBeTruthy();
  await expect(detail).toContainText(bladeEffEn);
  await expect(detail).toContainText(bladeEffJa);

  // Shape mini-grid rendered (blade is a 2-cell vertical shape).
  await expect(detail.locator('.shape-grid').first()).toBeVisible();
  await expect(detail.locator('.shape-grid-cell-shape')).toHaveCount(2);

  // Raw AST collapsible present and expandable.
  const rawAst = detail.locator('.dex-raw-ast');
  await expect(rawAst).toBeVisible();
  await rawAst.locator('summary').click();
  await expect(rawAst.locator('pre')).toContainText('"strike"');
});
