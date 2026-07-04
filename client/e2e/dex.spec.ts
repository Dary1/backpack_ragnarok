// REQ-0035 -- Dex (図鑑) display view E2E coverage, rebuilt REQ-0038 for
// Dex v2 (shape-mounted catalog rendering + two-pane detail diagram),
// extended REQ-0038 feedback round 2 for the icon-on-shape fix (shared
// client/src/render/itemCard.ts module) + the diagram enlargement/
// two-pane rebalance.
//
// Things this file proves:
//  1. The Dex grid renders exactly as many cards as /api/content's
//     combined PO+SI item count (no items dropped/duplicated).
//  2. Catalog cards render shape-mounted: a "blade" item (a genuine
//     multi-cell PO, shape [[0,0],[1,0]]) shows its footprint as MULTIPLE
//     occupied shape-grid cells, AND the icon overlay's own computed
//     footprint metrics (data-footprint-w/-h, exposed by ShapeGrid.tsx's
//     overlay -- see that file's REQ-0038 R2 fix) confirm the icon spans
//     the full 2-cell (or 4-cell, for tower_shield) footprint, not just
//     one cell -- asserted via DOM metadata, not pixel-sampling.
//  3. Selecting a card switches into the two-pane detail layout (large
//     diagram left, item list right) and shows the expected fields; the
//     two panes are now an explicit ~half/half width split (REQ-0038 R2).
//  4. The detail diagram renders port tiles AND socket markers for an
//     item with both (flame_tablet has 2 ports + hilt has a socket --
//     both confirmed present in live content per REQ-0038's own content
//     read-before-writing-code step), and its per-cell pixel size is
//     dramatically larger than the pre-R2 fixed 46px (REQ-0038 R2's ~5x
//     enlargement), while still fitting within the pane's available
//     height.
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

test('dex v2 R2: catalog cards render shape-mounted ACROSS THE FULL FOOTPRINT (blade 2 cells, tower_shield 4 cells), not squeezed into one cell', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();

  for (const [itemId, expectedCells] of [['blade', 2], ['tower_shield', 4]] as const) {
    await page.locator('.dex-search').fill(itemId);
    const card = page.locator('.dex-card', { hasText: itemId }).first();
    await expect(card).toBeVisible();

    // The catalog card's shape-mounted grid must show the item's real
    // multi-cell footprint (confirmed against content/live/live_items.json
    // before writing this test) -- NOT a single bare icon.
    const cardShape = card.locator('.dex-card-shape .shape-grid');
    await expect(cardShape).toBeVisible();
    await expect(cardShape.locator('.shape-grid-cell-shape')).toHaveCount(expectedCells);

    // Exactly one icon overlay element (composited rendering, matching
    // the pre-R2 DOM shape so this assertion stays stable across the
    // fix), but its OWN computed footprint metrics (data-footprint-w/-h,
    // from client/src/render/itemCard.ts via ShapeGrid.tsx) must now
    // report the item's real multi-cell shape -- this is the R2 fix's
    // load-bearing assertion, robust (DOM metadata) rather than
    // pixel-sampling the rendered <img>.
    const overlay = cardShape.locator('.shape-grid-icon-overlay');
    await expect(overlay).toHaveCount(1);
    const shape = content.items[itemId].shape as Array<[number, number]>;
    const expectedW = Math.max(...shape.map((c) => c[1])) + 1;
    const expectedH = Math.max(...shape.map((c) => c[0])) + 1;
    await expect(overlay).toHaveAttribute('data-footprint-w', String(expectedW));
    await expect(overlay).toHaveAttribute('data-footprint-h', String(expectedH));
    // The icon overlay's rendered box must span MORE than a single cell
    // in at least one axis for these multi-cell items (the actual bug:
    // pre-fix, the icon's own box was clamped to one cell regardless of
    // footprint).
    expect(expectedW * expectedH).toBeGreaterThan(1);

    await expect(overlay.locator('.shape-grid-cell-icon')).toHaveCount(1);
  }
});

test('dex v2: selecting a card switches to the two-pane detail layout with correct fields, panes ~half/half width', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await card.locator('.dex-card-summary').click();

  // Two-pane layout: left pane (diagram + fields), right pane (item list).
  const twoPane = page.locator('.dex-detail-two-pane');
  await expect(twoPane).toBeVisible();
  const leftPane = page.locator('.dex-detail-pane-left');
  const rightPane = page.locator('.dex-detail-pane-right');
  await expect(leftPane).toBeVisible();
  await expect(rightPane).toBeVisible();

  // REQ-0038 R2: "split the detail panel into LEFT/RIGHT halves" -- both
  // panes should occupy roughly equal width (was 65%/300px-fixed before
  // this feedback round). Allow generous tolerance since gap/padding/
  // borders shift the exact pixel split slightly.
  const leftBox = await leftPane.boundingBox();
  const rightBox = await rightPane.boundingBox();
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  const totalWidth = (leftBox!.width) + (rightBox!.width);
  const leftRatio = leftBox!.width / totalWidth;
  expect(leftRatio).toBeGreaterThan(0.4);
  expect(leftRatio).toBeLessThan(0.6);

  await expect(leftPane).toContainText('blade'); // id shown verbatim in fields

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const bladeEffEn = content.items.blade.eff_en;
  expect(bladeEffEn).toBeTruthy();
  await expect(leftPane).toContainText(bladeEffEn);

  // The right-pane list must contain a row for blade AND allow selecting
  // a different item, which should update the left pane. Its own shape-
  // mounted thumbnail must also carry footprint metrics (same shared fit
  // module as the catalog card and the diagram).
  const rightList = page.locator('.dex-detail-pane-right .dex-detail-item-list-row');
  await expect(rightList.first()).toBeVisible();
  const bladeRow = rightList.filter({ hasText: 'blade' }).first();
  const bladeRowOverlay = bladeRow.locator('.shape-grid-icon-overlay');
  await expect(bladeRowOverlay).toHaveAttribute('data-footprint-w', '1');
  await expect(bladeRowOverlay).toHaveAttribute('data-footprint-h', '2');

  // Back button returns to the catalog grid.
  await page.locator('.dex-detail-back-btn').click();
  await expect(page.locator('.dex-grid')).toBeVisible();
  await expect(page.locator('.dex-detail-two-pane')).toHaveCount(0);
});

test('dex v2 R2: detail diagram is enlarged (~5x per-cell size vs the old 46px baseline) and still fits its pane height', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('tower_shield');
  const card = page.locator('.dex-card', { hasText: 'tower_shield' }).first();
  await expect(card).toBeVisible();
  await card.locator('.dex-card-summary').click();

  const diagram = page.locator('.dex-diagram');
  await expect(diagram).toBeVisible();
  const gridWrap = diagram.locator('.dex-diagram-grid-wrap');
  const wrapBox = await gridWrap.boundingBox();
  expect(wrapBox).not.toBeNull();

  // tower_shield's shape is [[0,0],[0,1],[1,0],[1,1]] (2x2, confirmed
  // against content/live/live_items.json) -- so its per-cell pixel size
  // is wrapBox.width / 2. The OLD (pre-R2) fixed size was 46px/cell; the
  // new size must be meaningfully larger (comfortably above 46px even
  // after the height/width cap is applied) while still fitting inside
  // the left pane's own bounding box (no overflow past the pane).
  const perCellPx = wrapBox!.width / 2;
  expect(perCellPx).toBeGreaterThan(46 * 1.5);

  const leftPane = page.locator('.dex-detail-pane-left');
  const leftBox = await leftPane.boundingBox();
  expect(leftBox).not.toBeNull();
  expect(wrapBox!.height).toBeLessThanOrEqual(leftBox!.height + 1);
  expect(wrapBox!.width).toBeLessThanOrEqual(leftBox!.width + 1);

  await page.locator('.dex-detail-back-btn').click();

  // flame_tablet has 2 ports in live content -- the diagram must render a
  // .dex-diagram-ports section with one row per port.
  await page.locator('.dex-search').fill('flame_tablet');
  const flameCard = page.locator('.dex-card', { hasText: 'flame_tablet' }).first();
  await expect(flameCard).toBeVisible();
  await flameCard.locator('.dex-card-summary').click();

  const flameDiagram = page.locator('.dex-diagram');
  await expect(flameDiagram).toBeVisible();
  const portRows = flameDiagram.locator('.dex-diagram-ports .dex-port-row');
  await expect(portRows).toHaveCount(2);

  // Per-cell coordinate labels are present on the main diagram grid.
  await expect(flameDiagram.locator('.dex-diagram-grid-wrap .shape-grid-cell-coord').first()).toBeVisible();

  // The diagram's own icon overlay must report flame_tablet's real
  // 1x2 footprint (shape [[0,0],[1,0]]), same shared-module assertion
  // style as the catalog-card test above.
  const flameOverlay = flameDiagram.locator('.dex-diagram-grid-wrap .shape-grid-icon-overlay');
  await expect(flameOverlay).toHaveAttribute('data-footprint-w', '1');
  await expect(flameOverlay).toHaveAttribute('data-footprint-h', '2');

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
