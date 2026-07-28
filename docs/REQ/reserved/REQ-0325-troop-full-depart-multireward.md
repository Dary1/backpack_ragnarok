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
