// client/e2e/contentadmin.spec.ts -- REQ-0155 gate G4.
// Full content-data-registry flow through the REAL browser UI with a MOCKED
// LLM (no API cost): the test itself constructs the 5 variants and POSTs them
// through the UI's receiving box -- no LLM is ever called. Flow: create
// content -> ingest 5 variants -> machine checks auto-run (chips) -> advisory
// agent review recorded -> diff view -> adopt -> public API serves the adopted
// data + /meta -> export fires -> edit creates a NEW variant -> re-adopt.
// Requires an isolated pg-backed instance of THIS worktree (see
// tools/content_admin_e2e.sh). dev_mode makes the item_admin gate accept the
// no-token dev fallback. Run ONLY via tools/e2e_run.sh (box lock).
import { test, expect } from '@playwright/test';

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

test('content admin: create -> 5 variants + checks -> review -> diff -> adopt -> serve -> export -> edit -> re-adopt', async ({ page, request }) => {
  await request.post('/api/content/dev/clear-all');

  await page.goto('/app/#/contentadmin');
  await expect(page.getByTestId('contentadmin')).toBeVisible();

  // create a po_def content
  await page.getByTestId('cd-kind').selectOption('po_def');
  await page.getByTestId('cd-system-name').fill(NAME);
  await page.getByTestId('cd-brief').fill('an assembled longsword blade PO');
  await page.getByTestId('cd-create').click();
  await expect(page.getByTestId('cd-detail')).toBeVisible();

  // commission (Q1/Q4): produces the agent-session instructions, N default 5
  await page.getByTestId('cd-commission').click();
  await expect(page.getByTestId('cd-commission-out')).toContainText('Generate 5');

  // MOCK LLM: ingest the 5 variants through the receiving box (the API an
  // agent session POSTs to). Machine checks auto-run on ingest.
  const payload = { variants: [1, 2, 3, 4, 5].map(variant) };
  await page.getByTestId('cd-ingest-json').fill(JSON.stringify(payload));
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

  // JSON diff view between variants 1 and 2
  await page.getByTestId('diff-a').selectOption('1');
  await page.getByTestId('diff-b').selectOption('2');
  await expect(page.getByTestId('diff-view')).toBeVisible();

  // adopt variant 1 -> export fires, delete disabled on adopted
  await page.getByTestId('adopt-1').click();
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

  // edit variant 1 as a NEW variant (immutability) -> variant 6
  await page.getByTestId('edit-open-1').click();
  const edited = JSON.parse(JSON.stringify(variant(1).data));
  edited.name = 'E2E Blade EDITED';
  await page.getByTestId('edit-json-1').fill(JSON.stringify(edited, null, 1));
  await page.getByTestId('edit-submit-1').click();
  await expect(page.getByTestId('variant-6')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('variant-source-6')).toContainText('human_edit');

  // re-adopt the edited variant 6
  await page.getByTestId('adopt-6').click();
  await expect(page.getByTestId('variant-adopted-6')).toBeVisible();
  const served2 = await request.get('/api/content/' + NAME);
  const body2 = await served2.json();
  expect(body2.variant_no).toBe(6);
});
