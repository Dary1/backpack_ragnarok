# REQ-0010: Accessory Display Principles (round 4) → Mock v0.3

- **Status**: Completed
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Input
User placed reference images in `display_tmp/` (sword with acc shown / hidden; the
two PNGs are pixel-identical — treated as one reference) and three stated edits:
(1) visuals must hold up without the accessory, (2) slot indicator matches the
accessory's expected shape and place, (3) Ruby replaces the hilt's pommel ball —
visual and function match (it is a HILT accessory). Also: blade/hilt looked bad
separated — make the bond indicator short-and-wide and butt the parts against it.

## Principles extracted → PO golden v1.1 §5b
Diegetic slots / visual=function (attachment point defines mechanical host) /
complete-without-accessory / flush assembly with wide-short bond indicators /
two display modes (shown vs empty-indicator).

## Mock v0.3 changes (live: https://backpack-dev.qtie.jp/mock/ )
- Blade + Hilt now render flush as one continuous Longsword across A1–A3.
- Guard renders as a code-drawn crossguard bar (46×14) sitting ON the bond.
- Ruby moved from blade-corner badge → hilt pommel position (host reassigned to
  Sword Hilt; catalog/tooltips updated). No floating badges anywhere.
- New toggle "Accessories": ON = equipped visuals; OFF = dashed empty-slot
  indicators (guard band + pommel circle), hilt shows its own pommel ball.
- Verified in Chrome in both modes against the reference image.

## Ops notes
- FS sync issue confirmed worse: file OVERWRITES via Write tool may never reach the
  sandbox mount (polled 30s). Rule going forward: **always write NEW filenames**
  (mock_q1/q2/q3 this round), verify size via sandbox, then concat/deploy.
- Chat rule: never wrap URLs in markdown emphasis — `**(v0.2)` glued to the URL made
  it 404 for the user. Print URLs bare, whitespace-separated.

## Next
- User reviews mock v0.3. Then: Linker types/effects design, combat tick spec.
