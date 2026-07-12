# REQ-0011: Seam-Contract Icon Regeneration + Single-Cell Scarcity Policy

- **Status**: Icons completed; scarcity policy recorded (migration mapping pending user)
- **Date**: 2026-07-02
- **Owner**: orchestrator + designer subagent

## Part 1 — Icon regeneration (user round-5a: "no gap at the joint")
- Root causes of the visible blade–hilt gap: (a) both icons had padding on their
  joining edges, (b) SVG <symbol> default preserveAspectRatio letterboxed non-square
  use-boxes, re-introducing vertical gaps even with flush boxes.
- Fix: designer subagent regenerated icon-blade / icon-hilt under a **seam contract**
  (blade ricasso 16u wide runs to viewBox bottom edge, zero padding, open outline;
  hilt collar 20u wide starts at top edge; pommel ball center fixed at (32,52) r=9),
  plus `preserveAspectRatio="none"` so the art stretches to its box exactly.
- Gem overlay repositioned to the contract pommel point (formula: cellTop +
  (CELL-8)·52/64). Deployed and verified in Chrome: the sword reads as one
  continuous piece; matches the user's reference image.
- **Principle recorded**: joining edges of Part icons are contracts — fixed widths /
  zero padding / anchor coordinates for overlays. Applies to all future Part art.

## Part 2 — Single-cell scarcity (user round-5b, policy decided)
- Recorded in PO golden v1.2 §3: minimize 1x1 POs (they trivialize dead space);
  migrate their roles to Accessories; PO size floor 2 cells (rare exceptions);
  hard-to-fit shapes are intentional. Rationale: Frozen Canvas setups persist ~a day
  of runs (unlike Backpack Hero's per-run reset), so packing effort is content and
  the Fit payoff should be earned.
- Orchestrator refinements [DERIVED]: friction stays manual-cheap/cognitive-costly;
  elemental reactors stay ≥2-cell POs to protect L1 grid chemistry; migration mapping
  for current roster proposed in chat, awaiting user verdict before mock v0.4.

## Pending
- User verdict on the roster migration mapping → then mock v0.4 rebuild.
