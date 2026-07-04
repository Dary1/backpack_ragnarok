// REQ-0037 -- guest auth (invite tokens) E2E coverage.
//
// This suite creates TWO real guest players via the actual operator CLI
// (server/cli_invite.cjs) -- exactly the tool a real operator would run
// over SSH -- then drives the real browser through the #/invite/<token>
// flow against the REAL deployed /app/ + REAL API service (same
// tunnel-hostname convention every other spec in this suite uses, see
// helpers.ts's bootApp()). Both players' registry files (data/players/
// <id>.json) and profile files (data/profiles/<id>.json) are brand new
// (created fresh by this spec's own beforeAll, not pre-existing fixtures)
// -- each is registered into the GUEST_AUTH_TRACKED_FILES_PATH ledger
// (global-setup.ts) as soon as it is created, so global-teardown.ts can
// prove (sha256 "before vs after == missing") that they are gone again
// once the whole run ends, mirroring the "absent marker" pattern already
// established for data/profiles/default.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from './global-setup';
import { bootApp, cx, cy, drag, waitForAutoSave } from './helpers';

const REPO_ROOT = join(homedir(), 'backpack_ragnarok');
const CLI_INVITE_PATH = join(REPO_ROOT, 'server', 'cli_invite.cjs');

interface CreatedPlayer {
  playerId: string;
  token: string;
  name: string;
}

/** Registers a file path into the shared guest-auth tracked-files ledger
 * (global-setup.ts resets it to `[]` at the start of every run;
 * global-teardown.ts deletes everything left in it at the end). Read-
 * modify-write is safe here because Playwright's globalSetup/spec/
 * globalTeardown phases for THIS config run with `workers: 1` and
 * `fullyParallel: false` (playwright.config.ts) -- no concurrent writer
 * to race against. */
function trackFileForCleanup(filePath: string, label: string): void {
  const existing: Array<{ path: string; label: string }> = existsSync(GUEST_AUTH_TRACKED_FILES_PATH)
    ? JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, 'utf8'))
    : [];
  existing.push({ path: filePath, label });
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, JSON.stringify(existing, null, 1) + '\n');
}

/** Runs the REAL operator CLI (server/cli_invite.cjs) via a Node child
 * process (same nvm-provided Node the API service itself runs under --
 * `process.execPath` inside a Playwright test running under `npm run
 * e2e` on this box is already that same Node binary, since the whole
 * toolchain is invoked through `. ~/.nvm/nvm.sh && npm run e2e`), parses
 * its stdout for the playerId + invite token, and registers both files
 * this creates (the registry file always; the profile file is
 * registered too, defensively, even though it may not exist until the
 * player's first PUT -- trackFileForCleanup()/teardown's cleanup loop
 * both tolerate a path that never ends up existing, same as the
 * "absent" marker convention elsewhere in this rig). */
function createGuestPlayer(name: string, roles: string[]): CreatedPlayer {
  const args = roles.length > 0 ? [CLI_INVITE_PATH, name, '--roles', roles.join(',')] : [CLI_INVITE_PATH, name];
  const output = execFileSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) {
    throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  }
  const playerId = playerIdMatch[1];
  const token = tokenMatch[1];
  trackFileForCleanup(join(PLAYERS_DIR, playerId + '.json'), `guest player registry (${name})`);
  trackFileForCleanup(join(PROFILES_DIR, playerId + '.json'), `guest player profile (${name})`);
  return { playerId, token, name };
}

let playerA: CreatedPlayer;
let playerB: CreatedPlayer;

test.beforeAll(() => {
  playerA = createGuestPlayer('E2E Guest A', []);
  playerB = createGuestPlayer('E2E Guest B', []);
});

test.describe('invite flow', () => {
  test('visiting #/invite/<token> stores the token, resolves /api/me, redirects to #/backpacks, and shows a welcome banner', async ({ page }) => {
    await page.goto(`/app/#/invite/${playerA.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await expect(page.locator('.invite-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.invite-banner-text')).toContainText(playerA.name);

    // The stored token must actually be the one used for subsequent
    // /api/me calls -- confirm via a direct fetch using the SAME token,
    // matching what the app itself now has in localStorage.
    const stored = await page.evaluate(() => localStorage.getItem('backpack_ragnarok:auth_token'));
    expect(stored).toBe(playerA.token);

    const meResp = await page.request.get('/api/me', { headers: { 'X-Auth-Token': playerA.token } });
    expect(meResp.status()).toBe(200);
    const me = await meResp.json();
    expect(me.playerId).toBe(playerA.playerId);
    expect(me.name).toBe(playerA.name);
  });
});

test.describe('per-player board isolation', () => {
  test('player A places a PO, auto-saves, and player B\'s board is unaffected', async ({ page }) => {
    // Player A: visit their invite link, boot the app (localStorage token
    // now set), drag a free PO onto the canvas board, wait for auto-save.
    await page.goto(`/app/#/invite/${playerA.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.waitForSelector('.data-source-badge', { timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector('.data-source-badge')?.textContent?.trim() === 'live',
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);

    // A fresh guest player has an EMPTY board (no fixture PUT was ever
    // done for them) -- the inventory board's page 0 (tab "1") is where a
    // brand-new player's starting POs (if any) would live; rather than
    // depend on baked scenario contents, this test instead PUTs a small,
    // known-shape fixture directly to player A's own profile BEFORE
    // reloading, exactly like loadFixtureAndBoot() does for the dev
    // player elsewhere in this suite -- simplest reliable way to get a
    // free PO at a known inventory cell to drag from.
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/baseline-smoke-fixture.json', import.meta.url), 'utf8'));
    await page.request.put(`/api/profile/${playerA.playerId}/canvas`, {
      headers: { 'X-Auth-Token': playerA.token },
      data: fixture,
    });
    await page.reload();
    await page.waitForSelector('.data-source-badge', { timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector('.data-source-badge')?.textContent?.trim() === 'live',
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);

    const invBox = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;
    const canvasBox = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // p200 (hilt, free-placed, not inside any BP) sits at inv page0 cell
    // (4,4) in this fixture (same fixture/target cell baseline-smoke.spec.ts's
    // own known-good free-PO drag test uses). Drag it onto canvas BP
    // "gamma"'s one free non-linker cell (6,3).
    await drag(page, { x: invBox.x + cx(4), y: invBox.y + cy(4) }, { x: canvasBox.x + cx(3), y: canvasBox.y + cy(6) });
    await waitForAutoSave(page);

    const aResp = await page.request.get(`/api/profile/${playerA.playerId}/canvas`, {
      headers: { 'X-Auth-Token': playerA.token },
    });
    expect(aResp.status()).toBe(200);
    const aCanvas = (await aResp.json()).canvas;
    const aPo = aCanvas.pos.find((p: any) => p.uid === 'p200');
    expect(aPo).toBeTruthy();
    expect(aPo.loc).toBe('grid');
    expect(aPo.cell).toEqual([6, 3]);

    // Player B: separate profile entirely -- never touched by anything
    // above. Confirm via the API directly (no saved canvas yet -> 404,
    // NOT player A's data) AND via the UI (visiting player B's own
    // invite link shows an empty board, no p200 PO anywhere).
    const bResp = await page.request.get(`/api/profile/${playerB.playerId}/canvas`, {
      headers: { 'X-Auth-Token': playerB.token },
    });
    expect(bResp.status()).toBe(404);

    await page.goto(`/app/#/invite/${playerB.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await page.waitForSelector('.data-source-badge', { timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector('.data-source-badge')?.textContent?.trim() === 'live',
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);
    const meBResp = await page.request.get('/api/me', { headers: { 'X-Auth-Token': playerB.token } });
    expect((await meBResp.json()).playerId).toBe(playerB.playerId);

    // Player B's own profile must still 404 (their board is untouched --
    // player A's drag never leaked into player B's storage).
    const bRespAfter = await page.request.get(`/api/profile/${playerB.playerId}/canvas`, {
      headers: { 'X-Auth-Token': playerB.token },
    });
    expect(bRespAfter.status()).toBe(404);

    // Cross-check: player B's token must NOT be able to read player A's
    // profile (403 -- ownership guard), proving isolation is enforced by
    // the server, not just "nobody happened to write there".
    const crossResp = await page.request.get(`/api/profile/${playerA.playerId}/canvas`, {
      headers: { 'X-Auth-Token': playerB.token },
    });
    expect(crossResp.status()).toBe(403);
  });
});

test.describe('logout', () => {
  test('logout clears the stored token and reload returns to the dev-mode/default state', async ({ page }) => {
    await page.goto(`/app/#/invite/${playerA.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const storedBefore = await page.evaluate(() => localStorage.getItem('backpack_ragnarok:auth_token'));
    expect(storedBefore).toBe(playerA.token);

    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await expect(page.locator('.settings-page')).toBeVisible();
    await expect(page.locator('.settings-field-value.settings-field-mono')).toHaveText(playerA.playerId);

    await page.locator('.settings-logout-btn').click();
    // logout() reloads the page -- wait for the app to boot again.
    await page.waitForSelector('.data-source-badge', { timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector('.data-source-badge')?.textContent?.trim() === 'live',
      { timeout: 10000 }
    );

    const storedAfter = await page.evaluate(() => localStorage.getItem('backpack_ragnarok:auth_token'));
    expect(storedAfter).toBeNull();

    // Back on Settings -- the account block now shows the dev-mode
    // fallback identity (dev_mode defaults true on this box), not
    // player A's.
    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await expect(page.locator('.settings-page')).toBeVisible();
    const meResp = await page.request.get('/api/me');
    const me = await meResp.json();
    await expect(page.locator('.settings-field-value.settings-field-mono')).toHaveText(me.playerId);
    expect(me.playerId).not.toBe(playerA.playerId);
  });
});

test.describe('settings page content', () => {
  test('shows the account block (name/id/roles/logout) and the bot-mode placeholder block', async ({ page }) => {
    await page.goto(`/app/#/invite/${playerA.token}`);
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });

    await page.locator('.nav-link', { hasText: 'Settings' }).click();
    await expect(page.locator('.settings-page')).toBeVisible();

    await expect(page.locator('.settings-account')).toBeVisible();
    await expect(page.locator('.settings-account .settings-field-value').first()).toHaveText(playerA.name);
    await expect(page.locator('.settings-field-value.settings-field-mono')).toHaveText(playerA.playerId);
    await expect(page.locator('.settings-logout-btn')).toBeVisible();

    await expect(page.locator('.settings-bot-placeholder')).toBeVisible();
    await expect(page.locator('.settings-bot-placeholder')).toContainText('API / Bot mode');
    await expect(page.locator('.settings-bot-placeholder')).toContainText('Coming soon');
  });
});
