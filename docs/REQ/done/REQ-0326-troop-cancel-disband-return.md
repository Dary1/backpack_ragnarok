# REQ-0326 — Troop cancel -> disband on return; return the seats

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec item 5).
- **Depends on**: REQ-0324, REQ-0325. **Blocks**: REQ-0327.

## Truth (owner, 2026-07-28)
> 5. When a player's squad cancels, the troop is disbanded ON RETURN (implement if not already).

## Current state (surveyed)
- `services/rooms.cjs:167` `cancelRoom` supports immediate vs cancel-after-current-run
  (`cancelRequested`, honored by `maybeAutoStartNextRun` at runs.cjs:319+). This is
  SOLO: it cancels the owner's own room.
- For a co-op troop there is no "a member cancels -> the whole troop dissolves when
  the in-flight run returns and seats are handed back".

## What to build
- `POST /api/schedule/troops/:id/cancel` (any SEATED member). Semantics:
  - No run in flight (`recruiting`, or between runs in cooldown): disband NOW.
  - Run ACTIVE: set `disbandRequested`; finish the current dive, settle rewards
    normally (REQ-0325), then on RETURN (where `maybeAutoStartNextRun` would
    restart) disband instead: `state:'canceled'`, all seats cleared/returned, NO
    next run scheduled.
- "Return the seats" = each `slot.ownerId` is released; the members' uids are no
  longer deploy-gate-locked to this troop (they can re-deploy elsewhere).
- Disband is a discrete, observable event carrying the roster of released owners —
  REQ-0327 consumes it to notify each member's device and the fleet.

## Ruling (owner spec is truth)
- ANY seated member cancelling disbands the WHOLE troop on return (co-op is
  all-or-nothing, matching REQ-0036 golden g). A pre-departure `leave` (REQ-0324)
  frees only that one seat and does NOT disband.

## Gates / acceptance
- Unit: member cancels mid-run -> current run settles -> troop disbands on return,
  seats cleared, no restart, disband event emitted with the (up to) 4 owners.
  Cancel while recruiting -> immediate disband. Released owners can deploy elsewhere.
- `tools/ci.sh` green; solo cancel path unchanged.

## Outcome (built 2026-07-28)

Implemented: any SEATED member may cancel a co-op Troop via
`POST /api/schedule/troops/:id/cancel`; the WHOLE troop disbands
all-or-nothing (golden g), every seat is RETURNED, and a discrete
`disbandEvent` is recorded (the seam REQ-0327 consumes).

- **No run in flight** (still `recruiting`, or departed but `status:'open'`
  cooling down between runs) -> disband NOW.
- **Run active** -> set `disbandRequested`; the current dive finishes and
  settles rewards normally (REQ-0325), then ON RETURN (the point
  `maybeAutoStartNextRun` would restart) it disbands INSTEAD of scheduling a
  next run.
- **Return the seats**: `disbandTroopRoom` clears every slot and flips
  `state:'canceled'` + `status:'canceled'`, so each seat owner's uids stop
  gating their other deploys (`squads.cjs` `roomSeatGates` /
  `deployedUidSetsByOrigin` / `deployedUidSet` all key on a LIVE seat) and
  stop being market-frozen -- a released owner can immediately re-deploy those
  squads elsewhere.
- **`leave` (REQ-0324) is untouched**: a pre-departure leave still frees only
  the caller's own seat and never disbands. The solo `cancelRoom` /
  `DELETE /api/schedule/rooms/:id` path is unchanged.

### REQ-0327 seam (released-owner roster)

A disband writes a discrete `disbandEvent` onto the room doc AND returns it in
the API response:

    room.disbandEvent = {
      roomId,                       // the disbanded troop id
      reason: 'member_cancel',      // discriminator for future disband causes
      releasedOwners: [uid, ...],   // <=4 distinct seat-owner ids to notify
      disbandedAt,                  // ISO timestamp
    }

REQ-0327 consumes `room.disbandEvent.releasedOwners` (persisted, readable via
`storage.readRoom(id)` or the `POST .../cancel` / `GET /troops/:id` response)
to learn exactly whom to notify. The primitive `runs.disbandTroopRoom(room,
reason)` also RETURNS the same room, so a direct caller can read the roster
from its return value.

### Files

- `server/services/runs.cjs` -- new `disbandTroopRoom(room, reason)` primitive
  + disband-on-return guard in `maybeAutoStartNextRun` (checked before the
  cooldown guard); exported.
- `server/services/troops.cjs` -- new `cancelTroop(roomId, callerId,
  itemDefsById)`; exported.
- `server/schedule.cjs` -- facade export `cancelTroop`.
- `server/routes/schedule.cjs` -- `POST /api/schedule/troops/:id/cancel` route
  (anchored `.../cancel$`, order-safe before the generic troop item regex).
- `server/tests/api/schedule.cjs` -- 3 new REQ-0326 acceptance tests
  (recruiting immediate disband + redeploy; mid-run defer-to-return settle +
  disband + no restart; between-runs immediate disband).

### Gates

- `node server/tests/api_test.cjs` -> **220 passed, 0 failed** (was 217; +3
  REQ-0326 tests; parity assertions 1858).
- `node_modules/.bin/tsc -p tsconfig.server.json` -> **exit 0**.
- `node sim/tests/run.cjs` -> **185 passed, 0 failed** (runs.cjs touched).
- pg-backend / Playwright e2e: SKIPPED (shared e2e box FREEZE; pg writes the
  live DB). The files backend exercises the same `storage.cjs` chokepoint.
