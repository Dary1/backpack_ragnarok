# REQ-0185 — dungeon-content-kind: a dungeon is authored, PROBABILITY-WEIGHTED references to packs + gimics, rolled at dive time

**Status:** built — implemented 2026-07-17; ratified per the user ruling 2026-07-17 (below).
DB-free `tools/ci.sh` GREEN + pg gates GREEN + scoped hermetic e2e 187/1-waived; client lint/build
green. NOT merged, NOT deployed (migration 022 + live backfill pending the batch deploy).
**Reserved:** 2026-07-15
**Slug:** dungeon-content-kind (supersedes the reserved slug `dungen-registry-packs`)
**Branch / worktree:** `req-0185-dungeon-content-kind` (server, UNMERGED), stacked on
`req-0211-gimic-content-kind` (rebased 2026-07-17 onto its post-0217 tip `e4c4666`; see the
rebase section below).
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

## Gates / Decisions / Hashes (results, 2026-07-17)

**Schema shape (final).** `dungeon/1` = `{id, name, i18n{en,ja}, theme, levelMin, levelMax,
dive:{packEncounters:{base,perLevels,max}, gimicSlots:{base,perLevels,max}}, packPool[{packId,
weight}], bossPool[{packId,weight}], gimicPool[{gimic,weight}], rewards?, note}`. The def inlines
NOTHING; every pool row is a reference resolved against the live monster_pack + gimic rosters.

**Authored def ids.** `niflheim_depths` (frost, Lv1-8), `grave_hollows` (grave, Lv4-14),
`beastreach_wilds` (wild, Lv8-20). Fixture def `test_dungeon` for the api harness.

**Five open questions — ratified as committed above (unchanged at build):** (1) weighted, WITH
replacement, per pool (`pickWeighted`, no not-the-last-N memory); (2) forecast rolls the SAME
`rollDungeon` over a seed ladder -> parity by construction; (3) sealed seeds pin `dungeonId` (def)
+ `genSeed` (roll seed); (4) level scales only the COUNTS, monotone (`clamp(base+floor((lvl-
levelMin)/perLevels), floor, max)`), enemy strength unchanged; (5) `test_fixed` / `dungeon.json` /
the 12 replay goldens kept UNTOUCHED as the offline determinism anchor — frost gameplay reproduced
as the authored `niflheim_depths` on the serving path.

**Commit hashes.** The four below are the ORIGINAL, PRE-REBASE commits (stacked on the old
req-0211 tip `68a684d`). They are NO LONGER on the branch — they survive only under
`refs/backup/req-0185-pre-rebase-20260717` (tip `99b05cb`). Kept for provenance:
- `a2b5615` — dungeon/1 content kind: roller + validator + authored defs + registry integration
- `278e890` — serving repoint (core/rooms/runs/seals/forecast/lib-content/public)
- `6bf9ed1` — tests + gates (roller test wired into ci.sh; api/dialect/backfill updates)
- `99131c2` — client wiring + contentadmin + DTO + web build (bundle later found STALE)

**Live commit hashes (post-rebase, on the branch — stacked on req-0211 tip `e4c4666`):**
- `e567fbc` — dungeon/1 content kind: roller + validator + authored defs + registry integration
- `0c91827` — serving repoint: schedule rolls authored dungeon defs
- `5c245e7` — tests + gates for the dungeon kind
- `08b248a` — client wiring: dungeon DEF picker, forecast by dungeonId, contentadmin
- `b8182b3` — rebuild web/app from merged source (the stale bundle stripped from `08b248a`)
- `f8e667f` — todo -> built
- `ce78af5` — rebase note (branch tip)

**DB-free gates GREEN** — `SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh`, HOME->worktree (the
REQ-0184 os.homedir() convention): sim 117 · goldens 12 (UNMOVED — `replay_hashes.json` byte-
identical) · **dungeon roller 5 (NEW)** · S4 14 · forecast parity 18 · req0203 15 · req0207 13 ·
unit-charge 13+19 · mock 119 · **server tsc clean** · api (files) **187** (incl. 4 new REQ-0185
schedule tests + the two REQ-0043 reproducibility tests re-keyed from `dungen.generate` to
`rollDungeon`, + the restored absent-dungeonId 400) · dialect **51** (incl. 8 new dungeon/1) ·
backfill_content_registry **11** (corpus reconciles with the +dungeon source) · every other DB-free
gate green.

**Client GREEN** — `pnpm lint` 0 errors (46 pre-existing warnings, none in REQ-0185 files);
`pnpm build` (tsc -b + vite) OK; web/app bundle committed.

**NOT run (deploy steps, per REQ-0184/0208/0211 precedent):** the PG-backend api pass, the live
migration 022 (`content_kind += dungeon`, applied via supabase-db as postgres) and live backfill
(`dungeon` = 3, adopted). These close on the batch deploy.

**e2e — touched surface (schedule / forecast / schedule-mjolnir).** The dungeon-domain overlay in
`tools/e2e_fleet.cjs` already replaces the whole worktree `content/live/dungeon`, so `dungeons.json`
is served (documented). First run (E2E_PARALLEL=4): forecast overlay ALL green; 27 passed / 10
failed. Every failure is a `.schedule-page` / create-panel VISIBILITY TIMEOUT (element-not-found at
the default 5s), clustered on tests that render the create form, on a box saturated by ~8
concurrent worktree e2e runs (multi-agent load). NOT value-assertion failures. A LOCK-FREE
standalone reproduction (worktree `server/api.cjs` + `client/e2e/local-proxy.cjs` on private ports)
renders `.schedule-page` + the authored DEF `<select>` + the level-band note with ZERO page errors,
AND drives the full flow: select `niflheim_depths` -> submit -> room persisted with
`dungeonId=niflheim_depths` level 3. This proves the failures are environmental (box contention),
not a code defect. A serial re-run of the failed subset is queued behind the shared box lock.

## Post-reboot re-verification — 2026-07-17 UTC (2026-07-18 JST)

The box went down mid-session (SSH unreachable >2h) AFTER the tip commit `ce78af5`; a hand-off
note recorded this REQ as "~80% done, gates / commit / client-wiring outstanding". That note was
STALE — all of it had in fact landed before the crash. Re-verified from a cold session on the
rebooted box (uptime 10:53, load 0.29, no CI lock held):

- Worktree CLEAN (`git status` empty), tip `ce78af5`, 18 commits ahead of master, REQ file already
  in `built/`. Nothing was lost to the crash; no work needed redoing.
- DB-free `tools/ci.sh` RE-RUN from scratch -> **CI GREEN**, 0 FAIL. Every count matches the
  claims above exactly: sim **117** · goldens **OK (12 cases, replay determinism intact)** ·
  dungeon roller **5** · forecast parity **18** · api (files) **187 passed, 0 failed** ·
  dialect **51** · backfill **11**. Goldens byte-identical (no churn under `sim/tests/`).
- Invocation note (cost a false start). A non-interactive `ssh` shell does NOT load nvm, so `node`
  is absent from PATH and ci.sh dies at `[0/8]` with `node: command not found`. The HOME->worktree
  remap is not itself the cause. Pin PATH to the same node the live units run
  (`/home/qtie/.nvm/versions/node/v24.18.0/bin`), plus `~/.local/bin` for pnpm:

      HOME=/tmp/ci_home_0185 \
      PATH=/home/qtie/.nvm/versions/node/v24.18.0/bin:/home/qtie/.local/bin:/usr/local/bin:/usr/bin:/bin \
      CI_LOCK_FILE=/home/qtie/.cache/backpack/ci.box.lock \
      ART_KIT_PYTHON=/home/qtie/backpack_ragnarok/.venv/bin/python \
      SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 bash tools/ci.sh

  `ART_KIT_PYTHON` must point at the REAL checkout's venv — under the remapped HOME it would
  otherwise resolve to a `.venv` the worktree does not have. Also: never `pkill -f "tools/ci.sh"`
  over ssh; the pattern matches the ssh command line itself and kills your own session (use
  `ci[.]sh`).
- Branch is 28 commits BEHIND master (`3b01434`), a docs-only delta; deliberately NOT rebased
  again, as docs-only commits cannot affect these gates.

## Downstream notes (sortie-UI #4/#5, monitor #7)

- **API (`GET /api/schedule/dungeons`).** `dungeons[]` entries now carry `theme`, `levelMin`,
  `levelMax`, and `encounterSummary:{packs, gimics:{trap,chest,door}, bossPackId, lootPreview[<=5]}`.
  The retired generator `types` list is GONE. Dungeon def ids join the `art_urls` name set
  (custom art kind @1024x576) — resolve key art by def id, same exact-name convention as monster/gimic.
- **Room / forecast keys.** A room stores `dungeonId` (an authored def id); `dungeonType` is
  vestigial (copied on seals for the old ApiSeal* shape, never read on the serving path).
  `GET /api/schedule/forecast?dungeonId=&level=` — accepts `dungeonId` (legacy `dungeonType` still
  honored), payload carries both `dungeonId` and (back-compat) `dungeonType`=def id.
- **Roller / pacing seams.** `sim/dungeon_roll.cjs :: rollDungeon(def, level, seed, {gimicDefsById})`
  is the ONE roller shared by `runs.startRun` and `lib/forecast` — the monitor/pacing task must roll
  through it (never re-derive a composition) to keep the parity contract. `diveSummary(def, {...})`
  is the authored "scout" preview the dossier renders. Encounter shape is unchanged from
  `sim/dungen.cjs` (`enemyPack:{packId}` + REQ-0049 attachments), so `combat.runDungeon` /
  `sim/lib/{dungeon,encounter}.cjs` consume it verbatim; per-encounter `deadline_secs` (pack 90 /
  boss 180) are the roller-emitted pacing knobs.

## Deviations from the saved-state description

- The predecessor's claim "roller determinism goldens added" was NOT actually present; added as a
  dedicated `sim/tests/dungeon_roll_test.cjs` (wired into ci.sh [2.65]) — additive, the 12 replay
  goldens stayed byte-identical.
- Three pre-existing tests the predecessor left broken were fixed: `schedule_ops.cjs` two REQ-0043
  reproducibility tests still compared against `dungen.generate` (re-keyed to `rollDungeon`); the
  "absent dungeonId is 400" contract was being defeated by a single-def fallback in
  `rooms.resolveDungeonDefId` (fallback removed — dungeonId is required on create, matching the
  original contract and the existing test).
- `server/tests/backfill_content_registry_test.cjs` expectations were not updated for the new
  dungeon source; updated (kind map, per-file + reconciliation counts).
- Client: also updated `SchedulePage.tsx` (dropped the `types`-based dungeonType name join) and
  `ForecastPanel.tsx` (the overlay's dungeon dropdown now lists authored defs) and
  `client/e2e/schedule.spec.ts` — consumers of the retired `types` the checklist did not enumerate.

## Rebase onto post-0217 master — 2026-07-17

Rebased `req-0185-dungeon-content-kind` onto the NEW `req-0211-gimic-content-kind` tip
(`e4c4666`), which itself sits on master `cc575e2` (post REQ-0214/0217/0221/0225/0230/0231/0234;
master advanced to `6d0e3a0` during the work). New tip: **`b8182b3`** (was `99b05cb`; backup ref
`refs/backup/req-0185-pre-rebase-20260717`). Branch stays UNMERGED, still stacked on req-0211.

**Conflicts + resolutions**
- **`tools/e2e_fleet.cjs`** (commit `6bf9ed1`) conflicted: the branch modified the pre-0217
  per-file overlay block (live_packs / live_tms / dungeon) that REQ-0217 deleted wholesale.
  Resolved to master's fleet (`git checkout master -- tools/e2e_fleet.cjs`) — the hermetic
  fleet `cpSync`s the whole `content/live` (incl. dungeons.json + gimics.json) from the
  worktree, so the overlay is obsolete.
- **`tools/ci.sh`** — the branch's `[2.65] dungeon roller` gate line auto-merged into master's
  rewritten ci.sh (stable anchor after the forecast-parity line).
- **`client/e2e/schedule.spec.ts`** 3-way auto-merged cleanly: master's REQ-0214 profile
  identity edits (`/api/profile/dev` → `/api/profile/default`, `dev.json` → `e2e_ci.json`,
  lines 523–1375) and this branch's dungeon-DEF selector edits (`schedule-dungeon-type-select`
  → `schedule-dungeon-select`, dungeonType → dungeonId, lines 140–391) touch disjoint regions.
- **Committed web/app bundle (`99131c2`) was STALE → dropped and rebuilt.** Stripped the
  bundle delta from the client-wiring commit, then rebuilt (`client && pnpm run build`, tsc+vite
  green) from the fully-merged source and committed the fresh dist as a separate
  `rebuild web/app from merged source` commit (master's bundle-commit convention).

**Latent regression the pg gates surfaced (fixed on req-0211)**
- This branch was originally validated DB-free only, so its pg registry gates never ran.
  Post-rebase, `schedule_serving_test` (pg) was **4 pass / 9 fail**: registry-first roll/sim
  serving was blanked for EVERY kind because adding `dungeon` (and REQ-0211's `gimic`) to
  `REGISTRY_KINDS` made `core.cjs computeRegistryData` ask pg for a `content_kind` enum value
  not on the db until the 022/020 migration deploys — `resolveAdoptedContentData` threw and the
  un-isolated loop poisoned the whole snapshot. Proven a real regression (master `13/0`, same
  byte-identical test) and NOT rebase-introduced (the pre-rebase tip `99b05cb` also `4/9`).
  Fixed by isolating the per-kind loop (commit on req-0211). schedule_serving_test → **13/0**.

**Gate evidence (req-0185 tip)**
- DB-free `tools/ci.sh` **CI GREEN** (HOME→worktree symlink still required — os.homedir()
  content anchoring persists post-overhaul; `CI_LOCK_FILE` pinned to the real
  `~/.cache/backpack/ci.box.lock` so REQ-0231 stays honored under the symlinked HOME).
- pg (isolated namespace): api_test GREEN; content_test 18/0, contentagg 5/0, seed_derive 5/0,
  content_serving 9/0, **schedule_serving 13/0**.
- Scoped HERMETIC e2e (decade 0185, `E2E_GPU=1`): **187 passed / 1 failed / 1 skipped**. The
  REQ-0185 authored-dungeon-DEF selector spec (`schedule.spec.ts:292`) and REQ-0211 Gimics-tab
  (`dex.spec.ts:428`) both PASS. The 1 failure is `bp-transfer.spec.ts:76` — a drag-timing DnD
  flake that failed only under box saturation (load ~22→65 from concurrent runs); it passes in
  3.1s in isolation under lighter load, and the stack touches ZERO transfer/board/canvas code
  (`git diff master..HEAD -- client/src/board client/e2e/bp-transfer.spec.ts` is empty), so the
  path is byte-identical to master. Waived as a pre-existing/environmental flake.

**Downstream-task scoped e2e invocation** (from `client/` of a req-0185-based worktree):

    E2E_FLEET_ROOT=/tmp/bp_e2e_workers_req0185 E2E_PROXY_PORT=1852 E2E_FLEET_BASE_PORT=1854 \
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:1852 E2E_PARALLEL=4 E2E_GPU=1 pnpm exec playwright test

(Use `E2E_GPU=1` only when the GPU is idle; the box's GPU is shared with the art session.)
