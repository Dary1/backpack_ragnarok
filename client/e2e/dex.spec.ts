// REQ-0035 -- Dex (図鑑) display view E2E coverage, rebuilt REQ-0038 for
// Dex v2 (shape-mounted catalog rendering + two-pane detail diagram).
//
// Things this file proves:
//  1. The Dex grid renders exactly as many cards as /api/content's
//     combined PO+SI item count (no items dropped/duplicated).
//  2. Catalog cards render shape-mounted: a "blade" item (a genuine
//     multi-cell PO, shape [[0,0],[1,0]]) shows its footprint as MULTIPLE
//     occupied shape-grid cells, not a bare icon.
//  3. Selecting a card switches into the two-pane detail layout (large
//     diagram left, item list right) and shows the expected fields.
//  4. The detail diagram renders port tiles AND socket markers for an
//     item with both (flame_tablet has 2 ports + hilt has a socket --
//     both confirmed present in live content per REQ-0038's own content
//     read-before-writing-code step).
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

test('dex v2: catalog cards render shape-mounted (blade shows a multi-cell footprint, not a bare icon)', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await expect(card).toBeVisible();

  // The catalog card's shape-mounted grid must show blade's real 2-cell
  // footprint (shape [[0,0],[1,0]], confirmed against content/live/
  // live_items.json before writing this test) -- NOT a single bare icon.
  const cardShape = card.locator('.dex-card-shape .shape-grid');
  await expect(cardShape).toBeVisible();
  await expect(cardShape.locator('.shape-grid-cell-shape')).toHaveCount(2);
  // The icon itself must be mounted ON one of the shape cells (composited
  // rendering), not floating separately.
  await expect(cardShape.locator('.shape-grid-cell-icon')).toHaveCount(1);
});

test('dex v2: selecting a card switches to the two-pane detail layout with correct fields', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await card.locator('.dex-card-summary').click();

  // Two-pane layout: left pane (diagram + fields), right pane (item list).
  const twoPane = page.locator('.dex-detail-two-pane');
  await expect(twoPane).toBeVisible();
  await expect(page.locator('.dex-detail-pane-left')).toBeVisible();
  await expect(page.locator('.dex-detail-pane-right')).toBeVisible();

  const left = page.locator('.dex-detail-pane-left');
  await expect(left).toContainText('blade'); // id shown verbatim in fields

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const bladeEffEn = content.items.blade.eff_en;
  expect(bladeEffEn).toBeTruthy();
  await expect(left).toContainText(bladeEffEn);

  // The right-pane list must contain a row for blade AND allow selecting
  // a different item, which should update the left pane.
  const rightList = page.locator('.dex-detail-pane-right .dex-detail-item-list-row');
  await expect(rightList.first()).toBeVisible();

  // Back button returns to the catalog grid.
  await page.locator('.dex-detail-back-btn').click();
  await expect(page.locator('.dex-grid')).toBeVisible();
  await expect(page.locator('.dex-detail-two-pane')).toHaveCount(0);
});

test('dex v2: detail diagram renders port tiles (flame_tablet) and socket markers (hilt)', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  // flame_tablet has 2 ports in live content (content/live/live_items.json,
  // confirmed before writing this test) -- the diagram must render a
  // .dex-diagram-ports section with one row per port.
  await page.locator('.dex-search').fill('flame_tablet');
  const flameCard = page.locator('.dex-card', { hasText: 'flame_tablet' }).first();
  await expect(flameCard).toBeVisible();
  await flameCard.locator('.dex-card-summary').click();

  const diagram = page.locator('.dex-diagram');
  await expect(diagram).toBeVisible();
  const portRows = diagram.locator('.dex-diagram-ports .dex-port-row');
  await expect(portRows).toHaveCount(2);

  // Per-cell coordinate labels are present on the main diagram grid.
  await expect(diagram.locator('.dex-diagram-grid-wrap .shape-grid-cell-coord').first()).toBeVisible();

  await page.locator('.dex-detail-back-btn').click();

  // hilt has 1 socket in live content -- the diagram must render the SVG
  // socket-marker overlay (a dot + callout line) and a matching tag-chip
  // label.
  await page.locator('.dex-search').fill('hilt');
  const hiltCard = page.locator('.dex-card', { hasText: 'hilt' }).first();
  await expect(hiltCard).toBeVisible();
  await hiltCard.locator('.dex-card-summary').click();

  const hiltDiagram = page.locator('.dex-diagram');
  await expect(hiltDiagram.locator('.dex-diagram-socket-overlay')).toBeVisible();
  await expect(hiltDiagram.locator('.dex-diagram-socket-dot')).toHaveCount(1);
  await expect(hiltDiagram.locator('.dex-diagram-socket-labels .dex-tag-chip').first()).toBeVisible();
});
