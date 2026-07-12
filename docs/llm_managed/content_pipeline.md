> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Content Generation Pipeline — SUPERSEDED (2026-07-12, REQ-0134)

This file was the v1.0 end-to-end DESIGN (REQ-0014, pre-implementation). It is
superseded by the as-built doc set:

- **`common_content_pipeline.md`** — shared layer: principles, the Art Golden
  (binding; former `art_golden.md`, abolished by user directive 2026-07-12),
  canonical data model, stage ladder **S0–S8 (numbering unchanged)**, infra &
  REQ workflow.
- Per-kind deltas: `item_content_pipeline.md` (PO/SI),
  `monster_content_pipeline.md`, `tm_content_pipeline.md`,
  `unit_icon_pipeline.md`, `backpack_skin_pipeline.md`.

Inbound references of the form "S1–S8 (content_pipeline.md)" resolve to
`common_content_pipeline.md` §4. The full v1.0 design text lives in git
history at this path (before the REQ-0134 commit).
