# REQ-0025 — Dedupe + Server Legacy Cleanup (sprite unified to v7)

- **Status**: DONE (commits b5f6f63, 9d05f7b, 5b036f2, 6bcb968)

## Outcome
Dedupe: mock-src/eff_render.cjs (buggy diverged copy) + orphaned _effrender_shim.cjs
removed; all consumers already on tools/eff_render.cjs. Sprite unified: mock build now
inlines content/sprite_all_v7.svg (symbol-id sets verified identical pre-switch);
item_icons_all.svg removed. Orphan prune 28→21 symbols — **icon-linker_core KEPT**
(live hardcoded UI dependency in ui.js, found by reference-check discipline). Legacy
gone: icons5b, sprites v3–v6, index_v3_backup.html, .bak; tool defaults → v7.
Gate: engine 18/18, API 9/9, parity 22/22, fit 14/0/6, pages 200, mock sprite ==
v7 byte-identical. Known standing issue: self_test_vocab still needs the never-existed
tool_validate.cjs (queued rebuild).
- **Date**: 2026-07-04 (orchestrator gen2)
- **User ruling**: "files currently on the server that are not in your (gen2's) hands
  can all be considered unnecessary." Everything is git-tracked → removal is reversible.

## Scope (server ~/backpack_ragnarok only)
1. **eff_render dedupe**: remove `mock-src/eff_render.cjs` (diverged copy; batch-1 fix
   only landed in `tools/eff_render.cjs`). Everything requires the tools copy.
   `tools/_effrender_shim.cjs` removed too if it only served the dup.
2. **Sprite unification**: mock still builds from pre-fix `mock-src/item_icons_all.svg`
   (queued propagation never done). Switch mock build to `content/sprite_all_v7.svg`
   (single art source of truth), then remove item_icons_all.svg.
3. **Legacy artifacts removed** (git history preserves): content/item_icons5b.svg,
   sprite_all_v3/v4/v5/v6.svg, web/preview/batch-001/index_v3_backup.html,
   tool_fit_check.py.req0019.bak (untracked), orphan sprite symbols with no defs
   (icon-dagger, icon-fang, icon-flame_rune, icon-golden_idol, icon-greatsword,
   icon-herb_pouch, icon-linker_core, icon-oil_flask) pruned from v7.
4. Tool defaults updated (build_fit_report default sprite → v7 etc.).

## Gate
Full verification after: engine 18/18, server API 9/9, fit parity 22/22, fit CHECK
14 PASS/0 FAIL (SKIP shrinks with orphan removal), all pages 200, mock shows v7 art.
