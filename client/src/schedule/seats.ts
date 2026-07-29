// client/src/schedule/seats.ts -- REQ-0337. One place that knows how to read a
// room's four seats, because there are now TWO seat shapes on the SAME
// ApiRoom.slots array and confusing them is silently wrong rather than loudly
// broken:
//
//   solo room (visibility:'self')     slot = { squadIndex: number | null }
//   co-op Troop (visibility:'public') slot = { ownerId, squadIndex, joinedAt }
//                                            | null   <-- a FREE seat
//
// Two traps this module exists to close:
//
//  1. A Troop's free seat is `null`, NOT `{squadIndex:null}`. Every pre-REQ-0337
//     `room.slots.some((s) => s.squadIndex === i)` therefore THROWS the moment a
//     Troop appears in the rooms list -- and it does appear, because
//     GET /api/schedule/rooms filters by ownerId only (services/rooms.cjs
//     listOwnRooms), never by visibility, so a Troop the player HOSTS is
//     returned right alongside their solo rooms.
//
//  2. A Troop seat's `squadIndex` indexes THAT SEAT OWNER's canvas. Matching it
//     against the viewer's own squad indices marks the viewer's squads as
//     deployed when it was a stranger who deployed theirs -- a wrong answer that
//     looks perfectly plausible, which is worse than a crash.
//
// Whose seats are "ours"? Every room the client holds came from listOwnRooms, so
// `room.ownerId` IS the viewer. A seat is the viewer's iff it carries no ownerId
// at all (solo shape, owner implied -- the same attribution server-side
// normalizeSlot() applies to a legacy ownerless slot) or its ownerId equals
// room.ownerId.
import type { ApiRoom, ApiRoomSlot } from '../api';

/** True if `room` is a co-operative Troop rather than a solo room. */
export function isTroopRoom(room: ApiRoom): boolean {
  return room.visibility === 'public';
}

/** True if `room` is a Troop still gathering squads (waiting on PEOPLE, not on
 * a cooldown). REQ-0324 parks a recruiting Troop's `status` off the solo run
 * lanes, so both fields are checked. */
export function isRecruiting(room: ApiRoom): boolean {
  return room.status !== 'canceled' && (room.status === 'recruiting' || (isTroopRoom(room) && room.state === 'recruiting'));
}

/** True if this seat belongs to the room's own owner (== the viewer). A free
 * seat -- `null` on a Troop, `{squadIndex:null}` on a solo room -- is nobody's. */
export function isOwnSeat(slot: ApiRoomSlot | null | undefined, room: ApiRoom): boolean {
  if (!slot || slot.squadIndex == null) return false;
  return slot.ownerId == null || slot.ownerId === room.ownerId;
}

/** True if the VIEWER's squad `squadIndex` occupies a seat of `room`. Null-safe
 * over free seats, and never matches another seat owner's index. */
export function roomHoldsOwnSquad(room: ApiRoom, squadIndex: number): boolean {
  return room.slots.some((slot) => isOwnSeat(slot, room) && slot.squadIndex === squadIndex);
}

/** How many of the four seats are taken, by anyone. This is the recruitment's
 * headline number ("2/4"). */
export function seatsTaken(room: ApiRoom): number {
  return room.slots.filter((slot) => slot != null && slot.squadIndex != null).length;
}

/** Squad indices of the VIEWER's that are seated in `room`. Used by the deploy-
 * gate pre-disable logic, which must not pre-disable one of the viewer's squads
 * merely because a stranger's seat happens to carry the same index. */
export function ownSeatedSquadIndices(room: ApiRoom): number[] {
  const out: number[] = [];
  for (const slot of room.slots) {
    if (isOwnSeat(slot, room) && slot!.squadIndex != null) out.push(slot!.squadIndex);
  }
  return out;
}
