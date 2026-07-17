// Shared E2E helpers — REQ-0031 Phase A scaffold, extended Phase B.
//
// CELL/PAD/cx/cy are the same board-canvas pixel-space constants BoardRenderer
// uses (client/src/board/BoardRenderer.ts) -- kept duplicated here rather than
// imported since e2e/ tests treat the app as a black box (real browser, real
// network) and never import client source directly.
//
// REQ-0031 Phase B: Save/Load buttons are retired (auto-save runs in the
// background, debounced ~800ms after every mutation -- see
// client/src/store.ts's scheduleAutoSave()). Every existing spec that used
// to click a "Save" button before reading back /api/profile/default/canvas
// now instead calls waitForAutoSave(), which simply waits out the debounce
// window with margin, then reads the profile back directly -- no UI
// interaction is needed to trigger the write at all, which is itself part
// of what Phase B's auto-save E2E coverage is verifying.
import type { Page } from '@playwright/test';

export const CELL = 80;
export const PAD = 38;
export const cx = (c: number) => PAD + (c - 1) * CELL + CELL / 2;
export const cy = (r: number) => PAD + (r - 1) * CELL + CELL / 2;

/** Drags from (screen) grab to drop with >=5 intermediate move steps,
 * matching the task spec's "multi-step move" requirement (trusted CDP
 * input, not a synthetic dragstart/drop). */
export async function drag(
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

/** REQ-0031 Phase B, rewritten by REQ-0234 (F3): wait for the auto-save
 * PUT itself (client/src/store.ts debounces ~800ms after every mutation)
 * instead of sleeping a fixed 800+margin window. Event-based, so box load
 * cannot lose the race (the fixed wait was the suite's single biggest
 * wall-clock dependency, called from nearly every mutation spec), and the
 * common case returns as soon as the write completes (~0.9s) instead of
 * always burning 1.5s. If NO page-side PUT arrives inside the old budget
 * plus 2.5s of load headroom (e.g. the save already flushed before this
 * call), it falls through quietly -- same semantics the fixed wait had.
 * page.request fixture PUTs (loadFixtureAndBoot) are not page traffic and
 * cannot false-satisfy the wait. */
export async function waitForAutoSave(page: Page, marginMs = 700): Promise<void> {
  try {
    await page.waitForResponse(
      (r) => r.url().includes('/api/profile/') && r.request().method() === 'PUT',
      { timeout: 800 + marginMs + 2500 },
    );
  } catch {
    /* no auto-save PUT observed inside the budget -- proceed, as the legacy
       fixed wait would have after its window elapsed */
  }
}

/** GETs /api/profile/default/canvas and returns its `canvas` field. */
export async function fetchSavedCanvas(page: Page): Promise<any> {
  const resp = await page.request.get('/api/profile/default/canvas');
  return (await resp.json()).canvas;
}

/** Convenience: waits for the auto-save debounce, then fetches the saved
 * canvas -- the direct replacement for the old saveAndFetch(page) helper
 * (which used to click a Save button first). */
export async function autoSaveAndFetch(page: Page): Promise<any> {
  await waitForAutoSave(page);
  return fetchSavedCanvas(page);
}

/** Boots the app and waits for the live data-source badge, same
 * boilerplate every spec repeats. */
export async function bootApp(page: Page): Promise<void> {
  // REQ-0069: '/app/' with an EMPTY hash boots the landing (title)
  // screen, which renders no header/badge -- app-page specs boot straight
  // into the backpacks route (the pre-REQ-0069 default) explicitly.
  // Landing-specific coverage lives in landing.spec.ts.
  await page.goto('/app/#/backpacks');
  await page.locator('.data-source-badge').waitFor({ state: 'visible', timeout: 10000 });
  const text = await page.locator('.data-source-badge').textContent({ timeout: 10000 });
  if (text?.trim() !== 'live') {
    await page.waitForFunction(
      () => document.querySelector('.data-source-badge')?.textContent?.trim() === 'live',
      { timeout: 10000 }
    );
  }
  await page.waitForTimeout(400);
}

/** Loads a JSON fixture as the live profile (PUT, bypassing the app), then
 * boots. Mirrors every existing spec's loadFixtureAndBoot(). */
export async function loadFixtureAndBoot(page: Page, fixture: unknown): Promise<void> {
  await page.request.put('/api/profile/default/canvas', { data: fixture });
  await bootApp(page);
}

/** ~600ms hold-in-place on a locator's center point -- arms LongPressTabs'
 * rename mode (client/src/LongPressTabs.tsx's LONG_PRESS_MS=600). Uses a
 * generous 750ms hold (matches the task's "~600ms" with margin) and never
 * moves the pointer (staying well under LongPressTabs' 8px tolerance). */
export async function longPress(page: Page, box: { x: number; y: number; width: number; height: number }, holdMs = 750): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
