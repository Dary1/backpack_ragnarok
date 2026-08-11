// client/src/sortie/squadCanvas.ts -- REQ-0239: pure squad-canvas helpers
// shared by the sortie page (SquadMiniCard, useSquadConflicts) AND the squad
// status board (useSquadDeployment). Mirrors the SERVER's own squad primitives
// (server/services/squads.cjs squadCanvasOf/squadUidSet) so the client-side
// conflict gate can never disagree with the server's deploy gate on which
// squads share a unit. Pure data reads -- no engine call, no Pixi.

/** A squad's canvas: BPs + POs + SIs, exactly the {bps,pos,sis} shape the
 * engine keeps at the top level (active squad) or in presets.store[i]. Fields
 * are optional/defensive so a half-built or empty squad never throws. */
export interface SquadBP {
  id: string;
  name?: string;
  color?: string;
  shape?: [number, number][];
  origin?: [number, number];
  unit?: { id: string; off?: unknown } | null;
  /** REQ-0371: BP max HP (absent on a legacy record -> the sim's 100). */
  hpMax?: number;
}
export interface SquadPO { uid: string; id?: string; loc?: string; cell?: [number, number] | null }
export interface SquadSI { uid: string; id?: string; host?: unknown } // REQ-0371: id/host read by lib/buildPower.ts
export interface SquadCanvas { bps?: SquadBP[]; pos?: SquadPO[]; sis?: SquadSI[] }
export interface PresetsLike { active: number; names: string[]; store: (SquadCanvas | null)[] }
export interface GameStateLike { bps?: SquadBP[]; pos?: SquadPO[]; sis?: SquadSI[]; presets?: PresetsLike }

/** The canvas for squad index `idx`: the ACTIVE index reads the live top-level
 * canvas (where edits land); any other index reads that squad's presets.store[]
 * snapshot. The same two-line lookup the engine's own squadCanvasOf uses.
 * Returns null when idx is out of range. */
export function squadCanvasOf(state: GameStateLike | null | undefined, idx: number): SquadCanvas | null {
  if (!state || !state.presets) return null;
  if (idx === state.presets.active) return { bps: state.bps, pos: state.pos, sis: state.sis };
  return state.presets.store?.[idx] ?? null;
}

/** A squad's uid set = every bps[].id + pos[].uid + sis[].uid. Two squads
 * CONFLICT iff their uid sets intersect (server squadUidSet parity). */
export function squadUidSet(canvas: SquadCanvas | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!canvas) return out;
  for (const bp of canvas.bps ?? []) if (bp && bp.id) out.add(bp.id);
  for (const po of canvas.pos ?? []) if (po && po.uid) out.add(po.uid);
  for (const si of canvas.sis ?? []) if (si && si.uid) out.add(si.uid);
  return out;
}

/** A BP's occupied cells: its shape offsets PLUS its own origin (mirrors
 * sim/combat.cjs's localBpCells and Monitor.tsx's derivation -- never
 * re-normalized to (0,0)). */
export function bpCells(bp: SquadBP): [number, number][] {
  const [or, oc] = bp.origin ?? [0, 0];
  return (bp.shape ?? []).map(([dr, dc]) => [or + dr, oc + dc] as [number, number]);
}

/** Do two uid sets intersect? */
export function uidSetsIntersect(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const u of small) if (large.has(u)) return true;
  return false;
}

/** The shared uids between two squads. */
export function sharedUids(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const u of small) if (large.has(u)) out.push(u);
  return out;
}
