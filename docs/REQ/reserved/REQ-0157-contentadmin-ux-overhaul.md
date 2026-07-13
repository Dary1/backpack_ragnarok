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
