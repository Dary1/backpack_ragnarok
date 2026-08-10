# REQ-0369 — Input conventions: keyboard shortcuts + unified modal behavior

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
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
