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

/** REQ-0170 / REQ-0128b: one entry of content/vocab.json's `connection_shapes`
 * table -- the ratified geometry of a Unit's links. Ray shapes carry {dirs,
 * range, pierce}; offset shapes carry {offsets} and MUST NOT carry range/pierce
 * (they have no ray to walk). `range: 0 | null` = unlimited. */
export interface ConnShapeDef {
  kind: 'ray' | 'offset' | 'none';
  ja?: string;
  dirs?: number[];
  range?: number | null;
  pierce?: boolean;
  offsets?: Offset[];
  note?: string;
}
export type ConnShapeMap = Record<string, ConnShapeDef>;

/** REQ-0170: one `unit/1` def (content/live/live_units.json). `charge` and
 * `effects` are ABSENT ON PURPOSE -- the grammar is frozen (vocab v13) but the
 * engine has no charge AST, and writing fields nothing evaluates would be
 * writing fiction into a live target. `icon` is a FREE reference to an artwork
 * system_name (two defs may share one artwork -- REQ-0149 G14), never derived
 * from `id`. */
export interface UnitDef {
  name: string;
  rarity: string;
  icon: string;
  connection_shape: string;
  flavor?: string;
  name_ja?: string;
  flavor_ja?: string;
  i18n?: { ja?: { name?: string; flavor?: string } };
}
export type UnitDefMap = Record<string, UnitDef>;

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

export interface IconAlign {
  /** vertical anchor of the icon within its footprint box; default 'middle' (centered). */
  v?: 'top' | 'middle' | 'bottom';
  /** horizontal anchor of the icon within its footprint box; default 'center'. */
  h?: 'left' | 'center' | 'right';
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
  /** REQ-0102: directional icon alignment within the placeable area; default middle/center. */
  align?: IconAlign;
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

/** REQ-0170: the Unit a BP carries. A BP and a Unit are 1:1 (glossary: "every BP
 * carries exactly one Unit; a BP with no Unit cannot exist"), so this field is
 * REQUIRED. `id` keys content/live/live_units.json; the Unit's rays come from its
 * def's connection_shape, NOT from the BP -- the retired `linker.dirs` array is
 * gone and is not replaced. `off` is the Unit's seat within the BP's own shape. */
export interface BPUnit {
  id: string;
  off: Offset;
}

export interface BP {
  id: string;
  name: string;
  color: string;
  shape: Offset[];
  origin: Cell;
  unit: BPUnit;
  /** REQ-0036 P1-A: BP max HP (Backpack-as-HP). Optional here since this
   * type predates that field and not every synthetic/test BP literal in
   * this codebase sets it -- mirrors the engine's own tolerant read
   * surface (bpHpMax() defaults when absent). REQ-0042's gacha roll is
   * the first CLIENT code path to always set it on a freshly-minted BP. */
  hpMax?: number;
}

export type POLoc = 'grid' | 'inv';

export interface PO {
  uid: string;
  id: string; // ItemDef key
  loc: POLoc;
  cell: Cell | null;
  rot: number; // 0..3
  fixed?: boolean; // REQ-0051 starter units: a pinned, immovable PO reference (starter-unit kit). Engine movePO/rotatePO/invMovePO/invRotatePO refuse it; the containing BP is still discardable wholesale.
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
/** TM (Transmutator) stack record -- REQ-0042. Page-scoped, stackable,
 * always 1x1, never a canvas record (see mock-src/engine.js's TM model
 * comment for why it structurally cannot reach canvas). */
export interface TM {
  uid: string;
  id: string;
  qty: number;
  cell: Cell;
}

export interface InvPage {
  bps: BP[];
  pos: PO[];
  sis: SI[];
  tms: TM[]; // REQ-0042 -- absent on a pre-REQ-0042 saved state (migrateState backfills it)
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
  presets?: Squads; // legacy serialized field name (REQ-0124 ledger) -- type renamed, wire name kept // absent on a legacy (pre-REQ-0031) saved state; run migrateState() before use
}

/** One squad's canvas snapshot -- same shape as GameState's own top-level
 * canvas fields (REQ-0031 Phase B). Used for every INACTIVE squad's
 * entry in Squads.store; the ACTIVE squad's content lives directly on
 * GameState.{linked,bps,pos,sis} instead (never duplicated into store). */
export interface SquadSlot {
  linked: boolean;
  bps: BP[];
  pos: PO[];
  sis: SI[];
}

/** st.presets (REQ-0031 Phase B): active squad index, display names (one
 * per squad, grows by 1 with every addSquad()), and store (one slot per
 * squad -- store[active] is ALWAYS null, since that squad's content
 * lives at the top-level GameState fields instead). */
export interface Squads {
  active: number;
  names: string[];
  store: Array<SquadSlot | null>;
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
  /** 0..7 for ray shapes; null on offset shapes (knight jumps have no compass dir). */
  dir: number | null;
  /** Present only on offset shapes: the [dr,dc] jump this beam represents. */
  offset?: Offset;
  path: Cell[];
  /** First Unit linked, or null. Kept for every pre-REQ-0170 consumer. */
  to: string | null;
  /** REQ-0170/REQ-0128b: EVERY Unit this ray linked. Differs from [to] only when
   * the shape pierces. */
  tos: string[];
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
  unitCell: (bp: BP) => Cell;
  cellBPMap: (st: GameState) => Record<string, string>;
  unitMap: (st: GameState) => Record<string, string>;
  cellsOf: (st: GameState, p: PO) => Cell[];
  occupancy: (st: GameState, excl?: string[]) => Record<string, string>;

  canPlacePO: (st: GameState, uid: string, rot: number, anchor: Cell) => PlacementCheck;
  movePO: (st: GameState, uid: string, anchor: Cell | 'inv') => { ok: boolean; why?: string; cells?: Cell[]; bp?: string };
  rotatePO: (st: GameState, uid: string) => { ok: boolean; why?: string; cells?: Cell[] };
  canMoveBP: (st: GameState, bpId: string, origin: Cell) => PlacementCheck;
  moveBP: (st: GameState, bpId: string, origin: Cell) => { ok: boolean; why?: string; cells?: Cell[] };
  /** REQ-0045 (a2): legality for rotating `bpId` 90 degrees CW IN PLACE
   * (origin unchanged; shape/unit/contained-PO layout all rotate about
   * the BP's own bounding box). See mock-src/engine.js's computeRotatedBP
   * doc comment for the exact transform ([r,c]->[c,-r] + renormalize,
   * same matrix rotOffsets uses for PO shapes; unit dirs shift +2 mod
   * 8; contained PO rot advances +1 mod 4). */
  canRotateBP: (st: GameState, bpId: string) => PlacementCheck;
  /** Mutates: commits canRotateBP's candidate rotation atomically (shape,
   * unit off+dirs, every contained PO's cell+rot) -- all-or-nothing,
   * same discipline as moveBP. */
  rotateBP: (st: GameState, bpId: string) => { ok: boolean; why?: string; cells?: Cell[] };
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
  /** REQ-0170: the connection shape of the Unit a BP carries, resolved through the
   * injected registries. null = "forms no links" (no Unit, unknown unit id, or
   * unknown shape key) -- never throws. */
  connShapeOf: (bp: BP) => ConnShapeDef | null;

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
  /** REQ-0045 (a2): the inventory-page twin of canRotateBP -- same
   * rotation math, plus the page's own free-placed-PO/SI occupancy check
   * (invCanPlaceBP's own concern), excluding the rotating BP's OWN
   * contained POs (bug (a)'s fix: never omit this exclusion at any BP
   * move/rotate legality call site, canvas or inventory). */
  invCanRotateBP: (st: GameState, pg: number, bpId: string) => PlacementCheck;
  /** Mutates: commits invCanRotateBP's candidate rotation atomically,
   * same all-or-nothing discipline as invMoveBP/rotateBP. */
  invRotateBP: (st: GameState, pg: number, bpId: string) => { ok: boolean; why?: string; cells?: Cell[] };
  /** True if PO `p` (already page-local) is fully contained within BP
   * `bp`'s footprint (both from the SAME page's arrays). Container-
   * independent shape math, callable with any {bps,pos,sis}-shaped page. */
  poInBPIn: (p: PO, bp: BP) => boolean;

  /** TM (Transmutator) model -- REQ-0042. tmCanPlace mirrors
   * invCanPlaceSI's 1x1/page-bounds/BP-overlap/occupancy rule exactly,
   * PLUS: landing on an existing TM stack of the SAME `id` is reported as
   * a legal merge target (`mergeInto: <destination uid>`) instead of an
   * 'occupied' rejection. */
  tmCanPlace: (st: GameState, pg: number, uid: string, anchor: Cell, exclUids?: string[], idIfNew?: string) => PlacementCheck & { mergeInto?: string };
  /** Mutates: places/moves/merges a TM stack. If `uid` has no existing
   * record in page `pg` yet, `idIfNew`/`qtyIfNew` mint a fresh stack
   * there (used by grant/reward/gacha-finalize call sites). If the
   * destination cell holds another same-id stack, the two are merged
   * (qty summed into the DESTINATION uid; the dragged uid's record is
   * removed) -- `mergedInto` is set on the result when that happens. */
  tmMove: (st: GameState, pg: number, uid: string, anchor: Cell, idIfNew?: string, qtyIfNew?: number) => { ok: boolean; why?: string; cells?: Cell[]; mergeInto?: string; mergedInto?: string };
  /** Row-major first-fit scan for TM placement, byte-identical shape to
   * firstFitSICell (not itself exported as firstFitSICell is, but
   * mirrored here as firstFitTMCell). */
  firstFitTMCell: (container: InvPage) => Cell | null;
  /** Consumes `qty` of TM `id` from page `pg`, largest-stack-first,
   * across every same-id stack ON THAT PAGE (page-scoped by design, see
   * mock-src/engine.js's TM model comment for the documented judgment
   * call). Fails cleanly ({ok:false,why:'insufficient'}) with NO
   * mutation at all if the page's total is less than `qty`. */
  spendTM: (st: GameState, pg: number, id: string, qty: number) => { ok: boolean; why?: string; have?: number; need?: number; spent?: number };
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
   * rejected transfer never partially moves contents.
   *
   * REQ-0033 Phase 1 note (signature UNCHANGED -- only the internal
   * semantics of two of its three cases changed under the reference
   * model; LocRef/argument shape is exactly as before): dispatches on
   * {from.loc,to.loc} into three distinct behaviors --
   *   inv -> inv: UNCHANGED physical relocation (inventory pages hold
   *     homes, not references -- splices the BP + every PO fully inside
   *     it + those POs' seated SIs out of `from`'s page arrays and into
   *     `to`'s, shifting moved POs' cell by the origin delta, exactly as
   *     pre-REQ-0033).
   *   inv -> canvas: now REFERENCE CREATION with exclusion (spec item 4).
   *     The BP's home stays in st.inv.pages[from.page] untouched; the
   *     CURRENT squad's canvas gets a NEW BP reference at `origin` plus
   *     new PO/SI references for every home-contained PO NOT already
   *     referenced by the current squad (see bpReferenceSet below) --
   *     already-referenced POs are EXCLUDED (left behind, per spec item
   *     4), translated to the same relative offset from the new origin
   *     their home records have from the BP's home origin.
   *   canvas -> inv: now REFERENCE REMOVAL. Removes the CURRENT squad's
   *     BP reference and every PO/SI reference it brought along (nested
   *     content still referenced by the current squad, matched against
   *     the BP reference's OWN canvas footprint, not its home one); the
   *     home record(s) are NEVER touched, and `to.page`/`origin` are
   *     IGNORED entirely ("drop cell irrelevant" -- the item already
   *     lives exactly where its home is).
   * If `to.loc==='canvas'` (either the physical or reference-creation
   * case), also runs unseatOrphans (a transferred blade/hilt pair might
   * now (dis)qualify for the 'bond' assembly seat). canvas -> canvas is
   * not a reachable case (a single active squad's canvas is the only
   * "canvas" container that exists at a time -- moving a reference
   * between two SQUADS is expressed as removeRef + switchSquad +
   * createRef, not a single transferBP call). */
  transferBP: (st: GameState, from: LocRef, to: LocRef, bpId: string, origin: Cell) => { ok: boolean; why?: string; cells?: Cell[] };

  /** Accepts a LEGACY-shaped state (no st.inv, and/or legacy loc:'inv'/
   * host:'inv' list-inventory entries) and returns a NEW state object
   * (does NOT mutate the input) with a populated st.inv: legacy unplaced
   * POs first-fit-placed (POs first, then SIs, per REQ-0030 orchestrator
   * default), starting on page 1 (index 0) and overflowing onto
   * subsequent pages if page 1 fills. Un-fittable leftovers (all 5 pages
   * full) remain in their original legacy loc:'inv'/host:'inv' form --
   * never silently dropped. ALSO (REQ-0031 Phase B) materializes st.inv.names
   * (defaults "1".."5") and st.presets (5 squads, slot 0 = whatever this
   * state's own top-level canvas already is, slots 1-4 empty) if either is
   * missing -- "migrateState handles pre-squad saves". Safe/idempotent to
   * call on an ALREADY-migrated state (no legacy entries left to migrate,
   * st.inv.names/st.presets already present -- a no-op copy).
   *
   * REQ-0033 Phase 1 v3 addition (signature UNCHANGED, chains through the
   * above v1/v2 legacy migration first, then applies one more step): any
   * uid CURRENTLY sitting PHYSICALLY on any canvas (the active top-level
   * fields, or any squad's store[i] snapshot) -- under the pre-REQ-0033
   * model, necessarily its own sole copy -- is given a first-fit INVENTORY
   * home (same firstFit algorithm as the legacy step above), and the
   * canvas record is replaced in-place by a REFERENCE (same uid/cell/rot/
   * origin/host -- visually byte-identical; only its "am I the only copy"
   * status changes). BPs get homes first (so contained POs' BP-containment
   * is well-defined against the home arrangement), then POs, then SIs.
   * Idempotent for v3 too: a state where every canvas-resident uid already
   * has a home is left untouched by this step (a no-op on an
   * already-v3 state). */
  migrateState: (oldState: GameState) => GameState;

  // -----------------------------------------------------------------------
  // Squad model (REQ-0031 Phase B). st.{linked,bps,pos,sis} remains THE
  // ACTIVE squad's canvas -- every function above this section keeps
  // reading/writing those same top-level fields, unaware squads exist.
  // -----------------------------------------------------------------------

  /** Number of squads a freshly-made state carries (5). Distinct from
   * st.presets.store.length, which GROWS with addSquad() -- SQUAD_COUNT
   * is only the initial/default count. */
  SQUAD_COUNT: number;

  /** Fresh {active:0,names:[...],store:[...]} for `count` presets: slot 0
   * has store[0]=null (its content is supplied separately, at the
   * top-level GameState fields), every other slot holds an empty squad
   * snapshot (emptySquadSlot()). */
  makeSquadsMeta: (count: number) => Squads;

  /** A fresh, EMPTY squad snapshot: {linked:true,bps:[],pos:[],sis:[]}.
   * Used internally by makeSquadsMeta/addSquad; exposed for callers that
   * need a correctly-shaped empty squad without hand-rolling it. */
  emptySquadSlot: () => SquadSlot;

  /** Atomically swaps the ACTIVE squad's top-level canvas fields
   * (st.linked/bps/pos/sis) with st.presets.store[n]'s snapshot; sets
   * st.presets.active=n. Both the outgoing and incoming configurations
   * are fully preserved (the outgoing canvas is written into
   * store[oldActive], never discarded). No-op (still {ok:true}) if `n` is
   * already the active squad. Runs unseatOrphans() on the newly-active
   * canvas afterward (mirrors movePO/transferBP's own post-mutation
   * cleanup). Rejects out-of-range `n`. */
  switchSquad: (st: GameState, n: number) => { ok: boolean; why?: string };

  /** Appends a brand-new EMPTY squad (never copies any content/uid) to
   * st.presets.store, and a matching entry to st.presets.names (defaults
   * to "Squad N", 1-based). Returns the new squad's 0-based index. */
  addSquad: (st: GameState, name?: string) => { ok: boolean; why?: string; index?: number };

  /** Sets squad `n`'s (0-based) display name -- works identically whether
   * `n` is the currently-active squad or an inactive stored one. */
  renameSquad: (st: GameState, n: number, name: string) => { ok: boolean; why?: string };

  /** Sets inventory page `n`'s (0-based) display name on st.inv.names.
   * Materializes st.inv.names defensively (to the PAGE_COUNT-long default)
   * if it was missing/short before applying the one requested change. */
  renameInvPage: (st: GameState, n: number, name: string) => { ok: boolean; why?: string };

  /** The live st.inv.names array, defaulting to "1".."5" for any state
   * built without one (pure read helper -- never mutates st.inv). */
  invPageNames: (st: GameState) => string[];

  /** REQ-0032: moves squad slot `from` to index `to` (both 0-based,
   * splice-out/splice-in semantics). The squad's ENTIRE content (store
   * slot, or the live top-level canvas fields if it was the active
   * squad) and its names[] entry move together as one squad. `active`
   * is recomputed so it keeps identifying the SAME squad it did before
   * the move: if the moved squad (`from`) IS the active one, active
   * follows it to `to`; otherwise active shifts by one slot only when
   * `from`/`to` straddle it (closing/opening a gap on one side of it),
   * and is untouched when the move is entirely on one side of active.
   * No-op (still {ok:true}) if from===to. Rejects out-of-range indices
   * (state left completely untouched on rejection). */
  reorderSquad: (st: GameState, from: number, to: number) => { ok: boolean; why?: string };

  /** REQ-0032: removes squad `n` (0-based) ENTIRELY -- its reference set
   * (store slot) and its names[] entry both vanish. Per the REQ-0033
   * reference model, this NEVER touches st.inv: a deleted squad's
   * references simply disappear; inventory homes (and every OTHER
   * squad's own references to the same uids, if shared) are completely
   * untouched. Refuses (returns {ok:false}, does NOT mutate st at all)
   * when `n` is the last remaining squad (at least 1 must always
   * remain). If the deleted squad was the ACTIVE one, active lands on
   * the "nearest remaining tab": the same index if a squad still
   * occupies it after the splice (the next tab over slides into the
   * gap), else the new last index. Deleting a non-active squad leaves
   * active pointing at the same squad as before (index shifts left by
   * one only if the deleted slot was before it). */
  deleteSquad: (st: GameState, n: number) => { ok: boolean; why?: string };

  /** REQ-0032: moves inventory page `from` to index `to` (both 0-based,
   * same splice semantics as reorderSquad). The page's entire contents
   * ({bps,pos,sis}) and its st.inv.names entry move together as one
   * squad. Also rewrites any free-placed SI's embedded `host.page` field
   * (see migrateState's v3 step) to the item's actual NEW page index --
   * the only page-index-shaped data embedded anywhere outside the
   * st.inv.pages array position itself (every other query --
   * homeLocationOf/allHomeUids/tintSets/usageOf -- scans st.inv.pages
   * live, so it self-corrects from the permuted array with no further
   * work). `activeInvPage` (which tab is shown) is CLIENT-side UI state,
   * not part of engine `st` -- the caller (store.ts) is responsible for
   * applying the identical index-shift rule to its own activeInvPage
   * after a successful call here. No-op (still {ok:true}) if
   * from===to. Rejects out-of-range indices (state left completely
   * untouched on rejection). */
  reorderInvPage: (st: GameState, from: number, to: number) => { ok: boolean; why?: string };

  /** Read-only auditor for the REQ-0033 reference-model invariant
   * (REPLACES the pre-REQ-0033 "uid lives in exactly one place"
   * physicality rule this same function used to check -- signature
   * unchanged, semantics rewritten; see mock-src/engine.js's own updated
   * comment on checkUidInvariant for the authoritative description this
   * mirrors). Now checks TWO things:
   *   (a) every uid (PO/BP/SI) has a HOME AT MOST ONCE across
   *     st.inv.pages -- a uid with 2+ home records is a duplicate/
   *     collision bug.
   *   (b) no SINGLE squad's own canvas (the active top-level fields, or
   *     any inactive store[i] snapshot) references the same uid twice --
   *     two independent references to one item coexisting within ONE
   *     squad would mean createRef's red-rule guard was bypassed
   *     somewhere.
   * A uid referenced by several DIFFERENT squads is explicitly NOT a
   * violation of either rule -- that is the intended yellow/shared case
   * (spec item 3), not a duplicate. Returns {ok:true,duplicates:[]} if
   * both hold, else {ok:false,why,duplicates:[...]} where each entry is
   * either a 'po:<uid>'/'bp:<uid>'/'si:<uid>' tag (a home appearing 2+
   * times) or the same tag suffixed '@squad<i>' (a within-squad
   * reference duplicate). Does not check for missing uids (an item
   * deleted outright is not this invariant's concern), only duplication. */
  checkUidInvariant: (st: GameState) => { ok: boolean; why?: string; duplicates: string[] };

  // -----------------------------------------------------------------------
  // Reference model (REQ-0033 Phase 1 engine / Phase 2 client consumer).
  // "Inventory is master": every PO/BP/SI uid has exactly ONE home record,
  // living in st.inv.pages[n].{pos,bps,sis}. A squad's own canvas (the
  // active top-level st.{bps,pos,sis}, or an inactive st.presets.store[i]
  // snapshot) holds REFERENCES to home records -- same uid, same record
  // shape as the home, but a physically separate object living in the
  // squad's own arrays. A uid may have at most ONE reference per squad,
  // but the SAME uid may be simultaneously referenced by several DIFFERENT
  // squads (that is the yellow/shared case, not a violation -- see
  // checkUidInvariant above). All queries below are deliberately
  // recomputed on demand (never cached) -- comfortably sub-millisecond at
  // this game's scale (SQUAD_COUNT squads x a few dozen items), per the
  // perf note on tintSets in mock-src/engine.js.
  // -----------------------------------------------------------------------

  /** Every squad index (0-based) that currently holds a reference to
   * `uid` -- scans the ACTIVE squad's top-level fields (st.bps/pos/sis)
   * for st.presets.active, and every OTHER squad's store[i] snapshot for
   * the rest. Returns [] if st.presets is missing (a pre-squad/synthetic
   * state) or if `uid` is referenced nowhere. This is the direct building
   * block behind usedByCurrent/usedByOthers/tintSets/isSquadIndependent
   * below -- none of them maintain their own index; they all call this. */
  usageOf: (st: GameState, uid: string) => number[];
  /** True iff the CURRENTLY ACTIVE squad (st.presets.active) holds a
   * reference to `uid` -- the direct predicate behind the red tint (spec
   * item 2, "already used in the CURRENT squad") and the exact rule
   * createRef's red-rule guard enforces (refuses to create a second
   * reference for the current squad when this is already true). False
   * if st.presets is missing. */
  usedByCurrent: (st: GameState, uid: string) => boolean;
  /** True iff at least one squad OTHER THAN the currently active one
   * holds a reference to `uid` -- the direct predicate behind the yellow
   * tint (spec item 3, "used by OTHER squads"). NOT mutually exclusive
   * with usedByCurrent (a uid can be referenced by the current squad AND
   * by another squad at the same time). False if st.presets is missing. */
  usedByOthers: (st: GameState, uid: string) => boolean;
  /** {red,yellow,canvasYellow} -- all Sets of uid strings, computed fresh
   * over every uid with a home in st.inv.pages[] (allHomeUids):
   *   red: every uid referenced by the CURRENT squad (spec item 2) --
   *     render this INVENTORY-side as the translucent faint red overlay.
   *   yellow: every uid used by at least one OTHER squad (spec item 3)
   *     -- render this INVENTORY-side as the translucent faint yellow
   *     overlay. Not mutually exclusive with red (see usedByOthers doc).
   *   canvasYellow: the subset of `red` ALSO in `yellow` -- i.e. uids
   *     sitting on the CURRENT canvas right now that are ALSO shared with
   *     some other squad ("the same yellow indicator also shows on the
   *     Squad(canvas) display", spec item 3). Render this CANVAS-side as
   *     the yellow overlay -- canvas never shows red (every canvas item
   *     is, by definition, used by the current squad already). */
  tintSets: (st: GameState) => { red: Set<string>; yellow: Set<string>; canvasYellow: Set<string> };
  /** True iff squad `n`'s referenced uids share NO uid with any OTHER
   * squad -- "a Squad containing ZERO yellow-tinted items is an
   * independent Squad" (spec item 5), phrased as a direct per-squad
   * predicate rather than requiring the caller to intersect tintSets()
   * themselves. Empty squads are vacuously independent. True if
   * st.presets is missing (nothing to conflict with). */
  isSquadIndependent: (st: GameState, n: number) => boolean;
  /** REQ-0041: true iff squad n's canvas has >=1 BP ("Backpack-as-HP --
   * no BP = dead on arrival", feedback 5). A SEPARATE, purely structural
   * predicate from isSquadIndependent -- callers that need both AND them
   * together at the call site (see server/schedule.cjs's assignSlot and
   * client/src/schedule/SlotsPanel.tsx). False if st.presets is missing
   * (mirrors isSquadIndependent's own "vacuous" convention, but inverted:
   * an empty/no-squad-system canvas has no BPs to deploy). */
  isSquadDeployable: (st: GameState, n: number) => boolean;
  /** Locates uid's ONE home record: {page,kind,record}, kind is
   * 'po'|'bp'|'si', page is the 0-based st.inv.pages[] index, record is
   * the actual PO/BP/SI object (mutating it mutates the home in place,
   * same aliasing convention as every other engine accessor in this
   * file). Returns null if uid has no home (not yet migrated, or absent
   * entirely -- e.g. a synthetic test fixture with no st.inv at all). */
  homeLocationOf: (st: GameState, uid: string) => { page: number; kind: 'po' | 'bp' | 'si'; record: PO | BP | SI } | null;
  /** Given a BP's uid, computes the nested reference set a canvas
   * reference-creation for it must bring along (used internally by
   * transferBP's inv->canvas case; exposed here for callers -- e.g. E2E
   * assertions or a future UI preview -- that want to know the exclusion
   * outcome WITHOUT actually performing the transfer). Containment ("is
   * this PO inside this BP") is evaluated against the BP's HOME page,
   * never a canvas footprint. Returns {ok:false,why:'no home'} if bpUid
   * has no home or its home isn't a BP. On success:
   *   pos: home-contained PO uids NOT already referenced by the current
   *     squad (these travel with the BP reference).
   *   excluded: home-contained PO uids that ARE already referenced by the
   *     current squad (spec item 4 -- these are LEFT BEHIND, not brought
   *     along as a second reference).
   *   sis: SI uids seated on any INCLUDED (non-excluded) PO -- an
   *     excluded PO's own seated SI does NOT travel either (its home is
   *     untouched regardless; only whether a NEW reference is created for
   *     it is affected by the exclusion). */
  bpReferenceSet: (st: GameState, bpUid: string) => { ok: boolean; why?: string; bp?: string; pos?: string[]; sis?: string[]; excluded?: string[] };
  /** Creates a REFERENCE to home item `uid` in the CURRENT squad's canvas
   * (st.pos/bps/sis) -- the home record in st.inv.pages is never touched.
   * Refuses with {ok:false,why:'already referenced by current squad'}
   * (the red rule) if usedByCurrent(st,uid) is already true, or
   * {ok:false,why:'no home'} if uid has no home record (or its home's own
   * kind doesn't match the requested `kind`). `placement` shape depends on
   * `kind`:
   *   'po': {cell:Cell; rot?:number} -- rot defaults to the home record's
   *     OWN rot if omitted. The new reference is validated for canvas
   *     legality (bounds/BP-containment/overlap) via the SAME canPlacePO
   *     check any other canvas placement uses; a geometrically-illegal
   *     placement fails CLEANLY (state left untouched, matching every
   *     other engine mutator's fail-clean contract) -- the red-rule check
   *     happens first and is unconditional, but a passing red-rule check
   *     does NOT guarantee geometric success, so callers must still check
   *     `.ok` for both reasons.
   *   'bp': {origin:Cell} -- creates ONLY the BP's own reference; nested
   *     PO/SI contents are NOT handled here (see bpReferenceSet/
   *     transferBP for the nested-content walk -- createRef('bp',...) is
   *     a building block transferBP composes, not a full BP-with-contents
   *     operation by itself).
   *   'si': {host: 'inv' | 'bond' | {po:string; si:number}} -- 'inv'
   *     creates a bare stowed reference (not seated); {po,si} or 'bond'
   *     additionally seats it onto that socket immediately (fails cleanly
   *     -- reference not created -- if the seat attempt itself is
   *     illegal). */
  createRef: (st: GameState, kind: 'po' | 'bp' | 'si', uid: string, placement: { cell?: Cell; rot?: number; origin?: Cell; host?: 'inv' | 'bond' | { po: string; si: number } }) => { ok: boolean; why?: string; ref?: PO | BP | SI };
  /** Removes the CURRENT squad's reference to `uid` (if any) from
   * st.pos/bps/sis -- the home record in st.inv.pages is NEVER touched
   * (canvas -> inventory drag under the reference model: "drop cell
   * irrelevant", the item stays exactly where its home already is).
   * ALWAYS succeeds: {ok:true,removed:false} (not an error) if the
   * current squad holds no such reference to begin with. For kind
   * 'po', ALSO cascades to remove any SI references seated on that PO
   * reference (their own homes likewise untouched) and runs
   * unseatOrphans() afterward (mirrors every other PO-removal path's
   * post-mutation cleanup). */
  removeRef: (st: GameState, kind: 'po' | 'bp' | 'si', uid: string) => { ok: boolean; removed?: boolean; why?: string };
}

export interface EngineModule {
  create: (
    items: ItemDefMap,
    siDefs: SIDefMap,
    layout: Layout,
    trees?: Trees,
    /** REQ-0170: the unit/1 def map (content/live/live_units.json). Optional --
     * an engine created without it forms no Unit links and otherwise behaves
     * identically. */
    units?: UnitDefMap,
    /** REQ-0170: vocab.json's connection_shapes table. Optional, same policy. */
    shapes?: ConnShapeMap
  ) => EngineInstance;
  rotOffsets: (base: Offset[], k: number) => Offset[];
  hasTag: (tagList: string[] | undefined, targetTag: string, tree?: TagTree) => boolean;
  ancestorsOf: (tree: TagTree | undefined, tag: string) => string[];
  tagsRelated: (tree: TagTree | undefined, tagA: string, tagB: string) => boolean;
}
