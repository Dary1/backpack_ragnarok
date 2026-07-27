# REQ-0311 — Co-operative Troop: slot ownership, browse, join, leave

- **State**: reserved (scope only; full spec to be written when the queue reaches it)
- **Program**: LLM Test-Play Fleet, track A (game feature).
  Design: `docs/llm_managed/2026-07-27-llm-testplay-fleet-design.md` §1, §5.
- **Depends on**: nothing technically; sequenced after REQ-0309/0310.
- **Blocks**: REQ-0312, REQ-0313, and the whole fleet.

## Scope

Today a Troop is structurally solo. `services/rooms.cjs:111` hardcodes
`visibility:'self'`; `services/squads.cjs:149` gives a slot a bare `squadIndex`
into the CALLER's own canvas, with no owner field; `getOwnRoomOr404` makes another
player's room indistinguishable from a nonexistent one. REQ-0036 golden b ("a
sortie Party = 4 Units, any number of players") and golden c (visibility + join UI)
were deferred as P2.

This REQ builds the minimum multi-player Troop:

- `room.slots[i]` becomes `{ ownerId, squadIndex, joinedAt } | null`;
  room gains `visibility:'public'|'self'` and `hostId`.
- New tail-appended route family (same order-safe pattern `router.cjs` documents):
  `GET /api/schedule/troops` (browse open), `POST /api/schedule/troops` (host),
  `POST /api/schedule/troops/:id/join`, `.../leave`, `GET .../:id`.
- The deploy gate runs against the JOINER's canvas (`isSquadDeployable`,
  uid-overlap). Note `deployedUidSetsByOrigin` currently filters
  `otherRoom.ownerId === playerId`; it must become "any active troop where I hold
  a seat".
- The existing `/api/schedule/rooms*` solo surface is untouched.

Rulings to settle in the full spec (recommendations in the design doc §5.3):
frozen-canvas semantics for four owners; who may cancel; whether `attackLv` is
host-set and immutable.
