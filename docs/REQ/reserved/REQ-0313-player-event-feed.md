# REQ-0313 — Player event feed (notifications)

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track A. Design doc §4 (revised, reactive model).
- **Depends on**: REQ-0311, REQ-0312.
- **Blocks**: REQ-0316, REQ-0319.

## Scope

A player needs to be told when their Troop filled, when a run settled, and when a
Troop disbanded — this is a plain game requirement, independent of any bot. The
reactive fleet needs exactly the same signal to know when to wake.

So: build ONE feed, consumed by both the player UI and the bot daemon.

- `GET /api/events?since=<cursor>` → ordered events for the caller, plus the
  public `party_opened` stream needed for matchmaking.
- Event kinds (initial): `party_opened`, `seat_taken`, `seat_left`, `troop_filled`,
  `run_settled`, `troop_disbanded`.
- Poll-based with a cursor, matching the codebase's existing lazy, poll-driven
  posture (`settleRoomIfDue`); no standing connections, no push infrastructure.

This REQ replaces the "muster rules / auto-dissolve / greeter seat" REQ from the
first design draft: under the reactive model bots never host, so fragmentation
cannot occur and none of that machinery is needed.
