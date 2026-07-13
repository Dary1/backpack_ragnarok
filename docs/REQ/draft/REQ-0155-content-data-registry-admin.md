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