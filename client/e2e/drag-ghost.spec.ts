// client/e2e/drag-ghost.spec.ts -- REQ-0288: drag ghosts restored.
//
// Seam: window.__backpackBoardProbes['canvas']() -> { ghost, reverts } -- the
// honest render-side probe REQ-0288 added (BoardRenderer.ghostProbe /
// .revertCount). Specs assert structure, never canvas pixels.
//
//   T1 pins THE regression this REQ exists for: a PO whose art exists ONLY as
//      a registry raster (def.icon rewritten to a key the sprite sheet does
//      not carry + an art_urls entry) must still ghost WITH art while
//      dragged. Pre-REQ-0288, ghosts.ts resolved textures.get(def.icon) --
//      the legacy sprite key only -- and returned early: the drag was
//      INVISIBLE for every registry-art PO (most of the corpus, REQ-0133).
//   T2 pins the never-invisible law: art nowhere at all -> the neutral
//      footprint fallback still ghosts (probe non-null, hasArt false).
//   T3 pins the BP lift: whole-bag ghost on legal AND illegal hovers, cells
//      count preserved, contained-PO art riding along (hasArt).
//   T4 pins the revert cue on an illegal drop: state untouched, exactly one
//      "snapped home" feedback fired on the origin board.
//   T5 pins the same for Esc-cancel.
//
// All pointer coordinates are BOARD-LOCAL cx/cy plus the board <canvas>
// element's own page box -- the same convention every other drag spec here
// uses (raw cx/cy without the box was this spec's own first bug).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootApp, cx, cy, fetchSavedCanvas, loadFixtureAndBoot } from './helpers';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/bp-transfer-fixture.json', import.meta.url), 'utf8'));
// Geometry recap (bp-transfer-fixture): alpha 3x2 @ (1,1) unit off [2,1],
// beta 2x3 @ (1,4), gamma 3x2 @ (4,2), delta 2x2 @ (4,5); dagger p5 @ [4,3]
// (inside gamma); rows 7-8 and cols 7-8 are free dead space. linked:true, so
// the blade+hilt merged-sword assembly sits on col 1 rows 1-3 -- keep drags
// away from it except where a test says otherwise.

/** Minimal valid 1x1 red PNG -- the raster route needs pixels, not beauty. */
const RED_DOT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Rewrites dagger's def.icon to a key the SVG sprite does not carry, so its
 * art resolves ONLY through the registry rung (art_urls) -- or not at all. */
async function routeDaggerRegistryOnly(page: Page, withArt: boolean): Promise<void> {
  await page.route((url) => url.pathname === '/api/content', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.items = { ...j.items, dagger: { ...j.items.dagger, icon: 'icon-e2e-bogus-0288' } };
    if (withArt) j.art_urls = { ...(j.art_urls ?? {}), dagger: RED_DOT };
    else if (j.art_urls) delete j.art_urls.dagger;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
}

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

/** Pointer-down + arm + glide to `to` -- WITHOUT releasing (mid-drag probes). */
async function dragHold(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { steps: 1 });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
}

test('T1: registry-only-art PO ghosts WITH art while dragged', async ({ page }) => {
  await routeDaggerRegistryOnly(page, true);
  await loadFixtureAndBoot(page, FIXTURE);
  await page.waitForTimeout(400); // raster decode headroom
  const b = await canvasBox(page);
  await dragHold(page, { x: b.x + cx(3), y: b.y + cy(4) }, { x: b.x + cx(5), y: b.y + cy(7) });
  const p = await canvasProbe(page);
  expect(p?.ghost, 'ghost probe must be live mid-drag').not.toBeNull();
  expect(p!.ghost!.kind).toBe('po');
  expect(p!.ghost!.hasArt, 'registry raster must reach the ghost (THE REQ-0288 regression)').toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('T2: art nowhere -> neutral footprint fallback still ghosts', async ({ page }) => {
  await routeDaggerRegistryOnly(page, false);
  await loadFixtureAndBoot(page, FIXTURE);
  const b = await canvasBox(page);
  await dragHold(page, { x: b.x + cx(3), y: b.y + cy(4) }, { x: b.x + cx(5), y: b.y + cy(7) });
  const p = await canvasProbe(page);
  expect(p?.ghost, 'a drag must NEVER be invisible').not.toBeNull();
  expect(p!.ghost!.kind).toBe('po');
  expect(p!.ghost!.hasArt).toBe(false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('T3: BP drag ghosts the whole bag on legal AND illegal hovers', async ({ page }) => {
  await loadFixtureAndBoot(page, FIXTURE);
  const b = await canvasBox(page);
  // Grab alpha by its ✥ badge (top-left cell corner + 14px; grabOff = (0,0)).
  await dragHold(page, { x: b.x + 38 + 14, y: b.y + 38 + 14 }, { x: b.x + cx(7), y: b.y + cy(6) }); // -> origin (6,7): rows 6-8 x cols 7-8, all free
  let p = await canvasProbe(page);
  expect(p?.ghost).not.toBeNull();
  expect(p!.ghost!.kind).toBe('bp');
  expect(p!.ghost!.legal).toBe(true);
  expect(p!.ghost!.cells.length).toBe(6);
  expect(p!.ghost!.hasArt, 'contained-PO art must ride along (blade/flame_tablet)').toBe(true);
  await page.screenshot({ path: 'test-results/req0288-bp-ghost-legal.png' });
  // Glide onto beta's footprint -> illegal, but the ghost must STILL draw.
  await page.mouse.move(b.x + cx(4), b.y + cy(1), { steps: 4 });
  await page.waitForTimeout(150);
  p = await canvasProbe(page);
  expect(p!.ghost!.kind).toBe('bp');
  expect(p!.ghost!.legal).toBe(false);
  expect(p!.ghost!.cells.length).toBe(6);
  await page.screenshot({ path: 'test-results/req0288-bp-ghost-illegal.png' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('T4: illegal drop reverts -- state untouched + one snapped-home cue', async ({ page }) => {
  await loadFixtureAndBoot(page, FIXTURE);
  const b = await canvasBox(page);
  await dragHold(page, { x: b.x + 38 + 14, y: b.y + 38 + 14 }, { x: b.x + cx(4), y: b.y + cy(1) }); // over beta: illegal
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p = await canvasProbe(page);
  expect(p!.reverts).toBe(1);
  const saved = await fetchSavedCanvas(page);
  expect(saved.bps.find((z: { id: string }) => z.id === 'alpha').origin).toEqual([1, 1]);
});

test('T5: Esc-cancel reverts -- state untouched + one snapped-home cue', async ({ page }) => {
  await loadFixtureAndBoot(page, FIXTURE);
  const b = await canvasBox(page);
  await dragHold(page, { x: b.x + 38 + 14, y: b.y + 38 + 14 }, { x: b.x + cx(7), y: b.y + cy(6) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p = await canvasProbe(page);
  expect(p!.reverts).toBe(1);
  const saved = await fetchSavedCanvas(page);
  expect(saved.bps.find((z: { id: string }) => z.id === 'alpha').origin).toEqual([1, 1]);
  await bootApp(page); // still boots clean after cancel (no dangling carry)
});
