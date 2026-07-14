# REQ-0155 — content-data-registry-admin: variant-managed content data (non-visual) in the same WebUI

**Ratified:** 2026-07-13 (user, chat) — including rulings on Q1–Q4 below. Queued behind
REQ-0151 implementation; the REQ folder is the sole status record.
**Requested by:** user, 2026-07-13 (chat): extend the adoption-verification WebUI beyond items
("currently only items, in the Dex — make it serious and integrate so the same mechanism is
reused"), and manage LLM-generated content DATA the way artwork seeds are managed. Artwork is
assumed already adopted; this REQ is about the non-visual data.

**Determinism ruling (answers the user's question, 2026-07-13).** LLMs cannot be relied on for
seed-reproducibility: hosted APIs do not guarantee bit-stable outputs even at temperature 0
(batching effects, floating-point non-associativity, silent model updates; the Anthropic API
exposes no seed parameter; providers that expose one treat it as best-effort). Local inference
can be made deterministic only by pinning build+hardware+seed, which we do not want to own.
Therefore this REQ adopts the user's fallback as the design: **variant-as-record** — the LLM
generates N=5 variants; `variant_no` plays the seed's role as a stable handle; the STORED data
is the asset of record; full provenance (model id/version, exact prompt, sampling params, seed
if any) is kept as the recipe with NO regeneration guarantee. This is the same doctrine as
REQ-0151 ruling 4 (recipe vs asset-of-record), so artwork and data unify cleanly.

**Depends on / coordination:**
- REQ-0151 (artwork-registry-admin): admin shell, Postgres-behind-storage.cjs pattern, adoption
  UX, export hooks. This REQ extends that admin with a content-data surface.
- REQ-0120 (dex-master-detail-split, built): the existing Dex is the browse surface to
  integrate, not fork.
- REQ-0154: documents this pipeline; REQ-0133 (item raster live wiring, draft): its concern
  becomes this REQ's export contract — coordinate.
- Future batch orchestrator REQ drives this per-content flow in a loop; this REQ exposes the
  hooks, not the loop.

## Decision / Goal
One mechanism for ALL adoption-verified content: for each content (kind + system_name), hold N
generated data variants, machine-check them, record an advisory agent review, let the USER adopt
exactly one, and serve/export the adopted variant — identical in shape to the artwork registry.

## Data model (Postgres, server/migrations/, ALL access via server/storage.cjs)
`content_defs`
- `id`, `system_name` TEXT UNIQUE NOT NULL (shared namespace with `artworks.system_name` —
  one name = one game entity; its artwork and its data are two facets)
- `kind` ENUM(po_def | si_def | monster_def | unit_def | tm_def | …) — extensible per vocab
- `brief` TEXT — the user/LLM commission text (what this content should be)
- `schema_ref` TEXT — which vocab/schema the data must satisfy (vocab v3 tree)
- `adopted_variant_id` FK NULL, timestamps

`content_variants`
- `id`, `content_id` FK, `variant_no` INT auto-increment per content (the "seed");
  UNIQUE(content_id, variant_no); never renumbered
- `data` JSONB — the generated content definition itself (asset of record)
- `data_sha256`
- `provenance` JSONB — `{source: llm|human_edit, model, model_version, prompt, params,
  seed_if_any, parent_variant_id?}` — recipe, best-effort, no regeneration guarantee
- `machine_check` JSONB — validator results (see § Machine checks): per-check name/ok/detail
  + overall PASS/FAIL
- `agent_review` JSONB NULL — `{agent, model, verdict: recommend|neutral|concern, rationale}` —
  ADVISORY ONLY, never binding
- `status` (ok|failed), `created_at`
- Constraints: adopted variant undeletable (storage.cjs + API, same as renders);
  **variants are immutable** — a human edit in the UI creates a NEW variant with
  `provenance.source=human_edit` + `parent_variant_id`, it never mutates in place.

## Generation (LLM ×5)
- "Generate 5" produces 5 variants against `schema_ref` from `brief` + kind context (vocab v3).
  Distinct variants come from explicit variation instructions per slot (not from seed roulette —
  see determinism ruling), so the 5 are meaningfully different, not near-duplicates.
- LLM backend (Q1, user-ruled 2026-07-13): **agent-session driven** — the user commissions an
  agent session (Cowork/Claude Code), which generates the 5 variants and POSTs them to a
  receiving admin API (auth per admin.cjs conventions) with full provenance. NO LLM API key on
  the server. The receiving API is generic, so a server-side backend could be added later
  under its own REQ; none is built here.

## Machine checks (existing validators, wired per kind)
Run automatically on every variant, results into `machine_check`:
- schema/vocab validity — `self_test_vocab.cjs` conventions against `schema_ref`
- engine-type conformance — `check_engine_types.cjs`
- generation-path validity — `tool_gen_data.cjs` conventions
- integration dry-run — `tool_integrate.cjs` in a no-write mode (must not touch content/live)
A variant failing machine checks is adoptable ONLY behind an explicit override confirm (the
inspection doctrine is advisory, but data that cannot integrate should be loudly marked).

## Agent review (advisory)
A SEPARATE agent (different session; **Opus-class by default**, user-ruled Q2) reads the 5
variants + machine checks and records `agent_review` per variant with a recommendation and a
mandatory rationale. It never adopts.
Displayed as chips next to the user's adoption controls — same UX grammar as REQ-0152 kit
verdicts.

## Adoption + serving (hybrid, same as artwork)
- User adopts exactly one variant per content (switchable; history immutable).
- `GET /api/content/<system_name>` → adopted data; `/meta` → provenance + checks + review.
- On adoption change: export via `tool_integrate` conventions into content/live on a branch —
  existing consumers unchanged. DB is the single source of truth.

## UI (extends the REQ-0151 admin; integrates the Dex)
Content tab: kind + system_name list → detail: brief, variant table (variant_no, machine-check
chips, agent-review chip, created, source), JSON diff view between any two variants, adopt
button, edit-as-new-variant editor, "generate N more" (N default 5, per-kind configurable —
user-ruled Q4). Dex (REQ-0120 master/detail) integration is LINK-FIRST (user-ruled Q3):
mutual links + adoption-state badge only; component sharing deferred to a follow-up.
Browse stays Dex, verify+adopt lives here — never forked.

## Gates
- G1 chokepoint + migration + constraints: immutability (UPDATE refused), adopted-undeletable,
  UNIQUE(content_id, variant_no), human_edit lineage recorded.
- G2 validator wiring: a known-good def PASSes; a deliberately broken def FAILs with the right
  check named; integrate dry-run provably writes nothing.
- G3 provenance completeness: every variant row carries model/prompt/params; human edits carry
  parent lineage.
- G4 e2e (mocked LLM, no API cost in CI): create content → 5 variants stored → checks run →
  agent review recorded → diff view → adopt → API serves → export fires → edit creates new
  variant → re-adopt.
- G5 hygiene: no variant data under content/ except the exported adopted set; DB only.
- S7 user acceptance on real content (one PO, one monster, one unit def batch).

## Out of scope
- The batch orchestrator loop + reviewer surface (future REQ; this REQ exposes per-content
  hooks).
- Artwork (REQ-0151 owns it); inspection kits (REQ-0152).
- Retiring the Dex (it remains the browse surface).

## Risks
- Prompt/vocab drift between waves — `schema_ref` pins each variant to the schema version it
  was generated against; integrate dry-run catches stale variants at adoption time.
- Agent-review theater (rubber-stamp recommendations): mitigated by requiring rationale text
  and displaying it, never just a checkmark.
- Namespace collisions with artworks.system_name: shared namespace is deliberate (one entity,
  two facets) — enforced by a cross-table uniqueness check at creation.

## Resolved questions (user rulings, 2026-07-13)
- Q1 genera
## Spec-integrity note (2026-07-14, implementing engineer)
The source file's final `## Resolved questions (user rulings, 2026-07-13)`
section is TRUNCATED mid-line at `- Q1 genera` (a pre-existing defect, same
class as REQ-0151's v3 truncation). The four rulings themselves are stated
authoritatively INLINE in the body and were implemented from there; no ruling
was relitigated. For the record, the four as captured inline:
- Q1 (LLM backend, § Generation): agent-session driven; NO LLM key on the
  server; a generic receiving admin API ingests the variants with full
  provenance.
- Q2 (agent review model, § Agent review): a separate agent, Opus-class by
  default, records the advisory review with a mandatory rationale.
- Q3 (Dex integration, § UI): LINK-FIRST — mutual links + adoption-state
  badge only; component sharing deferred.
- Q4 (generate N, § UI): N default 5, per-kind configurable.
The truncated body line is left UNEDITED (I do not author text into a ratified
user section); this note records the reading used.

## Implementation log
### Session 2026-07-14 (implementing engineer, worktree req-0155-content-data-registry-admin)

**Architecture decisions**
- storage.cjs stays THE persistence chokepoint. The content registry's DB
  access lives in a sibling `server/storage_content.cjs`, re-exported through
  storage.cjs (`...contentStore`) — the exact pattern REQ-0151 established
  with storage_art.cjs. It owns its own async pg.Pool. Namespacing (hash of
  $HOME/backpack_ragnarok) is byte-identical to storage_art, so `content_defs`
  and `artworks` SHARE the namespace: the same bare system_name is the same
  game entity in both tables (its data facet + its art facet). `artworkFacetExists()`
  cross-reads the artworks table (same DB) to drive the Dex/admin mutual link.
- Migration `009_content_defs.sql`: `content_kind` ENUM (po_def/si_def/
  monster_def/unit_def/tm_def), `content_defs` + `content_variants`, per-
  content `UNIQUE(content_id, variant_no)`, a circular `adopted_variant_id`
  RESTRICT FK (adopted-undeletable DB backstop), and an IMMUTABILITY TRIGGER
  (`content_variants_immutable_trg`) that refuses any UPDATE changing the
  asset-of-record columns (data/data_sha256/provenance/variant_no/content_id)
  while permitting the advisory annotations (machine_check/agent_review/status).
  data_sha256 is computed in storage over canonical (key-sorted) JSON so the
  hash is authoritative and un-spoofable by the caller.
- Determinism ruling applied as specced: variant-as-record. variant_no is the
  stable handle (max+1, never renumbered); the stored `data` JSONB is the
  asset of record; `provenance` is the best-effort recipe with no regeneration
  guarantee — unifying cleanly with REQ-0151's renders doctrine.
- Machine checks (`server/services/content_checks.cjs`) run SYNCHRONOUSLY on
  every ingest (no GPU, no python — the four validators are pure Node, fast
  enough: ~5 s for a 5-variant batch), then the result is persisted via
  storage.setVariantMachineCheck (an advisory annotation the trigger permits).
  The four checks WIRE the existing validators per kind:
  - schema_vocab — self_test_vocab.cjs CONVENTIONS (it is a fixed self-test
    with no data input, so its documented contract — verbs/triggers/statuses
    from vocab, ranged verb params as [lo,hi] int ranges, po_tags/socket_tags
    hierarchy membership — is applied to the variant against schema_ref).
  - engine_types — check_engine_types.cjs WIRED as a subprocess precondition
    (the mock-src/engine.js type surface must not have drifted) PLUS a per-kind
    runtime-field-type conformance check of the def (its "declared vs runtime
    type" doctrine applied to content).
  - gen_data — tool_gen_data.cjs WIRED as a subprocess: the variant is the
    sole entry of a temp items/sis file, run through the real generator to a
    TEMP out (never content/); exit 0 = the data.js path accepts it. Non-item
    kinds use the same eff_render/serialize convention in-process.
  - integrate — tool_integrate.cjs WIRED as a subprocess in its already-no-write
    mode (it only readFileSync's) against the LIVE vocab/items/sis, plus a
    recursive sha256 manifest of content/live snapshotted before AND after and
    asserted byte-identical — the "provably writes nothing" guarantee.
  Non-po/si kinds mark integrate `applicable:false` (no canvas placement).
- Generation is agent-session driven (Q1): POST .../commission returns a
  commission payload (N default 5, per-kind configurable via gen_config.
  generate_n — Q4); the agent session POSTs the variants to the generic
  receiving API (POST .../variants) with full provenance. NO LLM key server-side.
- Export (`server/services/content_export.cjs`) mirrors art_export: on every
  adoption it writes the adopted variant's data (+ provenance/checks record)
  into CONTENT_EXPORT_ROOT (default content/registry_exports/, a temp dir in
  tests). The git-branch commit + live-file merge via tool_integrate is gated
  behind CONTENT_EXPORT_GIT=1 (off in CI/e2e) and is the deploy (S7) wiring;
  the export STEP fires on adoption and is asserted by G4.

**Gate results (all machine gates GREEN)**
- [x] G1 chokepoint + migration + constraints — 009 applied to the Supabase pg
  (idempotent re-run clean); content_test.cjs proves system_name UNIQUE +
  cross-table shared-namespace facet, variant_no=max+1 monotonic + never
  renumbered after delete + UNIQUE(content_id,variant_no), immutability
  (storage.updateVariantData refuses VARIANT_IMMUTABLE) — and the DB trigger
  proven directly via psql: an UPDATE of machine_check SUCCEEDS while an UPDATE
  of data RAISES the immutability exception. adopted-undeletable (storage +
  RESTRICT FK) + switch/re-adopt; human_edit creates a NEW variant carrying
  parent_variant_id. All DB access via storage.cjs.
- [x] G2 validator wiring — content_test.cjs: a known-good po_def AND si_def
  (built from live_items/live_sis) PASS all four checks; a broken def (unknown
  verb) FAILs naming schema_vocab with the offending token; a non-integer shape
  pair FAILs engine_types naming its own check; the integrate dry-run leaves
  content/live byte-identical (before==after manifest) and reports
  content_live_unchanged:true.
- [x] G3 provenance completeness — every ingested variant row carries
  model/prompt/params (5/5 in the flow); the receiving API's provenance
  validator rejects incomplete llm provenance (missing model/prompt/params)
  and requires parent_variant_id for human_edit; human edits carry parent
  lineage.
- [x] G4 e2e (mocked LLM, no API cost) — client/e2e/contentadmin.spec.ts PASSES
  (3.1s) via tools/content_admin_e2e.sh (HOME-namespaced pg instance of this
  worktree, no GPU, no python, CONTENT_EXPORT_ROOT=temp): create po_def content
  → ingest 5 variants through the UI receiving box (the test constructs them;
  no LLM call) → machine checks auto-run (5× overall PASS chips + all four
  named check chips) → advisory agent review recorded → JSON diff view → adopt
  (delete disabled on adopted) → GET /api/content/<name> serves the adopted
  data + /meta returns provenance+checks+review → export fires → edit creates a
  NEW human_edit variant (no. 6) → re-adopt 6.
- [x] G5 hygiene — no variant data under content/ in the branch diff
  (candidates live ONLY in the DB; exports go to CONTENT_EXPORT_ROOT, a temp
  dir in tests); the vite build output (web/app) was reverted (deploy rebuilds);
  data/ stays gitignored.
- [ ] S7 user acceptance on real content batches (one PO, one monster, one unit
  def) — NOT this session; left OPEN (not a machine gate).

**Test evidence**
- server/tests/content_test.cjs: 13 passed / 0 failed (G1 constraints ×5, G2
  validator wiring ×5, G3 provenance ×2, full create→ingest→review→adopt→serve
  →export→edit→re-adopt flow ×1). Wired into tools/ci.sh pg pass as [5.3/7].
- No regression: api_test.cjs 155/155 (files) AND 155/155 (pg); artwork_test.cjs
  6/6 (pg); inspection_test.cjs 5/5 (pg); check_engine_types 49 members OK;
  self_test_vocab ALL GREEN; server tsc (checkJs) green; client tsc -b + vite
  build green.
- G4 browser spec: 1 passed (3.1s) via the box lock.

**API surface added** (all under /api/content, appended at the router tail
after art; public.cjs owns the EXACT /api/content payload which dispatches
first, so /api/content/<name> falls through cleanly)
- Admin (item_admin gate): GET/POST /api/content/defs; GET/PATCH
  /api/content/defs/<name>; POST .../commission; POST .../variants (generic
  receiving API, provenance-validated, checks auto-run); POST
  .../variants/<no>/review; POST .../variants/<no>/edit (human edit → new
  variant); POST .../adopt (FAIL adoptable only with override:true); DELETE
  .../variants/<no>; POST /api/content/dev/clear-all (dev hook).
- Public serving (no auth): GET /api/content/<name> (adopted data); GET
  /api/content/<name>/meta (provenance + checks + review).

**UI summary** (route #/contentadmin, reachable by hash — no Nav entry yet,
mirroring REQ-0151 to avoid i18n churn)
- Create def (kind + system_name + schema_ref + brief), def list, detail with:
  the variant TABLE (variant_no, machine-check chips reusing REQ-0152 grammar,
  agent-review chip with mandatory rationale, source incl. parent lineage,
  created, actions), JSON DIFF view between any two variants, adopt (FAIL →
  window.confirm override), edit-as-new-variant editor, Generate-N commission
  + paste-and-ingest receiving box. Dex LINK-FIRST (Q3): a RegistryBadge
  (adopted-state + mutual link) mounted additively in DexDetail; the content
  admin shows the artwork facet + a "view in Dex" link. No component sharing.

**Deviations from spec (documented)**
- Shared-namespace reading: the spec calls system_name "shared with artworks
  (one entity, two facets)" AND "enforced by a cross-table uniqueness check at
  creation." Implemented as: content_defs.system_name is UNIQUE within
  content_defs (duplicate content_def refused); a matching artwork is NOT a
  collision but the linked art facet (reported as artwork_facet for the mutual
  link). This is the only reading consistent with "two facets, one entity."
- Machine checks run synchronously on ingest (not via an async job queue like
  art_jobs) because they are CPU-only Node subprocesses (~5 s / 5 variants) and
  synchronous results make G4 assert checks with no polling. If a future kind's
  checks become heavy, the same lower-priority-queue pattern REQ-0152 added is
  available.
- Export git-branch/live-merge wiring (CONTENT_EXPORT_GIT path) is the deploy
  (S7) step, OFF in CI/e2e (it would touch git); the export STEP itself fires
  on adoption and is asserted by G4 (same posture as REQ-0151's ART_EXPORT_GIT).

**Files touched**
- New: server/migrations/009_content_defs.sql, server/storage_content.cjs,
  server/services/content_checks.cjs, server/services/content_export.cjs,
  server/routes/content.cjs, server/tests/content_test.cjs,
  client/src/contentadmin/ContentAdminPage.tsx, client/src/dex/RegistryBadge.tsx,
  client/e2e/contentadmin.spec.ts, client/e2e/contentadmin.config.ts,
  tools/content_admin_e2e.sh.
- Modified: server/storage.cjs (re-export ...contentStore), server/router.cjs
  (tryContentRoutes at tail), client/src/api.ts (content client), client/src/
  store/core.ts ('contentadmin' route), client/src/App.tsx (render),
  client/src/dex/DexDetail.tsx (RegistryBadge mount), tools/ci.sh ([5.3/7]).

**Commits (branch req-0155-content-data-registry-admin)**
- ecbf3bf migration 009 + content-data storage chokepoint (G1 foundation)
- 3732d61 machine checks + receiving/serving API + G1-G3 tests (13/13)
- 37e1d85 content registry admin UI + Dex LINK-FIRST badge
- 4e425f5 G4 e2e (mocked LLM) + ci wiring
- (this commit) REQ log; then git mv todo -> built

**Open (NOT machine gates)**
- S7 user acceptance on real content batches (one PO, one monster, one unit
  def) — stays OPEN per the task; the batch orchestrator loop is out of scope
  (this REQ exposes the per-content hooks).
- Deploy-time CONTENT_EXPORT_GIT branch/live-merge wiring + a Nav rail entry
  for #/contentadmin (deferred with the web-bundle rebuild, as REQ-0151/0152).

## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed. Dedicated merge `5035617`. Content-def pg-backend gates (G1/G2/G3 + recheck) green this pass.
- **Disposition**: STAYS in built/ -- open "[ ] S7 user acceptance on real content batches (one PO, one monster, one unit def)".
