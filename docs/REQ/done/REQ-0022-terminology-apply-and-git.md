# REQ-0022 — Terminology Apply Phase + Server Git Introduction

- **Status**: DONE except Batch 5 (Connection Port — proposal pending with user)
- **Date**: 2026-07-03 (orchestrator gen2)

## Outcome
Git live at ~/backpack_ragnarok (initial snapshot + per-batch commits, 9 total).
Batch 1: eff_render EN element-label bug fixed; piece→cell (incl. index.template.html).
Batch 2: ACC→SI everywhere (engine SI_DEFS/sis/seatSI/siUid; schema si/2; live_accs.json
→ live_sis.json; scenario sis[]; vocab socket_item_only; tools/pages updated); compass
display for dirs (numeric storage kept). Batch 6: stale requires fixed; self_test_vocab
runs (2 remaining failures = missing tool_validate.cjs, confirmed nonexistent — rebuild
queued); its fixtures also migrated every_ticks→every_secs (real secondary bug).
Batch 3+4: vocab v3 = two DEGENERATE trees (po_tags / socket_tags, separate namespaces);
items carry `tags` (type-first ordering convention, tags[0]=former type); shared
hierarchy-walk (ancestorsOf/tagsRelated/hasTag) used by combos() and hostOk();
migration script tools/migrate_tag_hierarchy.cjs (8+0+6 entries). Tests EXTENDED 12→15
(child-matches-ancestor; namespaces-never-cross; unrelated-tags-don't-match), 15/15
green. Fit verdict semantics updated same day (REQ-0020 Addendum 2): verdict=overflow
only, coverage = ART-WARN. All pages 200.
- **Basis**: `docs/terminology_alignment_plan.md` (REQ-0021 audit), user "go" on both
  the plan and git (2026-07-03). Session scope = CANVAS scheme.

## Rulings adopted (plan §5)
- Q1 = **B** (user-ruled earlier): Socket Type and PO Tag = SEPARATE namespaces sharing
  the SAME hierarchical matching mechanism. Glossary already reworded accordingly.
- Q2 = **A** (plan recommendation): fold `type` into the PO Tag hierarchy.
- Q3 = **B**: Parts stay as-is (ground truth silent; don't touch).
- Q4 / Q5: MOOT (second_golden.md deleted; deployment out of session scope).
- Q6 = **A**: numeric 0–7 internal storage stays; compass letters (N/NE/…/NW) in
  user-facing display only.
- Q7 = **A**: SI (Socket Item) covers both socket-mounted and bond-mounted accessories.
- Q8: fix the `tagKind:'element'` EN "PO" tooltip bug immediately (batch 1).
- Q9: stale/broken requires fixed here as batch 6 (folded in rather than separate REQ).

## Ordering decision (orchestrator, deviating from plan §6 tail)
**Git init happens FIRST**, before any rename batch — gen1's data loss happened during
an unversioned rollback attempt; large mechanical renames without version control would
repeat that risk profile. User approved git ("git go").

## Batch-3/4 model interpretation (recorded)
Unify to ONE hierarchical tag model with TWO trees (PO Tag tree; Socket Type tree —
separate namespaces per Q1=B). Initial trees are DEGENERATE (flat roots = current
`types` + `elements` values, and current socket types/tags), so engine behavior is
preserved exactly while the hierarchy-walk mechanism (same-or-ancestor matching) goes
live with test coverage using synthetic depth fixtures (e.g. Sword<Weapon). Content
gains depth later as a design event, not in this REQ.

## Execution plan
1. Git: init at `~/backpack_ragnarok`, `.gitignore` (.secrets/, .venv/, tmp/,
   node_modules/, *.bak), local identity, initial commit = pre-rename snapshot.
2. Batch 1 (zero-risk): eff_render EN tagKind fix; "piece(s)"→"cell(s)" UI prose.
   (second_golden/placement_object_golden items moot — docs deleted.)
3. Batch 2 (naming): ACC/Accessory→SI everywhere (schema "acc/2"→"si/2", ACC_DEFS→SI_DEFS,
   seatAcc/stowAcc→seatSI/stowSI, live_accs.json→live_sis.json incl. tool references);
   compass-letter display layer for Linker dirs.
4. Batch 6 (housekeeping): fix stale requires (tool_integrate `v05_engine.js`,
   self_test_vocab ×4); update content_pipeline.md references to nonexistent tools.
5. Batch 3+4 (model): hierarchy-walk helper; PO Tag tree (types+elements folded,
   degenerate); Socket Type tree (separate); engine `el.includes`/`hostOk` →
   hierarchy-aware; vocab.json restructure; gen_data/integrate/self_test updated;
   12-test suite EXTENDED with hierarchy fixtures; all green.
6. Batch 5 (Connection Port semantics) **DEFERRED**: needs design input (tag-gating
   changes combat behavior; directionality question). Orchestrator will present a
   concrete proposal to the user after batches land.
7. One commit per batch; mock rebuilt + preview/fit pages regenerated if their inputs
   changed; final verification: tests green, pages 200.

## Deliverables
- [ ] Git repo live with per-batch history.
- [ ] Batches 1, 2, 6, 3+4 applied; tests green (suite extended).
- [ ] Applied mapping recorded here; PROJECT.md updated.
- [ ] Batch-5 (Connection Port) proposal presented to user.
