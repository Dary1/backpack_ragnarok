# REQ-0312 — Co-operative Troop: multi-participant run execution and reward fan-out

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track A. Design doc §1, §5.
- **Depends on**: REQ-0311.
- **Blocks**: the fleet's core loop.

## Scope

`services/runs.cjs:77` `startRun(room, profileCanvas)` takes ONE canvas and sets
`const participants = [room.ownerId]` ("solo scope: the room owner is the sole
participant/reward recipient"). This REQ makes departure load four canvases —
one per seat owner — snapshot them, and fan settled rewards into four warehouses.

Good news, and the reason this is smaller than it looks: **the simulator is already
multi-participant.** `sim/lib/dungeon.cjs:32` `distributeRewardsUniform(items,
participants, rng)` assigns every reward an `owner` drawn uniformly from the
participant list, and `runDungeon` already accepts `participants`. No combat change
is expected.

Work: per-seat canvas load at `buildSquadSnapshots` time; `participants` from seat
owners; settlement writes each reward to its owner's warehouse (`addToWarehouse`,
200-cap and TTL unchanged); LRDST reward split; wipe/level-down applies to the
troop; cancel and queued-swap semantics with four owners; `settleRoomIfDue`'s lazy
poll-driven design preserved (no standing scheduler).
