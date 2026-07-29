# REQ-0337 — Client UI to host / browse / join a public co-op Troop

- **State**: built 2026-07-29 (client-only; gates green; NOT merged, NOT deployed,
  awaiting user acceptance). See Outcome at the bottom -- the ratified scope was
  CORRECTED during implementation by the owner; read that before the spec below.
- **Program**: Reactive Test-Play Fleet — the missing HUMAN entry point.
- **Depends on**: REQ-0324/0325/0326/0327 (all done + deployed live). Server troop
  endpoints already exist and are running; this REQ is CLIENT-ONLY.
- **Blocks**: nothing. It unblocks the fleet in practice.

## Why this exists (the gap it closes)

The reactive fleet (REQ-0330, live) only joins **public recruiting Troops**
(`GET /api/schedule/troops?state=recruiting`). But the web client has **no UI** that
calls `POST /api/schedule/troops` — `client/src` never references `/schedule/troops`
at all; the expedition flow only uses the SOLO `POST /api/schedule/sorties`
(`visibility:'self'`). So a human playing through the app can only create solo
rooms, which the fleet correctly ignores. Verified 2026-07-28: a human test created
a `self` room; the fleet stayed idle; a public troop hosted via raw API filled 4/4
and departed. The engine works — only the human's in-app entry point is missing.

## Server surface already available (built by REQ-0324/0326, deployed)

```
GET    /api/schedule/troops?state=recruiting[&attackLv=]   browse open public troops
POST   /api/schedule/troops   {dungeonId,level,formationId?,squadIndex}  host + seat slot 0
POST   /api/schedule/troops/:id/join   {squadIndex}        take the first free seat
POST   /api/schedule/troops/:id/leave                      free my seat (pre-departure)
POST   /api/schedule/troops/:id/cancel                     disband on return (any member)
GET    /api/schedule/troops/:id                            full troop state
```
Auth = the normal `X-Auth-Token`. Disband already surfaces via the REQ-0327
notification toast (built). Browse returns `{roomId, seats:"k/4", attackLv, hostId, ageSec}`.

## What to build (client only)

### Minimum (unblocks the fleet — do this first)
- **Host a public Troop.** On the existing expedition / sortie screen, add a
  "公開して募集 (open to others)" choice that, instead of `createSortie` (solo),
  calls `POST /api/schedule/troops {dungeonId, level, formationId?, squadIndex}` with
  the player's chosen dungeon/level and squad 0 (or the chosen squad). After hosting,
  show the troop's live seat fill `k/4` (poll `GET /troops/:id`) and a Cancel button
  (`POST .../cancel`). This alone lets a human start a recruitment the fleet joins.
- Add the API wrappers in `client/src/api/schedule.ts`
  (`hostTroop`/`browseTroops`/`joinTroop`/`leaveTroop`/`cancelTroop`/`getTroop`) and
  the DTO types in `shared/dto.ts` mirroring the server shapes.

### Fuller -- DROPPED 2026-07-29 (unreachable, not deferred). See Outcome.
- **Browse & join others' Troops.** A small co-op lobby (a tab/section on the
  expedition screen) listing `GET /troops?state=recruiting` (seats, attackLv, host,
  age), with a Join button (`POST .../join {squadIndex}`) and Leave. This lets a
  human JOIN a troop the bots (or other humans) are in — the full co-op loop, not
  just hosting.
- Live seat updates via the existing client poll/monitor cadence (no SSE needed).
- i18n en+ja for every new string.

## Rulings / notes
- Keep the solo expedition path (`/sorties`, `/rooms`) exactly as-is; this is
  additive (a second, opt-in mode), matching the additive server design.
- Deploy-gate errors (uid already deployed, empty squad) already return structured
  `reason`s — surface them with the existing `friendlyScheduleError` mapping.
- No new server work. If a gap is found server-side, split it into its own REQ.

## Gates / acceptance
- `cd client && pnpm exec tsc -b` exit 0; `pnpm build` exit 0.
- Playwright e2e is under the REQ-0217 freeze on the shared box — author a
  `client/e2e/troop-host.spec.ts` (host → seats show → fleet/other joins → departs;
  or host → cancel) but running it waits for the freeze to lift; note this in the
  outcome. Manual live check: host from the app → confirm the fleet drip-joins
  (`journalctl --user -u backpack-fleet -f`) → 4/4 → departs.
- Server `node server/tests/api_test.cjs` stays green (should be untouched).

## Follow-ups / not in scope
- Wiring `bot/tests` into `tools/ci.sh` (separate housekeeping).
- Any richer matchmaking/lobby (bands, filters) — deliberately omitted; the fleet
  is reactive and needs only host + browse/join.

---

# Outcome (2026-07-29)

## Scope correction, made by the owner during implementation

The spec above offered a "Minimum" (host) and a "Fuller" (host + browse/join),
and marked Fuller *recommended*. The owner rejected that framing on two counts
and was right on both.

**1. Fuller is unreachable, not merely optional.** `bot/lib/allowlist.cjs`
carries a compiled-in HARD_DENY:

```js
{ re: /^\/api\/schedule\/troops$/, denyMethods: ['POST'],
  why: 'the fleet NEVER hosts -- it only reacts to a recruitment a player started' }
```

The fleet is a purely REACTIVE joiner: it can browse, join and leave, and is
refused hosting by its own client before a request ever goes out. So a browse /
join lobby would list bot-hosted troops that cannot exist. With one human on the
box the list is permanently empty. Browse/join UI is therefore **dropped, not
deferred** -- it becomes worth building the day a second human plays, and the
API wrappers (`browseTroops`/`joinTroop`/`leaveTroop`) are already in place for
that day. The asymmetry the owner named -- the fleet is passive, so only the
HUMAN can be the active side -- is the actual design fact; the spec above had it
backwards by treating both directions as symmetric halves of one feature.

**2. Almost no new UI is warranted.** The owner's read: a player opens a room
and others come in -- that is the whole feature. Verified, and it very nearly
holds:

- `services/rooms.cjs listOwnRooms` filters by `ownerId` ONLY, never by
  `visibility`, so a hosted Troop already arrives in the ordinary rooms list.
  **No new list, no new screen, no new route, no new poll loop.**
- `runs.cjs settleRoomIfDue` is the SAME function `troops.cjs settleTroopIfDue`
  delegates to (the latter just passes `profileCanvas = null`; per-owner canvases
  are re-read inside the run engine). So the existing 4s `GET /rooms` poll
  already settles and auto-restarts a departed Troop correctly. **No new server
  work, confirmed rather than assumed.**
- What could NOT be zero: nothing in the client reached `POST /troops` at all,
  and the solo disband endpoint corrupts a Troop (below).

The implemented shape adds **no toggle, no checkbox, no screen** -- only a
change in what the existing single CTA does:

| squads mustered | what the one button does |
|---|---|
| 4 | SOLO -- `POST /api/schedule/sorties`, unchanged |
| 1-3 | `POST /api/schedule/troops` (host in slot 0) + one `POST .../join` per remaining squad; **the seats left empty ARE the recruitment** |
| 0 | not ready |

The owner also corrected the vocabulary: with 1-3 squads this is **募集**
(recruit), NOT 出撃 (depart) -- the Troop does not move until its fourth seat
fills (REQ-0325). The copy and the CTA follow that: "Open the call" / 「募集を
かける」, never "march".

## The NPC-ban checkbox -> REQ-0338

The owner asked for an "NPC禁止" checkbox, default OFF. It is NOT in this REQ,
because there is nothing under it: `npc` / `humansOnly` / `botsAllowed` return
ZERO hits across `server/` and `shared/dto.ts`. A Troop carries
`{visibility, hostId, state, slots, level}` and has no way to express who may
sit down. Worse, a fleet account is an ordinary player (`p_01f30501d312`, ...)
with no marker in `/api/me`'s roles -- REQ-0324's stated premise is "a bot
account browses/joins EXACTLY like a human", so the server cannot currently
tell them apart at all.

Per this REQ's own ruling ("No new server work. If a gap is found server-side,
split it into its own REQ") that work is **REQ-0338** (reserved 3418f09), which
owns the flag, the fleet-side skip, and the checkbox together -- so the control
never ships inert.

## What was built

- `shared/dto.ts` -- `ApiTroop` / `ApiTroopSlot` / `ApiTroopDisbandEvent` /
  `ApiHostTroopBody` / `ApiTroopBrowseRow`, mirroring `services/troops.cjs`
  field-for-field. `ApiRoom` widened where a hosted Troop makes the old
  declarations untrue: `visibility: 'self' | 'public'`, `status` gains
  `'recruiting'`, plus optional `state` / `hostId`, and `ApiRoomSlot` gains
  optional `ownerId` / `joinedAt`.
- `client/src/api/schedule.ts` -- `hostTroop` / `browseTroops` / `joinTroop` /
  `leaveTroop` / `cancelTroop` / `getTroop`.
- `client/src/sortie/` -- `SortiePage` picks solo vs recruit by squad count;
  `LaunchBar` gains the third (recruit) state; `TroopSlots` re-reads an empty
  slot as an open seat once the muster has begun.
- `client/src/schedule/seats.ts` -- NEW. The single place that knows the two
  seat shapes (see faults below).
- `RoomCard` -- `recruiting` status, live `k/4` chip, recruit-held seats
  labelled rather than mis-resolved, disband routed to the troop endpoint.
  `SchedulePage` -- one line when a call is standing. `SlotsPanel` -- read-only
  on a Troop.
- i18n en+ja for every new string. CSS for the new states.

## Two latent faults found and fixed (would have fired regardless of this UI)

Because `listOwnRooms` never filtered on visibility, ANY Troop the player hosts
lands in the ordinary rooms list -- so these were live the moment a troop was
hosted by any means, including the raw-API test on 2026-07-28:

1. **Crash.** `useSquadConflicts.deploymentFor` and
   `useSquadDeployment.roomsFor` both did
   `room.slots.some((s) => s.squadIndex === index)`. A Troop's FREE seat is
   `null` (a solo room's is `{squadIndex:null}`), so this **throws a TypeError**
   -- taking down the sortie page and the squad status board.
2. **Silent wrong answer.** The same predicate matched ANOTHER seat owner's
   `squadIndex` as the viewer's own squad, marking the player's squads deployed
   because a stranger deployed theirs. `SlotsPanel`'s deploy-gate pre-disable
   had the same flaw.

Both now go through `schedule/seats.ts`, which is null-safe and owner-scoped
(every room the client holds came from `listOwnRooms`, so `room.ownerId` IS the
viewer).

A third hazard was closed before it could fire: the disband button sent the solo
`DELETE /rooms/:id`. On a Troop that **succeeds for the host** while returning no
seats to the other members (their uids stay deploy-gated and market-frozen) and
emitting no REQ-0327 `troop_disbanded` notification -- stranding every recruit,
including the bots whose auto-seller keys off exactly that signal. It now sends
`POST /troops/:id/cancel`. `SlotsPanel` is read-only on a Troop for the sibling
reason: `PUT /rooms/:id/slots/:i` writes a solo-shaped `{squadIndex}` and would
overwrite a co-op seat's `ownerId`.

## Gates

| gate | result |
|---|---|
| `cd client && pnpm exec tsc -b` | exit 0 |
| `cd client && pnpm build` | exit 0 |
| `node server/tests/api_test.cjs` | **223 passed, 0 failed** |
| `cd client && pnpm exec oxlint` | 45 warnings, 0 errors -- identical to master |
| `client/e2e/troop-host.spec.ts` | **authored, NOT run** (REQ-0217 freeze) |
| **manual live check vs the running fleet** | **PASS x3** -- see below |

Server **source** is untouched. One server TEST was added, deliberately:
REQ-0337's whole shape rests on the host seating a SECOND squad of their own in
the troop they just opened, and every pre-existing troop test joins as a
DIFFERENT player -- so the same-player path was unpinned, in exactly the bucket
(`squads.cjs deployedUidSetsByOrigin`'s `sameRoom`) where it could start
silently refusing. Now asserted, together with "a 2/4 troop stays recruiting"
and "the same squad twice still 409s `same_room_duplicate`".

## Commits (branch `req-0337-client-coop-troop-ui`)

- `3418f09` docs: reserve REQ-0338-troop-humans-only-no-npc
- `0846002` client can open a PUBLIC co-op Troop (+ the two latent fixes)
- `0c4fe2c` e2e spec (authored, not run) + the host-second-squad server test

## Live check vs the running fleet -- 2026-07-29, PASS

**Method.** The branch build was served on `127.0.0.1:8899` by a throwaway proxy
(`/app/*` -> this worktree's `web/app`, `/api/*` -> the LIVE api on `:8802`, the
same one `backpack-fleet` polls). That exercises the NEW client against the real
fleet **without redeploying `web/app`** -- `backpack-web` and every other live
service were left untouched and verified still `active` afterwards. A headless
Chromium drove the actual sortie UI as a player; no e2e harness was involved, so
the REQ-0217 freeze is not implicated. Proxy stopped, port released.

**What the UI did** (fresh guest `p_563d8b7cd48a`, one squad mustered):

```
CTA mode, 0 squads = solo      (button disabled)
CTA mode, 1 squad  = recruit
CTA label          = "Open the call ⚑"
bar copy           = "Four squads make a troop -- you have mustered 3 fewer,
                      so those seats go up publicly and anyone may take them."
empty slot ghost   = "Open seat -- recruiting"
card status chip   = "Recruiting"      seats chip = "1/4 seats"
seat chips         = ["I:Slot4", "II:— open —", "III:— open —", "IV:— open —"]
```

**What the fleet did** -- three troops hosted from the app, all three filled and
departed with no intervention:

```
04:27:17  target acquired: troop room_c446897703028e14 -- drip-joining / 30000ms
04:27:18  joined p_01f30501d312 into troop (1 seat(s) filled by fleet)
04:27:49  joined p_03895866236a into troop (2 seat(s) filled by fleet)
04:28:19  joined p_03faaec30350 into troop (3 seat(s) filled by fleet)
04:28:19  target room_c446897703028e14 done: troop_departed
04:30:06  target acquired: troop room_b8209a7ab5b012e4
04:30:07 / 04:30:39 / 04:31:10  joined -> troop_departed 04:31:10
04:32:38  target acquired: troop room_8b965fd0d2ba3eac
04:32:39 / 04:33:11 / 04:33:42  joined -> troop_departed 04:33:42
```

**The host's seat count climbing on its own**, read off the live DOM with no
reload and no new poll loop (SchedulePage's existing 4s rooms poll only):

```
t+0s    recruiting | 2/4 seats
t+35s   recruiting | 3/4 seats
t+65s   running    | (chip gone -- correct: it is no longer recruiting)
```

That is the REQ's stated acceptance criterion met end to end: host from the app
-> the fleet drip-joins -> 4/4 -> departs.

### The live check earned its keep: a THIRD crash

The first run threw, in the browser:

```
TypeError: Cannot read properties of null (reading 'squadIndex')
```

from `Monitor.tsx` -- twice (the squad-visual mount and the `squadNames`
useMemo), same `room.slots.map(s => s.squadIndex)` fault as the two already
fixed. `MonitorErrorBoundary` contained it (REQ-0285 earning ITS keep), so the
app survived, but the **entire Watch pane was dead for any Troop**. The static
sweep missed it because that file reads slots for RENDERING, not for gating;
only a real browser on a real troop surfaced it. Fixed in `07e86f0`, and
`isOwnSeat` was promoted to a **type guard** (`OwnSeat = ApiRoomSlot &
{ squadIndex: number }`) so reading `.squadIndex` off an unguarded slot is now a
compile error rather than a thing to remember. Re-run after the fix: clean --
the only console noise left is two 404s for `/redesign/assets/*.jpg`, which the
scratch proxy does not map and the live web server serves 200.

### Live leftovers

- Guest `p_563d8b7cd48a` ("REQ0337 LiveCheck") still exists on live. Harmless;
  purge on request.
- `room_b8209a7ab5b012e4` / `room_8b965fd0d2ba3eac` were cancelled mid-run, so
  they carry `disbandRequested` and self-disband on return (REQ-0326's deferred
  path) -- returning every bot's seat and firing its REQ-0327 notification.
  `room_c446897703028e14` is already `canceled`.

## Merged + deployed -- 2026-07-29

- `2517c83` merge into master (`--no-ff`, from pre-merge `967ca37`).
- `e8f2b77` HOTFIX, see below.

No service restart was needed or performed: server source is untouched, and
`web/app` is a static docroot served from disk by `backpack-web`. All four
services (`backpack-api` / `-web` / `-fleet` / `-tunnel`) stayed `active`
throughout.

### HOTFIX e8f2b77 -- the merged bundle had EMPTY `VITE_SUPABASE_*`

**This was a real regression that shipped for a few minutes. Recording it in
full, because the failure mode is invisible and will recur.**

`client/.env.local` is GITIGNORED, so it exists ONLY in `~/backpack_ragnarok`
and a `git worktree` never receives it. Vite inlines `VITE_*` at BUILD time. The
bundle merged in `2517c83` was built inside the req-0337 worktree, so it baked in

```js
{BASE_URL:"/app/",DEV:!1,MODE:"production",PROD:!0,SSR:!1}
```

with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` simply ABSENT, where the
pre-merge master bundle had both. `supabaseClient()` returns `null` when either
is missing, so REQ-0118c Supabase auth was **silently dead** in the deployed
app -- not throwing, just never constructing a client.

**Every gate passed anyway.** `tsc -b`, `pnpm build`, `oxlint` and `api_test`
are all perfectly happy with an env-less build, and the REQ-0337 live check
signed in over the invite-token path (`#/invite/<token>`), which never touches
Supabase. It surfaced only because rebuilding on master produced a DIFFERENT
bundle hash than the one just committed -- and that discrepancy was chased down
instead of waved off as build nondeterminism. It is not nondeterminism: the
build is byte-stable within a tree, and differed between trees precisely because
the env differed.

Fixed by rebuilding `web/app` in the main checkout and committing that output
(no source change). Verified: `VITE_SUPABASE_URL` and the `auth.qtie.jp` origin
are back in the served bundle, and a rebuild on master now changes nothing.

**Rule this implies -- belongs in PROJECT.md, which agents may not edit, so it
is flagged to the user instead:** `web/app` is a TRACKED, ENV-DEPENDENT build
artifact. Build it in the main checkout, or copy `client/.env.local` into the
worktree first. A worktree-built client bundle must never be committed. A cheap
standing guard is `grep -c VITE_SUPABASE_URL: web/app/assets/index-*.js` before
any client merge.

### Post-deploy verification, against the real tunnel origin

```
landing https://backpack-dev.qtie.jp/app/  -> loads, supabase config present
CTA mode, 0 squads = solo
clicked 1 squad    -> CTA mode = recruit,  label "Open the call ⚑"
committed          -> RECRUITING room_5198fbb2277a5006 | 1/4 seats
console problems   = NONE

05:07:53  target acquired: troop room_5198fbb2277a5006
05:07:54 / 05:08:25 / 05:08:55  fleet joined -> troop_departed 05:08:55
```

Also observed incidentally, confirming the disband path end to end: the troops
cancelled during the pre-merge check disbanded on return and each bot's
auto-seller fired on its REQ-0327 notification (`1 disband event(s) -- selling
all drops`).

## Still owed before this can move to `done`

1. **User acceptance** of the scope correction recorded above (Fuller dropped,
   NPC-ban split to REQ-0338). Everything else is complete: merged, deployed,
   and verified live.
2. Optional cleanup: guest players `p_563d8b7cd48a` and `p_7d4eaa8afaa7` were
   created for the live checks and still exist.

## Follow-ups

- **REQ-0338** -- the NPC-ban flag (server + fleet + the checkbox).
- Browse/join UI, if and when a second human plays. Wrappers already exist.
- Wiring `bot/tests` into `tools/ci.sh` (unchanged, still separate housekeeping).
