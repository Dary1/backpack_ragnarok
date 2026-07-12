# REQ-0141 — canvas-first-run-guidance

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** canvas-first-run-guidance
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/user_managed/game_golden.md` (P1/P2/P5),
`docs/user_managed/canvas_spec.md` (3 placement layers, Unit beams).

## Goal

The design is intrinsically deep: Canvas → BP → PO (tags, ports) → SI
(sockets) → Unit link beams. Review verdict: steepest UX risk in the product.
Teach it by doing — a first-run guided placement that reveals one layer at a
time (progressive disclosure), never a wall of text.

## Scope

- Guided first-canvas sequence: place a BP → drop a PO (see it fit) → witness
  a port connection → seat an SI in a socket → place a second BP + Units →
  first link beam ignites. Each step gated on the player actually doing it.
- Contextual hints thereafter (first time seeing: rotation, tag mismatch,
  dud beam) — dismissable, never modal-stacked.
- Skippable at any point; replayable from Settings; state in profile via the
  storage seam.
- Copy EN + `i18n.ja`. Empty-state copy shared with REQ-0140.

## Non-goals

No tutorialized combat (dungeon runs are schedule-driven; out of scope); no
rules-reference/codex screen (possible future REQ); no rebalancing.

## Gates

- e2e: fresh profile completes the guided sequence; skip path leaves a fully
  usable canvas.
- User playtest verdict green.
