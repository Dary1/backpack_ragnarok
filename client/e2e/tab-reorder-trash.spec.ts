// REQ-0032 -- tab drag-to-reorder (squad + inventory) + squad
// trash-drop-zone delete (E2E, real pointer input emulation via
// helpers.ts's drag()/bootApp(), NOT direct engine calls).
//
// Fixture: client/e2e/fixtures/tab-reorder-fixture.json --
//   - presets: "Alpha" (active, index 0, BP bp_alpha, no item refs),
//     "Bravo" (index 1, references BP bp_bravo (home: inventory page
//     "Bravo Home") + p900/blade -- shared with inventory page "Loot"'s
//     home, so p900 is yellow-tinted from Alpha's perspective and this
//     squad's delete is the one used to verify inventory-untouched
//     below), "Charlie" (index 2, empty).
//   - inventory pages: "Loot" (0, free-placed blade p900 at [5,5]),
//     "Gear" (1, free-placed dagger p901 at [3,3]), "Bravo Home" (2, homes
//     bp_bravo so Bravo's own BP is a proper reference like every other
//     canvas-resident uid under the REQ-0033 model), "4"/"5" empty.
//
// Drag emulation: helpers.ts's drag() (real page.mouse.move/down/up with
// multi-step intermediate moves) is built for board cells, so tab-row
// drags in this file roll their own multi-step pointer sequence directly
// against tab bounding boxes (see dragTab() below) -- same underlying
// technique (down, N intermediate moves past the 8px/600ms gesture
// thresholds, up), just targeting tab buttons instead of canvas cells.
//
// Profile hygiene: every test in this file loads its OWN fixture via PUT
// before booting (loadFixtureAndBoot), so there is no shared mutable
// "default" profile state carried between tests in THIS file. However,
// since every test in the suite writes to the SAME 'default' profile
// (same convention as every other spec here), the LAST test in this file
// restores the profile back to a neutral baseline (squad-fixture.json,
// the same fixture squad-switch.spec.ts/long-press-rename.spec.ts
// already treat as their own shared starting point) so no leftover
// tab-reorder-fixture state lingers for other spec files that might run
// after this one in the same suite invocation.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { autoSaveAndFetch, loadFixtureFileAndBoot } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/tab-reorder-fixture.json', import.meta.url);
const NEUTRAL_FIXTURE_PATH = new URL('./fixtures/squad-fixture.json', import.meta.url);


/** Drags a tab element from its own center to another tab's center (or an
 * arbitrary point, e.g. the trash zone), with enough intermediate moves
 * past LongPressTabs' 8px move-tolerance to register as a drag rather
 * than a long-press/click -- mirrors helpers.ts's drag() but for DOM
 * tab-button targets instead of canvas cells. */
async function dragTab(
  page: Page,
  grab: { x: number; y: number },
  drop: { x: number; y: number },
  steps = 8
): Promise<void> {
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(grab.x + (drop.x - grab.x) * t, grab.y + (drop.y - grab.y) * t, { steps: 1 });
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function tabCenter(page: Page, selector: string, index: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator(selector).nth(index).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function tintSets(page: Page): Promise<{ red: string[]; yellow: string[]; canvasYellow: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __backpackDebug: { tintSets: () => { red: Set<string>; yellow: Set<string>; canvasYellow: Set<string> } } };
    const t = w.__backpackDebug.tintSets();
    return { red: [...t.red], yellow: [...t.yellow], canvasYellow: [...t.canvasYellow] };
  });
}

async function usageOf(page: Page, uid: string): Promise<number[]> {
  return page.evaluate((u) => {
    const w = window as unknown as { __backpackDebug: { usageOf: (uid: string) => number[] } };
    return w.__backpackDebug.usageOf(u);
  }, uid);
}

// REQ-0247: test 4 ('long-press still triggers rename after DnD wiring')
// was deleted as a strict subset of long-press-rename.spec.ts's 'squad
// tab: long-press renames inline, persists after reload via auto-save':
// same locator (.squad-tab nth(0)), same longPress -> rename-input ->
// fill -> Enter -> autoSaveAndFetch -> presets.names[0] flow, and that
// one additionally proves the rename survives a reload. The 'after DnD
// wiring' framing named no separate condition: the reorder wiring is
// unconditional in the shipped app, so long-press-rename.spec.ts has
// always exercised long-press WITH it present. Tests 1/2/5/6/7/8 keep
// the reorder + trash-delete coverage this file exists for.
test.describe('REQ-0032 tab reorder + squad trash-delete', () => {
  test('1. drag squad tab to reorder: order + contents change, persists after reload', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    await expect(page.locator('.squad-tab')).toHaveCount(3);
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Alpha');
    await expect(page.locator('.squad-tab').nth(1)).toHaveText('Bravo');
    await expect(page.locator('.squad-tab').nth(2)).toHaveText('Charlie');

    // Drag "Alpha" (index 0, the ACTIVE squad) to the end (index 2).
    const from = await tabCenter(page, '.squad-tab', 0);
    const to = await tabCenter(page, '.squad-tab', 2);
    await dragTab(page, from, { x: to.x + 40, y: to.y });

    // New order: Bravo, Charlie, Alpha -- active follows Alpha to index 2.
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Bravo');
    await expect(page.locator('.squad-tab').nth(1)).toHaveText('Charlie');
    await expect(page.locator('.squad-tab').nth(2)).toHaveText('Alpha');
    await expect(page.locator('.squad-tab-active')).toHaveText('Alpha');

    let canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(canvas.presets.active).toBe(2);
    // Alpha's own content (bp_alpha) is still the live top-level canvas.
    expect(canvas.bps.some((b: any) => b.id === 'bp_alpha')).toBe(true);
    // Bravo's content (bp_bravo + blade reference) moved WITH it to store[0].
    expect(canvas.presets.store[0].bps.some((b: any) => b.id === 'bp_bravo')).toBe(true);
    expect(canvas.presets.store[0].pos.some((p: any) => p.uid === 'p900')).toBe(true);

    // Reload and confirm the new order + active squad persisted via auto-save.
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Bravo');
    await expect(page.locator('.squad-tab').nth(1)).toHaveText('Charlie');
    await expect(page.locator('.squad-tab').nth(2)).toHaveText('Alpha');
    await expect(page.locator('.squad-tab-active')).toHaveText('Alpha');
    canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });

  test('2. drag inventory tab to reorder: the page and its item contents follow the tab', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    await expect(page.locator('.inv-tab')).toHaveCount(5);
    await expect(page.locator('.inv-tab').nth(0)).toHaveText('Loot');
    await expect(page.locator('.inv-tab').nth(1)).toHaveText('Gear');

    // Drag "Loot" (page 0, holding blade p900) to land after "Gear" (page 1).
    const from = await tabCenter(page, '.inv-tab', 0);
    const to = await tabCenter(page, '.inv-tab', 1);
    await dragTab(page, from, { x: to.x + 40, y: to.y });

    await expect(page.locator('.inv-tab').nth(0)).toHaveText('Gear');
    await expect(page.locator('.inv-tab').nth(1)).toHaveText('Loot');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.inv.names[0]).toBe('Gear');
    expect(canvas.inv.names[1]).toBe('Loot');
    // "Loot"'s own contents (blade p900) moved WITH it to page index 1.
    expect(canvas.inv.pages[1].pos.some((p: any) => p.uid === 'p900')).toBe(true);
    expect(canvas.inv.pages[0].pos.some((p: any) => p.uid === 'p901')).toBe(true); // Gear's dagger now at page 0
  });

  test('3. a plain click still switches tabs after DnD wiring (no regression)', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    // Short click (well under the 600ms long-press / never crosses the
    // 8px move tolerance) on squad tab "Bravo" (index 1) must switch to it.
    const box = (await page.locator('.squad-tab').nth(1).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(200);

    await expect(page.locator('.squad-tab-active')).toHaveText('Bravo');
    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
  });


  test('5. trash-drop-zone appears ONLY while dragging a SQUAD tab, never for an inventory tab', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);

    // Start dragging a SQUAD tab -- trash zone must appear.
    const squadBox = (await page.locator('.squad-tab').nth(1).boundingBox())!;
    const px = squadBox.x + squadBox.width / 2;
    const py = squadBox.y + squadBox.height / 2;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px + 20, py, { steps: 1 });
    await page.waitForTimeout(50);
    await expect(page.locator('.squad-trash-zone')).toHaveCount(1);
    // Release away from the trash zone (plain reorder-cancel-ish drop) to end the drag cleanly.
    await page.mouse.move(px + 60, py, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await expect(page.locator('.squad-trash-zone')).toHaveCount(0);

    // Start dragging an INVENTORY tab -- trash zone must NEVER appear.
    const invBox = (await page.locator('.inv-tab').nth(0).boundingBox())!;
    const ix = invBox.x + invBox.width / 2;
    const iy = invBox.y + invBox.height / 2;
    await page.mouse.move(ix, iy);
    await page.mouse.down();
    await page.mouse.move(ix + 20, iy, { steps: 1 });
    await page.waitForTimeout(50);
    await expect(page.locator('.squad-trash-zone')).toHaveCount(0);
    await page.mouse.move(ix + 60, iy, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await expect(page.locator('.squad-trash-zone')).toHaveCount(0);
  });

  test('6. delete a squad via trash-drop: its references vanish, inventory homes/positions are completely untouched', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);

    // Sanity before delete: p900 (blade) is used by Bravo (index 1) --
    // NOT by Alpha (active, index 0) -- so it is yellow (shared with an
    // OTHER squad) but not red from Alpha's perspective.
    let usage = await usageOf(page, 'p900');
    expect(usage).toContain(1);
    let tints = await tintSets(page);
    expect(tints.yellow).toContain('p900');
    expect(tints.red).not.toContain('p900');

    const invCanvasBefore = (await autoSaveAndFetch(page)).inv;
    // REQ-0042: this fixture predates the tms:[] field engine.js's
    // migrateStateV2 now defensively backfills onto every inventory page
    // -- the "before" snapshot above is read straight off whatever raw
    // JSON is currently persisted (fetchSavedCanvas is a plain GET, no
    // migration applied), while the "after" snapshot below reflects a
    // REAL client round-trip (the drag-drop auto-save), which DOES run
    // through migrateState first. Backfilling tms:[] here keeps this
    // test's actual intent (inventory homes/positions/pages are
    // COMPLETELY untouched by a squad delete) accurate without being
    // tripped up by an unrelated, expected schema-evolution field.
    for (const pg of invCanvasBefore.pages) if (!pg.tms) pg.tms = [];

    // Drag "Bravo" (index 1, non-active) onto the trash zone (centered
    // over the Canvas board).
    const bravoBox = (await page.locator('.squad-tab').nth(1).boundingBox())!;
    const canvasBoardBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    const dropX = canvasBoardBox.x + canvasBoardBox.width / 2;
    const dropY = canvasBoardBox.y + canvasBoardBox.height / 2;
    await page.mouse.move(bravoBox.x + bravoBox.width / 2, bravoBox.y + bravoBox.height / 2);
    await page.mouse.down();
    const steps = 8;
    const gx = bravoBox.x + bravoBox.width / 2;
    const gy = bravoBox.y + bravoBox.height / 2;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(gx + (dropX - gx) * t, gy + (dropY - gy) * t, { steps: 1 });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Bravo is gone; 2 squads remain (Alpha, Charlie).
    await expect(page.locator('.squad-tab')).toHaveCount(2);
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Alpha');
    await expect(page.locator('.squad-tab').nth(1)).toHaveText('Charlie');

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names).toEqual(['Alpha', 'Charlie']);
    // p900's reference from the deleted squad is gone (no squad uses it anymore).
    usage = await usageOf(page, 'p900');
    expect(usage.length).toBe(0);
    tints = await tintSets(page);
    expect(tints.yellow).not.toContain('p900');
    // Inventory (all homes, positions, pages) is COMPLETELY untouched.
    expect(canvas.inv).toEqual(invCanvasBefore);
  });

  test('7. deleting the ACTIVE squad switches to the nearest remaining tab', async ({ page }) => {
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);
    // Switch active to Bravo (index 1) first.
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(200);
    await expect(page.locator('.squad-tab-active')).toHaveText('Bravo');

    // Drag Bravo (now active, index 1, NOT the last slot) onto the trash zone.
    const bravoBox = (await page.locator('.squad-tab').nth(1).boundingBox())!;
    const canvasBoardBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    const dropX = canvasBoardBox.x + canvasBoardBox.width / 2;
    const dropY = canvasBoardBox.y + canvasBoardBox.height / 2;
    const gx = bravoBox.x + bravoBox.width / 2;
    const gy = bravoBox.y + bravoBox.height / 2;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      await page.mouse.move(gx + (dropX - gx) * t, gy + (dropY - gy) * t, { steps: 1 });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Bravo (used to be index 1) is deleted; Charlie (used to be index 2)
    // slides into index 1 -- the "nearest remaining tab" (same index).
    await expect(page.locator('.squad-tab')).toHaveCount(2);
    await expect(page.locator('.squad-tab-active')).toHaveText('Charlie');
    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
    expect(canvas.presets.names[1]).toBe('Charlie');
  });

  test('8. attempting to delete the LAST remaining squad is refused (tab still present, count unchanged)', async ({ page }) => {
    // Collapse to exactly 1 squad first (delete Bravo then Charlie via
    // successive trash-drops), then attempt to delete Alpha -- must be
    // refused.
    await loadFixtureFileAndBoot(page, FIXTURE_PATH);

    async function trashDrop(tabIndex: number) {
      const box = (await page.locator('.squad-tab').nth(tabIndex).boundingBox())!;
      const canvasBoardBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
      const dropX = canvasBoardBox.x + canvasBoardBox.width / 2;
      const dropY = canvasBoardBox.y + canvasBoardBox.height / 2;
      const gx = box.x + box.width / 2;
      const gy = box.y + box.height / 2;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        await page.mouse.move(gx + (dropX - gx) * t, gy + (dropY - gy) * t, { steps: 1 });
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(300);
    }

    await trashDrop(1); // delete Bravo -- 2 remain (Alpha, Charlie)
    await expect(page.locator('.squad-tab')).toHaveCount(2);
    await trashDrop(1); // delete Charlie (now at index 1) -- 1 remains (Alpha)
    await expect(page.locator('.squad-tab')).toHaveCount(1);
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Alpha');

    // Attempt to delete the last remaining squad (Alpha) -- must be refused.
    await trashDrop(0);
    await expect(page.locator('.squad-tab')).toHaveCount(1);
    await expect(page.locator('.squad-tab').nth(0)).toHaveText('Alpha');
    await expect(page.locator('.squad-delete-refused')).toBeVisible();

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.names).toEqual(['Alpha']);

    // Restore the shared 'default' profile back to the neutral baseline
    // (squad-fixture.json) other specs in this suite treat as their own
    // starting point, so this file leaves no leftover tab-reorder-fixture
    // state behind for tests that run after it.
    const neutral = JSON.parse(readFileSync(NEUTRAL_FIXTURE_PATH, 'utf8'));
    await page.request.put('/api/profile/default/canvas', { data: neutral });
  });
});
