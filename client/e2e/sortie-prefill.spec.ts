// client/e2e/sortie-prefill.spec.ts -- REQ-0371 (attack-level prefill) gate:
// "set attackLv 7, depart, revisit sortie -> stepper shows 7". The pref rides
// the persisted canvas doc as state.sortie (sortiePrefs.ts, the REQ-0141
// state.guide precedent), so it must survive BOTH an in-session revisit (store
// state) and a full reload (auto-save PUT -> boot restore). The depart here is
// the 1-squad RECRUIT path (REQ-0337): one squad card + the one CTA opens a
// public troop -- same commit gesture, no need for four deployable squads.
import { test, expect } from '@playwright/test';
import { bootApp, waitForAutoSave } from './helpers';

test.describe('REQ-0371 sortie attackLv prefill', () => {
  test('attackLv 7 committed at depart is the stepper seed on revisit and after reload', async ({ page }) => {
    await bootApp(page);
    // GUARD (added while merging REQ-0370): fleet workers are REUSED across
    // spec files, and a still-recruiting troop left by an EARLIER file on
    // this worker holds a seat that keeps squad 0 undeployable -- the launch
    // button then never enables (the same collision class the CLEANUP below
    // stops this file from CAUSING). REQ-0370's new audio-mixer.spec.ts
    // reshuffled the file->worker layout and surfaced it twice in full-suite
    // runs (spec green 4/4 standalone). Cancel leftovers up front: this spec
    // provisions its own clean seat regardless of its neighbours.
    {
      const rooms = (await (await page.request.get('/api/schedule/rooms')).json()).rooms as Array<{ id: string; status: string }>;
      for (const r of rooms) {
        if (r.status === 'recruiting') await page.request.post(`/api/schedule/troops/${r.id}/cancel`);
      }
    }
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
