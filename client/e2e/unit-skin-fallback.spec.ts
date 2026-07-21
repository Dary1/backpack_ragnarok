// client/e2e/unit-skin-fallback.spec.ts -- REQ-0266 (Ships item 35).
//
// THE FALLBACK PROOF the REQ asks for, as four states of one chain:
//   1. a unit with NO skin still renders          -> the legacy rune glyph
//   2. a unit with a DEFAULT skin renders it      -> data-art-source="skin"
//   3. a profile that PICKED another skin gets it -> the pick, not the default
//   4. a BP with NO skin still renders            -> neutral, i.e. UNCHANGED
//
// (1)-(3) are DOM-observable because REQ-0266 put `data-art-source` on every
// routed <img>: the attribute carries WHICH RUNG WON, so these tests assert the
// chain fell through for the right reason instead of merely that something was
// drawn. Ports: none. This spec runs on the standard fleet and hard-codes no
// port, so tools/check_e2e_ports.cjs (ci.sh [0/8]) is unaffected.
//
// (4) is a PIXEL test, and deliberately so. Nothing in the suite looked at the
// board's appearance, which is exactly how REQ-0266's first BoardRenderer
// binding shipped a regression past every green gate: `neutral` is always
// registered, so the 5-rung chain lands on a def for EVERY BP, and an art-less
// def painted an opaque #2b3240 body over the per-BP colour tint -- the one cue
// that tells one BP from another. The fleet is files-backed, so no skin artwork
// is ever adopted there and every BP resolves to `neutral`: this spec's normal
// state IS the regression's trigger state.
//
// Data control: the fleet has no adopted skin artwork (files mode has no
// registry at all), so states (2) and (3) cannot arise from its own content.
// They are produced by MUTATING the real /api/content response in flight --
// injecting art_urls entries and one extra def -- and stubbing the authenticated
// prefs route. Everything else in the payload stays real.
import { test, expect, type Page } from '@playwright/test';
import { bootApp, PAD, CELL } from './helpers';

/** Two tiny inline SVGs. They must actually LOAD: every routed surface hides
 * its <img> on error, so a URL that 404s would make these tests vacuous. */
const ART_DEFAULT = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='8'%20height='8'%3E%3Crect%20width='8'%20height='8'%20fill='%23c0392b'/%3E%3C/svg%3E";
const ART_PICKED = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='8'%20height='8'%3E%3Crect%20width='8'%20height='8'%20fill='%232980b9'/%3E%3C/svg%3E";

/** Mutates /api/content in flight. `mode`:
 *   'bare'    -- untouched: no skin artwork is adopted, so every unit falls to
 *                its own def icon and the `skin` rung cannot fire.
 *   'default' -- every slot:"unit" default skin gets an adopted art URL.
 *   'picked'  -- as 'default', PLUS one extra non-default skin per unit with a
 *                different art URL, which the prefs stub then picks. */
async function routeContent(page: Page, mode: 'bare' | 'default' | 'picked'): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/content',
    async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (mode !== 'bare') {
        const skins = (j.unit_skins ?? {}) as Record<string, { id: string; slot: string; units: string[]; default?: boolean }>;
        const art = (j.art_urls ?? {}) as Record<string, string>;
        for (const id of Object.keys(skins)) {
          const s = skins[id];
          if (!s || s.slot !== 'unit' || s.default !== true) continue;
          art[s.id] = ART_DEFAULT;
          if (mode === 'picked') {
            const alt = 'uskin_e2e_alt_' + s.units[0];
            skins[alt] = { id: alt, slot: 'unit', units: [s.units[0]], default: false } as never;
            (skins[alt] as unknown as { name: string; art_ref: string }).name = 'E2E Alt';
            (skins[alt] as unknown as { name: string; art_ref: string }).art_ref = 'e2e_alt';
            art[alt] = ART_PICKED;
          }
        }
        j.unit_skins = skins;
        j.art_urls = art;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
    },
  );
}

/** Stubs the authenticated per-profile prefs route. `null` = no picks at all,
 * which is the shipped default state (ruling D5: absence IS the default). */
async function routeSkinPrefs(page: Page, unitPicks: Record<string, string> | null): Promise<void> {
  await page.route('**/api/profile/*/skins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, skins: { unit: unitPicks ?? {}, bpskin: {} } }) }),
  );
}

async function openUnitsTab(page: Page): Promise<void> {
  await page.locator('.nav-link', { hasText: 'Dex' }).click();
  await page.locator('.dex-tab', { hasText: 'Units' }).click();
  await expect(page.locator('.dex-tab-active', { hasText: 'Units' })).toBeVisible();
  await expect(page.locator('.dex-unit-card').first()).toBeVisible();
}

test.describe('REQ-0266 skin fallbacks', () => {
  test('1. a unit with NO skin still renders -- the legacy glyph, and the skin rung never fires', async ({ page }) => {
    await routeContent(page, 'bare');
    await routeSkinPrefs(page, null);
    await bootApp(page);
    await openUnitsTab(page);
    // The portrait well and its rune are always in the DOM -- that IS the
    // legacy fallback, and it is what shows when nothing above it resolves.
    await expect(page.locator('.dex-portrait-well').first()).toBeVisible();
    await expect(page.locator('.dex-portrait-well .dex-art-fallback.rune').first()).toBeVisible();
    // The load-bearing negative: with no adopted skin artwork the `skin` rung
    // MUST NOT win anywhere -- not on the Dex, not on any other routed surface.
    // Tests 2 and 3 below prove this locator is not vacuous.
    await expect(page.locator('[data-art-source="skin"]')).toHaveCount(0);
    // Whatever <img> did survive came from the unit def's own icon.
    for (const src of await page.locator('.dex-portrait-img').evaluateAll((els) => els.map((e) => e.getAttribute('data-art-source')))) {
      expect(src).toBe('default');
    }
  });

  test('2. a unit with a DEFAULT skin renders the default', async ({ page }) => {
    await routeContent(page, 'default');
    await routeSkinPrefs(page, null); // the player picked nothing
    await bootApp(page);
    await openUnitsTab(page);
    const img = page.locator('.dex-portrait-img[data-art-source="skin"]');
    await expect(img.first()).toBeVisible();
    expect(await img.count()).toBeGreaterThan(0);
    expect(await img.first().getAttribute('src')).toBe(ART_DEFAULT);
    // ...and it really is displayed, not a broken-image box.
    expect(await img.first().evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });

  test('3. a profile that PICKED a different skin renders the pick, not the default', async ({ page }) => {
    await routeContent(page, 'picked');
    // Pick the injected alternate for every unit. pickedSkinId() re-validates
    // the pick against the defs, so this only works because the alternate is
    // really in unit_skins and really lists that unit.
    const content = await (await page.request.get('/api/content')).json();
    const picks: Record<string, string> = {};
    for (const u of Object.keys(content.units ?? {})) picks[u] = 'uskin_e2e_alt_' + u;
    await routeSkinPrefs(page, picks);
    await bootApp(page);
    await openUnitsTab(page);
    const img = page.locator('.dex-portrait-img[data-art-source="skin"]');
    await expect(img.first()).toBeVisible();
    expect(await img.first().getAttribute('src')).toBe(ART_PICKED);
    // The whole point of the rung: the def default was available and lost.
    // Compared in JS rather than through a CSS attribute selector -- a data:
    // URL is not something to hand a selector parser.
    const srcs = await page.locator('.dex-portrait-img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.filter((u) => u === ART_DEFAULT)).toHaveLength(0);
    expect(srcs.filter((u) => u === ART_PICKED).length).toBeGreaterThan(0);
  });

  test('4. a BP with NO skin still renders -- neutral paints nothing, so the board is UNCHANGED', async ({ page }) => {
    // A pure-red BP, so "its own colour tint" is unmistakable against both the
    // dark board and the neutral skin body (#2b3240) the regression painted.
    const bp = { id: 'skinless', name: 'Skinless', color: '#ff0000', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [2, 2], unit: { id: 'elf', off: [0, 0] } };
    // Reference model (REQ-0033): every canvas BP must have an inventory home,
    // and it must not be page 0 or migrateCanvasToReferencesV3 would first-fit
    // it on top of the BP page 0 already holds. Same fixture posture as
    // bp-rotate.spec.ts, for the same reason.
    await page.request.put('/api/profile/default/canvas', {
      data: {
        linked: true, bps: [bp], pos: [], sis: [], layout: { ROWS: 8, COLS: 8 },
        presets: { active: 0, names: ['P1'], store: [null] },
        inv: {
          pages: [
            { bps: [{ ...bp, id: 'skinless_home', name: 'Skinless Home' }], pos: [], sis: [], tms: [] },
            { bps: [bp], pos: [], sis: [], tms: [] },
            { bps: [], pos: [], sis: [], tms: [] },
          ],
          names: ['1', '2', '3'],
        },
      },
    });
    await bootApp(page);

    // Cell (3,3): inside the BP, diagonal from its unit cell (2,2) -- so clear
    // of the unit core disc, of the rook rays that run along row 2 / column 2,
    // and of every direction dot. Inset well away from the 3px outline.
    const region = { x: PAD + 2 * CELL + 14, y: PAD + 2 * CELL + 14, w: CELL - 28, h: CELL - 28 };

    const canvasStats = await probe(page, 'canvas.board-canvas', region);
    // The BP's own colour reads across the cell...
    expect(canvasStats.redDominant / canvasStats.total).toBeGreaterThan(0.8);
    // ...and the neutral skin body is nowhere on it. This single number is the
    // regression: before the guard it was ~1.0 here.
    expect(canvasStats.neutralBody / canvasStats.total).toBeLessThan(0.05);

    // The inventory board uses a NEUTRAL grid background for every cell
    // (REQ-0030 item 1), so there is no colour tint to look for there -- but the
    // neutral skin body must be just as absent, and the grid must still be the
    // grid.
    const invStats = await probe(page, 'canvas.inventory-board-canvas', region);
    expect(invStats.neutralBody / invStats.total).toBeLessThan(0.05);
    expect(invStats.gridDark / invStats.total).toBeGreaterThan(0.8);
  });
});

/**
 * Samples a rectangle of a board canvas, in the board's own pixel space.
 *
 * Playwright hands back a PNG; rather than decode it here, it goes back into
 * the page as a data URL and the browser decodes it into a 2D canvas -- no
 * decoder to maintain and no dependency to add. The PixiJS canvas is
 * backgroundAlpha:0, so the screenshot is the COMPOSITED result, which is
 * exactly what the player sees and the only thing worth asserting.
 */
async function probe(page: Page, selector: string, box: { x: number; y: number; w: number; h: number }) {
  const canvas = page.locator(selector).first();
  await expect(canvas).toBeVisible();
  const bb = (await canvas.boundingBox())!;
  const b64 = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, box, cssWidth }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const el = document.createElement('canvas');
      el.width = img.width; el.height = img.height;
      const ctx = el.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // The shot is in DEVICE pixels; `box` is in CSS/board pixels.
      const s = img.width / cssWidth;
      const d = ctx.getImageData(Math.round(box.x * s), Math.round(box.y * s), Math.round(box.w * s), Math.round(box.h * s)).data;
      let total = 0, redDominant = 0, neutralBody = 0, gridDark = 0;
      const near = (v: number, t: number, tol: number) => Math.abs(v - t) <= tol;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        total++;
        if (r > g + 12 && r > b + 12) redDominant++;
        // #2b3240 -- live_bpskins.json's neutral palette.fill, the body the
        // pre-guard binding painted over every BP.
        if (near(r, 0x2b, 6) && near(g, 0x32, 6) && near(b, 0x40, 6)) neutralBody++;
        // #191919 -- BoardRenderer's neutral grid cell.
        if (near(r, 0x19, 12) && near(g, 0x19, 12) && near(b, 0x19, 12)) gridDark++;
      }
      return { total, redDominant, neutralBody, gridDark };
    },
    { b64, box, cssWidth: bb.width },
  );
}
