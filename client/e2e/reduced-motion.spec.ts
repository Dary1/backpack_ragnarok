// REQ-0143 -- overlay-accessibility, spec item 2: the reduced-motion setting
// exists, persists, and drives the app-wide animation flags.
//
// "Affects animation flags" is tested honestly through the document attributes
// that a11y/motionPrefs owns: :root[data-motion="on"] (REQ-0113 scopes every
// decorative CSS motion under it) is present iff motion is welcome, and
// :root[data-reduced-motion] mirrors the pref. Toggling flips both and the
// choice survives a reload. The CVD-safe overlay palette is validated
// separately by client/scripts/overlay_a11y_harness.mjs (a pure machine gate).
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'bp.a11y.prefs';

test.describe('REQ-0143 reduced-motion settings', () => {
  test('reduced-motion toggle exists, drives the motion flags, and persists', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/app/#/settings');

    const section = page.getByTestId('settings-a11y');
    await expect(section).toBeVisible();
    const toggle = page.getByTestId('settings-reduced-motion-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId('settings-a11y-colorblind-note')).toBeVisible();

    const html = page.locator('html');

    // Seed under automation (navigator.webdriver) is reduced ON -> toggle
    // checked, data-reduced-motion="true", and the motion gate is OFF.
    await expect(toggle).toBeChecked();
    await expect(html).toHaveAttribute('data-reduced-motion', 'true');
    expect(await html.getAttribute('data-motion')).toBeNull();

    // Turn reduced-motion OFF: flags flip live and the choice persists.
    await toggle.uncheck();
    await expect(html).toHaveAttribute('data-reduced-motion', 'false');
    await expect(html).toHaveAttribute('data-motion', 'on');
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string).reducedMotion).toBe(false);

    // Survives a full reload: the explicit choice wins over the seed.
    await page.reload();
    await expect(page.getByTestId('settings-reduced-motion-toggle')).not.toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'false');

    // Re-enable: round-trips both ways, motion gate closes again.
    await page.getByTestId('settings-reduced-motion-toggle').check();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    expect(await page.locator('html').getAttribute('data-motion')).toBeNull();
    const stored2 = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(JSON.parse(stored2 as string).reducedMotion).toBe(true);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
