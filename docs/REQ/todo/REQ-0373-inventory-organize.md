# REQ-0373 — Inventory organize: auto-arrange + name search + mass-dismantle safety

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Findings P1-3 + P1-4 (both are
"the hoard grows and the tools don't" problems).

## Problem (gamer-facing)
Five fixed inventory pages, no auto-arrange, no name search — the side panel
filters by category chips only (`canvas.filter.*`; `CanvasSidePanel.tsx` has
no search input, verified). Warehouse claims and workshop rolls push items in
first-fit (`client/src/lib/placement.ts`), so pages scatter monotonically;
when everything is full, claims bounce (`schedule.warehouse.claimNoSpace`)
and the player has no tooling to make space beyond hand-dragging.
Separately, multi-select mass dismantle (REQ-0090) shows a count and a total
but NO rarity breakdown — one confirm can melt a Rare unnoticed, and
dismantle is irreversible.

## Spec
1. Auto-arrange (per page): a button in the inventory boardfoot repacks the
   ACTIVE page's items deterministically (footprint-desc first-fit, reusing
   the `placement.ts` variants) as a sequence of legal engine inventory moves
   — `shared/engine.js` untouched (rule 1), auto-save persists normally
   (rule 5). Items that cannot legally move (locked/starter-fixed) stay.
2. Name search in CanvasSidePanel: a text input beside the filter chips,
   matching the LOCALIZED item name (both locales); combines AND-wise with
   the active chip.
3. Mass-dismantle safety: the selection summary in DismantlePanel gains
   per-rarity count chips; when the selection contains Rare or better, the
   confirm button arms in two clicks ("Rare in selection — click again"),
   i18n'd. Single-item flow unchanged.
4. All new strings en/ja at the barrel; selectors additive.

## Gates
- Unit: arrange output deterministic for a fixture page (same input → same
  layout); every emitted move legal per the engine.
- e2e: scatter items → arrange → expected layout; search "frost" narrows the
  list in ja and en; select 1 Common + 1 Rare → confirm requires the armed
  second click; Commons-only → single click as today.
- Undo interop (REQ-0367): arrange counts as ONE undoable step if 0367 has
  landed (snapshot before the batch), else noted n/a.
- CI green.

## Out of scope
Cross-page global sort, page count changes, warehouse-side sorting (its
expiry-ascending order is a design choice), sell/dismantle from search
results.
