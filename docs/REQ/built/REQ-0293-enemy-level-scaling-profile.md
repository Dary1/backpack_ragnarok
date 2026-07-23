# REQ-0293 - Enemy Level Scaling Profile

**Status:** todo (design ratified by user 2026-07-23; cleared to implement)
**Slug:** enemy-level-scaling-profile
**Depends on / relates to:** REQ-0185 (dungeon roll), REQ-0256 (battle tick), REQ-0268
(corpus stat curves), REQ-0269 (balance-sim harness), REQ-0275 (enemy stat bands).

## Problem

Today a dungeon dive derives the encounter/gimic COUNTS from the dive level
(`sim/dungeon_roll.cjs`), but enemy STRENGTH is the authored monster_pack, fixed
regardless of level. `compileEnemyPack()` takes no level; `packBudgetForLevel()` is
exported-but-unwired (only the legacy `sim/dungen.cjs` reads it). There is no
mechanism by which the player-set attack level makes enemies stronger, and no
mechanism to normalise dungeons of different intrinsic strength.

## Target design (ratified)

Randomised-draw dive economy: the player sets one dial, an **attack level**
(`attackLv`); a dungeon is drawn; each dungeon carries a **baseDifficulty**. The
effective combat level is

    effLevel = attackLv - baseDifficulty

`effLevel` drives a per-field, data-driven **multiplicative (geometric)** scaling of
enemy stats. Authored enemy numbers are interpreted as the value AT the dungeons
baseDifficulty (i.e. `factor == 1` when `attackLv == baseDifficulty`).

### Why geometric (not linear)

Self-normalisation goal: for a fixed attackLv, the net result must not differ
dramatically across draws (minor theme affinity aside). Author each dungeons fixed
enemies on one common ladder G_f(X) = base_f * g_f^X, so a high-baseDifficulty dungeon
has intrinsically STRONGER fixed enemies. Then apply runtime factor g_f^(attackLv -
baseDifficulty). Net per field:

    net = G_f(baseDifficulty) * g_f^(attackLv - baseDifficulty) = base_f * g_f^attackLv = G_f(attackLv)

The draw (baseDifficulty) cancels; net depends only on attackLv. This exact
cancellation REQUIRES a ratio model: linear/additive G makes G(P)/G(B) depend on P and
B separately, not on the difference alone, so it cannot self-normalise. The runtime
ratio and the authoring-ladder ratio MUST be the same g_f (single source of truth).
`attackLv < baseDifficulty` needs no special case: factor = g_f^(negative) < 1 scales
the intrinsically-strong content DOWN to the players level.

### Everything scales (declared variables), or is explicitly flat

hp/dmg alone is too narrow (Chill strength, cadence, heal, future verbs leak draw
variance). Every numeric leaf of enemy/1 and skill/1 is a declared variable governed by
exactly one rule; "flat" (ratio 1) is itself an explicit declaration, so nothing is
silently un-scaled. A completeness gate enforces total coverage.

## Deliverables

### 1. content/scaling_profile.json  (schema "scaling/1")
Central, field-keyed manifest. Rules matched by path against numeric leaves; verb rules
discriminate on verb.t. Each rule: `kind` in {geometric, flat, step} with params
(`g` for geometric; `per` for step). Ratios are relative to baseDifficulty; a geometric
rules runtime multiplier for a value v (scalars and both ends of an [lo,hi] range) is
`v * g^effLevel`. `flat` => *1. `step` => integer +1 every `per` levels (for tactical
integer fields; v1 uses flat for these).

SHIPS NEUTRAL: v1 ships every rule as identity (geometric g=1.0 / flat), so output is
byte-identical everywhere. Real g values are a follow-up DATA edit gated by balance-sim
(REQ-0269) + the on-ladder check; they are TUNABLE-PLACEHOLDER until then. This mirrors
the codebases established "wired but neutral" pattern (packBudgetForLevel; provisional
bands).

Coverage for current live content (enemy.hp, enemy.footprint[flat/structural],
skill.trigger.every_secs.s, skill.verb[strike|multi_strike|charge_strike].n,
skill.verb[apply_status].n, skill.verb[heal_ally|lifesteal|bonus_vs_status].n,
skill.verb[*].{hits,mult,frac}, skill.attack_profile.{penetration,aoe}).

### 2. sim/lib/level_scale.cjs  (pure, RNG-free)
- `loadProfile(raw)` / `resolveRuleFor(path, verbT)` -> rule (first match wins).
- `factorFor(rule, effLevel)` -> number. `factorFor(_, 0) === 1` exactly for every rule
  (baseline identity); monotone non-decreasing in effLevel for geometric g>=1;
  deterministic (no RNG).
- `scaleEnemyDef(enemyDef, skillDefs[], skillIds[], profile, effLevel)` -> returns a
  scaled COPY of hp + skills, EXCEPT it returns the ORIGINAL shared references
  unchanged when every applicable factor === 1 (no profile, identity profile, or
  effLevel 0). This preserves REQ-0121s shared-skill-ref invariant and keeps goldens
  byte-identical at neutral. Range endpoints scale by the same factor (spread preserved).

### 3. Plumbing
- `compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, box, opts?)` gains an
  optional `opts = { scaling, effLevel }`. Absent/`scaling` falsy => no scaling (todays
  behaviour). HP scale is applied to `def.hp[0]/def.hp[1]` BEFORE the existing
  `hpStream.range()` draw, so the RNG stream order is untouched and factor 1 is
  byte-identical. Skills are scaled via `scaleEnemyDef` (shared-ref-preserving).
- Thread `opts` through `encounter.cjs` (runEncounter) <- `dungeon.cjs` (runDungeon).
  `runDungeon` gains optional `scaling` (profile) and computes/receives `effLevel`.
- `content/live/dungeon/dungeons.json`: add integer `baseDifficulty` per entry
  (initial = each entrys levelMin; documented tunable). Distinct from levelMin (draw
  gate) and levelMax (effLevel cap).
- `server/services/runs.cjs`: load scaling_profile.json; `effLevel = clamp(room.level -
  dungeonDefRef.baseDifficulty, ...)` capped by the dungeons levelMax span; pass
  `{ scaling, effLevel }` to `runDungeon`. COUNTS stay keyed off `room.level` (attackLv)
  via the existing `rollDungeon(dungeonDefRef, room.level, ...)` call -- counts must NOT
  key off effLevel or the cancelled draw-variance returns as total-volume variance.

### 4. Gates + tests
- `tools/check_scaling_coverage.cjs`: walk every numeric leaf reachable in the live
  enemy/1 + skill/1 content; FAIL if any leaf has no matching rule, or matches more than
  one. Wire into `tools/ci.sh` as a gate step. This makes "everything has a scaling"
  machine-enforced: a new verb/stat without a rule turns CI red.
- On-ladder check (advisory in v1, like check_stat_bands): each dungeons authored field
  ~= G_f(baseDifficulty) within tolerance; meaningful once real g + multi-tier content
  land. Ship as `--report` now.
- Unit tests (sim/tests/run.cjs): factorFor baseline-identity, monotonicity,
  determinism; scaleEnemyDef returns shared refs at neutral and correct scaled copies at
  effLevel!=0 with a synthetic non-identity profile; range-spread preserved; hp scale
  applied pre-roll.

## Decisions (mine, per user delegation)
- Geometric, per-field, data-driven; single g_f governs authoring + runtime.
- Scale MAGNITUDE, not cadence: `trigger.every_secs.s` ships flat (DPS growth via
  verb.n keeps the dps-proxy exact and timing/replay clean). s may become geometric<1
  later with ZERO code change (data only).
- Independent g_hp and g_dmg families allowed (each self-normalises independently).
- Ship NEUTRAL (identity) so this REQ carries no balance risk and no content re-author;
  real curves + on-ladder authoring + g tuning are a gated follow-up.
- Counts key off attackLv; strength keys off effLevel.

## Acceptance criteria
- All existing sim goldens (sim/tests/goldens.cjs, levels 1/3/5/8) byte-identical.
- Full sim suite + `pnpm test:quick` green.
- check_scaling_coverage gate green (total coverage) and wired into ci.sh.
- Unit tests prove the scaling math on synthetic non-identity profiles.
- No live balance change (identity profile).

## Out of scope (follow-ups)
- Real g values + per-dungeon curve tuning (REQ-0269 balance-sim).
- Authoring multi-tier dungeon content on the ladder + promoting the on-ladder check to
  a hard gate (REQ-0275).
- Player-facing attackLv UI / draw economy surfacing.
- Reward scaling by net difficulty.

## Gate results / commit hashes
**Built 2026-07-23** on branch `req-0293-enemy-level-scaling-profile` (base 71e6a34).

Commits:
- 8c82f62 scaling engine (level_scale.cjs) + neutral scaling_profile.json manifest
- a645cf1 thread scaling opts through compileEnemyPack/encounter/dungeon
- 0be4a2c baseDifficulty anchor on dungeon defs  (DATA reverted by 1387f79)
- a9efee1 wire scaling profile + effLevel into runs.startRun
- 11bf0a6 scaling coverage gate + ci wiring
- 1387f79 defer dungeons.json baseDifficulty DATA (promoted/registry-pinned file; anchor falls back to levelMin, byte-identical at v1-neutral). NET diff does not touch dungeons.json.
- e7d85f5 unit tests on synthetic non-identity profiles

Gate results (all green, verified independently by the orchestrator after provisioning worktree deps):
- sim goldens (sim/tests/goldens.cjs): 12 cases byte-identical -- replay determinism intact at neutral.
- sim suite (sim/tests/run.cjs): 129 passed, 0 failed (incl. 8 new REQ-0293 tests + the REQ-0121 shared-skill-ref invariant).
- coverage gate (tools/check_scaling_coverage.cjs --gate): 14/14 live numeric leaves covered; --self-test OK; wired into ci.sh as [3.995/7].
- server typecheck (tsc -p tsconfig.server.json): 0 errors (pg/root deps were merely unprovisioned in the fresh worktree; not a code issue).
- pnpm test:quick (SKIP_PG/CLIENT/E2E ci.sh): EXIT 0 -- green through every non-skipped step.

Deferred (see Out of scope): real g values + per-dungeon curve tuning (REQ-0269); dungeons.json baseDifficulty DATA + on-ladder hard gate via re-promotion (REQ-0275).
