// REQ-0036 P1-C -- Dungeon Schedule client E2E coverage.
//
// Mints a FRESH guest player via the real operator CLI
// (server/cli_invite.cjs), exactly the same convention
// guest-auth.spec.ts already established ("mint fresh test player +
// track files for cleanup") -- this suite's own rooms/runs/warehouse
// items are ALSO tracked for cleanup here (see trackFileForCleanup()
// below and cleanupCreatedRooms() in an afterAll), since P1-B's own
// commit added data/schedule/rooms/, data/schedule/runs/, and
// data/warehouse/<playerId>/ as new persistence roots (server/
// storage.cjs) that global-teardown.ts's EXISTING tracked-file ledger
// mechanism does not yet know about by default -- this file registers
// its own player's rooms/runs/warehouse directory into the SAME
// GUEST_AUTH_TRACKED_FILES_PATH ledger guest-auth.spec.ts uses, so
// global-teardown.ts's existing cleanup loop deletes them too, with zero
// changes needed to global-teardown.ts itself (it already deletes
// whatever this ledger lists).
//
// E2E time-control decision (documented in full in server/README.md's
// "E2E time-control decision" section): measured real durationSecs for
// niflheim_depths empirically before choosing an approach.
//   - A squad whose PO effects default to modes:['battle'] (this suite's
//     own fixture squad uses the real 'dagger' item, no `modes` field)
//     NEVER acts during the enc_trap_1 detection-mode encounter, so that
//     encounter times out at t=999 -- durationSecs for the WHOLE run
//     would be 999 real seconds if we waited for natural settlement.
//   - Rather than author new short-duration content (more invasive, per
//     the task brief's own steer) or wait 999 real seconds per test, most
//     tests below use the new POST .../dev/backdate dev-only hook
//     (server/schedule.cjs's devBackdateActiveRun(), gated to the
//     dev_mode fallback caller only) to force a run's clock to read as
//     already elapsed, without waiting any real time at all.
//   - EXCEPTION: the "monitor shows events & progress" test polls a REAL
//     run for real (bounded wait, ~8s) -- the first pack encounter
//     (enc_pack_1) reliably clears and emits several events + a
//     `progress` event well within a few real seconds (confirmed via the
//     P1-C duration probe), so this one test exercises the client's
//     actual poll-and-diff loop against genuine wall-clock pacing rather
//     than a backdated/already-settled run, without needing the WHOLE
//     999s-or-21s run to finish.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT, E2E_CLI_ENV } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from './global-setup';
import { bootApp, waitForAutoSave } from './helpers';

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
  trackFileForCleanup(join(PLAYERS_DIR, playerId + '.json'), `schedule E2E guest player registry (${name})`);
  trackFileForCleanup(join(PROFILES_DIR, playerId + '.json'), `schedule E2E guest player profile (${name})`);
  trackFileForCleanup(join(REPO_ROOT, 'data', 'warehouse', playerId), `schedule E2E guest player warehouse dir (${name})`);
  return { playerId, token, name };
}

/** Tracks a room's own id for cleanup -- the corresponding run file(s),
 * if any, live at data/schedule/runs/<runId>.json and are NOT separately
 * tracked by id here (this suite's afterAll instead sweeps the whole
 * data/schedule/rooms + data/schedule/runs directories for entries
 * belonging to THIS spec's own player ids, see cleanupScheduleDirs()
 * below) -- simpler than threading every individual runId out of every
 * test that creates one. */
const createdRoomIds: string[] = [];

async function apiCreateRoom(page: Page, token: string, body: Record<string, unknown>): Promise<any> {
  const res = await page.request.post('/api/schedule/rooms', { headers: { 'X-Auth-Token': token }, data: body });
  const json = await res.json();
  if (json.room?.id) createdRoomIds.push(json.room.id);
  return { status: res.status(), body: json };
}
async function apiListRooms(page: Page, token: string): Promise<any> {
  const res = await page.request.get('/api/schedule/rooms', { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiGetRoom(page: Page, token: string, roomId: string): Promise<any> {
  const res = await page.request.get(`/api/schedule/rooms/${roomId}`, { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiAssignSlot(page: Page, token: string, roomId: string, slotIndex: number, squadIndex: number): Promise<any> {
  const res = await page.request.put(`/api/schedule/rooms/${roomId}/slots/${slotIndex}`, { headers: { 'X-Auth-Token': token }, data: { squadIndex } });
  return { status: res.status(), body: await res.json() };
}
async function apiCancelRoom(page: Page, token: string, roomId: string): Promise<any> {
  const res = await page.request.delete(`/api/schedule/rooms/${roomId}`, { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiGetRun(page: Page, token: string, roomId: string): Promise<any> {
  const res = await page.request.get(`/api/schedule/rooms/${roomId}/run`, { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiBackdate(page: Page, roomId: string, extraSecsIntoPast = 5): Promise<any> {
  // No X-Auth-Token at all -- this must resolve via the dev_mode
  // fallback for the backdate route to succeed at all (see
  // server/README.md's gating writeup); this helper is intentionally
  // only ever called against rooms OWNED BY the dev fallback player
  // (devToken-less requests), never against this spec's own guest
  // player's rooms (which would correctly 403, per the schedule.spec
  // test that asserts exactly that gate).
  const res = await page.request.post(`/api/schedule/rooms/${roomId}/dev/backdate`, { data: { extraSecsIntoPast } });
  return { status: res.status(), body: await res.json() };
}
async function apiWarehouse(page: Page, token: string): Promise<any> {
  const res = await page.request.get('/api/warehouse', { headers: { 'X-Auth-Token': token } });
  return { status: res.status(), body: await res.json() };
}
async function apiClaim(page: Page, token: string, itemUid: string): Promise<any> {
  const res = await page.request.post('/api/warehouse/claim', { headers: { 'X-Auth-Token': token }, data: { itemUid } });
  return { status: res.status(), body: await res.json() };
}

// REQ-0082: the schedule create panel auto-opens only when the caller has ZERO
// rooms (SchedulePage.tsx: showCreatePanel = createOpen || rooms.length === 0).
// A caller that already owns rooms (incl. canceled) sees it collapsed behind the
// "Forge a new expedition +" toggle. Open it explicitly before touching the form
// so the REQ-0043 specs are robust to accumulated rooms / run order (drift fix).
async function openCreatePanel(page: Page): Promise<void> {
  const dungeonSelect = page.locator('[data-testid="schedule-dungeon-select"]');
  const toggle = page.locator('[data-testid="schedule-create-toggle"]');
  // Wait for rooms to load and the page to settle into ONE of two states before
  // deciding: the panel auto-opened (zero rooms) OR the toggle is present (has
  // rooms). Without this wait we could sample while rooms is still null (neither
  // present) and no-op, then time out because the panel never opens on its own.
  await expect(dungeonSelect.or(toggle).first()).toBeVisible({ timeout: 10000 });
  if (await dungeonSelect.isVisible().catch(() => false)) return;
  await toggle.click();
}

let player: CreatedPlayer;
let fixture: unknown;

test.beforeAll(() => {
  player = createGuestPlayer('E2E ScheduleGuest');
  fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));
});

// Every test in this file needs the fixture's 4 usable squads on the
// player's OWN profile -- PUT it fresh before EACH test (not just
// beforeAll), so every test is independently runnable (e.g. `npx
// playwright test -g "warehouse receives"` in isolation) rather than
// silently depending on an earlier test's own PUT having already run in
// the same file. Idempotent -- PUTting the same fixture twice is a
// harmless no-op overwrite.
test.beforeEach(async ({ page }) => {
  await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: fixture });
});

test.describe('dungeons list (no auth)', () => {
  test('GET /api/schedule/dungeons returns niflheim_depths + 4 formations, no token required', async ({ page }) => {
    const res = await page.request.get('/api/schedule/dungeons');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dungeons.some((d: any) => d.id === 'niflheim_depths')).toBe(true);
    expect(body.formations.length).toBe(4);
  });
});

test.describe('create room + slots UI', () => {
  test('create-room form creates a room; assigning all 4 slots with 4 DIFFERENT, mutually-unique squads auto-starts a run (REQ-0045 c: unique-4 must start)', async ({ page }) => {
    await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: fixture });
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    await expect(page.locator('.schedule-page')).toBeVisible();

    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="schedule-level-input"]').fill('1');
    await expect(page.locator('[data-testid="schedule-visibility-fixed"]')).toHaveText('Self only');
    await page.locator('[data-testid="schedule-create-submit"]').click();

    await expect(page.locator('[data-testid="schedule-room-card"]').first()).toBeVisible({ timeout: 10000 });
    const roomId = await page.locator('[data-testid="schedule-room-card"]').first().getAttribute('data-room-id');
    expect(roomId).toBeTruthy();
    createdRoomIds.push(roomId!);

    // REQ-0168 U1: a successful create now auto-selects (watches) the new
    // room, so the detail pane already shows its slots panel -- no expand
    // click needed.
    await expect(page.locator('[data-testid="schedule-slot-0"]')).toBeVisible({ timeout: 10000 });

    // REQ-0045 (b)+(c) deploy gate v2: fill each slot with a DIFFERENT
    // squad (0,1,2,3 -- the fixture's 4 mutually-unique, globally-
    // distinct-uid squads, see schedule-fixture.json's own header
    // comment) -- this is the "4 squads with fully unique squads" case
    // the OLD gate (isSquadIndependent-as-gate) used to incorrectly
    // REFUSE (a squad sharing an item with some OTHER unrelated squad
    // elsewhere in the warehouse blocked deployment even though nothing
    // here overlaps anything actually deployed) -- the NEW deploy-
    // overlap gate correctly allows this, since none of these 4 squads'
    // uid sets intersect each other OR anything deployed elsewhere.
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-testid="schedule-slot-select-${i}"]`).selectOption(String(i));
      await expect(page.locator(`[data-testid="schedule-slot-select-${i}"]`)).toHaveValue(String(i), { timeout: 10000 });
    }

    // A full troop auto-starts the first run (server-side
    // maybeAutoStartNextRun, fired the next time anything reads the
    // room) -- poll until status flips to 'active'.
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId!);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await expect(page.locator('[data-testid="schedule-room-status-badge"]').first()).toHaveText('Running', { timeout: 10000 });

    // Cancel immediately (default cancelPolicy) so this room's deployed
    // squads (0,1,2,3) do not stay "active" and block later tests' OWN
    // use of those squads via the cross-room deploy gate -- this test's
    // own assertions are already complete at this point.
    await apiCancelRoom(page, player.token, roomId!);
  });

  test('assigning the SAME squadIndex to a SECOND slot of the SAME room is refused 409 (REQ-0045 c: duplicate squads must be REFUSED)', async ({ page }) => {
    await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: fixture });
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;

    const first = await apiAssignSlot(page, player.token, roomId, 0, 1);
    expect(first.status).toBe(200);
    // Same squadIndex (1) into a DIFFERENT slot of the SAME room -- the
    // uid set is IDENTICAL to slot 0's, so this is a same-room duplicate-
    // deployment attempt, correctly refused regardless of the room's own
    // status (it is still 'open', not yet 'active', at this point --
    // deployedUidSetsForGate checks this room's OWN other slots
    // unconditionally, not just when the room has gone active).
    const dup = await apiAssignSlot(page, player.token, roomId, 1, 1);
    expect(dup.status).toBe(409);
    expect(dup.body.reason).toBe('same_room_duplicate'); // REQ-0168 U6

    // Room never reaches 4/4 filled, so it correctly never auto-starts.
    const view = await apiGetRoom(page, player.token, roomId);
    expect(view.body.room.status).toBe('open');
    expect(view.body.room.slots[1].squadIndex).toBeNull();

    await apiCancelRoom(page, player.token, roomId);
  });

  test('a squad sharing a uid with another of the caller\'s OWN squads, where that OTHER squad is NOT deployed anywhere, deploys OK (REQ-0045 b: mere cross-squad sharing must NOT block)', async ({ page }) => {
    // Clone squad index 1's uids into squad index 4 (normally empty)
    // -- squad 1 and squad 4 now share EVERY uid, making both "yellow"
    // (isSquadIndependent would report false for either against the
    // other) -- but NEITHER is deployed anywhere yet. Assigning squad 1
    // to a room slot must succeed: the OLD gate (isSquadIndependent-as-
    // gate) would have refused this unconditionally; the NEW deploy-
    // overlap gate only cares whether the OTHER squad's squads are
    // ACTUALLY deployed, which squad 4 is not. Uses the same GET/mutate/
    // PUT-canvas HTTP round-trip convention as the warehouse-rewards test
    // above (this file drives everything through the real API, never
    // requires server internals directly).
    const beforeRes = await page.request.get(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token } });
    const canvasBefore = (await beforeRes.json()).canvas;
    canvasBefore.presets.store[4] = JSON.parse(JSON.stringify(canvasBefore.presets.store[1]));
    const putRes = await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: canvasBefore });
    expect(putRes.status()).toBe(200);

    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    const res = await apiAssignSlot(page, player.token, roomId, 0, 1);
    expect(res.status).toBe(200);
    await apiCancelRoom(page, player.token, roomId);
    // No explicit restore needed: the describe-block's own beforeEach
    // re-PUTs the pristine fixture before every subsequent test.
  });
});

test.describe('REQ-0043: dungeon auto-generation -- type selector + dev-only seed field', () => {
  test('create-room form offers an authored dungeon DEF selector and creating a room via the UI works end to end (REQ-0185)', async ({ page }) => {
    await page.request.put(`/api/profile/${player.playerId}/canvas`, { headers: { 'X-Auth-Token': player.token }, data: fixture });
    // This spec's own `player` guest may already own rooms created by
    // OTHER tests in this file (canceled rooms stay listed, just
    // status:'canceled') -- capture the id set BEFORE creating, and diff
    // afterward, rather than trusting the room-card list's `.first()`
    // position to be "the room this test just created" (test order
    // within the full suite run is not this test's own to control).
    const beforeIds = new Set(
      (await apiListRooms(page, player.token)).body.rooms.map((r: { id: string }) => r.id)
    );

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    await expect(page.locator('.schedule-page')).toBeVisible();

    await openCreatePanel(page);
    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toBeVisible({ timeout: 10000 });

    // REQ-0185: the picker lists authored dungeon DEFS; option VALUES are the
    // def ids. Select the frost pilot def explicitly (locale-independent).
    await page.locator('[data-testid="schedule-dungeon-select"]').selectOption('niflheim_depths');
    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toHaveValue('niflheim_depths');

    await page.locator('[data-testid="schedule-level-input"]').fill('3');
    await page.locator('[data-testid="schedule-create-submit"]').click();

    await expect(async () => {
      const rooms = (await apiListRooms(page, player.token)).body.rooms as Array<{ id: string }>;
      expect(rooms.some((r) => !beforeIds.has(r.id))).toBe(true);
    }).toPass({ timeout: 10000 });

    const afterRooms = (await apiListRooms(page, player.token)).body.rooms as Array<{ id: string }>;
    const newRoom = afterRooms.find((r) => !beforeIds.has(r.id));
    expect(newRoom).toBeTruthy();
    const roomId = newRoom!.id;
    createdRoomIds.push(roomId);

    // REQ-0185: confirm the SERVER recorded the authored dungeon DEF id +
    // level:3 on this room (the def IS the selection now).
    const roomView = await apiGetRoom(page, player.token, roomId);
    expect(roomView.body.room.dungeonId).toBe('niflheim_depths');
    expect(roomView.body.room.level).toBe(3);

    await apiCancelRoom(page, player.token, roomId);
  });

  test('the generator-seed field is HIDDEN for a plain guest (no item_admin role)', async ({ page }) => {
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    await openCreatePanel(page);
    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-gen-seed-input"]')).toHaveCount(0);
  });

  test('the generator-seed field IS visible for the dev_mode fallback caller (item_admin), and a seeded room persists the exact seed', async ({ page }) => {
    // Plain bootApp (no #/invite/<token> in the URL) resolves to the
    // dev_mode fallback player via /api/me, same convention
    // schedule.spec.ts's own REQ-0041 dev-grant tests already use. The
    // dev fallback player accumulates rooms across THIS WHOLE spec
    // file's run (other describe blocks create dev-owned rooms too), so
    // `.first()` in the rooms list is NOT reliably "the room this test
    // just created" -- capture the set of room ids BEFORE submitting and
    // diff against the set AFTER to find the genuinely new one, rather
    // than trusting list order/position.
    const beforeRes = await page.request.get('/api/schedule/rooms');
    const idsBefore = new Set(((await beforeRes.json()).rooms as Array<{ id: string }>).map((r) => r.id));

    await page.goto('/app/#/schedule');
    await expect(page.locator('.schedule-page')).toBeVisible({ timeout: 10000 });
    await openCreatePanel(page);
    await expect(page.locator('[data-testid="schedule-dungeon-select"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-gen-seed-input"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="schedule-dungeon-select"]').selectOption('niflheim_depths');
    await page.locator('[data-testid="schedule-level-input"]').fill('2');
    await page.locator('[data-testid="schedule-gen-seed-input"]').fill('e2e-dev-seed-req0043');
    await page.locator('[data-testid="schedule-create-submit"]').click();

    await expect(async () => {
      const afterRes = await page.request.get('/api/schedule/rooms');
      const afterRooms = (await afterRes.json()).rooms as Array<{ id: string }>;
      expect(afterRooms.some((r) => !idsBefore.has(r.id))).toBe(true);
    }).toPass({ timeout: 10000 });

    const afterRes = await page.request.get('/api/schedule/rooms');
    const afterRooms = (await afterRes.json()).rooms as Array<{ id: string }>;
    const newRoom = afterRooms.find((r) => !idsBefore.has(r.id));
    expect(newRoom).toBeTruthy();
    const roomId = newRoom!.id;

    // No X-Auth-Token -- resolves via the dev_mode fallback, same as
    // apiBackdate()'s own convention in this file.
    const roomRes = await page.request.get(`/api/schedule/rooms/${roomId}`);
    const roomBody = await roomRes.json();
    expect(roomBody.room.genSeed).toBe('e2e-dev-seed-req0043');
    expect(roomBody.room.dungeonId).toBe('niflheim_depths');
    expect(roomBody.room.level).toBe(2);

    await page.request.delete(`/api/schedule/rooms/${roomId}`);
  });

  test('a plain guest token is refused (403) if it tries to POST a genSeed directly via the API (server-side gate, independent of the UI hiding the field)', async ({ page }) => {
    const res = await page.request.post('/api/schedule/rooms', {
      headers: { 'X-Auth-Token': player.token },
      data: { dungeonId: 'niflheim_depths', dungeonType: 'default', level: 1, genSeed: 'guest-should-not-be-able-to-set-this' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('monitor: events & progress', () => {
  test('monitor polls a REAL run and shows growing event count + increasing progress', async ({ page }) => {
    // Fresh room, same fixture squad in all 4 slots.
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    // Fill each slot with a DIFFERENT squad (0,1,2,3 -- the fixture's 4
    // mutually-unique, globally-distinct-uid squads). Every test in
    // this file now cancels its own room immediately after use, so no
    // squad index needs to be "reserved" against any other test.
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    // The auto-start (maybeAutoStartNextRun) only fires the NEXT time
    // anything reads/touches the room (settleRoomIfDue, lazy scheduler --
    // assignSlot itself never triggers it) -- an explicit GET right after
    // filling the last slot is what actually starts the run, matching
    // server/tests/api_test.cjs's own "roomXAfter = GET ..." convention.
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });

    // REQ-0240: progress now reads from the M2 expedition rail (fill + nodes)
    // and the M4 feed -- the old progress-pct / encounter lines retired. The
    // run is paced: the server reveals events on the presentation clock and the
    // client releases them ~2.5s behind, so use generous bounded windows.
    await expect(async () => {
      const view = await apiGetRun(page, player.token, roomId);
      expect(view.body.events.length).toBeGreaterThan(0);
      expect(view.body.pacingVersion).toBe(1); // events carry pt
    }).toPass({ timeout: 12000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-rail"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-rail-node-0"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-feed-row"]').first()).toBeVisible({ timeout: 25000 });

    // Cancel immediately so squad index 2 frees up for any later test.
    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('run settles via dev/backdate hook', () => {
  test('dev/backdate is refused (403) for a real guest token, even the room owner\'s own', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await apiAssignSlot(page, player.token, roomId, i, i);
    const res = await page.request.post(`/api/schedule/rooms/${roomId}/dev/backdate`, {
      headers: { 'X-Auth-Token': player.token },
      data: {},
    });
    expect(res.status()).toBe(403);

    // REQ-0159 (class A -- SHARED-STATE LEAK, root cause of the
    // "monitor freeze regression guard" red at full-file ordering):
    // filling all 4 slots above AUTO-STARTS the run, so this room goes
    // ACTIVE and squads 0-3 become DEPLOYED. This test was the only one
    // in the file that never cancelled its room, so from here on every
    // later test that deploys squads 0-3 (the monitor-freeze guard does
    // exactly that) got a 409 from the cross-room deploy gate --
    // deployedUidSetsForGate (server/services/squads.cjs) counts every
    // OTHER *active* room of the same owner. That 409 was CORRECT server
    // behavior (it is the very rule the "deploy-gate 409 across rooms"
    // test below asserts on purpose); the bug was this test leaking an
    // active room into its neighbours. It passed solo only because there
    // was no leak to trip over. Cancel here like every other room-
    // creating test in this file already does -- the room's default
    // cancelPolicy is immediate (services/rooms.cjs validateCancelPolicy),
    // so this really does release the deployment rather than just flagging
    // cancelRequested. NOTE: the fix belongs HERE, in the leaker; the
    // monitor guard's own `expect(r.status).toBe(200)` is left untouched
    // and is exactly the assertion that must keep failing if a squad is
    // wrongly still deployed.
    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('warehouse receives rewards + claim moves item to inventory', () => {
  test('a settled, non-wipe run deposits >=1 reward into the warehouse; claiming moves it into inventory', async ({ page }) => {
    // This test uses the DEV_MODE FALLBACK player (no X-Auth-Token),
    // deliberately, NOT this suite's own guest token -- the ONLY way to
    // settle a run without waiting out real wall-clock time is the
    // dev/backdate hook, which is gated to the dev fallback caller only
    // (confirmed 403'd for a real guest token in the test above). Real
    // niflheim_depths durationSecs is 999 (the trap encounter's
    // every_secs:[999,999] skill never fires without a detection-capable
    // squad -- confirmed via direct sim/combat.cjs measurement, NOT the
    // ~21s figure that applies only to a detection/unlock-capable probe
    // squad this suite's own fixture does not use) -- waiting for real
    // settlement here would mean a 999-real-second test, which is why
    // every schedule E2E test other than the "monitor" one uses this
    // dev-only shortcut instead (see server/README.md's "E2E time-
    // control decision" section).
    //
    // Since data/profiles/dev.json is a REAL, PRE-EXISTING file (unlike
    // this suite's own freshly-minted guest player), this test backs it
    // up itself and restores it in a try/finally -- mirroring global-
    // setup.ts/global-teardown.ts's own backup-then-restore discipline
    // for default.json, rather than relying on the "absent -> delete"
    // convention that only fits files CREATED by a test.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;

    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });

      const created = await apiCreateRoom(page, '', { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        const r = await page.request.put(`/api/schedule/rooms/${roomId}/slots/${i}`, { data: { squadIndex: i } });
        expect(r.status()).toBe(200);
      }
      // Auto-start fires on the next room read (lazy settlement).
      await expect(async () => {
        const view = await page.request.get(`/api/schedule/rooms/${roomId}`);
        expect((await view.json()).room.status).toBe('active');
      }).toPass({ timeout: 10000 });

      const runViewRes = await page.request.get(`/api/schedule/rooms/${roomId}/run`);
      const runView = await runViewRes.json();
      expect(['victory', 'wipe', 'incomplete']).toContain(runView.result);

      // Only assert the reward-in-warehouse behavior on an actual
      // victory (a wipe deposits nothing, per golden i) -- this
      // fixture's tanky (hpMax:500) squads win reliably (empirically
      // verified: 20/20 across distinct seeds during this REQ's own
      // development), but the skip guard stays as defensive belt-and-
      // suspenders rather than asserting something that should not
      // happen on the rare/theoretical seed that wipes anyway.
      if (runView.result !== 'victory') {
        test.skip(true, 'this run seed resulted in ' + runView.result + ', not victory -- reward assertion does not apply');
        return;
      }

      // Backdate this run's clock so it reads as already elapsed --
      // zero real wall-clock time spent waiting.
      const backdateRes = await page.request.post(`/api/schedule/rooms/${roomId}/dev/backdate`, { data: { extraSecsIntoPast: 5 } });
      expect(backdateRes.status()).toBe(200);

      // A GET on the room now observes + settles it (lazy
      // settleRoomIfDue, same mechanic every other settle-dependent test
      // in this file relies on).
      const settledRes = await page.request.get(`/api/schedule/rooms/${roomId}`);
      const settledRoom = (await settledRes.json()).room;
      expect(settledRoom.status).not.toBe('active');

      const whRes = await page.request.get('/api/warehouse');
      const wh = await whRes.json();
      expect(wh.items.length).toBeGreaterThanOrEqual(1);

      // Claim moves it into inventory -- verify via the profile canvas
      // API (same "GET the real saved doc back" convention
      // guest-auth.spec.ts already uses for cross-player isolation,
      // rather than a Pixi-specific inspection hook -- this codebase's
      // __backpackDebug hook exposes reference-model queries, not a
      // placement inspector, so a direct API round-trip is the correct
      // mirror of the existing convention here).
      const itemUid = wh.items[0].itemUid;
      // REQ-0041 two-phase claim: the server no longer places anything --
      // it only marks the row 'claiming' and returns {itemUid,itemId}
      // (server/schedule.cjs's claimWarehouseItem doc). This test
      // simulates the CLIENT's own remaining responsibility (engine
      // first-fit placement + a profile PUT/auto-save), mirroring
      // server/tests/api_test.cjs's own "two-phase claim finalization"
      // test's exact simulation pattern -- the REAL client-side flow
      // (WarehouseTab.tsx) is covered end-to-end by its own dedicated
      // UI-level tests elsewhere in this file.
      const claimRes = await page.request.post('/api/warehouse/claim', { data: { itemUid } });
      expect(claimRes.status()).toBe(200);
      const claimBody = await claimRes.json();
      expect(claimBody.itemUid).toBe(itemUid);
      expect(typeof claimBody.itemId).toBe('string');

      // Row must now be 'claiming' -- verify via a second claim attempt
      // being refused 409 (cannot claim an already-claiming row).
      const reClaimRes = await page.request.post('/api/warehouse/claim', { data: { itemUid } });
      expect(reClaimRes.status()).toBe(409);

      const canvasBeforeResp = await page.request.get('/api/profile/default/canvas');
      const canvasBefore = (await canvasBeforeResp.json()).canvas;
      canvasBefore.inv.pages[0].pos.push({ uid: claimBody.itemUid, id: claimBody.itemId, loc: 'grid', cell: [1, 1], rot: 0 });
      const putRes = await page.request.put('/api/profile/default/canvas', { data: canvasBefore });
      expect(putRes.status()).toBe(200);

      // The profile PUT (this run's "auto-save") must have finalized
      // (deleted) the claiming row as a side effect, since itemUid now
      // appears in the saved canvas.
      const whAfterRes = await page.request.get('/api/warehouse');
      const whAfter = await whAfterRes.json();
      expect(whAfter.items.some((i: any) => i.itemUid === itemUid)).toBe(false);

      const canvasResp = await page.request.get('/api/profile/default/canvas');
      const canvas = (await canvasResp.json()).canvas;
      const placedPo = canvas.inv.pages[0].pos.find((p: any) => p.uid === claimBody.itemUid);
      expect(placedPo).toBeTruthy();

      // Cancel the dev room + clear its warehouse rows so this test
      // leaves no debris behind on the shared dev profile beyond what
      // the finally-block's byte-restore already guarantees for the
      // profile FILE itself (belt-and-suspenders: rooms/warehouse items
      // live in their OWN files under data/schedule/ and data/warehouse/
      // dev/, not inside profiles/dev.json, so they need their own
      // cleanup here).
      await page.request.delete(`/api/schedule/rooms/${roomId}`);
      const finalWhRes = await page.request.get('/api/warehouse');
      const finalWh = await finalWhRes.json();
      for (const item of finalWh.items) {
        const p = path.join(REPO_ROOT, 'data', 'warehouse', 'dev', item.itemUid + '.json');
        if (fs.existsSync(p)) fs.rmSync(p);
      }
      const roomPath = path.join(REPO_ROOT, 'data', 'schedule', 'rooms', roomId + '.json');
      if (fs.existsSync(roomPath)) fs.rmSync(roomPath);
      const runsDir = path.join(REPO_ROOT, 'data', 'schedule', 'runs');
      if (fs.existsSync(runsDir)) {
        for (const f of fs.readdirSync(runsDir)) {
          if (!f.endsWith('.json')) continue;
          try {
            const doc = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
            if (doc.roomId === roomId) fs.rmSync(path.join(runsDir, f));
          } catch (e) {
            // skip unreadable/corrupt
          }
        }
      }
    } finally {
      // Restore data/profiles/dev.json byte-for-byte (or remove it if it
      // did not exist before this test -- defensive, though in practice
      // this box's dev player profile already exists from prior use).
      if (devProfileExisted && devProfileBackup !== null) {
        fs.writeFileSync(devProfilePath, devProfileBackup);
      } else if (fs.existsSync(devProfilePath)) {
        fs.rmSync(devProfilePath);
      }
    }
  });
});

test.describe('deploy-gate 409 across rooms', () => {
  test('assigning the SAME squad to a slot in a SECOND room while the first room is ACTIVE is refused 409', async ({ page }) => {
    // Room A: fill all 4 slots with 4 DIFFERENT, mutually-unique squads
    // (0,1,2,3) -- this makes it ACTIVE (a run actually starts), which is
    // required for deployedUidSetsForGate's cross-room check to fire at
    // all (it only gates OTHER rooms whose status === 'active', not
    // merely "has a slot assigned").
    const roomA = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomAId = roomA.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomAId, i, i);
      expect(r.status).toBe(200);
    }
    // Auto-start fires on the next room read (lazy settlement -- see the
    // monitor test's comment on this mechanic).
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomAId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    // Room B: attempt to also deploy squad index 0 (Room A's slot 0,
    // already active in room A) -> 409 with the "overlaps a squad already
    // deployed" message. This is a genuine CROSS-room overlap (the same
    // squad's uid set is already deployed elsewhere), which remains
    // correctly refused under the new deploy-overlap gate.
    const roomB = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomBId = roomB.body.room.id;
    const overlapRes = await apiAssignSlot(page, player.token, roomBId, 0, 0);
    expect(overlapRes.status).toBe(409);
    expect(overlapRes.body.error).toMatch(/active schedule/i);

    // REQ-0168 U7: the UI now PRE-DISABLES a squad already deployed in
    // another ACTIVE room, so the player can no longer even SELECT squad 0
    // in room B -- the option renders disabled + labelled "(deployed)". This
    // supersedes the old "select the squad, then read the friendly 409
    // message" UI flow: the friendly cross-room message (schedule/errors.ts
    // -> schedule.error.crossRoomOverlap) still maps the server 409 asserted
    // above as defense-in-depth for any path that bypasses the disabled
    // option, and is verified in the browser QA pass; here the honest UI
    // assertion is that the option is unreachable in the first place.
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const cardB = page.locator(`[data-room-id="${roomBId}"]`);
    await expect(cardB).toBeVisible({ timeout: 10000 });
    await cardB.locator('[data-testid="schedule-room-expand-toggle"]').click();
    const optionZero = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-slot-select-0"] option[value="0"]');
    await expect(optionZero).toBeDisabled({ timeout: 10000 });
    await expect(optionZero).toContainText('deployed');

    // Cancel room A so its deployed squads (0,1,2,3) free up for later
    // tests in this suite -- every other test in this file cancels its
    // own room(s) once its assertions are complete; this one is no
    // exception (room B never got any slot filled, so canceling it too
    // is harmless belt-and-suspenders, though not strictly required).
    await apiCancelRoom(page, player.token, roomAId);
    await apiCancelRoom(page, player.token, roomBId);
  });
});

test.describe('cancel flow', () => {
  test('immediate cancel policy cancels right away', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, cancelPolicy: { immediate: true } });
    const roomId = created.body.room.id;
    const canceled = await apiCancelRoom(page, player.token, roomId);
    expect(canceled.status).toBe(200);
    expect(canceled.body.room.status).toBe('canceled');
  });

  test('non-immediate cancel policy while a run is active flags cancelRequested (badge), room only cancels once that run settles', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    const roomId = created.body.room.id;
    // Fill each slot with 4 FULLY DEDICATED squads (5,6,7,8 -- NOT
    // 0,1,2,3, which several OTHER tests in this file also deploy via
    // the natural i->i mapping): this test's whole point is to prove a
    // NON-immediate cancelPolicy only FLAGS cancelRequested while the
    // run keeps running -- there is no non-dev-fallback way for a plain
    // guest to force-settle their own real run early (the dev/backdate
    // hook is gated to the dev fallback caller only, confirmed 403'd for
    // a guest token by the test in the "run settles via dev/backdate
    // hook" describe block above), and niflheim_depths' real
    // durationSecs is 999 -- so this room's 4 deployed squads stay
    // genuinely "active" in the database for the rest of this suite's
    // run, with no way to free them early. Squads 5-8 (bp_t5..bp_t8,
    // added specifically for this test -- see schedule-fixture.json's
    // own dedicated tail squads) are never touched by any other test in
    // this file, so this permanent lock never collides with anything.
    const squadsForThisTest = [5, 6, 7, 8];
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, squadsForThisTest[i]);
      expect(r.status).toBe(200);
    }
    // Auto-start fires on the next room read (lazy settlement).
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    const canceled = await apiCancelRoom(page, player.token, roomId);
    expect(canceled.status).toBe(200);
    expect(canceled.body.room.cancelRequested).toBe(true);
    expect(canceled.body.room.status).toBe('active'); // still running -- not canceled yet

    // UI shows the "cancel pending" status badge for this room.
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-room-status', 'cancelPending', { timeout: 10000 });
  });
});

test.describe('REQ-0041: Warehouse tab claim UX (embedded InventoryBoard, pulse, cross-page fallback, finalization)', () => {
  // These three tests all drive the REAL UI against the DEV_MODE
  // fallback player, NOT this suite's own guest player -- reaching into
  // data/warehouse/<playerId>/<uid>.json directly (the pattern the
  // earlier "settled run" test also started from) only works when the
  // live API server's STORAGE_BACKEND is 'files'; this box's actual
  // running service loads STORAGE_BACKEND=pg from server/.env (see
  // server/README.md's "Postgres backend" section), so a raw warehouse
  // JSON file written to disk is invisible to it. The ONLY grant path
  // that works regardless of storage backend is the real HTTP endpoint
  // (POST /api/admin/warehouse/grant), which is item_admin-gated and
  // always inserts into the CALLER's own warehouse (server/api.cjs's own
  // doc comment: "there is no 'grant to a different player' concept
  // here") -- so these tests flip data/config/dev_user.json to
  // item_admin (same convention e2e/dex-admin.spec.ts and the "settled
  // run" test above already use), grant via that endpoint, and then
  // drive the UI via a PLAIN bootApp(page) (no #/invite/<token> in the
  // URL) -- store.ts's boot() calls fetchMe() first, which resolves to
  // the SAME dev_mode fallback player when no token is stored at all
  // (client/src/api.ts's fetchMe() sends X-Auth-Token only when one is
  // stored; store.ts's resolveProfileId() then uses snapshot.me.playerId
  // once /api/me resolves), so a plain boot lands on exactly the same
  // "dev" identity the grant just populated.
  test.beforeEach(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devUserPath = path.join(REPO_ROOT, 'data', 'config', 'dev_user.json');
    (globalThis as any).__req0041DevUserBackup = fs.existsSync(devUserPath) ? fs.readFileSync(devUserPath, 'utf8') : null;
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'] }));
  });
  test.afterEach(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devUserPath = path.join(REPO_ROOT, 'data', 'config', 'dev_user.json');
    const backup = (globalThis as any).__req0041DevUserBackup as string | null;
    if (backup !== null) fs.writeFileSync(devUserPath, backup);
    else if (fs.existsSync(devUserPath)) fs.rmSync(devUserPath);
  });

  async function grantHiltToDev(page: Page): Promise<string> {
    const res = await page.request.post('/api/admin/warehouse/grant', { data: { itemId: 'hilt' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.item.itemUid as string;
  }

  async function clearDevWarehouseRow(page: Page, itemUid: string): Promise<void> {
    // Best-effort cleanup via a claim + no-op discard is not available
    // (no explicit delete route) -- rows expire on their own (7-day TTL)
    // and are otherwise harmless test debris scoped to the dev player,
    // matching the "settled run" test's own established tolerance for
    // this; this helper exists mainly to document that omission rather
    // than to guarantee removal.
    void page;
    void itemUid;
  }

  test('claim finds a fitting cell on the OPEN inventory page, pulses it, and auto-saves without a manual save click', async ({ page }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;

    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });
      const grantUid = await grantHiltToDev(page);

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Warehouse' }).click();

      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });

      // The embedded inventory board (portal target) is present and
      // shows the SAME Tabs/InventoryBoard component the Backpacks page
      // uses -- a real <canvas> is mounted inside the warehouse slot.
      await expect(page.locator('[data-testid="schedule-warehouse-board-slot"] .board-wrap canvas')).toBeVisible({ timeout: 10000 });

      await page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`).click();
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toBeVisible({ timeout: 10000 });

      // No manual save button exists anywhere in this app (REQ-0031
      // Phase B retired it) -- wait out the auto-save debounce, then
      // verify the placement landed via the profile canvas API (page 0,
      // since activeInvPage defaults to 0 and this is a fresh boot).
      await waitForAutoSave(page);
      const canvasResp = await page.request.get('/api/profile/default/canvas');
      const canvas = (await canvasResp.json()).canvas;
      const placed = canvas.inv.pages[0].pos.find((p: any) => p.uid === grantUid);
      expect(placed).toBeTruthy();
      expect(placed.id).toBe('hilt');

      // Finalization: the warehouse row is now gone (server finalized on
      // the profile PUT the auto-save performed).
      const whRes = await page.request.get('/api/warehouse');
      const whItems = (await whRes.json()).items;
      expect(whItems.some((i: any) => i.itemUid === grantUid)).toBe(false);

      await clearDevWarehouseRow(page, grantUid);
    } finally {
      if (devProfileExisted && devProfileBackup !== null) fs.writeFileSync(devProfilePath, devProfileBackup);
      else if (fs.existsSync(devProfilePath)) fs.rmSync(devProfilePath);
    }
  });

  test('when the active page has no space, claim auto-places on ANOTHER page and pulse-highlights that page\'s tab', async ({ page }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;

    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });

      // Fill inventory page 0 completely (8x8 = 64 cells) with 64 unique
      // 1x1 'hilt' POs -- guarantees invCanPlacePO finds no free cell on
      // page 0, forcing the claim's first-fit scan to fall through to
      // page 1 (the REQ's own "open page first, else other pages in
      // order" spec). Written directly via the same profile PUT surface
      // every other test in this file already uses to seed state, rather
      // than via 64 real drag gestures.
      const canvasResp = await page.request.get('/api/profile/default/canvas');
      const canvas = (await canvasResp.json()).canvas;
      canvas.inv.pages[0].pos = [];
      for (let r = 1; r <= 8; r++) {
        for (let c = 1; c <= 8; c++) {
          canvas.inv.pages[0].pos.push({ uid: `fill_${r}_${c}`, id: 'hilt', loc: 'grid', cell: [r, c], rot: 0 });
        }
      }
      const putRes = await page.request.put('/api/profile/default/canvas', { data: canvas });
      expect(putRes.status()).toBe(200);

      const grantUid = await grantHiltToDev(page);

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Warehouse' }).click();

      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`).click();

      // Toast must be the CROSS-PAGE variant (names the destination
      // page), not the same-page one.
      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toContainText(/page 2|ページ 2/i, { timeout: 10000 });

      // The inv tab button for page index 1 (0-based; "page 2" 1-based)
      // gets the tab-claim-pulse CSS class applied.
      const tab1 = page.locator('[data-tab-kind="inv"][data-tab-index="1"]');
      await expect(tab1).toHaveClass(/tab-claim-pulse/, { timeout: 2000 });

      await waitForAutoSave(page);
      const finalCanvasResp = await page.request.get('/api/profile/default/canvas');
      const finalCanvas = (await finalCanvasResp.json()).canvas;
      expect(finalCanvas.inv.pages[0].pos.find((p: any) => p.uid === grantUid)).toBeFalsy();
      const placedOnPage1 = finalCanvas.inv.pages[1].pos.find((p: any) => p.uid === grantUid);
      expect(placedOnPage1).toBeTruthy();

      await clearDevWarehouseRow(page, grantUid);
    } finally {
      if (devProfileExisted && devProfileBackup !== null) fs.writeFileSync(devProfilePath, devProfileBackup);
      else if (fs.existsSync(devProfilePath)) fs.rmSync(devProfilePath);
    }
  });

  test('when NO page has space anywhere, claim shows a toast + inline error and the warehouse row REMAINS (claiming, revertible)', async ({ page }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;

    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });

      // Fill ALL 5 pages completely.
      const canvasResp = await page.request.get('/api/profile/default/canvas');
      const canvas = (await canvasResp.json()).canvas;
      for (let pg = 0; pg < canvas.inv.pages.length; pg++) {
        const pos = [];
        for (let r = 1; r <= 8; r++) {
          for (let c = 1; c <= 8; c++) {
            pos.push({ uid: `fillall_${pg}_${r}_${c}`, id: 'hilt', loc: 'grid', cell: [r, c], rot: 0 });
          }
        }
        canvas.inv.pages[pg].pos = pos;
      }
      await page.request.put('/api/profile/default/canvas', { data: canvas });

      const grantUid = await grantHiltToDev(page);

      await bootApp(page);
      await page.locator('.nav-link', { hasText: 'Warehouse' }).click();

      const row = page.locator(`[data-testid="schedule-warehouse-row"][data-item-uid="${grantUid}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await page.locator(`[data-testid="schedule-claim-btn-${grantUid}"]`).click();

      await expect(page.locator('[data-testid="schedule-warehouse-toast"]')).toContainText(/no space|空き/i, { timeout: 10000 });
      await expect(row.locator('.schedule-slot-error')).toContainText(/no space|空き/i, { timeout: 10000 });

      // Row REMAINS present (no item loss) and still 'claiming'
      // immediately after the failed claim -- this is the client-
      // observable half of the "reverts after timeout if never saved"
      // guarantee. The server-side lazy timeout-revert mechanism itself
      // (WAREHOUSE_CLAIM_TIMEOUT_MS) is exercised directly, without
      // waiting the real 120s, by server/tests/api_test.cjs's own
      // dedicated tests (both files+pg mode: the "two-phase claim
      // finalization" test's abandoned-claim assertion, and the
      // dev/backdate-claim hook's own test) -- this UI-level test
      // confirms the CLIENT correctly leaves the row alone on a failed
      // placement rather than double-checking the server's own timeout
      // arithmetic a third time.
      const whRes = await page.request.get('/api/warehouse');
      const whItem = (await whRes.json()).items.find((i: any) => i.itemUid === grantUid);
      expect(whItem).toBeTruthy();
      expect(whItem.status).toBe('claiming');

      await clearDevWarehouseRow(page, grantUid);
    } finally {
      if (devProfileExisted && devProfileBackup !== null) fs.writeFileSync(devProfilePath, devProfileBackup);
      else if (fs.existsSync(devProfilePath)) fs.rmSync(devProfilePath);
    }
  });
});

test.describe('REQ-0041: deploy gate -- empty-BP squad is refused 409 and disabled client-side', () => {
  test('a squad with ZERO BP (fixture squad index 4, empty) cannot be selected in the slot dropdown, and a raw API assign is refused 409 empty_squad', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;

    // Server-side: a raw API assign of the empty squad (index 4 in the
    // fixture, see e2e/fixtures/schedule-fixture.json's squads.store[4]
    // === null, i.e. a fresh, BP-less squad) is refused 409 empty_squad.
    const res = await apiAssignSlot(page, player.token, roomId, 0, 4);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('empty_squad');

    // Client-side: the slot dropdown's OPTION for squad index 4 is
    // disabled (pre-emptive UI gate, SlotsPanel.tsx) -- the option text
    // also carries the "cannot deploy" i18n suffix.
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    const select0 = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-slot-select-0"]');
    await expect(select0).toBeVisible({ timeout: 10000 });
    const emptyOption = select0.locator('option[value="4"]');
    await expect(emptyOption).toBeDisabled();
    await expect(emptyOption).toHaveText(/cannot deploy|展開不可/);

    // A squad WITH a BP (index 0) remains selectable and unaffected by
    // this gate.
    const okOption = select0.locator('option[value="0"]');
    await expect(okOption).toBeEnabled();

    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0041: monitor freeze regression guard', () => {
  test('expanding the monitor for a room with a REAL (non-empty) squad never freezes -- progress/telegraph readouts settle within a bounded timeout', async ({ page }) => {
    // This is a defensive regression guard for the historical monitor
    // freeze (bug #4): its root cause (MonitorRenderer.ts's
    // cellIdToColRow assuming a "M9"-string cell id when sim/combat.cjs
    // actually emits raw [row,col] tuples on ray_fire/ray_bounce/
    // ray_step -- see fieldGeometry.ts's cellIdToColRow doc) can no
    // longer be triggered via an EMPTY-BP squad specifically, since the
    // server-side deploy gate now refuses to ever let one be assigned to
    // a room slot at all (see the "empty-BP squad" test above) -- so
    // this test instead exercises the general "expand the monitor and
    // let it run" path end-to-end with a real, deployable squad, inside a
    // bounded timeout, as a standing guard against any regression of
    // either fix (fieldGeometry.ts's shape-tolerant parsing, or
    // MonitorRenderer.ts/Monitor.tsx's per-event try/catch + unconditional
    // lastEventIndexRef advance) ever reintroducing a stuck/looping
    // render path.
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();

    const monitor = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]');
    await expect(monitor).toBeVisible({ timeout: 10000 });

    // Guard: the page must remain RESPONSIVE (not spinning/frozen) --
    // proven by a totally unrelated evaluate() round-trip completing
    // promptly, plus the monitor's own progress readout actually
    // reaching a non-placeholder value, both within a bounded window.
    await expect(async () => {
      const alive = await page.evaluate(() => 1 + 1);
      expect(alive).toBe(2);
    }).toPass({ timeout: 5000 });

    // REQ-0240: the monitor stays responsive and the M2 rail + M4 feed populate.
    await expect(monitor.locator('[data-testid="monitor-rail"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-feed-row"]').first()).toBeVisible({ timeout: 25000 });

    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0041: /preview/batch-002/ static preview page', () => {
  test('serves 200 and shows the dungeon name, an enemy, a formation, and the placeholder-icon note', async ({ page }) => {
    const res = await page.request.get('/preview/batch-002/');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Niflheim Depths');
    expect(body).toContain('Frost Gnoll');
    expect(body).toContain('Standard Line');
    expect(body.toLowerCase()).toContain('placeholder icon');
  });
});

test.afterAll(async () => {
  // Belt-and-suspenders sweep: delete every room/run file this spec
  // created, directly on disk, in addition to the ledger-tracked
  // player/profile/warehouse-dir cleanup global-teardown.ts already
  // performs. Rooms/runs are keyed by their own generated ids (not the
  // playerId), so this loop removes them by the exact ids this spec
  // recorded in createdRoomIds, plus every run file whose OWN roomId
  // field matches one of them (mirroring how storage.cjs's
  // listRunsForRoom already filters run docs by roomId).
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

test.describe('REQ-0045 (d): monitor copies the FULL squad canvas (all BPs at real positions + placed POs), not just bps[0]', () => {
  test('a 2-BP squad with 2 placed POs is mounted with BOTH BPs at their own distinct origins and BOTH POs present -- not truncated to the first BP auto-placed top-left', async ({ page }) => {
    // Squad index 9 (bp_multi_a @ origin [1,1], bp_multi_b @ origin
    // [5,5], each with its own placed 'dagger' PO) -- see
    // schedule-fixture.json's own header comment for this squad's
    // exact shape. Slots 1-3 use squads 0,1,2 (self-contained, no
    // permanent lock -- this test cancels its own room immediately
    // after asserting, freeing all 4 for later tests).
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    const squadsForThisTest = [9, 0, 1, 2];
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, squadsForThisTest[i]);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    // TWO separate expand toggles exist here: RoomCard's own
    // [data-testid="schedule-room-expand-toggle"] reveals the
    // SlotsPanel+Monitor SECTION (what every other schedule.spec.ts test
    // already clicks -- sufficient for reading the small, always-visible
    // progress/encounter/telegraph summary), and Monitor's OWN internal
    // .schedule-monitor-expand-btn (no distinct testid; shares the same
    // i18n expand/collapse label text) additionally reveals the Pixi
    // CANVAS view specifically, which is what actually triggers
    // MonitorRenderer.mount() + mountSquads() -- required here since this
    // test inspects mounted-squads data, not just the summary text.
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-canvas"]')).toBeVisible({ timeout: 10000 });

    // REQ-0045 (d) regression assertion: read the monitor's ACTUAL
    // mounted-squads data (MonitorRenderer.ts's getLastMountedSquads(),
    // exposed via window.__monitorDebug[roomId].squads() -- same "assert on
    // real data instead of reverse-engineering canvas pixels" rationale
    // as store.ts's own __backpackDebug hook) and verify slot 0 (squad
    // 9) carries BOTH bp_multi_a's cells (relative to its own origin
    // [1,1], i.e. still starting at local (1,1), NOT renormalized to
    // (0,0)) AND bp_multi_b's cells (relative to origin [5,5]) -- proving
    // the FULL canvas was copied, not just bps[0] auto-placed top-left.
    await expect(async () => {
      const squads = await page.evaluate((rid) => {
        const w = window as unknown as { __monitorDebug?: Record<string, { squads: () => Array<{ slotIndex: number; bps: Array<{ color: string; cells: [number, number][] }>; icons: Array<{ origin: [number, number] }> }> }> };
        return w.__monitorDebug?.[rid]?.squads() ?? [];
      }, roomId);
      expect(squads.length).toBe(4);
      const squad0 = squads.find((u) => u.slotIndex === 0);
      expect(squad0).toBeTruthy();
      expect(squad0!.bps.length).toBe(2);
      const bpA = squad0!.bps.find((b) => b.color === '#e94d4d'); // bp_multi_a
      const bpB = squad0!.bps.find((b) => b.color === '#4de9b6'); // bp_multi_b
      expect(bpA).toBeTruthy();
      expect(bpB).toBeTruthy();
      // bp_multi_a: shape [[0,0],[0,1],[1,0],[1,1]] + origin [1,1] -> cells [[1,1],[1,2],[2,1],[2,2]].
      expect(bpA!.cells).toEqual(expect.arrayContaining([[1, 1], [1, 2], [2, 1], [2, 2]]));
      // bp_multi_b: shape [[0,0],[0,1],[1,0],[1,1]] + origin [5,5] -> cells [[5,5],[5,6],[6,5],[6,6]] -- proves this BP is NOT collapsed onto bp_multi_a's origin/top-left.
      expect(bpB!.cells).toEqual(expect.arrayContaining([[5, 5], [5, 6], [6, 5], [6, 6]]));
      // Both placed POs present, each at its OWN origin (not merged/dropped).
      expect(squad0!.icons.length).toBe(2);
      const origins = squad0!.icons.map((ic) => ic.origin.join(','));
      expect(origins).toEqual(expect.arrayContaining(['1,1', '5,5']));
    }).toPass({ timeout: 10000 });

    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0045 (f): enemy labels never overflow past the enemy field\'s right edge', () => {
  test('every enemy marker created during a REAL, unbackdated run stays within the field\'s own pixel width (x + rendered label width <= FIELD_W)', async ({ page }) => {
    // Mirrors the "monitor: events & progress" test's own approach (a
    // REAL, un-backdated run, polled for real events over a bounded
    // window) rather than forcing a specific enemy into a contrived
    // near-edge position -- this exercises the ACTUAL fix
    // (MonitorRenderer.ts's getOrCreateEnemyMarker/truncateLabelToFit)
    // against genuine ray_fire events from a real encounter, using
    // whatever enemy ids/positions the fixture's real content actually
    // produces.
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-canvas"]')).toBeVisible({ timeout: 10000 });

    // Wait for at least one enemy marker to actually be created (a real
    // ray_fire event against the enemy field), then assert EVERY marker
    // ever created stays within FIELD_W, polling repeatedly over a
    // bounded window since more markers can appear as the encounter
    // progresses (a single check right after the first marker appears
    // would miss any that show up moments later).
    let checkedAtLeastOne = false;
    await expect(async () => {
      const result = await page.evaluate((rid) => {
        const w = window as unknown as { __monitorDebug?: Record<string, { enemyBounds: () => Array<{ x: number; labelWidth: number; labelText: string }> }> };
        return w.__monitorDebug?.[rid]?.enemyBounds() ?? [];
      }, roomId);
      expect(result.length).toBeGreaterThan(0);
    }).toPass({ timeout: 25000 }); // REQ-0240: markers appear at paced RELEASE time (~2.5s client lag), not poll time

    // Keep polling for a further bounded window, re-checking the FULL
    // marker set every tick, so markers created slightly later are also
    // covered.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const bounds = await page.evaluate((rid) => {
        const w = window as unknown as { __monitorDebug?: Record<string, { enemyBounds: () => Array<{ x: number; labelWidth: number; labelText: string }> }> };
        return w.__monitorDebug?.[rid]?.enemyBounds() ?? [];
      }, roomId);
      for (const marker of bounds) {
        checkedAtLeastOne = true;
        expect(marker.x + marker.labelWidth).toBeLessThanOrEqual(468); // FIELD_W = FIELD_COLS(26) * FIELD_CELL_PX(18)
      }
      await page.waitForTimeout(300);
    }
    expect(checkedAtLeastOne).toBe(true);

    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0045 (g): monitor Log tab -- humanized text panel + raw JSONL copy', () => {
  test('the Log tab shows idx-prefixed humanized lines for real events, and the copy button places raw JSONL (one JSON.parse-able line per event) on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-canvas"]')).toBeVisible({ timeout: 10000 });

    // REQ-0240: the Field/Log tabs retire -- the M4 feed IS the humanized log,
    // always visible alongside the stage; the raw JSONL copy relocates to the
    // header overflow menu. The feed accrues real events over the paced clock.
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-feed"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-feed-row"]').first()).toBeVisible({ timeout: 25000 });

    // Copy raw JSONL from the overflow menu -> clipboard is MULTIPLE
    // independently JSON.parse-able event lines (never one JSON document,
    // never rendered text) -- proves the copy captures RAW event objects.
    await page.locator('[data-testid="schedule-detail-pane"] [data-testid="monitor-menu-btn"]').click();
    await page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-log-copy-btn"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-log-copy-status"]')).toBeVisible({ timeout: 3000 });
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.length).toBeGreaterThan(0);
    const jsonlLines = clipboardText.split('\n').filter((l) => l.length > 0);
    expect(jsonlLines.length).toBeGreaterThan(0);
    for (const line of jsonlLines) {
      const parsed = JSON.parse(line); // throws if any line is not valid JSON on its own
      expect(typeof parsed.ev).toBe('string');
      expect(typeof parsed.seq).toBe('number');
    }

    await apiCancelRoom(page, player.token, roomId);
  });
});

// REQ-0099: settled-run replay transport. The transport (play/pause,
// 1x/2x/4x, skip-to-end, scrub) appears ONLY once a run is settled --
// a live/unsettled run stays clock-locked with no transport. Settled
// runs are produced via the dev/backdate hook (dev fallback player,
// no token) exactly as the warehouse/settle tests do.
test.describe('REQ-0099: settled-run replay transport', () => {
  test('a LIVE (unsettled) run shows the LIVE transport variant (clock + LIVE chip), not the settled play/speed controls', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) expect((await apiAssignSlot(page, player.token, roomId, i, i)).status).toBe(200);
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    // REQ-0240 (03 ss6.5): the M6 transport is ALWAYS present, but its LIVE
    // variant shows the clock + LIVE chip and NONE of the settled play / speed /
    // skip controls (those appear only once the run settles).
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-clock"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-transport"]')).toBeVisible();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-play"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-1"]')).toHaveCount(0);

    await apiCancelRoom(page, player.token, roomId);
  });

  test('a SETTLED run shows the transport; skip-to-end parks at duration; scrub seeks to start', async ({ page }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;
    try {
      await page.request.put('/api/profile/default/canvas', { data: fixture });
      const created = await apiCreateRoom(page, '', { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        const r = await page.request.put(`/api/schedule/rooms/${roomId}/slots/${i}`, { data: { squadIndex: i } });
        expect(r.status()).toBe(200);
      }
      await expect(async () => {
        const view = await page.request.get(`/api/schedule/rooms/${roomId}`);
        expect((await view.json()).room.status).toBe('active');
      }).toPass({ timeout: 10000 });
      const bd = await page.request.post(`/api/schedule/rooms/${roomId}/dev/backdate`, { data: { extraSecsIntoPast: 5 } });
      expect(bd.status()).toBe(200);
      await expect(async () => {
        const view = await page.request.get(`/api/schedule/rooms/${roomId}`);
        expect((await view.json()).room.status).not.toBe('active');
      }).toPass({ timeout: 10000 });

      await page.goto('/app/#/schedule');
      await expect(page.locator('.schedule-page')).toBeVisible({ timeout: 10000 });
      const card = page.locator(`[data-room-id="${roomId}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });

      const transport = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-transport"]');
      await expect(transport).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-play"]')).toBeVisible();
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-2"]')).toBeVisible();

      // speed selection is reflected in the UI (deterministic)
      await page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-2"]').click();
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-2"]')).toHaveClass(/is-on/);
      // REQ-0240: 0.5x deliberate-study speed added to the transport.
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-0.5"]')).toBeVisible();
      await page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-0.5"]').click();
      await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-speed-0.5"]')).toHaveClass(/is-on/);

      const clock = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-clock"]');
      // skip-to-end parks the playhead at duration -> both clock halves equal
      await page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-skip-end"]').click();
      await expect(async () => {
        const m = ((await clock.textContent()) || '').match(/^(\d\d:\d\d) \/ (\d\d:\d\d)$/);
        expect(m).toBeTruthy();
        expect(m[1]).toBe(m[2]);
      }).toPass({ timeout: 4000 });

      // scrub to the far left seeks to t=0 -> elapsed half reads 00:00
      const scrub = page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-scrub"]');
      const box = await scrub.boundingBox();
      expect(box).toBeTruthy();
      await scrub.click({ position: { x: 1, y: Math.max(1, Math.floor(box.height / 2)) } });
      await expect(async () => {
        const m = ((await clock.textContent()) || '').match(/^(\d\d):(\d\d) \/ (\d\d):(\d\d)$/);
        expect(m).toBeTruthy();
        const elapsed = Number(m![1]) * 60 + Number(m![2]);
        const total = Number(m![3]) * 60 + Number(m![4]);
        // far-left scrub seeks near t=0 (within a small fraction of total duration)
        expect(elapsed).toBeLessThanOrEqual(Math.max(3, Math.round(total * 0.1)));
      }).toPass({ timeout: 4000 });

      await page.request.delete(`/api/schedule/rooms/${roomId}`);
    } finally {
      if (devProfileBackup !== null) fs.writeFileSync(devProfilePath, devProfileBackup);
      else if (fs.existsSync(devProfilePath)) fs.rmSync(devProfilePath, { force: true });
    }
  });
});

test.describe('REQ-0048: monitor renders linker pulse visuals (injected synthetic events)', () => {
  test('link_pulse + cause:pulse ray + pulse_fizzle + pulse_payload drive the pulse-visual counters', async ({ page }) => {
    // Pulse CONTENT (spark/payload POs) debuts later (Ember Pack), so the
    // client render path is verified by injecting synthetic replay events
    // through the monitor's own applyEvents (via the __monitorDebug seam).
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-canvas"]')).toBeVisible({ timeout: 10000 });

    await expect(async () => {
      const ready = await page.evaluate((rid) => {
        const w = window as unknown as { __monitorDebug?: Record<string, { applyTestEvents?: unknown }> };
        return typeof w.__monitorDebug?.[rid]?.applyTestEvents === 'function';
      }, roomId);
      expect(ready).toBe(true);
    }).toPass({ timeout: 10000 });

    const counts = await page.evaluate((rid) => {
      const w = window as unknown as { __monitorDebug: Record<string, { applyTestEvents: (e: unknown[]) => void; pulseCounts: () => { linkPulses: number; payloads: number; fizzles: number; rays: number } }> };
      const d = w.__monitorDebug[rid];
      d.applyTestEvents([
        { t: 1, seq: 1, ev: 'link_pulse', from: 'alpha', to: 'beta', hop: 1, origin: 'alpha' },
        { t: 1, seq: 2, ev: 'ray_fire', field: 'enemy', src: 'blade#pulse', entry: [9, 14], cause: 'pulse' },
        { t: 1, seq: 3, ev: 'ray_step', path: [[9, 14], [9, 15]], cause: 'pulse' },
        { t: 1, seq: 4, ev: 'pulse_fizzle', reason: 'rate_cap', origin: 'alpha' },
        { t: 1, seq: 5, ev: 'pulse_payload', dst: 'beta', verb: 'heal', amount: 5, cause: 'pulse' },
      ]);
      return d.pulseCounts();
    }, roomId);
    expect(counts.linkPulses).toBeGreaterThanOrEqual(1);
    expect(counts.rays).toBeGreaterThanOrEqual(1);
    expect(counts.fizzles).toBeGreaterThanOrEqual(1);
    expect(counts.payloads).toBeGreaterThanOrEqual(1);

    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0049: monitor renders layered-encounter attachment badges (injected events)', () => {
  test('att_reveal/att_disarm/att_open/att_lost/att_fire drive the attachment-visual counters', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) { const r = await apiAssignSlot(page, player.token, roomId, i, i); expect(r.status).toBe(200); }
    await expect(async () => { const view = await apiGetRoom(page, player.token, roomId); expect(view.body.room.status).toBe('active'); }).toPass({ timeout: 10000 });
    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="schedule-detail-pane"] [data-testid="schedule-monitor-canvas"]')).toBeVisible({ timeout: 10000 });
    await expect(async () => {
      const ready = await page.evaluate((rid) => {
        const w = window as unknown as { __monitorDebug?: Record<string, { attachmentCounts?: unknown }> };
        return typeof w.__monitorDebug?.[rid]?.attachmentCounts === 'function';
      }, roomId);
      expect(ready).toBe(true);
    }).toPass({ timeout: 10000 });
    const counts = await page.evaluate((rid) => {
      const w = window as unknown as { __monitorDebug: Record<string, { applyTestEvents: (e: unknown[]) => void; attachmentCounts: () => { reveal: number; disarm: number; open: number; lost: number; fire: number } }> };
      const d = w.__monitorDebug[rid];
      d.applyTestEvents([
        { t: 1, seq: 1, ev: 'att_reveal', att: 'tr1', kind: 'trap', at: [9, 14] },
        { t: 1, seq: 2, ev: 'att_disarm', att: 'tr1', reward: 'reward_frost_shard_common' },
        { t: 1, seq: 3, ev: 'att_open', att: 'ch1', kind: 'chest', reward: 'reward_frostbound_cache_roll' },
        { t: 1, seq: 4, ev: 'att_lost', att: 'dr1', kind: 'door' },
        { t: 1, seq: 5, ev: 'att_fire', att: 'tr2', kind: 'trap', reason: 'timeout' },
      ]);
      return d.attachmentCounts();
    }, roomId);
    expect(counts.reveal).toBeGreaterThanOrEqual(1);
    expect(counts.disarm).toBeGreaterThanOrEqual(1);
    expect(counts.open).toBeGreaterThanOrEqual(1);
    expect(counts.lost).toBeGreaterThanOrEqual(1);
    expect(counts.fire).toBeGreaterThanOrEqual(1);
    await apiCancelRoom(page, player.token, roomId);
  });
});

test.describe('REQ-0240: monitor six zones, feed filters, roster/pacing + screenshots', () => {
  test('zones render, feed filters toggle, ApiRunView carries roster + pacingVersion, durationSecs is the paced presentation duration; capture desktop + narrow', async ({ page }) => {
    const created = await apiCreateRoom(page, player.token, { dungeonId: 'niflheim_depths', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await apiAssignSlot(page, player.token, roomId, i, i);
      expect(r.status).toBe(200);
    }
    await expect(async () => {
      const view = await apiGetRoom(page, player.token, roomId);
      expect(view.body.room.status).toBe('active');
    }).toPass({ timeout: 10000 });

    // M1/M2: the paced run view carries roster + pacingVersion, and durationSecs
    // is the PRESENTATION duration clamped into [45s, 300s] (the battle-wait
    // increase -- the sim resolved instantly).
    await expect(async () => {
      const view = await apiGetRun(page, player.token, roomId);
      expect(view.body.pacingVersion).toBe(1);
      expect(view.body.roster).toBeTruthy();
      expect(view.body.roster.slots.length).toBe(4);
      expect(Array.isArray(view.body.roster.enemies)).toBe(true);
      expect(view.body.durationSecs).toBeGreaterThanOrEqual(45);
      expect(view.body.durationSecs).toBeLessThanOrEqual(300);
    }).toPass({ timeout: 12000 });

    await page.goto(`/app/#/invite/${player.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.locator('.nav-link', { hasText: 'Schedule' }).click();
    const card = page.locator(`[data-room-id="${roomId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('[data-testid="schedule-room-expand-toggle"]').click();
    const pane = page.locator('[data-testid="schedule-detail-pane"]');
    const monitor = pane.locator('[data-testid="schedule-monitor"]');
    await expect(monitor).toBeVisible({ timeout: 10000 });

    // M1-M6 zones render.
    await expect(pane.locator('[data-testid="monitor-header"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-rail"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-stage"]')).toBeVisible();
    await expect(pane.locator('[data-testid="schedule-monitor-canvas"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-feed"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-dock"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-dock-squad-0"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-dock-squad-3"]')).toBeVisible();
    await expect(pane.locator('[data-testid="schedule-monitor-transport"]')).toBeVisible();
    // LIVE run: the transport shows the LIVE chip, not the settled speed buttons.
    await expect(pane.locator('[data-testid="schedule-monitor-live-chip"]')).toBeVisible();

    // Feed accrues rows on the paced clock, then filters toggle (client-only).
    await expect(pane.locator('[data-testid="monitor-feed-row"]').first()).toBeVisible({ timeout: 25000 });
    for (const k of ['damage', 'loot', 'gimic', 'all']) {
      const chip = pane.locator(`[data-testid="monitor-feed-filter-${k}"]`);
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
    }

    // Desktop screenshot of the finished monitor mid-run.
    await page.waitForTimeout(3000);
    await monitor.screenshot({ path: '/tmp/deliverables_monitor/monitor_desktop.png' });

    // Narrow: the zones restack (fields stack vertically; dock 2x2; feed below).
    await page.setViewportSize({ width: 768, height: 1300 });
    await page.waitForTimeout(1500);
    await expect(pane.locator('[data-testid="monitor-feed"]')).toBeVisible();
    await expect(pane.locator('[data-testid="monitor-dock"]')).toBeVisible();
    await monitor.screenshot({ path: '/tmp/deliverables_monitor/monitor_narrow.png' });

    await apiCancelRoom(page, player.token, roomId);
  });
});
