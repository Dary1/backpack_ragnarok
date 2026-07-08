# REQ-0029 — Art-Authoritative Ruling + Shape Transposition Investigation

- **Status**: DONE (Case A confirmed + staging data repaired; sprite v10)

## Outcome
**Case A confirmed**: engine convention is `[row, col]` (key=(r,c), cellsOf cited).
tool_fit_check/build_preview/build_fit_report read `[col,row]` — a guess from the
orchestrator's REQ-0019 brief, never verified against the engine (honest root cause:
orchestrator error). 12/14 shape masks were mis-measured; the "5 stale tall icons"
were a manufactured artifact — their art was correct all along. Fix chain:
1. Convention corrected in all three tools (engine cited as single authority);
   fixer now structurally REFUSES rotation/flip (escalation per art_golden v3.3).
   5 symbols reverted to pristine unrotated art. (9f12da5..fd0d6c6, sprite v9)
2. Re-check with correct masks exposed the next layer: batch-001 draft.json
   shapes/ports were ALSO transposed (authored under the old convention) vs both art
   and batch notes intent (e.g. frost_nail "3-tall vertical bar"). All 6 transposed
   back (per-item ink-density + notes cross-check, all AGREE); 4 needed
   translate/uniform-scale nudges → **sprite_all_v10.svg** (a8b7555, 6811624, c29713e).
Final: fit CHECK **14 PASS / 0 FAIL / 6 SKIP**, zero rotations applied anywhere,
original art fully respected. Parity 23/23, engine 18/18, API 9/9, sprites 21/21,
integrate 6/6, pages 200. Orchestrator visually reviewed the v9→v10 contact sheet.
- **Date**: 2026-07-04 (orchestrator gen2)
- **User ruling**: on a 90° scale tie (art/shape aspect mismatch), do NOT rotate the
  art. Respect the original design: the art is authoritative; fix the CELL SHAPE side
  (art_golden v3.3).

## Orchestrator's suspicion (to be verified first — evidence chain)
- Mock board: blade occupies a VERTICAL 2-cell footprint at rot0 (mergeSword requires
  blade.rot%4===0 and is active on the live board with scenario rotations).
- blade def: `"shape": [[0,0],[1,0]]` — engine evidently reads this as VERTICAL
  ((row,col) or (y,x) order).
- tool_fit_check's shape reading came from the orchestrator's REQ-0019 brief which
  GUESSED "[[col,row],...]" — if wrong, the tool transposes every non-square-bbox
  shape mask, and the "5 structural mismatches (tall art vs wide shape)" were
  manufactured by the tool, not by stale art. build_preview shapegrids and all
  v5/v6/v7/v8 fix computations for non-square-bbox items inherit the same suspicion.

## Branches
- **Case A (transposition bug confirmed)**: fix shape-reading in the adoption layer
  (tool_fit_check shape_to_cellset, build_preview/build_fit_report grids — engine.js
  is the single convention authority); REVERT the 5 symbols to their original,
  unrotated tall art (recoverable at 9090ddc); recompute ALL fit fixes against
  corrected masks (hilt/hoarfrost/glacier/etc. included — prior transforms were
  computed on possibly-transposed regions); sprite v9.
- **Case B (shapes genuinely wide in engine)**: apply the user's ruling literally —
  change the 5 items' shapes in content to match the original tall art, revert art to
  unrotated, adjust scenario placements as needed, revalidate.

## Fixer policy change (both cases)
Rotation prescriptions from solve() are no longer auto-applied; aspect-mismatch =
ESCALATION with "fix the shape or redraw" remedy. Tie-break k-order (REQ-0028) stays
in the reference (harmless, still correct for reporting).

## Gate
Corrected CHECK green for all symbols against engine-convention masks; engine 18/18;
API 9/9; parity suite green; check:sprites 21/21; pages 200; mock/client/preview all
consume the new sprite; contact sheet (old vs new) to FS tmp/fit_report/; orchestrator
visual review; honest record of the root cause (orchestrator brief error) here.
