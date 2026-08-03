// client/src/api/schedule.ts -- REQ-0145b (ca): the Dungeon Schedule
// endpoints (extracted VERBATIM from the old flat api.ts). REQ-0308
// removed the REQ-0057 forecast read that used to live here too.
import { scheduleJSON } from './http';
import type {
  ApiCreateRoomBody,
  ApiHostTroopBody,
  ApiSortieBody,
  ApiTroop,
  ApiTroopBrowseRow,
  ApiDungeonsPayload,
  ApiRoom,
  ApiRunView,
  ApiSealComparison,
  ApiSealMetaResponse,
  ApiSealMintResponse,
  ApiSealReplay,
} from '../../../shared/dto';

// ---- REQ-0036 P1-C: Dungeon Schedule + Warehouse client API ----
// Talks to server/api.cjs's /api/schedule/* and /api/warehouse* routes
// (server/schedule.cjs is the business logic; see server/README.md's
// "Dungeon Schedule API" section for the full endpoint table). Same
// conventions as every function above: ApiError on non-2xx, authHeaders()
// spread into every request's headers, a JSDoc citing the exact server
// route each function hits.

/** One room's cancel policy (golden g). `immediate:false` means "cancel
 * after the current run finishes" rather than right away. */
export function fetchDungeons(): Promise<ApiDungeonsPayload> {
  return scheduleJSON<ApiDungeonsPayload>('/api/schedule/dungeons');
}

/** POST /api/schedule/rooms -- creates a room owned by the caller. */
export function createRoom(body: ApiCreateRoomBody): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON('/api/schedule/rooms', { method: 'POST', body: JSON.stringify(body) });
}

/** POST /api/schedule/sorties -- REQ-0239 (D1). Atomically creates a room, fills
 * all four squad slots under the deploy gate, and launches. A 409 (shared-unit
 * collision) rolls the room back server-side. */
export function createSortie(body: ApiSortieBody): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON('/api/schedule/sorties', { method: 'POST', body: JSON.stringify(body) });
}

/** GET /api/schedule/rooms -- lists the CALLER's own rooms only. */
export function fetchRooms(): Promise<{ ok: true; rooms: ApiRoom[] }> {
  return scheduleJSON('/api/schedule/rooms');
}

/** GET /api/schedule/rooms/:id -- settles a due run first (server-side
 * lazy settlement), then returns the room. */
export function fetchRoom(roomId: string): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}`);
}

/** DELETE /api/schedule/rooms/:id -- cancel (golden g). Immediate or
 * queued (`cancelRequested`) depending on the room's own cancelPolicy +
 * whether a run is currently active. */
export function cancelRoom(roomId: string): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}

/** PUT /api/schedule/rooms/:id/slots/:slotIndex {squadIndex} -- assigns
 * one of the caller's OWN squads to a squad slot (golden b). Throws
 * ApiError(409) on a deploy-gate violation (see errorMessageFor() in
 * schedule/errors.ts for the human-readable mapping of the 409 message). */
export function assignSlot(roomId: string, slotIndex: number, squadIndex: number): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/slots/${slotIndex}`, {
    method: 'PUT',
    body: JSON.stringify({ squadIndex }),
  });
}

/** PUT /api/schedule/rooms/:id/swap {slot, squadIndex} -- golden j. */
export function swapSquad(
  roomId: string,
  slot: number,
  squadIndex: number
): Promise<{ ok: true; room: ApiRoom; applied: boolean }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/swap`, {
    method: 'PUT',
    body: JSON.stringify({ slot, squadIndex }),
  });
}

/** GET /api/schedule/rooms/:id/run -- run-clock-paced replay view (see
 * server/README.md's "Run-clock design"). Poll roughly every ~2s while a
 * room is active/has a recent run; each poll returns the FULL events
 * array up to the current elapsedSecs (not just new deltas) -- see
 * Monitor.tsx's own poll-and-diff loop for how the client tracks "last
 * rendered event index" across polls. */
export function fetchRun(roomId: string): Promise<ApiRunView> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/run`);
}

/** POST /api/schedule/rooms/:id/dev/backdate -- REQ-0036 P1-C dev-only
 * E2E time-control seam (see server/README.md's "P1-C addendum" /
 * schedule.cjs's devBackdateActiveRun() doc comment). ONLY succeeds
 * (200) when the caller resolved via the dev_mode no-token fallback;
 * any real guest token gets 403. Not called by any production UI path --
 * exported here solely so client/e2e/schedule.spec.ts can drive it over
 * the same typed client every other test helper uses, rather than a raw
 * fetch call in the spec file. */
export function devBackdateRun(roomId: string, extraSecsIntoPast?: number): Promise<{ ok: true; runId: string; startedAt: string; durationSecs: number }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/dev/backdate`, {
    method: 'POST',
    body: JSON.stringify(extraSecsIntoPast != null ? { extraSecsIntoPast } : {}),
  });
}

// ---- REQ-0058: Sealed Seed Share client API ----
// Talks to server/routes/schedule.cjs's /api/schedule/seal[s] routes. Same
// conventions as every function above (ApiError on non-2xx, authHeaders()
// via scheduleJSON, a JSDoc citing the exact server route).

/** POST /api/schedule/seal -- mint a sealed schedule. The server always
 * mints a FRESH genSeed (any caller-supplied seed is ignored), so REQ-0043's
 * admin-only custom-seed gate is never involved. Returns the public seal
 * meta (genSeed withheld) + the shareToken (== sealId). */
export function sealSchedule(body: { dungeonId?: string; dungeonType?: 'default' | 'test_fixed'; level?: number; affixes?: string[] }): Promise<ApiSealMintResponse> {
  return scheduleJSON('/api/schedule/seal', { method: 'POST', body: JSON.stringify(body) });
}

/** GET /api/schedule/seals/:sealId -- preview a seal by its share token
 * (frozen tuple, genSeed withheld) + whether the caller has joined. */
export function fetchSeal(sealId: string): Promise<ApiSealMetaResponse> {
  return scheduleJSON(`/api/schedule/seals/${encodeURIComponent(sealId)}`);
}

/** POST /api/schedule/rooms {sealId} -- join a sealed run (the room copies
 * the frozen tuple verbatim). One room per (sealId, caller); a second call
 * throws ApiError(409, 'seal_already_joined'). */
export function joinSealRoom(sealId: string): Promise<{ ok: true; room: ApiRoom }> {
  const body: ApiCreateRoomBody = { dungeonId: '', sealId };
  return scheduleJSON('/api/schedule/rooms', { method: 'POST', body: JSON.stringify(body) });
}

/** GET /api/schedule/seals/:sealId/comparison -- the anti-spoiler-gated
 * comparison view. `unlocked` is false (and `participants` empty) until the
 * caller's OWN run of this sealId settles; `self` is always present. Throws
 * ApiError(403, 'seal_not_participant') for a non-participant. */
export function fetchSealComparison(sealId: string): Promise<ApiSealComparison> {
  return scheduleJSON(`/api/schedule/seals/${encodeURIComponent(sealId)}/comparison`);
}

/** GET /api/schedule/seals/:sealId/runs/:playerId -- seal-scoped replay.
 * Own replay always readable; another participant's is gated on the caller's
 * own settle (ApiError(403, 'seal_replay_locked') otherwise). */
export function fetchSealReplay(sealId: string, playerId: string): Promise<ApiSealReplay> {
  return scheduleJSON(`/api/schedule/seals/${encodeURIComponent(sealId)}/runs/${encodeURIComponent(playerId)}`);
}

// ---- REQ-0337: co-operative Troop client API ----
// Talks to server/routes/schedule.cjs's /api/schedule/troops* routes (business
// logic in server/services/troops.cjs). Same conventions as every function
// above: ApiError on non-2xx, authHeaders() spread in via scheduleJSON, a JSDoc
// citing the exact server route. Auth is the ordinary X-Auth-Token -- a bot
// account browses/joins through these EXACT endpoints, indistinguishably.
//
// NOTE the deliberate asymmetry with the solo /rooms* surface: a Troop is
// created with ONE squad (the host's, seated in slot 0) and its remaining seats
// are the recruitment. It is never launched by the client -- filling the fourth
// seat auto-departs it server-side (REQ-0325).

/** POST /api/schedule/troops -- opens a PUBLIC recruiting Troop and seats the
 * caller in slot 0 with `body.squadIndex`. Atomic: a rejected host seating
 * (deploy gate) deletes the freshly-created room, so a failed open leaves no
 * idle Troop behind. Throws ApiError(409) with the same structured `reason`s
 * the solo assign path uses -- map via friendlyScheduleError(). */
export function hostTroop(body: ApiHostTroopBody): Promise<{ ok: true; troop: ApiTroop }> {
  return scheduleJSON('/api/schedule/troops', { method: 'POST', body: JSON.stringify(body) });
}

/** GET /api/schedule/troops?state=recruiting[&attackLv=] -- browse OPEN public
 * Troops that still have a free seat. Returns the compact browse projection,
 * not full troops. This is the exact signal the reactive fleet polls. */
export function browseTroops(opts?: { state?: string; attackLv?: number }): Promise<{ ok: true; troops: ApiTroopBrowseRow[] }> {
  const qs = new URLSearchParams({ state: opts?.state ?? 'recruiting' });
  if (opts?.attackLv != null) qs.set('attackLv', String(opts.attackLv));
  return scheduleJSON(`/api/schedule/troops?${qs.toString()}`);
}

/** POST /api/schedule/troops/:id/join {squadIndex} -- takes the LOWEST free
 * seat with one of the CALLER's own squads. The deploy gate runs against the
 * joiner's own canvas. Filling the last seat auto-departs the Troop, so the
 * returned troop may already be state:'active'. The host calls this too, to
 * seat a SECOND/THIRD squad of their own in a Troop they just opened. */
export function joinTroop(roomId: string, squadIndex: number): Promise<{ ok: true; troop: ApiTroop }> {
  return scheduleJSON(`/api/schedule/troops/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    body: JSON.stringify({ squadIndex }),
  });
}

/** POST /api/schedule/troops/:id/leave -- frees the caller's seat before
 * departure. 409s once the Troop has departed. */
export function leaveTroop(roomId: string): Promise<{ ok: true; troop: ApiTroop }> {
  return scheduleJSON(`/api/schedule/troops/${encodeURIComponent(roomId)}/leave`, { method: 'POST' });
}

/** POST /api/schedule/troops/:id/cancel -- REQ-0326. ANY seated member cancels
 * and the WHOLE Troop disbands (all-or-nothing): no run in flight -> now; a dive
 * in flight -> on return, after the current run settles its rewards. Every seat
 * is returned and each released owner gets a REQ-0327 troop_disbanded
 * notification.
 *
 * A Troop MUST be disbanded through here and never through the solo
 * DELETE /api/schedule/rooms/:id -- that path is owner-guarded, returns no
 * seats to the other members, and emits no disband notification. */
export function cancelTroop(roomId: string): Promise<{ ok: true; troop: ApiTroop }> {
  return scheduleJSON(`/api/schedule/troops/${encodeURIComponent(roomId)}/cancel`, { method: 'POST' });
}

/** GET /api/schedule/troops/:id -- full Troop state. Settles + lazily
 * auto-restarts a DEPARTED troop on read (poll-driven, exactly like the solo
 * /rooms scheduler); a still-recruiting Troop settles to a no-op. */
export function getTroop(roomId: string): Promise<{ ok: true; troop: ApiTroop }> {
  return scheduleJSON(`/api/schedule/troops/${encodeURIComponent(roomId)}`);
}
