// client/e2e/seal.spec.ts -- REQ-0058: Sealed Seed Share E2E coverage.
//
// Drives the full sealed-run contract against the REAL /app/ + API
// service, mostly via page.request (same convention schedule.spec.ts uses
// for its API-shaped assertions), plus a light UI smoke that the Sealed
// Runs panel renders on the Schedule page.
//
// Two participants: the DEV_MODE FALLBACK player (no X-Auth-Token -- the
// only caller that can settle a run without waiting out real wall-clock
// time, via the dev/backdate hook, exactly like the warehouse-rewards
// test in schedule.spec.ts) and a fresh guest player B (real token). The
// seal is minted by the dev player; guest B joins with the share token
// and runs it once, is held out of the comparison until it settles (it
// never does here -- niflheim_depths' natural durationSecs is 999s), and
// is refused a second join (duplicate rejection). The dev player joins,
// runs, backdates + settles its OWN run, and THEN sees the unlocked
// comparison revealing every participant -- the anti-spoiler transition
// on a single viewer.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT, E2E_CLI_ENV } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from './global-setup';

const REPO_ROOT = E2E_DATA_ROOT;
const CLI_INVITE_PATH = join(E2E_CODE_ROOT, 'server', 'cli_invite.cjs');
const SCHEDULE_FIXTURE_PATH = new URL('./fixtures/schedule-fixture.json', import.meta.url);

interface CreatedPlayer { playerId: string; token: string; name: string; }

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
  if (!playerIdMatch || !tokenMatch) throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  const playerId = playerIdMatch[1];
  const token = tokenMatch[1];
  trackFileForCleanup(join(PLAYERS_DIR, playerId + '.json'), `seal E2E guest registry (${name})`);
  trackFileForCleanup(join(PROFILES_DIR, playerId + '.json'), `seal E2E guest profile (${name})`);
  trackFileForCleanup(join(REPO_ROOT, 'data', 'warehouse', playerId), `seal E2E guest warehouse dir (${name})`);
  return { playerId, token, name };
}

const createdRoomIds: string[] = [];
const createdSealIds: string[] = [];
let guestB: CreatedPlayer;
let fixture: unknown;

async function fillAndStart(page: Page, token: string | '', roomId: string): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const headers = token ? { 'X-Auth-Token': token } : undefined;
    const r = await page.request.put(`/api/schedule/rooms/${roomId}/slots/${i}`, headers ? { headers, data: { squadIndex: i } } : { data: { squadIndex: i } });
    expect(r.status(), `slot ${i}`).toBe(200);
  }
  let runId = '';
  await expect(async () => {
    const headers = token ? { 'X-Auth-Token': token } : undefined;
    const view = await page.request.get(`/api/schedule/rooms/${roomId}`, headers ? { headers } : undefined);
    const room = (await view.json()).room;
    expect(room.status).toBe('active');
    runId = room.lastRunId;
    expect(runId).toBeTruthy();
  }).toPass({ timeout: 10000 });
  return runId;
}

test.beforeAll(() => {
  guestB = createGuestPlayer('E2E SealGuestB');
  fixture = JSON.parse(readFileSync(SCHEDULE_FIXTURE_PATH, 'utf8'));
});

test.describe('sealed seed share', () => {
  test('seal -> share -> second player runs once -> anti-spoiler hold -> comparison unlocks after own settle; duplicate-run rejection', async ({ page }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const devProfilePath = path.join(REPO_ROOT, 'data', 'profiles', 'e2e_ci.json');
    const devProfileExisted = fs.existsSync(devProfilePath);
    const devProfileBackup = devProfileExisted ? fs.readFileSync(devProfilePath, 'utf8') : null;

    try {
      // Clean slate for the dev fallback player's schedule rooms so its
      // fixture squads are not already deployed in a leftover active room.
      await page.request.post('/api/schedule/rooms/dev/clear');
      await page.request.put('/api/profile/default/canvas', { data: fixture });
      await page.request.put(`/api/profile/${guestB.playerId}/canvas`, { headers: { 'X-Auth-Token': guestB.token }, data: fixture });

      const meRes = await page.request.get('/api/me');
      const devId = (await meRes.json()).playerId as string;

      // 1) SEAL: the dev player mints a sealed schedule (server-minted seed).
      const sealRes = await page.request.post('/api/schedule/seal', { data: { dungeonId: 'niflheim_depths', level: 1 } });
      expect(sealRes.status()).toBe(200);
      const sealBody = await sealRes.json();
      const sealId = sealBody.seal.sealId as string;
      createdSealIds.push(sealId);
      expect(sealBody.shareToken).toBe(sealId);
      expect(sealBody.seal.genSeed).toBeUndefined(); // seed withheld from the share

      // 2) SHARE + second player runs once: guest B joins with the token.
      const joinRes = await page.request.post('/api/schedule/rooms', { headers: { 'X-Auth-Token': guestB.token }, data: { sealId } });
      expect(joinRes.status()).toBe(200);
      const bRoom = (await joinRes.json()).room;
      createdRoomIds.push(bRoom.id);
      expect(bRoom.sealId).toBe(sealId);
      expect(typeof bRoom.genSeed).toBe('string'); // frozen tuple copied verbatim
      await fillAndStart(page, guestB.token, bRoom.id); // B's run is now in flight (not settled)

      // 3) ANTI-SPOILER HOLD: B's own run has not settled -> comparison masked.
      const bLocked = await page.request.get(`/api/schedule/seals/${sealId}/comparison`, { headers: { 'X-Auth-Token': guestB.token } });
      expect(bLocked.status()).toBe(200);
      const bLockedBody = await bLocked.json();
      expect(bLockedBody.unlocked).toBe(false);
      expect(bLockedBody.participants.length).toBe(0);
      expect(bLockedBody.self).toBeTruthy();

      // 4) DUPLICATE-RUN REJECTION: B cannot join the same sealId twice.
      const dup = await page.request.post('/api/schedule/rooms', { headers: { 'X-Auth-Token': guestB.token }, data: { sealId } });
      expect(dup.status()).toBe(409);
      expect((await dup.json()).reason).toBe('seal_already_joined');

      // Non-participant is forbidden from the comparison entirely.
      const outsider = await page.request.get(`/api/schedule/seals/${sealId}/comparison`);
      // (the dev player is NOT yet a participant -> 403)
      expect(outsider.status()).toBe(403);

      // 5) The dev player joins the same seal and runs it.
      const devJoin = await page.request.post('/api/schedule/rooms', { data: { sealId } });
      expect(devJoin.status()).toBe(200);
      const devRoom = (await devJoin.json()).room;
      createdRoomIds.push(devRoom.id);
      expect(devRoom.genSeed).toBe(bRoom.genSeed); // both recipients share the frozen seed
      const devRunId = await fillAndStart(page, '', devRoom.id);

      // Before the dev player settles: its own comparison is still locked.
      const devLocked = await page.request.get(`/api/schedule/seals/${sealId}/comparison`);
      expect((await devLocked.json()).unlocked).toBe(false);

      // 6) Backdate the dev run's clock + settle it (no real wall-clock wait).
      const backdate = await page.request.post(`/api/schedule/rooms/${devRoom.id}/dev/backdate`, { data: { extraSecsIntoPast: 5 } });
      expect(backdate.status()).toBe(200);
      await page.request.get(`/api/schedule/rooms/${devRoom.id}`); // triggers settle

      // 7) COMPARISON UNLOCKS AFTER OWN SETTLE: the dev player now sees every participant.
      const devOpen = await page.request.get(`/api/schedule/seals/${sealId}/comparison`);
      const devOpenBody = await devOpen.json();
      expect(devOpenBody.unlocked).toBe(true);
      const ids = (devOpenBody.participants as Array<{ playerId: string }>).map((x) => x.playerId).sort();
      expect(ids).toEqual([devId, guestB.playerId].sort());
      const selfEntry = (devOpenBody.participants as Array<{ isSelf: boolean; settled: boolean; timeline: unknown }>).find((x) => x.isSelf)!;
      expect(selfEntry.settled).toBe(true);
      expect(selfEntry.timeline).toBeTruthy();

      // 8) Seal-scoped replay: dev (settled) may read B's replay; B (unsettled) may NOT read dev's.
      const devReadsB = await page.request.get(`/api/schedule/seals/${sealId}/runs/${encodeURIComponent(guestB.playerId)}`);
      expect(devReadsB.status()).toBe(200);
      expect(Array.isArray((await devReadsB.json()).events)).toBe(true);
      const bReadsDev = await page.request.get(`/api/schedule/seals/${sealId}/runs/${encodeURIComponent(devId)}`, { headers: { 'X-Auth-Token': guestB.token } });
      expect(bReadsDev.status()).toBe(403);
      expect((await bReadsDev.json()).reason).toBe('seal_replay_locked');

      void devRunId;
    } finally {
      if (devProfileBackup !== null) fs.writeFileSync(devProfilePath, devProfileBackup);
      else if (fs.existsSync(devProfilePath)) fs.rmSync(devProfilePath, { force: true });
    }
  });

  // NOTE: a UI-render test for the SealPanel is intentionally NOT included here.
  // The e2e box serves the app's STATIC bundle from the DEPLOYED build
  // (backpack-web.service :8801), never a worktree's dist, so a brand-new
  // component cannot be e2e-rendered until the integration owner deploys.
  // The SealPanel's compile-correctness is covered by the client typecheck+
  // build gate (tools/ci.sh step 6); its behavior is covered API-side above
  // (the fleet backend IS this worktree's server/api.cjs, so the seal routes
  // exist under E2E_PARALLEL>=1).
});

test.afterAll(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const roomsDir = path.join(REPO_ROOT, 'data', 'schedule', 'rooms');
  const runsDir = path.join(REPO_ROOT, 'data', 'schedule', 'runs');
  const sealedDir = path.join(REPO_ROOT, 'data', 'schedule', 'sealed_seeds');
  const sealRunsDir = path.join(REPO_ROOT, 'data', 'schedule', 'seal_runs');
  for (const roomId of createdRoomIds) {
    const rp = path.join(roomsDir, roomId + '.json');
    if (fs.existsSync(rp)) fs.rmSync(rp);
  }
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
        if (createdRoomIds.includes(doc.roomId)) fs.rmSync(path.join(runsDir, f));
      } catch (e) { /* skip */ }
    }
  }
  for (const sealId of createdSealIds) {
    const sp = path.join(sealedDir, sealId + '.json');
    if (fs.existsSync(sp)) fs.rmSync(sp);
    if (fs.existsSync(sealRunsDir)) {
      for (const f of fs.readdirSync(sealRunsDir)) {
        if (f.startsWith(sealId + '__')) fs.rmSync(path.join(sealRunsDir, f));
      }
    }
  }
});
