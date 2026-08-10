# REQ-0369 — Input conventions: keyboard shortcuts + unified modal behavior

## Status
built — implemented + all gates green 2026-08-10 (Cowork session); NOT merged/
deployed. Spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Findings P0-3 + P1-9 (same subsystem).

## Problem (gamer-facing)
There are effectively NO gameplay keyboard shortcuts, and even Esc is
inconsistent: FloatingItemTip, DismantlePanel and the admin surfaces close on
Esc; the market BuyModal, the workshop roll-result and others do not. Focus
trapping is nowhere. Gamers reflexively try R (rotate), Esc (close), Space
(pause) and number keys (tab switch); every one of those today does nothing —
or worse, does something only on some screens. Ironically the ADMIN pages have
the best keyboard behavior in the product.

## Evidence (verified 2026-08-10)
keydown census over `client/src`: chip Enter/Space activation
(BuyPane/SellPane), `LongPressTabs.tsx`, `FloatingItemTip.tsx` (Esc),
`DismantlePanel.tsx:154` (Esc), artadmin/contentadmin (Esc, complete) — and
nothing else. No R, no digits, no Space, no shortcut reference anywhere.

## Spec
1. Shared modal hook (`client/src/lib/useModalConventions.ts` or similar):
   Esc-to-close, overlay-click-to-close, focus trap, initial focus. Adopt in
   every player-facing modal: BuyModal, workshop roll result, DismantlePanel
   (align its existing Esc), sealed-run compare, REQ-0366's warehouse sell
   modal. EXCEPTION — the ragnarok devotion rite keeps its deliberate
   multi-stage confirm; Esc closes only its first stage.
2. Shortcuts (all guarded: never fire while focus is in an
   input/textarea/contentEditable):
   - Esc — universal close (via the hook).
   - R — rotate the piece under drag/float; delegates to the REQ-0289
     Unit-pivot rotation paths (see 0289 Amendments).
   - 1..5 — switch active squad tab on the backpacks route only.
   - Space — play/pause the schedule monitor replay when a monitor is open.
   - ? — shortcut reference overlay (i18n'd static list; closes on Esc).
3. E2E selector contract: additive only — existing selectors and EN label
   texts must not change.

## Gates
- e2e: Esc closes BuyModal; R rotates a dragged piece (with 0289 landed;
  otherwise R maps to the current dblclick-rotate call path); 1..5 switches
  squads and does NOT fire while typing in the seal-token input; ? opens the
  overlay in both locales.
- No regression in the existing keydown surfaces (tip/dismantle/admin).
- CI green.

## Out of scope
Rebindable keys, gamepad, IME-level composition handling beyond the
input-focus guard.

## Cross-refs
REQ-0289 (rotation trigger), REQ-0366 (first adopter of the modal hook).

## Execution log (2026-08-10, Cowork session)
Worktree `req-0369-input-conventions` @ master `a428bf53`. Code commit
`1167d6a2` (tree `a8f5c572801ee59b9447466046fa633c2ed89f4f`).
- Spec 1 — the hook already existed VERBATIM as `client/src/lib/
  useModalConventions.ts` (REQ-0366 built it in exactly this REQ's shape;
  its SellModal was the first adopter). Adopted here in: market
  `BuyModal.tsx`; workshop roll-result (extracted `RollResultChrome` in
  `WorkshopPage.tsx` — a hook can't sit behind the inline conditional;
  DOM/classes/testid byte-identical, additive attributes only);
  `DismantlePanel.tsx` (its bespoke window-Esc listener replaced by the
  hook — "align its existing Esc"); ragnarok devotion final-question modal
  (`FinalQuestionChrome` in `DevotionSection.tsx`) with the spec's
  EXCEPTION honored: Esc closes only that first stage, busy-guarded, and
  the engraved success modal is untouched.
- Spec 1 DEVIATION: "sealed-run compare" is an INLINE section of
  `SealPanel.tsx` (schedule page right column), not a modal — there is
  nothing to adopt; no change made. If a compare modal ever ships it must
  take the hook.
- Spec 2 — new `client/src/lib/inputShortcuts.ts` (one window keydown,
  wired at boot in `main.tsx`, initUndoHotkey lifecycle shape). Guard =
  `store/undo.ts`'s `focusInTextEntry` (now exported, THE shared guard) +
  no Ctrl/Meta/Alt chord. R: REQ-0289 is still in todo, so per the gate's
  fallback R maps to the CURRENT dblclick-rotate call path — routed
  `drag.ts` `rotatePieceOnBoard(boardKey, kind, uid)` → the board
  registry's new optional `rotateShortcut` closure (`board/commits.ts`,
  identical core: REQ-0367 arm-on-success undo, notify on ok, reject
  flash). Works under carry (po/asm-blade/bp, in place; SI ignored like
  the pointer path) and under float (tip'd PO); backpacks route only
  (boards stay mounted route-hidden — REQ-0034 — so the route guard stops
  a lingering tip rotating an invisible board). 1..5 →
  `switchActiveSquad(n-1)`, backpacks route only, engine refuses
  out-of-range. Space → `Monitor.tsx`'s own guarded listener while a
  settled replay transport is on screen (needs the mounted playhead
  closure; preventDefault stops page scroll + focused-button
  double-toggle). ? → `ShortcutHelp.tsx` overlay (closes via the hook),
  strings in `i18n/common.ts` en+ja; ? preventDefault'd (Firefox
  quick-find).
- Spec 3 — additive only: new `shortcut-help-*` testids; zero existing
  selectors/EN labels changed (whole pre-existing e2e suite passed
  unmodified, which is the check).

## Gate results (2026-08-10)
- `client/e2e/input-conventions.spec.ts` — 5/5 green (scoped run AND
  inside CI): Esc closes BuyModal (dev buyer seeded with lrdst — the
  Purchase button renders disabled when unaffordable); R rotates the
  FLOATED PO rot 0→1 (fixture + assertions byte-for-byte
  bp-rotate.spec.ts's dblclick test — same core, new trigger); R rotates
  MID-CARRY and the drop still commits home; 1..5 switch squads and a '3'
  typed into the seal-token input does NOT fire (types normally); ? opens
  the overlay in EN and JA, Esc closes it.
- No regression in existing keydown surfaces: full client e2e 234
  passed / 0 failed (tip/dismantle/admin suites untouched and green).
- Space replay toggle: not in the gates list (needs a settled-run
  fixture); covered by code-reading + the guard tests above. Noted for a
  future monitor-replay spec if one lands.
- CI GREEN — `CI_SCOPE=both tools/ci.sh`, pg stages included
  (api_test 236/236 per backend parity harness), 415s. Receipt tree
  `a8f5c572801ee59b9447466046fa633c2ed89f4f` = commit `1167d6a2`'s tree
  exactly.

## Cross-ref notes for REQ-0289
Its 2026-08-10 amendment expects R-during-drag/float to re-point at the
Unit-pivot path when 0289 lands: swap the `rotateShortcut` closure's body
(board/commits.ts) — the trigger layer (inputShortcuts.ts) needs no
change. 0289's "R while floating" gate can then reuse
input-conventions.spec.ts's float test wholesale.
