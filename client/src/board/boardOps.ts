// Per-board engine-call abstraction — REQ-0030 Phase 2.
//
// BoardRenderer (see BoardRenderer.ts) is shared, parameterized code: ONE
// class renders BOTH the canvas board and any inventory-page board. The
// canvas and an inventory page are structurally similar (each is a
// {bps,pos,sis}-shaped container, per the engine's own Phase 1 design) but
// their MUTATOR/QUERY call surfaces are genuinely different functions in
// shared/engine.js (canPlacePO(st,...) vs invCanPlacePO(st,pg,...), etc)
// -- never a shared function with a mode flag. BoardOps is the seam: it
// wraps whichever set of engine calls is correct for a given board (canvas
// vs a specific inventory page) behind ONE interface, so BoardRenderer's
// render()/interaction code calls `this.ops.X(...)` uniformly and never
// branches on mode itself for legality/mutation -- all legality still
// comes from the engine, exactly as before (no client-side reimplementation
// of any rule).
//
// Canvas-only concepts (assembly/bond socket, beams, combos, port ◇/◆
// marks, the chain-link toggle) have NO inventory equivalent -- BoardOps
// does not attempt to unify those; BoardRenderer itself gates that
// rendering behind `this.mode==='canvas'` (see BoardRenderer's render()).
// SI free-placement (invCanPlaceSI/invMoveSI) has no canvas equivalent
// either (SIs cannot be free-placed on canvas, per REQ-0030 spec) --
// CanvasOps.canPlaceSI/moveSI below always report "not supported" so the
// interaction layer can treat a canvas free-cell SI drop as illegal
// without special-casing "am I on canvas" itself.
import type {
  BP,
  Cell,
  EngineInstance,
  GameState,
  InvPage,
  PlacementCheck,
  PO,
  SI,
  Socket,
} from '../engine/engine.d.ts';
import type { BoardId } from './drag';

/** Read-only container view: the canvas (GameState itself, which already
 * carries bps/pos/sis) or one inventory page (InvPage). Both shapes are
 * field-for-field identical for these three arrays, per the engine's own
 * Phase 1 design note. */
export interface BoardContainer {
  bps: BP[];
  pos: PO[];
  sis: SI[];
}

export interface MoveResult {
  ok: boolean;
  why?: string;
  cells?: Cell[];
  bp?: string;
}

export interface BoardOps {
  readonly boardId: BoardId;
  /** True only for the canvas board -- gates assembly/beams/combos/chain-
   * toggle/port marks rendering in BoardRenderer (those have no inventory
   * equivalent per REQ-0030 spec item 7 + orchestrator defaults). */
  readonly isCanvas: boolean;

  container(state: GameState): BoardContainer;
  cellBPMap(state: GameState): Record<string, string>;
  cellsOf(state: GameState, p: PO): Cell[];
  occupancy(state: GameState, excl?: string[]): Record<string, string>;
  sockets(state: GameState): Socket[];

  canPlacePO(state: GameState, uid: string, rot: number, anchor: Cell): PlacementCheck;
  movePO(state: GameState, uid: string, anchor: Cell): MoveResult;
  rotatePO(state: GameState, uid: string): MoveResult;

  canMoveBP(state: GameState, bpId: string, origin: Cell): PlacementCheck;
  moveBP(state: GameState, bpId: string, origin: Cell): MoveResult;

  /** REQ-0045 (a2): legality + commit for rotating a BP 90 degrees CW in
   * place (dblclick trigger -- see BoardRenderer.ts's handleBPPointerDown).
   * Canvas delegates directly to engine.canRotateBP/rotateBP; inventory
   * delegates to engine.invCanRotateBP/invRotateBP (page-scoped, same
   * "delegate, don't reimplement" convention every other BP op here
   * follows). */
  canRotateBP(state: GameState, bpId: string): PlacementCheck;
  rotateBP(state: GameState, bpId: string): MoveResult;

  /** Free-cell SI placement -- inventory-only. Canvas implementation
   * always returns {ok:false}: SIs cannot be free-placed on canvas. */
  canPlaceSI(state: GameState, uid: string, anchor: Cell): PlacementCheck;
  moveSI(state: GameState, uid: string, anchor: Cell): MoveResult;

  hostOk(state: GameState, siUid: string, sock: Socket): { ok: boolean; why?: string };
  seatSI(state: GameState, siUid: string, skey: string): { ok: boolean; why?: string };
  stowSI(state: GameState, siUid: string): { ok: boolean };
}

const NOT_SUPPORTED: PlacementCheck = { ok: false, cells: [], why: 'not supported on this board' };

export function makeCanvasOps(engine: EngineInstance): BoardOps {
  return {
    boardId: { loc: 'canvas' },
    isCanvas: true,
    container(state) {
      return state;
    },
    cellBPMap(state) {
      return engine.cellBPMap(state);
    },
    cellsOf(state, p) {
      return engine.cellsOf(state, p);
    },
    occupancy(state, excl) {
      return engine.occupancy(state, excl);
    },
    sockets(state) {
      return engine.sockets(state);
    },
    canPlacePO(state, uid, rot, anchor) {
      return engine.canPlacePO(state, uid, rot, anchor);
    },
    movePO(state, uid, anchor) {
      return engine.movePO(state, uid, anchor);
    },
    rotatePO(state, uid) {
      return engine.rotatePO(state, uid);
    },
    canMoveBP(state, bpId, origin) {
      return engine.canMoveBP(state, bpId, origin);
    },
    moveBP(state, bpId, origin) {
      return engine.moveBP(state, bpId, origin);
    },
    canRotateBP(state, bpId) {
      return engine.canRotateBP(state, bpId);
    },
    rotateBP(state, bpId) {
      return engine.rotateBP(state, bpId);
    },
    canPlaceSI() {
      return NOT_SUPPORTED;
    },
    moveSI() {
      return { ok: false, why: 'SIs cannot be free-placed on canvas' };
    },
    hostOk(state, siUid, sock) {
      return engine.hostOk(state, siUid, sock);
    },
    seatSI(state, siUid, skey) {
      return engine.seatSI(state, siUid, skey);
    },
    stowSI(state, siUid) {
      return engine.stowSI(state, siUid);
    },
  };
}

export function makeInvOps(engine: EngineInstance, page: number): BoardOps {
  const pageContainer = (state: GameState): InvPage => {
    if (!state.inv) throw new Error('boardOps: state.inv missing -- migrateState() must run before use');
    return state.inv.pages[page];
  };
  return {
    boardId: { loc: 'inv', page },
    isCanvas: false,
    container(state) {
      return pageContainer(state);
    },
    cellBPMap(state) {
      return engine.cellBPMapIn(pageContainer(state));
    },
    cellsOf(_state, p) {
      return engine.cellsOfIn(p);
    },
    occupancy(state, excl) {
      return engine.invOccupancy(pageContainer(state), excl);
    },
    sockets(state) {
      return engine.pageSockets(state, page);
    },
    canPlacePO(state, uid, rot, anchor) {
      return engine.invCanPlacePO(state, page, uid, rot, anchor);
    },
    movePO(state, uid, anchor) {
      return engine.invMovePO(state, page, uid, anchor);
    },
    rotatePO(state, uid) {
      return engine.invRotatePO(state, page, uid);
    },
    canMoveBP(state, bpId, origin) {
      // REQ-0045 bug (a) fix: invCanPlaceBP's free-item occupancy check
      // (invOccupancy) must exclude the BP's OWN contained POs from the
      // collision test, exactly like invMoveBP itself already does
      // internally (see engine.js's invMoveBP: `const inside=container.
      // pos.filter(p=>poInBPIn(p,bp)); ... invCanPlaceBP(...,inside.map(p
      // =>p.uid))`). Root cause: this HOVER-PREVIEW call used to omit the
      // 4th exclUids argument entirely, so any candidate origin whose new
      // footprint overlapped a cell the BP's OWN travelling PO currently
      // occupies (the common case: nudging a BP with contents by only a
      // few cells, so old/new footprints intersect) was incorrectly
      // reported illegal (occ[cell] found the PO's own uid and treated it
      // as "overlaps free-placed item"). Since the hover preview is what
      // sets `drop` (see BoardRenderer.ts's onGlobalPointerMove 'bp'
      // branch: `drop = chk.ok ? {...} : null`), a permanently-false
      // preview meant pointerup never had a drop target to commit against
      // -- the move silently no-op'd for that entire class of drags, even
      // though invMoveBP's OWN legality check (used at actual commit
      // time) would have allowed it. Fix: derive the same exclUids set
      // here, using the already-exported poInBPIn, so the preview and the
      // real commit check agree.
      const container = pageContainer(state);
      const bp = container.bps.find((b) => b.id === bpId);
      const exclUids = bp ? container.pos.filter((p) => engine.poInBPIn(p, bp)).map((p) => p.uid) : [];
      return engine.invCanPlaceBP(state, page, bpId, origin, exclUids);
    },
    moveBP(state, bpId, origin) {
      return engine.invMoveBP(state, page, bpId, origin);
    },
    canRotateBP(state, bpId) {
      return engine.invCanRotateBP(state, page, bpId);
    },
    rotateBP(state, bpId) {
      return engine.invRotateBP(state, page, bpId);
    },
    canPlaceSI(state, uid, anchor) {
      return engine.invCanPlaceSI(state, page, uid, anchor);
    },
    moveSI(state, uid, anchor) {
      return engine.invMoveSI(state, page, uid, anchor);
    },
    hostOk(state, siUid, sock) {
      // pageSockets()-derived Socket shape matches canvas Socket shape
      // exactly, and hostOk's logic (slot/tag matching) is container-
      // independent (reads sock.t/sock.tags/sock.siUid + the SI's own
      // def, never st.bps/st.pos directly) -- reusing engine.hostOk here
      // is correct, not a cross-container shortcut.
      return engine.hostOk(state, siUid, sock);
    },
    seatSI(state, siUid, skey) {
      return engine.invSeatSI(state, page, siUid, skey);
    },
    stowSI(state, siUid) {
      return engine.invStowSI(state, page, siUid);
    },
  };
}
