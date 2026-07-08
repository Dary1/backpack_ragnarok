# REQ-0021 — Terminology Audit vs New Ground Truth

- **Status**: IN PROGRESS (audit phase; apply phase gated on user review)
- **Date**: 2026-07-03 (orchestrator gen2)

## Context
User deleted `docs/glossary.md` (old ratified glossary — now void) and delivered a new
ground truth: **`docs/canvas_spec_glossary_ground_true.md`**. Terminology in the current
code/content is inconsistent ("かなり飛び飛び"). Before introducing server git, we
inventory and align.

## Ground-truth model (summary)
Item types: **BP** (Backpack) / **PO** (Placement Object) / **SI** (Socket Item).
Layer-1 Canvas: Canvas, BP, Cell, Dead Space. Layer-2: PO (polyomino, fits inside ONE BP),
**PO Tag** (hierarchical, e.g. Sword<Weapon), **PO Connection Port** (connects only
same-tag/hierarchy POs; never across BPs). Layer-3: Socket Item, **Socket Type**
(hierarchy, same mechanics as PO tags). Linker: ≤1 per BP; 8 beam dirs (N..NW);
first-hit only; Mutual Link allowed. Economy: Transmutator. Deployment: Unit, Party
(=4 Units), Preset.

## Audit phase (read-only, subagent)
Inventory every domain term and where it appears, across:
- Server code: `mock-src/{engine.js,ui.js,data.js,build.py}`, `tools/*.cjs`,
  `tools/tool_fit_check.py`, `tools/build_preview.py`, `web/` pages.
- Server content: `content/vocab.json`, `content/live/*.json`, batch draft.json,
  registry.json.
- FS docs (secondary): second_golden.md, placement_object_golden.md, item_spec_draft.md,
  content_pipeline.md, art_golden.md.

Output → `docs/terminology_alignment_plan.md`:
1. Term inventory (term → files/keys where used).
2. Proposed old→new mapping (e.g. accessories→SI?, el/elements→PO Tag?, conn→Connection Port?).
3. **Semantic conflicts** flagged separately from pure renames — the ground truth changes
   models, not just names (tag HIERARCHY vs flat elements; socket TYPE hierarchy vs
   socket-tags v2; connection PORTS between same-tag POs vs external conn target tiles;
   "accessories" vs Socket Item). These need user rulings, not renames.
4. Open questions list for the user.

## Apply phase (after user review)
Rename code/data per the approved mapping; engine tests must stay green; one
follow-up REQ records the applied mapping. Server git init happens AFTER this cleanup
(user directive).

## User rulings received (2026-07-03)
- **Q1 resolved — no conflict**: Socket Types and PO Tags are SEPARATE vocabularies that
  follow the SAME hierarchical matching pattern. "Never mix" stands; the pattern is shared.
  Glossary sentence rewording proposed to the user.
- Coverage floor 30%→20% (art_golden v3.1); lighting rule unnecessary → all 8 icon FAILs
  unblocked (handled under REQ-0019/0022 icon-fix pass, sprite v5).
- second_golden.md deleted (its audit findings/Q5 are moot).
- All docs/ content is user-verified ground truth as of 2026-07-03.

## Notes
- `docs/glossary.md` no longer exists; any doc/code reference to it is itself drift —
  list those too.
- PROJECT.md references to "glossary v1.0 RATIFIED" are historical; the new ground
  truth supersedes them.
