// REQ-0071 -- MJOLNIR re-skin of the #/schedule ROOMS view (mock:
// web/redesign/expedition.html). These tests cover the NEW chrome only;
// every behavioral contract (deploy gates, run pacing, cancel policies,
// log tab, rewards) is already covered by schedule.spec.ts on the SAME
// selectors, all of which REQ-0071 kept verbatim. Player-minting /
// fixture / cleanup conventions copied from schedule.spec.ts (fresh
// guest via the real operator CLI, fixture presets PUT before each
// test, room files swept in afterAll).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from './global-setup';

const REPO_ROOT = join(homedir(), 'backpack_ragnarok');
const CLI_INVITE_PATH = join(REPO_ROOT, 'server', 'cli_invite.cjs');
const SCHEDULE_FIXTURE_PATH = new URL('./fixtures/schedule-fixture.json', import.meta.url);

interface CreatedPlayer {
  playerId: string;
  token: string;
}

function trackFileForCleanup(filePath: string, label: string): void {
  const existing: Array<{ path: string; label: string }> = existsSync(GUEST_AUTH_TRACKED_FILES_PATH)
    ? JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, 'utf8'))
    : [];
  existing.push({ path: filePath, label });
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, JSON.stringify(existing, null, 1) + '\n');
}

function createGuestPlayer(name: string): CreatedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: REPO_ROOT, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) {
    throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  }
  const playerId = playerIdMatch[1];
  const token = tokenMatch[1];
  trackFileForCleanup(join(PLAYERS_DIR, playerId + '.json'), `REQ-0071 chrome E2E guest player registry (${name})`);
  trackFileForCleanup(join(PROFILES_DIR, playerId + '.json'), `REQ-0071 chrome E2E guest player profile (${name})`);
  trackFileForCleanup(join(REPO_ROOT, 'data', 'warehouse', playerId), `REQ-0071 chrome E2E guest player warehouse dir (${name})`);
  return { playerId, token };
}

const createdRoomIds: string[] = [];

async function apiCreateRoom(page: Page, token: string, body: Record<string, unknown>): Promise<any> {
  const res = await page.request.post('/api/schedule/rooms', { headers: { 'X-Auth-Token': token }, data: body });
  const json = await res.json();
  if (json.room?.id) createdRoomIds.push(json.room.id);
  return { status: res.status(), body: json };
}

let player: CreatedPlayer;
let fixture: unknown;

test.beforeAll(() => {
  player = createGuestPlayer('E2E Req0071Chrome');
  fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));
});

test.beforeEach(async ({ page }) => {
  await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: fixture });
});

async function gotoSchedule(page: Page): Promise<void> {
  await page.goto(`/app/#/invite/${player.token}`);
  await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
  await page.locator('.nav-link', { hasText: 'Schedule' }).click();
  await expect(page.locator('.schedule-page')).toBeVisible();
}

test.describe('REQ-0071: MJOLNIR chrome on the rooms view', () => {
  test('pagehead/colhead render; the create panel and a fresh room card wear the ornate panel anatomy (knots, chip badge, slot-preview grid, monitor placeholder)', async ({ page }) => {
    await gotoSchedule(page);

    // Pagehead strip: hall title + lede + rune divider. REQ-0086:
    // Warehouse's tab chip moved out to its own route -- Schedule no
    // longer renders any tab chips at all.
    await expect(page.locator('.schedule-pagehead-title')).toHaveText('Expeditions');
    await expect(page.locator('.schedule-pagehead-lede')).toBeVisible();
    await expect(page.locator('.schedule-rooms-view')).toBeVisible();
    await expect(page.locator('.schedule-pagehead-divider')).toBeVisible();

    // Rooms colhead (den label; the live-count readout needs the rooms
    // list to have loaded, which the create-panel wait below implies).
    await expect(page.locator('.schedule-colhead-den')).toHaveText('ROOMS');

    // Fresh player, zero rooms -> the create panel auto-opens (existing
    // behavior) and now wears .panel.ornate + 4 gold knots.
    const createPanel = page.locator('.schedule-create-panel');
    await expect(createPanel).toBeVisible({ timeout: 10000 });
    await expect(createPanel).toHaveClass(/panel/);
    await expect(createPanel).toHaveClass(/ornate/);
    await expect(createPanel.locator('> .k')).toHaveCount(4);

    // Create a room through the real form (same selectors as
    // schedule.spec.ts's own create-room test).
    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="schedule-level-input"]').fill('1');
    await page.locator('[data-testid="schedule-create-submit"]').click();

    const card = page.locator('[data-testid="schedule-room-card"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    const roomId = await card.getAttribute('data-room-id');
    expect(roomId).toBeTruthy();
    createdRoomIds.push(roomId!);

    // Room card anatomy: ornate panel + knots + emblem disc + status
    // CHIP + the 2x2 slot-preview grid, all four slots empty (dashed).
    await expect(card).toHaveClass(/panel/);
    await expect(card).toHaveClass(/ornate/);
    await expect(card.locator('> .k')).toHaveCount(4);
    await expect(card.locator('.schedule-room-emblem')).toBeVisible();
    const badge = card.locator('[data-testid="schedule-room-status-badge"]');
    await expect(badge).toHaveText('Idle');
    await expect(badge).toHaveClass(/chip/);
    await expect(card.locator('[data-testid^="schedule-room-slot-chip-"]')).toHaveCount(4);
    await expect(card.locator('.schedule-room-slot-empty')).toHaveCount(4);

    // Expand: slots panel + the monitor's "no run yet" placeholder (a
    // fresh room has no lastRunId -- the mon-panel head only exists once
    // a run does).
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(card.locator('[data-testid="schedule-slot-0"]')).toBeVisible();
    await expect(card).toHaveClass(/schedule-room-card-open/);
    await expect(card.locator('.schedule-monitor-empty')).toBeVisible();

    // Assigning a preset fills the card's own slot-preview chip with the
    // preset's real name (store-resolved), replacing the empty marker.
    await card.locator('[data-testid="schedule-slot-select-0"]').selectOption('0');
    await expect(card.locator('[data-testid="schedule-slot-select-0"]')).toHaveValue('0', { timeout: 10000 });
    await expect(card.locator('.schedule-room-slot-empty')).toHaveCount(3, { timeout: 10000 });

    // Tidy: cancel (immediate policy default) so preset 0 frees up.
    await page.request.delete(`/api/schedule/rooms/${roomId}`, { headers: { 'X-Auth-Token': player.token } });
  });

  test('cancel flow on the new chrome: inline confirm cancels; the hide-canceled default collapses the card and unchecking reveals it with the canceled treatment', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    expect(created.status).toBe(200);
    const roomId = created.body.room.id as string;

    await gotoSchedule(page);
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });

    // Inline confirm (same testids as before the re-skin).
    await card.locator('[data-testid="schedule-room-cancel-btn"]').click();
    await expect(card.locator('[data-testid="schedule-room-cancel-confirm"]')).toBeVisible();
    await card.locator('[data-testid="schedule-room-cancel-confirm-yes"]').click();

    // hideCanceled defaults ON -> once the cancel lands + the list
    // reloads, this card leaves the visible list and the toggle chip
    // appears with a live count.
    await expect(card).toHaveCount(0, { timeout: 10000 });
    const toggle = page.locator('.schedule-hide-canceled-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText(/Hide canceled \(\d+\)/);

    // Unchecking reveals the card again, now in the muted/desaturated
    // canceled treatment (mock .locked voice) with no cancel button.
    await page.locator('[data-testid="schedule-hide-canceled-checkbox"]').uncheck();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-room-status', 'canceled');
    await expect(card).toHaveClass(/schedule-room-status-canceled/);
    await expect(card.locator('[data-testid="schedule-room-cancel-btn"]')).toHaveCount(0);
  });
});

test.afterAll(async () => {
  // Same belt-and-suspenders disk sweep schedule.spec.ts performs for
  // its own room ids (harmless no-op under the pg backend; canceled
  // rooms are inert either way).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const roomsDir = path.join(REPO_ROOT, 'data', 'schedule', 'rooms');
  const runsDir = path.join(REPO_ROOT, 'data', 'schedule', 'runs');
  for (const roomId of createdRoomIds) {
    const roomPath = path.join(roomsDir, roomId + '.json');
    if (fs.existsSync(roomPath)) fs.rmSync(roomPath);
  }
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
        if (createdRoomIds.includes(doc.roomId)) fs.rmSync(path.join(runsDir, f));
      } catch (e) {
        // skip unreadable/corrupt
      }
    }
  }
});
