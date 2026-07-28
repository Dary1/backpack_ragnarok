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
