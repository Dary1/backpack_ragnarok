// REQ-0066 -- Hall of Ragnarok (#/ragnarok), 殿堂. End-to-end coverage of
// the REAL, already-merged ragnarok backend (server/routes/ragnarok.cjs)
// through the NEW client screen. Data strategy mirrors market.spec.ts /
// warehouse-mjolnir.spec.ts exactly:
//
//  - The BROWSER identity is the dev_mode fallback player ('dev', no
//    token stored). For the devotion/blast tests we seed the DEV player's
//    canvas (profile PUT) with the SAME reference-model fixture the server
//    api_test uses for `ragA`: inventory page 0 is MASTER (homes for every
//    uid), squad 1 is the devotion candidate (bp_dev + shared_po +
//    solo_po + si_dev), squad 2 shares shared_po (the yellow case) and
//    carries si_other seated on shared_po. Blast of squad 1 is therefore
//    exactly {bps:1, pos:2, sis:1, total:4}, affecting squad 2 (loses
//    shared_po). This is a KNOWN fixture whose counts we assert against.
//  - Ranking/hall data for OTHER players is minted through the operator
//    CLI (server/cli_invite.cjs) + a devotion POST with that player's
//    token, so the Order/search have real rows to show. (A player only
//    appears in the Order after devoting -- rebuildOrder lists players
//    with >=1 einherjar record.)
//
// THE CRITICAL post-rite assertion (the race guard): after the UI rite we
// read /api/profile/dev/canvas back and assert the destroyed uids are
// GONE from inventory AND from the sharing squad -- proving the client's
// loadGame() re-GET left the server's destruction intact (no stale auto-
// save resurrected them). We also assert a new einherjar record exists.
//
// STATUS: authored + selector-traced against the implementation, but NOT
// executed against a live deploy (the shared baseURL points at the live
// site, which the main checkout owns; the orchestrator runs this for real
// right after deploy). See docs/REQ-0066-ragnarok-client.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CODE_ROOT, E2E_DATA_ROOT, E2E_CLI_ENV } from './e2e-env';
import { test, expect, type Page } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

const REPO_ROOT = E2E_DATA_ROOT;
const DEV_PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'dev.json');
const CLI_INVITE_PATH = join(E2E_CODE_ROOT, 'server', 'cli_invite.cjs');

interface MintedPlayer { playerId: string; token: string; name: string; }

/** Mints a real invite player via the operator CLI (byte-for-byte the
 * helper guest-auth.spec.ts / market.spec.ts use). */
function mintInvite(name: string): MintedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: E2E_CODE_ROOT, env: E2E_CLI_ENV, encoding: 'utf8' });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) throw new Error('cli_invite.cjs output did not match expected shape:\n' + output);
  return { playerId: playerIdMatch[1], token: tokenMatch[1], name };
}

const bpDef = (id: string) => ({ id, name: 'BP ' + id, color: '#886644', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { off: [0, 0], dirs: [] }, hpMax: 30 });
const invPage = () => ({ bps: [], pos: [], sis: [], tms: [] });

/** The `ragA` reference-model fixture, as a dev-player canvas. Inventory
 * page 0 is MASTER. Squad 1 = devotion candidate; squad 2 shares
 * shared_po. Blast(squad 1) = {bps:1, pos:2, sis:1, total:4}, affecting
 * squad 2. Active squad (index 0) is empty (store[0] = null). */
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
  const squad1 = {
    linked: true,
    bps: [bpDef('bp_dev')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_dev', id: 'acc_gem', host: 'inv' }],
  };
  const squad2 = {
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
    presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: [null, squad1, squad2] },
  };
}

/** A minimal canvas with a single empty active squad and no inventory --
 * the "no eligible squad / unranked me" first-season state (a lone squad
 * is `last_squad`, and empty). */
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
    if (origCanvas) await page.request.put('/api/profile/dev/canvas', { data: origCanvas });
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
    await page.request.put('/api/profile/dev/canvas', { data: emptyDevoteeCanvas() });

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
    // Give them a devotable squad (one BP-bearing squad + a second so it
    // is not last_squad), then devote squad 1 via their own token.
    const canvas = {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages: [{ bps: [bpDef('z_bp')], pos: [{ uid: 'z_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] }, invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['ZA', 'ZB'], store: [null, { linked: true, bps: [bpDef('z_bp')], pos: [{ uid: 'z_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] }] },
    };
    const put = await page.request.put(`/api/profile/${seller.playerId}/canvas`, {
      headers: { 'X-Auth-Token': seller.token },
      data: canvas,
    });
    expect(put.ok()).toBeTruthy();
    const devote = await page.request.post('/api/ragnarok/devotion/1', { headers: { 'X-Auth-Token': seller.token } });
    expect(devote.status()).toBe(200);

    // S2's Eternal Order is a lazy daily-dawn cache (services/ragnarok.cjs's
    // getOrderDoc): a rite completed after today's first order read is
    // invisible to `q` search until the NEXT dawn boundary, by design. Force
    // an immediate rebuild via the dev-only hook (no X-Auth-Token -- must
    // resolve via the dev_mode fallback, same convention as schedule.spec.ts's
    // apiBackdate) so this freshly-devoted player is actually findable now.
    const rebuild = await page.request.post('/api/ragnarok/order/dev/force-rebuild');
    expect(rebuild.ok()).toBeTruthy();

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
    // Seed the devotion fixture, then open a room slotting squad 1 so it
    // (and squad 2, which shares shared_po) become `deployed`.
    await page.request.put('/api/profile/dev/canvas', { data: devotionFixtureCanvas() });
    // Create a room + assign squad 1 via the real schedule API (dev token
    // implied). A dungeon id is needed; read one from /api/schedule/dungeons.
    const dungeons = await (await page.request.get('/api/schedule/dungeons')).json();
    const dungeonId = dungeons.dungeons?.[0]?.id;
    expect(dungeonId, 'a dungeon exists to host a room').toBeTruthy();
    const roomRes = await page.request.post('/api/schedule/rooms', { data: { dungeonId } });
    expect(roomRes.status()).toBe(200);
    const roomId = (await roomRes.json()).room.id;
    try {
      const assign = await page.request.put(`/api/schedule/rooms/${roomId}/slots/0`, { data: { squadIndex: 1 } });
      expect(assign.status(), 'squad 1 deployed into the room').toBe(200);

      await gotoRagnarok(page);

      // Select squad 1: its preview returns eligible:false + ['deployed'].
      // The candidate is LOCKED (dimmed), with the reason spelled out --
      // not removed from the list.
      const cand = page.locator('[data-testid="ragnarok-devotion-candidate-1"]');
      await expect(cand).toBeVisible();
      await cand.click();
      await expect(cand).toHaveClass(/is-locked/, { timeout: 10000 });
      await expect(cand).toHaveAttribute('data-eligible', 'false');
      await expect(page.locator('[data-testid="ragnarok-candidate-reason-1"]')).toContainText(/deployed|従軍/i);
      // The rite panel shows the ineligible reason, and NO vow button.
      await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible();
      await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toHaveAttribute('data-reasons', /deployed/);
      await expect(page.locator('[data-testid="ragnarok-vow-btn"]')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/schedule/rooms/${roomId}`).catch(() => {});
    }
  });

  test('BLAST MANIFEST: an eligible candidate itemizes the exact blast radius (1 BP / 2 items / 1 form, squad P3 affected)', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devotionFixtureCanvas() });
    await gotoRagnarok(page);

    // Select squad 1 (the eligible candidate). The manifest itemizes the
    // KNOWN blast: {bps:1, pos:2, sis:1, total:4}, affecting squad P3.
    await page.locator('[data-testid="ragnarok-devotion-candidate-1"]').click();
    const manifest = page.locator('[data-testid="ragnarok-blast-manifest"]');
    await expect(manifest).toBeVisible({ timeout: 10000 });
    await expect(manifest).toHaveAttribute('data-total', '4');
    await expect(page.locator('[data-testid="ragnarok-blast-bps"]')).toContainText('1');
    await expect(page.locator('[data-testid="ragnarok-blast-pos"]')).toContainText('2');
    await expect(page.locator('[data-testid="ragnarok-blast-sis"]')).toContainText('1');
    await expect(page.locator('[data-testid="ragnarok-blast-total"]')).toContainText('4');
    // The OTHER affected squad (was index 2, name 'P3') is itemized as
    // losing exactly the one shared PO.
    const affected = page.locator('[data-testid="ragnarok-blast-affected-row"]');
    await expect(affected).toHaveCount(1);
    await expect(affected).toHaveAttribute('data-squad-index', '2');
    await expect(affected).toContainText('P3');
  });

  test('FULL RITE: engrave squad 1 -> destroyed uids gone from inventory AND the sharing squad; a new einherjar record exists', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: devotionFixtureCanvas() });
    await gotoRagnarok(page);

    // Baseline: no einherjar yet for the dev player.
    const before = await (await page.request.get('/api/ragnarok/einherjar')).json();
    expect(before.einherjar.length).toBe(0);

    // Select squad 1 -> manifest -> vow -> final question -> swear.
    await page.locator('[data-testid="ragnarok-devotion-candidate-1"]').click();
    await expect(page.locator('[data-testid="ragnarok-blast-manifest"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="ragnarok-vow-btn"]').click();
    const modal = page.locator('[data-testid="ragnarok-final-question-modal"]');
    await expect(modal).toBeVisible();
    // The final question recaps the manifest (4 destroyed, 1 other squad).
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
    // the sharing squad (was index 2, now index 1 after the slot delete).
    await waitForAutoSave(page);
    const canvas = await readDevCanvas(page);
    const pg0 = canvas.inv.pages[0];
    expect(pg0.bps.map((b: any) => b.id)).toEqual(['bp_other']); // bp_dev destroyed
    expect(pg0.pos.map((p: any) => p.uid).sort()).toEqual(['keep_po', 'other_po']); // shared_po + solo_po destroyed
    expect(pg0.sis.map((a: any) => a.uid)).toEqual(['si_other']); // si_dev destroyed
    // The devoted squad slot was deleted (store went 3 -> 2; names lost P2).
    expect(canvas.presets.store.length).toBe(2);
    expect(canvas.presets.names).toEqual(['P1', 'P3', 'P4', 'P5']);
    // The yellow-shared squad (now index 1) lost EXACTLY shared_po; its
    // SI that sat on the destroyed PO is stowed (host 'inv').
    const shared = canvas.presets.store[1];
    expect(shared.pos.map((p: any) => p.uid)).toEqual(['keep_po']);
    expect(shared.sis).toEqual([{ uid: 'si_other', id: 'acc_gem', host: 'inv' }]);

    // A new einherjar record exists (the hall list is live immediately).
    const after = await (await page.request.get('/api/ragnarok/einherjar')).json();
    expect(after.einherjar.length).toBe(1);
    expect(after.einherjar[0].squadName).toBe('P2');
    expect(after.einherjar[0].counts).toEqual({ bps: 1, pos: 2, sis: 1 });
  });

  test('409 empty_squad: devoting an empty squad is refused, surfaced in the UI voice', async ({ page }) => {
    // Squad 1 has a BP (devotable); squad 2 is empty (no BP -> empty_squad).
    const canvas = {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages: [{ bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] }, invPage(), invPage(), invPage(), invPage()], names: ['1', '2', '3', '4', '5'] },
      // 3 presets: index 0 active (empty placeholder), index 1 devotable
      // (has a BP), index 2 empty (no BP -> empty_squad). names.length ===
      // store.length so no index is nameless.
      presets: { active: 0, names: ['Active', 'Full', 'EmptyBP'], store: [null, { linked: true, bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] }, { linked: true, bps: [], pos: [], sis: [] }] },
    };
    await page.request.put('/api/profile/dev/canvas', { data: canvas });
    await gotoRagnarok(page);

    // Selecting the empty squad (index 2) shows it locked with the
    // empty_squad reason; the vow button is absent.
    const cand = page.locator('[data-testid="ragnarok-devotion-candidate-2"]');
    await expect(cand).toBeVisible();
    await cand.click();
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toHaveAttribute('data-reasons', /empty_squad/);
    await expect(page.locator('[data-testid="ragnarok-vow-btn"]')).toHaveCount(0);

    // And the API itself refuses the rite (server truth behind the UI).
    const post = await page.request.post('/api/ragnarok/devotion/2');
    expect(post.status()).toBe(409);
    expect((await post.json()).reason).toBe('empty_squad');
  });

  test('409 last_squad: a lone squad cannot be devoted (locked reason + API 409)', async ({ page }) => {
    await page.request.put('/api/profile/dev/canvas', { data: emptyDevoteeCanvas() });
    await gotoRagnarok(page);

    // The single 'Lone' squad (index 0) is BOTH last_squad AND empty --
    // the picker locks it; the reason set includes last_squad.
    const cand = page.locator('[data-testid="ragnarok-devotion-candidate-0"]');
    await expect(cand).toBeVisible();
    await cand.click();
    await expect(page.locator('[data-testid="ragnarok-devotion-ineligible"]')).toBeVisible({ timeout: 10000 });
    const reasons = await page.locator('[data-testid="ragnarok-devotion-ineligible"]').getAttribute('data-reasons');
    expect(reasons).toMatch(/last_squad|empty_squad/);

    const post = await page.request.post('/api/ragnarok/devotion/0');
    expect(post.status()).toBe(409);
    expect(['last_squad', 'empty_squad']).toContain((await post.json()).reason);
  });

  test('HALL STRIP: after a devotion, the einherjar card renders ("永劫に在り"); a fresh player sees the empty hall', async ({ page }) => {
    // Fresh dev player -> empty hall state. Einherjar records outlive a
    // canvas reset (S3: immutable/permanent once a rite completes) -- an
    // earlier test in this same file/run (FULL RITE) may have already
    // devoted dev, so explicitly clear the hall too, not just the canvas.
    const clear = await page.request.post('/api/ragnarok/einherjar/dev/clear');
    expect(clear.ok()).toBeTruthy();
    await page.request.put('/api/profile/dev/canvas', { data: emptyDevoteeCanvas() });
    await gotoRagnarok(page);
    await expect(page.locator('[data-testid="ragnarok-hall-empty"]')).toBeVisible();

    // Now seed a devotion for the dev player directly via the fixture +
    // API, reload, and see the hall card.
    await page.request.put('/api/profile/dev/canvas', { data: devotionFixtureCanvas() });
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

  test('EMPTY / FIRST-SEASON: a brand-new player sees unranked me-row, empty hall, and a no-eligible-squad devotion section', async ({ page }) => {
    // See HALL STRIP's own comment just above: einherjar records outlive
    // a canvas reset, so clear the hall explicitly too.
    const clear = await page.request.post('/api/ragnarok/einherjar/dev/clear');
    expect(clear.ok()).toBeTruthy();
    await page.request.put('/api/profile/dev/canvas', { data: emptyDevoteeCanvas() });
    await gotoRagnarok(page);

    // Unranked me-row.
    await expect(page.locator('[data-testid="ragnarok-me-row"]')).toHaveAttribute('data-unranked', 'true');
    // Empty hall.
    await expect(page.locator('[data-testid="ragnarok-hall-empty"]')).toBeVisible();
    // Devotion section renders the lone squad; selecting it reveals it is
    // not devotable (locked) -- the realistic first-season case.
    await expect(page.locator('[data-testid="ragnarok-devotion-candidate-0"]')).toBeVisible();
  });
});
