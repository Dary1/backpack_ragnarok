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

## Outcome (2026-07-12, REQ-0110 executed)

- Authored `docs/llm_managed/tm_content_pipeline.md` v1.0 (commit de6b6f6),
  replacing the placeholder stub. Steps 1-8 mirror the item pipeline format;
  TM-specific facts verified against source on master:
  - `tm/1` = defs only (id/name/short/rarity/icon/stackable/flavor/i18n.ja);
    NO effects field (no use-effect v1, REQ-0042).
  - `shared/content_validate.cjs` has NO tm kind (item|si only) and
    `server/admin.cjs` has no TM edit surface — documented as an open item
    owned by the first REQ needing it; scratch validation harness provided.
  - `tool_integrate.cjs` has no TM path (by design, inventory-only);
    integration check = server suite (`node server/tests/api_test.cjs`).
  - `tool_gen_data.cjs` does NOT bake TM defs into mock-src/data.js; live
    client reads /api/content tms.
  - Icon route = SVG sprite symbol (icon-lrdst since sprite v11; client
    imports v12 in sprites.ts/dexIcons.ts). AI-raster for TMs unratified.
  - Economy discipline: every TM brief must declare faucet+sink; market
    laws 1-2 cited from server/services/market.cjs.
- Open items routed: content_validate tm kind, respects_bio_luck (REQ-0060),
  use-effect TMs (design event), AI-raster icons (REQ-0135/0136).
