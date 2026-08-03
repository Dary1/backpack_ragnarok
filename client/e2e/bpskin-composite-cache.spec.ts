// client/e2e/bpskin-composite-cache.spec.ts -- REQ-0350.
//
// The BP-skin texture cache must actually save the composite. Both halves of
// the bug this REQ fixes were invisible to every gate the project had: the
// board rendered CORRECTLY throughout, so no pixel test and no interaction
// spec moved. The only symptom was work -- three Euclidean distance transforms
// plus a full W*H pass, 11.2ms (1x1) to 23.1ms (2x3) per skinned BP at
// CELL=80 -- repeated on every render(state), on both mounted boards, forever.
//
// So this spec asserts the COUNT, not the clock. A wall-clock threshold for
// "the board renders fast enough" is exactly the assertion CI reports as a
// flake on a loaded box; "N renders over an unmoved board must add ZERO
// composites" is discrete and load-independent.
//
// paintProbe.ts's lesson is honoured verbatim: a zero from an unvalidated
// probe is worth nothing and looks exactly like a fixed bug. Neither test here
// asserts composites-stayed-zero without, in the SAME test, watching `hits`
// climb -- proof that the skin draw path ran at all and that the cache served
// it -- and test 2 additionally proves the BP really moved by reading the
// saved profile back. Without those, a spec that accidentally rendered a board
// with no skin on it would be green for the wrong reason.
//
// Why a `dwarf` unit: uskin_bp_dwarf is a slot:"bpskin" unit_skin with
// `default: true, units: ['dwarf']` and a real entry in /api/content's
// art_urls, so resolveBpSkin lands on a def that declaresFillTexture() and the
// composite path genuinely fires. A BP whose unit has no adopted artwork
// paints nothing at all (bpSkinTexture's THE GUARD) and would make this spec
// vacuous -- which is what the `composites >= 1` wait below is really for.
import { test, expect, type Page } from '@playwright/test';
import { autoSaveAndFetch, bx, by, cx, cy, drag, loadFixtureAndBoot } from './helpers';

interface Probe { composites: number; hits: number }

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => (window as unknown as { __backpackDebug: { bpSkinProbe: () => Probe } }).__backpackDebug.bpSkinProbe());

const resetProbe = (page: Page): Promise<void> =>
  page.evaluate(() => (window as unknown as { __backpackDebug: { resetBpSkinProbe: () => void } }).__backpackDebug.resetBpSkinProbe());

/** The e2e fleet is FILES-backed: /api/content's `unit_skins` come from
 * content/live (so uskin_bp_dwarf -- slot:"bpskin", default:true,
 * units:["dwarf"] -- is really there), but `art_urls` is registry/DB-derived
 * and is therefore EMPTY. With no adopted artwork bpSkinTexture's THE GUARD
 * declines to paint at all, so the composite path never runs and this whole
 * spec would be vacuously green. Adopt artwork for every slot:"bpskin" default
 * in flight -- the same in-flight /api/content mutation
 * unit-skin-fallback.spec.ts uses, and for exactly the same reason. Everything
 * else in the payload stays real. */
const ART_BPSKIN = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='8'%20height='8'%3E%3Crect%20width='8'%20height='8'%20fill='%238a6b3f'/%3E%3C/svg%3E";

async function adoptBpSkinArt(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/content',
    async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      const skins = (j.unit_skins ?? {}) as Record<string, { id: string; slot: string; default?: boolean }>;
      const art = (j.art_urls ?? {}) as Record<string, string>;
      for (const id of Object.keys(skins)) {
        const s = skins[id];
        if (s && s.slot === 'bpskin' && s.default === true) art[s.id] = ART_BPSKIN;
      }
      j.art_urls = art;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
    },
  );
  // No PICK, so resolveBpSkin falls to the set default -- the shipped state
  // (ruling D5: absence IS the default). Stubbed rather than left alone so an
  // authenticated 401/empty response cannot change which rung fires.
  await page.route('**/api/profile/*/skins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, skins: { unit: {}, bpskin: {} } }) }),
  );
}

/** The skin raster decodes ASYNCHRONOUSLY (bpSkinTexture.decode -> Image
 * onload), and render() is not async: a skinned BP paints unskinned on the
 * frame that starts the decode, and onReady() re-renders once the pixels land.
 * So "the board is ready" is not "the skin has composited". Wait for the first
 * composite explicitly -- this doubles as the guard that the fixture really is
 * exercising the skin path. */
async function waitForFirstComposite(page: Page): Promise<void> {
  await expect
    .poll(async () => (await probe(page)).composites, { timeout: 10000, message: 'the skinned BP never composited -- fixture is not exercising the skin path' })
    .toBeGreaterThan(0);
}

/** A 1x2 dwarf BP on the canvas, with its inventory HOME on page 2. The home
 * is not decoration: under the reference model a canvas BP with no home at all
 * is a state no real client could produce, and migrateCanvasToReferencesV3
 * would first-fit it onto a page mid-boot and move the very cells this spec
 * measures (board-render-ondemand.spec.ts's fixture says the same, and
 * bp-rotate.spec.ts's before it). REQ-0290: the BP's cells are NOT all grab
 * handles -- the unit's SEAT cell never was one (the empty-cell loop skips it
 * via unitMap) and is now inert besides, so test 2 moves the BP by its ✥
 * badge, which sits in that same cell (2,2) and keeps grabOff at [0,0]. */
function makeCanvas() {
  const bp = {
    id: 'e2e_skincache_bp',
    name: 'Skin Cache',
    color: '#4a90d9',
    origin: [2, 2],
    shape: [[0, 0], [0, 1]],
    unit: { id: 'dwarf', off: [0, 0] },
  };
  const empty = () => ({ bps: [], pos: [], sis: [], tms: [] });
  return {
    linked: true,
    bps: [bp],
    pos: [],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [empty(), { bps: [bp], pos: [], sis: [], tms: [] }, empty(), empty(), empty()],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

test.describe('REQ-0350 -- the BP-skin composite is cached, not recomputed', () => {
  test('1. repeated renders over an unmoved board add ZERO composites (and the same probe still shows the cache being read)', async ({ page }) => {
    await adoptBpSkinArt(page);
    await loadFixtureAndBoot(page, makeCanvas());
    await waitForFirstComposite(page);
    await resetProbe(page);

    // Switching the inventory tab is a store mutation, so both boards'
    // snapshot subscriptions fire and re-enter render(state) -- and it moves
    // no BP, so not one cell set changes. Pre-REQ-0350 each of these renders
    // recomposited the dwarf BP from scratch on whichever boards drew it,
    // because compositeSkin() ran BEFORE the cache was consulted.
    const tabs = page.locator('.inv-tab');
    const tabCount = await tabs.count();
    expect(tabCount, 'inventory tabs are this test\'s render driver').toBeGreaterThan(1);
    for (let i = 0; i < 6; i++) {
      await tabs.nth(i % 2 === 0 ? 1 : 0).click();
      await page.waitForTimeout(60);
    }

    const after = await probe(page);
    expect(after.hits, 'the skin draw path ran and the cache served it -- without this the zero below is meaningless').toBeGreaterThan(0);
    expect(after.composites, 'no cell set changed, so nothing may be recomposited').toBe(0);
  });

  test('2. MOVING the BP adds zero composites -- the cache key is shape-normalised, not position-keyed', async ({ page }) => {
    await adoptBpSkinArt(page);
    await loadFixtureAndBoot(page, makeCanvas());
    await waitForFirstComposite(page);
    await resetProbe(page);

    // The composite is translation-invariant by construction (composite.ts
    // works entirely in the cell set's own r0/c0 frame -- check_bpskin.mjs
    // pins that), so the SAME pixels serve the BP at any position. Before this
    // REQ the key carried absolute cells, so this drag minted a brand-new
    // entry for byte-identical pixels and paid a full composite for it. That
    // is what thrashed a 64-entry cache during ordinary play.
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;
    await drag(
      page,
      { x: box.x + bx(2), y: box.y + by(2) }, // REQ-0290: ✥ badge; cx/cy here hit the (now inert) seat
      { x: box.x + cx(5), y: box.y + cy(5) },
    );

    // Prove the move actually happened -- a rejected drag would leave the
    // board untouched and make the composite assertion vacuous.
    const saved = await autoSaveAndFetch(page);
    const moved = saved.bps.find((b: { id: string }) => b.id === 'e2e_skincache_bp');
    expect(moved, 'the fixture BP survived the drag').toBeTruthy();
    expect(moved.origin, 'the BP genuinely moved, so the position-keyed cache would have missed here').not.toEqual([2, 2]);

    const after = await probe(page);
    expect(after.hits, 'the moved BP was drawn from the cache').toBeGreaterThan(0);
    expect(after.composites, 'a translation of a known shape must reuse its composite').toBe(0);
  });
});
