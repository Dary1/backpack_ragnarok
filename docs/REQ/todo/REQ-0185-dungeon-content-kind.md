# REQ-0185 — dungeon-content-kind: a dungeon is authored, PROBABILITY-WEIGHTED references to packs + gimics, rolled at dive time

**Status:** todo — ratified per the user ruling 2026-07-17 (below); cleared to implement.
**Reserved:** 2026-07-15
**Slug:** dungeon-content-kind (supersedes the reserved slug `dungen-registry-packs`)
**Branch / worktree:** `req-0185-dungeon-content-kind` (server, UNMERGED), stacked on
`req-0211-gimic-content-kind` (created from its tip; REQ-0211 not rebased).
**Requested by:** user, 2026-07-15: dungeons should be authored content, not a runtime graph
build. Refined by the ruling below.
**Depends on:** REQ-0184 (monster_pack kind — the `packId` seam), REQ-0211 (gimic kind — stable
gimic ids + `gimicDefsById` registry serving), REQ-0155/0157 (registry + admin), REQ-0174
(content_artwork_ref), REQ-0179 (custom art kind), REQ-0058 (sealed seeds), REQ-0057 (forecast).

## USER RULING (2026-07-17) — supersedes the draft's "pre-generated patterns" sketch

> 「dungeonは、gimicとmonster_packを確率参照して、設定してください」

A dungeon def is **authored content whose body is PROBABILITY-WEIGHTED REFERENCES to
`monster_pack` defs and `gimic` defs**. At dive time the server cheaply **ROLLS** a concrete
encounter list from those weighted tables (deterministic given a seed) — there is NO runtime
dungeon-graph generation on the request path. The draft's earlier "pre-generate N full patterns
offline, pick one" sketch is withdrawn: the def IS the (small, human-sized) probability space,
and the only roll left in the serving path is the weighted pick.

## Schema `dungeon/1` (the authored weighted-pool def)

One `dungeon/1` entry (in `content/live/dungeon/dungeons.json`, `{schema, entries:[...]}`, the
same multi-entry file shape `packs.json`/`gimics.json` use):

| field | notes |
|---|---|
| `id` / `name` / `i18n{en,ja}` | identity, as every kind (DUNGEON_LOCALES `{en,ja}`) |
| `theme` | a short theme key (`frost` / `grave` / `wild` / `venom` / `demon`) → glyph/accent in the sortie UI (design D2) |
| `levelMin` / `levelMax` | the recommended level BAND (display + lock hint; server does NOT gate on it — advisory, mirroring today's non-gating posture) |
| `dive` | `{ packEncounters:{base,perLevels,max}, gimicSlots:{base,perLevels,max} }` — how many BATTLE (pack) encounters and how many GIMIC attachments a dive rolls, scaled by level (below) |
| `packPool[]` | `{packId, weight}` — the weighted table of `monster_pack` defs the non-boss battles draw from |
| `bossPool[]` | `{packId, weight}` — the weighted table the single final boss battle draws from |
| `gimicPool[]` | `{gimic, weight}` — the weighted table of `gimic` defs a dive draws its attachments from. A `hidden_door` entry references the STAGE-1 (detection) gimic id; the roller pairs it with its `_stage2` partner by convention (REQ-0211: weight the PAIR as one entry) |
| `rewards` | optional `{pack, packHigh, chest, boss, trapDisarm}` roll-ids (resolve via `resolveRewardItemId`); defaults to the frost reward vocabulary |
| `note` | free-text authoring note |

Occupied cells, the concrete encounter list, and the per-dive counts are all **DERIVED at roll
time, never stored** — the same "one home per fact" doctrine as REQ-0184/0211. The pack layout
lives in `packs.json`; the gimic data lives in `gimics.json`; the dungeon def only holds
*references + weights + counts*. It inlines NOTHING (this resolves REQ-0211's hand-off of the old
`dungeon.json` inline entityDefs — see Open Q5).

## The roller — `sim/dungeon_roll.cjs :: rollDungeon(def, level, seed, {gimicDefsById})`

Deterministic (combat.makeRng, named sub-streams — the S1.2 discipline). Produces the exact
concrete shape `combat.runDungeon()` already consumes (`{id,name,i18n,theme,dungeonDefId,level,
rollSeed,encounters:[...]}`): `nPacks` pack encounters (each `enemyPack:{packId}` drawn from
`packPool`), a rolled set of gimic attachments distributed across them (cap 2/encounter, spilling
onto the boss — the REQ-0049 attachment shape), and the boss encounter (`bossPool`) pinned last.
Gimic → attachment resolution mirrors `dungen.cjs`'s own `trap/chest/door` builders VERBATIM,
only parameterised by gimic id: a `trap` → detection attachment, a `treasure` → unlock chest
attachment, a `hidden_door` → the door attachment built from its STAGE-2 fields (the sim drives
stage1→stage2 internally). ONE roller, shared by the sim serving path AND the forecast, so the
forecast can never forecast a composition the sim would not run (the parity contract).

## Resolution of the five Open Questions (decisions, 2026-07-17)

1. **Pool size + selection — weighted, with replacement, per pool.** The def author sizes the
   pools by hand (the whole point of authored content). Selection is `pickWeighted` over the
   pool's `weight`s (the same helper the gacha roll uses), independent per encounter slot. No
   "not-the-last-N" memory: the pools are small and human-curated, so repetition is the author's
   choice, not an accident. Rationale: keeps the roll a pure, cheap, seed-deterministic weighted
   draw — a SELECT, exactly the server-load win the REQ exists for.

2. **Replay / forecast parity — the forecast rolls the SAME def with the SAME roller.**
   `server/lib/forecast.cjs` now marginalises over a seed ladder of `rollDungeon(def, level, seedᵢ)`
   (was `dungen.generate(type, level, seedᵢ)`), folding each rolled battle's pack with the sim's
   own `compileEnemyPack`. Because BOTH the dive and the forecast call one roller, `forecast_parity`
   stays honest by construction. `getForecast(ref, level)` accepts a def id OR a legacy type string
   and falls back to the first def, so the existing parity harness call `getForecast('default',5)`
   keeps working.

3. **Sealed seeds (REQ-0058) — pin `dungeonId` (def id) + `genSeed` (roll seed).** A seal already
   froze `{dungeonId, level, genSeed, affixes}`; `dungeonId` now names a dungeon DEF and `genSeed`
   is the roll seed. A replay reproduces the dive by re-rolling `rollDungeon(def, level, genSeed)` →
   byte-identical encounter list → the run's own stored combat seed reproduces the outcome. The
   now-vestigial `dungeonType` field is still copied verbatim for old seals (defensive), but is no
   longer read on the serving path.

4. **Level scaling — the SIMPLEST reviewable scheme: one def, scaled at roll time.** The def is
   authored ONCE (not pre-generated per level). Level scales only the COUNTS, monotonically:
   `packEncounters(level)=clamp(base+floor((level-levelMin)/perLevels), 1, max)` and
   `gimicCount(level)=clamp(base+floor((level-levelMin)/perLevels), 0, max)`. Enemy strength is
   NOT scaled by level (packs are authored, fixed rosters) — this is unchanged from today, where
   `enemies.json` hp is the level-1 baseline and the pilot never scaled it. Fewer defs, fully
   reviewable, monotone-in-level. (The draft's per-level pre-generation alternative is rejected: it
   would explode def count for authored packs that do not themselves scale.)

5. **`test_fixed` — stays a TEST SEAM; NOT promoted to dungeon def #1.** `sim/dungen.cjs`,
   `content/live/dungeon/dungeon.json` (the concrete hand-authored pilot), the `test_fixed`
   generator, and all 12 replay goldens are kept UNTOUCHED as the OFFLINE authoring aid + the
   engine-determinism anchor — none of them sit on the serving path anymore. Retiring them would
   churn 12 determinism goldens + ~15 sim tests for zero gameplay benefit. The frost gameplay is
   instead reproduced as the AUTHORED weighted-pool def `niflheim_depths` in `dungeons.json`, which
   IS the serving path — so current gameplay is preserved through a registry def while the frozen
   fixture keeps anchoring determinism. The old `dungeon.json` inline entityDefs (REQ-0211's
   hand-off) are thereby retired from the CONTENT path: the authored def references `gimics.json`
   by id and inlines nothing.

## Serving repoint (scope #3/#4)

- `server/services/rooms.cjs` — a room's `dungeonId` now names a dungeon DEF; `createRoom`
  validates it against `getScheduleContent().dungeonDefsById` (400 unknown). `dungeonType` is
  dropped from new rooms (still read defensively for legacy rooms → mapped to a default def).
- `server/services/runs.cjs` — `startRun` resolves the def and calls `rollDungeon(def, level,
  room.genSeed, {gimicDefsById})` instead of `dungen.generate(...)`.
- `server/lib/forecast.cjs` — keyed by dungeon def; rolls the def over the seed ladder.
- `server/services/core.cjs` — loads `dungeonDefsById` from `dungeons.json`; `dungeon` joins
  `REGISTRY_KINDS`/`REGISTRY_MAP_BY_KIND` (registry-first, adoption overlays dungeon defs like
  every other kind). `listDungeonsAndFormations().dungeons` now carries the sortie-UI payload
  (below); the `types` list is retired (the UI picks a DEF, not a generator type).
- `server/services/seals.cjs` — pins the def id + roll seed (Open Q3).

## API payload for the sortie UI (design D2/D3/D4)

`GET /api/schedule/dungeons` → `dungeons[]`, each entry:
`{ id, name, i18n, theme, levelMin, levelMax, encounterSummary:{ packs, gimics:{trap,chest,door},
bossPackId, lootPreview:string[≤5] } }`, plus `art_urls` coverage for dungeon def ids (D4, via the
REQ-0174 ref-first canon + REQ-0179 custom art kind at 1024×576). `encounterSummary` is the
authored expected composition (the REQ-0049 "scout" mechanism, re-keyed to the def) — this is what
the DungeonDossier renders (D3).

## Ships

- `server/migrations/022_content_kind_dungeon.sql` — `content_kind` ENUM += `dungeon`.
- `shared/content_validate.cjs` — `validateDungeonEntry(dungeon, {monsterPackDefs, gimicDefs})`.
- `server/services/content_checks.cjs` — the `dungeon/1` dialect (schema_vocab REUSES the
  validator; engine_types APPLIES — the roller dereferences pool `packId`/`gimic`; gen_data/
  integrate honest `applicable:false`).
- `server/routes/content.cjs` — `dungeon` joins `KINDS`.
- `sim/dungeon_roll.cjs` — the roller (NEW).
- `content/live/dungeon/dungeons.json` (+ batch-002 copy) — the authored `dungeon/1` defs.
- `server/services/core.cjs`, `runs.cjs`, `rooms.cjs`, `seals.cjs`, `server/lib/forecast.cjs`,
  `server/routes/{public,schedule}.cjs` — the serving repoint.
- `server/lib/content.cjs` — dungeon def ids join the `art_urls` name set.
- `tools/backfill_content_registry.cjs` — new `dungeon` source (dungeon.json leaves SKIPPED_FILES
  as it is REPLACED by dungeons.json which enters SOURCES).
- `content/registry.json` — provenance (dungeons.json sha).
- contentadmin — `dungeon` in `KINDS`/`SCHEMA_REF_DEFAULTS`; an `EntityPreview` dungeon branch.
- client schedule — `CreateRoomForm`/`SchedulePage` select a dungeon DEF; `shared/dto.ts`,
  `client/src/api/schedule.ts`, `client/src/i18n/schedule.ts`.
- Tests — dungeon dialect tests; roller goldens; forecast-keying update; backfill; api/harness.

## Out of scope

- The full sortie-page redesign (REQ-0185 wires the DEF picker minimally; the marquee sortie UI is
  a separate downstream task — the API payload here is authored so that task need not reopen these
  files).
- The `content/live` export gap (REQ-0155's un-wired S7 step, equal for every kind).
- Loot theming per dungeon (initial defs reuse the frost reward vocabulary so every roll resolves;
  per-theme loot tables are a content follow-up).

## Gates / Decisions / Hashes

(filled in at built time — see below)
