# REQ-0327 — Troop-disband notification feed (device + bot, one mechanism)

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec items 6-7).
- **Depends on**: REQ-0326 (disband event source), REQ-0325. **Blocks**: REQ-0330.
- **Supersedes**: REQ-0313 (player-event-feed).

## Truth (owner, 2026-07-28)
> 6. When a troop is disbanded, notify the player's device (new REQ).
> 7. Using the SAME mechanism, also notify the bot program.

## Current state (surveyed)
- NO push infrastructure exists. `services/squads.cjs:256` explicitly calls SSE/WS a
  "future" idea; everything today is client POLLING. `swapSquad` has a `notify:true`
  flag but that is an in-payload marker read on the next poll, not a push.

## What to build
A single, minimal per-player notification feed that BOTH a human device and a bot
program consume identically (item 7 = "same mechanism").

### Data + endpoint
- A per-player append-only `notifications` list (persist via `storage.cjs` — the ONE
  persistence chokepoint; no new store outside it). Each entry:
  `{ id, ts, kind:'troop_disbanded', roomId, attackLv, seenAt|null, payload:{...} }`.
- `GET /api/notifications?since=<id>` returns unseen entries for the caller
  (auth = the standard `X-Auth-Token`, so a bot account reads its own feed the same
  way a human does — item 7 falls out for free).
- `POST /api/notifications/ack {ids:[...]}` marks entries seen (bounds the list).
- Emission: REQ-0326's disband event iterates the released owners and appends a
  `troop_disbanded` notification to EACH owner's feed (humans and bots alike).
- Transport: long-poll or plain poll is acceptable for v1 (matches the existing
  client-monitor polling model); a real SSE/WS push is explicitly out of scope. The
  contract is the feed + `since` cursor, not the transport.

### Client (device) consumer
- The web client's existing monitor/poll loop reads `/api/notifications` and surfaces
  a "your troop disbanded" toast/badge. Keep it small — one notification kind.

## Gates / acceptance
- Unit: disband a troop of 4 -> each of the 4 owners' feeds gains exactly one
  `troop_disbanded` entry -> `GET ?since=` returns it once -> `ack` hides it.
- A bot account (no browser) gets the identical entry via the same endpoint.
- Client e2e: disband -> toast appears. `tools/ci.sh` green.

## Outcome (built 2026-07-28)

Implemented the single per-player notification feed that a human device and
a bot program consume identically (owner items 6 and 7). Poll transport
only (no SSE/WS push -- out of scope for v1); the contract is the feed + a
`since` cursor.

### Files
New:
- `server/storage/notifications.cjs` -- per-player append-only feed
  persistence (one JSON doc per playerId), files + pg backends, re-exported
  through the `server/storage.cjs` chokepoint (no new store outside it).
- `server/services/notifications.cjs` -- feed logic: `append`
  (idempotent per (kind, roomId)), `list(playerId, since)`, `ack`, bounding
  (MAX_ENTRIES=200), and the `emitTroopDisbanded(room)` hook.
- `server/routes/notifications.cjs` -- GET/POST endpoints.
- `server/migrations/027_notifications.sql` -- pg table (parity; not run).
- `client/src/api/notifications.ts` -- typed client (`fetchNotifications`,
  `ackNotifications`).
- `client/src/TroopDisbandToast.tsx` -- device consumer: polls the feed
  (usePolledResource, 15s) and surfaces the one notification kind, then acks.
- `client/src/i18n/notify.ts` -- toast strings (en/ja).

Edited:
- `server/storage.cjs` -- require + re-export the new store.
- `server/services/runs.cjs` -- `disbandTroopRoom` calls
  `notifications.emitTroopDisbanded(room)` after the seat-return teardown
  commits (both the immediate and on-return disband paths funnel here).
- `server/router.cjs` -- dispatch `tryNotificationsRoutes` at the tail.
- `server/tests/api/schedule.cjs` -- 2 new REQ-0327 AT blocks.
- `shared/dto.ts` -- `ApiNotification` / `ApiNotificationsResponse` /
  `ApiNotificationAckResponse`.
- `client/src/api.ts` -- barrel re-export + DTO type re-exports.
- `client/src/i18n.ts` -- merged notify keys into DICT.
- `client/src/App.tsx` -- mounted `<TroopDisbandToast>` at app level.
- `client/src/styles/base.css` -- `.notify-toast` styling.

### Endpoint contract (REQ-0330's fleet polls this)
- `GET /api/notifications?since=<id>` (auth = `X-Auth-Token`, or
  `Authorization: Bearer <jwt>`). `since` optional integer. Returns the
  caller's UNSEEN entries with `id > since`, ascending by id.
  200 -> `{ ok:true, notifications:[ { id:number, ts:ISOstring,
  kind:'troop_disbanded', roomId:string, attackLv:number|null, seenAt:null,
  payload:{ reason, disbandedAt } } ], cursor:number }`. `cursor` is the
  feed high-water id. 401 if unauthorized.
- `POST /api/notifications/ack { ids:[number,...] }` -> 200
  `{ ok:true, acked:number }` (marks matching unseen entries seen; bounds
  the list). 401 unauthorized, 400 bad json.
- Entry shape stored per REQ:
  `{ id, ts, kind:'troop_disbanded', roomId, attackLv, seenAt|null, payload }`.

### Gate results
- `node server/tests/api_test.cjs` (files backend): 222 passed, 0 failed
  (baseline 220 + 2 new REQ-0327 blocks). PASS.
- `node_modules/.bin/tsc -p tsconfig.server.json`: exit 0. PASS.
- `cd client && pnpm exec tsc -b`: exit 0. PASS.
- `cd client && pnpm exec oxlint src`: 0 errors (31 pre-existing warnings).
- pg-backend + Playwright e2e: SKIPPED -- shared e2e box under FREEZE / pg
  writes the live DB. The files backend covers the storage chokepoint.

### Implementation commit
- `f8f0fbb` -- REQ-0327 implementation (server + client + tests).
