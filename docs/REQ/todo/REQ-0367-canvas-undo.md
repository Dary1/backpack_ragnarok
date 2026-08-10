# REQ-0367 — Canvas single-step undo (Ctrl+Z) for placement mistakes

## Status
built — implemented on branch req-0367-canvas-undo, all gates green
(2026-08-10, Cowork session; see Build & gate record below). NOT merged /
deployed / accepted.
Previously: todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap
analysis batch); ratified by user 2026-08-10, chat: 「では、それらを全て、
TODOのREQとして書き出してください」.

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

## Build & gate record (2026-08-10, Cowork session)

Implementation commit: 38883b39 on branch req-0367-canvas-undo (worktree
~/backpack_ragnarok_worktrees/req-0367-canvas-undo). shared/engine.js
untouched (design rule 1); the auto-save PUT remains the one profile
writer (design rule 5) — undo restores in place, then notifyStateChanged()
lets the normal debounced auto-save persist the restore.

Shape of the build (spec items 1-4):
1. store/undo.ts: ONE deep-copy slot, no redo. armUndo() at the top of the
   four drop commits (board/commits.ts: PO/Asm/BP/SI — covers place/move/
   remove including the canvas⇄inventory reference create/remove
   crossings); the two dblclick-rotate sites (BoardRenderer.ts) use
   captureUndoState()+armUndoFrom() so a REFUSED rotate cannot overwrite a
   still-useful slot with a copy that undoes nothing (build-time decision;
   the copy is still taken BEFORE the mutator runs, per spec item 2).
2. undo() restores through loadGame's EXACT path: applyCanvasToState() was
   extracted VERBATIM from loadGame (store/autosave.ts) and both call it —
   migrateState first, same field set, cancelCarry first. The slot is
   consumed on restore (one step, no redo).
3. Triggers: initUndoHotkey() (main.tsx) — Ctrl/Cmd+Z, guarded for
   INPUT/TEXTAREA/SELECT/contentEditable focus; boardfoot UndoButton (↩,
   CanvasChrome.tsx, data-testid canvas-undo-btn) beside the SaveSeal,
   disabled while the slot is empty via new StoreSnapshot.undoAvailable;
   i18n'd tooltip key canvas.undo (en/ja).
4. Clears: active-squad switch, inventory page switch, route change +
   hashchange (spec item 4); warehouse claim and gacha finalize clear
   explicitly at their commit sites; market/dismantle/ragnarok clear via
   the loadGame() refresh they all already run (loadGame clears); squad
   create/delete clear. EXTENSION beyond the spec letter: out-of-scope
   pure-client mutations (squad/page rename + reorder, chain-link toggle)
   also clear — the restore is a WHOLE-state snapshot, so an armed slot
   crossing them would make undo silently revert changes the player did
   not ask to undo; clearing is the conservative reading of "undo never
   crosses a context the player can see change". Guide-field writes
   (REQ-0141) deliberately do NOT clear: they fire mid-tour right after
   placements, and reverting a guide step/hint flag with the snapshot is
   harmless while losing undo during the tour is not.

Known accepted edge: the four drop commits arm unconditionally (spec item
2's letter). A commit-time refusal (stale-race only — the hover preview
already validated the drop) leaves the slot holding a byte-identical copy:
undo then restores nothing visible. Harmless, documented here.

## Gate results (all green, 2026-08-10)

- Unit: client/scripts/check_undo.mjs, wired as ci.sh stage [5.9h/7].
  Drives the REAL store modules + REAL shared/engine.js (vite
  ssrLoadModule, check_auth.mjs rig): mutate → undo → key-order-
  insensitive deep-equal (migrateState's no-op copy may reorder keys);
  inv→canvas createRef undone; refused-rotate arm discipline; excluded-op
  clear; one-step consumption; the undoAvailable flag.
- e2e: client/e2e/canvas-undo.spec.ts (2 tests, hermetic scoped fleet).
  (1) drag PO [3,3]→[4,4], Ctrl+Z → saved canvas back at [3,3]; the
  boardfoot seal cycles saving→saved AFTER the undo (the restore rides the
  normal auto-save); the ↩ button repeats the whole cycle by click and its
  disabled state tracks the slot. (2) drag (slot armed) → real warehouse
  grant+claim through the UI → Ctrl+Z does NOTHING: the whole saved canvas
  is deep-equal before/after (claim intact, move intact), button disabled.
- CI GREEN: full tools/ci.sh, scope=both, 349 s wall, receipt written for
  implementation tree 7d4f2438 (2026-08-10). Run includes [5.9h/7] and
  canvas-undo.spec inside the scoped [7/7] fleet. shared/engine.js: zero
  diff (git shows no change under shared/).

## Outcome
built — on branch req-0367-canvas-undo, awaiting merge/deploy/acceptance
(never collapsed into done, per the board rules).
