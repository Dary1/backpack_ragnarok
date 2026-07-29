# REQ-0337 — Client UI to host / browse / join a public co-op Troop

- **State**: todo (spec written, ratified 2026-07-28, cleared to implement; queued).
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

### Fuller (recommended, same REQ if scope allows)
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
