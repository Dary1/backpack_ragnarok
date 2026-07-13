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

## Disposition (2026-07-14): SUPERSEDED by REQ-0154 — content absorbed

Per the **Q1 ruling** (user, 2026-07-13), this REQ's scope — the monster/enemy
content pipeline doc (enemies as flat tunable `enemy/1` defs, dungeon encounter
sequences, `skills.json`/`formations.json`/`dungeon.json`, monster illustration art;
the real precedents `batch-002-dungeon-pilot` / `monsters-002` / `monsters-003-flux2`
+ `content/proposals/monsters-00N/`; and the honest "no dedicated enemy schema
validator exists" note) — has been **ABSORBED into REQ-0154 wave 4** and written into
`docs/llm_managed/monster_content_pipeline.md` **v1.0 (2026-07-14)** with attribution.
The placeholder stub is replaced by a full registry-era doc that references the spine
(`common_content_pipeline.md` §6–§9) and `art_pipeline.md`.

This REQ is therefore **closed as superseded (content absorbed)** and moved
`draft/ → done/` in a dedicated commit (one `git mv` per commit, per board policy).
No monster-pipeline work remains under this number.
