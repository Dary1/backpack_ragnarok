# REQ-0110 — Author tm_content_pipeline.md

- **Status**: draft — spec written; ready to hand off (git mv to `todo/` when assigned).
- **Date**: 2026-07-09
- **Owner**: unassigned (delegated away from the item-pipeline session)

## Goal
Author `docs/llm_managed/tm_content_pipeline.md` — the **TM (Transmutator) content
pipeline**, one of the three domain splits of the content pipeline (item / TM / monster).
A placeholder stub already exists containing only this REQ number + a reference to
`common_content_pipeline.md`.

## Scope
- TM data lives in `content/live/live_tms.json` (schema `tm/1`); TMs are the market's
  stackable, inventory-only barter tokens (REQ-0042; the v1 trade TM is `lrdst`).
- Document how TM content is authored, validated, built, reviewed, and merged, mirroring
  the item pipeline's step-by-step (Step 1,2,3…) format but for TM specifics: stackable /
  inventory-only, no shape / no sockets, market/economy semantics (law 1 "barter in kind").
- Keep all shared material (principles, infra, REQ workflow, vocab, build via
  `tool_gen_data.cjs`, `ci.sh`) in `common_content_pipeline.md`; this doc holds only
  TM-specific steps. Confirm the real `tm/1` schema + validator surface against
  `shared/content_validate.cjs` and `content/live/live_tms.json` before writing.

## Out of scope
- PO/SI (item pipeline) and enemy/dungeon (monster pipeline).
