# REQ-0367 — Canvas single-step undo (Ctrl+Z) for placement mistakes

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P0-1 — the highest-impact
"every game has this" gap.

## Problem (gamer-facing)
This is a placement game with NO undo. A mis-drag, mis-rotation or accidental
removal persists instantly: auto-save runs after every mutation
(store `notifyStateChanged()` → debounced PUT) and the REQ-0031 retirement of
the Save/Load buttons removed the last manual escape hatch. Genre baseline
(Backpack Hero / Backpack Battles) is Ctrl+Z for at least one step.

## Evidence (verified 2026-08-10)
- No undo/redo implementation anywhere in `client/src` (grep; the only matches
  are ragnarok "cannot be undone" copy).
- All canvas/inventory mutations funnel through `client/src/board/boardOps.ts`
  and the store mutators; state is plain JSON (engine snapshot), so a deep copy
  is a legal restore payload via the existing load path.

## Spec
1. ONE-step undo, no redo. Scope: pure client-side engine mutations only —
   place / move / rotate / remove, including canvas⇄inventory moves.
   EXCLUDED (never undoable): server-authoritative flows — warehouse claim,
   gacha two-phase placement finalization, market, dismantle, squad
   create/delete. Excluded ops CLEAR the stored snapshot.
2. Mechanism: before each in-scope mutation, store a deep copy of the affected
   state (whole engine state snapshot is acceptable — it is small and this is
   one slot). Undo restores it through the same code path loadGame uses, then
   normal notifyStateChanged → auto-save persists the restore (design rule 5
   untouched: the auto-save PUT stays the one writer).
3. Triggers: Ctrl+Z (guarded: not while focus is in an input/textarea) + a
   small ↩ button in the canvas boardfoot next to the SaveSeal, disabled when
   the slot is empty. i18n'd tooltip.
4. Context switches (active squad change, inventory page change, route change)
   drop the snapshot — undo never crosses a context the player can see change.

## Gates
- Unit: mutate → undo → state deep-equals the pre-mutation snapshot.
- e2e: drag a PO to a new cell, Ctrl+Z, PO back at origin; auto-save indicator
  cycles saving→saved after the undo; a warehouse claim then Ctrl+Z does
  NOTHING (excluded op cleared the slot).
- `shared/engine.js` untouched (design rule 1). CI green.

## Out of scope
Multi-step history, redo, undo for server-authoritative flows.
