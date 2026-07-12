# REQ-0032 — Tab Reordering (DnD) + Preset Trash Delete

- **Status**: QUEUED (user, 2026-07-04)

## Spec (user verbatim intent)
1. Preset tabs AND Inventory tabs can be reordered by drag & drop (tab index changes).
2. While DRAGGING a Preset tab, a trash can appears temporarily at the CENTER of the
   Canvas; dropping the tab there DELETES that preset.

## Notes / defaults (orchestrator, refine at implementation)
- Reorder persists via auto-save (order lives in state: preset store/names arrays and
  inv page order are reordered together with their contents).
- Trash delete: confirmation-free per spec, but deleting the ACTIVE preset switches to
  the nearest remaining tab; deleting the LAST remaining preset is refused (min 1).
- Deleted preset's item references simply vanish (inventory items remain — depends on
  REQ-0033 reference model; if implemented before REQ-0033, physical items return to
  inventory via first-fit, flag if any don't fit).
- Inventory tabs have NO trash (pages are storage; only presets are deletable).
- E2E: reorder both tab kinds (order persists after reload), trash appears only during
  preset-tab drag, delete works, last-preset refusal.
