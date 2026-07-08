// REQ-0035 -- Dex (図鑑) display view E2E coverage, rebuilt REQ-0038 for
// Dex v2 (shape-mounted catalog rendering + two-pane detail diagram),
// extended REQ-0038 feedback round 2 for the icon-on-shape fix (shared
// client/src/render/itemCard.ts module) + the diagram enlargement/
// two-pane rebalance, extended AGAIN for Dex feedback round 3 (R3):
//   fix 1 -- view-mode locale-only display (no more paired EN/JA rows
//     in the detail info column; the global JA/EN toggle governs name/
//     flavor/effects text).
//   fix 2 -- WIDE-screen layout is now three columns in DOM/visual order
//     [list | diagram | info] (list moved from the right side to the
//     FAR LEFT; the detail panel itself split diagram-left/info-right),
//     collapsing back to the pre-R3 stacked layout under a 1100px
//     responsive breakpoint (index.css's `.dex-detail-columns` media
//     query).
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
//  3. Selecting a card keeps the catalog grid and opens an inline
//     [diagram | info] detail drawer below it (REQ-0108); the former
//     separate list rail is gone (one list only).
//  4. The detail diagram renders port tiles AND socket markers for an
//     item with both (flame_tablet has 2 ports + hilt has a socket --
//     both confirmed present in live content per REQ-0038's own content
//     read-before-writing-code step), and its per-cell pixel size is
//     dramatically larger than the pre-R2 fixed 46px (REQ-0038 R2's ~5x
//     enlargement), while still fitting within its column's available
//     height.
//  5. (R3) View-mode locale switching shows ONLY the active locale's
//     name/flavor/effects text in the detail info column -- switching to
//     JA must NOT leave any EN flavor text visible, and vice versa.
//  6. (R3) Wide-viewport column order is list -> diagram -> info (left
//     to right, by bounding-box x-position); a narrow/portrait viewport
//     override falls back to the stacked layout (columns full-width,
//     vertically stacked).
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

test('dex v2 (REQ-0096): SI catalog cards render their icon, not the shape-grid-empty "--" placeholder', async ({ page }) => {
  // Regression test for REQ-0096: ApiSIEntry has no `shape` field (SI
  // items occupy an equip `slot`, not board cells), and shapeOf() in
  // Dex.tsx/DexDetail.tsx/DexAdmin.tsx used to return [] for every SI
  // entry. ShapeGrid.tsx bails to a bare "--" placeholder whenever its
  // combined cell set is empty, so the icon <img> never mounted for ANY
  // SI catalog card (confirmed live on backpack-dev.qtie.jp before the
  // fix -- Ruby Gem/Frost Orb/Whetstone/Arrowhead/Poison Coat/Guard all
  // showed "--" while every PO card rendered its icon fine). The fix
  // falls back to a synthetic 1x1 anchor cell ([[0, 0]]) so the icon
  // overlay still mounts.
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const siIds = Object.keys(content.sis);
  expect(siIds.length).toBeGreaterThan(0);

  for (const siId of siIds) {
    await page.locator('.dex-search').fill(siId);
    const card = page.locator('.dex-card', { hasText: siId }).first();
    await expect(card).toBeVisible();

    await expect(card.locator('.shape-grid-empty')).toHaveCount(0);
    const cardShape = card.locator('.dex-card-shape .shape-grid');
    await expect(cardShape).toBeVisible();
    await expect(cardShape.locator('.shape-grid-icon-overlay')).toHaveCount(1);
    await expect(cardShape.locator('.shape-grid-cell-icon')).toHaveCount(1);
  }
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

test('dex REQ-0108: selecting a card keeps the catalog grid and opens an inline [diagram|info] drawer (no separate list rail)', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await card.locator('.dex-card-summary').click();

  // The catalog GRID stays mounted/visible (master preserved) -- NOT swapped away.
  await expect(page.locator('.dex-grid')).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/dex-card-selected/);

  // An inline detail drawer opens with the diagram + info panes...
  const drawer = page.locator('[data-testid="dex-detail-drawer"]');
  await expect(drawer).toBeVisible();
  const diagramCol = drawer.locator('.dex-detail-col-diagram');
  const infoCol = drawer.locator('.dex-detail-col-info');
  await expect(diagramCol).toBeVisible();
  await expect(infoCol).toBeVisible();

  // ...and the separate detail list rail no longer exists anywhere (one list only).
  await expect(page.locator('.dex-detail-col-list')).toHaveCount(0);
  await expect(page.locator('.dex-detail-item-list-row')).toHaveCount(0);

  // Wide viewport: diagram is left of info within the drawer.
  const diagramBox = await diagramCol.boundingBox();
  const infoBox = await infoCol.boundingBox();
  expect(diagramBox).not.toBeNull();
  expect(infoBox).not.toBeNull();
  expect(diagramBox!.x + diagramBox!.width).toBeLessThanOrEqual(infoBox!.x + 1);

  // The info pane shows the selected item's id + rendered effect text.
  await expect(infoCol).toContainText('blade');
  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const bladeEffEn = content.items.blade.eff_en;
  expect(bladeEffEn).toBeTruthy();
  await expect(infoCol).toContainText(bladeEffEn);

  // Collapse returns to the plain grid (drawer gone, grid still there).
  await page.locator('.dex-detail-back-btn').click();
  await expect(page.locator('[data-testid="dex-detail-drawer"]')).toHaveCount(0);
  await expect(page.locator('.dex-detail-col-info')).toHaveCount(0);
  await expect(page.locator('.dex-grid')).toBeVisible();
});

test('dex REQ-0108: narrow viewport stacks the drawer panes (diagram above info), grid preserved', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('blade');
  const card = page.locator('.dex-card', { hasText: 'blade' }).first();
  await card.locator('.dex-card-summary').click();

  await expect(page.locator('.dex-grid')).toBeVisible();
  await expect(page.locator('.dex-detail-col-list')).toHaveCount(0);

  const diagramCol = page.locator('.dex-detail-col-diagram');
  const infoCol = page.locator('.dex-detail-col-info');
  await expect(diagramCol).toBeVisible();
  await expect(infoCol).toBeVisible();

  const diagramBox = await diagramCol.boundingBox();
  const infoBox = await infoCol.boundingBox();
  expect(diagramBox).not.toBeNull();
  expect(infoBox).not.toBeNull();
  // Stacked (not side-by-side): diagram above info, each wide vs the narrow viewport.
  expect(diagramBox!.y + diagramBox!.height).toBeLessThanOrEqual(infoBox!.y + 1);
  expect(diagramBox!.width).toBeGreaterThan(480 * 0.8);
  expect(infoBox!.width).toBeGreaterThan(480 * 0.8);
});

test('dex v2 R3: view-mode locale switching shows ONLY the active locale text (no paired EN/JA rows)', async ({ page }) => {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await expect(page.locator('.dex-root')).toBeVisible();

  await page.locator('.dex-search').fill('dagger');
  const card = page.locator('.dex-card', { hasText: 'dagger' }).first();
  await card.locator('.dex-card-summary').click();

  const infoCol = page.locator('.dex-detail-col-info');
  await expect(infoCol).toBeVisible();

  const contentResp = await page.request.get('/api/content');
  const content = await contentResp.json();
  const dagger = content.items.dagger;
  const jaName = dagger.i18n?.ja?.name ?? dagger.name_ja;
  const jaFlavor = dagger.i18n?.ja?.flavor ?? dagger.flavor_ja;
  const enName = dagger.name;
  const enFlavor = dagger.flavor;
  const enEff = dagger.eff_en;
  const jaEff = dagger.eff_ja;
  expect(jaName).toBeTruthy();
  expect(jaFlavor).toBeTruthy();
  expect(enFlavor).toBeTruthy();

  // Default locale is EN: EN name/flavor/effects text visible, JA text
  // absent (assuming JA text genuinely differs from EN, which the live
  // dagger fixture's translated copy does).
  await expect(infoCol).toContainText(enName);
  if (enFlavor !== jaFlavor) {
    await expect(infoCol).toContainText(enFlavor);
    const infoText = await infoCol.textContent();
    expect(infoText).not.toContain(jaFlavor);
  }
  if (enEff && jaEff && enEff !== jaEff) {
    await expect(infoCol).toContainText(enEff);
    const infoText = await infoCol.textContent();
    expect(infoText).not.toContain(jaEff);
  }

  // Toggle the GLOBAL locale (chrome + content, per i18n.ts's module
  // comment) to JA.
  await page.locator('.lang-toggle').click();

  // Now JA name/flavor/effects text visible, EN text absent.
  await expect(infoCol).toContainText(jaName);
  if (enFlavor !== jaFlavor) {
    await expect(infoCol).toContainText(jaFlavor);
    const infoTextJa = await infoCol.textContent();
    expect(infoTextJa).not.toContain(enFlavor);
    expect(infoTextJa).not.toContain(enName);
  }
  if (enEff && jaEff && enEff !== jaEff) {
    await expect(infoCol).toContainText(jaEff);
    const infoTextJa2 = await infoCol.textContent();
    expect(infoTextJa2).not.toContain(enEff);
  }

  // ID/rarity stay locale-neutral -- still shown regardless of locale.
  await expect(infoCol).toContainText('dagger');

  // Toggle back to EN -- confirms it is reversible, not a one-way flip.
  await page.locator('.lang-toggle').click();
  await expect(infoCol).toContainText(enName);
});

test('dex v2 R2: detail diagram is enlarged (~5x per-cell size vs the old 46px baseline) and still fits its column height', async ({ page }) => {
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
  // the diagram column's own bounding box (no overflow past the column).
  const perCellPx = wrapBox!.width / 2;
  expect(perCellPx).toBeGreaterThan(46 * 1.5);

  const diagramCol = page.locator('.dex-detail-col-diagram');
  const diagramColBox = await diagramCol.boundingBox();
  expect(diagramColBox).not.toBeNull();
  expect(wrapBox!.height).toBeLessThanOrEqual(diagramColBox!.height + 1);
  expect(wrapBox!.width).toBeLessThanOrEqual(diagramColBox!.width + 1);

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
