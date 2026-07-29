// client/src/schedule/useSquadDeployment.ts -- REQ-0239 (design 02 sec 3): the
// per-squad board state derivation. From GET /api/schedule/rooms (+ the B1
// lastRun window) and the store presets, produce -- for EVERY squad the player
// owns -- what it is doing, where, and when it frees up. The board renders
// whatever the room doc says (B2): a reserved cancel NEVER frees the squad now;
// its release time is the run end (or cooldownUntil), shown as-is.
import { useMemo } from 'react';
import type { ApiRoom } from '../api';
import { isRecruiting, roomHoldsOwnSquad, seatsTaken } from './seats'; // REQ-0337
import { useGameStore } from '../store';
import {
  squadCanvasOf,
  type GameStateLike,
  type SquadCanvas,
} from '../sortie/squadCanvas';

export type BoardStateKey = 'deployed' | 'recovering' | 'staging' | 'ready' | 'undeployable';

export interface SquadBoardState {
  index: number;
  name: string;
  canvas: SquadCanvas | null;
  state: BoardStateKey;
  cancelReserved: boolean;
  roomId: string | null;
  dungeonId: string | null;
  level: number | null;
  /** deployed: run window (startedAt + durationSecs) for honest wall-clock progress. */
  runStartedAtMs: number | null;
  runDurationSecs: number | null;
  /** deployed release/return + recovering redeploy time. */
  releaseAtIso: string | null;
  /** recovering: cooldown target. */
  cooldownUntilIso: string | null;
  /** staging: how many of the 4 slots are filled. */
  stagingSlotsFilled: number | null;
}

// The room a squad is "in", by precedence: ACTIVE beats an open/cooldown room.
function roomsFor(index: number, rooms: ApiRoom[]): { active: ApiRoom | null; cooldown: ApiRoom | null; staging: ApiRoom | null } {
  let active: ApiRoom | null = null;
  let cooldown: ApiRoom | null = null;
  let staging: ApiRoom | null = null;
  for (const room of rooms) {
    if (room.status === 'canceled') continue;
    // REQ-0337: null-safe + owner-scoped (see schedule/seats.ts). The old
    // `s.squadIndex === index` threw on a Troop's null free seats and could
    // match a stranger's index as this player's squad.
    if (!roomHoldsOwnSquad(room, index)) continue;
    if (room.status === 'active') active = room;
    else if (room.status === 'open' && room.cooldownUntil && Date.parse(room.cooldownUntil) > Date.now()) cooldown = room;
    // REQ-0337: a Troop awaiting recruits is 'staging' too -- the squad IS
    // committed (its uids are deploy-gated and market-frozen by the live seat),
    // it is simply waiting on people rather than on the player finishing the
    // muster. Same tile state, honest seat count.
    else if (room.status === 'open' || isRecruiting(room)) staging = room;
  }
  return { active, cooldown, staging };
}

export function useSquadDeployment(rooms: ApiRoom[] | null): SquadBoardState[] {
  const snapshot = useGameStore();
  const state = (snapshot.state as GameStateLike | null) ?? null;
  const engine = snapshot.engine;
  const presets = state?.presets ?? null;

  return useMemo<SquadBoardState[]>(() => {
    const names = presets?.names ?? [];
    return names.map((name, index) => {
      const canvas = squadCanvasOf(state, index);
      const base: SquadBoardState = {
        index, name, canvas,
        state: 'ready', cancelReserved: false,
        roomId: null, dungeonId: null, level: null,
        runStartedAtMs: null, runDurationSecs: null,
        releaseAtIso: null, cooldownUntilIso: null, stagingSlotsFilled: null,
      };
      if (!rooms) return base;
      const { active, cooldown, staging } = roomsFor(index, rooms);

      if (active) {
        const lr = active.lastRun;
        const startedMs = lr && lr.startedAt ? Date.parse(lr.startedAt) : null;
        const dur = lr && typeof lr.durationSecs === 'number' ? lr.durationSecs : null;
        const releaseAtIso = startedMs != null && dur != null ? new Date(startedMs + dur * 1000).toISOString() : null;
        return {
          ...base, state: 'deployed', cancelReserved: !!active.cancelRequested,
          roomId: active.id, dungeonId: active.dungeonId, level: active.level,
          runStartedAtMs: startedMs, runDurationSecs: dur, releaseAtIso,
        };
      }
      if (cooldown) {
        return {
          ...base, state: 'recovering', cancelReserved: !!cooldown.cancelRequested,
          roomId: cooldown.id, dungeonId: cooldown.dungeonId, level: cooldown.level,
          releaseAtIso: cooldown.cooldownUntil, cooldownUntilIso: cooldown.cooldownUntil,
        };
      }
      if (staging) {
        return {
          ...base, state: 'staging', cancelReserved: !!staging.cancelRequested,
          roomId: staging.id, dungeonId: staging.dungeonId, level: staging.level,
          stagingSlotsFilled: seatsTaken(staging),
        };
      }
      // Not in any non-canceled room: ready if deployable, else undeployable.
      let deployable = (canvas?.bps?.length ?? 0) > 0;
      if (engine && state) {
        try { deployable = engine.isSquadDeployable(state as never, index); } catch { /* engine not ready */ }
      }
      return { ...base, state: deployable ? 'ready' : 'undeployable' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, state, engine, rooms]);
}
