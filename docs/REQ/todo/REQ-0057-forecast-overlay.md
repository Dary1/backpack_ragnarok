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

## Outcome (implemented 2026-07-12, branch `req-0057-forecast-overlay`)

**Status: BUILT** -- all gates green, not yet merged/deployed, awaiting user acceptance.

### Decisions taken at implementation time (user-confirmed before work started)
1. **Data source: the client walker, with a new content route** (spec-preferred
   route; the S4-B2 telemetry cache was NOT taken). The blocker the recon note
   flagged was real -- `/api/content` serves no enemy defs and no skill
   attack_profiles, and the client cannot walk a ray whose edge/pen/aoe it
   cannot see. Resolved with a new public read, `GET /api/schedule/forecast`,
   NOT by widening `/api/schedule/dungeons` (that payload is (type, level)-free
   and is fetched on every schedule load; folding a per-level profile list into
   it would make the common path pay for the rare one).
2. **Scope: full spec** -- canvas editor AND formation picker. The recon note's
   REQ-0097 collision warning did not materialise: the picker half rides inside
   `CreateRoomForm`, which REQ-0097's master-detail rework does not touch.
3. **Parity harness: node-side, `sim/tests/forecast_parity.cjs`** (REQ-0048
   precedent). No client unit-test runner was introduced; the walker is authored
   dependency-free in `shared/` so both runtimes consume the SAME source.

### What was built
- **`shared/forecast.mjs`** -- the fold. A verbatim port of `sim/lib/ray.cjs`'s
  `walkRay` (battle mode) with its four damage/HP callbacks collapsed into one
  pure `isOccupied(r,c)` predicate, plus the geometry primitives and the
  **analytic marginalisation** of `sim/lib/entry.cjs`'s `selectEntryCell`. The
  RNG is not sampled: sim makes exactly three ray-stream draws (edge, jitter,
  diagonal), each has a closed form, so the fold enumerates every outcome with
  its exact probability. ESM, so the client imports it unforked through Vite and
  node `await import()`s it in sim/tests. Dependency-free per `shared/README.md`.
- **`server/lib/forecast.cjs`** -- the content half. `(dungeonType, level)` ->
  ray profiles, by running `dungen.generate()` over a fixed ladder of 24 seeds
  and compiling each battle encounter's pack with the **sim's own**
  `compileEnemyPack`, so attacker placement (hence centroid, hence ray entry
  projection) is the real thing and cannot drift. Memoised off
  `getScheduleContent()`'s object identity -- no second mtime path to disagree
  with. `services/core.cjs` gains a `skillNamesById` SIBLING map (not extra
  fields on `skillDefsById`, which is handed straight to `compileEnemyPack`
  where REQ-0121's `buff_self` fold mutates it in place).
- **`client/src/forecast/`** -- `ForecastOverlay` (heat layer + tooltip),
  `ForecastPanel` (toggle, the four inputs, legend, disclaimer),
  `SlotPressureSummary` (the picker's per-slot ranking), `pressure.ts` (board ->
  occupancy bridge + memo), `forecastState.ts` (ephemeral pub-sub + payload cache).

### Interpretations (all deliberate; none change the ratified design)
- **Expected values, not rolls.** A verb's `[lo,hi]` folds to its midpoint; an
  `every_secs [lo,hi]` cadence folds to `1/midpoint` fires/sec. Output unit is
  **expected incoming damage per second**.
- **Per-cell counterfactual attribution.** sim damages an OCCUPANT (a whole BP);
  the overlay answers "what would a BP placed HERE eat?" -- so every in-field
  cell a ray ENTERS is credited at the bounce multiplier in force at that
  moment, while the BPs already on the board still block / consume penetration /
  land the ray exactly as in the sim. The map therefore shows the shadow your
  current backpacks cast, and moves as you move them. The one visible seam: sim
  excludes the LANDING OCCUPANT (all its cells) from its own AOE splash; cell-
  wise we can only exclude the LANDING CELL, since a would-be occupant's
  footprint is unknown.
- **The dungeon is marginalised over seeds**, because the seed does not exist yet
  while you are building. Profile `weight` = expected count of that attacker per
  battle. `test_fixed` is seed-independent, so it samples one seed.
- **Skills with no `every_secs` cadence are excluded** (battle_start passives,
  REQ-0078 `OnSquadBeenHit` retaliation riders that only exist if YOU hit first).
  A per-second pressure map has nothing honest to say about them; they are left
  out rather than handed an invented rate.
- **Status rays are tracked separately** (`statusRate`), not folded into the
  damage tint -- the REQ defines the tint as "damage-weighted". They still name
  themselves in the tooltip. Bounce multiplier scales damage only, mirroring
  `dealHitOnField` (a status ray lands the same stacks however far it bounced).
- **The tint normalises over the board's own [min,max], not from zero.** sim's
  5-bounce all-field terminator (`ray_hit_all`) lays a large FLAT slab of
  pressure under every cell; normalising from zero would spend the whole colour
  ramp on that slab and wash out the placement signal the overlay exists to
  show. The legend prints the TRUE dmg/s at both ends, so the compression is
  never hidden.
- **Attachments (traps/doors/chests) are excluded**: they fire in
  `detection`/`unlock` mode where "a hit IS the find, damage irrelevant", and
  REQ-0049 made them parallel objectives on a battle clock -- the battle they
  ride on is already counted.
- **Forecast != spoiler, structurally.** The route reads enemy DEFs and nothing
  else -- no room, no profile, no live seed -- so there is no hidden placement
  for it to leak. It is public/no-auth for the same reason `/api/content` is.
- **"Not a promise"** is enforced, not just documented: the panel is labelled
  *expected pressure*, carries an explicit distribution disclaimer, and the e2e
  asserts the words "safe"/"unsafe" appear nowhere in the forecast chrome.

### Gates
- `tools/ci.sh` (SKIP_PG=1 SKIP_E2E=1): **CI GREEN**. sim 112, goldens 12 (byte-
  identical -- the sim was not touched), S4 14, **forecast parity 16**, engine
  101, server api 155, typecheck, engine-type drift, vocab self-test, client
  build. `oxlint`: 0 errors.
- **New gate, `sim/tests/forecast_parity.cjs`** (wired into ci.sh as step 2.6):
  proves over **864 rays x 6 occupancy boards** that the overlay's walker is
  byte-equal to sim's `walkRay` -- cell path, landing, bounce count, abort flag,
  the 5-bounce all-field terminator, and the AOE splash's centre/radius/
  multiplier -- with exhaustive `reflectDir`, and, against **40k real
  `selectEntryCell` draws per config**, that the analytic entry distribution has
  sim's exact support and weights. It also PINS shared/'s copies of sim's
  FIELD/RAY/JITTER constants to the originals, so a sim tunable change fails CI
  instead of silently desyncing the forecast. (Coverage note: the corpus never
  reaches the 512-step abort -- on an 18x26 field a diagonal ray bounces five
  times long before that, so `ray_abort` is dead code in practice for BOTH
  implementations. Ported and asserted equal, not exercised.)
- **e2e `client/e2e/forecast.spec.ts`: 8/8 green.** Toggle renders / formation +
  slot switch re-walks / level refetch / tooltip names real skills from the live
  roster / **a real inventory->canvas drag still lands with the map up** (the
  regression that would mean the overlay had eaten the editor) / no safe-unsafe
  wording / perf budget / picker ranks the four slots.
- **Perf budget [TUNABLE 50ms] per recompute: met.** node, 4-squad fold: **17.5ms**
  (single squad 3-7ms). In-browser, `data-fold-ms` (stamped by the real shipped
  fold, not a re-implementation) asserted < 50ms across all four slots of a
  level-20 dungeon.
- **Full e2e suite: 148 passed, 3 failed -- all 3 pre-existing on master**,
  reproduced identically against the master bundle (`nav-routing`
  `.schedule-rooms-view`, `dex-card` deep-link, `schedule` monitor-freeze at
  full-file ordering). These are the stale-spec reds the recon note predicted;
  the three specs and the pages they exercise are byte-identical to master on
  this branch.
- e2e was run by serving the WORKTREE's `web/` on its own port
  (`E2E_STATIC_PORT=8821`) -- `backpack-web.service` and the main checkout were
  never touched. `E2E_PARALLEL=2` per the box-safety note; the box was idle (no
  art session).

### Commits (branch `req-0057-forecast-overlay`, off `09455a8`)
- `ffe0e47` (1/4) `shared/forecast.mjs` + `sim/tests/forecast_parity.cjs` + ci.sh
- `91b8f3b` (2/4) `GET /api/schedule/forecast` + `server/lib/forecast.cjs` + dto
- `c0f3f26` (3/4) the overlay, the panel, the per-slot summary, i18n + CSS
- `37f0e87` (4/4) e2e + `data-fold-ms`; also rewrites `server/lib/forecast.cjs`,
  which landed truncated in 2/4 (corrupt file transfer, caught by the api
  failing to boot under the e2e fleet -- content unchanged, it now parses)
- `a306e37` dist rebuild (`web/app/`)

### Follow-ups (NOT done here -- deliberately)
- **REQ-0055 weather affixes** are in the spec's parenthetical but that REQ is
  still in `draft/`. The payload has no affix field yet; adding one is additive
  when REQ-0055 lands.
- The canvas overlay folds with **only the current squad** on the field (the
  other three formation boxes are empty). That is the honest input in the editor,
  where no troop exists yet -- but it does mean the flat all-field term is
  heavier there than in a real 4-squad fight. If a troop-aware editor forecast is
  wanted later, `forecastPressure` already takes a full-field `occupied` set; only
  the caller needs to change.
