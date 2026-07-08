# REQ-0028 — solve() Rotation Tie-break + Aspect-Ratio Law

- **Status**: IN PROGRESS
- **Date**: 2026-07-04 (orchestrator gen2)
- **User rulings**: (1) fix the reference's solve() (user-proposed; investigation showed
  it's a 1-line tie-break issue); (2) FORBID aspect-ratio changes everywhere —
  "縦横比を変えて良い状況はありません" (art_golden v3.2).

## Investigation findings (recorded)
- Reference solve(): strict `>` improvement + floor pruning that probes only ABOVE the
  incumbent ⇒ scale ties always keep the FIRST candidate in search order
  k=0(CCW0)→1(CCW90)→2(180)→3(CCW270=CW90). Tall-art-in-wide-region makes k=1 and k=3
  scale-identical ⇒ CCW always wins ⇒ the 4–5 icons the user saw rotated CCW.
- The reference NEVER distorts aspect (uniform `s`; `s_hi=min(H/h,W/w)`) — that is
  exactly why rotation correctly beats no-rotation (~100% vs ~50%) with no tie.
  Aspect preservation therefore cannot break the CCW/CW tie; the k-order fix can.
- Distortion risk lives in ADOPTION/RENDER layers only: fix_icon raw CLI path
  (anisotropic squish), mock/client `stretch` draw + mergeSword independent w/h,
  `<use>` rendering of aspect-mismatched viewBoxes.

## Changes
1. Reference amendment (user-sanctioned): `for k in range(4)` → `for k in (0, 3, 1, 2)`
   in solve() ⇒ tie-break order rot0 > CW90 > CCW90 > 180. Reference header bumped
   ("v2, tie-break amended per user directive 2026-07-04"); git preserves v1.
2. Port synced; parity tests updated + new tie-break test (symmetric tie ⇒ k=3 chosen).
3. Aspect law enforcement: fix_icon raw path made aspect-preserving; CHECK keeps
   aspect-mismatch as structural FAIL; renderer audit (mock ui.js + client
   BoardRenderer stretch/mergeSword) — any anisotropic scaling replaced by uniform
   contain-fit.
4. Fixer re-run from the pre-rotation art (the 5 structural symbols) with amended
   solve ⇒ CW orientation ⇒ `content/sprite_all_v8.svg`; mock + client rebuilt on v8;
   preview/fit pages regenerated; contact sheet v7 vs v8 to FS tmp/fit_report/.

## Gate
Parity suite green (incl. new tie-break test); fit CHECK 14 PASS/0 FAIL; engine 18/18;
API 9/9; check:sprites 21/21; pages 200; orchestrator visual review of v8 orientations.
