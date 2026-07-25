// REQ-0057 -- Ray Forecast Overlay ("weather map"), E2E.
//
// The REQ's own test plan for this layer: "toggle renders, formation switch
// updates, tooltip content, perf budget (< [TUNABLE 100ms] per recompute; 50 -> 100 on 2026-07-17 for live-roster content scale, REQ-0208 -- tightening tracked as REQ-0210)".
// All four are here, plus the two properties that make the overlay safe to
// ship rather than merely present:
//
//   - THE BOARD STAYS USABLE. The whole premise is that the map is readable
//     WHILE building, so a real drag with the overlay up must still land an
//     item. If that ever regresses, the overlay has eaten the editor -- and
//     no amount of "64 divs rendered" would tell us.
//   - IT NEVER PROMISES. REQ-0057: "label it 'expected pressure', never
//     'safe/unsafe' absolutes." Asserted as rendered text, because that line
//     is a design commitment, not decoration.
//
// The MATH is not tested here -- sim/tests/forecast_parity.cjs owns that
// (byte-equality against sim's own walkRay, plus the perf budget in node).
// This file tests the UI contract.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { autoSaveAndFetch, bootApp, cx, cy, drag } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url);

type Pg = import('@playwright/test').Page;

async function enableForecast(page: Pg) {
  await page.locator('[data-testid="forecast-toggle"]').click();
  await expect(page.locator('[data-testid="forecast-overlay"]')).toBeVisible();
  // 64 tinted cells -- one per canvas cell of the chosen squad's 8x8 box.
  await expect(page.locator('[data-testid="forecast-overlay"] .forecast-cell')).toHaveCount(64);
}

/** Every cell's expected-pressure figure, in canvas row-major order. */
function readPressures(page: Pg): Promise<number[]> {
  return page.locator('[data-testid="forecast-overlay"] .forecast-cell')
    .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-pressure'))));
}

test.describe('REQ-0057 ray forecast overlay', () => {
  test('toggle renders the heat map; off by default; every cell carries a real pressure figure', async ({ page }) => {
    await bootApp(page);

    // Off by default: the toggle exists, the map does not.
    const toggle = page.locator('[data-testid="forecast-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="forecast-overlay"]')).toHaveCount(0);

    await enableForecast(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const pressures = await readPressures(page);
    expect(pressures).toHaveLength(64);
    // Real numbers, not placeholders: all finite and >= 0, and NOT all equal.
    // A flat map would mean the ray walk never happened -- exactly the
    // failure a "renders 64 divs" assertion alone would sail straight past.
    for (const p of pressures) {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...pressures)).toBeGreaterThan(Math.min(...pressures));

    // The tint is normalised over [min,max], so the LEGEND is the only place
    // the absolute scale is visible. It must not lie about it.
    const legendMin = Number(await page.locator('[data-testid="forecast-legend-min"]').textContent());
    const legendMax = Number(await page.locator('[data-testid="forecast-legend-max"]').textContent());
    expect(legendMin).toBeCloseTo(Math.min(...pressures), 0);
    expect(legendMax).toBeCloseTo(Math.max(...pressures), 0);

    // Toggling off removes the map entirely (not merely hides it).
    await toggle.click();
    await expect(page.locator('[data-testid="forecast-overlay"]')).toHaveCount(0);
  });

  test('switching formation, then squad slot, re-walks the rays and changes the map', async ({ page }) => {
    await bootApp(page);
    await enableForecast(page);
    const before = (await readPressures(page)).join(',');

    // A different formation puts this squad's 8x8 box somewhere else on the
    // shared A1:Z18 field -- different geometry, therefore a different map.
    await page.locator('[data-testid="forecast-formation-select"]').selectOption('formation3');
    await expect.poll(async () => (await readPressures(page)).join(','), { timeout: 5000 }).not.toBe(before);

    // Same for the squad slot: unit1 and unit4 sit in different boxes.
    const afterFormation = (await readPressures(page)).join(',');
    await page.locator('[data-testid="forecast-slot-select"]').selectOption('unit4');
    await expect.poll(async () => (await readPressures(page)).join(','), { timeout: 5000 }).not.toBe(afterFormation);
  });

  test('changing dungeon level refetches the profiles and re-ranks the map', async ({ page }) => {
    await bootApp(page);
    await enableForecast(page);
    const atLevel1 = (await readPressures(page)).join(',');

    // dungen's packsForLevel grows the pack count with level, so a level-12
    // dungeon throws a different mix of rays.
    await page.locator('[data-testid="forecast-level-input"]').fill('12');
    await expect.poll(async () => (await readPressures(page)).join(','), { timeout: 10000 }).not.toBe(atLevel1);
  });

  test('hovering a cell floats a tooltip naming the top contributing skills', async ({ page }) => {
    await bootApp(page);
    await enableForecast(page);

    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    // cx/cy are the SAME PAD=38 / CELL=80 helpers every board spec uses.
    await page.mouse.move(box.x + cx(4), box.y + cy(4));

    const tip = page.locator('[data-testid="forecast-tip"]');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.forecast-tip-cell')).toHaveText('D4');
    await expect(page.locator('[data-testid="forecast-tip-dps"]')).toContainText(/[\d.]+/);

    // ...and WHICH skills are throwing it (REQ-0057: "per-cell tooltip (top
    // contributing skills)"). The names come from the live enemy roster, so
    // this is a real content read, not a stub.
    const items = tip.locator('.forecast-tip-item');
    expect(await items.count()).toBeGreaterThan(0);
    await expect(items.first().locator('.forecast-tip-src')).not.toBeEmpty();
    await expect(items.first().locator('.forecast-tip-skill')).not.toBeEmpty();
    await expect(items.first().locator('.forecast-tip-amt')).toContainText(/[\d.]+/);

    // Moving to another cell re-targets the tooltip.
    await page.mouse.move(box.x + cx(7), box.y + cy(2));
    await expect(tip.locator('.forecast-tip-cell')).toHaveText('G2');
  });

  test('the overlay is a lens, not a lid: a real drag still lands with the heat map up', async ({ page }) => {
    // THE regression this file exists to prevent. The forecast layer sits ON
    // TOP of the Pixi canvas; the moment it stops being pointer-events:none
    // it silently eats every board gesture, and the editor is dead while the
    // overlay is on. So: run baseline-smoke's own inventory->canvas drag,
    // unchanged, but with the weather map showing.
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    await page.request.put('/api/profile/default/canvas', { data: fixture });
    await bootApp(page);
    await enableForecast(page);

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // p200 (a free-placed hilt at inv page0 cell (4,4)) -> canvas BP
    // "gamma"'s free cell (6,3). Identical to baseline-smoke.spec.ts.
    await drag(
      page,
      { x: invBox.x + cx(4), y: invBox.y + cy(4) },
      { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) },
    );

    const canvas = await autoSaveAndFetch(page);
    const po = canvas.pos.find((p: { uid: string }) => p.uid === 'p200');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([6, 3]);

    // ...and the map is still there, still coherent, after the board changed.
    await expect(page.locator('[data-testid="forecast-overlay"] .forecast-cell')).toHaveCount(64);
  });

  test('the panel says "expected pressure", and refuses to say safe/unsafe', async ({ page }) => {
    await bootApp(page);
    await enableForecast(page);

    // REQ-0057: "Not a promise: forecast shows the DISTRIBUTION (jitter,
    // packs vary); label it 'expected pressure', never 'safe/unsafe'
    // absolutes." The legend label and the disclaimer ARE that commitment.
    await expect(page.locator('[data-testid="forecast-legend"]')).toContainText(/expected pressure/i);
    const disclaimer = page.locator('[data-testid="forecast-disclaimer"]').first();
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText(/distribution/i);
    await expect(disclaimer).toContainText(/not a promise/i);

    // ...and the words the REQ forbids appear nowhere in the forecast chrome.
    const panelText = (await page.locator('[data-testid="forecast-panel"]').innerText()).toLowerCase();
    expect(panelText).not.toMatch(/\bsafe\b/);
    expect(panelText).not.toMatch(/\bunsafe\b/);
  });

  test('perf budget: a recompute stays under [TUNABLE 100ms] in the real browser', async ({ page }) => {
    await bootApp(page);
    await enableForecast(page);

    // data-fold-ms is the REAL fold's own wall-clock, measured in the shipped
    // bundle on the shipped payload (pressure.ts stamps it) -- not a node
    // proxy and not a re-implementation. Force fresh recomputes by driving
    // the controls, and hold every one of them to the budget.
    const budget = async () => Number(
      await page.locator('[data-testid="forecast-overlay"]').getAttribute('data-fold-ms'),
    );

    expect(await budget()).toBeLessThan(100);

    // The heaviest case the UI can ask for: a high-level dungeon (more packs
    // -> more profiles -> more rays) on every slot of a formation.
    await page.locator('[data-testid="forecast-level-input"]').fill('20');
    await expect.poll(budget, { timeout: 10000 }).toBeGreaterThan(0);
    for (const slot of ['unit1', 'unit2', 'unit3', 'unit4']) {
      await page.locator('[data-testid="forecast-slot-select"]').selectOption(slot);
      await expect(page.locator('[data-testid="forecast-overlay"] .forecast-cell')).toHaveCount(64);
      expect(await budget()).toBeLessThan(100);
    }
  });

  // REQ-0304 (integration with REQ-0307): the sortie-page per-slot pressure summary
  // -- the formation picker that ranked the four slots by expected pressure -- rendered
  // on the dungeon DOSSIER via SlotPressureSummary. REQ-0304 removed the dungeon
  // picker/dossier by ratified design: the player no longer chooses or previews a dungeon
  // before entry (the server draws it), so that pre-entry per-dungeon summary is gone from
  // the UI, and this test is retired. The REQ-0057 canvas ray-forecast overlay (its other
  // half) stays covered by the tests above; a post-entry summary against the DRAWN dungeon
  // would be a separate follow-up, out of REQ-0304 scope.
});
