// client/e2e/inventory-organize.spec.ts -- REQ-0373 (inventory organize).
//
// Three gates, one per spec item:
//   1. Auto-arrange: scatter a page, press the inventory boardfoot's
//      Arrange, get the EXACT expected packed layout -- persisted through
//      the normal auto-save PUT (design rule 5) -- and undo it in ONE step
//      (REQ-0367 interop: the whole repack is a single undoable action).
//   2. Name search: the side panel's search narrows the list by EITHER
//      locale's name, whichever locale the UI is in, and ANDs with the
//      active filter chip.
//   3. Mass-dismantle safety: the multi-selection summary breaks down by
//      rarity, and a selection holding Rare or better needs a second,
//      armed click; a Commons-only selection confirms in one, as before.
//
// CONTENT NOTE: the REQ's own gate text says search "frost". Live content
// (content/live/live_items.json) has no frost PO -- `acc_frost` is an SI and
// the side panel lists POs -- so the search gate uses `dagger` (EN "Dagger"
// / JA "ダガー"), which exercises the same both-locales clause against real
// served content instead of a fixture-only invention. Same reason the
// dismantle gate reaches for SIs: they are the only live content carrying a
// Rare rarity today (sis005_thunder_core), and the picker takes POs and SIs
// alike.
import { test, expect, type Page } from '@playwright/test';
import { bootApp, fetchSavedCanvas, loadFixtureAndBoot, waitForAutoSave } from './helpers';

const ARRANGE_BTN = '[data-testid="inventory-arrange-btn"]';
const UNDO_BTN = '[data-testid="canvas-undo-btn"]';
const SEARCH = '[data-testid="canvas-inv-search"]';
const ROWS = '.canvas-side-panel .item-list .icard';

const emptyPage = () => ({ bps: [], pos: [], sis: [], tms: [] });
function fixture(page0: Record<string, unknown>) {
  return {
    linked: true,
    bps: [],
    pos: [],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [{ ...emptyPage(), ...page0 }, emptyPage(), emptyPage(), emptyPage(), emptyPage()],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

const page0Of = (canvas: any) => canvas.inv.pages[0];
const poCell = (canvas: any, uid: string) => page0Of(canvas).pos.find((p: any) => p.uid === uid)?.cell;

test.describe('REQ-0373 -- auto-arrange', () => {
  // A scattered page-0: one 2x2 pack at [5,5], a 2x2 tower shield at [7,1],
  // a 2x1 dagger at [2,7] and a 1x1 hilt at [8,8]. Nothing overlaps, so
  // migrateState's own read-time repairs have nothing to do at boot and the
  // only thing that moves anything is the button under test.
  function scattered() {
    return fixture({
      bps: [{ id: 'r373_bp', name: 'Pack', color: '#4a90d9', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [5, 5], unit: { id: 'dwarf', off: [0, 0] } }],
      pos: [
        { uid: 'r373_shield', id: 'tower_shield', loc: 'grid', cell: [7, 1], rot: 0 },
        { uid: 'r373_dagger', id: 'dagger', loc: 'grid', cell: [2, 7], rot: 0 },
        { uid: 'r373_hilt', id: 'hilt', loc: 'grid', cell: [8, 8], rot: 0 },
      ],
    });
  }

  test('scatter -> Arrange -> the expected packed layout, persisted by the normal auto-save', async ({ page }) => {
    await loadFixtureAndBoot(page, scattered());
    await expect(page.locator(UNDO_BTN)).toBeDisabled(); // fresh boot: no slot

    await page.locator(ARRANGE_BTN).click();

    // Footprint-descending first fit over an 8x8 page: the 4-cell pack wins
    // the area tie against the 4-cell shield on kind (a pack seats before a
    // loose item), so pack -> [1,1], shield -> [1,3], dagger -> [1,5],
    // hilt -> [1,6]. Asserted exactly: "deterministic" is the gate, and a
    // property-only assertion would pass for a layout nobody chose.
    await expect(page.locator('[data-testid="inventory-arrange-note"]')).toHaveAttribute('data-arrange-moved', '4');
    await waitForAutoSave(page);
    const saved = await fetchSavedCanvas(page);
    expect(page0Of(saved).bps.find((b: any) => b.id === 'r373_bp').origin).toEqual([1, 1]);
    expect(poCell(saved, 'r373_shield')).toEqual([1, 3]);
    expect(poCell(saved, 'r373_dagger')).toEqual([1, 5]);
    expect(poCell(saved, 'r373_hilt')).toEqual([1, 6]);

    // Pressing it again on an arranged page is an honest no-op: nothing
    // moves and the note says so.
    await page.locator(ARRANGE_BTN).click();
    await expect(page.locator('[data-testid="inventory-arrange-note"]')).toHaveAttribute('data-arrange-moved', '0');
  });

  test('an arrange is ONE undoable step (REQ-0367 interop)', async ({ page }) => {
    await loadFixtureAndBoot(page, scattered());
    await page.locator(ARRANGE_BTN).click();
    await waitForAutoSave(page);
    expect(poCell(await fetchSavedCanvas(page), 'r373_hilt')).toEqual([1, 6]);

    const undoBtn = page.locator(UNDO_BTN);
    await expect(undoBtn).toBeEnabled(); // the repack armed the slot
    await undoBtn.click();
    await waitForAutoSave(page);

    // ONE step puts the WHOLE page back -- all four records, not just the
    // last one the repack happened to touch.
    const restored = await fetchSavedCanvas(page);
    expect(page0Of(restored).bps.find((b: any) => b.id === 'r373_bp').origin).toEqual([5, 5]);
    expect(poCell(restored, 'r373_shield')).toEqual([7, 1]);
    expect(poCell(restored, 'r373_dagger')).toEqual([2, 7]);
    expect(poCell(restored, 'r373_hilt')).toEqual([8, 8]);
    await expect(undoBtn).toBeDisabled(); // slot consumed, no redo
  });
});

test.describe('REQ-0373 -- inventory name search', () => {
  async function bootTwoItems(page: Page) {
    await loadFixtureAndBoot(page, fixture({
      pos: [
        { uid: 'r373_s_dagger', id: 'dagger', loc: 'grid', cell: [1, 1], rot: 0 },
        { uid: 'r373_s_herb', id: 'herb_pouch', loc: 'grid', cell: [1, 3], rot: 0 },
      ],
    }));
    await expect(page.locator(ROWS)).toHaveCount(2);
  }

  test('narrows by EITHER locale name, in either UI locale, and ANDs with the chip', async ({ page }) => {
    await bootTwoItems(page);
    const search = page.locator(SEARCH);

    // EN UI, EN name.
    await search.fill('dag');
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator(`${ROWS}[data-inv-id="dagger"]`)).toHaveCount(1);

    // EN UI, JA name -- the whole point of matching BOTH locales.
    await search.fill('ダガー');
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator(`${ROWS}[data-inv-id="dagger"]`)).toHaveCount(1);

    // Case-insensitive, and the clear button restores the full list.
    await search.fill('HERB');
    await expect(page.locator(`${ROWS}[data-inv-id="herb_pouch"]`)).toHaveCount(1);
    await page.locator('[data-testid="canvas-inv-search-clear"]').click();
    await expect(page.locator(ROWS)).toHaveCount(2);

    // JA UI, EN name.
    await page.locator('.lang-toggle').click();
    await search.fill('Dagger');
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator(`${ROWS}[data-inv-id="dagger"]`)).toHaveCount(1);
    await page.locator('.lang-toggle').click(); // back to EN for the rest

    // AND-wise with the chip: 'Arms' keeps the dagger, so a herb search
    // under it matches nothing -- neither half is allowed to win alone.
    await search.fill('');
    await page.locator('.canvas-inv-filter[data-filter="weapon"]').click();
    const armsOnly = await page.locator(ROWS).count();
    expect(armsOnly).toBeLessThan(2);
    await search.fill('herb');
    await expect(page.locator(ROWS)).toHaveCount(0);
  });

  test('a search that matches nothing says so -- it is not an empty inventory', async ({ page }) => {
    await bootTwoItems(page);
    await page.locator(SEARCH).fill('zzzznothing');
    await expect(page.locator(ROWS)).toHaveCount(0);
    await expect(page.locator('[data-empty-variant="search"]')).toBeVisible();
    await expect(page.locator('[data-empty-variant="empty-inventory"]')).toHaveCount(0);
  });
});

test.describe('REQ-0373 -- mass-dismantle safety', () => {
  const CONFIRM = '[data-testid="workshop-dismantle-confirm-btn"]';

  async function openDismantle(page: Page, sis: Array<{ uid: string; id: string }>) {
    await page.request.put('/api/profile/default/canvas', { data: fixture({ sis: sis.map((s) => ({ ...s, host: 'inv' })) }) });
    await bootApp(page);
    await page.locator('.nav-link', { hasText: 'Workshop' }).click();
    await page.locator('[data-testid="workshop-dismantle-open-btn"]').click();
    await expect(page.locator('[data-testid="workshop-dismantle-modal"]')).toBeVisible({ timeout: 10000 });
  }

  /** Plain click the first row, Shift+click the second -- REQ-0090's own
   * "add one row" gesture (Shift, not Ctrl: that model is deliberately not
   * the OS convention, see useListMultiSelect.ts). */
  async function selectBoth(page: Page, uidA: string, uidB: string) {
    await page.locator(`[data-testid="workshop-dismantle-item"][data-item-uid="${uidA}"]`).click();
    await page.locator(`[data-testid="workshop-dismantle-item"][data-item-uid="${uidB}"]`).click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid="workshop-dismantle-multi-count"]')).toHaveText('2');
  }

  test('a Rare in the selection shows in the breakdown and arms the confirm', async ({ page }) => {
    await openDismantle(page, [
      { uid: 'r373_d_common', id: 'sis005_serrated_fang' }, // Common
      { uid: 'r373_d_rare', id: 'sis005_thunder_core' }, // Rare
    ]);
    await selectBoth(page, 'r373_d_common', 'r373_d_rare');

    // The breakdown says WHAT is selected, which the bare count never did.
    const chips = page.locator('[data-testid="workshop-dismantle-rarity-chips"] .workshop-dismantle-rarity-chip');
    await expect(chips).toHaveCount(2);
    await expect(page.locator('[data-rarity="Common"]')).toHaveAttribute('data-count', '1');
    await expect(page.locator('[data-rarity="Rare"]')).toHaveAttribute('data-count', '1');

    const confirm = page.locator(CONFIRM);
    await expect(confirm).toHaveAttribute('data-needs-arm', 'true');
    await expect(confirm).toHaveAttribute('data-armed', 'false');

    // First click ARMS only -- nothing is destroyed yet.
    await confirm.click();
    await expect(confirm).toHaveAttribute('data-armed', 'true');
    await expect(page.locator('[data-testid="workshop-dismantle-toast"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="workshop-dismantle-item"][data-item-uid="r373_d_rare"]`)).toHaveCount(1);

    // Second click performs it.
    await confirm.click();
    await expect(page.locator('[data-testid="workshop-dismantle-toast"]')).toBeVisible({ timeout: 10000 });
  });

  test('changing the selection disarms the confirm', async ({ page }) => {
    await openDismantle(page, [
      { uid: 'r373_d_c1', id: 'sis005_serrated_fang' }, // Common
      { uid: 'r373_d_r1', id: 'sis005_moon_pearl' }, // Rare
      { uid: 'r373_d_c2', id: 'sis005_bone_spike' }, // Common
    ]);
    await selectBoth(page, 'r373_d_c1', 'r373_d_r1');
    const confirm = page.locator(CONFIRM);
    await confirm.click();
    await expect(confirm).toHaveAttribute('data-armed', 'true');

    // A third row joins the selection -- the arm was granted for a
    // different set and must not carry over.
    await page.locator(`[data-testid="workshop-dismantle-item"][data-item-uid="r373_d_c2"]`).click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid="workshop-dismantle-multi-count"]')).toHaveText('3');
    await expect(confirm).toHaveAttribute('data-armed', 'false');
  });

  test('a Commons-only selection still confirms in ONE click', async ({ page }) => {
    await openDismantle(page, [
      { uid: 'r373_d_p1', id: 'sis005_serrated_fang' },
      { uid: 'r373_d_p2', id: 'sis005_bone_spike' },
    ]);
    await selectBoth(page, 'r373_d_p1', 'r373_d_p2');
    await expect(page.locator('[data-rarity="Common"]')).toHaveAttribute('data-count', '2');

    const confirm = page.locator(CONFIRM);
    await expect(confirm).toHaveAttribute('data-needs-arm', 'false');
    await expect(page.locator('[data-testid="workshop-dismantle-arm-note"]')).toHaveCount(0);
    await confirm.click();
    await expect(page.locator('[data-testid="workshop-dismantle-toast"]')).toBeVisible({ timeout: 10000 });
  });
});
