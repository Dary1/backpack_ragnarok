// REQ-0059 -- Circuit Chimes: Settings controls exist + persist.
//
// Headless audio is not honestly testable (no speakers, an AudioContext
// that never really sounds), so per the REQ's test plan this gates the
// parts that ARE honest: the Sound & Haptics settings block renders, its
// toggles + volume default correctly, a change writes localStorage, and
// the choice survives a reload. The deterministic event->note mapping is
// covered separately + thoroughly by client/scripts/check_chime_mapping.mjs
// (a pure-function unit gate), not faked here.
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'bp.chimes.prefs';

test.describe('REQ-0059 circuit-chime settings', () => {
  test('Sound & Haptics controls exist, default sanely, and persist', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // Pin reduced-motion so the default-ON expectation is deterministic
    // regardless of the box's own media settings.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/app/#/settings');

    const section = page.getByTestId('settings-sound');
    await expect(section).toBeVisible();

    const chimes = page.getByTestId('settings-chimes-toggle');
    const haptics = page.getByTestId('settings-haptics-toggle');
    const volume = page.getByTestId('settings-chimes-volume');

    // Defaults: chimes ON, haptics ON, volume a low non-zero mix.
    await expect(chimes).toBeChecked();
    await expect(haptics).toBeChecked();
    const defaultVol = Number(await volume.inputValue());
    expect(defaultVol).toBeGreaterThan(0);
    expect(defaultVol).toBeLessThanOrEqual(50);

    // Change every control.
    await chimes.uncheck();
    await haptics.uncheck();
    await volume.fill('12');

    // The change is persisted to localStorage immediately (no Save button).
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string);
    expect(parsed.chimes).toBe(false);
    expect(parsed.haptics).toBe(false);
    expect(Math.round(parsed.volume * 100)).toBe(12);

    // And it survives a full reload.
    await page.reload();
    await expect(page.getByTestId('settings-sound')).toBeVisible();
    await expect(page.getByTestId('settings-chimes-toggle')).not.toBeChecked();
    await expect(page.getByTestId('settings-haptics-toggle')).not.toBeChecked();
    expect(Number(await page.getByTestId('settings-chimes-volume').inputValue())).toBe(12);

    // Re-enabling writes the flag back true (round-trips both ways).
    await page.getByTestId('settings-chimes-toggle').check();
    const stored2 = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(JSON.parse(stored2 as string).chimes).toBe(true);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
