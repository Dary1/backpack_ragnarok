> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0057 — Ray Forecast Overlay ("weather map") — priority LOW

- **Status**: ADOPTED by user (2026-07-06), explicitly **low priority** and
  linker-independent — QUEUED behind the linker/encounter/economy work.
- Origin: brainstorm batch 2 item 10; repays consultant-review weakness #2 (the
  placement↔combat legibility gap) with a tool instead of a tutorial.

## User spec
「採用です。リンカーは無関係でgreen。優先度低い。」

## Design
- Editor overlay toggle: for a chosen (dungeon type, level, formation [, weather
  affixes REQ-0055]), tint each canvas cell by **expected incoming ray intensity**
  (damage-weighted hit probability), so "where should the tanky BP go" is visible
  while building.
- **Computation**: client-side bounded mini-sim — walk the entry-cell distribution
  (edge × jitter J) × the dungeon's enemy skill profiles (edges, pen, aoe) over the
  formation's geometry, no statuses, no timing — a pure geometry fold, milliseconds.
  Deterministic; shares `walkRay` semantics with the sim (port the walker or
  transpile the identical function — parity test against `sim/combat.cjs` fixtures).
  Alternative source: S4-B2 telemetry cache served per (dungeon, level, formation);
  choose at implementation time by cost (client walker preferred — zero server state).
- Display: heat tint + per-cell tooltip (top contributing skills); works on both the
  canvas editor and the formation picker (per-slot summary = which squad slot eats
  the most). Respects "?"-masking (uses enemy DEFs, never a specific run's hidden
  placements — forecast ≠ spoiler).
- Not a promise: forecast shows the DISTRIBUTION (jitter, packs vary); label it
  "expected pressure", never "safe/unsafe" absolutes.

## Test plan
- parity: overlay walker vs sim `walkRay` on shared fixtures (byte-equal paths).
- squad: distribution math (edge weights × jitter clamp), affix modifiers applied.
- E2E: toggle renders, formation switch updates, tooltip content, perf budget
  (< [TUNABLE 50ms] per recompute).
