// REQ-0031 Phase A -- Step 4: baseline E2E smoke tests beyond the two
// bugs. Cheap, high-value coverage for the core interactions the bug
// fixes must not have broken.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE_PATH = new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url);

async function loadFixtureAndBoot(page: import('@playwright/test').Page) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await page.goto('/app/');
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(400);
}

const CELL = 80;
const PAD = 38;
const cx = (c: number) => PAD + (c - 1) * CELL + CELL / 2;
const cy = (r: number) => PAD + (r - 1) * CELL + CELL / 2;

async function drag(
  page: import('@playwright/test').Page,
  grab: { x: number; y: number },
  drop: { x: number; y: number },
  steps = 8
) {
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

async function saveAndFetch(page: import('@playwright/test').Page) {
  await page.locator('button:has-text("Save")').click();
  await page.waitForTimeout(400);
  const resp = await page.request.get('/api/profile/default/canvas');
  return (await resp.json()).canvas;
}

test('app boots and shows the live data-source indicator', async ({ page }) => {
  await page.goto('/app/');
  const badge = page.locator('.data-source-badge');
  await expect(badge).toHaveText('live', { timeout: 10000 });
  await expect(badge).toHaveClass(/badge-live/);
  await expect(page.locator('h1')).toHaveText('backpack_ragnarok');
});

test('free PO drags from inventory grid to a legal canvas BP slot, and back', async ({ page }) => {
  await loadFixtureAndBoot(page);
  const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
  const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

  // p200 (hilt, free-placed, not inside any BP) sits at inv page0 cell
  // (4,4). Drag it onto canvas BP "gamma"'s one free non-linker cell (6,3).
  await drag(
    page,
    { x: invBox.x + cx(4), y: invBox.y + cy(4) },
    { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) }
  );
  let canvas = await saveAndFetch(page);
  let po = canvas.pos.find((p: any) => p.uid === 'p200');
  expect(po).toBeTruthy();
  expect(po.loc).toBe('grid');
  expect(po.cell).toEqual([6, 3]);
  expect(canvas.inv.pages[0].pos.some((p: any) => p.uid === 'p200')).toBe(false);

  // Reverse: drag it back from canvas to a free inventory cell, e.g. (4,4).
  await page.reload();
  await expect(page.locator('.data-source-badge')).toHaveText('live', { timeout: 10000 });
  await page.waitForTimeout(400);
  const invBox2 = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
  const canvasBox2 = (await page.locator('canvas.board-canvas').first().boundingBox())!;
  await drag(
    page,
    { x: canvasBox2.x + cx(3), y: canvasBox2.y + cy(6) },
    { x: invBox2.x + cx(4), y: invBox2.y + cy(4) }
  );
  canvas = await saveAndFetch(page);
  expect(canvas.pos.some((p: any) => p.uid === 'p200')).toBe(false);
  po = canvas.inv.pages[0].pos.find((p: any) => p.uid === 'p200');
  expect(po).toBeTruthy();
  expect(po.cell).toEqual([4, 4]);
});

test('double-click a canvas PO rotates it (verified via Save + profile fetch)', async ({ page }) => {
  await loadFixtureAndBoot(page);
  const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

  // p4 (tower_shield, a 2x2 PO whose footprint is rotation-symmetric) sits
  // at canvas cell (1,5), rot 0, inside BP Beta, in the fixture -- a
  // 2x2 shape's rotation stays fully legal in place (no dead-space/
  // occupied conflict, confirmed via a direct engine.rotatePO() sanity
  // check before writing this test: several other candidate POs in this
  // fixture (dagger, blade, herb_pouch) legitimately REJECT a 90-degree
  // rotation in their current cramped positions -- Dead Space/occupied --
  // which is correct engine behavior, not a bug, so tower_shield was
  // chosen specifically because its rotation is unconditionally legal
  // there.
  const before = await saveAndFetch(page);
  const rotBefore = before.pos.find((p: any) => p.uid === 'p4').rot;
  expect(rotBefore).toBe(0);

  const x = canvasBox.x + cx(5);
  const y = canvasBox.y + cy(1);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(200);

  const after = await saveAndFetch(page);
  const rotAfter = after.pos.find((p: any) => p.uid === 'p4').rot;
  expect(rotAfter).not.toBe(rotBefore);
  expect(rotAfter).toBe(1); // rotatePO steps 0 -> 1 (90 deg CW), per engine.js convention
});
