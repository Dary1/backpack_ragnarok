// shared/placement.d.mts -- REQ-0310: the typed surface of shared/placement.mjs.
//
// Hand-written because shared/ is plain JS by the same invariant that keeps
// shared/engine.js hand-written (see shared/engine.d.ts): one source, consumed
// unforked by both the client (TS/Vite) and node. The client resolves
// `../../shared/placement.mjs` to THIS file (moduleResolution: bundler maps
// .mjs -> .d.mts); node ignores it entirely. Same precedent shared/forecast.mjs
// + forecast.d.mts set before REQ-0308 retired that pair.
//
// Rules (shared/README.md): shared/ may not import from client/, server/, sim/
// or mock-src/ -- so the rolled-BP payload is declared STRUCTURALLY below
// rather than imported from client/src/api. The client's own ApiRolledBp is
// assignable to it; that assignability is what keeps the two in step.
import type { EngineInstance, GameState, Cell, Offset } from './engine.d.ts';

export const GRID_MIN: number;
export const GRID_MAX: number;

export interface PlacementResult {
  page: number;
  cell: Cell;
}

export interface BpPlacementResult {
  page: number;
  origin: Cell;
}

/** The subset of a rolled/bought BP payload firstFitPlaceBp actually reads.
 * Declared structurally so shared/ need not reach into client/src/api --
 * client's ApiRolledBp (and useWarehouseData's reconstruction of one from a
 * warehouse row's `bp` payload) satisfy it. */
export interface RolledBpLike {
  uid: string;
  shape: Offset[];
  unit: { id: string; off: Offset };
  hpMax: number;
  /** REQ-0170: the BP takes its display name from the Unit def it carries. */
  unitDef?: { name: string } | null;
}

/** The shared "open page first, then every other page ascending" walk. */
export function pageOrderFrom(openPage: number, pageCount: number): number[];

export function firstFitOrMergeTM(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  qty: number,
  openPage: number,
  pageCount: number
): PlacementResult | null;

export function firstFitPlace(
  engine: EngineInstance,
  state: GameState,
  kind: 'po' | 'si',
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): PlacementResult | null;

export function firstFitPlaceBp(
  engine: EngineInstance,
  state: GameState,
  rolled: RolledBpLike,
  openPage: number,
  pageCount: number
): BpPlacementResult | null;
