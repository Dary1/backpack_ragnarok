// REQ-0337 -- the HUMAN entry point into a public co-op Troop.
//
// The reactive fleet (REQ-0330) is compiled to only ever JOIN a public
// recruiting Troop -- bot/lib/allowlist.cjs HARD_DENYs POST /api/schedule/troops
// ("the fleet NEVER hosts -- it only reacts to a recruitment a player started").
// So the whole co-op loop hinges on a HUMAN being able to open one from the app,
// which before this REQ was impossible: client/src never referenced
// /schedule/troops at all and the sortie screen only ever POSTed the solo
// /sorties. These tests pin the entry point down through the real UI.
//
// The shape under test (no new screen, no mode toggle -- see SortiePage.tsx):
//   4 squads mustered -> SOLO, POST /api/schedule/sorties, visibility 'self'.
//   1-3 mustered      -> the empty seats ARE the recruitment: POST /troops opens
//                        a visibility:'public' Troop and the rest stay open.
//                        It does NOT depart here; filling the fourth seat
//                        auto-departs it server-side (REQ-0325).
//
// A second guest player stands in for the fleet: it joins over the EXACT
// endpoint the bots use (POST /troops/:id/join), because REQ-0324's whole design
// premise is that a bot account browses and joins indistinguishably from a
// human. Nothing here needs the fleet to actually be running.
//
// !! NOT YET EXECUTED !! Playwright on the shared box is under the REQ-0217
// freeze; REQ-0236 lifted it only for the SCOPED runner documented in
// PROJECT.md ("test-game note (e2e)"). This file is authored to the same
// conventions as schedule.spec.ts and is expected to be run the first time the
// freeze permits a full scoped pass. Until then the standing verification is
// the manual live check recorded in the REQ: host from the app, watch
// `journalctl --user -u backpack-fleet -f` drip-join to 4/4, confirm departure.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT, E2E_CLI_ENV } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from './global-setup';

const REPO_ROOT = E2E_DATA_ROOT;
const CLI_INVITE_PATH = join(E2E_CODE_ROOT, 'server', 'cli_invite.cjs');
const SCHEDULE_FIXTURE_PATH = new URL('./fixtures/schedule-fixture.json', import.meta.url);

interface CreatedPlayer {
  playerId: string;
  token: string;
  name: string;
}

function trackFileForCleanup(filePath: string, label: string): void {
  const existing: Array<{ path: string; label: string }> = existsSync(GUEST_AUTH_TRACKED_FILES_PATH)
    ? JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, 'utf8'))
    : [];
  existing.push({ path: filePath, label });
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, JSON.stringify(existing, null, 1) + '\n');
}

function createGuestPlayer(name: string): CreatedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: E2E_CODE_ROOT, env: E2E_CLI_ENV, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) {
    throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  }
  const playerId = playerIdMatch[1];
  const token = tokenMatch[1];
  trackFileForCleanup(join(PLAYERS_DIR, playerId + '.json'), `troop E2E guest player registry (${name})`);
  trackFileForCleanup(join(PROFILES_DIR, playerId + '.json'), `troop E2E guest player profile (${name})`);
  trackFileForCleanup(join(REPO_ROOT, 'data', 'warehouse', playerId), `troop E2E guest player warehouse dir (${name})`);
  return { playerId, token, name };
}

// ---- raw API helpers (the surface the fleet itself drives) ----------------
async function apiListRooms(page: Page, token: string) {
  const res = await page.request.get('/api/schedule/rooms', { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiBrowseTroops(page: Page, token: string) {
  const res = await page.request.get('/api/schedule/troops?state=recruiting', { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiJoinTroop(page: Page, token: string, roomId: string, squadIndex: number) {
  const res = await page.request.post(`/api/schedule/troops/${roomId}/join`, { headers: { 'X-Auth-Token': token }, data: { squadIndex } });
  return { status: res.status(), body: await res.json() };
}
async function apiGetTroop(page: Page, token: string, roomId: string) {
  const res = await page.request.get(`/api/schedule/troops/${roomId}`, { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiNotifications(page: Page, token: string) {
  const res = await page.request.get('/api/notifications', { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}

/** Drive the sortie page exactly as a player does: set attackLv, click N squad
 * cards, press the one CTA. Returns nothing -- the caller diffs the rooms list
 * to find what was created, the same way the REQ-0239 specs do. */
async function musterAndCommit(page: Page, opts: { level: number; squads: number[] }): Promise<void> {
  await page.goto('/app/#/sortie');
  await expect(page.locator('[data-testid="sortie-page"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="sortie-entry"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="sortie-level-input"]').fill(String(opts.level));
  for (const idx of opts.squads) await page.locator(`[data-testid="sortie-squad-card-${idx}"]`).click();
  await expect(page.locator('[data-testid="sortie-launch-btn"]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid="sortie-launch-btn"]').click();
  await expect(page).toHaveURL(/#\/schedule$/, { timeout: 10000 });
}

async function newRoomIdSince(page: Page, token: string, beforeIds: Set<string>): Promise<string> {
  let found = '';
  await expect(async () => {
    const rooms = (await apiListRooms(page, token)).body.rooms as Array<{ id: string }>;
    const nu = rooms.find((r) => !beforeIds.has(r.id));
    expect(nu).toBeTruthy();
    found = nu!.id;
  }).toPass({ timeout: 10000 });
  return found;
}

let host: CreatedPlayer;
let recruit: CreatedPlayer;
let fixture: unknown;
const createdRoomIds: string[] = [];

test.beforeAll(() => {
  host = createGuestPlayer('E2E TroopHost');
  recruit = createGuestPlayer('E2E TroopRecruit');
  fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));
});

test.beforeEach(async ({ page }) => {
  for (const p of [host, recruit]) {
    await page.request.put(`/api/profile/${p.playerId}/canvas`, { headers: { 'X-Auth-Token': p.token }, data: fixture });
  }
});

test.afterAll(async ({ request }) => {
  // Best-effort: disband anything this spec left recruiting so it never shows
  // up in a later browse (and so no seat stays deploy-gated).
  for (const roomId of createdRoomIds) {
    try { await request.post(`/api/schedule/troops/${roomId}/cancel`, { headers: { 'X-Auth-Token': host.token } }); } catch { /* already gone */ }
  }
});

test.describe('REQ-0337: opening a public co-op Troop from the app', () => {
  test('one squad mustered puts the CTA in recruit mode and opens a PUBLIC troop with three seats still free', async ({ page }) => {
    await page.goto(`/app/#/invite/${host.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });

    // The bar must announce a recruitment, not a march: this Troop does NOT
    // depart until other players take the free seats (REQ-0325).
    await page.goto('/app/#/sortie');
    await expect(page.locator('[data-testid="sortie-page"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="sortie-launch-status"]')).toHaveAttribute('data-mode', 'solo');
    await page.locator('[data-testid="sortie-squad-card-1"]').click();
    await expect(page.locator('[data-testid="sortie-launch-status"]')).toHaveAttribute('data-mode', 'recruit');
    await expect(page.locator('[data-testid="sortie-troop"]')).toHaveAttribute('data-recruiting', 'true');

    const beforeIds = new Set((await apiListRooms(page, host.token)).body.rooms.map((r: { id: string }) => r.id));
    await expect(page.locator('[data-testid="sortie-launch-btn"]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-testid="sortie-launch-btn"]').click();
    await expect(page).toHaveURL(/#\/schedule$/, { timeout: 10000 });

    const roomId = await newRoomIdSince(page, host.token, beforeIds);
    createdRoomIds.push(roomId);

    // Server-side truth: a PUBLIC, recruiting Troop, host seated in slot 0 only.
    const troop = (await apiGetTroop(page, host.token, roomId)).body.troop;
    expect(troop.visibility).toBe('public');
    expect(troop.state).toBe('recruiting');
    expect(troop.hostId).toBe(host.playerId);
    expect(troop.slots.filter((s: unknown) => s != null)).toHaveLength(1);
    expect(troop.slots[0].ownerId).toBe(host.playerId);
    expect(troop.slots.slice(1)).toEqual([null, null, null]);
  });

  test('the troop the app opened is visible to OTHER players on the browse endpoint the fleet polls', async ({ page }) => {
    await page.goto(`/app/#/invite/${host.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const beforeIds = new Set((await apiListRooms(page, host.token)).body.rooms.map((r: { id: string }) => r.id));
    await musterAndCommit(page, { level: 2, squads: [2] });
    const roomId = await newRoomIdSince(page, host.token, beforeIds);
    createdRoomIds.push(roomId);

    // GET /api/schedule/troops?state=recruiting is the EXACT signal
    // bot/lib/fleet.cjs browses. Before REQ-0337 nothing a human did through
    // the app could ever put a row here.
    const rows = (await apiBrowseTroops(page, recruit.token)).body.troops as Array<{ roomId: string; seats: string; attackLv: number; hostId: string }>;
    const mine = rows.find((r) => r.roomId === roomId);
    expect(mine).toBeTruthy();
    expect(mine!.seats).toBe('1/4');
    expect(mine!.attackLv).toBe(2);
    expect(mine!.hostId).toBe(host.playerId);
  });

  test('a recruit taking a seat is reflected in the host UI seat count (k/4) without a reload', async ({ page }) => {
    await page.goto(`/app/#/invite/${host.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const beforeIds = new Set((await apiListRooms(page, host.token)).body.rooms.map((r: { id: string }) => r.id));
    await musterAndCommit(page, { level: 2, squads: [3] });
    const roomId = await newRoomIdSince(page, host.token, beforeIds);
    createdRoomIds.push(roomId);

    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-room-status', 'recruiting');
    await expect(card.locator('[data-testid="schedule-room-seats"]')).toContainText('1/4');

    // The stand-in for a bot: joins over the fleet's own endpoint.
    const join = await apiJoinTroop(page, recruit.token, roomId, 1);
    expect(join.status).toBe(200);

    // SchedulePage's existing 4s rooms poll is the only refresh -- no reload,
    // no second poll loop was added for troops.
    await expect(card.locator('[data-testid="schedule-room-seats"]')).toContainText('2/4', { timeout: 15000 });
    // The recruit's seat must NOT be resolved against the HOST's squad names:
    // its squadIndex indexes the RECRUIT's canvas (see schedule/seats.ts).
    await expect(card.locator('[data-testid="schedule-room-slot-chip-1"]')).not.toContainText('Slot2');
  });

  test('disbanding from the card returns every seat and notifies the recruit (troop cancel, NOT the solo room DELETE)', async ({ page }) => {
    await page.goto(`/app/#/invite/${host.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const beforeIds = new Set((await apiListRooms(page, host.token)).body.rooms.map((r: { id: string }) => r.id));
    await musterAndCommit(page, { level: 2, squads: [5] });
    const roomId = await newRoomIdSince(page, host.token, beforeIds);
    createdRoomIds.push(roomId);

    expect((await apiJoinTroop(page, recruit.token, roomId, 2)).status).toBe(200);

    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card.locator('[data-testid="schedule-room-seats"]')).toContainText('2/4', { timeout: 15000 });
    await card.locator('[data-testid="schedule-room-cancel-btn"]').click();
    await card.locator('[data-testid="schedule-room-cancel-confirm-yes"]').click();

    // The distinguishing evidence that this went through POST /troops/:id/cancel
    // and not the solo DELETE /rooms/:id: EVERY seat is returned (the solo path
    // leaves the other members seated) and a discrete disbandEvent is recorded
    // naming each released owner.
    await expect(async () => {
      const troop = (await apiGetTroop(page, host.token, roomId)).body.troop;
      expect(troop.state).toBe('canceled');
      expect(troop.slots).toEqual([null, null, null, null]);
      expect(troop.disbandEvent.releasedOwners).toContain(recruit.playerId);
    }).toPass({ timeout: 15000 });

    // REQ-0327: the recruit -- who never touched this UI -- is told. This is the
    // signal the fleet's auto-seller keys off, so losing it strands every bot.
    const feed = (await apiNotifications(page, recruit.token)).body.notifications as Array<{ kind: string; roomId: string }>;
    expect(feed.some((n) => n.kind === 'troop_disbanded' && n.roomId === roomId)).toBe(true);
  });

  test('four squads still take the SOLO path untouched -- visibility self, no troop row', async ({ page }) => {
    await page.goto(`/app/#/invite/${host.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const beforeIds = new Set((await apiListRooms(page, host.token)).body.rooms.map((r: { id: string }) => r.id));
    await musterAndCommit(page, { level: 2, squads: [11, 12, 13, 14] });
    const roomId = await newRoomIdSince(page, host.token, beforeIds);

    const room = (await apiListRooms(page, host.token)).body.rooms.find((r: { id: string }) => r.id === roomId);
    expect(room.visibility).toBe('self');
    // A solo room is INVISIBLE on the troop surface -- this is the exact
    // condition that made the fleet sit idle before REQ-0337, so it is pinned
    // rather than assumed.
    const rows = (await apiBrowseTroops(page, recruit.token)).body.troops as Array<{ roomId: string }>;
    expect(rows.some((r) => r.roomId === roomId)).toBe(false);
  });
});
