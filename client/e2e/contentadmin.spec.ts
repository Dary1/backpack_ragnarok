// client/e2e/contentadmin.spec.ts -- REQ-0155 gate G4, UPDATED by REQ-0157
// for the overhauled console: create lives behind cd-new (dedicated panel),
// the commission payload gets a one-click copy, ingest is gated by a live
// parse preview, adopt/delete go through confirm dialogs (confirm-ok; a
// FAIL adopt additionally demands the adopt-override toggle), edit-as-new
// is a modal with JSON validity + Format, and coverage is ADDED for the
// per-variant JSON viewer, diff-vs-adopted, the recheck endpoint and
// search/filter narrowing. Still a MOCKED LLM (the test constructs the
// variants; no LLM is ever called). Requires the isolated pg-backed
// instance of THIS worktree (tools/content_admin_e2e.sh); dev_mode makes
// the item_admin gate accept the no-token dev fallback. Run ONLY via
// tools/content_admin_e2e.sh (box lock) -- it does exactly that.
//
// REQ-0164 (contentadmin-ux-r2) coverage added below: the review DRAFT
// controls now open behind review-open-<no> (the big flow clicks it first);
// ingest paints an is-new highlight + a cd-adjudicate-summary tally; the diff
// closes on Esc; PLUS standalone tests for stable layout width, the
// collapsible workflow strip, cd-msg clearing on def switch, the
// #/contentadmin/<name> deep link + hash rewrite, the rail sort modes, the
// rail list-error panel, per-kind schema_ref defaults, the dirty-draft guard,
// and local-time card timestamps.
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const NAME = 'e2e_content';

// A known-good po_def (blade-shaped) that PASSes all four machine checks;
// the five variants differ only in the strike range (meaningful per-slot
// variation, not seed roulette).
function variant(i: number) {
  return {
    data: {
      id: 'e2e_blade_v' + i,
      name: 'E2E Blade v' + i,
      rarity: 'Common',
      shape: [[0, 0], [1, 0]],
      icon: 'icon-blade',
      stretch: true,
      sockets: [{ t: 'edge', tags: ['Metal'], ax: 0.5, ay: 0.38 }],
      part: { assembles: 'longsword', role: 'blade' },
      tags: ['WeaponPart', 'Metal'],
      effects: [{ trigger: { t: 'every_secs', s: [1.8, 2.2] }, verb: { t: 'strike', n: [20 + i, 40 + i] }, cond: 'assembled' }],
      flavor: 'Variant ' + i + '.',
    },
    provenance: { source: 'llm', model: 'claude-opus-4.8', model_version: '2026-01', prompt: 'generate a blade variant #' + i, params: { variation: i, temperature: 1.0 }, seed_if_any: null },
  };
}

// confirm-gated click: the action button opens the REQ-0157 confirm dialog
async function confirmClick(page: Page, testId: string) {
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
}

// REQ-0164 E: the rail's row order (system_names, in DOM order).
async function railOrder(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="cd-list"] [data-testid^="cd-select-"]',
    (els) => els.map((e) => (e.getAttribute('data-testid') || '').replace('cd-select-', '')));
}

async function apiCreateDef(request: APIRequestContext, body: Record<string, unknown>) {
  const r = await request.post('/api/content/defs', { data: body });
  expect(r.status()).toBe(201);
}
async function apiIngest(request: APIRequestContext, name: string, variants: unknown[]) {
  const r = await request.post('/api/content/defs/' + name + '/variants', { data: { variants } });
  expect(r.status()).toBe(201);
}

test('content admin: create (panel) -> commission+copy -> parse preview gates ingest -> checks -> review -> JSON view -> diff -> adopt (confirm) -> serve -> delete (confirm) -> edit modal -> re-adopt -> recheck', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('contentadmin')).toBeVisible();

  // REQ-0157: the create flow lives behind cd-new (dedicated panel)
  await page.getByTestId('cd-new').click();
  await page.getByTestId('cd-kind').selectOption('po_def');
  await page.getByTestId('cd-system-name').fill(NAME);
  await page.getByTestId('cd-brief').fill('an assembled longsword blade PO');
  await page.getByTestId('cd-create').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();

  // step 1 -- commission (Q1/Q4): payload panel + ONE-CLICK COPY (fresh def -> strip expanded)
  await page.getByTestId('cd-commission').click();
  await expect(page.getByTestId('cd-commission-out')).toContainText('Generate 5');
  await expect(page.getByTestId('cd-copy-commission')).toBeVisible();
  await page.getByTestId('cd-copy-commission').click();
  await expect(page.getByTestId('cd-msg')).toContainText('copied');

  // step 2 -- the parse preview GATES the ingest button
  await page.getByTestId('cd-ingest-json').fill('this is not json');
  await expect(page.getByTestId('cd-parse-preview')).toContainText('parse error');
  await expect(page.getByTestId('cd-ingest')).toBeDisabled();
  const payload = { variants: [1, 2, 3, 4, 5].map(variant) };
  await page.getByTestId('cd-ingest-json').fill(JSON.stringify(payload));
  await expect(page.getByTestId('cd-parse-preview')).toContainText('5 variants parsed');
  await expect(page.getByTestId('cd-ingest')).toBeEnabled();
  await page.getByTestId('cd-ingest').click();

  // REQ-0164 C: fresh cards get the transient is-new highlight + a live tally
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('variant-1')).toHaveClass(/is-new/);
  await expect(page.getByTestId('cd-adjudicate-summary')).toContainText('5 variants');

  // 5 variants stored, each with an overall PASS chip + all four checks
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId('overall-' + n)).toHaveText('PASS', { timeout: 60000 });
    await expect(page.getByTestId('check-' + n + '-schema_vocab')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-engine_types')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-gen_data')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-integrate')).toBeVisible();
  }
  await expect(page.getByTestId('cd-adjudicate-summary')).toContainText('5 PASS');

  // advisory agent review on variant 1 (REQ-0164 F: draft controls open behind review-open-<no>)
  await page.getByTestId('review-open-1').click();
  await page.getByTestId('review-verdict-select-1').selectOption('recommend');
  await page.getByTestId('review-rationale-1').fill('cleanest range and valid sockets');
  await page.getByTestId('review-submit-1').click();
  await expect(page.getByTestId('review-verdict-1')).toHaveText('recommend');

  // REQ-0157: per-variant JSON viewer with copy
  await page.getByTestId('json-toggle-1').click();
  await expect(page.getByTestId('json-view-1')).toBeVisible();
  await expect(page.getByTestId('json-view-1')).toContainText('e2e_blade_v1');
  await expect(page.getByTestId('json-copy-1')).toBeVisible();

  // A/B diff via card picks (grammar shared with artadmin's compare); REQ-0164 C: Esc closes it
  await page.getByTestId('diff-pick-1').check();
  await page.getByTestId('diff-pick-2').check();
  await page.getByTestId('cd-diff-open').click();
  await expect(page.getByTestId('diff-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diff-view')).toHaveCount(0);

  // adopt variant 1 through the confirm dialog (PASS -> no override asked)
  await confirmClick(page, 'adopt-1');
  await expect(page.getByTestId('variant-adopted-1')).toBeVisible();
  await expect(page.getByTestId('delete-1')).toBeDisabled();
  await expect(page.getByTestId('cd-msg')).toContainText('exported');

  // public API serves the adopted DATA + meta (provenance + checks + review)
  const served = await request.get('/api/content/' + NAME);
  expect(served.status()).toBe(200);
  const body = await served.json();
  expect(body.data.id).toBe('e2e_blade_v1');
  const meta = await request.get('/api/content/' + NAME + '/meta');
  const metaBody = await meta.json();
  expect(metaBody.provenance.model).toBe('claude-opus-4.8');
  expect(metaBody.machine_check.overall).toBe('PASS');
  expect(metaBody.agent_review.verdict).toBe('recommend');

  // REQ-0157: one-click diff vs adopted (close via the diff-close button)
  await page.getByTestId('diff-adopted-2').click();
  await expect(page.getByTestId('diff-view')).toBeVisible();
  await expect(page.getByTestId('diff-view')).toContainText('(adopted)');
  await page.getByTestId('diff-close').click();
  await expect(page.getByTestId('diff-view')).toHaveCount(0);

  // delete a NON-adopted variant (2) -> confirm -> gone (variant_no not reused)
  await confirmClick(page, 'delete-2');
  await expect(page.getByTestId('variant-2')).toHaveCount(0);

  // edit variant 1 as a NEW variant: modal with JSON validity + Format.
  // REQ-0173: po_def now DEFAULTS to the structured Form tab once vocab loads;
  // this leg exercises the JSON editor, so switch to it first (wait for the
  // Form to have loaded to avoid the one-shot default-to-Form auto-switch).
  await page.getByTestId('edit-open-1').click();
  await expect(page.getByTestId('edit-form-rarity-1')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('edit-tab-json-1').click();
  await expect(page.getByTestId('edit-json-1')).toBeVisible();
  await page.getByTestId('edit-json-1').fill('{ this is broken json');
  await expect(page.getByTestId('edit-valid-1')).toContainText('invalid JSON');
  await expect(page.getByTestId('edit-submit-1')).toBeDisabled();
  const edited = JSON.parse(JSON.stringify(variant(1).data));
  edited.name = 'E2E Blade EDITED';
  await page.getByTestId('edit-json-1').fill(JSON.stringify(edited));
  await expect(page.getByTestId('edit-valid-1')).toContainText('valid JSON');
  await page.getByTestId('edit-format-1').click();
  expect(await page.getByTestId('edit-json-1').inputValue()).toContain('\n');
  await page.getByTestId('edit-submit-1').click();
  await expect(page.getByTestId('variant-6')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('variant-source-6')).toContainText('human_edit');

  // re-adopt the edited variant 6 (confirm dialog again)
  await confirmClick(page, 'adopt-6');
  await expect(page.getByTestId('variant-adopted-6')).toBeVisible();
  const served2 = await request.get('/api/content/' + NAME);
  const body2 = await served2.json();
  expect(body2.variant_no).toBe(6);

  // REQ-0157: re-run the four machine checks on an immutable variant
  await page.getByTestId('recheck-1').click();
  await expect(page.getByTestId('cd-msg')).toContainText('rechecked variant 1: overall PASS', { timeout: 60000 });
});

test('FAIL variant: rail warning dot; adopt demands the explicit override toggle', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_faildef', kind: 'po_def', brief: 'a deliberately broken blade', schema_ref: 'content/vocab.json' });
  const broken = variant(1);
  (broken.data.effects[0].verb as { t: string }).t = 'NOT_A_REAL_VERB';
  await apiIngest(request, 'e2e_faildef', [broken]);

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('cd-select-e2e_faildef')).toBeVisible();
  // the def browser flags the FAILed checks
  await expect(page.getByTestId('cd-faildot-e2e_faildef')).toBeVisible();

  await page.getByTestId('cd-select-e2e_faildef').click();
  await expect(page.getByTestId('overall-1')).toHaveText('FAIL', { timeout: 60000 });
  await expect(page.getByTestId('check-1-schema_vocab')).toContainText('x');

  // adopt: the confirm dialog BLOCKS until the override toggle is set
  await page.getByTestId('adopt-1').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-ok')).toBeDisabled();
  await expect(page.getByTestId('adopt-override')).toBeVisible();
  await page.getByTestId('adopt-override').check();
  await expect(page.getByTestId('confirm-ok')).toBeEnabled();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('variant-adopted-1')).toBeVisible();
  await expect(page.getByTestId('cd-msg')).toContainText('override');
  await expect(page.getByTestId('cd-msg')).toContainText('exported');

  // the rail now shows the adopted-variant badge
  await expect(page.getByTestId('cd-adopted-badge-e2e_faildef')).toContainText('v1');
});

test('def browser: search (name + brief) + kind/adoption filters narrow the list', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_blade', kind: 'po_def', brief: 'an assembled longsword blade', schema_ref: 'content/vocab.json' });
  await apiCreateDef(request, { system_name: 'e2e_potion', kind: 'si_def', brief: 'a red healing potion', schema_ref: 'content/vocab.json' });
  await apiIngest(request, 'e2e_blade', [variant(1)]);
  const adopt = await request.post('/api/content/defs/e2e_blade/adopt', { data: { variant_no: 1 } });
  expect(adopt.status()).toBe(200);

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('cd-select-e2e_blade')).toBeVisible();
  await expect(page.getByTestId('cd-select-e2e_potion')).toBeVisible();

  // substring search on system_name
  await page.getByTestId('cd-search').fill('potion');
  await expect(page.getByTestId('cd-select-e2e_blade')).toHaveCount(0);
  await expect(page.getByTestId('cd-select-e2e_potion')).toBeVisible();

  // substring search also matches the brief
  await page.getByTestId('cd-search').fill('longsword');
  await expect(page.getByTestId('cd-select-e2e_potion')).toHaveCount(0);
  await expect(page.getByTestId('cd-select-e2e_blade')).toBeVisible();
  await page.getByTestId('cd-search').fill('');

  // kind filter chips
  await page.getByTestId('cd-filter-kind-si_def').click();
  await expect(page.getByTestId('cd-select-e2e_blade')).toHaveCount(0);
  await expect(page.getByTestId('cd-select-e2e_potion')).toBeVisible();
  await page.getByTestId('cd-filter-kind-all').click();

  // adoption filter: e2e_blade adopted, e2e_potion not
  await page.getByTestId('cd-filter-adoption-adopted').click();
  await expect(page.getByTestId('cd-select-e2e_potion')).toHaveCount(0);
  await expect(page.getByTestId('cd-select-e2e_blade')).toBeVisible();
  await page.getByTestId('cd-filter-adoption-unadopted').click();
  await expect(page.getByTestId('cd-select-e2e_blade')).toHaveCount(0);
  await expect(page.getByTestId('cd-select-e2e_potion')).toBeVisible();
});

// REQ-0164 A: the page holds a stable full width -- opening the commission
// payload + a JSON panel + a diff must not push a page-level horizontal scroll
// at the >=1280px e2e viewport (1400px).
test('layout: no page-level horizontal scroll with payload + JSON + diff open', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_wide', kind: 'po_def', brief: 'width probe', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_wide', [variant(1), variant(2)]);

  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-select-e2e_wide').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  await page.getByTestId('cd-commission').click();
  await expect(page.getByTestId('cd-commission-out')).toBeVisible();
  await page.getByTestId('json-toggle-1').click();
  await expect(page.getByTestId('json-view-1')).toBeVisible();
  await page.getByTestId('diff-pick-1').check();
  await page.getByTestId('diff-pick-2').check();
  await page.getByTestId('cd-diff-open').click();
  await expect(page.getByTestId('diff-view')).toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// REQ-0164 B: the workflow strip collapses by default on an adopted def with
// variants (the common inspect case), stays expanded on a fresh/unadopted def,
// and the header toggle flips it.
test('workflow strip: collapsed by default on an adopted def; toggle expands; fresh def expanded', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_adopted', kind: 'po_def', brief: 'adopted def', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_adopted', [variant(1)]);
  const adopt = await request.post('/api/content/defs/e2e_adopted/adopt', { data: { variant_no: 1 } });
  expect(adopt.status()).toBe(200);
  await apiCreateDef(request, { system_name: 'e2e_fresh', kind: 'si_def', brief: 'fresh def', schema_ref: 'si/2' });

  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-select-e2e_adopted').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  // adopted -> collapsed: one-line summary shows, the commission step is hidden
  await expect(page.getByTestId('cd-flow-summary')).toBeVisible();
  await expect(page.getByTestId('cd-commission')).toHaveCount(0);
  // toggle expands
  await page.getByTestId('cd-flow-toggle').click();
  await expect(page.getByTestId('cd-commission')).toBeVisible();
  // switching to a fresh unadopted def -> expanded by default (manual toggle reset)
  await page.getByTestId('cd-select-e2e_fresh').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  await expect(page.getByTestId('cd-commission')).toBeVisible();
});

// REQ-0164 C: cd-msg clears on def switch (no more stale-sticky messages).
test('cd-msg clears on def switch', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_msg_a', kind: 'po_def', brief: 'a', schema_ref: 'po/2' });
  await apiCreateDef(request, { system_name: 'e2e_msg_b', kind: 'po_def', brief: 'b', schema_ref: 'po/2' });

  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-select-e2e_msg_a').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  await page.getByTestId('cd-commission').click();
  await expect(page.getByTestId('cd-msg')).toContainText('commission for');
  await page.getByTestId('cd-select-e2e_msg_b').click();
  await expect(page.getByTestId('cd-msg')).toHaveText('');
});

// REQ-0164 D: #/contentadmin/<system_name> deep link selects on load; selecting
// a def rewrites the hash via history.replaceState.
test('deep link: #/contentadmin/<name> selects on load; selecting rewrites the hash', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_link', kind: 'po_def', brief: 'deep link target', schema_ref: 'po/2' });
  await apiCreateDef(request, { system_name: 'e2e_other', kind: 'si_def', brief: 'other def', schema_ref: 'si/2' });

  await page.goto('/app/#/contentadmin/e2e_link');
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  await expect(page.getByTestId('cd-detail')).toContainText('e2e_link');
  await expect(page).toHaveURL(/#\/contentadmin\/e2e_link$/);

  await page.getByTestId('cd-select-e2e_other').click();
  await expect(page.getByTestId('cd-detail')).toContainText('e2e_other');
  await expect(page).toHaveURL(/#\/contentadmin\/e2e_other$/);
});

// REQ-0164 E: rail sort modes reorder the list client-side.
test('rail sort: created / name / activity reorder the list', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  // creation order (id ASC): alpha_def, zeta_def, mid_def
  await apiCreateDef(request, { system_name: 'alpha_def', kind: 'po_def', brief: 'a', schema_ref: 'po/2' });
  await apiCreateDef(request, { system_name: 'zeta_def', kind: 'po_def', brief: 'z', schema_ref: 'po/2' });
  await apiCreateDef(request, { system_name: 'mid_def', kind: 'po_def', brief: 'm', schema_ref: 'po/2' });
  // only mid_def has ingest activity -> most-recent last_variant_at
  await apiIngest(request, 'mid_def', [variant(1)]);

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('cd-select-mid_def')).toBeVisible();

  await page.getByTestId('cd-sort-created').click();
  expect(await railOrder(page)).toEqual(['alpha_def', 'zeta_def', 'mid_def']);
  await page.getByTestId('cd-sort-name').click();
  expect(await railOrder(page)).toEqual(['alpha_def', 'mid_def', 'zeta_def']);
  await page.getByTestId('cd-sort-activity').click();
  expect(await railOrder(page)).toEqual(['mid_def', 'alpha_def', 'zeta_def']);
});

// REQ-0164 E: a failing def list surfaces an explicit error panel instead of a
// silently empty rail (mocked 500 -- dev_mode never fails auth in the harness).
test('rail: list-failure shows the cd-list-error panel with the admin-token hint', async ({ page }) => {
  await page.route('**/api/content/defs', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom-token' }) }));

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('contentadmin')).toBeVisible();
  await expect(page.getByTestId('cd-list-error')).toBeVisible();
  await expect(page.getByTestId('cd-list-error')).toContainText('boom-token');
  await expect(page.getByTestId('cd-list-error')).toContainText('admin token required');
  await page.unroute('**/api/content/defs');
});

// REQ-0164 G: the create panel's schema_ref default follows the selected kind
// while the field is pristine; a user-typed value wins after that.
test('create panel: per-kind schema_ref default auto-swaps only while pristine', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-new').click();
  await expect(page.getByTestId('cd-create-panel')).toBeVisible();

  await expect(page.getByTestId('cd-schema-ref')).toHaveValue('po/2');
  await page.getByTestId('cd-kind').selectOption('monster_def');
  await expect(page.getByTestId('cd-schema-ref')).toHaveValue('enemy/1');
  await page.getByTestId('cd-kind').selectOption('skill_def');
  await expect(page.getByTestId('cd-schema-ref')).toHaveValue('skill/1');
  // once edited, a kind switch must not overwrite the operator's value
  await page.getByTestId('cd-schema-ref').fill('custom/ref');
  await page.getByTestId('cd-kind').selectOption('si_def');
  await expect(page.getByTestId('cd-schema-ref')).toHaveValue('custom/ref');
});

// REQ-0164 G: switching def with an unsaved brief/schema_ref draft raises the
// ConfirmDialog; Cancel keeps the selection, Discard proceeds.
test('dirty-draft guard: switching def with unsaved edits raises the discard confirm', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_dirty', kind: 'po_def', brief: 'orig brief', schema_ref: 'po/2' });
  await apiCreateDef(request, { system_name: 'e2e_clean', kind: 'po_def', brief: 'clean brief', schema_ref: 'po/2' });

  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-select-e2e_dirty').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();
  await page.getByTestId('cd-edit-brief').fill('edited but unsaved');
  await expect(page.getByTestId('cd-dirty')).toBeVisible();

  // Cancel keeps the current selection
  await page.getByTestId('cd-select-e2e_clean').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Discard unsaved changes to e2e_dirty');
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('cd-detail')).toContainText('e2e_dirty');

  // Discard proceeds to the new def
  await page.getByTestId('cd-select-e2e_clean').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('cd-detail')).toContainText('e2e_clean');
});

// REQ-0164 F: the card timestamp renders LOCAL time (the rendered text equals
// the local formatting of the raw-ISO title attr).
test('variant card: created renders local time with the raw ISO as its title', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_time', kind: 'po_def', brief: 't', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_time', [variant(1)]);

  await page.goto('/app/#/contentadmin');
  await page.getByTestId('cd-select-e2e_time').click();
  await expect(page.getByTestId('variant-1')).toBeVisible();

  const info = await page.getByTestId('variant-1').locator('.ca-created').evaluate((el) => {
    const iso = el.getAttribute('title') || '';
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    const local = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return { text: (el.textContent || '').trim(), iso, local };
  });
  expect(info.iso).toMatch(/T/); // raw ISO instant preserved in the title
  expect(info.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(info.text).toBe(info.local); // rendered == LOCAL formatting of the ISO
});

// ============================================================
// REQ-0173 (contentadmin-entity-rendering) coverage. EntityPreview renders
// variant.data as a game entity (name/rarity/shape/fallback), the structured
// edit form changes rarity + adds an effect while passing shape/icon through
// verbatim, JSON-only kinds gate the Form tab, the diff carries entity headers
// + changed-field chips, the adopt confirm carries the preview, and the rail
// art-facet thumb renders (placeholder branch). The #/artadmin/<name> deep
// link is covered in artadmin.spec.ts.
// ============================================================

// EntityPreview: an ingested po variant renders name + rarity + a shape grid.
test('entity preview: po variant renders EN name, rarity chip, and a shape grid', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_ep_po', kind: 'po_def', brief: 'entity preview po', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_ep_po', [variant(1)]);

  await page.goto('/app/#/contentadmin/e2e_ep_po');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  const ep = page.getByTestId('entity-preview-1');
  await expect(ep).toBeVisible();
  await expect(ep).toContainText('E2E Blade v1');
  await expect(ep).toContainText('Common');
  // the blade shape [[0,0],[1,0]] renders as a ShapeGrid (imported from Dex)
  await expect(ep.locator('.shape-grid')).toBeVisible();
  await expect(ep.locator('.shape-grid-cell-shape').first()).toBeVisible();
});

// EntityPreview: an si variant (no shape) still renders a shape grid via the
// synthetic [[0,0]] anchor cell (the Dex precedent).
test('entity preview: si variant falls back to the [[0,0]] anchor grid', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_ep_si', kind: 'si_def', brief: 'entity preview si', schema_ref: 'si/2' });
  await apiIngest(request, 'e2e_ep_si', [{
    data: { id: 'e2e_charm', name: 'E2E Charm', rarity: 'Uncommon', slot: 'trinket', icon: 'icon-blade', effects: [] },
    provenance: { source: 'llm', model: 'm', model_version: '1', prompt: 'p', params: {}, seed_if_any: null },
  }]);

  await page.goto('/app/#/contentadmin/e2e_ep_si');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  const ep = page.getByTestId('entity-preview-1');
  await expect(ep).toContainText('E2E Charm');
  await expect(ep).toContainText('slot: trinket');
  await expect(ep.locator('.shape-grid')).toBeVisible();
});

// EntityPreview: an unconsumed top-level field surfaces in the fallback grid.
test('entity preview: unconsumed top-level fields appear in the fallback key:value grid', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_ep_fb', kind: 'po_def', brief: 'fallback probe', schema_ref: 'po/2' });
  const v = JSON.parse(JSON.stringify(variant(1)));
  v.data.mystery_field = 'do_not_hide_me';
  await apiIngest(request, 'e2e_ep_fb', [v]);

  await page.goto('/app/#/contentadmin/e2e_ep_fb');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  const fb = page.getByTestId('entity-fallback-1');
  await expect(fb).toBeVisible();
  await expect(fb).toContainText('mystery_field');
  await expect(fb).toContainText('do_not_hide_me');
});

// Structured edit form: change rarity + add an effect on the Form tab; the JSON
// tab reflects it AND preserves shape/icon verbatim; the submitted human_edit
// variant carries the change + the passed-through fields.
test('edit form: change rarity + add effect; JSON tab + submitted variant preserve shape/icon passthrough', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_form', kind: 'po_def', brief: 'form edit', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_form', [variant(1)]);

  await page.goto('/app/#/contentadmin/e2e_form');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('edit-open-1').click();

  // Form tab is the default for po_def once vocab loads
  await expect(page.getByTestId('edit-form-rarity-1')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('edit-form-rarity-1').selectOption('Rare');
  await page.getByTestId('edit-form-effect-add-1').click();

  // JSON tab reflects the change AND keeps shape + icon verbatim
  await page.getByTestId('edit-tab-json-1').click();
  const json = await page.getByTestId('edit-json-1').inputValue();
  expect(json).toContain('"rarity": "Rare"');
  expect(json).toContain('"shape"');
  expect(json).toContain('icon-blade');
  const parsed = JSON.parse(json);
  expect(parsed.effects.length).toBe(2); // original + added
  expect(parsed.shape).toEqual([[0, 0], [1, 0]]); // passthrough, untouched

  await page.getByTestId('edit-submit-1').click();
  await expect(page.getByTestId('variant-2')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('variant-source-2')).toContainText('human_edit');
  // the new variant's own preview shows the new rarity + still a shape grid
  await expect(page.getByTestId('entity-preview-2')).toContainText('Rare');
  await expect(page.getByTestId('entity-preview-2').locator('.shape-grid')).toBeVisible();

  // server truth: the edited variant preserved shape + icon
  const meta = await request.get('/api/content/defs/e2e_form');
  const body = await meta.json();
  const v2 = body.variants.find((x: { variant_no: number }) => x.variant_no === 2);
  expect(v2.data.shape).toEqual([[0, 0], [1, 0]]);
  expect(v2.data.icon).toBe('icon-blade');
  expect(v2.data.rarity).toBe('Rare');
});

// JSON-only kinds: a monster_def variant opens on JSON with the Form tab disabled.
test('edit form: JSON-only kind (monster_def) disables the Form tab with a note', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_mon', kind: 'monster_def', brief: 'a slime', schema_ref: 'enemy/1' });
  await apiIngest(request, 'e2e_mon', [{
    data: { id: 'e2e_slime', name: 'E2E Slime', rarity: 'common', hp: [10, 20], skills: ['bite'] },
    provenance: { source: 'llm', model: 'm', model_version: '1', prompt: 'p', params: {}, seed_if_any: null },
  }]);

  await page.goto('/app/#/contentadmin/e2e_mon');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  // the entity preview renders monster fields (hp range chip + skills)
  await expect(page.getByTestId('entity-preview-1')).toContainText('hp [10–20]');
  await expect(page.getByTestId('entity-preview-1')).toContainText('bite');

  await page.getByTestId('edit-open-1').click();
  await expect(page.getByTestId('edit-tab-form-1')).toBeDisabled();
  await expect(page.getByTestId('edit-json-1')).toBeVisible();
  await expect(page.getByTestId('edit-form-note-1')).toBeVisible();
});

// Entity-level diff: side-by-side entity headers + a changed-fields summary.
test('diff: entity headers + changed-field chips above the line diff', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_diff', kind: 'po_def', brief: 'diff probe', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_diff', [variant(1), variant(2)]);

  await page.goto('/app/#/contentadmin/e2e_diff');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('diff-pick-1').check();
  await page.getByTestId('diff-pick-2').check();
  await page.getByTestId('cd-diff-open').click();

  await expect(page.getByTestId('diff-view')).toBeVisible();
  await expect(page.getByTestId('entity-preview-diff-a')).toBeVisible();
  await expect(page.getByTestId('entity-preview-diff-b')).toBeVisible();
  await expect(page.getByTestId('diff-fields-summary')).toBeVisible();
  // the two variants differ in id/name/effects -> chips list them
  await expect(page.getByTestId('diff-fields-summary')).toContainText('effects');
});

// Adopt confirm carries the compact entity preview (adoption is never sight-unseen).
test('adopt confirm: the dialog shows the compact entity preview', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await apiCreateDef(request, { system_name: 'e2e_adopt_ep', kind: 'po_def', brief: 'adopt preview', schema_ref: 'po/2' });
  await apiIngest(request, 'e2e_adopt_ep', [variant(1)]);

  await page.goto('/app/#/contentadmin/e2e_adopt_ep');
  await expect(page.getByTestId('variant-1')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('adopt-1').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('entity-preview-confirm')).toBeVisible();
  await expect(page.getByTestId('entity-preview-confirm')).toContainText('E2E Blade v1');
});

// Art-facet rail thumb: a def whose system_name also exists as an artwork row
// gets a rail thumb; with no adopted/ok render it shows the placeholder branch
// and the thumb + facet links deep-link to #/artadmin/<name>.
test('rail thumb: art-facet def shows the placeholder thumb deep-linking to the entity', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');
  await request.post('/api/art/dev/clear-all');
  // a render-less artwork row (cheap, no GPU) -> has_artwork_facet true, no thumb image
  const ar = await request.post('/api/art/artworks', { data: { system_name: 'e2e_faceted', kind: 'si', main_object: 'amulet' } });
  expect(ar.status()).toBe(201);
  await apiCreateDef(request, { system_name: 'e2e_faceted', kind: 'si_def', brief: 'has an art facet', schema_ref: 'si/2' });

  await page.goto('/app/#/contentadmin');
  const thumb = page.getByTestId('cd-thumb-e2e_faceted');
  await expect(thumb).toBeVisible({ timeout: 30000 });
  // placeholder branch: no <img>, deep-links to the artwork entity
  await expect(thumb.locator('img')).toHaveCount(0);
  await expect(thumb).toHaveAttribute('href', '#/artadmin/e2e_faceted');
  await expect(page.getByTestId('cd-facet-e2e_faceted')).toHaveAttribute('href', '#/artadmin/e2e_faceted');
});
