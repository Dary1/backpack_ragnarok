// client/e2e/run-history.spec.ts -- REQ-0372: expedition run history.
//
// The gate: TWO settled runs of one room -> the History fold under the monitor
// lists 2 rows -> clicking the OLDER row loads THAT run into the monitor and
// its REQ-0099 transport controls drive it. Everything the fold shows is
// server-derived (GET .../runs), so this spec asserts the API and the UI agree
// rather than trusting either alone.
//
// Time control: the same seam every other settle-dependent spec uses -- the
// dev_mode fallback player (no token at all) plus POST .../dev/backdate, which
// only moves a run's startedAt. Producing a SECOND run additionally needs the
// room's cooldown out of the way; there is no dev seam for that, so the spec
// rewrites `cooldownUntil` on the room doc in ITS OWN worker's throwaway HOME
// (E2E_DATA_ROOT -- REQ-0217 hermetic fleet), the same directly-on-disk access
// schedule.spec.ts's cleanup sweep already uses. It touches nothing but that
// one timestamp: no run, no seed, no reward.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_DATA_ROOT } from './e2e-env';
import { drainNotifications } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const SCHEDULE_FIXTURE_PATH = new URL('./fixtures/schedule-fixture.json', import.meta.url);
const fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));

const roomsDir = join(REPO_ROOT, 'data', 'schedule', 'rooms');
const runsDir = join(REPO_ROOT, 'data', 'schedule', 'runs');
const createdRoomIds: string[] = [];

function roomDocPath(roomId: string): string { return join(roomsDir, roomId + '.json'); }

/** Rewrites ONLY the room's cooldownUntil. `null` lets the next poll auto-start
 * the following dive; a future ISO stamp parks the room so no third dive can
 * depart mid-assertion and move the "latest run" under the test's feet. */
function setCooldown(roomId: string, value: string | null): void {
  const p = roomDocPath(roomId);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  doc.cooldownUntil = value;
  writeFileSync(p, JSON.stringify(doc, null, 1));
}

async function devJSON(page: Page, method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown): Promise<any> {
  // No X-Auth-Token: every request here resolves through the dev_mode fallback
  // (the only caller dev/backdate accepts).
  const res = await page.request[method](url, data === undefined ? undefined : { data });
  return { status: res.status(), body: await res.json() };
}

/** Force the room's in-flight run's clock elapsed, then poll until the lazy
 * settle has actually applied. Returns the run id that settled. */
async function settleCurrentRun(page: Page, roomId: string): Promise<string> {
  const before = await devJSON(page, 'get', `/api/schedule/rooms/${roomId}`);
  const runId: string = before.body.room.lastRunId;
  expect(runId, 'the room has a dive in flight to settle').toBeTruthy();
  const bd = await devJSON(page, 'post', `/api/schedule/rooms/${roomId}/dev/backdate`, { extraSecsIntoPast: 5 });
  expect(bd.status).toBe(200);
  await expect(async () => {
    const view = await devJSON(page, 'get', `/api/schedule/rooms/${roomId}`);
    expect(view.body.room.status).not.toBe('active');
  }).toPass({ timeout: 10000 });
  return runId;
}

async function startNextDive(page: Page, roomId: string): Promise<void> {
  setCooldown(roomId, null);
  await expect(async () => {
    const view = await devJSON(page, 'get', `/api/schedule/rooms/${roomId}`);
    expect(view.body.room.status).toBe('active');
  }).toPass({ timeout: 10000 });
}

test.describe('REQ-0372: expedition run history', () => {
  test('two settled runs -> the History fold lists 2 rows; the older row loads into the monitor and its transport drives that replay', async ({ page }) => {
    const devProfilePath = join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileBackup = existsSync(devProfilePath) ? readFileSync(devProfilePath, 'utf8') : null;
    let roomId = '';
    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });
      const created = await devJSON(page, 'post', '/api/schedule/rooms', { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
      expect(created.status).toBe(200);
      roomId = created.body.room.id;
      createdRoomIds.push(roomId);
      for (let i = 0; i < 4; i++) {
        const r = await devJSON(page, 'put', `/api/schedule/rooms/${roomId}/slots/${i}`, { squadIndex: i });
        expect(r.status).toBe(200);
      }
      await expect(async () => {
        const view = await devJSON(page, 'get', `/api/schedule/rooms/${roomId}`);
        expect(view.body.room.status).toBe('active');
      }).toPass({ timeout: 10000 });

      const firstRunId = await settleCurrentRun(page, roomId);
      await startNextDive(page, roomId);
      const secondRunId = await settleCurrentRun(page, roomId);
      expect(secondRunId).not.toBe(firstRunId);
      // Park the room: no third dive may depart while the UI is being asserted.
      setCooldown(roomId, new Date(Date.now() + 60 * 60 * 1000).toISOString());

      // ---- the API the fold reads ----
      const history = await devJSON(page, 'get', `/api/schedule/rooms/${roomId}/runs`);
      expect(history.status).toBe(200);
      expect(history.body.runs.map((r: { runId: string }) => r.runId)).toEqual([secondRunId, firstRunId]);
      expect(history.body.tally.victory + history.body.tally.wipe + history.body.tally.incomplete).toBe(2);

      // ---- the fold itself ----
      // The settles above produced run_settled entries for the dev caller;
      // drain them so the digest modal is not covering the card to be clicked.
      await drainNotifications(page);
      await page.goto('/app/#/schedule');
      await expect(page.locator('.schedule-page')).toBeVisible({ timeout: 10000 });
      const card = page.locator(`[data-room-id="${roomId}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
      const pane = page.locator('[data-testid="schedule-detail-pane"]');
      await expect(pane.locator('[data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });

      const fold = pane.locator('[data-testid="schedule-history"]');
      await expect(fold).toBeVisible({ timeout: 10000 });
      // Spec item 3: the W/L tally at the fold head, scoped to the listed window.
      await expect(fold.locator('[data-testid="schedule-history-tally"]')).toBeVisible();
      await fold.locator('[data-testid="schedule-history-toggle"]').click();
      const rows = fold.locator('[data-testid="schedule-history-row"]');
      await expect(rows).toHaveCount(2);
      // Newest first -- the same order the API served.
      await expect(rows.nth(0)).toHaveAttribute('data-run-id', secondRunId);
      await expect(rows.nth(1)).toHaveAttribute('data-run-id', firstRunId);

      // ---- the older row's replay loads into the monitor ----
      const monitor = pane.locator('[data-testid="schedule-monitor"]');
      await expect(monitor).toHaveAttribute('data-run-id', secondRunId, { timeout: 10000 });
      await rows.nth(1).click();
      await expect(monitor).toHaveAttribute('data-run-id', firstRunId, { timeout: 10000 });
      await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');

      // ---- and the REQ-0099 transport drives THAT replay ----
      await expect(pane.locator('[data-testid="schedule-monitor-play"]')).toBeVisible({ timeout: 10000 });
      const clock = pane.locator('[data-testid="schedule-monitor-clock"]');
      await pane.locator('[data-testid="schedule-monitor-scrub"]').click({ position: { x: 1, y: 4 } });
      await expect(async () => {
        const m = /^(\d\d):(\d\d) \/ (\d\d):(\d\d)$/.exec((await clock.textContent()) || '');
        expect(m).toBeTruthy();
        const elapsed = Number(m![1]) * 60 + Number(m![2]);
        const total = Number(m![3]) * 60 + Number(m![4]);
        expect(elapsed).toBeLessThanOrEqual(Math.max(3, Math.round(total * 0.1)));
      }).toPass({ timeout: 5000 });
      await pane.locator('[data-testid="schedule-monitor-skip-end"]').click();
      await expect(async () => {
        const m = /^(\d\d:\d\d) \/ (\d\d:\d\d)$/.exec((await clock.textContent()) || '');
        expect(m).toBeTruthy();
        expect(m![1]).toBe(m![2]);
      }).toPass({ timeout: 5000 });

      // ---- back to the room's latest run ----
      await fold.locator('[data-testid="schedule-history-latest"]').click();
      await expect(monitor).toHaveAttribute('data-run-id', secondRunId, { timeout: 10000 });

      await devJSON(page, 'delete', `/api/schedule/rooms/${roomId}`);
    } finally {
      if (devProfileBackup !== null) writeFileSync(devProfilePath, devProfileBackup);
      else if (existsSync(devProfilePath)) rmSync(devProfilePath, { force: true });
    }
  });
});

test.afterAll(async () => {
  // Same belt-and-suspenders sweep schedule.spec.ts performs: this worker's
  // HOME is throwaway, but a room/run left behind would still be visible to a
  // later spec sharing the worker.
  const { readdirSync } = await import('node:fs');
  for (const roomId of createdRoomIds) {
    if (existsSync(roomDocPath(roomId))) rmSync(roomDocPath(roomId));
  }
  if (existsSync(runsDir)) {
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const doc = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
        if (createdRoomIds.includes(doc.roomId)) rmSync(join(runsDir, f));
      } catch { /* skip unreadable/corrupt */ }
    }
  }
});
