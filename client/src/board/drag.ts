// Drag/carry interaction state — REQ-0027 T0.2, extended REQ-0030 Phase 2
// (cross-board drag: canvas <-> inventory tabs, both now real PixiJS
// boards rendered by their own BoardRenderer instance).
//
// Mirrors mock-src/ui.js's module-level `carry` object exactly in shape and
// lifecycle (see ui.js's startCarry/pointermove/pointerup/keydown blocks),
// just relocated to a tiny framework-free pub-sub (same pattern as
// store.ts) instead of a plain closure variable, because here MULTIPLE
// separate consumers need to react to it: the canvas PixiJS board, the
// inventory PixiJS board (a SECOND, independent BoardRenderer instance,
// REQ-0030 Phase 2), and (historically) the React inventory panel -- a
// drag that starts on one board must show its ghost/legality preview on
// WHICHEVER board the pointer currently sits over, and resolve on drop
// against that board specifically. This is ephemeral UI/interaction
// state, not game state -- it never touches `state` in store.ts directly;
// only the pointerup commit calls the engine mutators, which DO mutate
// `state` (via store.ts's notifyStateChanged()).
//
// `carry.kind`: 'po' | 'asm' | 'bp' | 'si' -- same four kinds as the mock.
// `carry.armed`: false until the pointer has moved >5px from the pointerdown
// origin (same threshold as the mock) -- this lets a plain click fall
// through to a separate dblclick-rotate detector instead of always starting
// a drag (see rotate.ts).
//
// REQ-0030 Phase 2 cross-board design: a drag can begin on either board and
// travel over the other. Since each board is its OWN PixiJS Application
// with its OWN <canvas>, `stage.on('globalpointermove')` naturally only
// fires while the pointer is physically over THAT canvas's screen area --
// so at any instant, at most one BoardRenderer's pointermove handler is
// "live", and it alone updates `carry.drop` to a DropTarget tagged with
// ITS OWN board id (see BoardId/DropTarget below). window 'pointerup',
// however, fires regardless of which canvas (if either) the pointer is
// over -- so pointerup handling is centralized HERE (not duplicated per
// BoardRenderer instance) via a tiny board registry: each mounted
// BoardRenderer registers a BoardCommitApi under its own BoardId, and the
// one pointerup listener installed by wireGlobalPointerUp() below looks up
// `carry.drop.board` and delegates the commit to that board's registered
// API -- so exactly one commit call ever happens, never a double-commit
// race between two independently-listening renderers. Dropping outside
// BOTH boards (including on a tab button -- REQ-0030 spec: "dropping on a
// tab button is a no-op") leaves `carry.drop` null/unresolved, so the
// centralized handler simply clears the carry with no engine call, same
// as any other illegal/unresolved drop.
export type CarryKind = 'po' | 'asm' | 'bp' | 'si';

/** Identifies a board: the canvas, or a specific 0-based inventory page.
 * Deliberately the SAME shape as engine.d.ts's LocRef (canTransferBP/
 * transferBP's from/to argument) -- kept as a local structural type (not
 * imported) so this module stays framework/engine-import-free, matching
 * its original design note ("it never touches `state`... directly"). */
export type BoardId = { loc: 'canvas' } | { loc: 'inv'; page: number };

export function boardIdKey(b: BoardId): string {
  return b.loc === 'canvas' ? 'canvas' : `inv:${b.page}`;
}

export function boardIdEquals(a: BoardId, b: BoardId): boolean {
  return boardIdKey(a) === boardIdKey(b);
}

export type DropTarget =
  | { type: 'inv'; board: BoardId } // legacy-shaped "stow" target (kept for SI stow-with-no-cell edge case)
  | { type: 'grid'; anchor: [number, number]; board: BoardId }
  | { type: 'bp'; origin: [number, number]; board: BoardId }
  | { type: 'sock'; skey: string; board: BoardId };

export interface CarryState {
  kind: CarryKind;
  uid: string; // PO uid, or SI uid, or blade uid (for 'asm')
  bpId?: string; // set when kind==='bp'
  /** Board the drag ORIGINATED from (needed to tell a same-board move from
   * a cross-board transfer/move on commit). */
  originBoard: BoardId;
  sx: number; // pointerdown clientX
  sy: number; // pointerdown clientY
  armed: boolean;
  drop: DropTarget | null;
  grabOff: [number, number]; // cell-space offset from anchor/origin to grab point
  // Live pointer position in BOARD-CANVAS-LOCAL pixel space (for ghost
  // rendering) -- updated on every pointermove once armed. Local to
  // whichever board is currently under the pointer (see module note).
  px: number;
  py: number;
}

/** What a mounted board (canvas OR one inventory page) exposes so the
 * centralized pointerup handler can commit a drop against it without this
 * module needing to import engine.js or know mode-specific mutator names
 * itself -- each BoardRenderer instance supplies its own closures over its
 * own engine/state/page-index at registration time (see BoardRenderer's
 * registerAsDropTarget()). */
export interface BoardCommitApi {
  /** Every commit method receives `originBoard` explicitly (NOT read back
   * off getCarry()) -- by the time the centralized pointerup handler below
   * calls into a BoardCommitApi, it has already called takeCarry(), which
   * clears the module-level carry to null (so a nested getCarry() call
   * from inside a commit method would see null). Passing it as a plain
   * argument avoids that footgun entirely. */
  commitPO(uid: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void;
  commitAsm(originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void;
  commitBP(bpId: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'bp' }>): void;
  commitSI(uid: string, originBoard: BoardId, drop: DropTarget): void;
}

let carry: CarryState | null = null;
const listeners = new Set<() => void>();
const boardRegistry = new Map<string, BoardCommitApi>();

export function getCarry(): CarryState | null {
  return carry;
}

export function subscribeCarry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/** Starts a new carry. No-op if a carry is already active (matches the
 * mock's `if(carry||!kind)return;`) or a bare uid wasn't supplied. */
export function startCarry(init: Omit<CarryState, 'armed' | 'drop' | 'px' | 'py'>): void {
  if (carry) return;
  carry = { ...init, armed: false, drop: null, px: init.sx, py: init.sy };
  notify();
}

/** Arms the current carry (past the 5px move threshold) -- one-shot. */
export function armCarry(): void {
  if (!carry || carry.armed) return;
  carry.armed = true;
  notify();
}

/** Updates live pointer position + drop target during an armed drag. */
export function updateCarry(px: number, py: number, drop: DropTarget | null): void {
  if (!carry) return;
  carry.px = px;
  carry.py = py;
  carry.drop = drop;
  notify();
}

/** Clears the carry with NO engine call (Esc-cancel, or a plain
 * click that never armed). */
export function cancelCarry(): void {
  if (!carry) return;
  carry = null;
  notify();
}

/** Reads-and-clears the carry (used by pointerup to commit, so the caller
 * gets the final drop target before the module forgets it). */
export function takeCarry(): CarryState | null {
  const c = carry;
  carry = null;
  if (c) notify();
  return c;
}

// ---------------------------------------------------------------------
// Board registry + centralized pointerup commit (REQ-0030 Phase 2).
// ---------------------------------------------------------------------

/** Registers (or replaces) a board's commit API. Called by BoardRenderer
 * on mount; returns an unregister function for use on unmount/destroy. */
export function registerBoard(id: BoardId, api: BoardCommitApi): () => void {
  const k = boardIdKey(id);
  boardRegistry.set(k, api);
  return () => {
    if (boardRegistry.get(k) === api) boardRegistry.delete(k);
  };
}

let pointerUpWired = false;

/** Installs the SINGLE window-level pointerup listener that commits any
 * active armed carry against whichever board its final `drop` targets
 * (looked up in boardRegistry). Idempotent -- safe to call from every
 * BoardRenderer's constructor; only the first call actually attaches the
 * listener. There is intentionally no matching "uninstall" (the listener
 * has no per-board state of its own -- it only reads the module-level
 * `carry` + `boardRegistry` at the moment of a real pointerup -- so it can
 * safely outlive any single board's mount/unmount cycle). */
export function ensurePointerUpWired(): void {
  if (pointerUpWired) return;
  pointerUpWired = true;
  window.addEventListener('pointerup', () => {
    const c = takeCarry();
    if (!c || !c.armed) return; // plain click: no engine call (dblclick-rotate owns that path)
    const drop = c.drop;
    if (!drop) return; // unresolved drop (outside both boards, or on a tab button): no-op, matches spec
    const api = boardRegistry.get(boardIdKey(drop.board));
    if (!api) return;
    if (c.kind === 'po') {
      if (drop.type === 'grid' || drop.type === 'inv') api.commitPO(c.uid, c.originBoard, drop);
    } else if (c.kind === 'asm') {
      if (drop.type === 'grid' || drop.type === 'inv') api.commitAsm(c.originBoard, drop);
    } else if (c.kind === 'bp' && c.bpId) {
      if (drop.type === 'bp') api.commitBP(c.bpId, c.originBoard, drop);
    } else if (c.kind === 'si') {
      api.commitSI(c.uid, c.originBoard, drop);
    }
  });
}
