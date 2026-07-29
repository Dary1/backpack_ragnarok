// client/src/sortie/useSquadConflicts.ts -- REQ-0239 (design 01 sec 6.3): the
// squad conflict + deployment derivation the sortie shelf/slots consume. Truth
// source = the client store's OWN preset canvases (mirroring the server
// squadUidSet): a squad's uid set = all bps[].id + pos[].uid + sis[].uid; two
// squads CONFLICT iff their uid sets intersect. Deployment state is read from
// the caller's rooms (+ the B1 lastRun window for the "frees at" time).
import { useMemo } from 'react';
import type { ApiRoom } from '../api';
import { roomHoldsOwnSquad } from '../schedule/seats'; // REQ-0337
import { useGameStore } from '../store';
import {
  sharedUids,
  squadCanvasOf,
  squadUidSet,
  uidSetsIntersect,
  type GameStateLike,
  type SquadCanvas,
} from './squadCanvas';

export interface SquadDeployment {
  roomId: string;
  dungeonId: string;
  level: number;
  /** 'active' = out on an expedition; 'cooldown' = recovering before redeploy. */
  kind: 'active' | 'cooldown';
  /** ISO time the squad frees up (run end for active, cooldownUntil for cooldown). */
  freesAtIso: string | null;
}

export interface SquadInfo {
  index: number;
  name: string;
  canvas: SquadCanvas | null;
  uidSet: Set<string>;
  deployable: boolean;
  bpCount: number;
  chargeCount: number;
  unitIds: string[];
  deployment: SquadDeployment | null;
  /** total uids this squad shares with ANY other squad (passive link badge). */
  sharedBadgeCount: number;
}

export interface SquadConflicts {
  squads: SquadInfo[];
  /** shared units (BP names) + shared-uid count between two squad indices. */
  sharedBetween(i: number, j: number): { unitNames: string[]; count: number };
}

// The room a squad is "in", by precedence: an ACTIVE run wins over an
// open/cooldown room (design 02 sec 3 precedence). Canceled rooms are ignored.
function deploymentFor(index: number, rooms: ApiRoom[] | null): SquadDeployment | null {
  if (!rooms) return null;
  let active: SquadDeployment | null = null;
  let cooldown: SquadDeployment | null = null;
  for (const room of rooms) {
    if (room.status === 'canceled') continue;
    // REQ-0337: was `room.slots.some((s) => s.squadIndex === index)`, which both
    // THREW on a co-op Troop's null free seats and matched OTHER seat owners'
    // squad indices as this player's. roomHoldsOwnSquad is null-safe and
    // owner-scoped. A Troop that is still recruiting is deliberately NOT a
    // deployment: its seats are held (the server's deploy gate does count them),
    // but it falls through both branches below since its status is 'recruiting'
    // -- neither 'active' nor 'open' -- so it reports no run window, which is
    // honest: no run has started.
    if (!roomHoldsOwnSquad(room, index)) continue;
    if (room.status === 'active') {
      const lr = room.lastRun;
      const freesAtIso = lr && lr.startedAt
        ? new Date(Date.parse(lr.startedAt) + (lr.durationSecs || 0) * 1000).toISOString()
        : null;
      active = { roomId: room.id, dungeonId: room.dungeonId, level: room.level, kind: 'active', freesAtIso };
    } else if (room.status === 'open' && room.cooldownUntil && Date.parse(room.cooldownUntil) > Date.now()) {
      cooldown = { roomId: room.id, dungeonId: room.dungeonId, level: room.level, kind: 'cooldown', freesAtIso: room.cooldownUntil };
    }
  }
  return active || cooldown;
}

export function useSquadConflicts(rooms: ApiRoom[] | null): SquadConflicts {
  const snapshot = useGameStore();
  const state = (snapshot.state as GameStateLike | null) ?? null;
  const engine = snapshot.engine;
  const presets = state?.presets ?? null;

  return useMemo<SquadConflicts>(() => {
    const names = presets?.names ?? [];
    const canvases: (SquadCanvas | null)[] = names.map((_, i) => squadCanvasOf(state, i));
    const uidSets = canvases.map((c) => squadUidSet(c));

    const squads: SquadInfo[] = names.map((name, i) => {
      const canvas = canvases[i];
      const uidSet = uidSets[i];
      const bps = canvas?.bps ?? [];
      const unitIds = bps.map((b) => b.unit?.id).filter((x): x is string => typeof x === 'string');
      // passive link badge: total uids shared with any OTHER squad.
      const sharedAll = new Set<string>();
      for (let j = 0; j < uidSets.length; j++) {
        if (j === i) continue;
        for (const u of sharedUids(uidSet, uidSets[j])) sharedAll.add(u);
      }
      let deployable = bps.length > 0;
      if (engine && state) {
        try { deployable = engine.isSquadDeployable(state as never, i); } catch { /* engine not ready */ }
      }
      return {
        index: i,
        name,
        canvas,
        uidSet,
        deployable,
        bpCount: bps.length,
        chargeCount: bps.filter((b) => !!b.unit).length,
        unitIds,
        deployment: deploymentFor(i, rooms),
        sharedBadgeCount: sharedAll.size,
      };
    });

    function sharedBetween(i: number, j: number): { unitNames: string[]; count: number } {
      if (i === j) return { unitNames: [], count: 0 };
      const shared = sharedUids(uidSets[i] ?? new Set(), uidSets[j] ?? new Set());
      // Resolve shared uids to the SHARED UNIT names: a shared unit shows up as
      // a shared BP id in both canvases (BP.id is the stable unit-instance key).
      // (No client-side item-name map exists, so POs/SIs shared without their BP
      // fall back to the raw shared-uid count -- documented deviation.)
      const names = new Set<string>();
      const bpsI = canvases[i]?.bps ?? [];
      for (const bp of bpsI) if (shared.includes(bp.id)) names.add(bp.name ?? bp.id);
      return { unitNames: [...names], count: shared.length };
    }

    return { squads, sharedBetween };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, state, engine, rooms]);
}

/** Whether two squad indices conflict (share >=1 uid). Convenience over the hook. */
export function squadsConflict(a: SquadInfo | undefined, b: SquadInfo | undefined): boolean {
  if (!a || !b) return false;
  return uidSetsIntersect(a.uidSet, b.uidSet);
}
