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


## Outcome (built 2026-07-28)

Implemented the co-operative Troop server feature: a player opens a PUBLIC
recruiting Troop other players (human or bot, indistinguishably via the
standard X-Auth-Token) BROWSE and JOIN with one of their own squads, and may
LEAVE before departure. Departure/rewards (REQ-0325) and cancel/disband
(REQ-0326) are NOT built here -- filling the last seat leaves `state:'recruiting'`
ready for REQ-0325; no run is started.

### What was built
- **Data model** (`server/services/core.cjs`): `slotIsFilled` / `normalizeSlot`
  read BOTH the legacy solo slot `{ squadIndex }` and the co-op slot
  `{ ownerId, squadIndex, joinedAt }`, migrating a legacy ownerless filled slot
  to the room's `ownerId` ON READ. Empty slots are `null` (troop) or the legacy
  `{ squadIndex: null }`, both read as empty.
- **Deploy gate** (`server/services/squads.cjs`): `deployedUidSetsByOrigin`
  broadened from "rooms I own" to "any active/recruiting room/troop where I HOLD
  A SEAT" (`slot.ownerId === playerId`), via a new `roomSeatGates` predicate (a
  public troop gates while recruiting or active; a solo `self` room still gates
  only while `status==='active'` -- byte-for-byte the old rule). The gate check
  was extracted into a shared, write-free `assertSeatAllowed` reused by both the
  solo `assignSlot` (still writes `{ squadIndex }`, unchanged) and the troop
  seat/join path. Two different players sharing a fixture uid never collide --
  the gate only ever compares the caller's own seats against their own canvas.
- **Troop service** (`server/services/troops.cjs`, new): `createTroop` (host
  seats slot 0, `visibility:'public'`, `hostId`=`ownerId` alias, `state`/`status`
  `'recruiting'`, atomic rollback on a rejected host seat), `joinTroop` (lowest
  free seat), `leaveTroop` (frees the caller's seat(s) pre-departure; host may
  leave), `getTroopOr404` (full state, slots normalized), `listRecruitingTroops`
  (browse: public + recruiting + >=1 free seat, each `{ roomId, seats:"k/4",
  attackLv, hostId, ageSec }`; optional `attackLv` filters on the host-set,
  immutable level). `status` is set to `'recruiting'` (off the solo `open`/`active`
  lanes) so the lazy run-scheduler and market gate treat a Troop inertly -- no
  run auto-starts.
- **Routes** (`server/routes/schedule.cjs`): tail-appended `/api/schedule/troops*`
  family (`GET` browse, `POST` host, `POST /:id/join`, `POST /:id/leave`,
  `GET /:id`), same order-safe pattern router.cjs documents; genSeed/drawSeed
  privileged-gated for parity with `POST /rooms`.
- **Facade** (`server/schedule.cjs`): re-exports the five troop functions.
- **Tests** (`server/tests/api/schedule.cjs`): 7 new AT() cases -- open->browse
  ->join x3->full/no-run->leave/reappear->non-member-leave-409; cross-player
  deploy-gate rejection (409 `deployed_overlap`) with a non-overlapping squad
  still joining; legacy-slot migration on read.

### Files touched
- `server/services/core.cjs` (slot helpers + exports)
- `server/services/squads.cjs` (deploy gate broadened; `assertSeatAllowed`)
- `server/services/troops.cjs` (NEW)
- `server/schedule.cjs` (facade exports)
- `server/routes/schedule.cjs` (troop route family)
- `server/tests/api/schedule.cjs` (7 new troop tests)

### Commits (branch `req-0324-coop-troop-recruit-join`)
- `e1871872aa8f61ac5ca099e433f933a9bb2713ce` -- feature (core/squads/troops/facade/routes)
- `00563f5444366fbba21c0415391ea6d2c7d888a0` -- unit tests
- (this REQ todo->built move + outcome, following)

### Gate results
- `node server/tests/api_test.cjs` (files backend) -> **PASS** -- 206 passed,
  0 failed (1708 assertions); includes the 7 new troop tests and all existing
  solo `/api/schedule/rooms*` deploy-gate/slot/swap/sortie tests unchanged/green.
- `node_modules/.bin/tsc -p tsconfig.server.json` (server checkJs) -> **PASS** (exit 0).
- `node tools/check_engine_types.cjs` -> **PASS** (49 members verified).
- `node server/tests/pacing_test.cjs` -> **PASS** (15 passed, 0 failed).
- pg-backend api suite (`STORAGE_BACKEND=pg node server/tests/api_test.cjs`) --
  **NOT RUN**: the only reachable Postgres on this host is the LIVE pooled
  production DB (used by the running service); running the pg suite would write
  test players/rooms into it. The change never touches the storage layer (only
  the existing `storage.{read,write,delete}Room`/`listRooms` chokepoint), and the
  files backend exercises the same code paths -- pg parity is left to the
  orchestrator's full-CI run against an isolated DB.
- Scoped Playwright e2e -- **NOT RUN**: client `node_modules` are not installed
  in this worktree, and no client route consumes the new server-only endpoints
  (the solo surface the client uses is untouched). Per the brief's fallback, the
  full server unit suite (files) stands as the gate.

### Deviations / follow-ups
- The market Law-of-Possession gate (`services/squads.cjs deployedUidSet`) was
  intentionally left untouched (out of REQ scope -- the REQ scopes the gate
  change to `deployedUidSetsByOrigin` only). Because a Troop's `status` is
  `'recruiting'` (not `open`/`active`), that market gate currently does NOT lock
  a uid a player has committed to a Troop seat. Selling such a unit before
  departure is a consistency concern for REQ-0325 (departure/frozen snapshot)
  and is flagged as a follow-up there.
- The cross-room overlap 409 keeps its existing message ("...another active
  schedule (that run is still running)") for a recruiting-troop overlap too;
  the structured `reason` is the correct `deployed_overlap`, but the human string
  is slightly imprecise for a not-yet-departed troop. Left as-is to preserve the
  existing solo assertion; a message refinement is a cheap follow-up.
- `attackLv` browse filter is an EXACT match on the host-set, immutable troop
  level (documented in `listRecruitingTroops`); revisit if the fleet needs a
  range/eligibility filter.
