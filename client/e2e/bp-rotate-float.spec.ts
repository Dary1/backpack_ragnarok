// client/e2e/bp-rotate-float.spec.ts -- REQ-0289: BP grab handle at the Unit +
// Unit-pivot rotation + float-on-blocked-rotation.
//
// Covers the CLIENT wiring REQ-0289 adds on top of REQ-0288's ghost/lift/revert
// machinery:
//   - the ✥ move-handle badge now anchors at the Unit's SEAT cell (§A);
//   - a REFUSED in-place rotation FLOATS the bag as a sticky carry (§C): it
//     follows the pointer button-free, previews the ROTATED footprint via the
//     REQ-0288 ghost probe, and is placed by the NEXT pointerdown (click-to-
//     place); an illegal click / Esc reverts with the origin board's "snapped
//     home" cue and leaves state untouched (directive 4);
//   - a unit-less wall BP (REQ-0284) keeps the r0,c0 badge + bbox rotation.
//
// Engine geometry (pivot law, canPlaceBPRotated/moveBPRotated) is unit-tested
// in mock-src/tests/run.cjs; this spec pins the interaction only.
//
// Probe seam (REQ-0288): window.__backpackBoardProbes['canvas']() ->
// { ghost, reverts }. All pointer coords are BOARD-LOCAL cx/cy (or a seat-cell
// corner) PLUS the board <canvas> element's own page box -- never raw cx/cy.
import { test, expect, type Page } from '@playwright/test';
import { bootApp, cx, cy, fetchSavedCanvas, waitForAutoSave, CELL, PAD } from './helpers';

type Probe = { ghost: { kind: string; cells: [number, number][]; hasArt: boolean; legal: boolean } | null; reverts: number };
const canvasProbe = (page: Page): Promise<Probe | null> =>
  page.evaluate(() => {
    const reg = (window as unknown as { __backpackBoardProbes?: Record<string, () => unknown> }).__backpackBoardProbes;
    return reg && reg['canvas'] ? (reg['canvas']() as never) : null;
  });

async function canvasBox(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas.board-canvas').first().boundingBox();
  if (!box) throw new Error('canvas board not found');
  return box;
}
async function autoFetch(page: Page): Promise<any> {
  await waitForAutoSave(page);
  return fetchSavedCanvas(page);
}
// Badge center for a seat cell (row r, col c): the cell top-left + (14,14).
const badgeAt = (box: { x: number; y: number }, r: number, c: number) => ({ x: box.x + PAD + (c - 1) * CELL + 14, y: box.y + PAD + (r - 1) * CELL + 14 });

/** A horizontal bar whose Unit sits at its top-left (off [0,0]). At origin
 * [8,3] an in-place rotation would run to rows 9-10 (past ROWS=8), so the bag
 * CANNOT rotate in place -- the float trigger. Homed on page 1 (reference
 * model), everything else empty. */
function makeFloatCanvas() {
  const bar = { id: 'bar', name: 'Bar', color: '#4a90d9', shape: [[0, 0], [0, 1], [0, 2]], origin: [8, 3], unit: { id: 'berserker', off: [0, 0] } };
  return {
    linked: true, bps: [bar], pos: [], sis: [], layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: { pages: [
      { bps: [], pos: [], sis: [], tms: [] },
      { bps: [{ ...bar }], pos: [], sis: [], tms: [] },
      { bps: [], pos: [], sis: [], tms: [] }, { bps: [], pos: [], sis: [], tms: [] }, { bps: [], pos: [], sis: [], tms: [] },
    ], names: ['1', '2', '3', '4', '5'] },
  };
}

/** An L-shaped bag with an off-center Unit (seat far from the shape's top-left)
 * and a PO covering the OLD badge cell (r0,c0 = origin [2,2]) -- so the badge's
 * relocation to the SEAT is observable: the seat corner rotates the BAG, the
 * old corner (now a PO) rotates the PO. */
function makeBadgeCanvas() {
  const cl = { id: 'cl', name: 'CL', color: '#4a90d9', shape: [[0, 0], [1, 0], [2, 0], [2, 1]], origin: [2, 2], unit: { id: 'dwarf', off: [2, 1] } };
  const cover = { uid: 'cover', id: 'hilt', loc: 'grid', cell: [2, 2], rot: 0 };
  return {
    linked: true, bps: [cl], pos: [cover], sis: [], layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: { pages: [
      { bps: [], pos: [], sis: [], tms: [] },
      { bps: [{ ...cl }], pos: [{ ...cover }], sis: [], tms: [] },
      { bps: [], pos: [], sis: [], tms: [] }, { bps: [], pos: [], sis: [], tms: [] }, { bps: [], pos: [], sis: [], tms: [] },
    ], names: ['1', '2', '3', '4', '5'] },
  };
}

/** A unit-less wall BP (REQ-0284: live 3x6 walls / stale saves). Badge falls
 * back to r0,c0; rotation is the old bbox behavior (origin fixed). */
function makeWallCanvas() {
  return {
    linked: true, bps: [{ id: 'wall', name: 'Wall', color: '#888888', shape: [[0, 0], [0, 1], [0, 2]], origin: [3, 3] }],
    pos: [], sis: [], layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: { pages: [ {bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]} ], names: ['1','2','3','4','5'] },
  };
}

test.describe('REQ-0289 -- Unit-pivot rotation, badge at the seat, float on blocked rotation', () => {
  test('the badge sits at the Unit SEAT cell: dblclicking the seat corner rotates the whole bag (pivot law)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeBadgeCanvas() });
    await bootApp(page);
    const box = await canvasBox(page);
    // seat = origin[2,2] + off[2,1] = (4,3) -- the badge lives here now.
    const badge = badgeAt(box, 4, 3);
    await page.screenshot({ path: '../web/preview/req-0289/badge-at-seat.png' });
    await page.mouse.dblclick(badge.x, badge.y);
    await page.waitForTimeout(300);
    const canvas = await autoFetch(page);
    const bp = canvas.bps.find((b: any) => b.id === 'cl');
    expect(bp.shape).toEqual([[0, 2], [0, 1], [0, 0], [1, 0]]); // rotated
    expect(bp.origin).toEqual([3, 3]); // pivot law: origin shifts to keep the Unit fixed
    expect([bp.origin[0] + bp.unit.off[0], bp.origin[1] + bp.unit.off[1]]).toEqual([4, 3]); // Unit cell invariant
  });

  test('the OLD top-left corner is no longer the badge: a PO there dblclick-rotates the PO, not the bag', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeBadgeCanvas() });
    await bootApp(page);
    const box = await canvasBox(page);
    // r0,c0 = origin (2,2), covered by the PO 'cover'; its cell center is the PO.
    await page.mouse.dblclick(box.x + cx(2), box.y + cy(2));
    await page.waitForTimeout(300);
    const canvas = await autoFetch(page);
    const po = canvas.pos.find((p: any) => p.uid === 'cover');
    expect(po.rot).toBe(1); // the PO itself rotated
    const bp = canvas.bps.find((b: any) => b.id === 'cl');
    expect(bp.shape).toEqual([[0, 0], [1, 0], [2, 0], [2, 1]]); // the BAG is untouched
    expect(bp.origin).toEqual([2, 2]);
  });

  test('a blocked in-place rotation FLOATS the bag; ghost previews the ROTATED footprint; a legal click lands it rotated', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeFloatCanvas() });
    await bootApp(page);
    const box = await canvasBox(page);
    const badge = badgeAt(box, 8, 3); // seat (8,3); rotating in place runs off the bottom edge -> refused
    await page.mouse.dblclick(badge.x, badge.y); // -> sticky float
    await page.waitForTimeout(150);
    // Glide to open space at (2,6). The float previews the ROTATED (vertical)
    // footprint at origin (2,6): a column (2,6),(3,6),(4,6).
    await page.mouse.move(box.x + cx(6), box.y + cy(2), { steps: 6 });
    await page.waitForTimeout(150);
    const p = await canvasProbe(page);
    expect(p?.ghost, 'the floating bag must ghost').not.toBeNull();
    expect(p!.ghost!.kind).toBe('bp');
    expect(p!.ghost!.legal).toBe(true);
    expect(p!.ghost!.cells).toEqual([[2, 6], [3, 6], [4, 6]]); // ROTATED (vertical) footprint
    await page.screenshot({ path: '../web/preview/req-0289/float-rotated-ghost.png' });
    await page.mouse.click(box.x + cx(6), box.y + cy(2)); // click-to-place
    await page.waitForTimeout(300);
    const canvas = await autoFetch(page);
    const bp = canvas.bps.find((b: any) => b.id === 'bar');
    expect(bp.shape).toEqual([[0, 0], [1, 0], [2, 0]]); // now vertical
    expect(bp.origin).toEqual([2, 6]);
    expect([bp.origin[0] + bp.unit.off[0], bp.origin[1] + bp.unit.off[1]]).toEqual([2, 6]); // Unit seat at the drop
  });

  test('a floating rotation reverts on an ILLEGAL click: state untouched + one snapped-home cue', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeFloatCanvas() });
    await bootApp(page);
    await waitForAutoSave(page);
    const beforeBar = (await fetchSavedCanvas(page)).bps.find((b: any) => b.id === 'bar');
    const box = await canvasBox(page);
    await page.mouse.dblclick(badgeAt(box, 8, 3).x, badgeAt(box, 8, 3).y); // float
    await page.waitForTimeout(150);
    // Glide to (8,7): the rotated footprint runs off the bottom edge -> illegal.
    await page.mouse.move(box.x + cx(7), box.y + cy(8), { steps: 6 });
    await page.waitForTimeout(150);
    let p = await canvasProbe(page);
    expect(p!.ghost!.legal).toBe(false); // still ghosts, but illegal
    await page.mouse.click(box.x + cx(7), box.y + cy(8)); // illegal click -> revert
    await page.waitForTimeout(300);
    p = await canvasProbe(page);
    expect(p!.reverts).toBe(1);
    const afterBar = (await fetchSavedCanvas(page)).bps.find((b: any) => b.id === 'bar');
    expect(afterBar.origin).toEqual(beforeBar.origin); // untouched
    expect(afterBar.shape).toEqual(beforeBar.shape);
  });

  test('a floating rotation reverts on Esc: state untouched + one snapped-home cue', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeFloatCanvas() });
    await bootApp(page);
    await waitForAutoSave(page);
    const beforeBar = (await fetchSavedCanvas(page)).bps.find((b: any) => b.id === 'bar');
    const box = await canvasBox(page);
    await page.mouse.dblclick(badgeAt(box, 8, 3).x, badgeAt(box, 8, 3).y); // float
    await page.waitForTimeout(150);
    await page.mouse.move(box.x + cx(6), box.y + cy(2), { steps: 4 }); // hover a legal spot...
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape'); // ...but Esc-cancel instead
    await page.waitForTimeout(250);
    const p = await canvasProbe(page);
    expect(p!.reverts).toBe(1);
    const afterBar = (await fetchSavedCanvas(page)).bps.find((b: any) => b.id === 'bar');
    expect(afterBar.origin).toEqual(beforeBar.origin);
    expect(afterBar.shape).toEqual(beforeBar.shape);
    await bootApp(page); // boots clean after cancel (no dangling carry)
  });

  test('a unit-less wall BP: the badge falls back to r0,c0 and dblclick rotates bbox-style (origin fixed)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeWallCanvas() });
    await bootApp(page);
    const box = await canvasBox(page);
    const badge = badgeAt(box, 3, 3); // unit-less: badge falls back to the shape top-left (3,3)
    await page.mouse.dblclick(badge.x, badge.y);
    await page.waitForTimeout(300);
    const canvas = await autoFetch(page);
    const bp = canvas.bps.find((b: any) => b.id === 'wall');
    expect(bp.shape).toEqual([[0, 0], [1, 0], [2, 0]]); // rotated to vertical (bbox)
    expect(bp.origin).toEqual([3, 3]); // origin fixed (no Unit pivot)
  });
});
