// REQ-0370 -- Audio foundation: mixer settings exist + persist.
//
// Same honesty posture as chimes-settings.spec.ts: headless audio is not
// meaningfully audible, so this gates what IS honest -- the mixer controls
// render, default sanely (unity master/SE so every pre-mixer sound is
// untouched; BGM below unity as a subtle layer), persist to localStorage
// immediately, and survive a reload. BGM playback itself is hard-OFF under
// navigator.webdriver by design (spec item 4), so nothing here fakes an
// audio assertion; the gain math lives in the pure prefs module, gated by
// client/scripts/check_audio_prefs.mjs.
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'bp.audio.prefs';

test.describe('REQ-0370 audio mixer settings', () => {
  test('mixer controls exist, default sanely, and persist', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/app/#/settings');
    await expect(page.getByTestId('settings-sound')).toBeVisible();

    const master = page.getByTestId('settings-master-volume');
    const bgm = page.getByTestId('settings-bgm-volume');
    const se = page.getByTestId('settings-se-volume');
    const mute = page.getByTestId('settings-mute-toggle');

    // Defaults: master/SE at unity (no audible change for existing sounds),
    // BGM below unity, mute off.
    expect(Number(await master.inputValue())).toBe(100);
    expect(Number(await se.inputValue())).toBe(100);
    const bgmDefault = Number(await bgm.inputValue());
    expect(bgmDefault).toBeGreaterThan(0);
    expect(bgmDefault).toBeLessThan(100);
    await expect(mute).not.toBeChecked();

    // The old chime-scoped volume slider is folded into SE (REQ-0370).
    await expect(page.getByTestId('settings-chimes-volume')).toHaveCount(0);

    // Change every control; persisted to localStorage immediately.
    await master.fill('40');
    await bgm.fill('25');
    await se.fill('55');
    await mute.check();

    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string);
    expect(Math.round(parsed.master * 100)).toBe(40);
    expect(Math.round(parsed.bgm * 100)).toBe(25);
    expect(Math.round(parsed.sfx * 100)).toBe(55);
    expect(parsed.muted).toBe(true);

    // And it survives a full reload.
    await page.reload();
    await expect(page.getByTestId('settings-sound')).toBeVisible();
    expect(Number(await page.getByTestId('settings-master-volume').inputValue())).toBe(40);
    expect(Number(await page.getByTestId('settings-bgm-volume').inputValue())).toBe(25);
    expect(Number(await page.getByTestId('settings-se-volume').inputValue())).toBe(55);
    await expect(page.getByTestId('settings-mute-toggle')).toBeChecked();

    // Unmute round-trips (mute preserves slider values by design).
    await page.getByTestId('settings-mute-toggle').uncheck();
    const stored2 = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    const parsed2 = JSON.parse(stored2 as string);
    expect(parsed2.muted).toBe(false);
    expect(Math.round(parsed2.master * 100)).toBe(40);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
