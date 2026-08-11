// client/e2e/sortie-prefill.spec.ts -- REQ-0371 (attack-level prefill) gate:
// "set attackLv 7, depart, revisit sortie -> stepper shows 7". The pref rides
// the persisted canvas doc as state.sortie (sortiePrefs.ts, the REQ-0141
// state.guide precedent), so it must survive BOTH an in-session revisit (store
// state) and a full reload (auto-save PUT -> boot restore). The depart here is
// the 1-squad RECRUIT path (REQ-0337): one squad card + the one CTA opens a
// public troop -- same commit gesture, no need for four deployable squads.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

/** The fleet's OWN seed profile (tools/e2e_fleet.cjs copies
 * client/e2e/fixtures/profiles into each worker's data/profiles) -- i.e. the
 * literal definition of "a fresh e2e_ci profile" this test asserts against. */
const SEED_PROFILE = JSON.parse(
  readFileSync(new URL('./fixtures/profiles/e2e_ci.json', import.meta.url), 'utf8'),
);

test.describe('REQ-0371 sortie attackLv prefill', () => {
  test('attackLv 7 committed at depart is the stepper seed on revisit and after reload', async ({ page }) => {
    // REQ-0374: depart from a CLEAN board. This test's own end-cleanup (below)
    // exists because a leftover recruiting troop poisons LATER specs on the
    // reused fleet worker -- but the converse was never guarded: an EARLIER
    // spec's open room or held squad seat makes this test's launch 409, and
    // the symptom is the launch simply not navigating (observed 2026-08-11,
    // when a spec-runtime change repaired the worker order). Same two seams as
    // the cleanup, run first: cancel recruiting troops, then the REQ-0082
    // rooms/dev/clear hook (used the same way by notification-center.spec.ts
    // and seal.spec.ts).
    const preRooms = (await (await page.request.get('/api/schedule/rooms')).json()).rooms as Array<{ id: string; status: string }>;
    for (const r of preRooms) {
      if (r.status === 'recruiting') await page.request.post(`/api/schedule/troops/${r.id}/cancel`).catch(() => {});
    }
    await page.request.post('/api/schedule/rooms/dev/clear').catch(() => {});
    // ...and from a FRESH PROFILE, which line 30 below has always asserted but
    // never established. Fleet workers are reused across spec files, and
    // several specs PUT a fixture canvas with NO `presets` block at all
    // (bp-transfer / baseline-smoke / squad fixtures) and leave it. The client
    // normalizes that into five squads in memory, so the sortie page looks
    // perfectly launchable -- while services/squads.cjs's assertSeatAllowed
    // reads the STORED doc, finds no presets, and 400s with "squadIndex out of
    // range for this player". The launch then silently does not navigate,
    // which is the failure this test showed on 2026-08-11. Re-seeding the
    // worker's own e2e_ci fixture makes "fresh profile" true instead of hoped
    // for, and costs one PUT.
    await page.request.put('/api/profile/default/canvas', { data: SEED_PROFILE.canvas ?? SEED_PROFILE });
    await bootApp(page);
    await page.goto('/app/#/sortie');
    await expect(page.locator('[data-testid="sortie-entry"]')).toBeVisible({ timeout: 10000 });
    // Fresh profile: the stepper starts at its default 1.
    await expect(page.locator('[data-testid="sortie-level-input"]')).toHaveValue('1');
    await page.locator('[data-testid="sortie-level-input"]').fill('7');
    await page.locator('[data-testid="sortie-squad-card-0"]').click();
    await expect(page.locator('[data-testid="sortie-launch-btn"]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-testid="sortie-launch-btn"]').click();
    await expect(page).toHaveURL(/#\/schedule$/, { timeout: 10000 });
    // In-session revisit: seeded from the store's live state.
    await page.goto('/app/#/sortie');
    await expect(page.locator('[data-testid="sortie-entry"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="sortie-level-input"]')).toHaveValue('7');
    // Full reload: seeded from the auto-saved canvas doc.
    await waitForAutoSave(page);
    await page.reload();
    await expect(page.locator('[data-testid="sortie-entry"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="sortie-level-input"]')).toHaveValue('7', { timeout: 15000 });
    // CLEANUP: disband the recruiting troop this test opened. Fleet workers
    // are REUSED across spec files, and a still-recruiting troop's held seat
    // makes later slot assignments of that squad 409 'deployed elsewhere'
    // (exactly what broke workshop.spec's LRDST run on the shared worker in
    // this REQ's first CI run) -- same cancel the troop-host.spec.ts
    // afterAll uses.
    const rooms = (await (await page.request.get('/api/schedule/rooms')).json()).rooms as Array<{ id: string; status: string }>;
    for (const r of rooms) {
      if (r.status === 'recruiting') await page.request.post(`/api/schedule/troops/${r.id}/cancel`);
    }
  });
});
