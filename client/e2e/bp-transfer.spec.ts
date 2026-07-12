// REQ-0031 Phase A -- Bug 1: BP inventory<->canvas transfer.
//
// Root cause (confirmed via live reproduction + CDP-captured evidence, not
// just code reading): BoardRenderer.onGlobalPointerMove is wired per-board
// via `this.app.stage.on('globalpointermove', ...)`, but PixiJS's
// EventSystem attaches its OWN native `pointermove` listener on
// `document` itself (see node_modules/pixi.js's EventSystem.addEvents:
// `globalThis.document.addEventListener('pointermove', this._onPointerMove,
// true)`), NOT scoped to that Application's own <canvas> bounds. Since the
// canvas board and the inventory board are TWO independent PixiJS
// Applications (REQ-0030 Phase 2), every single mouse move during a drag
// fires `globalpointermove` on BOTH boards' stages -- including whichever
// board the pointer is NOT physically over. That board maps the pointer's
// (foreign) screen coordinates into ITS OWN local cell space, computes a
// (meaningless) cell, and unconditionally calls updateCarry(), which can
// CLOBBER a `carry.drop` the correct board had just set correctly moments
// earlier for the SAME native event. Listener registration order made
// this a real ~50% failure-rate race depending on drag speed/sample
// count (confirmed via 16 repeated identical rapid-fire drag attempts
// pre-fix: exactly the back half failed every time, matching a
// last-listener-wins race, not random noise).
//
// Fix (client/src/board/BoardRenderer.ts's onGlobalPointerMove): a board
// only acts as the authority for a given pointermove event when the
// pointer is ACTUALLY within its own canvas's current
// getBoundingClientRect(); otherwise it clears its own ghost/target
// visuals but does not touch `carry.drop`, leaving that decision to
// whichever board's handler for the SAME event finds the pointer
// genuinely inside its own bounds.
//
// This engine-level legality itself was ALREADY CORRECT (verified via a
// direct mock-src/engine.js sanity script before ever touching the
// client: canTransferBP() and transferBP() both behaved exactly as
// specified for the empty-BP, contents-carrying, and overlap-rejection
// cases) -- so no engine changes were needed or made; this is a pure
// client interaction-layer fix.
//
// REQ-0033 Phase 2 update: tests 1-3 below were written against the
// PRE-REQ-0033 "physicality" transfer model (inv->canvas PHYSICALLY
// removed the BP from inv.pages[0]; canvas->inv physically removed it
// from canvas.bps). Phase 1 (mock-src/engine.js) replaced that with the
// reference model: inv->canvas now CREATES A REFERENCE (the home stays
// in inv.pages[0] untouched, forever, regardless of how many squads
// reference it) and canvas->inv now REMOVES A REFERENCE (the home was
// never touched to begin with -- there is nothing to "put back", the
// item was always sitting right there in inventory). Assertions below
// were updated accordingly: every place that used to assert "the BP is
// GONE from inv.pages[0].bps after a transfer to canvas" now asserts "the
// BP is STILL in inv.pages[0].bps, unchanged, AND also now present in
// canvas.bps as an independent reference" -- and every place that used to
// assert "the BP reappeared in inv.pages[0].bps after a transfer back"
// now simply confirms canvas.bps no longer references it (the home was
// there the whole time). Test 4 (illegal overlap rejection) is UNCHANGED
// -- a rejected transfer still leaves both sides exactly as they were,
// which is equally true under either model.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { autoSaveAndFetch, bootApp, cx, cy, drag } from './helpers';

const FIXTURE_PATH = new URL('./fixtures/bp-transfer-fixture.json', import.meta.url);

// REQ-0031 Phase B: Save/Load buttons are retired -- loadFixtureAndBoot no
// longer clicks anything to persist; saveAndFetch is now autoSaveAndFetch
// (waits out the auto-save debounce, then reads the profile back), since
// every mutation in this spec (drags) already auto-saves in the
// background with no button click required.
async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await bootApp(page);
}

const saveAndFetch = autoSaveAndFetch;

test.describe('BP inventory <-> canvas transfer', () => {
  test('1. empty BP: inventory -> canvas (originally-reported case)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // test_empty: 1x2 BP at inv page0 origin (1,1) -- grab via its unit
    // core cell (1,1), drop so the origin lands on free canvas cells
    // (6,5)-(6,6).
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(5), y: canvasBox.y + cy(6) }
    );

    const canvas = await saveAndFetch(page);
    const moved = canvas.bps.find((b: any) => b.id === 'test_empty');
    expect(moved).toBeTruthy();
    expect(moved.origin).toEqual([6, 5]);
    // REQ-0033 Phase 2: inv -> canvas is now REFERENCE CREATION, not a
    // physical move -- the home stays in inv.pages[0], untouched, at its
    // ORIGINAL origin, forever (until something explicitly removes the
    // home itself, which no operation in this test does).
    const home = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(home).toBeTruthy();
    expect(home.origin).toEqual([1, 1]);
  });

  test('2. BP with 1 PO + seated SI: inventory -> canvas (contents travel with it)', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // test_full: 2-cell BP at inv page0 origin (1,4) (cells (1,4) unit
    // + (1,5) free), hosting PO p100 (hilt) at (1,5) with SI a100
    // (acc_gem) seated on its gem socket. Grab via its unit cell (1,4),
    // drop onto free canvas cells (6,4)-(6,5).
    //
    // REQ-0033 Phase 2 fixture note: test_full was originally a 1x1 BP
    // whose SOLE cell was also its unit cell, with p100 sitting on that
    // same cell. That arrangement is legal to STORE (invCanPlaceCells has
    // no unit-cell exclusion -- only canPlacePO's CANVAS-side
    // canPlaceCells does), but was never actually legal to TRANSFER onto
    // canvas: canPlacePO always rejects a PO landing on a BP's unit
    // cell there. The pre-REQ-0033 physical transferBPPhysical splice
    // never caught this (it moved the PO's record directly, with no
    // canPlacePO re-validation at all) -- a latent bug that simply never
    // surfaced. REQ-0033's reference-model createRef('po',...) DOES
    // validate every new PO reference through the real canPlacePO, which
    // correctly rejects this arrangement now. Fixed by widening
    // test_full to 2 cells (shape [[0,0],[0,1]]) so its PO occupies the
    // non-unit cell -- a fixture correction, not a workaround around a
    // client bug.
    await drag(
      page,
      { x: invBox.x + cx(4), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(4), y: canvasBox.y + cy(6) }
    );

    const canvas = await saveAndFetch(page);
    const moved = canvas.bps.find((b: any) => b.id === 'test_full');
    expect(moved).toBeTruthy();
    expect(moved.origin).toEqual([6, 4]);

    const po = canvas.pos.find((p: any) => p.uid === 'p100');
    expect(po).toBeTruthy();
    expect(po.loc).toBe('grid');
    expect(po.cell).toEqual([6, 5]); // travelled with the BP (same delta: home was [1,5], BP origin delta is [5,0])

    const si = canvas.sis.find((s: any) => s.uid === 'a100');
    expect(si).toBeTruthy();
    expect(si.host).toEqual({ po: 'p100', si: 0 }); // host unchanged (keyed by uid)

    // REQ-0033 Phase 2: inv -> canvas is now REFERENCE CREATION (with
    // nested PO/SI contents also referenced, per bpReferenceSet) -- the
    // BP's home AND its home-contained PO/SI all stay in inv.pages[0],
    // completely untouched, at their ORIGINAL positions, alongside the
    // brand-new canvas references asserted above.
    const homeBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_full');
    expect(homeBp).toBeTruthy();
    expect(homeBp.origin).toEqual([1, 4]);
    const homePo = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p100');
    expect(homePo).toBeTruthy();
    expect(homePo.cell).toEqual([1, 5]);
    const homeSi = canvas.inv.pages[0].sis.find((s: any) => s.uid === 'a100');
    expect(homeSi).toBeTruthy();
    expect(homeSi.host).toEqual({ po: 'p100', si: 0 });
  });

  test('3. round trip: canvas -> inventory -> canvas (no state corruption)', async ({ page }) => {
    // REQ-0033 Phase 2 rewrite: under the reference model, a canvas->inv
    // drag is a REFERENCE REMOVAL that ignores the drop cell entirely
    // ("drop cell irrelevant" -- engine.js's transferBPRemoveRef/
    // removeRef) -- the home's position in inv.pages[0] NEVER changes,
    // regardless of where the pointer drops it. So "round trip" here
    // means: the home stays at its ORIGINAL origin [1,1] throughout every
    // step (it is never relocated by ANY of these drags), while the
    // CANVAS reference is created, then removed, then created again.
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Step A: test_empty inv -> canvas at (6,5) -- a NEW reference; the
    // home (still at [1,1]) is untouched.
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(5), y: canvasBox.y + cy(6) }
    );
    let canvas = await saveAndFetch(page);
    expect(canvas.bps.find((b: any) => b.id === 'test_empty')?.origin).toEqual([6, 5]);
    expect(canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty')?.origin).toEqual([1, 1]);

    // Reload to get a fresh boot reading the just-saved state (Save/Load
    // round trip, same as a real user closing and reopening the app).
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);

    // Step B: drag it back canvas -> inventory page0. The drop landing
    // cell (3,3) is DELIBERATELY irrelevant under the reference model --
    // this removes the canvas reference only; the home stays exactly at
    // [1,1], never having moved.
    const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: canvasBox2.x + cx(5), y: canvasBox2.y + cy(6) },
      { x: invBox2.x + cx(3), y: invBox2.y + cy(3) }
    );
    canvas = await saveAndFetch(page);
    expect(canvas.bps.some((b: any) => b.id === 'test_empty')).toBe(false);
    const home = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(home).toBeTruthy();
    expect(home.origin).toEqual([1, 1]); // untouched -- drop cell was irrelevant

    // Step C: drag it forward again -- inv -> canvas once more to
    // complete the "round trip" (canvas -> inventory -> canvas), grabbing
    // from the home's REAL (unmoved) position [1,1], landing back at
    // (6,5) on canvas.
    await page.reload();
    await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
    await page.waitForTimeout(400);
    const invBox3 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox3 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: invBox3.x + cx(1), y: invBox3.y + cy(1) },
      { x: canvasBox3.x + cx(5), y: canvasBox3.y + cy(6) }
    );
    canvas = await saveAndFetch(page);
    const finalBp = canvas.bps.find((b: any) => b.id === 'test_empty');
    expect(finalBp).toBeTruthy();
    expect(finalBp.origin).toEqual([6, 5]);
    const finalHome = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(finalHome).toBeTruthy();
    expect(finalHome.origin).toEqual([1, 1]); // still untouched throughout

    // No state corruption: the OTHER fixture BP (test_full, never
    // touched) and its PO/SI must be exactly as the fixture left them.
    const untouchedBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_full');
    expect(untouchedBp?.origin).toEqual([1, 4]);
    expect(canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p100')?.cell).toEqual([1, 5]);
  });

  test('4. illegal overlap: BP dropped onto an occupied canvas region is rejected', async ({ page }) => {
    await loadFixtureAndBoot(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Attempt to drop test_empty onto canvas cell (1,1) -- already
    // occupied by BP "alpha" in the fixture. Grab via unit cell (1,1).
    await drag(
      page,
      { x: invBox.x + cx(1), y: invBox.y + cy(1) },
      { x: canvasBox.x + cx(1), y: canvasBox.y + cy(1) }
    );

    const canvas = await saveAndFetch(page);
    // Transfer must NOT have happened: test_empty stays in inventory,
    // canvas BP set is unchanged, no corruption on either side.
    expect(canvas.bps.some((b: any) => b.id === 'test_empty')).toBe(false);
    expect(canvas.bps.map((b: any) => b.id).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    const stillInInv = canvas.inv.pages[0].bps.find((b: any) => b.id === 'test_empty');
    expect(stillInInv).toBeTruthy();
    expect(stillInInv.origin).toEqual([1, 1]);
    // alpha's own footprint must be exactly as before (no partial
    // overlap/corruption from the rejected transfer attempt).
    const alpha = canvas.bps.find((b: any) => b.id === 'alpha');
    expect(alpha.origin).toEqual([1, 1]);
  });
});

// REQ-0045 bug (a): "BP cannot be moved inside the Inventory". Root cause
// (see client/src/board/boardOps.ts's makeInvOps().canMoveBP, now fixed):
// the HOVER-PREVIEW legality check (engine.invCanPlaceBP, called on every
// pointermove to decide the ghost tint AND whether a drop target exists
// at all) omitted the 4th `exclUids` argument, so it never excluded the
// dragged BP's OWN contained POs from the free-item occupancy test
// (invOccupancy). invMoveBP itself (the function that actually runs at
// COMMIT time) always correctly excluded them -- so any nudge whose new
// footprint overlapped a cell the BP's own PO currently sits on (the
// ordinary case of dragging a covered BP a SHORT distance, not clear
// across the board) got a permanently-illegal (red) hover preview, which
// meant `drop` stayed null the entire drag and pointerup had nothing to
// commit -- the move silently failed even though the real legality check
// would have allowed it. This is a same-page inventory-only bug: the
// canvas board's canMoveBP has no free-item occupancy concept at all
// (POs on canvas always live inside a BP, never float free), so this
// class of bug structurally cannot occur there.
test.describe('BP move WITHIN the inventory board (same page) -- REQ-0045 bug (a)', () => {
  test('nudging a BP-with-contained-PO a SHORT distance (new footprint overlaps the BP\'s OWN old footprint) succeeds', async ({ page }) => {
    const canvas = {
      linked: true,
      bps: [],
      pos: [],
      sis: [],
      layout: { ROWS: 8, COLS: 8 },
      inv: {
        pages: [
          {
            // 1x3 BP at origin (3,3): local cells (3,3),(3,4),(3,5).
            // Unit sits at the BP's own (0,0) offset = (3,3), which has
            // no PO on it (grabbable via the unit core). Its contained
            // PO sits at (3,4) -- the BP's MIDDLE cell. Nudging the BP's
            // origin one cell right, to (3,4), yields new cells
            // (3,4),(3,5),(3,6): cell (3,4) is exactly where the BP's own
            // travelling PO currently sits -- this is the overlap the old
            // (buggy) hover-preview misreported as illegal.
            bps: [{ id: 'nudge_bp', name: 'Nudge BP', color: '#4a90d9', shape: [[0, 0], [0, 1], [0, 2]], origin: [3, 3], linker: { off: [0, 0], dirs: [] } }],
            pos: [{ uid: 'nudge_po', id: 'hilt', loc: 'grid', cell: [3, 4], rot: 0 }],
            sis: [], tms: [],
          },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
        ],
        names: ['1', '2', '3', '4', '5'],
      },
    };
    await page.request.put('/api/profile/default/canvas', { data: canvas });
    await bootApp(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;

    // Grab the unit core at (3,3) (empty of any PO), drop one cell to
    // the right at (3,4).
    await drag(
      page,
      { x: invBox.x + cx(3), y: invBox.y + cy(3) },
      { x: invBox.x + cx(4), y: invBox.y + cy(3) }
    );

    const result = await saveAndFetch(page);
    const bp = result.inv.pages[0].bps.find((b: any) => b.id === 'nudge_bp');
    expect(bp).toBeTruthy();
    expect(bp.origin).toEqual([3, 4]); // the nudge succeeded
    // The contained PO traveled WITH the BP by the same delta (+0,+1).
    const po = result.inv.pages[0].pos.find((p: any) => p.uid === 'nudge_po');
    expect(po.cell).toEqual([3, 5]);
  });

  test('a GENUINELY illegal nudge (new footprint overlaps an UNRELATED free-placed PO) is still rejected', async ({ page }) => {
    const canvas = {
      linked: true,
      bps: [],
      pos: [],
      sis: [],
      layout: { ROWS: 8, COLS: 8 },
      inv: {
        pages: [
          {
            bps: [{ id: 'nudge_bp', name: 'Nudge BP', color: '#4a90d9', shape: [[0, 0], [0, 1], [0, 2]], origin: [3, 3], linker: { off: [0, 0], dirs: [] } }],
            pos: [
              { uid: 'nudge_po', id: 'hilt', loc: 'grid', cell: [3, 4], rot: 0 },
              // Unrelated free PO at (3,6), NOT part of nudge_bp. Nudging
              // nudge_bp's origin to (3,4) gives cells (3,4),(3,5),(3,6)
              // -- (3,6) collides with this genuinely foreign PO, which
              // must NOT be excluded (only the moving BP's OWN contents
              // are excluded from the occupancy check).
              { uid: 'other_po', id: 'dagger', loc: 'grid', cell: [3, 6], rot: 0 },
            ],
            sis: [], tms: [],
          },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
          { bps: [], pos: [], sis: [], tms: [] },
        ],
        names: ['1', '2', '3', '4', '5'],
      },
    };
    await page.request.put('/api/profile/default/canvas', { data: canvas });
    await bootApp(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;

    await drag(
      page,
      { x: invBox.x + cx(3), y: invBox.y + cy(3) },
      { x: invBox.x + cx(4), y: invBox.y + cy(3) }
    );

    const result = await saveAndFetch(page);
    const bp = result.inv.pages[0].bps.find((b: any) => b.id === 'nudge_bp');
    expect(bp.origin).toEqual([3, 3]); // rejected -- must stay put
    const po = result.inv.pages[0].pos.find((p: any) => p.uid === 'nudge_po');
    expect(po.cell).toEqual([3, 4]); // untouched
    const other = result.inv.pages[0].pos.find((p: any) => p.uid === 'other_po');
    expect(other.cell).toEqual([3, 6]); // untouched
  });
});
