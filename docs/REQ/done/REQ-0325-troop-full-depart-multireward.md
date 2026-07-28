# REQ-0325 — Troop auto-departs when full; multi-participant run with RANDOM reward fan-out

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec items 3-4).
- **Depends on**: REQ-0324. **Blocks**: REQ-0326, 0327, 0330.
- **Supersedes**: REQ-0312 (coop-troop-run-exec).

## Truth (owner, 2026-07-28)
> 3. A troop, when full of squads, auto-departs (implement if not already).
> 4. While cycling, the troop distributes rewards RANDOMLY (implement if not already).

## Current state (surveyed)
- **Auto-depart-when-full: does NOT exist.** Solo `createSortie` fills 4 slots at
  once then settles immediately; there is no "wait until the 4th seat fills" path.
- **Random distribution algorithm: ALREADY EXISTS.** `sim/lib/dungeon.cjs:32`
  `distributeRewardsUniform(rewardItems, participants, rng)` assigns each reward an
  `owner` drawn uniformly at random (golden p: "distribution fully RANDOM"), and
  `runDungeon` already accepts `participants`. **The gap is the wiring:**
  `services/runs.cjs:117` hardcodes `participants = [room.ownerId]` and `startRun`
  takes ONE `profileCanvas`.
- `maybeAutoStartNextRun` (runs.cjs:323) already auto-restarts a room's run forever
  after cooldown — a departed troop keeps cycling with no scheduler. Reuse it.

## What to build
### Auto-depart on full
- When `join` (REQ-0324) fills the LAST free seat, transition `recruiting -> active`
  and start the first run immediately, atomic with that join. No client action.

### Multi-participant run execution
- `startRun` loads FOUR canvases (one per seated `slot.ownerId/squadIndex`) and
  builds four squad snapshots (extend `buildSquadSnapshots` to per-owner squads).
  The frozen-canvas rule = these snapshots.
- `participants = room.slots.map(s => s.ownerId)`, passed into `runDungeon`. The
  existing `distributeRewardsUniform` fans each reward to a uniformly-random
  participant — no new distribution code.
- Settlement: for each `{item, owner}`, `addToWarehouse(owner, ...)` (runs.cjs
  already keys warehouse writes on `assignment.owner`; it only needs the participant
  list to hold all four). The aggregate LRDST drop, today a single row to
  `room.ownerId`, must ALSO follow the uniform rule (per-participant or uniform
  single-winner) per golden p.
- Auto-restart re-snapshots all four owners' CURRENT canvases at each new departure.

## Rulings
- One troop-level `attackLv` (host-set, immutable). Wipes drop it once for the troop.
- A seat empty at re-departure (member left between runs, REQ-0326) reduces
  participants; the run proceeds with the remaining members unless the troop disbanded.

## Gates / acceptance
- Unit: 4 distinct players fill a troop -> it departs automatically -> settle -> each
  reward's owner is one of the four, distribution RANDOM (seeded-rng golden), rewards
  land in the correct owner's warehouse. Wipe -> no rewards, level drops once.
- Multi-run: auto-restart re-snapshots; no reward leaks to a non-participant.
- `tools/ci.sh` green; solo single-participant reward path unchanged.


## Outcome (built 2026-07-28)

Implemented on branch `req-0325-troop-full-depart-multireward` (off master, which
already carries REQ-0324's troop model). Implementing commit: `fc912cf`.

### What was built
- **Auto-depart on full** (`server/services/troops.cjs`): `joinTroop` now, when it
  fills the LAST free seat, calls `departTroop` -> sets the troop-level lifecycle
  `state: recruiting -> active` and starts the first run through the shared run
  engine, ATOMIC with that join (no client action). A defensive revert restores a
  consistent recruiting-full state if `startRun` ever throws.
- **Multi-participant run** (`server/services/runs.cjs`): `startRun` branches on
  `isTroopRoom` (visibility:'public'). For a troop it builds ONE squad snapshot per
  seated slot from THAT slot owner's OWN current canvas (`buildTroopSquadSnapshots`
  -> per-owner `storage.readProfile`), and passes `participants = every seated
  owner` into `runDungeon`. The solo (visibility:'self') path is byte-for-byte
  unchanged (single canvas, `participants = [room.ownerId]`). `participants` is now
  persisted on the run doc.
- **Random fan-out**: unchanged `distributeRewardsUniform` fans each item reward to
  a uniformly-random participant; settlement already keys `addToWarehouse` on
  `assignment.owner`, so each of the four owners' warehouses receives exactly its
  assigned items. The aggregate LRDST drop now ALSO follows the uniform rule
  (`pickLrdstOwner`: a uniform single-winner among participants, deterministic in
  the run's own stored seed); solo stays byte-identical (sole owner wins).
- **Auto-restart** (`maybeAutoStartNextRun`): troop-aware slot guard (proceeds as
  long as >=1 seat is filled; an emptied seat reduces participants without
  crashing) and re-reads all owners' CURRENT canvases at each new departure.
- **Poll-driven settle** (`settleTroopIfDue` + `GET /api/schedule/troops/:id`): a
  departed troop settles + lazily auto-restarts on read, per-owner canvases loaded
  inside the run engine.
- **Departure freeze / market gate** (`server/services/squads.cjs`
  `deployedUidSet`): a DEPARTED troop (state:'active') now freezes EVERY seat
  owner's squad uids for the whole dive -- keyed on seat OWNER, not room ownership
  -- so a seated uid (host or joiner) cannot be sold mid-dive. The re-deploy freeze
  was already covered by `deployedUidSetsByOrigin`/`roomSeatGates`.

### Files changed
- `server/services/troops.cjs` -- auto-depart (`departTroop`) + `settleTroopIfDue`
- `server/services/runs.cjs` -- troop snapshot/participants branch, `participants`
  on run doc, `pickLrdstOwner` uniform LRDST, troop-aware auto-restart guard
- `server/services/squads.cjs` -- `deployedUidSet` departed-troop seat freeze
- `server/routes/schedule.cjs` -- `GET /troops/:id` settles/auto-restarts on read
- `server/schedule.cjs` -- facade export `settleTroopIfDue`
- `server/tests/api/schedule.cjs` -- reworked REQ-0324 recruiting tests to stay
  <4/4; added 5 REQ-0325 tests (auto-depart, fan-out+no-leak, wipe level-drop,
  auto-restart re-snapshot, market freeze)
- `sim/tests/run.cjs` -- deterministic seeded-rng reward fan-out golden

### Gates (all green; files backend + sim; pg SKIPPED -- writes to the LIVE db)
- `node server/tests/api_test.cjs` (files) -> 211 passed, 0 failed (was 206; +5)
- `node sim/tests/run.cjs` -> 185 passed, 0 failed (incl. the new fan-out golden)
- `node sim/tests/goldens.cjs` -> goldens OK (12 cases, replay determinism intact)
- `node_modules/.bin/tsc -p tsconfig.server.json` -> exit 0
- `node server/tests/pacing_test.cjs` -> 15 passed; `bio_test.cjs` -> 10 passed
- pg-backend api_test / Playwright e2e: NOT run (pg writes to the live db; files
  backend exercises the same `server/storage.cjs` chokepoint).

### Deviations / follow-ups
- The RECRUITING-phase market lock (a not-yet-departed troop's seated uids are not
  frozen from the market by `deployedUidSet`) remains the documented REQ-0324
  follow-up; this REQ implements the DEPARTED/active freeze as specified.
- "Seat emptied between runs reduces participants" is coded defensively (no crash,
  participants shrink) but is not yet reachable via the API until REQ-0326 adds
  leave/disband after departure.
