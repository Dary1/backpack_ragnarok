> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0057 — Ray Forecast Overlay ("weather map") — priority LOW

- **Status**: ADOPTED by user (2026-07-06), explicitly **low priority** and
  unit-independent — QUEUED behind the unit/encounter/economy work.
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

## Implementation intel (2026-07-12 done-sweep recon -- work NOT started, no worktree/branch yet)

Recorded before pausing (user: annotate and stop). Verified facts vs open items
are marked; nothing below changes the ratified design.

**Data availability (verified against the live API):**
- GET /api/content serves keys {items, sis, tms, trees, scenario, layout,
  registry, vocab} -- NO enemy defs and NO skill profiles. The forecast needs
  per-(dungeon type, level) enemy skill profiles (attack_profile: edge /
  penetration / aoe), which today exist only server-side in
  content/batches/batch-002-dungeon-pilot/{enemies,skills}.json.
  => the client-walker route needs a small content/API addition (e.g. skill
  profiles on /api/content or on /api/schedule/dungeons), OR the S4-B2 route.
- GET /api/schedule/dungeons returns dungeons[] + types[] (+ REQ-0049 scouting
  payload); whether it can carry skill profiles was NOT verified -- first open
  question at implementation time.
- S4-B2 telemetry now EXISTS (REQ-0050 landed 2026-07-12): per-field path-visit
  heatmaps + side-entry damage share per formation are in
  sim/s4_baselines/default/summary.json. The spec's "alternative source:
  S4-B2 telemetry cache" is therefore no longer hypothetical; a static
  per-(dungeon,level,formation) cache could be baked by tools/simulate.cjs.
  Client walker remains the spec-preferred route (zero server state).

**Sim-side port surface (verified exports in sim/combat.cjs):**
- walkRay + geometry helpers are all exported: DIR_VEC, EDGE_DIRS, reflectDir,
  stepCell, outside, mult (bounce multiplier incl. the 5-bounce all-field
  terminator), chebyshevDist, selectEntryCell, centroidRoundHalfUp, FORMATIONS,
  FIELD_ROWS=18 / FIELD_COLS=26. Semantics to preserve: penetration = occupied
  pass-throughs; AOE = Chebyshev splash; step budget 512 (ray_abort); entry
  jitter half-width J=2 [TUNABLE] (combat_spec section 10 constants table).
- REQ-0048 set the house precedent for cross-implementation parity tests
  ("sim linkEdges == engine.js traceBeams" in sim/tests/run.cjs) -- the
  overlay-walker parity test can follow that pattern.

**Client stack facts (verified):**
- client has NO unit-test runner (scripts: dev/build/lint(oxlint)/preview/e2e
  only; deps: pixi.js 8, react 19; no vitest/jest). The spec's byte-equal parity
  test needs a harness decision: (a) node-side test in sim/tests/ importing the
  walker (requires the walker be authored dependency-free and tsc-compilable to
  plain JS), or (b) introduce a client unit-test runner (new dep -- bigger
  footprint). Decide at implementation time; (a) matches REQ-0048 precedent.
- Board rendering: BoardRenderer.ts mount() = PAD 38 / CELL 80 (716x716 at 8x8);
  overlay tint = either a new Pixi layer there or a DOM layer in Board.tsx.
  Per-cell tooltip can reuse the REQ-0119 FloatingItemTip.tsx / itemTip.ts
  pattern. Toggle button belongs in CanvasChrome.tsx (REQ-0070 MJOLNIR chrome).
  Formation picker lives in the schedule room-create flow (per-slot summary
  display target).

**Process notes for whoever implements:**
- Schedule-page e2e specs are mid-rework (REQ-0097/0120 in flight; 4 known
  stale-spec reds on master as of 2026-07-12 -- see REQ-0049's landing note).
  Land the overlay's canvas-editor e2e first; formation-picker e2e may collide
  with REQ-0097's master-detail rework -- coordinate ordering.
- e2e on the shared box: E2E_PARALLEL=2 is the safe setting (P4 OOM-crashed the
  box 2026-07-12); the box also runs user art sessions (ComfyUI) -- check load
  before full-suite runs.
- Perf budget context: REQ-0050's full 131-dungeon matrix completes in seconds
  of node time; a single-board geometry fold (no statuses, no timing) is far
  under the [TUNABLE 50ms] budget -- estimate, not yet measured client-side.
