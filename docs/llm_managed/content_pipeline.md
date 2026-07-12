> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Content Generation Pipeline — v1.0 (design, for user review)

> How bulk game content (POs, Accessories, Unit types, enemies, dungeons, art)
> gets designed, generated, validated, balanced, reviewed, and shipped — at a scale
> of hundreds of entries — without the orchestrator hand-writing each one and without
> the user having to inspect every row.

## 0. Principles

1. **Everything is data.** Content lives as schema-validated JSON; code interprets it.
   No content logic is ever hard-coded.
2. **Laws are machine-checkable.** The ratified laws (tags-not-ids, event-verb
   grammar, in-BP scoping, single-cell scarcity, socket model v2, art contracts)
   become validators, not review checklists.
3. **LLMs draft; scripts judge.** Creative generation is delegated to subagents;
   every gate after drafting is a deterministic script. No LLM ever "approves" content.
4. **The user reviews samples and rules, not rows.** Every batch ships a visual
   preview gallery on backpack-dev; verdicts refine the rules, and rules scale to
   future batches.
5. **Model economy (user directive):** orchestrator = Fable (coordination only).
   Subagents: **Opus 4.8** for creative/design-heavy work, **Sonnet 5.0** for
   structured/technical work, Haiku for trivia. Never Fable.

## 1. Content types in scope

POs (items & parts) · Accessories · Unit types (schema reserved; design pending) ·
BP pieces/frames (loot shapes) · Enemies (flat tunable defs per REQ-0005) ·
Dungeon encounter sequences · SVG icon art · Names/flavor (English).

## 2. Canonical data model

- **`content/vocab.json`** — the closed vocabularies. Nothing outside them validates:
  types, elements(=combat tags), socket types, socket tags, triggers, verbs, statuses,
  rarities. Growing a vocabulary is a DESIGN EVENT (user-visible, golden-adjacent),
  not a batch detail.
- **Effect AST v1** (replaces prose effects): e.g.
  `{"trigger":{"t":"every_ticks","n":5},"verb":{"t":"strike","n":14},"target":"enemy"}`
  `{"trigger":{"t":"adjacent","tag":"Oil"},"verb":{"t":"amp_status","status":"Burn","mult":2}}`
  A renderer generates the English tooltip from the AST; a parser-validator rejects
  anything the grammar can't express. (Prose in defs is flavor-only.)
- **Schemas**: `po.schema.json`, `acc.schema.json`, `enemy.schema.json`,
  `unit.schema.json` (reserved). POs carry shape, type, elements, rarity, sockets
  (type+tags+anchor), effects(AST), icon ref, flavor.
- **`content/live/`** — the merged, approved truth the build consumes.
  **`content/batches/batch-NNN-slug/`** — staging: draft.json, notes.md, icons.svg,
  report.txt, status.

## 3. Stages & gates (per batch)

- **S0 Brief** (orchestrator): batch spec — theme/family, count (8–16), shape
  distribution targets, rarity mix, tag budget, allowed new vocab (usually none),
  socket budget. One brief file per batch.
- **S1 Draft** (Content Designer subagent, **Opus 4.8**): generates candidate defs in
  schema + design notes (intent, synergy hooks, fit-difficulty rationale per piece).
  Told the laws explicitly; told which vocab is closed.
- **S2 Static validation** (script `tools/validate.cjs`): schema conformance; AST
  parse; closed-vocab check; id/name collisions (also vs live); shape legality &
  batch shape-distribution vs brief; single-cell scarcity; socket sanity (types/tags
  in vocab, anchors in [0,1]); rarity curve. **Hard gate — auto-reject with report.**
- **S3 Engine integration** (script `tools/integrate.cjs`, reuses mock engine):
  property tests per new PO — placeable in a synthetic BP, 4 rotations legal,
  sockets seat/reject per matrix, effects' tags resolve, no combo crashes. Extends
  the existing 12-scenario suite pattern.
- **S4 Balance sim** (script `tools/simulate.cjs` — RESERVED until the combat tick
  spec exists): auto-battles vs reference enemies; flags DPS/EHP outliers per rarity
  band. Until then: static heuristic bounds (damage-per-tick ceilings per rarity) in S2.
- **S5 Art** (Icon Designer subagent, **Sonnet 5.0**): SVG per style guide (palette,
  outline, flat vector), exact-aspect viewBoxes matching shapes, seam contracts for
  parts, quadrant masks for L/T-shapes. **Auto-checks** (`tools/art_check.py`): XML
  parse, symbol-id naming, viewBox↔shape aspect match, palette conformity (hex scan
  against allowed list), size budget, quadrant-emptiness scan for non-rect shapes.
  Shape change later ⇒ regeneration is mandatory (round-6 binding rule).
- **S6 Preview deploy** (script `tools/build_preview.py`): merges staging data+sprite,
  builds a **gallery page** at `backpack-dev.qtie.jp/preview/batch-NNN/` — each entry
  rendered on a test canvas with tooltip, sockets shown, plus batch stats (shape/
  rarity histograms). Uses the same engine/ui code as the mock.
- **S7 Review gate** (user, with orchestrator triage): user samples the gallery;
  verdicts per entry (green / fix / cut) or per-rule ("all X-like items: change Y").
  Rule-level verdicts get encoded back into validators/briefs so they hold forever.
- **S8 Merge & registry** (orchestrator): approved entries → `content/live/`; sprite
  merged; mock/game rebuilt; `content/registry.json` appends batch id, counts,
  review outcome, provenance (which agent/model drafted). One REQ per batch.

Failure/rollback: a batch never touches `live/` before S7 green. `live/` is
snapshotted per merge (live/history/NNN.json) for one-step rollback.

## 4. Roles & model assignment

| Role | Model | Stages |
|---|---|---|
| Orchestrator (me) | Fable | S0, S7 triage, S8, memory/docs |
| Content Designer | **Opus 4.8** | S1 (creative batch drafting) |
| Icon Designer | **Sonnet 5.0** | S5 |
| Flavor/Consistency Critic (optional pass) | Sonnet 5.0 | pre-S2 naming/flavor lint |
| Validators / sim / build | scripts (no LLM) | S2, S3, S4, S6 |

## 5. Where things live

- Server: `~/backpack_ragnarok/content/` (schema, vocab, batches, live, registry) and
  `~/backpack_ragnarok/tools/` (validate/integrate/simulate/art_check/build_preview).
  Code and content on the server, per standing rule.
- FS (docs only): this design, per-batch REQs, review-note summaries.