// client/src/board/commits.ts -- REQ-0047 (f2-3): drag-commit pipeline: BoardCommitApi + PO/Assembly/BP/SI drop commits, cross-board splice/preview.
// Moved MECHANICALLY from BoardRenderer.ts (this. -> self. receiver).
import type { Cell, GameState, Socket } from '../engine/engine.d.ts';
import { boardIdEquals } from './drag';
import type { BoardCommitApi, BoardId, CarryState, DropTarget } from './drag';
import { flash } from './ghosts'; // REQ-0288: the revert cue reuses the flash mechanism (neutral grey)
import { notifyStateChanged } from '../store';
import type { BoardRenderer } from './BoardRenderer';

export function makeCommitApi(self: BoardRenderer, ): BoardCommitApi {
    return {
      commitPO: (uid, originBoard, drop) => commitPODrop(self, uid, originBoard, drop),
      commitAsm: (originBoard, drop) => commitAsmDrop(self, originBoard, drop),
      commitBP: (bpId, originBoard, drop) => commitBPDrop(self, bpId, originBoard, drop),
      commitSI: (uid, originBoard, drop) => commitSIDrop(self, uid, originBoard, drop),
      // REQ-0288: "snapped home" cue for an armed carry that ended with NO
      // commit. Neutral grey -- NOT the red reject flash: this is "returned",
      // not "refused". State was never touched on those paths.
      revertFeedback: (c: CarryState) => {
        if (self.disposed || !self.lastState) return;
        self.revertCount++;
        flash(self, carryHomeCells(self, c), '#8a8a8a');
      },
    };
  }

  /** Commits a PO drop landing on THIS board. `drop.board` is always
   * `self.boardId` by construction (the registry only ever calls the API
   * registered under the drop's own board id). Same-board vs cross-board
   * is distinguished via the carry's `originBoard` -- but this board's
   * commit only ever needs ITS OWN destination-side mutator: a PO does
   * not carry "container membership" as a separate structural concept the
   * way a BP does (no PO-level transfer function exists, nor is one
   * needed) -- canvas movePO('inv') already means "leave the grid" and,
   * conversely, invMovePO always requires a page a PO is ALREADY a member
   * of. REQ-0030 Phase 2 extends this: a PO moving from board A to board B
   * is handled as a two-step splice performed HERE (not a new engine
   * function) -- remove the PO record (and any seated SI records) from
   * board A's arrays, push them into board B's arrays with the cell
   * translated into board B's coordinate space, THEN call board B's own
   * movePO-equivalent to validate+place it. This mirrors EXACTLY the
   * splice pattern engine.js's own transferBP already uses for BPs (see
   * its module comment) -- applying that same, already-reviewed mechanic
   * to a lone PO (no BP involved) rather than inventing a new rule. */
export function commitPODrop(self: BoardRenderer, uid: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void {
    const state = self.lastState;
    if (!state) return;
    const { engine, ops } = self.deps;
    const sameBoard = boardIdEquals(originBoard, self.boardId);
    // REQ-0033 Phase 2: cross-board PO drops are no longer a universal
    // splice-then-movePO -- the reference model gives each of the three
    // possible crossings its OWN distinct meaning (see engine.js's
    // reference-model module comment / engine.d.ts's createRef/removeRef
    // doc comments for the authoritative rules this mirrors):
    //   inv -> canvas: REFERENCE CREATION. The PO's home (living in
    //     state.inv.pages[originBoard.page].pos) is left completely
    //     untouched; engine.createRef makes a NEW canvas reference at
    //     drop.anchor, rot omitted so createRef defaults it to the home
    //     record's own rot (matches whatever the ghost preview showed,
    //     since the ghost read `p.rot` from the SAME origin container --
    //     see onGlobalPointerMove's 'po' branch). createRef internally
    //     refuses (red rule) if usedByCurrent is already true for this
    //     uid -- deliberately NOT re-checked here client-side (the ghost
    //     preview already gated this during the drag via
    //     previewCrossBoardPO's own usedByCurrent guard; a stale/illegal
    //     attempt still fails safely here, just via createRef's own
    //     {ok:false} rather than a duplicated client-side check).
    //   canvas -> inv: REFERENCE REMOVAL. Per spec ("drop cell
    //     irrelevant; no placement occurs"): engine.removeRef deletes
    //     ONLY the current squad's canvas reference; the home in
    //     state.inv.pages is never touched, and drop.anchor/drop.type are
    //     deliberately ignored -- no ops.movePO call follows for this
    //     direction. removeRef always succeeds (a harmless
    //     {ok:true,removed:false} no-op if, somehow, nothing was there to
    //     remove), so there is no rejection path to handle here.
    //   inv <-> inv (both boards are inventory pages, different page
    //     indices): UNCHANGED physical home relocation -- inventory pages
    //     hold homes, not references, so this is still a real splice
    //     (splicePOAcrossBoardsPhysical, renamed from the old universal
    //     splicePOAcrossBoards to make this scoping explicit) followed by
    //     the destination page's own movePO-equivalent, exactly as
    //     pre-REQ-0033.
    // Same-board (sameBoard===true, including a same-page inventory drag)
    // is completely unaffected: falls straight through to ops.movePO
    // below, same as always.
    if (!sameBoard) {
      if (originBoard.loc === 'inv' && self.boardId.loc === 'canvas') {
        if (drop.type === 'grid') engine.createRef(state, 'po', uid, { cell: drop.anchor });
      } else if (originBoard.loc === 'canvas' && self.boardId.loc === 'inv') {
        engine.removeRef(state, 'po', uid);
      } else {
        // inv -> inv: still a physical home move.
        splicePOAcrossBoardsPhysical(self, state, uid, originBoard, self.boardId);
        // REQ-0273 (bug 2 hardening): the splice carries the record with its
        // STALE source-page coordinates; only the movePO call validates them
        // against the destination. If the destination refuses at commit time
        // (reachable only when state mutated between hover preview and
        // pointerup -- e.g. a background claim landed on the target cells),
        // the PO must not be stranded on the new page unvalidated at those
        // stale coordinates (that is the same illegal-overlap class as the
        // firstFitPlaceBp capture). Splice it straight back home, where its
        // old coordinates are ones the engine already accepted.
        const mv = drop.type === 'grid' ? ops.movePO(state, uid, drop.anchor) : { ok: false };
        if (!mv.ok) splicePOAcrossBoardsPhysical(self, state, uid, self.boardId, originBoard);
      }
      self.gCarry.removeChildren();
      self.gTarget.removeChildren();
      notifyStateChanged();
      return;
    }
    if (drop.type === 'grid') {
      ops.movePO(state, uid, drop.anchor);
    }
    // drop.type==='inv' has no meaning for a PO landing ON an inventory
    // board itself (that variant is only ever produced by canvas-mode
    // pointermove's overlap-with-the-inventory-canvas fallback, which
    // REQ-0030 Phase 2 no longer needs -- the inventory IS a real board
    // now, drops on it always resolve to a concrete 'grid' anchor via
    // invCanPlacePO -- kept in the DropTarget union only for the SI
    // stow-with-no-cell edge case, see commitSIDrop).
    self.gCarry.removeChildren();
    self.gTarget.removeChildren();
    notifyStateChanged();
  }

export function commitAsmDrop(self: BoardRenderer, _originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void {
    // Assemblies are canvas-only (see render()'s `ops.isCanvas` guard on
    // `asm`) -- an 'asm' carry can therefore only ever originate on, and
    // land on, the canvas board (moving INTO an inventory page would
    // require a bond-socket concept pageSockets() deliberately never
    // emits, per engine.js's design note). self.deps.engine.moveAssembly
    // is still the plain canvas mutator (no ops indirection needed: 'asm'
    // never applies to an inventory BoardOps instance).
    const state = self.lastState;
    if (!state || !self.deps.ops.isCanvas) return;
    if (drop.type === 'grid') self.deps.engine.moveAssembly(state, drop.anchor);
    else self.deps.engine.moveAssembly(state, 'inv');
    self.gCarry.removeChildren();
    self.gTarget.removeChildren();
    notifyStateChanged();
  }

  /** Commits a BP drop landing on THIS board. Same-board reposition uses
   * ops.moveBP (moveBP/invMoveBP); cross-board uses engine.transferBP
   * directly (the one engine function that already knows how to carry a
   * BP's contents across a container boundary -- REQ-0030 Phase 1's
   * headline addition), addressed via LocRef built from each board's
   * BoardId (identical shape by construction, see boardOps.ts's BoardId/
   * LocRef parity note). */
export function commitBPDrop(self: BoardRenderer, bpId: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'bp' }>): void {
    const state = self.lastState;
    if (!state) return;
    const { engine, ops } = self.deps;
    if (boardIdEquals(originBoard, self.boardId)) {
      ops.moveBP(state, bpId, drop.origin);
    } else {
      engine.transferBP(state, originBoard, self.boardId, bpId, drop.origin);
    }
    self.gCarry.removeChildren();
    self.gTarget.removeChildren();
    notifyStateChanged();
  }

  /** Commits an SI drop landing on THIS board: either onto a socket
   * (ops.seatSI, same-board or cross-board alike -- seating just needs the
   * SI to already be a member of THIS board's sis[] array, so a
   * cross-board seat first splices the SI record across, same technique
   * as commitPODrop) or a free cell (ops.moveSI, inventory boards only --
   * canvas's ops.moveSI always reports failure and is never reached here
   * since canvas never produces a 'grid'-type SI drop, see
   * onGlobalPointerMove's 'si' branch). */
export function commitSIDrop(self: BoardRenderer, uid: string, originBoard: BoardId, drop: DropTarget): void {
    const state = self.lastState;
    if (!state) return;
    const { engine, ops } = self.deps;
    const sameBoard = boardIdEquals(originBoard, self.boardId);
    // REQ-0033 Phase 2: same three-way split as commitPODrop above (see
    // its comment for the full rationale) -- inv->canvas creates a
    // reference, canvas->inv removes one, inv<->inv stays a physical
    // splice. An SI's `host` placement shape for createRef is either
    // 'bond' / {po,si} (immediately seat the new reference onto that
    // socket -- derived from drop.skey, which the engine's own seatSI
    // uses in the identical '<poUid>:<siIndex>' or 'bond' string form,
    // see mock-src/engine.js's seatSI) or the 'inv' sentinel (a bare
    // stowed reference, not seated onto anything -- used for a 'grid' or
    // 'inv'-type drop landing on canvas; canvas has no free-placed-SI
    // concept of its own -- boardOps.ts's makeCanvasOps.canPlaceSI always
    // reports NOT_SUPPORTED -- so a bare SI reference with host:'inv' is
    // the only sensible canvas-side outcome for those drop types, and in
    // practice 'grid'/'inv'-type SI drops targeting the canvas board are
    // not reachable via the current drag UX, which always resolves a
    // canvas SI drop to either a 'sock' hit or an outright illegal/no-op
    // drop -- this branch exists for completeness/robustness, not because
    // it is exercised today).
    if (!sameBoard) {
      if (originBoard.loc === 'inv' && self.boardId.loc === 'canvas') {
        if (drop.type === 'sock') {
          const host = drop.skey === 'bond' ? ('bond' as const) : { po: drop.skey.slice(0, drop.skey.lastIndexOf(':')), si: Number(drop.skey.slice(drop.skey.lastIndexOf(':') + 1)) };
          engine.createRef(state, 'si', uid, { host });
        } else {
          engine.createRef(state, 'si', uid, { host: 'inv' });
        }
      } else if (originBoard.loc === 'canvas' && self.boardId.loc === 'inv') {
        engine.removeRef(state, 'si', uid);
      } else {
        // inv -> inv: still a physical home move.
        spliceSIAcrossBoardsPhysical(self, state, uid, originBoard, self.boardId);
        if (drop.type === 'sock') ops.seatSI(state, uid, drop.skey);
        else if (drop.type === 'grid') ops.moveSI(state, uid, drop.anchor);
        else if (drop.type === 'inv') ops.stowSI(state, uid);
      }
      self.gCarry.removeChildren();
      self.gTarget.removeChildren();
      notifyStateChanged();
      return;
    }
    if (drop.type === 'sock') {
      ops.seatSI(state, uid, drop.skey);
    } else if (drop.type === 'grid') {
      ops.moveSI(state, uid, drop.anchor);
    } else if (drop.type === 'inv') {
      ops.stowSI(state, uid);
    }
    self.gCarry.removeChildren();
    self.gTarget.removeChildren();
    notifyStateChanged();
  }

  /** REQ-0033 Phase 2 note: this is now ONLY the inv<->inv (page-to-page)
   * physical home relocation path -- renamed from the pre-REQ-0033
   * `splicePOAcrossBoards` (which used to handle EVERY cross-board
   * crossing, including inv<->canvas) to make that scoping explicit now
   * that inv<->canvas crossings are reference create/remove operations
   * handled directly in commitPODrop via engine.createRef/removeRef, not
   * this splice mechanic at all. Splices a PO record (and any SI seated
   * on it) out of `from`'s container arrays and into `to`'s, WITHOUT yet
   * validating/placing it -- the caller must immediately follow up with
   * `to`'s own movePO-equivalent (which both validates AND sets
   * p.loc/p.cell). This is the PO/SI-level analogue of engine.js's
   * transferBP splice step, applied to inventory-page-to-page moves only
   * (a lone PO/SI crossing PAGES has no BP-shaped "contents" to carry and
   * no shared bounds/overlap precheck to reuse; it is a pure
   * array-membership move, then a normal placement call owns legality
   * exactly as it already does for a same-board move). */
export function splicePOAcrossBoardsPhysical(self: BoardRenderer, state: GameState, uid: string, from: BoardId, to: BoardId): void {
    const { engine } = self.deps;
    const fromContainer = from.loc === 'canvas' ? state : state.inv!.pages[from.page];
    const toContainer = to.loc === 'canvas' ? state : state.inv!.pages[to.page];
    if (fromContainer === toContainer) return;
    const idx = fromContainer.pos.findIndex((p) => p.uid === uid);
    if (idx === -1) return;
    const [p] = fromContainer.pos.splice(idx, 1);
    toContainer.pos.push(p);
    const siIdx: number[] = [];
    fromContainer.sis.forEach((a, i) => {
      if (a.host && typeof a.host === 'object' && 'po' in a.host && (a.host as { po: string }).po === uid) siIdx.push(i);
    });
    for (let i = siIdx.length - 1; i >= 0; i--) {
      const [a] = fromContainer.sis.splice(siIdx[i], 1);
      toContainer.sis.push(a);
    }
    if (to.loc === 'canvas') engine.unseatOrphans(state);
  }

  /** REQ-0033 Phase 2 note: same inv<->inv-only scoping as
   * splicePOAcrossBoardsPhysical above (renamed from the pre-REQ-0033
   * `spliceSIAcrossBoards`) -- inv<->canvas SI crossings are now reference
   * create/remove operations handled directly in commitSIDrop. Splices a
   * lone (not-seated-on-a-PO) SI record across PAGE containers -- same
   * rationale as splicePOAcrossBoardsPhysical, simpler (no dependent SI
   * records of its own to carry). */
export function spliceSIAcrossBoardsPhysical(_self: BoardRenderer, state: GameState, uid: string, from: BoardId, to: BoardId): void {
    const fromContainer = from.loc === 'canvas' ? state : state.inv!.pages[from.page];
    const toContainer = to.loc === 'canvas' ? state : state.inv!.pages[to.page];
    if (fromContainer === toContainer) return;
    const idx = fromContainer.sis.findIndex((a) => a.uid === uid);
    if (idx === -1) return;
    const [a] = fromContainer.sis.splice(idx, 1);
    a.host = 'inv'; // land as unseated; the immediately-following ops.seatSI/moveSI call gives it a real position
    toContainer.sis.push(a);
  }
  /**
   * Cross-board PO legality preview (REQ-0030 Phase 2): temporarily
   * splices PO `uid` (and, transitively, nothing else -- a lone PO has no
   * BP-shaped contents) OUT of its origin container and INTO `this`
   * board's container, runs `self.deps.ops.canPlacePO` (the REAL engine
   * check, never a client reimplementation), then splices it back to
   * origin before returning -- so the probe is side-effect-free from the
   * caller's perspective (no render/notify in between, single synchronous
   * call). This is the only way to preview "would uid fit on a board it
   * is not yet a member of" without a dedicated cross-board engine query
   * (Phase 1 only added one for BPs, since only BP transfer needed to
   * carry contents) while still deferring 100% of the actual legality
   * rule to the engine.
   */
export function previewCrossBoardPO(self: BoardRenderer, state: GameState, uid: string, originBoard: BoardId, rot: number, anchor: Cell): { ok: boolean; cells: Cell[] } {
    // REQ-0033 Phase 2 red-rule guard: an inv -> canvas hover must show
    // illegal/red the instant `uid` is already referenced by the CURRENT
    // squad, REGARDLESS of geometric fit (spec item 2: "CANNOT be placed
    // again into that same squad") -- even an empty cell must read as
    // illegal here, since createRef itself would refuse the reference
    // creation outright on commit. This check is cheap and read-only
    // (engine.usedByCurrent never mutates state), so it is always safe to
    // run first, before falling through to the existing splice/
    // canPlacePO/unsplice geometric preview below -- that geometric path
    // is 100% unchanged and still owns every other legality concern (an
    // inv<->inv preview, i.e. originBoard.loc==='inv' && self.boardId is
    // ALSO 'inv', has no red-rule concept -- that crossing stays a
    // physical move, never a reference -- so the guard is scoped strictly
    // to the inv->canvas direction).
    if (originBoard.loc === 'inv' && self.boardId.loc === 'canvas' && self.deps.engine.usedByCurrent(state, uid)) {
      return { ok: false, cells: [] };
    }
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.pos.findIndex((p) => p.uid === uid);
    if (idx === -1) return { ok: false, cells: [] };
    const [p] = originContainer.pos.splice(idx, 1);
    const savedLoc = p.loc;
    const savedCell = p.cell;
    const container = self.deps.ops.container(state);
    container.pos.push(p);
    let result: { ok: boolean; cells: Cell[] };
    try {
      const chk = self.deps.ops.canPlacePO(state, uid, rot, anchor);
      result = { ok: chk.ok, cells: chk.cells };
    } finally {
      container.pos.splice(container.pos.indexOf(p), 1);
      p.loc = savedLoc;
      p.cell = savedCell;
      originContainer.pos.splice(idx, 0, p);
    }
    return result;
  }

  /** Cross-board SI legality preview -- same splice/check/unsplice
   * technique as previewCrossBoardPO, for a lone (not-seated) SI probing
   * either a socket (via hostOk against a socket already resolved on THIS
   * board) or a free cell (invCanPlaceSI). SI records carry no dependents
   * of their own, so the splice is a single-array move. */
export function previewCrossBoardSIFreeCell(self: BoardRenderer, state: GameState, uid: string, originBoard: BoardId, anchor: Cell): { ok: boolean; cells: Cell[] } {
    // REQ-0033 Phase 2 red-rule guard -- identical rationale to
    // previewCrossBoardPO's guard above: createRef's red-rule check
    // (usedByCurrent) is kind-agnostic, so an SI already referenced by
    // the current squad must show illegal here too, before any
    // geometric free-cell check runs.
    if (originBoard.loc === 'inv' && self.boardId.loc === 'canvas' && self.deps.engine.usedByCurrent(state, uid)) {
      return { ok: false, cells: [] };
    }
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.sis.findIndex((a) => a.uid === uid);
    if (idx === -1) return { ok: false, cells: [] };
    const [a] = originContainer.sis.splice(idx, 1);
    const savedHost = a.host;
    const container = self.deps.ops.container(state);
    container.sis.push(a);
    let result: { ok: boolean; cells: Cell[] };
    try {
      const chk = self.deps.ops.canPlaceSI(state, uid, anchor);
      result = { ok: chk.ok, cells: chk.cells };
    } finally {
      container.sis.splice(container.sis.indexOf(a), 1);
      a.host = savedHost;
      originContainer.sis.splice(idx, 0, a);
    }
    return result;
  }


export function previewCrossBoardSocket(self: BoardRenderer, state: GameState, uid: string, originBoard: BoardId, sock: Socket): { ok: boolean; why?: string } {
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.sis.findIndex((a) => a.uid === uid);
    if (idx === -1) return { ok: false };
    const [a] = originContainer.sis.splice(idx, 1);
    const savedHost = a.host;
    const container = self.deps.ops.container(state);
    container.sis.push(a);
    let result: { ok: boolean; why?: string };
    try {
      result = self.deps.ops.hostOk(state, uid, sock);
    } finally {
      container.sis.splice(container.sis.indexOf(a), 1);
      a.host = savedHost;
      originContainer.sis.splice(idx, 0, a);
    }
    return result;
  }

/** REQ-0288: the ORIGIN cells an aborted carry snaps back to. State was never
 * mutated on a revert path -- the item never left; this only LOCATES it so the
 * revert flash outlines the right cells. Bound to `self`'s own container, so
 * it is correct on canvas and inventory boards alike. */
function carryHomeCells(self: BoardRenderer, c: CarryState): Cell[] {
  const state = self.lastState;
  if (!state) return [];
  const container = self.deps.ops.container(state);
  if (c.kind === 'bp' && c.bpId) {
    const bp = container.bps.find((b) => b.id === c.bpId);
    return bp ? self.deps.engine.bpCells(bp) : [];
  }
  if (c.kind === 'po' || c.kind === 'asm') {
    const p = container.pos.find((z) => z.uid === c.uid);
    return p && p.loc === 'grid' && p.cell ? self.deps.ops.cellsOf(state, p) : [];
  }
  const a = container.sis.find((z) => z.uid === c.uid);
  if (!a || !a.host || typeof a.host !== 'object') return [];
  const host = a.host as { po?: string; cell?: Cell };
  if (host.cell) return [host.cell];
  if (host.po) {
    const hp = container.pos.find((z) => z.uid === host.po);
    return hp && hp.loc === 'grid' && hp.cell ? self.deps.ops.cellsOf(state, hp) : [];
  }
  return [];
}
