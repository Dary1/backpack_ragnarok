// REQ-0290 -- seat-cell X; fixed-interior affordances (padlock, no grab).
//
// What this pins, in the REQ's own terms:
//   1. The Unit SEAT cell says 'not-allowed' and is INERT, on EVERY unit
//      (locked starter AND ordinary) and on BOTH boards. Pointerdown on it
//      neither carries nor rotates.
//   2. BP drag/rotate still work -- through the ✥ badge and empty BP cells,
//      which keep 'grab'. This is design item 5 ("do not over-lock"): the
//      seat losing its handle must not cost a locked starter unit its
//      legal whole-BP move/rotate.
//   3. A FIXED PO shows the DEFAULT arrow (ruling 1: explicitly not the X)
//      plus exactly one persistent padlock.
//   4. An SI seated inside a locked-BP-hosted PO shows the DEFAULT arrow and
//      refuses to lift, flashing instead of silently failing at drop time.
//
// Cursors are read through __backpackDebug.cursorProbe(boardKey) rather than
// off the DOM. A board is ONE canvas with ONE live cursor at a time, so the
// alternative is walking a real mouse cell by cell -- slow, and it cannot
// tell "no hit object here" apart from "a hit object that sets the default
// arrow", which is exactly the distinction ruling 1 turns on. See
// client/src/board/cursorProbe.ts.
import { test, expect } from '@playwright/test';
import { CELL, PAD, bootApp, bx, by, cx, cy, drag, waitForAutoSave } from './helpers';

interface CursorEntry { uid: string; cursor: string }

const saveAndFetch = async (page: import('@playwright/test').Page) => {
  await waitForAutoSave(page);
  const resp = await page.request.get('/api/profile/default/canvas');
  return (await resp.json()).canvas;
};

const probe = (page: import('@playwright/test').Page, boardKey: string) =>
  page.evaluate(
    (k) => (window as unknown as { __backpackDebug: { cursorProbe: (k: string) => CursorEntry[] } }).__backpackDebug.cursorProbe(k),
    boardKey,
  ) as Promise<CursorEntry[]>;

const cursorOf = (entries: CursorEntry[], uid: string): string | undefined =>
  entries.find((e) => e.uid === uid)?.cursor;

// Two BPs per board so "EVERY unit, not just the locked one" is a real
// assertion rather than a single-case coincidence:
//   locked_bp  -- locked:true, hosting a FIXED PO (lp) with an SI (la) seated
//                 on it, plus one empty cell at (2,4) to keep an empty-cell
//                 drag handle available.
//   plain_bp   -- an ordinary unlocked BP with a normal draggable PO.
// The same pair is mirrored onto inventory page 0, since design item 1 is
// explicitly "both boards".
function makeCanvas() {
  const lockedShape = { shape: [[0, 0], [0, 1], [0, 2]], unit: { id: 'berserker', off: [0, 0] } };
  const plainShape = { shape: [[0, 0], [0, 1]], unit: { id: 'dwarf', off: [0, 0] } };
  const board = (idL: string, idP: string, uidPo: string, uidFixed: string, uidSi: string) => ({
    bps: [
      { id: idL, name: 'Locked', color: '#4a90d9', origin: [2, 2], locked: true, ...lockedShape },
      { id: idP, name: 'Plain', color: '#d9904a', origin: [5, 2], ...plainShape },
    ],
    pos: [
      { uid: uidFixed, id: 'hilt', loc: 'grid', cell: [2, 3], rot: 0, fixed: true },
      { uid: uidPo, id: 'hilt', loc: 'grid', cell: [5, 3], rot: 0 },
    ],
    // Seated-SI shape is {po,si} -- the socket INDEX, not its type (see
    // shared/engine.js sockets(): skey = `${p.uid}:${si}` and the seat lookup
    // matches on host.si). hilt declares exactly one socket, a gem at index 0
    // (content/live/live_items.json entry 'hilt'), and acc_gem's slot is gem.
    sis: [{ uid: uidSi, id: 'acc_gem', host: { po: uidFixed, si: 0 } }],
    tms: [],
  });
  const canvasSide = board('locked_bp', 'plain_bp', 'free_po', 'fixed_po', 'locked_si');
  const invSide = board('inv_locked_bp', 'inv_plain_bp', 'inv_free_po', 'inv_fixed_po', 'inv_locked_si');
  return {
    linked: true,
    bps: canvasSide.bps,
    pos: canvasSide.pos,
    sis: canvasSide.sis,
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        invSide,
        // canvas BPs need inventory homes under the REQ-0033 reference model
        // (see bp-rotate.spec.ts's makeCanvas for the full rationale) -- give
        // them their own page so nothing collides with page 0's fixture.
        { ...board('locked_bp', 'plain_bp', 'free_po', 'fixed_po', 'locked_si'), sis: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

test.describe('REQ-0290 -- locked/fixed affordances', () => {
  test('seat cells say not-allowed on EVERY unit, on BOTH boards; badge + empty cells still say grab', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);

    for (const [boardKey, locked, plain] of [
      ['canvas', 'locked_bp', 'plain_bp'],
      ['inv:0', 'inv_locked_bp', 'inv_plain_bp'],
    ] as const) {
      const entries = await probe(page, boardKey);
      // 1. the seat is X on the locked starter AND on the ordinary unit --
      //    the X states "a Unit piece is stamped to its seat at mint", which
      //    is true of every unit, not a statement about this BP's lock.
      expect(cursorOf(entries, 'seat:' + locked), boardKey + ' locked seat').toBe('not-allowed');
      expect(cursorOf(entries, 'seat:' + plain), boardKey + ' plain seat').toBe('not-allowed');
      // 2. design item 5 -- the remaining handles are untouched, INCLUDING
      //    on the locked BP (its bag still moves and rotates; REQ-0209).
      expect(cursorOf(entries, 'badge:' + locked), boardKey + ' locked badge').toBe('grab');
      expect(cursorOf(entries, 'badge:' + plain), boardKey + ' plain badge').toBe('grab');
      const emptyCells = entries.filter((e) => e.uid.startsWith('cell:' + locked + ':'));
      expect(emptyCells.length, boardKey + ' locked BP keeps empty-cell handles').toBeGreaterThan(0);
      for (const c of emptyCells) expect(c.cursor).toBe('grab');
    }
  });

  test('pointerdown on a seat cell does nothing: no carry, and no dblclick-rotate', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // plain_bp's seat is its origin cell (5,2). Pre-REQ-0290 BOTH gestures
    // below went through the core: a single press started a whole-BP carry,
    // a double press rotated. Both must now be inert.
    const seatX = canvasBox.x + cx(2);
    const seatY = canvasBox.y + cy(5);

    // (a) a drag that starts on the seat must not move the BP at all
    await drag(page, { x: seatX, y: seatY }, { x: canvasBox.x + cx(6), y: canvasBox.y + cy(7) });
    let canvas = await saveAndFetch(page);
    let bp = canvas.bps.find((b: { id: string }) => b.id === 'plain_bp');
    expect(bp.origin, 'seat drag must not carry the BP').toEqual([5, 2]);
    expect(bp.shape, 'seat drag must not rotate it either').toEqual([[0, 0], [0, 1]]);

    // (b) a double-click on the seat must not rotate it
    await page.mouse.dblclick(seatX, seatY);
    await page.waitForTimeout(250);
    canvas = await saveAndFetch(page);
    bp = canvas.bps.find((b: { id: string }) => b.id === 'plain_bp');
    expect(bp.shape, 'seat dblclick must not rotate').toEqual([[0, 0], [0, 1]]);
    expect(bp.unit, 'and must not move the seat').toEqual({ id: 'dwarf', off: [0, 0] });
  });

  test('the badge still rotates the BP -- the handles that remain genuinely work', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // plain_bp's top-left cell is its origin (5,2) -> badge at bx(2),by(5).
    await page.mouse.dblclick(canvasBox.x + bx(2), canvasBox.y + by(5));
    await page.waitForTimeout(250);

    const canvas = await saveAndFetch(page);
    const bp = canvas.bps.find((b: { id: string }) => b.id === 'plain_bp');
    expect(bp.shape, 'badge dblclick rotates 1x2 -> 2x1').toEqual([[0, 0], [1, 0]]);
  });

  test('a fixed PO shows the default arrow and exactly one padlock; a free PO still shows grab', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);

    const entries = await probe(page, 'canvas');
    // ruling 1: DEFAULT on the fixed PO -- the X belongs to the seat alone.
    expect(cursorOf(entries, 'fixed_po')).toBe('default');
    expect(cursorOf(entries, 'free_po')).toBe('grab');

    // exactly one padlock, and only on the FIXED PO.
    expect(entries.filter((e) => e.uid === 'lock:fixed_po').length, 'one padlock on the fixed PO').toBe(1);
    expect(entries.filter((e) => e.uid === 'lock:free_po').length, 'no padlock on a free PO').toBe(0);

    // and the fixed PO genuinely does not move when dragged (REQ-0051 law,
    // re-pinned here because the cursor is now the thing that ANNOUNCES it)
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(page, { x: canvasBox.x + cx(3), y: canvasBox.y + cy(2) }, { x: canvasBox.x + cx(6), y: canvasBox.y + cy(7) });
    const canvas = await saveAndFetch(page);
    const po = canvas.pos.find((p: { uid: string }) => p.uid === 'fixed_po');
    expect(po.cell).toEqual([2, 3]);
  });

  test('an SI seated inside a locked BP shows the default arrow and never lifts', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);

    const entries = await probe(page, 'canvas');
    expect(cursorOf(entries, 'locked_si'), 'locked-hosted SI shows the default arrow').toBe('default');

    // Dragging it off must leave it seated (pre-REQ-0290 the carry STARTED
    // and only failed at drop, which read as a malfunction).
    //
    // The SI's hit circle is r=15 around its SOCKET position, not the host
    // cell's centre, so the grab point must be computed the way geom.ts's
    // socketScreenPos does: box + (ax*W0, ay*H0). hilt's gem socket is
    // ax 0.5 / ay 0.81 of its 1x1 footprint (content/live/live_items.json),
    // and fixed_po sits at (2,3) -- so cy(2) would miss the circle by ~25px
    // and land on the host PO's rect instead, which would make this test pass
    // for the wrong reason.
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    const siX = canvasBox.x + PAD + (3 - 1) * CELL + 0.5 * CELL;
    const siY = canvasBox.y + PAD + (2 - 1) * CELL + 0.81 * CELL;
    await drag(page, { x: siX, y: siY }, { x: canvasBox.x + cx(7), y: canvasBox.y + cy(7) });
    const canvas = await saveAndFetch(page);
    const si = canvas.sis.find((s: { uid: string }) => s.uid === 'locked_si');
    expect(si, 'the SI still exists').toBeTruthy();
    expect(si.host?.po, 'and is still seated on its host').toBe('fixed_po');
  });
});
