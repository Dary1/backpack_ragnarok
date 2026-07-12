# REQ-0043 — Dungeon Auto-Generation

- **Status**: IN PROGRESS (2026-07-05)

## User spec
Dungeons are AUTO-GENERATED with args (dungeon_type, level); pass "default" for now.
Dev players/tests can specify the generation seed (fixed seed ⇒ same pattern for easy
testing). Alternatively/additionally a fixed-spawn test dungeon type independent of
the generator. Choice left to orchestrator → DO BOTH (cheap): seeded generator +
`test_fixed` type that returns the hand-authored batch-002 sequence verbatim.

## Design
- `sim/dungen.cjs`: generate(dungeonType='default', level, seed) → dungeon def
  (same shape the sim already consumes): encounter count/mix scaling with level
  (packs from the enemy roster via pack grammar, 0–2 traps, 0–1 hidden door,
  0–1 chest, boss at 100%), reward table incl. LRDST (REQ-0042), deterministic by
  seed (sub-stream of the run seed OR its own seed). Types: 'default' (generator),
  'test_fixed' (returns batch-002 dungeon.json verbatim; generator-independent).
- Rooms store {dungeonType, level, genSeed}; genSeed defaults random; may be
  specified ONLY by dev/item_admin tokens or dev_mode (403 otherwise) — same gating
  pattern as the backdate route. Room create UI gains type selector (default /
  test_fixed) + dev-only seed field.
- Tests: same (type,level,seed) ⇒ byte-identical dungeon; level scaling monotonicity
  smoke; test_fixed passthrough; seed gating 403; E2E create default room + run.

## Outcome (2026-07-05)

**Status**: DONE.

### Generator design summary (sim/dungen.cjs)
- `generate(dungeonType='default', level, seed)` returns a dungeon def in
  exactly the shape `sim/combat.cjs`'s `runDungeon()` consumes.
- `'default'` (procedural): pack count scales with level
  (`packsForLevel`: base 2, +1 per 3 levels, capped at 6); pack
  composition drawn via the pack grammar -- rarity rolled from
  `combat.TUNABLES.PACK_RARITY_WEIGHTS` (common/magic/rare, previously
  exported but unused outside tests), member count = base 2 + rarity
  bonus (0/1/2), members picked line/support/anchor round-robin bounded
  by `combat.packBudgetForLevel(level)` (hp-weight budget, existing
  TUNABLES formula, also previously unwired). 0-2 traps and 0-1 hidden
  door chain (2 stages) and 0-1 chest, each rolled via a level-scaling
  probability curve (`level/(level+4)` per extra unit, asymptotic
  toward the cap). Boss always final, always present, pinned at 100%
  progress (S8.2). Rewards reuse the existing `reward_frost_shard_*`/
  `reward_frostbound_cache_roll`/`reward_boss_relic_roll` roll ids, so
  `server/schedule.cjs`'s `REWARD_ROLL_TO_ITEM_ID` table (and REQ-0042's
  LRDST accrual, which is dungeon-independent inside `runDungeon`) work
  unchanged. Deterministic: every roll goes through `combat.makeRng(seed)`
  named sub-streams; same (dungeonType,level,seed) -> byte-identical def.
- `'test_fixed'`: returns `content/batches/batch-002-dungeon-pilot/dungeon.json`
  verbatim (deep-copied), ignoring level/seed entirely.
- Content-root resolution is `os.homedir()`-based (matches
  `server/schedule.cjs`'s own `REPO_ROOT` convention) rather than
  `__dirname`-based, specifically so test harnesses that fake
  `os.homedir()` to point at a synthetic fixture repo transparently
  redirect the generator's content reads too -- found and fixed via the
  new server test suite.

### Gating
`POST /api/schedule/rooms`'s `genSeed` field is refused (403) unless the
caller is the `dev_mode` no-token fallback OR their resolved token
carries the `item_admin` role (`admin.isItemAdminToken`) -- checked in
`server/api.cjs` BEFORE `schedule.createRoom()` is ever invoked, mirroring
the existing `dev/backdate` route's gate exactly. `dungeonType` itself
(no seed) is open to any caller. Client-side, `CreateRoomForm`'s seed
input is rendered only when `/api/me`'s roles include `item_admin`
(fetched by `SchedulePage`), matching the server gate so a non-privileged
user never even sees a control that would 403.

### Test counts (before -> after)
- engine (`mock-src/tests/run.cjs`): 91 (unchanged, no engine-layer work this REQ)
- sim (`sim/tests/run.cjs`): 43 -> 57 (+14: determinism single/multi-level,
  boss-always-last, trap/door/chest count bounds, packsForLevel/
  packBudgetForLevel monotonicity, aggregate level-scaling smoke,
  test_fixed byte-equality + generator-independence, unknown-type throw,
  default-args smoke, full runDungeon integration, roster-reference
  validity)
- server (`server/tests/api_test.cjs`, both files and pg storage modes):
  89 -> 99 (+10: explicit dungeonType create, unknown-type 400, back-compat
  dungeonId->dungeonType derivation, GET /api/schedule/dungeons types
  list, genSeed 403 for a plain guest and for a non-admin guest, genSeed
  200 for an item_admin guest and for the dev fallback, room-genSeed
  reproduces dungen.generate()'s own def, two independently-created
  rooms with the same genSeed produce identical encounter-type sequences)
- client E2E (`client/e2e/*.spec.ts`, 16 files): 78 -> 82 (+4: UI type
  selector + default-type room create end-to-end, seed field hidden for
  a plain guest, seed field visible + functional for the dev fallback
  caller, plain-guest direct-API genSeed attempt refused 403)
- sprites (`client/scripts/check_sprites.mjs`): 22/22 (unchanged)

### Gate results (all green, verified on 2026-07-05)
- engine: 91/91 passed
- sim: 57/57 passed
- server: 99/99 passed, files mode AND pg mode (STORAGE_BACKEND=pg against
  the real Supabase instance)
- client tsc: clean (0 errors)
- client oxlint: 0 errors (17 pre-existing warnings, unchanged before/after)
- client build: succeeds, output committed to web/app/ (deployed artifact)
- client E2E: 82/82 passed (full suite run twice for confirmation, after
  fixing a test-order-dependent room-selection flake -- see commit (c))
- sprites: 22/22 non-blank
- pages 200: https://backpack-dev.qtie.jp/app/ -> 200,
  /api/health -> 200, /api/schedule/dungeons -> 200
- backpack-api.service restarted successfully on the new code; live
  GET /api/schedule/dungeons confirmed serving the new `types` list

### Commits
- (a) `ffc532b` -- sim/dungen.cjs + sim/tests/run.cjs +14 + sim/README.md
- (b) `2f48e87` -- server/schedule.cjs + server/api.cjs + sim/dungen.cjs
  (os.homedir fix) + server/tests/api_test.cjs +10 + server/README.md
- (c) `4386a9b` -- client (api.ts, CreateRoomForm.tsx, SchedulePage.tsx,
  i18n.ts) + client/e2e/schedule.spec.ts +4 + web/app rebuild

### Notable interpretation/finding during implementation
`sim/combat.cjs` already exported `packBudgetForLevel` and
`TUNABLES.PACK_RARITY_WEIGHTS` from earlier work (REQ-0036 P1-A), each
explicitly commented "not yet wired into pack generation logic... left
for a future content-generation tool" -- this REQ is that tool; both are
now real, exercised inputs to `dungen.buildPack()` rather than dead
exports.
