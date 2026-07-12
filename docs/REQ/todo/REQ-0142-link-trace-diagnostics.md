# REQ-0142 — link-trace-diagnostics

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** link-trace-diagnostics
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/user_managed/game_golden.md` (P2 "The Moment is sacred"),
`docs/user_managed/canvas_spec.md` (beams, first-hit rule, mutual links),
REQ-0050 (S4 simulate gate — runtime sibling of this edit-time REQ).

## Goal

Beam legibility is the load-bearing wall of P2: all tension lives in
arrangement, so the player must be able to READ and DEBUG the beam graph
before sortie. With 8-direction beams, first-hit-only resolution and mutual
links, unaided spaghetti is guaranteed at squad scale. Make beam reasoning a
first-class UI capability.

## Scope

- Hover a Unit (or a beam segment): highlight the full ray path per direction —
  origin, traversal, first-hit receiver; dim unrelated beams.
- "Why not" diagnostics for expected-but-absent links: blocked by X at cell
  (first-hit consumed), no receiver on ray, direction not in the Unit's set.
  Rendered in the tooltip/detail panel, plain language, EN + `i18n.ja`.
- Mutual-link badge on qualifying pairs; dud-beam styling (intentional duds are
  a legitimate design per canvas_spec — mark, don't nag).
- Implementation: renderer overlay + read-only engine queries. Engine consumed
  AS-IS; no mutators. Coordinate with the planned `BoardRenderer.render()`
  rework (~690 LOC, architecture.md §"left for the upcoming UI rework").

## Non-goals

No combat-time visualization (REQ-0050 territory); no engine changes; no
auto-suggest/optimizer (P5 The Unreplicable Self — do not solve layouts for
the player).

## Gates

- e2e scenarios: hover trace + all three "why not" reasons render on canonical
  layouts (mutual link, dud, blocked chain).
- User acceptance on the canvas.
