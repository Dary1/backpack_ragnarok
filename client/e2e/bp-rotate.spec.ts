// REQ-0045 (a2) -- BP dblclick rotate (canvas + inventory).
//
// Engine-level rotation math (canRotateBP/rotateBP, invCanRotateBP/
// invRotateBP) is unit-tested in mock-src/tests/run.cjs; this spec covers
// the CLIENT interaction wiring: double-click on a BP's move-handle
// badge, or an empty BP cell, triggers the SAME rotation
// (client/src/board/BoardRenderer.ts's handleBPPointerDown),
// on BOTH the canvas and inventory boards, and a PO's OWN dblclick-rotate
// (handlePOPointerDown) is never intercepted by the BP handler even when
// the PO sits on top of a BP.
//
// REQ-0290 migration: the unit CORE used to be a third rotate/drag trigger
// and this spec exercised it as such. REQ-0290 retired it -- the seat cell is
// now 'not-allowed' and inert on every unit -- so the two tests that drove
// rotation through the core were re-pointed at the ✥ badge. The badge sits
// inside the SAME cell as the BP's top-left corner, so only the click
// coordinate moved; every rotation assertion below is unchanged, which is
// the point: REQ-0290 removes a HANDLE, not a behaviour. That the seat is
// now inert is asserted positively in locked-affordances.spec.ts.
//
// Reference-model decision (REQ-0045 design note, made explicit since the
// spec's own design notes did not cover this): per REQ-0033's reference
// model (an inventory "home" BP can have multiple canvas "reference"
// placements), rotation is a mutation of the arrangement performed
// WHEREVER it happens -- home vs. references are INDEPENDENT rotations,
// exactly like seated SIs are already independent per-squad (not
// shared/mirrored). Rotating a BP's home in the inventory does NOT rotate
// its canvas reference(s), and vice versa -- each is simply its own
// {shape,unit,pos[]} record, rotated in place, with no cross-record
// propagation. This falls out structurally from rotateBP/invRotateBP each
// only ever touching the ONE container (st.bps or one inv page) they were
// called against; no test below exercises a referenced BP specifically
// since the underlying mechanism already can't reach across containers
// (rotateBP never looks at st.inv, invRotateBP never looks at st.bps).
import { test, expect } from '@playwright/test';
import { bootApp, bx, by, cx, cy, waitForAutoSave } from './helpers';

const saveAndFetch = async (page: import('@playwright/test').Page) => {
  await waitForAutoSave(page);
  const resp = await page.request.get('/api/profile/default/canvas');
  return (await resp.json()).canvas;
};

// Shared fixture: an L-shaped BP (off-center unit, contained PO) on
// BOTH the canvas and inventory page 0, so the same rotation math can be
// exercised identically on either board.
function makeCanvas() {
  // REQ-0170: the BP carries a Unit (dwarf = `rook`). Rotation moves the SEAT; the
  // Unit's rays are its own and are board-absolute, so they do not rotate with the bag.
  const lShape = { shape: [[0, 0], [1, 0], [2, 0], [2, 1]], unit: { id: 'dwarf', off: [2, 1] } };
  // REQ-0273 deliberate fixture update: the contained PO used to sit AT the
  // unit cell (4,3) -- an ILLEGAL placement the engine has refused since
  // REQ-0092 ('Unit cell') and one migrateState v4 now REPAIRS at read time
  // (the PO would be relocated at boot and every rigid-rotation assertion
  // below would drift). It now sits on the legal contained cell (4,2); the
  // rotation math being pinned is identical.
  return {
    linked: true,
    bps: [{ id: 'canvas_l', name: 'Canvas L', color: '#4a90d9', origin: [2, 2], ...lShape }],
    pos: [{ uid: 'canvas_po', id: 'hilt', loc: 'grid', cell: [4, 2], rot: 0 }],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        {
          bps: [{ id: 'inv_l', name: 'Inv L', color: '#d9904a', origin: [2, 2], ...lShape }],
          pos: [{ uid: 'inv_po', id: 'hilt', loc: 'grid', cell: [4, 2], rot: 0 }],
          sis: [], tms: [],
        },
        // canvas_l's OWN inventory home, on a SEPARATE page (page 1) --
        // required under the reference model (every canvas BP must have
        // originated from an inventory home; a fixture that places
        // canvas_l on canvas with no home at all is itself an unrealistic
        // state a real client could never produce, and would trigger
        // migrateCanvasToReferencesV3's "not-yet-homed" first-fit
        // migration, which -- with no other free page -- would have
        // landed it on page 0 and collided with inv_l's rotated
        // footprint. Homing it explicitly on its own page keeps this
        // fixture both realistic AND migration-neutral (canvas_l is
        // already homed, so migration is a true no-op for it).
        {
          bps: [{ id: 'canvas_l', name: 'Canvas L', color: '#4a90d9', origin: [2, 2], ...lShape }],
          pos: [{ uid: 'canvas_po', id: 'hilt', loc: 'grid', cell: [4, 2], rot: 0 }],
          sis: [], tms: [],
        },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

test.describe('BP dblclick rotate -- REQ-0045 (a2)', () => {
  test('double-click the ✥ badge rotates the BP on the CANVAS board (shape+unit+contained PO all remap)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // REQ-0290: was the unit core at absolute (4,3); the core is inert now.
    // The ✥ badge anchors at the BP's TOP-LEFT-most cell, which for this
    // L-shape (shape [[0,0],[1,0],[2,0],[2,1]], origin [2,2]) is (2,2).
    const x = canvasBox.x + bx(2);
    const y = canvasBox.y + by(2);
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(200);

    const canvas = await saveAndFetch(page);
    const bp = canvas.bps.find((b: any) => b.id === 'canvas_l');
    expect(bp.shape).toEqual([[0, 2], [0, 1], [0, 0], [1, 0]]);
    // REQ-0170: the seat travels with the shape ([2,1] -> [1,0]); the Unit's identity
    // -- and therefore its rays -- is untouched. The old law (dirs rotate +2 mod 8)
    // is GONE: a lance keeps pointing at the enemy however the bag is packed.
    expect(bp.unit).toEqual({ id: 'dwarf', off: [1, 0] });
    expect(bp.origin).toEqual([2, 2]); // origin never moves during in-place rotation
    const po = canvas.pos.find((p: any) => p.uid === 'canvas_po');
    expect(po.cell).toEqual([2, 2]); // local [2,0] -> rotated [0,0] on the new shape
    expect(po.rot).toBe(1);
  });

  test('double-click the move-handle badge rotates the BP on the INVENTORY board (same math, independent of the canvas record)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const PAD = 38, CELL = 80;

    // Move-handle badge sits near the BP's top-left cell (origin [2,2]) --
    // (PAD+(2-1)*CELL+14, PAD+(2-1)*CELL+14).
    const badgeX = invBox.x + PAD + 1 * CELL + 14;
    const badgeY = invBox.y + PAD + 1 * CELL + 14;
    await page.mouse.dblclick(badgeX, badgeY);
    await page.waitForTimeout(200);

    const canvas = await saveAndFetch(page);
    const invBp = canvas.inv.pages[0].bps.find((b: any) => b.id === 'inv_l');
    expect(invBp.shape).toEqual([[0, 2], [0, 1], [0, 0], [1, 0]]);
    expect(invBp.unit).toEqual({ id: 'dwarf', off: [1, 0] });
    const invPo = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'inv_po');
    expect(invPo.cell).toEqual([2, 2]); // same rigid remap as the canvas twin
    expect(invPo.rot).toBe(1);

    // Independence check (REQ-0033 reference-model decision, see this
    // file's header comment): the CANVAS record (a completely separate
    // BP, never touched by this test) must be COMPLETELY untouched.
    const canvasBp = canvas.bps.find((b: any) => b.id === 'canvas_l');
    expect(canvasBp.shape).toEqual([[0, 0], [1, 0], [2, 0], [2, 1]]);
    expect(canvasBp.unit).toEqual({ id: 'dwarf', off: [2, 1] });
  });

  test('4x double-click returns the BP to its EXACT original state on both boards (identity)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // REQ-0290: this loop used to recompute the UNIT CELL before each click,
    // because the seat physically relocates on every rotation. The badge
    // relocates too -- it anchors on the BP's top-left-most CELL, which the
    // shape change moves -- so the recomputation survives verbatim; only its
    // source changed from unit.off to the shape's own min-row/min-col. The
    // re-fetch between clicks is unchanged (auto-save has committed the
    // previous rotation by then, thanks to the waitForTimeout below).
    for (let i = 0; i < 4; i++) {
      const canvas = await saveAndFetch(page);
      const bp = canvas.bps.find((b: any) => b.id === 'canvas_l');
      const r0 = Math.min(...bp.shape.map((s: number[]) => s[0]));
      const c0 = Math.min(...bp.shape.filter((s: number[]) => s[0] === r0).map((s: number[]) => s[1]));
      const x = canvasBox.x + bx(bp.origin[1] + c0);
      const y = canvasBox.y + by(bp.origin[0] + r0);
      await page.mouse.dblclick(x, y);
      await page.waitForTimeout(300);
    }

    const canvas = await saveAndFetch(page);
    const bp = canvas.bps.find((b: any) => b.id === 'canvas_l');
    expect(bp.shape).toEqual([[0, 0], [1, 0], [2, 0], [2, 1]]);
    expect(bp.unit).toEqual({ id: 'dwarf', off: [2, 1] });
    const po = canvas.pos.find((p: any) => p.uid === 'canvas_po');
    expect(po.cell).toEqual([4, 2]);
    expect(po.rot).toBe(0);
  });

  test('a PO sitting on a BP keeps its OWN dblclick-rotate behavior (not intercepted by the BP handler)', async ({ page }) => {
    // A simple 1-cell BP with a rotation-symmetric PO (shape [[0,0]]) NOT
    // on the unit cell and NOT on the move-handle badge's hit area --
    // dblclicking directly on the PO's own sprite must rotate the PO,
    // not the BP.
    const canvas = {
      linked: true,
      bps: [{ id: 'simple_bp', name: 'Simple', color: '#4a90d9', shape: [[0, 0], [0, 1], [0, 2]], origin: [3, 3], unit: { id: 'berserker', off: [0, 0] } }],
      pos: [{ uid: 'po_on_bp', id: 'hilt', loc: 'grid', cell: [3, 4], rot: 0 }],
      sis: [],
      layout: { ROWS: 8, COLS: 8 },
      presets: { active: 0, names: ['P1'], store: [null] }, // see makeCanvas()'s comment on why this is required
      inv: {
        pages: [
          { bps: [], pos: [], sis: [], tms: [] },
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
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // po_on_bp sits at local cell (3,4), NOT the unit cell (3,3) and
    // NOT the BP's move-handle badge (near (3,3)'s top-left corner) --
    // dblclicking its own cell center must hit the PO's own sprite/hit
    // area first.
    const x = canvasBox.x + cx(4);
    const y = canvasBox.y + cy(3);
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(200);

    const result = await saveAndFetch(page);
    const po = result.pos.find((p: any) => p.uid === 'po_on_bp');
    expect(po.rot).toBe(1); // the PO itself rotated
    const bp = result.bps.find((b: any) => b.id === 'simple_bp');
    expect(bp.shape).toEqual([[0, 0], [0, 1], [0, 2]]); // BP untouched
    expect(bp.origin).toEqual([3, 3]);
  });
});
