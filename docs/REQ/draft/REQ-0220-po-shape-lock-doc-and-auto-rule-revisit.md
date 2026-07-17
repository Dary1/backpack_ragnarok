# REQ-0220 — po-shape-lock-doc-and-auto-rule-revisit: fix misleading lock docs; re-decide auto's rule for full rectangles

**Status:** draft — AGENT-PROPOSED, awaiting owner review. Not cleared to implement.
**Reserved:** 2026-07-16
**Slug:** po-shape-lock-doc-and-auto-rule-revisit
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」. The proposal below is the agent's; no user ruling exists yet
on the substance. This is the follow-up REQ that REQ-0187's verdict named.

## Why (REQ-0187 S7 verdict, V2 = AMBER)

REQ-0186 defaulted `shape_lock=auto`, resolving to `off` for full-rectangle footprints, on the
stated basis that strict "flattens the heater shield into a plain disc" — i.e. off preserves
subject character on rectangles. REQ-0187 tested exactly this on a 2x2 `round shield`
(3 seeds off, 3 seeds strict via one-shot override) and the pictures do NOT support the basis:

- strict OUT-FIT off (median fit 81.3 vs 71.8, worst-cell 0.21 vs 0.32, 3/3 PASS both), AND
- strict KEPT full subject character (boss/rim/planks visible) — it did not flatten anything;
  off merely produced heater silhouettes that underfill the square.

Evidence: `content/batches/req0187-shape-conditioning/findings.json` + the six illustrative
renders committed there; verdict tables in `docs/REQ/done/REQ-0187-po-shape-conditioning-s7-verification.md`.

The awkward half of auto's rule HELD (L-tromino: strict 68.3 vs off 32.5 median fit, off spilled
123 px deep-overflow) — nothing here questions auto→strict for non-rectangles.

## What to do

1. **Docs correction (uncontroversial):** re-word the lock descriptions in REQ-0186's shipped
   surfaces (`item_content_pipeline.md` §0.1 and wherever the lock strings/tooltips live) so
   operators are not told strict destroys rectangle subjects. State what was measured instead.
2. **Rule decision (the user's):** for full rectangles, either (a) keep auto→off with an honest
   rationale (e.g. "off is cheaper: 15-50 s vs 76-130 s per render, and rectangles rarely
   misfit"), (b) flip auto→strict everywhere, or (c) gather more rectangle-subject evidence
   first (one shield is one data point). The cost asymmetry (V5: conditioned renders cost
   2-5x wall time on the shared 8 GB card) is a legitimate reason to keep off that REQ-0186
   never actually claimed — if the owner keeps off, the docs should say THIS, not the disproven
   character claim.

## Out of scope
- Any change to strict/guide mechanics; monster/si/unit shapes; re-running the matrix.

## Gates
- Docs no longer contain the disproven claim; the auto rule's stated rationale matches a real
  measurement or a real user ruling; if the rule changes, artwork_test + artadmin e2e green and
  a small A/B on one rectangle confirms no regression.
