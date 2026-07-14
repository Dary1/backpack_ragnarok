# REQ-0157 — contentadmin-ux-overhaul: zero-base UX/feature overhaul of the content-data registry admin

**Ratified:** 2026-07-14 (user, chat) — continuation of the REQ-0156 mandate: "after the first
REQ's work, please continue with REQ-0155 likewise" (zero-base rethink of the page's role,
operation feel and features against industry norms). Scope (UI + small server extensions) and
merge+deploy carry the same user approval given for REQ-0156 the same day.
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable) from a survey
of REQ-0155's spec/implementation (master 19a8943) and the REQ-0156 overhaul as the design
sibling.

**Depends on / coordination:**
- REQ-0155 (content-data-registry-admin, built) — this REQ overhauls its UI surface and adds
  small additive API/storage extensions. Registry semantics (variant-as-record, immutability,
  machine checks, advisory review, adoption/export, Q1–Q4 rulings) are UNCHANGED.
- REQ-0156 (artadmin-ux-overhaul, built+deployed) — shared visual grammar (three-pane MJOLNIR
  console, confirm dialogs, toasts+aria-live msg, cross-links). Reuse its CSS section's
  patterns; extract shared admin CSS only where trivially safe.
- REQ-0120 Dex: LINK-FIRST integration stays (mutual links + badge only).

## Zero-base role statement (what this page IS)
A commissioning + adjudication desk for LLM-generated content data (the data facet of the
one-name-one-entity ledger):
1. **Define** content (kind, system_name, schema_ref, brief).
2. **Commission** N variants — the page produces a commission payload that a HUMAN carries to
   an agent session (Q1: no LLM key server-side), and receives the variants back
   (paste-and-ingest or direct agent POST).
3. **Adjudicate** — compare variants (JSON diff), read machine-check verdicts + advisory agent
   review, adopt exactly one (FAIL only via explicit override); human edit = NEW variant with
   lineage, never mutation.
4. **Browse** the def ledger; hop to the artwork facet (#/artadmin) and the Dex.

## Deficiencies being fixed (survey 2026-07-14, master 19a8943)
- Def list: flat text, no search, no kind/adoption filters, no counts, no facet/adoption badges.
- The commission→agent→ingest loop is the page's core workflow but is presented as a raw JSON
  dump + bare textarea: no one-click copy of the commission payload, no parse/count preview
  before ingest, no workflow legibility (what step am I in?).
- Variant JSON — the actual asset being judged — is invisible outside the A/B diff; no
  per-variant pretty-printed viewer, no copy, no "diff vs adopted" shortcut; diff A/B chosen
  via bare number dropdowns.
- Edit-as-new-variant is a plain textarea: no JSON validity feedback, no format button.
- Adopt override for FAIL variants uses window.confirm; delete has no confirm at all; one
  overloaded message line; create form doubles as shared state with selection (same
  accidental-create trap REQ-0156 removed from artadmin).
- Raw inline-styled HTML — ignores MJOLNIR entirely.
- Machine checks run once at ingest; when validators/vocab evolve there is no re-run seam
  (the artwork side has one via REQ-0152 re-inspect).

## Scope
### A. Server extensions (small, additive; NO schema migration)
- `storage_content.cjs listContentDefs()`: enrich rows with `variant_count`, `ok_count`,
  `failed_check_count` (variants whose machine_check.overall=FAIL), `adopted_variant_no`,
  `last_variant_at`, `has_artwork_facet` (cross-table read, same helper the detail uses).
- `routes/content.cjs`: `POST /api/content/defs/<name>/variants/<no>/recheck` (admin) —
  re-runs the four machine checks via content_checks and persists the annotation (the
  immutability trigger already permits machine_check updates). Response = the updated variant.
- Tests: aggregates correct; recheck refreshes a stale verdict (flip a broken→fixed def is
  impossible since data is immutable — test via a def whose check outcome changes when the
  validator inputs change, or simply assert recheck re-runs and rewrites machine_check with a
  fresh ran timestamp/equal verdict). content_test.cjs 13/13 and api_test.cjs 155/155 must
  stay green.

### B. Client overhaul (`client/src/contentadmin/` — split into components; keep export name
`ContentAdminPage` + `{ locale }` signature; admin stays EN-only)
Three-pane MJOLNIR console, visual grammar shared with the REQ-0156 artadmin:
1. LEFT def browser: search (system_name/brief substring), kind filter chips with counts
   (po_def/si_def/monster_def/unit_def/tm_def), adoption filter (all/adopted/unadopted),
   rows with kind chip, adopted-variant badge (e.g. "v3 ★"), variant count, FAIL-check warning
   dot, artwork-facet glyph linking to #/artadmin. Keep `data-testid` row/list contract
   (`content-select-<name>`, list container id as currently used by the e2e).
2. CENTER workspace for the selected def:
   - Header: name, kind chip, adopted state, schema_ref, links (artwork facet → #/artadmin,
     "view in Dex" as today).
   - Brief + schema_ref editable with dirty indicator + explicit Save (PATCH as today).
   - **Workflow strip** making the Q1 loop legible as numbered steps:
     (1) Commission N (per-kind default from gen_config) → payload panel with ONE-CLICK COPY
     (navigator.clipboard; fallback select-all) of the commission JSON;
     (2) Ingest box: textarea + live parse feedback ("5 variants parsed, kinds look sane" /
     first parse error with line) BEFORE the Ingest button enables; ingest result toast;
     (3) variants appear below with checks auto-run.
   - **Variant cards/table**: variant_no, source (llm / human_edit + parent lineage), created,
     machine-check overall chip + four named check chips (existing testid grammar preserved),
     agent-review chip with rationale (expand), per-variant actions: view JSON (collapsible
     pretty-printed, copy button), diff vs adopted (one click), select for A/B diff, adopt,
     delete (confirm dialog; disabled on adopted), edit-as-new (modal editor with JSON
     validity indicator + Format button), re-run checks (new endpoint).
   - **Diff view**: side-by-side pretty-printed line diff (keep the existing algorithm; restyle),
     A/B chosen via card checkboxes (grammar shared with artadmin's compare), sticky header
     naming the two variants + their verdict chips.
   - **Adopt flow**: confirm dialog (replaces window.confirm) summarizing the variant's checks
     + review; if overall FAIL, the dialog demands an explicit typed/toggled override and
     states the consequence ("data that cannot integrate — export may break consumers");
     result surfaces export success/warning explicitly.
3. Feedback: toasts + persistent aria-live `data-testid` message element (keep the substring
   assertions the e2e makes). Cross-link header to #/artadmin (mirror of REQ-0156's link).

### C. Contract preservation
- All REQ-0155 semantics untouched: immutability, variant_no monotonicity, provenance
  validation, FAIL-adopt override REQUIRED, advisory review never binding, export on adoption,
  Dex link-first.
- e2e contentadmin.spec.ts testids preserved where flows are unchanged; where changed
  (create panel, confirm dialogs, copy/ingest strip), the spec is UPDATED in the same commit
  and the delta documented in the log.

## Out of scope
- Batch orchestrator loop / reviewer surface (future REQ); server-side LLM backend; Dex
  component sharing; schema migrations; artwork side (REQ-0156 owns it); def deletion/rename.

## Gates
- G1 build+types: client tsc+vite green; server tests green (content_test 13/13 + new
  aggregate/recheck tests; api_test 155/155 both backends; artwork_test 6/6 unaffected).
- G2 e2e: updated contentadmin.spec.ts green via tools/content_admin_e2e.sh — full flow:
  create def (panel) → commission (copy payload present) → paste+parse preview → ingest 5 →
  checks chips → review → per-variant JSON view → diff (incl. vs adopted) → adopt (confirm) →
  serve → FAIL-variant adopt demands override → edit→new variant → re-adopt → delete rules →
  recheck endpoint exercised → search/filter narrows the list.
- G3 hygiene: no variant data under content/ in the diff; no PNG/lockfile/dist commits; pnpm
  only.
- S7 user acceptance on the live deployed screen (approval carried from the 2026-07-14 chat;
  the actual master merge + service restart is the orchestrator's step).

## Risks
- Clipboard API needs a secure context — backpack-dev is HTTPS, fine; keep a select-all
  fallback for odd contexts.
- Recheck on immutable data usually reproduces the same verdict; its value arrives when
  validators/vocab move — cheap to keep, tested at the API level.

## Implementation log
### Session 2026-07-14 (implementing engineer, worktree req-0157-contentadmin-ux-overhaul)

**Architecture decisions**
- Server stays a SMALL additive extension (no migration, chokepoint intact).
  `storage_content.cjs listContentDefs()` computes the per-def aggregates in
  ONE SQL round-trip (the exact mirror of REQ-0156's listArtworks): LEFT JOIN
  on the adopted variant for `adopted_variant_no` + LEFT JOIN LATERAL
  count/filter aggregate (`variant_count`, `ok_count` on status='ok',
  `failed_check_count` on machine_check->>'overall'='FAIL',
  `last_variant_at`) + an EXISTS subquery on artworks for
  `has_artwork_facet` -- the same cross-table read artworkFacetExists() does,
  folded into the query (both tables carry the namespaced system_name).
  REQ-0155 row shape preserved; every existing caller untouched.
- `routes/content.cjs`: POST /api/content/defs/<name>/variants/<no>/recheck
  (item_admin gate, same handler/regex style as the file). The core is
  extracted as recheckVariant() (exported `_recheckVariant` for the test):
  re-runs content_checks.runChecks on the immutable variant's data and
  persists via storage.setVariantMachineCheck -- the exact annotation path
  ingest uses, which the DB immutability trigger permits (asset-of-record
  untouched). Missing def/variant -> NOT_FOUND -> 404.
- Client split into components mirroring artadmin (REQ-0156):
  `contentShared.ts` (RESERVED-name mirror + live create validation, the
  REQ-0155 positional line-diff algorithm kept VERBATIM as diffRows(),
  parseIngest() powering the live parse preview, copyText() with a
  navigator.clipboard -> select-all-textarea fallback, lineage/format
  helpers), `DefRail` (search over system_name+brief, kind chips with
  counts, adoption filter, rows with kind chip / variant count / FAIL
  warning dot / "vN <star>" adopted badge / artwork-facet glyph ->
  #/artadmin), `CreatePanel` (dedicated create flow whose state is NEVER fed
  by selection), `Workspace` (header + brief/schema_ref draft with dirty
  chip + explicit Save + facet/Dex links, the numbered workflow strip, the
  variant list, the diff mount), `VariantCard`, `DiffView` (side-by-side,
  sticky header naming both variants + verdict chips). The root
  `ContentAdminPage` owns all server state + polling (def list 10 s,
  selected detail 5 s -- agent sessions may POST variants at any moment) and
  the safety rails (confirm dialogs, edit modal, toasts + the persistent
  aria-live cd-msg line). Export name + `{ locale }` signature preserved
  (EN-only surface).
- Workflow strip = the Q1 loop as numbered steps: (1) Commission N (default
  from gen_config.generate_n, else the per-kind 5) -> the FULL commission
  JSON in a payload panel with ONE-CLICK COPY; (2) Ingest textarea whose
  live PARSE PREVIEW ("5 variants parsed, data + provenance present" /
  first parse or shape error) GATES the Ingest button (accepts a bare
  array, {variants:[...]} or a single {data,provenance}; flags missing
  provenance); (3) adjudicate on the cards below (checks auto-run
  server-side on ingest, unchanged).
- Adopt confirm dialog replaces window.confirm: summarizes the overall +
  four check chips + the advisory review (rationale inline); when
  overall=FAIL the OK button stays DISABLED until the explicit
  adopt-override toggle is set, beside the consequence warning ("data that
  could not integrate -- the export may break consumers"). Export
  success/warning surfaces explicitly ("+ exported" / "(export warning:
  ...)") in the message + toast. Delete gets its own confirm (no-backup /
  variant_no-never-reused note); edit-as-new is a modal with live JSON
  validity indicator + Format button, submit disabled while invalid.
- Diff: A/B picked via per-card checkboxes (artadmin compare grammar) +
  one-click "Diff vs adopted" per card; the line-diff algorithm untouched,
  restyled side-by-side with changed lines tinted per side.
- CSS: marked `/* REQ-0157 contentadmin */` section appended to
  client/src/index.css, MJOLNIR tokens only. SHARED-PRIMITIVE decision:
  instead of physically moving rules into a third block (cascade-order
  risk), contentadmin's markup reuses the aa-* utility classes of the
  REQ-0156 section VERBATIM (rail/rows/filters, inputs, sm/xs buttons, form
  fields, adopt badge, verdict pills, scrim/confirm, toasts) -- one source,
  zero duplication -- and the REQ-0157 section holds ONLY page-specific
  ca-* classes (layout, the 5 content-kind palette entries, workflow strip,
  variant cards, diff, override, edit modal). The REQ-0156 section is
  byte-untouched, so artadmin stays pixel-identical by construction; its
  e2e was re-run green as the behavioural proof.

**Gate results (all machine gates GREEN)**
- [x] G1 build+types: client `pnpm exec tsc -b` + `pnpm run build` EXIT 0;
  server checkJs typecheck (tsconfig.server.json) EXIT 0; content_test.cjs
  13/13 (pg); NEW contentagg_test.cjs 4/4 (pg; wired into ci.sh as
  [5.35/7]); api_test.cjs 155/155 (files) AND 155/155 (pg);
  artwork_test.cjs 6/6 (pg).
- [x] G2 e2e: client/e2e/contentadmin.spec.ts 3/3 PASSED in 11.0 s via
  tools/content_admin_e2e.sh (TMPHOME-namespaced pg instance, ports
  8921/8922/8923, box lock through tools/e2e_run.sh):
  (1) create via cd-new panel -> commission (payload contains "Generate 5",
  one-click copy -> msg 'copied') -> garbage paste shows 'parse error' with
  Ingest DISABLED -> valid paste shows '5 variants parsed' -> ingest ->
  5x overall PASS + all four named check chips -> review recorded ->
  per-variant JSON viewer (+ copy) -> A/B diff via card picks -> adopt v1
  through the confirm dialog -> serve + /meta -> one-click diff-vs-adopted
  (header names '(adopted)') -> confirm-delete v2 -> edit modal (invalid
  JSON flagged + submit disabled, Format pretty-prints) -> human_edit v6 ->
  re-adopt v6 -> served variant_no 6 -> recheck v1 (msg 'rechecked variant
  1: overall PASS');
  (2) FAIL variant: rail FAIL dot visible; adopt dialog BLOCKS (confirm-ok
  disabled) until adopt-override is toggled; override adoption exports and
  the rail shows the v1 adopted badge;
  (3) search narrows by system_name AND brief substring; kind chips +
  adoption filters narrow the list.
  ZERO-REGRESSION PROOF (shared CSS): tools/artadmin_e2e.sh re-run ->
  artadmin.spec.ts 3/3 in 33.0 s.
- [x] G3 hygiene: no variant data under content/ in the diff; no
  PNG/lockfile/dist commits (web/ rebuilt for the e2e serves, then restored
  via git checkout + git clean); pnpm only; `git diff master...HEAD --stat`
  = exactly the intended 16 files (master itself moved ahead with the
  REQ-0057 merge during this session -- merge-base diff is the honest one).
- [ ] S7 user acceptance on the live deployed screen -- orchestrator owns
  merge + deploy (approval carried from the 2026-07-14 chat).

**e2e testid delta (spec C, documented in the same commit)**
- PRESERVED: contentadmin, cd-msg (+ its asserted substrings 'exported'
  etc.), cd-list, cd-select-<name>, cd-detail, cd-kind / cd-system-name /
  cd-schema-ref / cd-brief / cd-create (now on the cd-new panel),
  cd-gen-n, cd-commission, cd-commission-out (still contains "Generate 5"),
  cd-ingest-json, cd-ingest, variant-<no>, variant-adopted-<no>,
  variant-source-<no>, checks-<no>, overall-<no>, check-<no>-<name>,
  check-detail-<no>-<name>, review-<no>, review-verdict-<no>,
  review-verdict-select-<no>, review-rationale-<no>, review-submit-<no>,
  adopt-<no>, delete-<no>, edit-open-<no>, edit-json-<no>,
  edit-submit-<no>, cd-artwork-facet, cd-dex-link, cd-artadmin-link,
  diff-view.
- REPLACED: diff-a/diff-b number dropdowns -> per-card diff-pick-<no>
  checkboxes + cd-diff-open (artadmin compare grammar).
- CHANGED FLOW: adopt/delete now confirm-gated (confirm-dialog /
  confirm-ok / confirm-cancel; FAIL adopt adds the adopt-override toggle);
  create opens via cd-new.
- NEW: cd-search, cd-filter-kind-<k|all>, cd-filter-adoption-<f>,
  cd-faildot-<name>, cd-adopted-badge-<name>, cd-facet-<name>, cd-new,
  cd-create-panel, cd-create-close, cd-create-error, cd-edit-brief,
  cd-edit-schema-ref, cd-save, cd-dirty, cd-adopted-state,
  cd-artadmin-goto, cd-copy-commission, cd-parse-preview, cd-diff-open,
  diff-close, diff-adopted-<no>, json-toggle-<no>, json-view-<no>,
  json-copy-<no>, recheck-<no>, review-rationale-full-<no>,
  edit-valid-<no>, edit-format-<no>, edit-close.

**Test evidence**
- server/tests/contentagg_test.cjs: 4 passed / 0 failed (aggregates incl.
  status-vs-check-count orthogonality + adopted_variant_no + facet
  cross-read; empty-def zeros/nulls + REQ-0155 shape preservation; recheck
  rewrites a stale synthetic FAIL to a fresh PASS with all four checks and
  a newer ran_at while id/data_sha256/variant_no stay identical; recheck
  NOT_FOUND for missing def/variant).
- server/tests/content_test.cjs 13/13; api_test.cjs 155/155 (files) +
  155/155 (pg); artwork_test.cjs 6/6.
- e2e: contentadmin.spec.ts 3 passed (11.0 s); artadmin.spec.ts 3 passed
  (33.0 s, regression re-run).

**Commits (branch req-0157-contentadmin-ux-overhaul)**
- 8439be8 server: listContentDefs aggregates + recheck endpoint;
  contentagg_test 4/4 wired into ci.sh [5.35/7]
- b6ccca4 client: MJOLNIR console overhaul (def browser / workflow strip /
  variant cards / diff / confirm+override / edit modal / toasts)
- ad51e1f e2e: updated spec + added coverage; clipboard permissions in the
  isolated config
- (this commit) REQ log

**Deviations / notes**
- `ok_count` counts variants with status='ok' (the status column), NOT
  check-PASSes: `failed_check_count` already carries the machine-check
  signal, and this keeps the two aggregates orthogonal -- the same
  ok/failed grammar as REQ-0156's render counts. (The spec named both
  fields without pinning ok_count's semantics; documented reading.)
- The commission payload panel now renders the FULL commission JSON (not
  just the instructions string) -- that is what the human actually carries
  to the agent session; the instructions are embedded so the existing
  "Generate 5" e2e assertion is unchanged.
- contentadmin.config.ts grants clipboard-read/write so the e2e exercises
  the primary navigator.clipboard path; the select-all fallback stays in
  copyText() for odd/insecure contexts (spec risk note).
- The per-card review draft controls (REQ-0155 testids) are KEPT even
  though reviews normally arrive via the API -- removing them would break
  the review e2e contract for no UX gain.
- contentagg_test writes machine_check JSONB synthetically for the COUNT
  assertions (aggregates only read persisted JSONB; the real runner is
  covered by content_test G2 and by the recheck test, which runs the four
  validators for real).

### Session 2026-07-14c (backfill, user ruling 全kind)

Follow-up session under the user ruling 2026-07-14 ("全kindバックフィル" -- the mirror of
REQ-0151's artwork ruling 3: all content in one ledger from day one): the EXISTING live game
content is imported into the content-data registry, one def + one adopted variant_no-1 row per
live entry, so the ledger reflects what the game actually serves. Executed via a re-runnable
idempotent tool against the LIVE namespace (the same one holding the real artwork registry).

**Tooling**
- `tools/backfill_content_registry.cjs` -- inventories the four live corpus files and writes,
  per entry, ONE `content_defs` row + ONE `content_variants` row (variant_no 1, the entry JSON
  VERBATIM -- no reshaping; Postgres JSONB canonicalizes key ORDER, values proven identical),
  then adopts it -- ALL through server/storage.cjs (contentStore re-exports; the tool opens no
  DB itself). `--dry-run` prints the inventory without requiring storage at all.
- `system_name` = the entry's bare `id` (shared namespace with artworks BY DESIGN: a matching
  artwork is the art facet of the same entity, not a collision).
- `schema_ref` = the source file's own schema header ("po/2" / "si/2" / "tm/1" / "enemy/1") --
  the file header is the canonical schema statement for these entries; the UI's create-default
  'content/vocab.json' is a placeholder, not canon. content_checks.loadVocab() cannot resolve
  "po/2" as a path, so the schema_vocab check falls back to content/vocab.json and
  machine_check.schema_ref records the vocab actually validated against, while the def keeps
  the source-file truth (documented, intended).
- `provenance` = `{ source:'backfill', origin_file, origin_schema, batch (only enemies.json
  carries one: batch-002-dungeon-pilot), imported_at, note:'live asset of record imported
  under the 2026-07-14 全kind backfill ruling; no regeneration guarantee' }`. The receiving
  API's provenance validation (llm|human_edit only) deliberately does NOT apply -- that is a
  routes-layer contract for new commissions; the tool goes through the storage chokepoint,
  and 'backfill' is the honest source (same posture as the artwork backfill's params.backfill).
- Adoption via storage.adoptVariant directly, which only sets adopted_variant_id -- the export
  step lives in the ROUTES layer (routes/content.cjs adopt handler -> content_export), so NO
  export fired (verified: the only file under content/registry_exports/ predates the run).
  Intended: content/live is the SOURCE of this backfill; re-exporting it would be circular.
- Machine checks: the REAL four checks (content_checks.runChecks) ran on every created variant
  and persisted via storage.setVariantMachineCheck (the ingest annotation path). A FAIL never
  blocks backfill or adoption -- these entries are live by definition.
- `server/tests/backfill_content_registry_test.cjs` -- DB-free unit tests (8/8) of the
  deterministic mapping (file entry -> def/variant rows, kind mapping, provenance shape incl.
  batch-only-when-present, verbatim/no-mutation, cross-file duplicate-name refusal, INSERT-ONLY
  skip guards, skip-list completeness). Wired into tools/ci.sh as DB-free step [4.65/7].

**Counts written to the live Postgres (STORAGE_BACKEND=pg, the env the api uses)**
- **defs: 22   variants: 22   adopted: 22** (every def adopted at variant_no 1)
  - po_def       8  <- content/live/live_items.json (po/2)
  - si_def       6  <- content/live/live_sis.json (si/2)
  - tm_def       1  <- content/live/live_tms.json (tm/1)
  - monster_def  7  <- content/live/dungeon/enemies.json (enemy/1, batch-002-dungeon-pilot)
  - unit_def     0  <- NO unit data defs exist yet (REQ-0130 is provisional; units are not
    per-entity data defs today) -- zero by design, recorded rather than omitted.

**Machine-check verdicts (honest; the model has no WARN state -- overall is PASS|FAIL)**
- po_def PASS 8/8, si_def PASS 6/6, tm_def PASS 1/1, monster_def FAIL 7/7.
- Per-check (ok/fail/not-applicable): schema_vocab 15/7/0, engine_types 15/7/0,
  gen_data 22/0/0, integrate 14/0/8 (not applicable for tm/monster -- no canvas placement).
- The 7 monster FAILs are the validators speaking honestly about the enemy/1 dialect, not data
  corruption: schema_vocab flags `rarity: common` (enemy/1 uses lowercase vs vocab.rarities
  Common/Uncommon/Rare/Relic) and engine_types flags `hp must be numeric` (enemy/1 hp is a
  [lo,hi] range array). The game serves these entries as-is; they were adopted regardless
  (live-by-definition), with the FAIL verdicts persisted for the admin to see. Reconciling the
  enemy/1 dialect with the check vocabulary is future validator work, not a data fix.

**Mapping/skip decisions**
- Backfilled: exactly the four files above (the sanctioned 2026-07-14 inventory: 22 defs / 22
  variants).
- Skipped, not per-entity content of a registry kind: content/live/dungeon/entities.json
  (entity/1 interactables), formations.json (formation/1 encounter layouts -- composition
  data), dungeon.json (dungeon graph/config singleton), content/live/scenario.json
  (progression singleton, no schema header), content/live/seasons.json (season schedule
  singleton).
- Skipped, no registry kind exists: content/live/dungeon/skills.json (skill/1, 14 entries) --
  "skill" is not in the content_kind ENUM; needs its own ruling + kind before it can enter the
  ledger.
- Flagged OPEN: content/live/dungeon/items.json (po/2, 2 entries, dungeon-mode batch) -- real
  po-shaped live data but OUTSIDE the sanctioned inventory (the ruling names live_items.json
  as the po_def source, 8 entries); left out rather than silently widening a live-DB write.
  Needs a follow-up ruling.

**Idempotency + safety proof (INSERT-ONLY against the live namespace)**
- Dry-run inventory matched the sanctioned counts exactly (22/22) before any write.
- Second real run: **0 defs / 0 variants created, 0 adoptions repaired, 22 already adopted** --
  keyed by system_name + (content_id, variant_no); checks are re-run ONLY on rows created in
  the same pass, so a no-op pass rewrites nothing.
- The tool never deletes/updates pre-existing rows: the only write-to-existing seam is
  adoption-repair on a def a PREVIOUS run of this tool provably created (brief marker +
  variant-1 provenance.source='backfill' with matching origin_file) that is still UNADOPTED;
  an existing adoption is never changed, and a foreign def/variant is skipped LOUDLY (0
  foreign encountered this run).
- Artwork registry untouched: /api/art/artworks still lists 56 artworks / 30 adopted after
  both runs.

**Verification**
- GET /api/content/defs: 22 defs, kinds {po_def:8, si_def:6, tm_def:1, monster_def:7}, every
  def adopted_variant_no=1, aggregates populated (variant_count=1; failed_check_count=1 for
  exactly the 7 monsters).
- Served-data proof: GET /api/content/<name> deep-equals the live file entry for ALL 22
  (values identical; JSONB key order is not preserved, by design of the store).
- /api/content/frost_gnoll/meta carries provenance.batch=batch-002-dungeon-pilot + the honest
  FAIL detail; /api/content/blade/meta carries the full backfill provenance.
- backfill_content_registry_test.cjs 8/8; backfill_registry_test.cjs 10/10 and server
  typecheck (tsconfig.server.json) stay green.

**Commits (branch req-0157-contentadmin-ux-overhaul)**
- 39bd851 backfill tool + DB-free mapping/skip-rule tests (8/8) + ci.sh [4.65/7]
- (this commit) REQ log: Session 2026-07-14c -- counts, verdict tallies, skip decisions,
  idempotency proof

## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed. Contentagg pg gates green this pass. contentadmin default-suite e2e 403 is BY DESIGN; gated via tools/content_admin_e2e.sh.
- **Disposition**: STAYS in built/ -- open "[ ] S7 user acceptance on the live deployed screen".
