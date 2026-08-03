// client/e2e/board-render-ondemand.spec.ts -- REQ-0345.
//
// The board Applications no longer run a Pixi Ticker (BoardRenderer.mount()
// passes autoStart:false); every paint is asked for explicitly. This spec
// holds BOTH ends of that bargain, because each end is worthless alone:
//
//   1. THE WASTE IS GONE. An untouched board must submit exactly ZERO frames,
//      including on a route where both boards are display:none -- which is
//      where the pre-REQ-0345 cost was worst (REQ-0344 measured the
//      SwiftShader gpu-process at 500-660% of 8 cores on a DOM-only admin
//      console). Asserted against __backpackDebug.boardPaints(), the counter
//      wrapped around renderer.render in BoardRenderer.mount().
//
//      A zero from a broken probe looks exactly like a zero from a fixed bug,
//      so test 1 never asserts the zero alone: it makes the SAME counter move
//      on a known-good render in the same test. (The obvious instrument --
//      patching the WebGL context from the page -- was measured reading zero
//      even during a real state change. See client/src/board/paintProbe.ts,
//      which says what is explained about that and what is not.)
//
//   2. THE ANIMATIONS STILL PAINT. Three things mutate the scene graph
//      OUTSIDE render(state) and never called render() themselves; they were
//      painted by the Ticker alone. Turn it off naively and all three go
//      silently invisible with every pre-existing test still green -- nothing
//      in the suite asserted that anything on a board was PAINTED. So these
//      are pixel tests: Playwright screenshots the canvas (the COMPOSITED
//      result -- what the player sees) and the colour population is counted
//      in-page, the probe pattern unit-skin-fallback.spec.ts test 4
//      established. Each one is differential -- the colour must be absent
//      before and present during -- so it cannot pass on some pre-existing
//      pixel of the same hue.
//
// The claim pulse (ghosts.ts pulseCellsSuccess) is the third of those three
// and is NOT tested here. It has its own spec, claim-pulse.spec.ts, because
// it needs the real warehouse-claim flow (dev item_admin grant + a claim
// press) rather than this file's local board fixture. REQ-0345 left it
// untested for a stronger reason than scope: it did not reach the screen at
// all, and had not before REQ-0345 either -- ZERO pixels of its #59d68a
// across 22 samples spanning the whole 2s window, both with autoStart:false
// and with the Ticker put back, so a test here would have been green
// theatre. REQ-0346 root-caused that (the notifyStateChanged() on the line
// after the pulse re-enters render(state), whose first act was
// gTarget.removeChildren()), moved the pulse onto its own gPulse layer that
// render(state) never clears, and brought the pixel assertion with it. The
// paint path itself was already proven at the time: delaying that one call by
// 600ms in a throwaway diagnostic build made the blinks appear and disappear
// on the exact 330ms rhythm, 596 px per blink, with no Ticker running.
import { test, expect, type Page } from '@playwright/test';
import { bootApp, cx, cy } from './helpers';

type Counts = Record<string, number>;

const REJECT_RED: [number, number, number] = [0xc0, 0x50, 0x50]; // ghosts.ts flash()
const DROP_OK_GREEN: [number, number, number] = [0x00, 0x9e, 0x73]; // OVERLAY.dropTarget.ok (Okabe-Ito bluish-green)

const paints = (page: Page): Promise<Counts> =>
  page.evaluate(() => (window as unknown as { __backpackDebug: { boardPaints: () => Counts } }).__backpackDebug.boardPaints());

/**
 * How many pixels of a board canvas sit within `tol` of `rgb`, over the WHOLE
 * canvas. Playwright hands back a PNG of the composited element; it goes back
 * into the page as a data URL and the browser decodes it -- no decoder to
 * maintain, no dependency to add (unit-skin-fallback.spec.ts's probe(), with
 * the region widened to the full canvas and the palette made a parameter).
 */
async function colourHits(page: Page, selector: string, rgb: [number, number, number], tol = 24): Promise<number> {
  const canvas = page.locator(selector).first();
  await expect(canvas).toBeVisible();
  const b64 = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, rgb, tol }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const el = document.createElement('canvas');
      el.width = img.width;
      el.height = img.height;
      const ctx = el.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let hits = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) hits++;
      }
      return hits;
    },
    { b64, rgb, tol },
  );
}

/** A 4x4 BP on the canvas holding one PINNED PO (single pointerdown -> reject
 * flash, BoardRenderer.handlePOPointerDown's `p.fixed` short-circuit) and one
 * free PO to drag. The BP's inventory HOME sits on page 1, exactly as
 * bp-rotate.spec.ts's fixture does and for the same reason: under the
 * reference model a canvas BP with no home at all is a state no real client
 * could produce, and migrateCanvasToReferencesV3 would first-fit it onto an
 * inventory page mid-boot and move everything this spec measures. */
function makeCanvas() {
  const block = { shape: [] as number[][], unit: { id: 'dwarf', off: [0, 0] } };
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) block.shape.push([r, c]);
  const bp = { id: 'e2e_ondemand_bp', name: 'On Demand', color: '#4a90d9', origin: [2, 2], ...block };
  const pos = [
    { uid: 'e2e_pinned', id: 'hilt', loc: 'grid', cell: [3, 3], rot: 0, fixed: true },
    { uid: 'e2e_free', id: 'hilt', loc: 'grid', cell: [5, 5], rot: 0 },
  ];
  const empty = () => ({ bps: [], pos: [], sis: [], tms: [] });
  return {
    linked: true,
    bps: [bp],
    pos,
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [empty(), { bps: [bp], pos, sis: [], tms: [] }, empty(), empty(), empty()],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

test.describe('REQ-0345 -- the boards render on demand', () => {
  test('1. an untouched board submits ZERO frames, on a board route and on a DOM-only one (and the same counter still moves for a real render)', async ({ page }) => {
    await bootApp(page);
    await page.mouse.move(5, 5); // park the pointer off BOTH canvases -- hover is a legitimate repaint trigger

    // (a) idle on the board route.
    await page.waitForTimeout(300);
    const a0 = await paints(page);
    await page.waitForTimeout(3000);
    const a1 = await paints(page);
    expect(a1['canvas'] - a0['canvas']).toBe(0);
    expect(a1['inv:0'] - a0['inv:0']).toBe(0);

    // (b) idle on a route where BOTH boards are display:none (App.tsx keeps
    // them mounted for every route -- REQ-0034 -- so this is precisely the
    // case the Ticker used to burn ~60 frames/s/board on, unseen).
    await page.locator('.nav-link', { hasText: 'Dex' }).click();
    await page.waitForTimeout(800);
    await page.mouse.move(5, 5);
    const b0 = await paints(page);
    await page.waitForTimeout(3000);
    const b1 = await paints(page);
    expect(b1['canvas'] - b0['canvas']).toBe(0);
    expect(b1['inv:0'] - b0['inv:0']).toBe(0);

    // (c) THE ZERO IS NOT VACUOUS. The same counter, read the same way, must
    // climb for a render that certainly happened. Without this, a probe that
    // had simply stopped working would pass (a) and (b) perfectly.
    await page.locator('.nav-link', { hasText: 'Backpacks' }).click();
    await page.waitForTimeout(500);
    const c0 = await paints(page);
    await page.locator('.inv-tab').nth(1).click();
    await expect
      .poll(async () => (await paints(page))['inv:0'] - c0['inv:0'], { timeout: 5000 })
      .toBeGreaterThan(0);
  });

  test('2. the reject flash is DRAWN and then UNDRAWN -- red pixels appear on the pointerdown and are gone when its 350ms timer fires', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const board = page.locator('canvas.board-canvas').first();
    const box = (await board.boundingBox())!;

    const before = await colourHits(page, 'canvas.board-canvas', REJECT_RED);
    expect(before).toBe(0);

    // A pinned starter PO refuses to lift and flashes its locked cells
    // instead (BoardRenderer.handlePOPointerDown). No engine mutation, so
    // nothing else in the app will repaint this board -- flash() has to.
    await page.mouse.move(box.x + cx(3), box.y + cy(3));
    await page.mouse.down();
    await page.mouse.up();

    // FLASH_MS is 350; sample inside it.
    const during = await colourHits(page, 'canvas.board-canvas', REJECT_RED);
    expect(during).toBeGreaterThan(100);

    // ...and the timer's own removal must repaint too, or the outline would
    // stay on screen forever now that no frame loop sweeps it away.
    await expect
      .poll(async () => colourHits(page, 'canvas.board-canvas', REJECT_RED), { timeout: 5000, intervals: [120, 120, 120, 250, 250, 500] })
      .toBe(0);
  });

  test('3. the drag drop-target tint is DRAWN while a carry is in flight and gone after the drop', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const board = page.locator('canvas.board-canvas').first();
    const box = (await board.boundingBox())!;

    const before = await colourHits(page, 'canvas.board-canvas', DROP_OK_GREEN);
    expect(before).toBe(0);

    // Grab the free PO at [5,5] and hold it over the empty in-BP cell [4,4].
    // onGlobalPointerMove rebuilds gTarget (the legality tint) and gCarry (the
    // ghost art) on every move and calls NOTHING that would repaint by itself.
    await page.mouse.move(box.x + cx(5), box.y + cy(5));
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      await page.mouse.move(box.x + cx(5) + (cx(4) - cx(5)) * t, box.y + cy(5) + (cy(4) - cy(5)) * t);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(120);

    const during = await colourHits(page, 'canvas.board-canvas', DROP_OK_GREEN);
    expect(during).toBeGreaterThan(100);

    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await colourHits(page, 'canvas.board-canvas', DROP_OK_GREEN)).toBe(0);
  });
});
