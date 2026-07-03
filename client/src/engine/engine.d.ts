// Typed surface for mock-src/engine.js — REQ-0026 T0.1.
//
// This is NOT a full re-typing of the engine; it covers only the queries
// T0.1's read-only board actually calls (grid/BP/PO layout, sockets, beams,
// connection ports). The engine itself is consumed as-is (see adapter.ts) —
// these types describe its existing behavior, they do not change it.
// Extend as later T-phases (drag-drop, linker editing, save) need more of
// the surface engine.js already exports (movePO, seatSI, combos, etc).

/** [row, col] grid cell, 1-based per engine.js convention. */
export type Cell = [number, number];

/** [dr, dc] offset pair (unrotated shape offsets, port tile offsets, etc). */
export type Offset = [number, number];

export interface Layout {
  ROWS: number;
  COLS: number;
}

/** Parent-map tree: tag -> parent tag, or null/absent for a root. */
export type TagTree = Record<string, string | null>;

export interface Trees {
  po: TagTree;
  socket: TagTree;
}

export interface SocketDef {
  t: string; // socket type, e.g. "gem" | "edge" | "coat" | "bond"
  tags: string[];
  ax?: number; // anchor x, fraction of unrotated bbox width (0..1)
  ay?: number; // anchor y, fraction of unrotated bbox height (0..1)
}

export interface PortDef {
  tiles: Offset[];
  tag: string;
}

export interface ItemDef {
  name: string;
  name_ja?: string;
  tags: string[];
  rarity: string;
  shape: Offset[];
  icon: string;
  sockets?: SocketDef[];
  eff?: string;
  eff_en?: string;
  eff_ja?: string;
  flavor?: string;
  flavor_ja?: string;
  stretch?: boolean;
  ports?: PortDef[];
}

export interface SIDef {
  name: string;
  name_ja?: string;
  slot: string;
  reqTags: string[];
  icon: string;
  rarity: string;
  eff?: string;
  eff_en?: string;
  eff_ja?: string;
  flavor?: string;
  flavor_ja?: string;
  ports?: PortDef[];
}

export type ItemDefMap = Record<string, ItemDef>;
export type SIDefMap = Record<string, SIDef>;

export interface BPLinker {
  off: Offset;
  dirs: number[]; // 0..7, see engine.js DIRS
}

export interface BP {
  id: string;
  name: string;
  color: string;
  shape: Offset[];
  origin: Cell;
  linker: BPLinker;
}

export type POLoc = 'grid' | 'inv';

export interface PO {
  uid: string;
  id: string; // ItemDef key
  loc: POLoc;
  cell: Cell | null;
  rot: number; // 0..3
}

export type SIHost = 'inv' | 'bond' | { po: string; si: number };

export interface SI {
  uid: string;
  id: string; // SIDef key
  host: SIHost;
}

export interface GameState {
  linked: boolean;
  bps: BP[];
  pos: PO[];
  sis: SI[];
}

export interface ShapeInfo {
  off: Offset[];
  h: number;
  w: number;
}

export interface PlacementCheck {
  ok: boolean;
  cells: Cell[];
  why?: string;
  bp?: string;
}

export interface Socket {
  skey: string;
  host: string; // PO uid, or 'bond'
  si: number;
  t: string;
  tags: string[];
  siUid: string | null;
  ax?: number;
  ay?: number;
}

export interface PortTarget {
  tag: string;
  tiles: Cell[]; // absolute canvas coords, rotated+translated
}

export interface Connection {
  tag: string;
  tile: Cell;
  partner: PO;
}

export interface AllConnection {
  from: PO;
  to: PO;
  tag: string;
  tile: Cell;
}

export interface Assembly {
  blade: PO;
  hilt: PO;
  bp: string;
  cells: Cell[];
  anchor: Cell;
}

export interface Beam {
  from: string; // BP id
  dir: number; // 0..7
  path: Cell[];
  to: string | null; // BP id, or null if it flies off canvas
  mutual: boolean;
}

export interface Combo {
  name: string;
  cells: Cell[];
  desc: string;
  pairs?: Cell[];
}

/** Return type of Engine.create(...) — the per-content engine instance. */
export interface EngineInstance {
  key: (r: number, c: number) => string;
  DIRS: Record<number, Offset>;

  rotOffsets: (base: Offset[], k: number) => Offset[];
  shapeInfo: (id: string, rot: number) => ShapeInfo;
  bpCells: (bp: BP) => Cell[];
  linkerCell: (bp: BP) => Cell;
  cellBPMap: (st: GameState) => Record<string, string>;
  linkerMap: (st: GameState) => Record<string, string>;
  cellsOf: (st: GameState, p: PO) => Cell[];
  occupancy: (st: GameState, excl?: string[]) => Record<string, string>;

  canPlacePO: (st: GameState, uid: string, rot: number, anchor: Cell) => PlacementCheck;
  movePO: (st: GameState, uid: string, anchor: Cell | 'inv') => { ok: boolean; why?: string };
  rotatePO: (st: GameState, uid: string) => { ok: boolean; why?: string; cells?: Cell[] };
  canMoveBP: (st: GameState, bpId: string, origin: Cell) => PlacementCheck;
  moveBP: (st: GameState, bpId: string, origin: Cell) => { ok: boolean; why?: string };
  poInBP: (st: GameState, p: PO, bp: BP) => boolean;

  assembly: (st: GameState) => Assembly | null;
  canPlaceAssembly: (st: GameState, anchor: Cell) => PlacementCheck;
  moveAssembly: (st: GameState, anchor: Cell | 'inv') => { ok: boolean; why?: string };

  sockets: (st: GameState) => Socket[];
  hostOk: (st: GameState, siUid: string, sock: Socket) => { ok: boolean; why?: string };
  seatSI: (st: GameState, siUid: string, skey: string) => { ok: boolean; why?: string };
  stowSI: (st: GameState, siUid: string) => { ok: boolean };
  unseatOrphans: (st: GameState) => void;

  combos: (st: GameState) => Combo[];
  traceBeams: (st: GameState) => Beam[];

  connTargets: (st: GameState, p: PO) => Cell[];
  portTargets: (st: GameState, p: PO) => PortTarget[];
  connectionsFrom: (st: GameState, p: PO) => Connection[];
  allConnections: (st: GameState) => AllConnection[];
  contactPairs: (A: Cell[], B: Cell[]) => Array<[Cell, Cell]>;
}

export interface EngineModule {
  create: (
    items: ItemDefMap,
    siDefs: SIDefMap,
    layout: Layout,
    trees?: Trees
  ) => EngineInstance;
  rotOffsets: (base: Offset[], k: number) => Offset[];
  hasTag: (tagList: string[] | undefined, targetTag: string, tree?: TagTree) => boolean;
  ancestorsOf: (tree: TagTree | undefined, tag: string) => string[];
  tagsRelated: (tree: TagTree | undefined, tagA: string, tagB: string) => boolean;
}
