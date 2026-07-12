# REQ-0111 — Author monster_content_pipeline.md

- **Status**: draft — spec written; ready to hand off (git mv to `todo/` when assigned).
- **Date**: 2026-07-09
- **Owner**: unassigned (delegated away from the item-pipeline session)

## Goal
Author `docs/llm_managed/monster_content_pipeline.md` — the **monster content pipeline**,
one of the three domain splits (item / TM / monster). A placeholder stub already exists
containing only this REQ number + a reference to `common_content_pipeline.md`.

## Scope
- Covers enemies (flat tunable defs), dungeon encounter sequences, and monster SVG/AI icon
  art. Real precedents: `content/batches/batch-002-dungeon-pilot/`, `batch-004-warren-ascendant/`
  (enemies.json / skills.json / formations.json / dungeon.json), tools
  `tools/build_dungeon_preview.py` and `tools/gen_monster_art.py`, and the tier gallery in
  `content/proposals/monster_footprint_manifest.json`.
- Document authoring → validation → preview → review → merge for monsters, mirroring the
  item pipeline's step format but for monster specifics (no enemy schema validator exists
  today — checked by hand vs `content/vocab.json` + prior batches; note this honestly).
- Keep shared material in `common_content_pipeline.md`; this doc holds only monster-specifics.

## Out of scope
- PO/SI (item pipeline) and TM (TM pipeline).
