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
