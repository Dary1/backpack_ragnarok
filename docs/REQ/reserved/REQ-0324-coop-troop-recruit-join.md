# REQ-0324 — Co-operative Troop: recruitment + human-equivalent join/leave

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec 2026-07-28, items 1-2).
- **Depends on**: REQ-0309/0310 (engine + player actions in `shared/`). No other REQ.
- **Blocks**: REQ-0325, 0326, 0330.
- **Supersedes**: REQ-0311 (coop-troop-model) and the co-op half of REQ-0312. The
  2026-07-27 design doc and REQ-0311..0320 are obsolete per owner; this is the
  authoritative, simpler shape.

## Truth (owner, 2026-07-28)

> 1. When ANY player starts a troop recruitment, the bot program enters `joining`.
> 2. While recruiting, every 30 s the fleet joins the FIRST squad from a bot player
>    pool. Bot players are treated EXACTLY like humans.

So the server must let a player OPEN a recruiting Troop that other players (human or
bot, indistinguishably) can BROWSE and JOIN with one of their own squads. This REQ
builds only that; departure/rewards are REQ-0325, cancel is REQ-0326.

## Current state (surveyed)

- `services/rooms.cjs:111` hardcodes `visibility:'self'`; `createRoom` builds
  `slots: SQUAD_SLOTS.map(() => ({ squadIndex: null }))` — a slot names only the
  caller's own squad index, with no owner field.
- `getOwnRoomOr404(roomId, callerId)` returns 404 for any room whose
  `ownerId !== callerId` — another player's room is invisible.
- `createSortie` (services/sorties.cjs) fills all four slots from ONE caller and is
  the solo path; it stays untouched.
- `assignSlot` (services/squads.cjs) runs the deploy gate against the caller's
  canvas; `deployedUidSetsByOrigin` filters `otherRoom.ownerId === playerId`.

## What to build

### Data model
- `room.slots[i]` becomes `{ ownerId, squadIndex, joinedAt } | null` (was
  `{ squadIndex }`). Migrate legacy solo rooms on read: `{ squadIndex:n }` reads as
  `{ ownerId: room.ownerId, squadIndex:n }`.
- Room gains: `visibility: 'public' | 'self'` (default `self` — solo unchanged),
  `hostId` (= opener's id; keep `ownerId` as an alias, do not remove it),
  `state: 'recruiting' | 'active' | 'canceled'`.
- A recruiting Troop = a `visibility:'public'` room, slots not all filled, run not started.

### Endpoints (new tail-appended family, same order-safe pattern router.cjs documents)
```
GET    /api/schedule/troops?state=recruiting[&attackLv=]   browse open troops (public only)
POST   /api/schedule/troops   {dungeonId,level,formationId?,squadIndex}  host + seat slot 0
POST   /api/schedule/troops/:id/join   {squadIndex}        take the first free seat
POST   /api/schedule/troops/:id/leave                      free MY seat (pre-departure only)
GET    /api/schedule/troops/:id                            full troop state
```
- `POST /troops` opens a `visibility:'public'` room, seats the host in slot 0, leaves
  slots 1..3 empty, `state:'recruiting'`. `attackLv`/level is host-set at creation and
  immutable for the troop (REQ-0325 relies on one troop-level attackLv).
- `join` takes the LOWEST free slot, writes `{ownerId:caller, squadIndex, joinedAt}`.
- Browse returns only public, recruiting troops with >=1 free seat, each as
  `{roomId, seats:"k/4", attackLv, hostId, ageSec}`. This is the signal the fleet
  polls to detect a recruitment (item 1) and to drip-join (item 2).

### Deploy gate across players
- The gate runs against the JOINER's canvas (`isSquadDeployable`, uid overlap).
- `deployedUidSetsByOrigin` changes from "rooms I own" to "any active/recruiting
  troop where I HOLD A SEAT" (search slots for `slot.ownerId === playerId`). Two
  DIFFERENT players sharing a uid is impossible (separate canvases); the gate only
  stops ONE player double-deploying the same uid.

## Rulings (owner spec is truth; minimal consistent choices)
- Frozen canvas = the departure snapshot (REQ-0325 builds it); a member may keep
  editing their own canvas between runs.
- Only the host may `POST /troops`; any seated member may `leave` before departure.
- No matchmaking, bands, muster deadline, or greeter seat — the old design's
  apparatus is deleted. The fleet reacts; it never hosts.

## Gates / acceptance
- New unit tests: open troop -> browse shows it -> a 2nd player joins (2/4) -> 3rd,
  4th join (departure is REQ-0325). `leave` frees a seat and it reappears in browse.
  Deploy gate rejects a joiner double-deploying a uid already seated elsewhere.
- `tools/ci.sh` green. Solo `/api/schedule/rooms*` regression suite unchanged/green.
