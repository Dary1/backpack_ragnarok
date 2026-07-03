// Typed surface for mock-src/engine.js — REQ-0026 T0.1, extended REQ-0027 T0.2,
// extended REQ-0030 Phase 2 (inventory model).
//
// This is NOT a full re-typing of the engine; it covers the queries T0.1's
// read-only board calls plus the mutator surface T0.2's drag/drop, rotate,
// BP move, and SI seat/unseat interactions call, plus REQ-0030 Phase 2's
// inventory-page mutators/queries and the canvas<->page BP transfer API.
// The engine itself is consumed as-is (see adapter.ts) — these types
// describe its existing behavior, they do not change it.
//
// REQ-0027 T0.2 verification note: re-read mock-src/engine.js fresh against
// every mutator declaration below. Found and fixed one drift: movePO,
// moveBP, and moveAssembly's failure path returns whatever the internal
// canPlaceCells()/canMoveBP()/canPlaceAssembly() check produced (a
// PlacementCheck-shaped object carrying `cells` and often `bp`), not just
// `{ok,why?}` — the previous declarations dropped `cells`/`bp` on failure,
// which the drag-drop layer's reject-flash rendering needs. All other
// mutators' declared shapes already matched engine.js exactly (rotatePO,
// canMoveBP, canPlaceAssembly, hostOk, seatSI, stowSI, unseatOrphans).
//
// REQ-0030 Phase 2 verification note: every inv* declaration below was
// checked line-for-line against mock-src/engine.js's "Inventory model"
// section (added Phase 1). Container shape ({bps,pos,sis}) mirrors
// GameState's own {bps,pos,sis} fields exactly (byte-identical field
// names), per the engine's own design note ("mirrors the top-level
// st.{bps,pos,sis} arrays field-for-field").

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

/** SI host, canvas semantics: 'inv' (unseated/legacy list-stow), 'bond'
 * (blade+hilt assembly's bond socket), or a per-PO socket ref. */
export type SIHost = 'inv' | 'bond' | { po: string; si: number };

/** SI host, INVENTORY PAGE semantics (REQ-0030 Phase 2): a free-placed SI
 * within a page carries a {page,cell} host object (distinct from the
 * canvas 'bond' shape and from the legacy 'inv' string sentinel); a
 * page-stowed-but-unseated SI (invStowSI) uses the SAME 'inv' string
 * sentinel as canvas/legacy (see engine.js invStowSI comment: "distinct
 * from a free-placed {page,cell} host" -- i.e. 'inv' itself is shared
 * vocabulary, only the object shape is page-specific). A per-PO seated
 * host inside a page is `{po,si}`, same shape as canvas (uid-keyed, so it
 * never needs rewriting on a BP transfer).
 */
export type InvSIHost = 'inv' | { page: number; cell: Cell } | { po: string; si: number };

export interface SI {
  uid: string;
  id: string; // SIDef key
  host: SIHost;
}

/** One inventory page: mirrors the top-level GameState's {bps,pos,sis}
 * shape field-for-field (REQ-0030 Phase 1 design). PO/SI records inside a
 * page use the SAME record shapes as canvas (PO.loc/cell, SI.uid/id) --
 * only SI.host may additionally take the page-local free-placement shape
 * ({page,cell}), see InvSIHost above. */
export interface InvPage {
  bps: BP[];
  pos: PO[];
  sis: SI[];
}

export interface Inventory {
  pages: InvPage[]; // length PAGE_COUNT (5)
  names?: string[]; // display names, one per page, defaults to "1".."5" (REQ-0031 Phase B); absent on a pre-REQ-0031 saved state
}

export interface GameState {
  linked: boolean;
  bps: BP[];
  pos: PO[];
  sis: SI[];
  inv?: Inventory; // absent on a legacy (pre-REQ-0030) saved state; run migrateState() before use
  presets?: Presets; // absent on a legacy (pre-REQ-0031) saved state; run migrateState() before use
}

/** One preset's canvas snapshot -- same shape as GameState's own top-level
 * canvas fields (REQ-0031 Phase B). Used for every INACTIVE preset's
 * entry in Presets.store; the ACTIVE preset's content lives directly on
 * GameState.{linked,bps,pos,sis} instead (never duplicated into store). */
export interface PresetSlot {
  linked: boolean;
  bps: BP[];
  pos: PO[];
  sis: SI[];
}

/** st.presets (REQ-0031 Phase B): active preset index, display names (one
 * per preset, grows by 1 with every addPreset()), and store (one slot per
 * preset -- store[active] is ALWAYS null, since that preset's content
 * lives at the top-level GameState fields instead). */
export interface Presets {
  active: number;
  names: string[];
  store: Array<PresetSlot | null>;
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

/** Location descriptor for a BP transfer (REQ-0030 Phase 2): identifies
 * WHICH container (canvas, or a specific 0-based inventory page) a BP
 * transfer's source/target is. Mirrors engine.js's canTransferBP/
 * transferBP `from`/`to` argument shape exactly. */
export type LocRef = { loc: 'canvas' } | { loc: 'inv'; page: number };

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
  movePO: (st: GameState, uid: string, anchor: Cell | 'inv') => { ok: boolean; why?: string; cells?: Cell[]; bp?: string };
  rotatePO: (st: GameState, uid: string) => { ok: boolean; why?: string; cells?: Cell[] };
  canMoveBP: (st: GameState, bpId: string, origin: Cell) => PlacementCheck;
  moveBP: (st: GameState, bpId: string, origin: Cell) => { ok: boolean; why?: string; cells?: Cell[] };
  poInBP: (st: GameState, p: PO, bp: BP) => boolean;

  assembly: (st: GameState) => Assembly | null;
  canPlaceAssembly: (st: GameState, anchor: Cell) => PlacementCheck;
  moveAssembly: (st: GameState, anchor: Cell | 'inv') => { ok: boolean; why?: string; cells?: Cell[]; bp?: string };

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

  // -----------------------------------------------------------------------
  // Inventory model (REQ-0030 Phase 1 engine / Phase 2 client consumer).
  // Page index `pg` is always 0-based (0..PAGE_COUNT-1), matching
  // engine.js's `page(st,n)` -- NOT the 1-based tab label shown in the UI.
  // -----------------------------------------------------------------------

  /** Number of inventory pages (5). */
  PAGE_COUNT: number;

  /** Fresh, empty {pages:[PAGE_COUNT x {bps:[],pos:[],sis:[]}]}. Used for
   * client-side migration fallback (a state with no st.inv at all) and
   * anywhere else a correctly-shaped empty inventory is needed without
   * hand-rolling the page array shape. */
  emptyInventory: () => Inventory;

  /** Pure legality check for placing/moving PO `uid` (already present in
   * page `pg`'s pos[]) at rotation `rot`, anchored at `anchor`. Free
   * placement (no BP) is legal; landing on a BP requires full containment
   * (same law as canvas, just not mandatory the way canvas is). */
  invCanPlacePO: (st: GameState, pg: number, uid: string, rot: number, anchor: Cell) => PlacementCheck;
  /** Mutates: moves PO `uid` within page `pg` to `anchor`. No 'inv' sentinel
   * variant here (a page IS already an inventory container) -- always a
   * concrete cell. */
  invMovePO: (st: GameState, pg: number, uid: string, anchor: Cell) => { ok: boolean; why?: string; cells?: Cell[]; bp?: string };
  /** dblclick-CW rotate equivalent inside a page (mirrors rotatePO). */
  invRotatePO: (st: GameState, pg: number, uid: string) => { ok: boolean; why?: string; cells?: Cell[]; bp?: string };

  /** Free-placed SI legality within a page -- ALWAYS a single [row,col]
   * cell (1x1 footprint regardless of the SI's own def), and MAY NOT land
   * on any BP cell (a bare SI cannot sit on top of BP infrastructure --
   * resolved ambiguity, see REQ-0030 report). `exclUids` defaults to
   * `[uid]` when omitted (matches engine.js's own default). */
  invCanPlaceSI: (st: GameState, pg: number, uid: string, anchor: Cell, exclUids?: string[]) => PlacementCheck;
  /** Mutates: relocates a free-placed SI within page `pg` to `anchor`
   * (sets its host to `{page:pg,cell:anchor}`). */
  invMoveSI: (st: GameState, pg: number, uid: string, anchor: Cell) => { ok: boolean; why?: string; cells?: Cell[] };

  /** Every open/filled socket of every PO placed in page `pg` (free-placed
   * or on an inventory BP alike) -- same shape as sockets(st), but NEVER
   * emits a 'bond' pseudo-socket (no assembly concept inside a page). */
  pageSockets: (st: GameState, pg: number) => Socket[];
  /** Seats SI `siUid` (must already be IN this page's sis[]) onto socket
   * `skey` (from pageSockets). Works whether the target PO is free-placed
   * or sitting on an inventory BP -- no distinction needed. */
  invSeatSI: (st: GameState, pg: number, siUid: string, skey: string) => { ok: boolean; why?: string };
  /** Unseats SI `siUid` within page `pg` -- sets host to the 'inv' string
   * sentinel (page-local stow, distinct from a free-placed {page,cell}
   * host; the SI keeps no on-grid footprint until moved via invMoveSI). */
  invStowSI: (st: GameState, pg: number, siUid: string) => { ok: boolean; why?: string };

  /** Legality for placing/moving an entire BP within page `pg`: bounds,
   * no overlap with another BP in the page, AND (page-specific) no
   * overlap with any free-placed PO/SI already in the page. `exclUids`
   * should list the BP's own traveling contents' uids when checking a
   * same-page reposition (see invMoveBP). */
  invCanPlaceBP: (st: GameState, pg: number, bpId: string, origin: Cell, exclUids?: string[]) => PlacementCheck;
  /** Mutates: relocates BP `bpId` WITHIN its own page `pg` (no cross-
   * container transfer -- see canTransferBP/transferBP for that). Contents
   * (POs fully inside the BP) shift by the same dr/dc, same as moveBP. */
  invMoveBP: (st: GameState, pg: number, bpId: string, origin: Cell) => { ok: boolean; why?: string; cells?: Cell[] };
  /** True if PO `p` (already page-local) is fully contained within BP
   * `bp`'s footprint (both from the SAME page's arrays). Container-
   * independent shape math, callable with any {bps,pos,sis}-shaped page. */
  poInBPIn: (p: PO, bp: BP) => boolean;
  /** Absolute [row,col] cells of PO `p`, page-container-independent (same
   * math as cellsOf, just not requiring the full GameState). */
  cellsOfIn: (p: PO) => Cell[];
  /** cell -> BP id map for an explicit {bps,...} container (canvas OR one
   * page) -- container-parameterized equivalent of cellBPMap. */
  cellBPMapIn: (container: { bps: BP[] }) => Record<string, string>;
  /** Occupancy map (PO footprints AND free-placed 1x1 SIs) for an explicit
   * {pos,sis} container -- container-parameterized equivalent of
   * occupancy(), extended to also block free-placed SI cells. */
  invOccupancy: (container: { pos: PO[]; sis?: SI[] }, exclUids?: string[]) => Record<string, string>;

  /** Pure (no mutation) legality check for transferring BP `bpId` from
   * container `from` to container `to`, landing at `origin` within `to`.
   * A canvas target enforces canvas's simpler rule (bounds + no BP
   * overlap; POs on canvas always belong to a BP already, so there is no
   * free-placed-item overlap concept there). A page target additionally
   * checks free-placed PO/SI overlap, excluding the BP's own traveling
   * contents. */
  canTransferBP: (st: GameState, from: LocRef, to: LocRef, bpId: string, origin: Cell) => PlacementCheck;
  /** Mutates. Fails CLEANLY (state fully untouched) when illegal --
   * legality is always checked first via canTransferBP internally, so a
   * rejected transfer never partially moves contents. On success, splices
   * the BP + every PO fully inside it + those POs' seated SIs out of
   * `from`'s arrays and into `to`'s arrays, shifting moved POs' cell by
   * the BP's new-origin-minus-old-origin delta. If `to.loc==='canvas'`,
   * also runs unseatOrphans (a transferred blade/hilt pair might now
   * (dis)qualify for the 'bond' assembly seat). */
  transferBP: (st: GameState, from: LocRef, to: LocRef, bpId: string, origin: Cell) => { ok: boolean; why?: string; cells?: Cell[] };

  /** Accepts a LEGACY-shaped state (no st.inv, and/or legacy loc:'inv'/
   * host:'inv' list-inventory entries) and returns a NEW state object
   * (does NOT mutate the input) with a populated st.inv: legacy unplaced
   * POs first-fit-placed (POs first, then SIs, per REQ-0030 orchestrator
   * default), starting on page 1 (index 0) and overflowing onto
   * subsequent pages if page 1 fills. Un-fittable leftovers (all 5 pages
   * full) remain in their original legacy loc:'inv'/host:'inv' form --
   * never silently dropped. ALSO (REQ-0031 Phase B) materializes st.inv.names
   * (defaults "1".."5") and st.presets (5 presets, slot 0 = whatever this
   * state's own top-level canvas already is, slots 1-4 empty) if either is
   * missing -- "migrateState handles pre-preset saves". Safe/idempotent to
   * call on an ALREADY-migrated state (no legacy entries left to migrate,
   * st.inv.names/st.presets already present -- a no-op copy). */
  migrateState: (oldState: GameState) => GameState;

  // -----------------------------------------------------------------------
  // Preset model (REQ-0031 Phase B). st.{linked,bps,pos,sis} remains THE
  // ACTIVE preset's canvas -- every function above this section keeps
  // reading/writing those same top-level fields, unaware presets exist.
  // -----------------------------------------------------------------------

  /** Number of presets a freshly-made state carries (5). Distinct from
   * st.presets.store.length, which GROWS with addPreset() -- PRESET_COUNT
   * is only the initial/default count. */
  PRESET_COUNT: number;

  /** Fresh {active:0,names:[...],store:[...]} for `count` presets: slot 0
   * has store[0]=null (its content is supplied separately, at the
   * top-level GameState fields), every other slot holds an empty preset
   * snapshot (emptyPresetSlot()). */
  makePresetsMeta: (count: number) => Presets;

  /** A fresh, EMPTY preset snapshot: {linked:true,bps:[],pos:[],sis:[]}.
   * Used internally by makePresetsMeta/addPreset; exposed for callers that
   * need a correctly-shaped empty preset without hand-rolling it. */
  emptyPresetSlot: () => PresetSlot;

  /** Atomically swaps the ACTIVE preset's top-level canvas fields
   * (st.linked/bps/pos/sis) with st.presets.store[n]'s snapshot; sets
   * st.presets.active=n. Both the outgoing and incoming configurations
   * are fully preserved (the outgoing canvas is written into
   * store[oldActive], never discarded). No-op (still {ok:true}) if `n` is
   * already the active preset. Runs unseatOrphans() on the newly-active
   * canvas afterward (mirrors movePO/transferBP's own post-mutation
   * cleanup). Rejects out-of-range `n`. */
  switchPreset: (st: GameState, n: number) => { ok: boolean; why?: string };

  /** Appends a brand-new EMPTY preset (never copies any content/uid) to
   * st.presets.store, and a matching entry to st.presets.names (defaults
   * to "Preset N", 1-based). Returns the new preset's 0-based index. */
  addPreset: (st: GameState, name?: string) => { ok: boolean; why?: string; index?: number };

  /** Sets preset `n`'s (0-based) display name -- works identically whether
   * `n` is the currently-active preset or an inactive stored one. */
  renamePreset: (st: GameState, n: number, name: string) => { ok: boolean; why?: string };

  /** Sets inventory page `n`'s (0-based) display name on st.inv.names.
   * Materializes st.inv.names defensively (to the PAGE_COUNT-long default)
   * if it was missing/short before applying the one requested change. */
  renameInvPage: (st: GameState, n: number, name: string) => { ok: boolean; why?: string };

  /** The live st.inv.names array, defaulting to "1".."5" for any state
   * built without one (pure read helper -- never mutates st.inv). */
  invPageNames: (st: GameState) => string[];

  /** Read-only auditor for the "one uid, exactly one place" physicality
   * rule: scans every PO/SI uid across the shared inventory
   * (st.inv.pages[]), the ACTIVE preset's canvas (st.pos/st.sis), and
   * every INACTIVE preset's stored snapshot (st.presets.store[i], i!==
   * active). Returns {ok:true,duplicates:[]} if every uid appears exactly
   * once, else {ok:false,why,duplicates:[uid,...]} naming every uid found
   * 2+ times. Does not check for missing uids, only duplication. */
  checkUidInvariant: (st: GameState) => { ok: boolean; why?: string; duplicates: string[] };
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
