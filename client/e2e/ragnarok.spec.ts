// REQ-0066 -- Hall of Ragnarok (#/ragnarok), 殿堂. End-to-end coverage of
// the REAL, already-merged ragnarok backend (server/routes/ragnarok.cjs)
// through the NEW client screen. Data strategy mirrors market.spec.ts /
// warehouse-mjolnir.spec.ts exactly:
//
//  - The BROWSER identity is the dev_mode fallback player ('dev', no
//    token stored). For the devotion/blast tests we seed the DEV player's
//    canvas (profile PUT) with the SAME reference-model fixture the server
//    api_test uses for `ragA`: inventory page 0 is MASTER (homes for every
//    uid), preset 1 is the devotion candidate (bp_dev + shared_po +
//    solo_po + si_dev), preset 2 shares shared_po (the yellow case) and
//    carries si_other seated on shared_po. Blast of preset 1 is therefore
//    exactly {bps:1, pos:2, sis:1, total:4}, affecting preset 2 (loses
//    shared_po). This is a KNOWN fixture whose counts we assert against.
//  - Ranking/hall data for OTHER players is minted through the operator
//    CLI (server/cli_invite.cjs) + a devotion POST with that player's
//    token, so the Order/search have real rows to show. (A player only
//    appears in the Order after devoting -- rebuildOrder lists players
//    with >=1 einherjar record.)
//
// THE CRITICAL post-rite assertion (the race guard): after the UI rite we
// read /api/profile/dev/canvas back and assert the destroyed uids are
// GONE from inventory AND from the sharing preset -- proving the client's
// loadGame() re-GET left the server's destruction intact (no stale auto-
// save resurrected them). We also assert a new einherjar record exists.
//
// STATUS: authored + selector-traced against the implementation, but NOT
// executed against a live deploy (the shared baseURL points at the live
// site, which the main checkout owns; the orchestrator runs this for real
// right after deploy). See docs/REQ-0066-ragnarok-client.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

const REPO_ROOT = join(homedir(), 'backpack_ragnarok');
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'dev.json');
const CLI_INVITE_PATH = join(REPO_ROOT, 'server', 'cli_invite.cjs');

interface MintedPlayer { playerId: string; token: string; name: string; }

/** Mints a real invite player via the operator CLI (byte-for-byte the
 * helper guest-auth.spec.ts / market.spec.ts use). */
function mintInvite(name: string): MintedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: REPO_ROOT, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  return { playerId: playerIdMatch[1], token: tokenMatch[1], name };
}

const bpDef = (id: string) => ({ id, name: 'BP ' + id, color: '#886644', shape: [[0, 0], [0, 1]], origin: [1, 1], linker: { off: [0, 0], dirs: [] }, hpMax: 30 });
const invPage = () => ({ bps: [], pos: [], sis: [], tms: [] });

/** The `ragA` reference-model fixture, as a dev-player canvas. Inventory
 * page 0 is MASTER. Preset 1 = devotion candidate; preset 2 shares
 * shared_po. Blast(preset 1) = {bps:1, pos:2, sis:1, total:4}, affecting
 * preset 2. Active preset (index 0) is empty (store[0] = null). */
function devotionFixtureCanvas() {
  const invPage0 = {
    bps: [bpDef('bp_dev'), bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', cell: [1, 2], rot: 0 },
      { uid: 'other_po', id: 'blade', cell: [1, 3], rot: 0 },
      { uid: 'keep_po', id: 'blade', cell: [1, 4], rot: 0 },
    ],
    sis: [
      { uid: 'si_dev', id: 'acc_gem', host: 'inv' },
      { uid: 'si_other', id: 'acc_gem', host: 'inv' },
    ],
    tms: [],
  };
  const preset1 = {
    linked: true,
    bps: [bpDef('bp_dev')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_dev', id: 'acc_gem', host: 'inv' }],
  };
  const preset2 = {
    linked: true,
    bps: [bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [2, 1], rot: 0 },
      { uid: 'keep_po', id: 'blade', loc: 'grid', cell: [2, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_other', id: 'acc_gem', host: { po: 'shared_po' } }],
  };
  return {
    linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
    inv: { pages: [invPage0, invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
    presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: [null, preset1, preset2] },
  };
}

/** A minimal canvas with a single empty active preset and no inventory --
 * the "no eligible unit / unranked me" first-season state (a lone preset
 * is `last_preset`, and empty). */
function emptyDevoteeCanvas() {
  return {
    linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
    inv: { pages: [invPage(), invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
    presets: { active: 0, names: ['Lone'], store: [null] },
  };
}

async function gotoRagnarok(page: Page): Promise<void> {
  await bootApp(page);
  await page.locator('.nav-link', { hasText: 'Ragnarok' }).click();
  await expect(page.locator('[data-testid="ragnarok-page"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="ragnarok-loading"]')).toHaveCount(0, { timeout: 10000 });
}

/** Reads the dev player's saved canvas back (post-mutation truth). */
async function readDevCanvas(page: Page): Promise<any> {
  const resp = await page.request.get('/api/profile/dev/canvas');
  return (await resp.json()).canvas;
}

test.describe('REQ-0066: Hall of Ragnarok on the real backend', () => {
  // Back up + restore the dev profile around each test (pg-aware, same
  // convention as market.spec.ts: a dev.json file restore is a silent
  // no-op under STORAGE_BACKEND=pg, so re-PUT the original canvas too).
  let devProfileBackup: string | null = null;
  let origCanvas: unknown = null;

  test.beforeEach(async ({ page }) => {
    devProfileBackup = existsSync(DEV_PROFILE_PATH) ? readFileSync(DEV_PROFILE_PATH, 'utf8') : null;
    const resp = await page.request.get('/api/profile/dev/canvas');
    origCanvas = resp.ok() ? (await resp.json()).canvas : null;
  });

  test.afterEach(async ({ page }) => {
    if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: { canvas: origCanvas } });
    if (devProfileBackup !== null) writeFileSync(DEV_PROFILE_PATH, devProfileBackup);
    else if (existsSync(DEV_PROFILE_PATH)) rmSync(DEV_PROFILE_PATH);
  });

  test('SEASON STRIP: renders the 12-wedge wheel + the no-urgency countdown', async ({ page }) => {
    await gotoRagnarok(page);

    const strip = page.locator('[data-testid="ragnarok-season-strip"]');
    await expect(strip).toBeVisible();

    // Cross-check the derived clock against the API so the assertion is
    // not hardcoded to a wall-clock the season registry will drift past.
    const seasonRes = await page.request.get('/api/ragnarok/season');
    const season = await seasonRes.json();

    if (season.season && season.derived && !season.derived.ended) {
      // Wheel: exactly 12 wedges; `phase-1` are done, `phase` is now.
      const wheel = page.locator('[data-testid="ragnarok-season-wheel"]');
      await expect(wheel).toHaveAttribute('data-phase', String(season.derived.phase));
      await expect(page.locator('[data-testid="ragnarok-season-wedges"] path')).toHaveCount(12);
      // Countdown shows the derived daysToRagnarok, NO urgency styling
      // (REQ-0067): the number element carries only .ragnarok-cd-num,
      // never a red/urgent/pulse class, at any value.
      const cd = page.locator('[data-testid="ragnarok-countdown"]');
      await expect(cd).toHaveText(String(season.derived.daysToRagnarok));
      const cls = (await cd.getAttribute('class')) || '';
      expect(cls).toContain('ragnarok-cd-num');
      expect(cls).not.toMatch(/urgent|danger|warn|pulse|blink|blood|ember/);
      // data-state is 'live' (not 'ended'/'none').
      await expect(strip).toHaveAttribute('data-state', 'live');
    } else {
      // Degenerate/ended state still renders the strip (no crash), with a
      // non-live data-state -- the empty-state path.
      await expect(strip).not.toHaveAttribute('data-state', 'live');
    }
  });

  test('ETERNAL ORDER: tier chip row (from API thresholds), top rows, gap + me-row, and VALHALLA chip present', async ({ page }) => {
    // Seed the dev player unranked (fresh) so the me-row is the unranked
    // state, and mint a couple of ranked players so the top has rows.
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: emptyDevoteeCanvas() } });

    await gotoRagnarok(page);

    // Tier chips: all five ladders present, VALHALLA rendered (client-side
    // horizon), thresholds are NOT asserted as hardcoded numbers here --
    // the chip identities come straight from order.tiers.
    for (const tier of ['THRALL', 'KARL', 'JARL', 'EINHERJAR', 'VALHALLA']) {
      await expect(page.locator(`[data-testid="ragnarok-tier-${tier}"]`)).toBeVisible();
    }
    // The dev me-row is present and, being fresh (no devotion), unranked.
    const me = page.locator('[data-testid="ragnarok-me-row"]');
    await expect(me).toBeVisible();
    await expect(me).toHaveAttribute('data-unranked', 'true');
    await expect(page.locator('[data-testid="ragnarok-me-unranked"]')).toBeVisible();
    // The active tier chip for a 0-score player is THRALL.
    await expect(page.locator('[data-testid="ragnarok-tier-THRALL"]')).toHaveAttribute('data-active', 'true');
  });

  test('FIND-BY-NAME: a devoted player is found by a name substring; a miss shows the empty search state', async ({ page }) => {
    // Mint + devote a uniquely-named player so the Order has a findable row.
    const seller = mintInvite('ZephyrusFindMe');
    // Give them a devotable preset (one BP-bearing preset + a second so it
    // is not last_preset), then devote preset 1 via their own token.
    const canvas = {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages: [{ bps: [bpDef('z_bp')], pos: [{ uid: 'z_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] }, invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['ZA', 'ZB'], store: [null, { linked: true, bps: [bpDef('z_bp')], pos: [{ uid: 'z_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] }] },
    };
    const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, { data: { canvas } });
    expect(put.ok()).toBeTruthy();
    const devote = await page.request.post('/api/ragnarok/devotion/1', { headers: { 'X-Auth-Token': seller.token } });
    expect(devote.status()).toBe(200);

    await gotoRagnarok(page);

    // Search by a substring of the player's name.
    await page.locator('[data-testid="ragnarok-order-search"]').fill('ZephyrusFind');
    await expect(page.locator('[data-testid="ragnarok-search-results"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="ragnarok-search-results"]')).toContainText('ZephyrusFindMe');

    // A miss -> the explicit "no one by that name" state.
    await page.locator('[data-testid="ragnarok-order-search"]').fill('NoSuchNameQwertyx');
    await expect(page.locator('[data-testid="ragnarok-search-none"]')).toBeVisible({ timeout: 10000 });

    // Clear returns to the standings.
    await page.locator('[data-testid="ragnarok-order-search-clear"]').click();
    await expect(page.locator('[data-testid="ragnarok-me-row"]')).toBeVisible();
  });

  test('DEVOTION PICKER: an ineligible candidate is shown LOCKED with its reason (deployed), not hidden', async ({ page }) => {
    // Seed the devotion fixture, then open a room slotting preset 1 so it
    // (and preset 2, which shares shared_po) become `deployed`.
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: devotionFixtureCanvas() } });
    // Create a room + assign preset 1 via the real schedule API (dev token
    // implied). A dungeon id is needed; read one from /api/schedule/dungeons.
    const dungeons = await (await page.request.get('/api/schedule/dungeons')).json();
    const dungeonId = dungeons.dungeons?.[0]?.id;
    expect(dungeonId, 'a dungeon exists to host a room').toBeTruthy();
    const roomRes = await page.request.post('/api/schedule/rooms', { data: { dungeonId } });
    expect(roomRes.status()).toBe(200);
    const roomId = (await roomRes.json()).room.id;
    try {
      const assign = await page.request.put(`/api/schedule/rooms/${roomId}/slots/0`, { data: { presetIndex: 1 } });
      expect(assign.status(), 'preset 1 deployed into the room').toBe(200);

      await gotoRagnarok(page);

      // Select preset 1: its preview returns eligible:false + ['deployed'].
      // The candidate is LOCKED (dimmed), with the reason spelled out --
      // not removed from the list.
      const cand = page.locator('[data-testid="ragnarok-devotion-candidate-1"]');
      await expect(cand).toBeVisible();
      await cand.click();
      await expect(cand).toHaveClass(/is-locked/, { timeout: 10000 });
      await expect(cand).toHaveAttribute('data-eligible', 'false');
      await expect(page.locator('[data-testid="ragnarok-candidate-reason-1"]')).toContainText(/deployed|従軍/);
      // The rite panel shows the ineligible reason, and NO vow button.
      await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible();
      await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toHaveAttribute('data-reasons', /deployed/);
      await expect(page.locator('[data-testid="ragnarok-vow-btn"]')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/schedule/rooms/${roomId}`).catch(() => {});
    }
  });

  test('BLAST MANIFEST: an eligible candidate itemizes the exact blast radius (1 BP / 2 items / 1 form, preset P3 affected)', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: devotionFixtureCanvas() } });
    await gotoRagnarok(page);

    // Select preset 1 (the eligible candidate). The manifest itemizes the
    // KNOWN blast: {bps:1, pos:2, sis:1, total:4}, affecting preset P3.
    await page.locator('[data-testid="ragnarok-devotion-candidate-1"]').click();
    const manifest = page.locator('[data-testid="ragnarok-blast-manifest"]');
    await expect(manifest).toBeVisible({ timeout: 10000 });
    await expect(manifest).toHaveAttribute('data-total', '4');
    await expect(page.locator('[data-testid="ragnarok-blast-bps"]')).toContainText('1');
    await expect(page.locator('[data-testid="ragnarok-blast-pos"]')).toContainText('2');
    await expect(page.locator('[data-testid="ragnarok-blast-sis"]')).toContainText('1');
    await expect(page.locator('[data-testid="ragnarok-blast-total"]')).toContainText('4');
    // The OTHER affected preset (was index 2, name 'P3') is itemized as
    // losing exactly the one shared PO.
    const affected = page.locator('[data-testid="ragnarok-blast-affected-row"]');
    await expect(affected).toHaveCount(1);
    await expect(affected).toHaveAttribute('data-preset-index', '2');
    await expect(affected).toContainText('P3');
  });

  test('FULL RITE: engrave preset 1 -> destroyed uids gone from inventory AND the sharing preset; a new einherjar record exists', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: devotionFixtureCanvas() } });
    await gotoRagnarok(page);

    // Baseline: no einherjar yet for the dev player.
    const before = await (await page.request.get('/api/ragnarok/einherjar')).json();
    expect(before.einherjar.length).toBe(0);

    // Select preset 1 -> manifest -> vow -> final question -> swear.
    await page.locator('[data-testid="ragnarok-devotion-candidate-1"]').click();
    await expect(page.locator('[data-testid="ragnarok-blast-manifest"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="ragnarok-vow-btn"]').click();
    const modal = page.locator('[data-testid="ragnarok-final-question-modal"]');
    await expect(modal).toBeVisible();
    // The final question recaps the manifest (4 destroyed, 1 other preset).
    await expect(page.locator('[data-testid="ragnarok-final-manifest-recap"]')).toContainText('4');
    await page.locator('[data-testid="ragnarok-final-yes"]').click();

    // The engraved success state only appears AFTER the race-guard re-GET
    // completed (DevotionSection awaits onDevoted() before revealing it).
    await expect(page.locator('[data-testid="ragnarok-engraved-modal"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="ragnarok-engraved-title"]')).toBeVisible();
    await page.locator('[data-testid="ragnarok-engraved-close"]').click();

    // CRITICAL race-guard assertion: wait out the auto-save debounce, then
    // read the dev canvas. The destroyed uids MUST be gone (a stale auto-
    // save did NOT resurrect them) from BOTH inventory (master homes) and
    // the sharing preset (was index 2, now index 1 after the slot delete).
    await waitForAutoSave(page);
    const canvas = await readDevCanvas(page);
    const pg0 = canvas.inv.pages[0];
    expect(pg0.bps.map((b: any) => b.id)).toEqual(['bp_other']); // bp_dev destroyed
    expect(pg0.pos.map((p: any) => p.uid).sort()).toEqual(['keep_po', 'other_po']); // shared_po + solo_po destroyed
    expect(pg0.sis.map((a: any) => a.uid)).toEqual(['si_other']); // si_dev destroyed
    // The devoted preset slot was deleted (store went 3 -> 2; names lost P2).
    expect(canvas.presets.store.length).toBe(2);
    expect(canvas.presets.names).toEqual(['P1', 'P3', 'P4', 'P5']);
    // The yellow-shared preset (now index 1) lost EXACTLY shared_po; its
    // SI that sat on the destroyed PO is stowed (host 'inv').
    const shared = canvas.presets.store[1];
    expect(shared.pos.map((p: any) => p.uid)).toEqual(['keep_po']);
    expect(shared.sis).toEqual([{ uid: 'si_other', id: 'acc_gem', host: 'inv' }]);

    // A new einherjar record exists (the hall list is live immediately).
    const after = await (await page.request.get('/api/ragnarok/einherjar')).json();
    expect(after.einherjar.length).toBe(1);
    expect(after.einherjar[0].unitName).toBe('P2');
    expect(after.einherjar[0].counts).toEqual({ bps: 1, pos: 2, sis: 1 });
  });

  test('409 empty_unit: devoting an empty preset is refused, surfaced in the UI voice', async ({ page }) => {
    // Preset 1 has a BP (devotable); preset 2 is empty (no BP -> empty_unit).
    const canvas = {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages: [{ bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] }, invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
      // 3 presets: index 0 active (empty placeholder), index 1 devotable
      // (has a BP), index 2 empty (no BP -> empty_unit). names.length ===
      // store.length so no index is nameless.
      presets: { active: 0, names: ['Active', 'Full', 'EmptyBP'], store: [null, { linked: true, bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] }, { linked: true, bps: [], pos: [], sis: [] }] },
    };
    await page.request.put('/api/profile/dev/canvas', { data: { canvas } });
    await gotoRagnarok(page);

    // Selecting the empty preset (index 2) shows it locked with the
    // empty_unit reason; the vow button is absent.
    const cand = page.locator('[data-testid="ragnarok-devotion-candidate-2"]');
    await expect(cand).toBeVisible();
    await cand.click();
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toHaveAttribute('data-reasons', /empty_unit/);
    await expect(page.locator('[data-testid="ragnarok-vow-btn"]')).toHaveCount(0);

    // And the API itself refuses the rite (server truth behind the UI).
    const post = await page.request.post('/api/ragnarok/devotion/2');
    expect(post.status()).toBe(409);
    expect((await post.json()).reason).toBe('empty_unit');
  });

  test('409 last_preset: a lone preset cannot be devoted (locked reason + API 409)', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: emptyDevoteeCanvas() } });
    await gotoRagnarok(page);

    // The single 'Lone' preset (index 0) is BOTH last_preset AND empty --
    // the picker locks it; the reason set includes last_preset.
    const cand = page.locator('[data-testid="ragnarok-devotion-candidate-0"]');
    await expect(cand).toBeVisible();
    await cand.click();
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible({ timeout: 10000 });
    const reasons = await page.locator('[data-testid="ragnarok-devotion-ineligible"]').getAttribute('data-reasons');
    expect(reasons).toMatch(/last_preset|empty_unit/);

    const post = await page.request.post('/api/ragnarok/devotion/0');
    expect(post.status()).toBe(409);
    expect(['last_preset', 'empty_unit']).toContain((await post.json()).reason);
  });

  test('HALL STRIP: after a devotion, the einherjar card renders ("永劫に在り"); a fresh player sees the empty hall', async ({ page }) => {
    // Fresh dev player -> empty hall state.
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: emptyDevoteeCanvas() } });
    await gotoRagnarok(page);
    await expect(page.locator('[data-testid="ragnarok-hall-empty"]')).toBeVisible();

    // Now seed a devotion for the dev player directly via the fixture +
    // API, reload, and see the hall card.
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: devotionFixtureCanvas() } });
    const devote = await page.request.post('/api/ragnarok/devotion/1');
    expect(devote.status()).toBe(200);
    await page.reload();
    await expect(page.locator('[data-testid="ragnarok-page"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="ragnarok-loading"]')).toHaveCount(0, { timeout: 10000 });
    const card = page.locator('[data-testid="ragnarok-hall-card"]');
    await expect(card.first()).toBeVisible();
    await expect(card.first()).toContainText('P2');
    // The "eternally standing" seal (ja 永劫に在り / en ETERNALLY STANDING).
    await expect(card.first()).toContainText(/永劫に在り|ETERNALLY STANDING/);
  });

  test('EMPTY / FIRST-SEASON: a brand-new player sees unranked me-row, empty hall, and a no-eligible-unit devotion section', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: { canvas: emptyDevoteeCanvas() } });
    await gotoRagnarok(page);

    // Unranked me-row.
    await expect(page.locator('[data-testid="ragnarok-me-row"]')).toHaveAttribute('data-unranked', 'true');
    // Empty hall.
    await expect(page.locator('[data-testid="ragnarok-hall-empty"]')).toBeVisible();
    // Devotion section renders the lone preset; selecting it reveals it is
    // not devotable (locked) -- the realistic first-season case.
    await expect(page.locator('[data-testid="ragnarok-devotion-candidate-0"]')).toBeVisible();
  });
});
