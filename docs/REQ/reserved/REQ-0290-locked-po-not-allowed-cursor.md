# REQ-0290 — not-allowed cursor + lock affordance on fixed/locked interiors

## Status
draft (spec by orchestrator session 2026-07-22; awaiting user ratification).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`.

## Origin (user directive, 2026-07-22, chat — verbatim)
「POが固定化されているUnitの上にマウスカーソルがある場合、Xにカーソルをして
ください。動かせない、回転させられないことを明確にしてください。」
Translation: when the cursor is over a Unit whose POs are fixed, show the
"X" (not-allowed) cursor; make it unmistakable that they cannot be moved or
rotated.
Reading (recorded): "Unit whose POs are fixed" = the starter units — locked
BPs (REQ-0209) whose interiors are REQ-0051 `fixed` POs. The affordance
belongs on the immovable INTERIOR pieces; the bag itself stays grabbable
(see non-goal below).

## Current state (verified)
- Every placed PO's hit rect sets `cursor='grab'` (BoardRenderer.ts ~L800)
  even when `p.fixed` — the refusal only surfaces AFTER the click as a red
  flash (handlePOPointerDown short-circuit, ~L1312-1315). Seated SIs also
  present `cursor='grab'` (~L1220) even inside a locked BP where unseat is
  engine-refused (engine.js seatSI/stow guards `why:'locked unit'`,
  ~L414-424).
- Engine truth: `p.fixed` (REQ-0051, move+rotate+stow refused, engine.js
  ~L145-156, L370), `bp.locked` (REQ-0209: NO interior op; BP-level move/
  transfer AND rotateBP stay legal BY DESIGN). `poInLockedBP` exists but is
  module-internal (engine.js ~L164-172).

## Design (binding)
1. **Cursor.** `cursor='not-allowed'` on: (a) the hit rect of every PO with
   `p.fixed`; (b) the hit graphic of every SI whose current seat host PO
   sits in a locked BP; on BOTH boards (fixed/locked travel through refs —
   REQ-0209 §2). Everything else keeps 'grab'.
2. **Pre-click honesty for SIs.** Mirror the fixed-PO short-circuit: a
   pointerdown on an SI per (1b) never starts a carry; it red-flashes its
   cell (ghosts.ts `flash()`), exactly like fixed POs today — the engine
   refusal stops being a drop-time surprise.
3. **Persistent lock glyph.** Every `p.fixed` PO wears a small padlock:
   9px Text `🔒` fill `#f2fbff` alpha 0.85, anchored inside the TOP-RIGHT
   corner of its footprint bbox, drawn into `gBadges`, `eventMode='none'`.
   (Same corner as REQ-0287's shared ribbon: when both render, nudge the
   padlock one cell-corner inward — deterministic offset, no overlap.)
   No per-cell spam: one glyph per PO, none per SI (their cursor+flash
   suffice), none on the BP (it is NOT locked for move/rotate).
4. **Engine surface.** Export `poInLockedBP(st, po)` (+ the page-container
   twin, engine.js ~L939 area) on the engine API + shared/engine.d.ts, so
   the client asks the engine instead of re-deriving lock topology.
   No behavioral engine change.

## Non-goal — do NOT over-lock (binding)
The unit core, ✥ badge and empty-cell handles of a locked BP keep
`cursor='grab'`: BP move, BP transfer and Unit-pivot rotation remain LEGAL
on locked starter units (REQ-0209 design: "rotation-only interiors, bag
freely movable"). Only interior pieces signal not-allowed.

## Implementation notes
Pure client + engine-surface-export change. Sites: placed-PO hit creation
(~L795-805), SI draw/hit (~L1213-1230), handleSIPointerDown-equivalent
guard, gBadges glyph. Reuse `this.deps.engine`; zero new state.

## Gates
- `ci.sh` green; engine tests: exported poInLockedBP parity with the
  internal predicate (canvas + page).
- e2e on decade **7900-7909** (`e2e_harness_req 0290 …`), starter-squad
  fixture: probe seam (extend REQ-0287's or add `cursorProbe:
  {uid, cursor}[]`) asserts not-allowed on fixed POs + locked-seated SIs,
  grab on unit core/badge/empty cells; pointerdown on locked-seated SI
  leaves no carry + flashes; padlock present exactly once per fixed PO.
- Screenshots under `web/preview/req-0290/`.

## Dependencies
None hard. Corner-nudge interplay with REQ-0287 (if 0287 lands first, honor
its ribbon; else the ribbon honors the padlock — whichever lands second
implements the nudge).
