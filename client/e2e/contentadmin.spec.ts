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
// tools/e2e_run.sh (box lock) -- tools/content_admin_e2e.sh does exactly
// that.
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

  // step 1 -- commission (Q1/Q4): payload panel + ONE-CLICK COPY
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

  // 5 variants stored, each with an overall PASS chip + all four checks
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId('overall-' + n)).toHaveText('PASS', { timeout: 60000 });
    await expect(page.getByTestId('check-' + n + '-schema_vocab')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-engine_types')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-gen_data')).toBeVisible();
    await expect(page.getByTestId('check-' + n + '-integrate')).toBeVisible();
  }

  // advisory agent review on variant 1 (mandatory rationale)
  await page.getByTestId('review-verdict-select-1').selectOption('recommend');
  await page.getByTestId('review-rationale-1').fill('cleanest range and valid sockets');
  await page.getByTestId('review-submit-1').click();
  await expect(page.getByTestId('review-verdict-1')).toHaveText('recommend');

  // REQ-0157: per-variant JSON viewer with copy
  await page.getByTestId('json-toggle-1').click();
  await expect(page.getByTestId('json-view-1')).toBeVisible();
  await expect(page.getByTestId('json-view-1')).toContainText('e2e_blade_v1');
  await expect(page.getByTestId('json-copy-1')).toBeVisible();

  // A/B diff via card picks (grammar shared with artadmin's compare)
  await page.getByTestId('diff-pick-1').check();
  await page.getByTestId('diff-pick-2').check();
  await page.getByTestId('cd-diff-open').click();
  await expect(page.getByTestId('diff-view')).toBeVisible();
  await page.getByTestId('diff-close').click();

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

  // REQ-0157: one-click diff vs adopted
  await page.getByTestId('diff-adopted-2').click();
  await expect(page.getByTestId('diff-view')).toBeVisible();
  await expect(page.getByTestId('diff-view')).toContainText('(adopted)');
  await page.getByTestId('diff-close').click();

  // delete a NON-adopted variant (2) -> confirm -> gone (variant_no not reused)
  await confirmClick(page, 'delete-2');
  await expect(page.getByTestId('variant-2')).toHaveCount(0);

  // edit variant 1 as a NEW variant: modal with JSON validity + Format
  await page.getByTestId('edit-open-1').click();
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
