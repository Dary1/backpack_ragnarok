// client/e2e/notification-center.spec.ts -- REQ-0368.
//
// The three e2e gates the REQ names, end to end through the real browser
// against a hermetic per-worker backend:
//   1. settle a run -> the header bell lights + the SCHEDULE rail badge
//      appears -> opening the bell marks read and BOTH clear;
//   2. a warehouse row entering the <24h expiry window -> the WAREHOUSE
//      rail badge appears;
//   3. booting with unseen news -> the login digest modal appears, and a
//      reload after dismissing it does NOT show it again.
//
// TIME CONTROL: this suite never waits real time. A run's clock is moved by
// REQ-0036's POST .../dev/backdate, and a warehouse row's TTL by REQ-0368's
// own sibling seam POST /api/warehouse/dev/backdate-expiry -- both gated to
// the dev_mode fallback caller, both pure timestamp moves. The 7-day TTL and
// its last-24h window are otherwise unobservable in a test.
//
// POLL CADENCE: the app polls the feed every 15s (NOTIFY_POLL_MS, unchanged
// from REQ-0327). Tests that seed news BEFORE booting see it on the FIRST
// poll; the one test that must seed AFTER booting budgets for a full poll
// interval, which is why this file raises its own timeout.
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootApp } from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

// A squad that reliably CLEARS niflheim_depths L1 under the shipped per-pack
// scaling -- the same rig schedule.spec.ts's REQ-0307 test uses. The run
// RESULT does not matter to this REQ (every settle notifies, win or wipe),
// but a deterministic winner keeps the digest/bell copy stable.
function winningSquad(tag: string) {
  const shape: number[][] = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) shape.push([r, c]);
  const cells: number[][] = [];
  for (const c of [2, 3, 4, 5]) for (const r of [2, 4, 6]) cells.push([r, c]);
  return {
    linked: false,
    bps: [{ id: `bp_n368_${tag}`, name: `N368 ${tag}`, color: '#7a5b5b', shape, origin: [2, 2], unit: { id: 'berserker', off: [0, 0] }, hpMax: 1000 }],
    pos: cells.map((cell, i) => ({ uid: `po_n368_${tag}_${i}`, id: 'war_pick', loc: 'grid', cell, rot: 0 })),
    sis: [],
  };
}
function winningCanvas(tag: string) {
  return {
    ...winningSquad(`${tag}0`),
    inv: { pages: [0, 1, 2, 3, 4].map(() => ({ bps: [], pos: [], sis: [], tms: [] })), names: ['1', '2', '3', '4', '5'] },
    presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: [null, winningSquad(`${tag}1`), winningSquad(`${tag}2`), winningSquad(`${tag}3`), null] },
  };
}

/** Drain the dev caller's feed so a test starts from "no unread". Acks
 * whatever is unseen -- debris from an earlier spec in the same worker
 * would otherwise pop this REQ's own digest at the wrong moment. */
async function drainFeed(page: Page): Promise<void> {
  const res = await page.request.get('/api/notifications');
  const body = await res.json();
  const ids = (body.notifications ?? []).map((n: { id: number }) => n.id);
  if (ids.length > 0) await page.request.post('/api/notifications/ack', { data: { ids } });
}

/** Grant one warehouse row and return its uid. */
async function grantRow(page: Page, itemId = 'hilt'): Promise<string> {
  const before = await (await page.request.get('/api/warehouse')).json();
  const seen = new Set<string>((before.items ?? []).map((i: { itemUid: string }) => i.itemUid));
  const res = await page.request.post('/api/admin/warehouse/grant', { data: { itemId } });
  expect(res.status()).toBe(200);
  const after = await (await page.request.get('/api/warehouse')).json();
  const fresh = (after.items ?? []).find((i: { itemUid: string }) => !seen.has(i.itemUid));
  expect(fresh, 'the grant produced a new warehouse row').toBeTruthy();
  return fresh.itemUid;
}

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/schedule/rooms/dev/clear');
  await page.request.post('/api/warehouse/dev/clear-debris');
  await drainFeed(page);
});

test('REQ-0368: a settled run lights the bell and the schedule rail badge; opening the bell marks read and clears both', async ({ page }) => {
  await page.request.put('/api/profile/default/canvas', { data: winningCanvas('bell') });
  await bootApp(page);
  // Boot is clean: no unread, no badge, and the login digest never appears
  // when the first poll carries no news.
  await expect(page.getByTestId('notify-bell')).toHaveAttribute('data-unread', '0');
  await expect(page.getByTestId('notify-digest')).toHaveCount(0);
  await expect(page.getByTestId('nav-badge-schedule')).toHaveCount(0);

  // Run an expedition to settlement, entirely through the API, while the
  // app sits on its poll -- exactly the absence this REQ is about.
  const created = await page.request.post('/api/schedule/rooms', { data: { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' } });
  expect(created.status()).toBe(200);
  const roomId = (await created.json()).room.id;
  for (let i = 0; i < 4; i++) {
    const r = await page.request.put(`/api/schedule/rooms/${roomId}/slots/${i}`, { data: { squadIndex: i } });
    expect(r.status()).toBe(200);
  }
  await expect(async () => {
    const view = await page.request.get(`/api/schedule/rooms/${roomId}`);
    expect((await view.json()).room.status).toBe('active');
  }).toPass({ timeout: 10_000 });
  expect((await page.request.post(`/api/schedule/rooms/${roomId}/dev/backdate`, { data: { extraSecsIntoPast: 5 } })).status()).toBe(200);
  await page.request.get(`/api/schedule/rooms/${roomId}`); // lazy settle -> emits run_settled

  // The next poll lights the bell WITHOUT any navigation: this is the push
  // the product did not have (before REQ-0368 the return was discoverable
  // only by opening the Schedule hall).
  await expect(page.getByTestId('notify-bell-count')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('notify-bell')).toHaveAttribute('data-unread', '1');
  // ... and the RAIL badge, which carried nothing at all before this REQ.
  const badge = page.getByTestId('nav-badge-schedule');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');

  // Opening the bell lists the entry and marks it read; the count and the
  // badge both clear, because both read the same unseen set.
  await page.getByTestId('notify-bell').click();
  await expect(page.getByTestId('notify-panel')).toBeVisible();
  await expect(page.locator('.notify-panel-item[data-kind="run_settled"]')).toHaveCount(1);
  await expect(page.getByTestId('notify-bell-count')).toHaveCount(0);
  await expect(page.getByTestId('notify-bell')).toHaveAttribute('data-unread', '0');
  await expect(page.getByTestId('nav-badge-schedule')).toHaveCount(0);

  await page.request.delete(`/api/schedule/rooms/${roomId}`);
});

test('REQ-0368: a warehouse row entering the <24h window lights the WAREHOUSE rail badge', async ({ page }) => {
  const uid = await grantRow(page);
  // Move it to 1h from expiry, then read the warehouse -- the read IS the
  // sweep that notices the crossing and announces it.
  const aged = await page.request.post('/api/warehouse/dev/backdate-expiry', { data: { itemUid: uid, secsUntilExpiry: 3600 } });
  expect(aged.status()).toBe(200);
  await page.request.get('/api/warehouse');

  await bootApp(page, { keepNotifications: true });
  const badge = page.getByTestId('nav-badge-warehouse');
  await expect(badge).toBeVisible({ timeout: 25_000 });
  await expect(badge).toHaveText('1');
  // The two rail badges are distinguishable without colour (REQ-0143): each
  // carries its own count AND its own screen-reader label.
  await expect(badge).toHaveAttribute('aria-label', /1/);
});

test('REQ-0368: booting with unseen news shows the login digest ONCE -- dismissing it acks the rows, and a reload does not show it again', async ({ page }) => {
  // Seed a SILENT LOSS: a warehouse row that expires and is swept away.
  // Before this REQ this event produced no player-visible trace anywhere.
  const uid = await grantRow(page);
  expect((await page.request.post('/api/warehouse/dev/backdate-expiry', { data: { itemUid: uid, secsUntilExpiry: -60 } })).status()).toBe(200);
  await page.request.get('/api/warehouse'); // the sweep deletes it -> warehouse_expired
  const feed = await (await page.request.get('/api/notifications')).json();
  expect(feed.notifications.some((n: { kind: string }) => n.kind === 'warehouse_expired'), 'the sweep announced the loss').toBe(true);

  await bootApp(page, { keepNotifications: true });
  const digest = page.getByTestId('notify-digest');
  await expect(digest).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('notify-digest-expired')).toBeVisible();
  await page.getByTestId('notify-digest-dismiss').click();
  await expect(digest).toHaveCount(0);
  // Dismissing acked the summarised rows, so the bell does not re-report them.
  await expect(page.getByTestId('notify-bell')).toHaveAttribute('data-unread', '0');

  // A reload finds nothing unseen -> no second digest.
  await bootApp(page, { keepNotifications: true });
  await expect(page.getByTestId('notify-bell')).toHaveAttribute('data-unread', '0');
  await expect(digest).toHaveCount(0);
});
