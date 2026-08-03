// REQ-0033 Phase 2 -- reference model E2E coverage (client adoption of
// Phase 1's engine work: usage tracking, red/yellow tints, squad
// independence). Fixture: client/e2e/fixtures/reference-model-fixture.json
// (8x8 layout):
//   - CANVAS (squad1, active at boot): one BP `canvas_bp1`, a 3x6
//     rectangle at origin [1,1] (absolute rows 1-3, cols 1-6), unit at
//     the (1,1) corner cell. Every OTHER cell in that rectangle is free
//     -- canvas requires BP-containment for any PO placement (canPlacePO
//     rejects "Dead Space"), so this is the landing zone for every
//     canvas-side PO drop in this spec.
//   - SQUAD2 (explicit in the fixture's `squads.store[1]`, NOT the
//     auto-materialized empty default): its OWN separate BP
//     `canvas_bp2`, same shape/origin, so squad2 can ALSO legally host
//     a PO reference (addSquad/migrateState never give a fresh squad
//     any BP by default -- this fixture pre-seeds squad2 specifically
//     so scenario 3 below has somewhere legal to drop onto).
//   - INVENTORY page0: a free-placed blade `p900` at [5,5]-[6,5] (used by
//     scenarios 1-5, 8), and a BP `homebp` at origin [1,1] (absolute
//     cells (1,1),(2,1),(1,2),(2,2),(3,1), unit at (3,1)) containing
//     two daggers `p910` (cells (1,1)-(2,1)) and `p911` (cells
//     (1,2)-(2,2)) -- used by scenarios 6-7's BP-exclusion coverage.
//     homebp's CANVAS drop target (origin [5,1]) is deliberately outside
//     canvas_bp1's [1,1]-[3,6] footprint (a transferred BP does not need
//     to land INSIDE another BP -- canTransferBP only checks bounds +
//     no-BP-overlap for the inv->canvas case, unlike a lone PO).
//   - No `squads` field would have let migrateState default squad2 to
//     EMPTY (no BPs) -- explicitly seeding `squads` here is what makes
//     scenario 3 (place the SAME blade into squad2's canvas) possible
//     at all.
//
// Assertion strategy: per the task's hook-choice guidance, every
// set-membership assertion below (red/yellow/canvasYellow/usageOf/
// isSquadIndependent) goes through window.__backpackDebug (wired in
// client/src/store.ts's boot(), see that file's REQ-0033 Phase 2 comment)
// rather than reverse-engineering PixiJS canvas pixel colors -- exact,
// zero-pixel-math, robust against any rendering/z-order/theme change.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { autoSaveAndFetch, bootApp, bx, by, cx, cy, drag } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/reference-model-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: Page): Promise<void> {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await bootApp(page);
}

async function tintSets(page: Page): Promise<{ red: string[]; yellow: string[]; canvasYellow: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __backpackDebug: { tintSets: () => { red: Set<string>; yellow: Set<string>; canvasYellow: Set<string> } } };
    const t = w.__backpackDebug.tintSets();
    return { red: [...t.red], yellow: [...t.yellow], canvasYellow: [...t.canvasYellow] };
  });
}

async function usedByCurrent(page: Page, uid: string): Promise<boolean> {
  return page.evaluate((u) => {
    const w = window as unknown as { __backpackDebug: { usedByCurrent: (uid: string) => boolean } };
    return w.__backpackDebug.usedByCurrent(u);
  }, uid);
}

async function isSquadIndependent(page: Page, n: number): Promise<boolean> {
  return page.evaluate((nn) => {
    const w = window as unknown as { __backpackDebug: { isSquadIndependent: (n: number) => boolean } };
    return w.__backpackDebug.isSquadIndependent(nn);
  }, n);
}

test.describe('reference model (REQ-0033 Phase 2)', () => {
  test('1. inv -> canvas creates a reference (blade stays in inventory, red tint)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Drop anchor (1,2): inside canvas_bp1, avoiding its (1,1) unit cell.
    await drag(
      page,
      { x: invBox.x + cx(5), y: invBox.y + cy(5) },
      { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) }
    );

    const canvas = await autoSaveAndFetch(page);
    // createRef, not a physical move: the blade is a NEW canvas reference
    // AND its home in inv.pages[0] is untouched.
    const canvasRef = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(canvasRef).toBeTruthy();
    expect(canvasRef.cell).toEqual([1, 2]);
    const home = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p900');
    expect(home).toBeTruthy();
    expect(home.cell).toEqual([5, 5]); // home never moved

    // squad1 (index 0) is current -> p900 is red in inventory.
    const tints = await tintSets(page);
    expect(tints.red).toContain('p900');
    expect(tints.yellow).not.toContain('p900');
    expect(await usedByCurrent(page, 'p900')).toBe(true);
  });

  test('2. switching squad re-tints inventory yellow (used by an OTHER squad)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await drag(
      page,
      { x: invBox.x + cx(5), y: invBox.y + cy(5) },
      { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) }
    );
    await autoSaveAndFetch(page);

    await expect(page.locator('.squad-tab')).toHaveCount(5);
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 2');

    const tints = await tintSets(page);
    expect(tints.yellow).toContain('p900'); // used by squad1, which is now an OTHER squad
    expect(tints.red).not.toContain('p900'); // NOT used by the now-current squad2
    expect(await usedByCurrent(page, 'p900')).toBe(false);
  });

  test('3. same blade placed into squad2 -> canvas shows canvasYellow (shared)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // squad1: place the blade.
    await drag(
      page,
      { x: invBox.x + cx(5), y: invBox.y + cy(5) },
      { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) }
    );
    await autoSaveAndFetch(page);

    // Switch to squad2 (has its OWN canvas_bp2, per the fixture).
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 2');

    // Place the SAME blade into squad2's canvas -- allowed, since
    // usedByCurrent is false for squad2 (only squad1 references it).
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: invBox2.x + cx(5), y: invBox2.y + cy(5) },
      { x: canvasBox2.x + cx(3), y: canvasBox2.y + cy(1) }
    );

    const canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
    const squad2Ref = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(squad2Ref).toBeTruthy();
    expect(squad2Ref.cell).toEqual([1, 3]);
    // squad1's reference (now inactive, in store[0]) must be untouched.
    expect(canvas.presets.store[0].pos.find((p: any) => p.uid === 'p900')?.cell).toEqual([1, 2]);

    const tints = await tintSets(page);
    expect(tints.canvasYellow).toContain('p900'); // on canvas now, shared with squad1
    expect(await usedByCurrent(page, 'p900')).toBe(true); // squad2 itself now references it
  });

  test('4. drag from squad2 canvas back to inventory removes only squad2s reference', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await drag(page, { x: invBox.x + cx(5), y: invBox.y + cy(5) }, { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) });
    await autoSaveAndFetch(page);
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(300);
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: invBox2.x + cx(5), y: invBox2.y + cy(5) }, { x: canvasBox2.x + cx(3), y: canvasBox2.y + cy(1) });
    await autoSaveAndFetch(page);

    // Drag the blade FROM squad2's canvas back TO inventory -- removeRef,
    // drop cell irrelevant.
    const invBox3 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox3 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: canvasBox3.x + cx(3), y: canvasBox3.y + cy(1) }, { x: invBox3.x + cx(1), y: invBox3.y + cy(1) });

    let canvas = await autoSaveAndFetch(page);
    expect(canvas.presets.active).toBe(1);
    expect(canvas.pos.some((p: any) => p.uid === 'p900')).toBe(false); // squad2 no longer references it
    const home = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p900');
    expect(home).toBeTruthy();
    expect(home.cell).toEqual([5, 5]); // home untouched, same cell as always

    // squad2 (current) no longer references p900 at all.
    expect(await usedByCurrent(page, 'p900')).toBe(false);

    // Switch back to squad1 -- its own reference is unaffected, and it
    // is no longer "shared" (squad2 dropped its reference), so p900 on
    // squad1's canvas should now read canvasYellow=false.
    await page.locator('.squad-tab').nth(0).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.squad-tab-active')).toHaveText('Squad 1');

    canvas = await autoSaveAndFetch(page);
    const squad1Ref = canvas.pos.find((p: any) => p.uid === 'p900');
    expect(squad1Ref).toBeTruthy();
    expect(squad1Ref.cell).toEqual([1, 2]); // squad1's own reference, unaffected throughout

    const tints = await tintSets(page);
    expect(tints.canvasYellow).not.toContain('p900'); // no longer shared -- squad2 dropped its ref
    expect(tints.red).toContain('p900'); // still used by squad1 itself (current)
  });

  test('5. red-rule rejection: a second inv -> canvas reference attempt for the same uid is a no-op', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await drag(page, { x: invBox.x + cx(5), y: invBox.y + cy(5) }, { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) });
    await autoSaveAndFetch(page);
    expect(await usedByCurrent(page, 'p900')).toBe(true);

    // Attempt a SECOND inv -> canvas reference for the SAME uid, into a
    // different (empty, still-legal-geometrically) cell in canvas_bp1 --
    // must be rejected by the red rule regardless of geometric fit.
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: invBox2.x + cx(5), y: invBox2.y + cy(5) }, { x: canvasBox2.x + cx(4), y: canvasBox2.y + cy(1) });

    const canvas = await autoSaveAndFetch(page);
    // Exactly one reference to p900 on squad1's canvas -- no duplicate
    // was created, and the original reference is unchanged.
    const refs = canvas.pos.filter((p: any) => p.uid === 'p900');
    expect(refs.length).toBe(1);
    expect(refs[0].cell).toEqual([1, 2]);
    // Home also unaffected.
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p900')?.cell).toEqual([5, 5]);
  });

  test('6. BP transfer inv -> canvas excludes a PO already referenced by the current squad', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Pre-reference p910 (one of homebp's two contained daggers) into the
    // CURRENT squad directly (independent of the BP) -- anchor (2,4)
    // inside canvas_bp1 (rows 1-3), so bpReferenceSet must exclude it
    // when the BP itself is transferred below.
    await drag(page, { x: invBox.x + cx(1), y: invBox.y + cy(1) }, { x: canvasBox.x + cx(4), y: canvasBox.y + cy(2) });
    let canvas = await autoSaveAndFetch(page);
    expect(canvas.pos.find((p: any) => p.uid === 'p910')?.cell).toEqual([2, 4]);
    expect(await usedByCurrent(page, 'p910')).toBe(true);
    expect(await usedByCurrent(page, 'p911')).toBe(false);

    // Now drag the BP itself from inventory to canvas, landing at origin
    // [5,1] -- deliberately OUTSIDE canvas_bp1's [1,1]-[3,6] footprint (a
    // transferred BP does not need to land inside another BP).
    //
    // REQ-0290: this used to grab the unit SEAT (home-absolute [3,1], i.e.
    // origin [1,1] + unit off [2,0]) and drop on (7,1). The seat is inert now,
    // so the grab moved to the ✥ badge -- which anchors on the BP's TOP-LEFT
    // cell [1,1], NOT the seat. beginDrag takes grabOff = grabCell - origin
    // (BoardRenderer.beginDrag), so grabOff went [2,0] -> [0,0] and the DROP
    // cell must absorb exactly that difference: (7,1) -> (5,1). Same landing
    // origin [5,1], so every assertion below is unchanged. The badge wins the
    // hit test over p910 sitting in the same cell because gBadges draws above
    // gItems (REQ-0042's whole reason for putting it there).
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: invBox2.x + bx(1), y: invBox2.y + by(1) }, { x: canvasBox2.x + cx(1), y: canvasBox2.y + cy(5) });

    canvas = await autoSaveAndFetch(page);
    const bpRef = canvas.bps.find((b: any) => b.id === 'homebp');
    expect(bpRef).toBeTruthy();
    expect(bpRef.origin).toEqual([5, 1]);
    // p911 (not previously referenced) travelled WITH the BP (delta from
    // home origin [1,1] to new origin [5,1] is [4,0]; p911's home cell
    // [1,2] -> [5,2]).
    const p911Ref = canvas.pos.find((p: any) => p.uid === 'p911');
    expect(p911Ref).toBeTruthy();
    expect(p911Ref.cell).toEqual([5, 2]);
    // p910 was EXCLUDED (already referenced by the current squad before
    // this transfer) -- the BP arrived MINUS that one PO; p910's existing
    // (pre-transfer) reference at [2,4] is untouched, no second reference
    // was created for it by the BP transfer.
    const p910Refs = canvas.pos.filter((p: any) => p.uid === 'p910');
    expect(p910Refs.length).toBe(1);
    expect(p910Refs[0].cell).toEqual([2, 4]);
    // Home (inv.pages[0]) completely untouched by the whole operation.
    const homeBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'homebp');
    expect(homeBp.origin).toEqual([1, 1]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p910')?.cell).toEqual([1, 1]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p911')?.cell).toEqual([1, 2]);
  });

  test('7. BP canvas -> inventory removes the BP + nested non-excluded PO references; home untouched', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Transfer homebp (with both p910+p911, no pre-exclusion this time)
    // inv -> canvas at origin [5,1] (outside canvas_bp1's footprint).
    // REQ-0290: ✥ badge at the BP's top-left cell [1,1] instead of the (now
    // inert) seat at [3,1]; grabOff [2,0] -> [0,0], so the drop follows from
    // (7,1) to (5,1) and the landing origin is unchanged. See test 6.
    await drag(page, { x: invBox.x + bx(1), y: invBox.y + by(1) }, { x: canvasBox.x + cx(1), y: canvasBox.y + cy(5) });
    let canvas = await autoSaveAndFetch(page);
    expect(canvas.bps.find((b: any) => b.id === 'homebp')).toBeTruthy();
    expect(canvas.pos.find((p: any) => p.uid === 'p910')).toBeTruthy();
    expect(canvas.pos.find((p: any) => p.uid === 'p911')).toBeTruthy();

    // Drag it back canvas -> inventory. The drop cell is irrelevant here (a
    // canvas -> inventory drag REMOVES the reference; there is nothing to
    // place), so only the grab moved: REQ-0290 retired the seat at absolute
    // [7,1], and the ✥ badge sits on the BP's top-left cell, absolute [5,1].
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: canvasBox2.x + bx(1), y: canvasBox2.y + by(5) }, { x: invBox2.x + cx(7), y: invBox2.y + cy(7) });

    canvas = await autoSaveAndFetch(page);
    // Cascade removal: BP reference + both nested PO references gone from canvas.
    expect(canvas.bps.some((b: any) => b.id === 'homebp')).toBe(false);
    expect(canvas.pos.some((p: any) => p.uid === 'p910')).toBe(false);
    expect(canvas.pos.some((p: any) => p.uid === 'p911')).toBe(false);
    // Home completely intact throughout -- same cells, same shape, as the
    // ORIGINAL fixture (never touched by either transfer direction).
    const homeBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'homebp');
    expect(homeBp).toBeTruthy();
    expect(homeBp.origin).toEqual([1, 1]);
    expect(homeBp.shape).toEqual([[0, 0], [1, 0], [0, 1], [1, 1], [2, 0]]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p910')?.cell).toEqual([1, 1]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p911')?.cell).toEqual([1, 2]);
  });

  test('8. isSquadIndependent: a squad with zero yellow-tinted items reports true', async ({ page }) => {
    await loadFixtureAndBoot(page);
    // Freshly booted, untouched fixture: squad1 (current, index 0) has
    // only its own canvas_bp1 -- no SHARED uid with any other squad yet
    // -- vacuously/actually independent.
    expect(await isSquadIndependent(page, 0)).toBe(true);

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Place the blade into squad1 -- still independent (nothing ELSE
    // references it yet).
    await drag(page, { x: invBox.x + cx(5), y: invBox.y + cy(5) }, { x: canvasBox.x + cx(2), y: canvasBox.y + cy(1) });
    await autoSaveAndFetch(page);
    expect(await isSquadIndependent(page, 0)).toBe(true);

    // Switch to squad2 and reference the SAME blade there too -- now
    // BOTH squad1 and squad2 share p900, so NEITHER is independent.
    await page.locator('.squad-tab').nth(1).click();
    await page.waitForTimeout(300);
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: invBox2.x + cx(5), y: invBox2.y + cy(5) }, { x: canvasBox2.x + cx(3), y: canvasBox2.y + cy(1) });
    await autoSaveAndFetch(page);

    expect(await isSquadIndependent(page, 1)).toBe(false); // squad2 (current) shares p900 with squad1
    expect(await isSquadIndependent(page, 0)).toBe(false); // squad1 (inactive) also shares p900 with squad2

    // squad3 (index 2), never touched, remains independent (its own
    // empty canvas -- migrateState's default -- shares nothing).
    expect(await isSquadIndependent(page, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// REQ-0287 -- ownership ribbons (shared-usage visibility). Asserts the
// per-render probe seam (BoardRenderer.usageRibbonProbe, published per
// board via usageRibbonProbe.ts and read through __backpackDebug) rather
// than reverse-engineering PixiJS pixels -- same hook doctrine as the
// tint-set assertions above. Fixture: a PO (p900) referenced by THREE
// squads and a BP (sharedbp) referenced by two, so the >=2 share-count,
// the both-boards tr ribbon, the inventory-only tl ribbon, and the
// tooltip listing are all provable at boot with no drag choreography.
// ---------------------------------------------------------------------
interface RibbonEntry { uid: string; corner: 'tr' | 'tl'; count: number | null }

async function ribbonProbe(page: Page, boardKey: string): Promise<RibbonEntry[]> {
  return page.evaluate((k) => {
    const w = window as unknown as { __backpackDebug: { usageRibbonProbe: (bk: string) => RibbonEntry[] } };
    return w.__backpackDebug.usageRibbonProbe(k);
  }, boardKey);
}

async function loadReq0287AndBoot(page: Page): Promise<void> {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/req0287-shared-fixture.json', import.meta.url), 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fx });
  await bootApp(page);
  await page.waitForTimeout(300);
}

test.describe('REQ-0287 ownership ribbons', () => {
  test('a. shared PO: tr ribbon (count>=2) on BOTH boards; tl only on inventory', async ({ page }) => {
    await loadReq0287AndBoot(page);
    const canvasR = (await ribbonProbe(page, 'canvas')).filter((e) => e.uid === 'p900');
    const invR = (await ribbonProbe(page, 'inv:0')).filter((e) => e.uid === 'p900');
    // p900 is used by squads 0,1,2 -> from the current squad (0) view, 2 OTHER
    // squads hold it -> tr ribbon carries the count 2, on BOTH boards.
    expect(canvasR).toContainEqual({ uid: 'p900', corner: 'tr', count: 2 });
    expect(invR).toContainEqual({ uid: 'p900', corner: 'tr', count: 2 });
    // Canvas NEVER shows the self/red (tl) ribbon; the inventory board does.
    expect(canvasR.some((e) => e.corner === 'tl')).toBe(false);
    expect(invR).toContainEqual({ uid: 'p900', corner: 'tl', count: null });
  });

  test('b. shared BP: tr ribbon on the canvas, count null (one other squad)', async ({ page }) => {
    await loadReq0287AndBoot(page);
    const canvasR = await ribbonProbe(page, 'canvas');
    // sharedbp is on squads 0 and 1 -> exactly ONE other squad -> tr, no count.
    expect(canvasR).toContainEqual({ uid: 'sharedbp', corner: 'tr', count: null });
  });

  test('c. tooltip "Used by" lists the sharing squads, current first + marked', async ({ page }) => {
    await loadReq0287AndBoot(page);
    // Tap p900 on the CANVAS board (whitelisted by FloatingItemTip's own
    // outside-tap dismissal), where squad 1 references it at cell [1,2].
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await page.mouse.click(canvasBox.x + cx(2), canvasBox.y + cy(1));
    const usage = page.locator('[data-testid="item-tip-usage"]');
    await expect(usage).toBeVisible();
    const txt = (await usage.textContent()) ?? '';
    expect(txt).toContain('Used by');
    expect(txt).toContain('Squad 1');
    expect(txt).toContain('Squad 2');
    expect(txt).toContain('Squad 3');
    expect(txt).toContain('(current)'); // the active squad (Squad 1) is marked
  });

  test('d. no-regression: an unshared, unreferenced profile draws zero ribbons', async ({ page }) => {
    await loadFixtureAndBoot(page); // standard reference-model fixture, untouched
    await page.waitForTimeout(300);
    const canvasR = await ribbonProbe(page, 'canvas');
    const invR = await ribbonProbe(page, 'inv:0');
    // Core no-regression: nothing is shared, so NO shared (tr) ribbon appears
    // on either board. Self/tl ribbons legitimately mark current-squad usage,
    // so the guard is on the shared channel the feature actually adds.
    expect(canvasR.filter((e) => e.corner === 'tr'), `canvas probe: ${JSON.stringify(canvasR)}`).toHaveLength(0);
    expect(invR.filter((e) => e.corner === 'tr'), `inv probe: ${JSON.stringify(invR)}`).toHaveLength(0);
  });
});
