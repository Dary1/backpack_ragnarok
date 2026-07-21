// client/e2e/inventory-art-integrity.spec.ts -- REQ-0273.
//
// Pins the three items of REQ-0273 where the player actually sees them, using
// the pixel-probe pattern established by unit-skin-fallback.spec.ts test 4
// (screenshot -> decode in-page -> count colour populations):
//
//   1. BUG 1 -- inventory unit art draws at FULL opacity. Pre-fix it went
//      through the REQ-0030 dormancy dim (alpha 0.44), which was written for
//      the legacy glyph years before real art existed; REQ-0266 fed real art
//      through the same line and the dim became a defect. A saturated
//      injected skin raster makes the two cases numerically far apart.
//   2. BUG 2 (law) -- a PO drag onto an inventory unit cell REFUSES and
//      commits nothing (engine REQ-0092 law, proven through the real UI).
//   3. BUG 2 (poison) -- a saved profile that already carries the overlap
//      (producible by the pre-REQ-0273 rolled-BP first-fit; see
//      client/src/lib/placement.ts) boots UN-overlapped: migrateState v4
//      relocates the PO at read time. The unit cell shows no PO backdrop:
//      the relocated PO renders at a legal cell instead.
//   4. FEATURE -- per-PO footprint outlines: the pale rim reads along the
//      inset boundary band on a busy board (adjacent POs + usage wash +
//      skinned neighbours), and cell CENTRES stay rim-free (calm, not
//      wireframe).
//
// Screenshots: set REQ0273_SHOTS=<dir> to also write the full board PNGs the
// REQ's visual-evidence deliverable uses. Assertions never depend on it.
import { test, expect, type Page } from '@playwright/test';
import { bootApp, drag, PAD, CELL, cx, cy } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

// A 32x32 saturated pure-green PNG, generated once (zlib-free fixed PNG would
// be bulky here; a data-URL SVG cannot be used -- Pixi's Assets loader picks
// its parser from the URL extension, see unitIcon.ts's unitArtUrl note). The
// route below serves it as image/png from /api/art/e2e_g.png.
import zlib from 'node:zlib';
function greenPng(): Buffer {
  const W = 32, H = 32;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 4);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const o = row + 1 + x * 4;
      raw[o] = 0; raw[o + 1] = 255; raw[o + 2] = 0; raw[o + 3] = 255;
    }
  }
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Injects one default `slot:"unit"` skin for `unitId` into /api/content and
 * routes its artwork to the in-test green PNG. The fleet is files-backed (no
 * adopted art), so this is the only way the board's `skin` rung can fire. */
async function routeUnitSkinArt(page: Page, unitId: string): Promise<void> {
  await page.route((url) => url.pathname === '/api/art/e2e_g.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: greenPng() }));
  await page.route((url) => url.pathname === '/api/content', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const skins = (j.unit_skins ?? {}) as Record<string, unknown>;
    skins['uskin_e2e_g'] = { id: 'uskin_e2e_g', name: 'E2E Green', slot: 'unit', art_ref: 'e2e_g', units: [unitId], default: true };
    j.unit_skins = skins;
    j.art_urls = { ...(j.art_urls ?? {}), uskin_e2e_g: '/api/art/e2e_g.png' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
  await page.route('**/api/profile/*/skins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, skins: { unit: {}, bpskin: {} } }) }));
}

/** 3x2 BP whose unit sits bottom-right -- the live "alpha" geometry. Unit
 * cell = origin + [2,1]. */
function bpFixture(id: string, origin: [number, number], unitId = 'dwarf') {
  return { id, name: id, color: '#BF9000', shape: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]], origin, unit: { id: unitId, off: [2, 1] } };
}

/** Minimal well-formed profile: one canvas BP (references need a home NOT on
 * the page that already holds it -- same posture as unit-skin-fallback test 4)
 * plus whatever page-0 contents the test wants. */
function profileWith(page0: { bps?: unknown[]; pos?: unknown[]; sis?: unknown[] }) {
  const canvasBp = bpFixture('cv', [4, 3]);
  return {
    linked: true, bps: [canvasBp], pos: [], sis: [], layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        { bps: page0.bps ?? [], pos: page0.pos ?? [], sis: page0.sis ?? [], tms: [] },
        { bps: [canvasBp], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3'],
    },
  };
}

async function shot(page: Page, selector: string, name: string): Promise<void> {
  const dir = process.env.REQ0273_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.locator(selector).first().screenshot({ path: path.join(dir, name) });
}

/** Colour populations of a board-space rect of a rendered canvas -- the
 * unit-skin-fallback probe, extended with the populations this spec needs. */
async function probe(page: Page, selector: string, box: { x: number; y: number; w: number; h: number }) {
  const canvas = page.locator(selector).first();
  await expect(canvas).toBeVisible();
  const bb = (await canvas.boundingBox())!;
  const b64 = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, box, cssWidth }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const el = document.createElement('canvas');
      el.width = img.width; el.height = img.height;
      const ctx = el.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const s = img.width / cssWidth;
      const d = ctx.getImageData(Math.round(box.x * s), Math.round(box.y * s), Math.round(box.w * s), Math.round(box.h * s)).data;
      let total = 0, fullGreen = 0, dimGreen = 0, rim = 0, itemBackdrop = 0;
      const near = (v: number, t: number, tol: number) => Math.abs(v - t) <= tol;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        total++;
        // full-opacity pure-green art over any backdrop
        if (g > 200 && r < 70 && b < 70) fullGreen++;
        // the SAME art at the old 0.44 dormancy dim over the dark grid:
        // 0.44*255 + 0.56*(~25) ~= 126 -- a clearly separated band
        if (g > 95 && g < 160 && r < 70 && b < 70) dimGreen++;
        // the outline rim #d7dfe6 (alpha .8 over near-black ink band)
        if (near(r, 0xb2, 28) && near(g, 0xba, 28) && near(b, 0xc0, 28) && b >= r) rim++;
        // a placed PO's own per-cell backdrop (#000 at 0.22 over #191919
        // grid: ~#131313) -- distinguishable from bare grid (#191919) only
        // in aggregate, so tests use it only as a NEGATIVE (absence) probe
        if (r < 0x16 && g < 0x16 && b < 0x16) itemBackdrop++;
      }
      return { total, fullGreen, dimGreen, rim, itemBackdrop };
    },
    { b64, box, cssWidth: bb.width },
  );
}

test.describe('REQ-0273 inventory art integrity + PO outlines', () => {
  test('1. inventory unit art renders at FULL opacity (bug 1)', async ({ page }) => {
    await routeUnitSkinArt(page, 'dwarf');
    await page.request.put('/api/profile/default/canvas', {
      data: profileWith({ bps: [bpFixture('home', [1, 1])] }),
    });
    await bootApp(page);
    await shot(page, 'canvas.inventory-board-canvas', 'inventory_unit_alpha.png');
    // Unit cell of the page-0 BP: origin [1,1] + off [2,1] = cell (3,2). The
    // art box is 44x44 centred in the cell; probe its inner 28x28.
    const region = { x: cx(2) - 14, y: cy(3) - 14, w: 28, h: 28 };
    const inv = await probe(page, 'canvas.inventory-board-canvas', region);
    expect(inv.fullGreen / inv.total).toBeGreaterThan(0.5); // art present, opaque
    expect(inv.dimGreen / inv.total).toBeLessThan(0.05); // and NOT the 0.44 blend
    // control: the canvas board (always alpha 1) shows the same population,
    // proving the probe bands actually discriminate.
    const cvRegion = { x: cx(4) - 14, y: cy(6) - 14, w: 28, h: 28 }; // canvas BP at [4,3], unit cell (6,4)
    const cv = await probe(page, 'canvas.board-canvas', cvRegion);
    expect(cv.fullGreen / cv.total).toBeGreaterThan(0.5);
  });

  test('2. a PO cannot be dropped onto an inventory unit cell (bug 2 law, through the UI)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', {
      data: profileWith({
        bps: [bpFixture('home', [1, 1])],
        pos: [{ uid: 'p1', id: 'hilt', loc: 'grid', cell: [5, 5], rot: 0 }],
      }),
    });
    await bootApp(page);
    const inv = page.locator('canvas.inventory-board-canvas').first();
    const bb = (await inv.boundingBox())!;
    // drag the 1x1 hilt from (5,5) onto the unit cell (3,2)
    await drag(page,
      { x: bb.x + cx(5), y: bb.y + cy(5) },
      { x: bb.x + cx(2), y: bb.y + cy(3) });
    const saved = await (await page.request.get('/api/profile/default/canvas')).json();
    const p1 = saved.canvas.inv.pages[0].pos.find((p: { uid: string }) => p.uid === 'p1');
    expect(p1.cell).toEqual([5, 5]); // refused: nothing committed, nothing saved
  });

  test('3. a poisoned save (PO on the unit cell) boots un-overlapped (bug 2 read-time rule)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', {
      data: profileWith({
        bps: [bpFixture('home', [1, 1])],
        // ILLEGAL by the engine's own law -- exactly what the pre-REQ-0273
        // rolled-BP first-fit could persist. cell (3,2) IS the unit cell.
        pos: [{ uid: 'px', id: 'hilt', loc: 'grid', cell: [3, 2], rot: 0 }],
      }),
    });
    await bootApp(page);
    await shot(page, 'canvas.inventory-board-canvas', 'inventory_poisoned_save.png');
    // The unit cell must carry NO PO furniture: no item backdrop, no outline
    // rim -- only grid + unit core/glyph. 12x12 corner probe, chosen OUTSIDE
    // the 26px core disc, the 44px glyph box and the reject-flash zone.
    const unitRegion = { x: PAD + 1 * CELL + 4, y: PAD + 2 * CELL + 4, w: 12, h: 12 };
    const u = await probe(page, 'canvas.inventory-board-canvas', unitRegion);
    expect(u.rim / u.total).toBeLessThan(0.02);
    expect(u.itemBackdrop / u.total).toBeLessThan(0.1);
    // ...and the PO was relocated to the first legal cell in row-major order:
    // (1,1), INSIDE the BP (full containment is legal; only the unit cell is
    // not). The render is the authoritative assertion (no user mutation has
    // happened, so the save need not have flushed): the relocated cell's top
    // boundary band now carries the outline rim. x starts +30 to stay clear
    // of the BP move-handle badge at (+14,+14) r12.
    const band = { x: PAD + 30, y: PAD + 1, w: CELL - 34, h: 9 };
    const b = await probe(page, 'canvas.inventory-board-canvas', band);
    expect(b.rim).toBeGreaterThan(0);
  });

  test('4. per-PO footprint outlines on a busy board (feature)', async ({ page }) => {
    await routeUnitSkinArt(page, 'dwarf');
    const fixture = profileWith({
      bps: [bpFixture('home', [1, 1])],
      pos: [
        // a tight cluster of adjacent items in the free area
        { uid: 'w1', id: 'blade', loc: 'grid', cell: [1, 4], rot: 0 }, // 2x1 vertical
        { uid: 'w2', id: 'dagger', loc: 'grid', cell: [1, 5], rot: 0 }, // 2x1 vertical, adjacent
        { uid: 'w3', id: 'tower_shield', loc: 'grid', cell: [3, 4], rot: 0 }, // 2x2 under them
        { uid: 'w4', id: 'beast_jaw', loc: 'grid', cell: [1, 6], rot: 0 }, // L-shape
        { uid: 'w5', id: 'hilt', loc: 'grid', cell: [3, 6], rot: 0 }, // 1x1
        // and one INSIDE the BP, on non-unit cells
        { uid: 'w6', id: 'oil_flask', loc: 'grid', cell: [1, 1], rot: 0 }, // 2x1 vertical inside BP
      ],
    });
    // REQ-0033 usage wash: squad 2 references the tower_shield, so it renders
    // under the other-squad tint -- the outline must stay legible on it.
    fixture.presets = { active: 0, names: ['P1', 'P2'], store: [null, { linked: true, bps: [], pos: [{ uid: 'w3', id: 'tower_shield', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] }] } as never;
    await page.request.put('/api/profile/default/canvas', { data: fixture });
    await bootApp(page);
    await shot(page, 'canvas.inventory-board-canvas', 'busy_board_outlines.png');
    // Rim present in the inset boundary band of the 2x2 tower_shield
    // (top edge band of cell (3,4), inset 3px +- ink width).
    const topBand = { x: PAD + 3 * CELL + 8, y: PAD + 2 * CELL + 1, w: 2 * CELL - 16, h: 9 };
    const t = await probe(page, 'canvas.inventory-board-canvas', topBand);
    expect(t.rim).toBeGreaterThan(20);
    // Adjacent blade|dagger: the shared boundary column shows TWO rims with a
    // dark seam -- i.e. rim population in a 14px-wide band straddling the
    // border between (1,4) and (1,5).
    const seam = { x: PAD + 4 * CELL - 7, y: PAD + 10, w: 14, h: CELL - 20 };
    const sm = await probe(page, 'canvas.inventory-board-canvas', seam);
    expect(sm.rim).toBeGreaterThan(20);
    // The unit cell is NOT outlined (units are not POs) -- also the calm
    // negative: this band is grid + glyph corner only, so any rim population
    // here would mean the outline leaked off the PO footprints. (A centre
    // probe over item ART is deliberately NOT asserted: art palettes may
    // legitimately contain the rim's steel family; boundary-only stroking is
    // pinned structurally by check_po_outline.mjs instead.)
    const unitBand = { x: PAD + 1 * CELL + 8, y: PAD + 2 * CELL + 1, w: CELL - 16, h: 9 };
    const ub = await probe(page, 'canvas.inventory-board-canvas', unitBand);
    expect(ub.rim / ub.total).toBeLessThan(0.02);
  });
});
