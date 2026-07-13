# REQ-0160 — dungeon-content-registry-kinds: bring dungeon-mode content under the content registry

**Status:** draft — spec written, BLOCKED on user rulings Q1/Q2 below.
**Requested by:** user, 2026-07-14 (chat): "REQ立ててください" for the two flagged discoveries
of the REQ-0157 backfill session (Session 2026-07-14c).
**Spec authored by:** orchestrator (Fable), 2026-07-14.

**Depends on / coordination:**
- REQ-0155/0157 (content registry + admin, built+deployed) — this REQ extends their kind
  coverage; registry semantics unchanged.
- `tools/backfill_content_registry.cjs` (REQ-0157 follow-up) — already idempotent and
  insert-only; this REQ widens its sanctioned inventory once ruled.

## Background (facts from the 2026-07-14c backfill)
The 全kind backfill imported 22 live entities (po 8 / si 6 / tm 1 / monster 7). Two live
corpora were discovered OUTSIDE the sanctioned inventory and deliberately left unimported
(flagged in the tool's skip table + REQ-0157 log):
1. `content/live/dungeon/items.json` — schema **po/2**, **2 dungeon-mode PO entries**. Same
   schema as live_items.json; skipped only because it was outside the ruled inventory.
2. `content/live/dungeon/skills.json` — schema **skill/1**, **14 entries**. No `skill_def`
   kind exists in the `content_kind` DB ENUM (migration 009: po_def|si_def|monster_def|
   unit_def|tm_def), so these are structurally unimportable today.

## Open rulings (blocking)
- **Q1 (dungeon items):** import the 2 dungeon-mode po/2 entries as `po_def`s?
  - Option A: import as po_def with provenance.origin_file distinguishing them (cheap, one
    tool-inventory line; the registry stays "one ledger for everything").
  - Option B: keep dungeon-mode POs out (if dungeon items are a separate content family that
    will get its own kind/pipeline later).
- **Q2 (skills):** add a `skill_def` kind (ENUM migration + kind wiring in admin UI kind
  chips, machine-check applicability map, Dex linkage n/a) and backfill the 14 skill/1
  entries?
  - Requires: `server/migrations/` ENUM extension (ALTER TYPE ... ADD VALUE), storage/routes
    accept the kind, contentadmin kind chip + counts, checks applicability (schema_vocab
    against skill/1; integrate n/a), backfill inventory line.
  - Sub-question: are skill/1 checks meaningful today, or record applicable:false honestly
    until a skill validator exists?

## Scope (once ruled)
- Extend `tools/backfill_content_registry.cjs`'s sanctioned inventory per Q1/Q2; keep
  idempotent + insert-only; re-run against the live namespace (same discipline as 2026-07-14c:
  dry-run count-match gate before the real run).
- Q2 path: numbered migration adding `skill_def`; admin UI kind list extension (chips/counts/
  create-panel option); checks applicability map entry.
- Tests: mapping tests extended (backfill_content_registry_test pattern); content_test /
  contentagg_test stay green; migration applies cleanly.

## Out of scope
- Any new validator authoring (skill/1 validation beyond honest applicable:false is its own
  work); entities/formations/scenario/seasons (ruled out in 2026-07-14c — not per-entity
  registry content); gameplay changes.

## Gates
- G1: migration (if Q2=yes) applies cleanly; ENUM extension proven on the pg backend.
- G2: dry-run inventory matches the ruled counts exactly; real run writes exactly them;
  second run 0/0; pre-existing rows untouched (artworks + 22 defs unchanged).
- G3: admin UI shows the new kind(s) with correct counts; adopted badges; checks displayed
  honestly (applicable:false where no validator exists).
- G4 hygiene: no data under content/ changed; docs/REQ log updated; pnpm only.
- S7: user acceptance on the live screen.
