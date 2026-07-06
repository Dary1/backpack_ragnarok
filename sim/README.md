# sim/ — REQ-0036 P1-A Combat Simulator

This directory implements the combat simulator described by
`combat_spec_draft.md` v0.3 (RATIFIED), sections S1-S9. It is a
framework-free, dependency-free (beyond a read-only interop with
`mock-src/engine.js`) CommonJS module: `sim/combat.cjs`. Tests live in
`sim/tests/run.cjs`.

## Module layout

- `sim/combat.cjs` — the public FACADE (REQ-0047 (d): the implementation
  was decomposed VERBATIM into `sim/lib/{core,rng,heap,geometry,formation,
  status,compile,entry,ray,field,replay,skills,packs,encounter,dungeon}.cjs`,
  acyclic; the export surface below is unchanged and the replay-determinism
  contract is frozen by `sim/tests/goldens.cjs`). The core covers:
  tunables table, seeded RNG, event heap, ray-geometry primitives, box
  parser + formation defs, status system, compile pass (buff folding +
  field-cell placement), entry-cell selection, ray walker, field/occupancy
  helpers, replay-log helpers, actor wrappers, skill firing, enemy pack
  compilation, skill scheduling, `runEncounter`, `runDungeon`.
- `sim/dungen.cjs` (REQ-0043) — dungeon auto-generation.
  `generate(dungeonType, level, seed)` returns a dungeon def in EXACTLY
  the shape `runDungeon` consumes. Two types: `'default'` (procedural --
  pack count/composition scaled by level via the pack grammar below, 0-2
  traps, 0-1 hidden-door chain, 0-1 chest, boss final; deterministic --
  same (type,level,seed) always yields a byte-identical def) and
  `'test_fixed'` (returns batch-002's own hand-authored `dungeon.json`
  VERBATIM, generator-independent of level/seed -- for tests/dev that
  want a known, stable spawn sequence). Uses `combat.cjs`'s own
  `makeRng`/named-sub-stream discipline and `packBudgetForLevel`/
  `PACK_RARITY_WEIGHTS` (previously exported but unused outside tests --
  this module is their first real consumer, per `combat.cjs`'s own
  Interpretation #2 note that pack-budget wiring was left to "a future
  content-generation tool").
- `sim/tests/run.cjs` — test suite (T()/eq()/ok() harness mirroring
  `mock-src/tests/run.cjs`'s style), ≥30 scenarios covering every category
  in the REQ-0036 P1-A task brief, plus REQ-0043's dungen determinism/
  level-scaling/test_fixed-passthrough coverage.
- `content/batches/batch-002-dungeon-pilot/` — starter content (dungeon
  def, enemies, formations, pilot items) used by the full-dungeon smoke
  test and available for future hand-authored content work.

Run tests with:
```
node sim/tests/run.cjs
```

## Engine interop invariant

`sim/combat.cjs` requires `../mock-src/engine.js` **read-only**. It only
ever touches pure/static functions from engine.js (nothing is called in
this file today beyond the module load itself — the compile pass
re-implements the small amount of shape/rotation math it needs directly
against plain-data snapshots, rather than calling into engine.js's
mutator API, so combat.cjs's own logic can be verified in total isolation
from engine.js's internal state machine). It **never** calls an engine
mutator (`movePO`, `moveBP`, `rotatePO`, `seatSI`, `stowSI`,
`invMovePO`, etc.) and **never** shares a mutable object reference back
into engine state. Every unit "snapshot" handed to `compileUnitSnapshot`
is deep-copied first (`JSON.parse(JSON.stringify(...))`), so nothing in
this module can mutate a caller's original state object. Combat/HP/damage
logic lives entirely in `sim/combat.cjs`; engine.js's only combat-adjacent
addition (REQ-0036 P1-A commit (a)) is the pure read-only accessor
`bpHpMax(st, bpId)`.

## Spec sections implemented

- **S1** Resolution model: event-driven continuous time (`EventHeap`,
  `(t,seq)` tie-break), seeded RNG with named sub-streams (`makeRng`),
  determinism guarantee (pure function of snapshot+defs+seed), compile
  boundary (`compileUnitSnapshot` folds static topology + buffs once;
  `runEncounter`/`runDungeon` simulate live events), replay log
  (`toJSONL`, event objects).
- **S2** Formation field: two independent A1:Z18 planes (`FIELD_ROWS`,
  `FIELD_COLS`), ray geometry (`DIR_VEC`, `EDGE_DIRS`, `reflectDir`,
  `stepCell`, `outside`, `mult`), termination via step budget.
- **S3** Ray resolution algorithm: `walkRay` implements the verbatim
  pseudocode (penetration, boundary reflection independent of
  penetration, 5th-bounce all-field strike, per-PO detection bounce
  budget, AOE splash via `fireSkillRay`'s `splashFn`).
- **S4** Skills & attack-profile: `attack_profile` schema consumed as
  plain data on effects (no new vocab), entry-cell selection
  (`selectEntryCell`, `centroidRoundHalfUp`), enemy def schema v2
  (`compileEnemyPack`), telegraph (emitted at fire-time, see
  Interpretations), pack grammar (`compileEnemyPack` places enemies by
  footprint; `packBudgetForLevel` invented per Interpretations).
- **S5** Formations as content: `FORMATIONS` table with all 4 defs
  (`parseBox` parser, 8x8 box validation at module load), formation4 uses
  the CORRECTED `J11:Q18` box.
  boxes.
- **S6** Encounter types: `runEncounter` handles pack/trap/door/chest/boss
  via `encounterDef.type`/`encounterDef.mode`; mode filtering implemented
  in the scheduling loop (see Interpretations: pause/resume mechanism).
- **S7** Status system: `applyStatus`, `cleanse`, `cadenceMultiplier`,
  `weaknessMultiplier`, `isStunned`, `tickStatuses`, `consumeSpikes` — all
  8 statuses and the 5-rule interaction matrix implemented exactly as
  tabulated.
- **S8** Run integration: `runDungeon` — progress accrual
  (`computeEncounterDeltas`), shortcuts (`SHORTCUT_JUMP_PCT_RANGE`),
  rewards (`distributeRewardsUniform`), wipe/level-down
  (`levelDownOnWipe`), cooldown (`cooldownForH`). BP HP threaded through
  the same mutable objects across all encounters in one `runDungeon` call
  (permanent attrition within a run).
- **S9** Locked defaults: all OQ1-OQ19 locked rulings referenced inline in
  code comments at their point of use (grep for `OQ` in `sim/combat.cjs`).

## Spec note correction (P1-B chore -- corrects a P1-A misdiagnosis)

P1-A's original note here (titled "Spec truncation finding") claimed
`docs/combat_spec_draft.md` was genuinely truncated mid-sentence at line
555, with S10/S11 missing from the source document entirely. **That
diagnosis was wrong.** The real, filesystem-hosted `combat_spec_draft.md`
is a complete 615-line v0.3 document -- S9's locked-defaults table runs to
completion and section 10 (tunables) exists in full. What P1-A actually
hit was a **stale sandbox-mount read**: the sandbox this repo's dev work
runs in mounts `docs/` from a separate filesystem, and at the time of the
P1-A pass, that mount was serving a cached/older byte range of the file
(555 of 615 lines, cut off mid-table-row) rather than its then-current
contents. The server itself never had a copy of this doc at all (`docs/`
is not part of this git repo -- combat_spec_draft.md lives only on the
docs filesystem), so there was no way for P1-A to cross-check the
sandbox's read against a second source at the time.

This matters only as a documentation-accuracy correction, not a
functional one: every constant the real S10 holds was independently
already recovered inline in the Tunables table below (each cross-checked
against the P1-A task brief's verbatim `[TUNABLE]`/`[LOCKED OQn]` quotes),
and the real S10 table matches this reconstruction exactly -- so nothing
in `sim/combat.cjs` or this table needs to change as a result of this
correction. The fix here is purely: stop asserting a false claim about
the source document's completeness.

## Tunables table (reconstructed S10)

| constant | value | spec citation |
|---|---|---|
| `RAY_STEP_BUDGET` | 512 | S2.3: "capped by a [TUNABLE step budget = 512] total steps" |
| `ENTRY_JITTER_HALF_WIDTH` (J) | 2 cells | S4.3 step 4: "half-width J [TUNABLE J=2 cells]" |
| `TELEGRAPH_LEAD_SECS` (L) | 0.6s | S4.5: "fixed lead L [TUNABLE L=0.6s]" |
| `PACK_RARITY_WEIGHTS` | common .70 / magic .25 / rare .05 | S4.6: "[TUNABLE weights common .7/magic .25/rare .05]" |
| `STATUS_TICK_PERIOD_SECS` (P) | 1.0s | S7 table: "period P [TUNABLE P=1.0s]" |
| `CHILL_STACK_CAP` (C) | 10 | S7 table: "cap C [TUNABLE C=10]" |
| `CHILL_PCT_PER_STACK` | 4%/stack | S7 table: "[TUNABLE 4%/stack]" |
| `HASTE_PCT_PER_STACK` | 4%/stack | S7 table: "[TUNABLE 4%/stack] (dual of Chill)" |
| `WEAKNESS_PCT_PER_STACK` | 5%/stack | S7 table: "[TUNABLE 5%/stack]" |
| `SHORTCUT_JUMP_PCT_RANGE` (J) | [15, 25] | S8.3: "+J% [TUNABLE J=15-25%]" (kept as a range, see Interpretations) |
| `FAILURE_STEP` | 1 level | S8.5: "failure_step default 1" |
| `LEVEL_MIN` | 1 | S8.5 implies a floor; spec doesn't give a number, chosen as 1 |
| `CD_MIN_SECS` | 60s | S8.5: no numeric default given — PLACEHOLDER, see Interpretations |
| `CD_MAX_SECS` | 600s | S8.5: no numeric default given — PLACEHOLDER, see Interpretations |
| `PACK_BUDGET_BASE` / `PACK_BUDGET_PER_LEVEL` | 100 / 15 | S4.6: no formula given — invented linear scaling, see Interpretations |
| encounter Δ% scheme | even split, boss closes to 100 | S8.1: no numbers given — invented scheme, see Interpretations |

## Interpretations (every judgment call, per the AMBIGUITY RULE)

1. **CD_min/CD_max numeric values.** The spec gives only the cooldown
   formula shape (`CD_run = CD_min + (CD_max-CD_min)*(1-H)`), never
   numbers. Chosen placeholders: `CD_MIN_SECS=60`, `CD_MAX_SECS=600`.
   Flagged as TUNABLE-PLACEHOLDER in code comments.
2. **Pack budget formula.** S4.6 says only "bounded per encounter
   difficulty so packs scale with sortie level [TUNABLE]" with no
   formula. Implemented as a simple linear scaling:
   `budget(level) = PACK_BUDGET_BASE + PACK_BUDGET_PER_LEVEL*(level-1)`
   (`packBudgetForLevel` in combat.cjs). Not yet wired into pack
   generation logic beyond being exported for a future content-generation
   tool (P1-A's scope is the sim + hand-authored starter content, not a
   procedural pack generator).
3. **Δ%-per-encounter scheme.** S8.1 says only "Each cleared encounter
   grants Δ% from its def [TUNABLE]; schedule sums a clean run to 100%."
   with no numbers. Implemented in `computeEncounterDeltas`: 100% is split
   evenly across all non-boss encounters in the dungeon's encounter list,
   and the boss's own delta is whatever value exactly closes the running
   sum to 100 (consistent with S8.2's "boss pinned at 100%").
4. **Shortcut jump J value.** S8.3 gives a *range* ("+J% [TUNABLE
   J=15-25%]"), not a point value. For consistency with how every other
   `[lo,hi]` authored range in this spec is resolved (via the seeded RNG
   at the moment of use), this was kept as a range
   (`SHORTCUT_JUMP_PCT_RANGE=[15,25]`) and rolled from a dedicated
   `"shortcut/<encIndex>"` sub-stream, rather than picking one fixed
   number.
5. **bpHpMax values for the 4 scenario BPs** (commit (a)). alpha/beta/
   gamma (each 6 footprint cells) → `hpMax=90`; delta (4 footprint cells)
   → `hpMax=60`. Scaling logic: 15 HP per footprint cell, applied
   uniformly (6*15=90, 4*15=60). Chosen as a simple, documented,
   footprint-proportional scheme since the spec (VX-1) only says BPs get a
   flat hpMax field, without prescribing values.
6. **RNG algorithm choice.** djb2 string hash (`masterSeed + "|" +
   streamName`) feeding a mulberry32 32-bit PRNG, one independent
   generator instance per distinct stream name (cached in a `Map` inside
   `makeRng`). Not cryptographic — S1.2/OQ1 explicitly says this is
   acceptable (no cross-platform bit-identical replay requirement,
   server-only authoritative sim, spectators replay the log rather than
   re-simulating).
7. **JSONL event schema fields beyond the spec's literal example.** The
   spec's S1.5 example shows `encounter_start`, `telegraph`, `ray_fire`,
   `ray_step`, `ray_bounce`, `ray_hit`, `ray_aoe`, `encounter_end`. This
   implementation adds: `ray_hit_all` (5th-bounce all-field strike),
   `ray_abort` (step-budget guard, per S2.3), `ray_end` (detection-mode
   bounce-budget exhaustion with no discovery), `apply_status`,
   `status_tick` (periodic DoT/HoT/cadence-decay application),
   `reflect_damage` (Spikes), `progress` (S8.1 0-100% run progress),
   `shortcut` (S8.3 door-solve jump), `run_end` (S8 run-level summary:
   result/final_pct/party_bp_hp/H). All additions are documented here and
   are additive to, never in conflict with, the spec's literal fields.
8. **Masking mechanism for "?" entities.** An entity flagged `masked:true`
   (detection targets, undiscovered hidden-door stage1 targets) has its
   real `id` replaced with the literal string `"?"` in every event field
   that references it (via the `maskLabel(entity)` helper), until a
   discovery event fires and the entity is revealed. This satisfies S6.2's
   "position MASKED in replay/spectate log until discovered" requirement
   without needing a separate spectator-vs-server event stream — the
   masking is applied uniformly at event-construction time.
9. **Participant modeling for reward distribution.** `runDungeon` takes a
   flat `participants: string[]` array of abstract participant/owner ids
   — there are no real player/room objects in this sim-only piece.
   `distributeRewardsUniform` draws a uniform-random index (from a
   dedicated `"rewards/distribute"` sub-stream) per reward item and
   assigns it to that participant, landing in an abstract `'warehouse'`
   destination. P1-B (the schedule service) is expected to map these
   abstract ids to real room members and wire the actual warehouse
   storage.
10. **Mode-filter pause/resume mechanism (S6.2).** Rather than tracking
    absolute "next fire time" per effect across encounter boundaries, each
    schedulable effect's timer is **re-anchored** to the new encounter's
    start time the moment a matching-mode encounter begins
    (`scheduleEffect(..., encounterStart, ...)` in `runEncounter`).
    Effects whose modes don't match the active encounter are simply never
    scheduled at all while that encounter runs (no timer object exists for
    them), so there is nothing to "pause" or "backlog" — when a later
    matching-mode encounter opens, they get a fresh timer anchored to that
    encounter's own start. This guarantees elapsed wall-clock time in a
    non-matching encounter never counts for or against a paused effect,
    satisfying S6.2's "does NOT accumulate a backlog" requirement.
11. **Buff-folding combination formula (S1.4 OQ2 "fold everything").** The
    spec never gives an exact combination formula for `buff_host` /
    `buff_self_per_tag` / `buff_adjacent`. This implementation resolves
    each qualifying buff's own `[lo,hi]` range to a scalar once (via a
    dedicated `"compile/buff/<uid>"` sub-stream, frozen at compile time),
    then combines all qualifying contributions **additively** as a single
    flat bonus added to the base `strike`/`multi_strike` damage range, in
    this fixed order: `buff_host` (self) → `buff_self_per_tag` (same-BP
    tag count) → `buff_adjacent` (Chebyshev-adjacent-BP tag count). This
    is applied once, frozen, matching "fold everything" — no buffs
    recompute mid-encounter.
12. **Boundary-reflection corner-case handling.** When a ray's next step
    lands out-of-bounds on both axes simultaneously (a true corner hit),
    `reflectDir` flips **both** the row and column components of the
    direction vector (rather than picking one arbitrarily), since the
    spec says "handle by flipping whichever boundary(ies) were crossed."
13. **Top/bottom edge's inherent 2-direction fan.** S2.2 says top edge
    rays can go down-left OR down-right (bottom: up-right OR up-left), but
    only describes the deterministic-choice-via-`u0`-draw mechanism for
    *edge* selection when `attack_profile.edge` lists more than one edge
    (S4.3 step 2). It does not separately specify how to choose between an
    edge's own two inherent diagonal directions. This implementation
    deterministically consumes one more draw from the same `.../ray`
    sub-stream (after the edge-jitter draw) to pick between the two, kept
    isolated within the ray sub-stream per S4.3's isolation requirement.
14. **Telegraph timing as a display concern, not a sim-timing concern.**
    S4.5 describes telegraph lead time `L=0.6s` as something a live
    monitor UI would show before a skill fires. Since `runEncounter` is a
    batch/offline sim (not a live streaming monitor), the `telegraph`
    event is emitted into the replay log at `max(0, fireTime - L)`
    immediately alongside the `ray_fire` sequence, rather than requiring a
    separate real-time monitor process — a spectator UI (out of scope
    here, P1-C's concern) can replay the log and still see the telegraph
    line arrive `L` seconds before the corresponding `ray_fire`.
15. **Pack/enemy placement on the enemy field.** The spec doesn't specify
    exactly how multiple pack members are laid out within the enemy
    field's shared A1:Z18 plane (footprint cells are given per-enemy, but
    not an overall pack layout algorithm). `compileEnemyPack` places pack
    members left-to-right starting from a supplied field-region's
    top-left corner, wrapping to the next row when a member's footprint
    would overflow the region's right edge. This is a simple, documented,
    deterministic placement — a real pack-role-aware layout (anchor
    back/line front, per S4.6) is left as a documented gap for P1-B/future
    work, since S4.6's role-to-template mapping doesn't give exact
    coordinates either.
16. **Enemy-skill attack_profile fallback.** If an enemy skill def doesn't
    carry its own `attack_profile`, this sim defaults to
    `{edge:['top'], penetration:0, aoe:0}`. Every hand-authored enemy
    skill in the batch-002 starter content DOES carry an explicit
    `attack_profile`, so this fallback is a defensive default only.
17. **Player-side schedulable effects scope.** `runEncounter` schedules
    every PO effect whose trigger is `every_secs` as the sim's
    "auto-battle" firing mechanism (matching the spec's "auto-battle, no
    mid-run input" framing). Reactive triggers (`on_hit`, `host_on_hit`,
    `on_bp_damaged`, `passive`, `battle_start`) are handled either at
    compile time (buff folding, per OQ2) or are intentionally out of this
    pass's live-simulation scope — P1-A's task brief scopes the "S1-S8"
    feature set around the `every_secs`-driven ray-firing loop as the
    primary combat mechanism; reactive-trigger live firing (e.g. an
    on-hit lifesteal proc firing off of every ray_hit) is a natural
    extension but was not required by name in the task's test-category
    list and is flagged here as a scope note rather than silently
    skipped.
18. **Weakness/Haste "n" dual-purpose (stacks + duration).** S7's table
    gives Weakness/Haste a single `n` magnitude column that serves as both
    "stacks added" and "duration = n s (refresh)". `applyStatus` uses the
    same resolved magnitude for both the stack increment and the refreshed
    `remain` duration, since the spec's table doesn't separate these into
    two authored numbers.

## Content schemas (informal — `content/schema/` intentionally left empty
per grounding notes; documented here instead)

### `modes` field (vocab v5)
Closed list `["battle","detection","unlock"]`. Attached to PO defs and to
individual skill/effect objects via a `modes: string[]` field. Defaults to
`["battle"]` when absent (existing content is unaffected). An effect's own
`modes` (if present) overrides its owning PO's `modes` (see
`effectModesOf` in combat.cjs) — this lets a single PO carry multiple
effects gated to different modes if ever needed, though today's content
gates at the PO level.

### `attack_profile` (S4.2, VX-4)
```jsonc
{
  "edge": ["top"],        // one or more of: top | left | right | bottom
  "direction": "front",   // semantic label only, not consumed by ray math
  "penetration": 1,       // integer >= 0
  "aoe": 0,               // integer >= 0, Chebyshev radius on shared field
  "aoe_statuses": false,  // bool
  "bounce_budget": 3      // detection-mode only; ignored otherwise
}
```
Attached to an effect object as `effect.attack_profile`, or to a PO/enemy
def as a fallback `def.attack_profile` (used when an individual effect
omits its own).

### Enemy def v2 (S4.4, VX-2)
```jsonc
{
  "id": "gnoll_skirmisher", "name": "...", "hp": [40,60],
  "footprint": [1,1], "skills": ["bite","howl"],
  "i18n": {"en": {"name":"..."}}, "rarity": "common", "pack_role": "line"
}
```
`hp` is a `[lo,hi]` range rolled once per pack-compile via the `pack/hp`
sub-stream. `skills` is a list of skill-def ids (skill defs use the same
effect-AST shape as PO effects: `{trigger, verb, attack_profile?, modes?}`).

### Formation def (S5.1/S5.2)
```jsonc
{ "id":"formation2", "canvases": { "unit1":"J2:Q9", "unit2":"B6:I13", "unit3":"R6:Y13", "unit4":"J10:Q17" } }
```
Box strings parsed by `parseBox` (`colLetterToIndex`/`colIndexToLetter`,
A=1..Z=26). All 4 ratified defs are hardcoded in `FORMATIONS` and
validated to be exactly 8x8 at module load time.

### Dungeon def (informal, this implementation's own schema)
```jsonc
{
  "id": "niflheim_depths", "name": "...", "level_scaling": {...},
  "encounters": [
    { "id":"...", "type":"pack"|"trap"|"door"|"chest"|"boss", "mode":"battle"|"detection"|"unlock",
      "enemyPack": {"enemyIds":[...]},        // pack/boss
      "entityDef": {"id":"...","hp":20,"footprint":[1,1],"skills":[...],"timeout_secs":30,"masked":true}, // trap/door/chest
      "timeout_secs": 30, "deadline_secs": 90, "rewardItems": [...]
    }, ...
  ]
}
```
