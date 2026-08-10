// PixiJS board renderer — REQ-0026 T0.1 (read-only), extended REQ-0027 T0.2
// with edit interactions (drag/drop, rotate, BP move, SI seat/unseat),
// extended REQ-0030 Phase 2 to be a SHARED renderer for both the canvas
// board and any inventory-page board (5 tabs) rather than a canvas-only
// class. Framework-free (no React here); layout constants (CELL/PAD) and
// the overall composition mirror mock-src/ui.js's SVG renderAll() for
// visual parity (same reference, not pixel-exact): grid cells tinted by BP
// (canvas only -- see REQ-0030 note below), BP outlines + name/HP label,
// unit cores + direction dots (canvas: full; inventory: dimmed core, no
// dots/beams), beams (canvas only), placed PO art, port target ◇ marks
// (canvas only), established-connection ◆ marks (canvas only), sockets
// (empty + seated SI), and the chain-link toggle button (canvas only).
//
// REQ-0027 T0.2 interaction model (see also board/drag.ts, board/rotate.ts):
// pointer events only (no HTML5 dragstart/dragover/drop), matching both the
// mock (mock-src/ui.js uses pointerdown/pointermove/pointerup throughout)
// and PixiJS's own event system (FederatedPointerEvent, eventMode='static').
// Each interactive Pixi object gets a 'pointerdown' listener that calls
// startCarry() (drag.ts); the STAGE gets a 'globalpointermove' listener
// (fires regardless of which object is under the pointer, so a fast drag
// off an object's bounds is never dropped) that arms the drag past a 5px
// threshold, computes the target cell, runs the SAME engine legality
// queries the mock uses (canPlacePO/canPlaceAssembly/canMoveBP/hostOk), and
// paints green/red target-cell tints + a ghost sprite following the
// pointer. `window`'s 'pointerup' commits the drag via the matching engine
// mutator (movePO/moveAssembly/moveBP/seatSI/stowSI) -- listening on
// `window` (not the canvas) mirrors the mock's own
// `window.addEventListener('pointerup', ...)`, so a pointerup outside the
// canvas bounds still resolves the drag. `window`'s 'keydown' handles Esc
// (abort carry, no engine call) the same way.
//
// REQ-0030 Phase 2 generalization: this class no longer talks to
// shared/engine.js's canvas-only functions directly for legality/
// mutation -- it goes through a BoardOps instance (see board/boardOps.ts),
// which is either canvas ops (engine.canPlacePO/movePO/... bound to the
// top-level GameState) or inventory-page ops (engine.invCanPlacePO/
// invMovePO/... bound to one page index). Two BoardRenderer instances are
// mounted simultaneously by the React layer (Board.tsx for canvas,
// InventoryBoard.tsx for the active tab's page) -- see drag.ts's module
// comment for how a drag crossing between the two independently-mounted
// PixiJS canvases is resolved (board registry + centralized pointerup
// commit, since `globalpointermove` is scoped per-canvas but `pointerup`
// on `window` is not). Purely-canvas concepts (assembly/bond socket,
// beams, combos, port ◇/◆ marks, the chain-link toggle, BP color grid
// tint) are gated behind `this.ops.isCanvas` below -- REQ-0030 spec: the
// inventory board is a "placement-only world" (no effects/connections/
// combos/beams; a BP's unit is rendered but DORMANT -- dimmed, no beams,
// no direction dots).
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Assembly, Cell, EngineInstance, GameState, ItemDefMap, Layout, PO, SIDefMap, Socket } from '../engine/engine.d.ts';
import {
  armCarry,
  boardIdEquals,
  boardIdKey,
  cancelCarry,
  cancelCarryWithFeedback,
  ensurePointerUpWired,
  getCarry,
  registerBoard,
  startCarry,
  subscribeCarry,
  updateCarry,
  type BoardId,
  type CarryKind,
  type CarryState,
  type DropTarget,
} from './drag';
import type { BoardOps } from './boardOps';
import { BEAM_DIM_ALPHA, BEAM_HOVER_SLOP, CELL, DBLCLICK_WINDOW_MS, DIR_ANGLES, DRAG_ARM_THRESHOLD, INV_UNIT_ALPHA, PAD, SOCKET_SEARCH_RADIUS, SOCK_GLYPH, UNIT_CORE_RADIUS, arrowHead, cellAt, clientToLocal, cx, cy, fitSpriteToBox, localBoxToClient, pointSegDistance, socketScreenPos } from './geom';
import { makeCommitApi, previewCrossBoardPO, previewCrossBoardSIFreeCell, previewCrossBoardSocket } from './commits';
import { activeUnitSkinKey, defaultSkinId, pickedSkinId, resolveUnitIcon, unitIconKey } from './unitIcon';
// REQ-0266 (item 23): the bag's OWN skin. The 5-rung chain and the def registry
// are pure and Node-testable (client/scripts/check_bpskin.mjs drives them); the
// PixiJS bridge -- raster decode, composite cache, positioned Sprite -- lives in
// skin/bpSkinTexture.ts, because none of that is renderer logic and this file is
// hot. See that module's header for the async-decode contract.
import { resolveBpSkin } from './skin/bpSkinResolve';
import { bpSkinDefs, hasBpSkin } from './skin/skinRegistry';
import { bpSkinSprite } from './skin/bpSkinTexture';
import { itemTex } from './itemArt'; // REQ-0133 registry-first chain; itemTex lives there since REQ-0288 (ghosts share it)
import { drawChargeRing } from './chargeRing';
import { drawPOOutline } from './poOutline'; // REQ-0273: per-PO footprint outlines
import { OVERLAY } from './overlayPalette'; // REQ-0143: colourblind-safe overlay palette (single source, BS-G1)
import { paintUsageRibbons, cellsBBoxPx, topRightCellBBoxPx, topLeftCellBBoxPx } from './usageRibbons'; // REQ-0287
import { publishRibbonProbe, type UsageRibbonProbeEntry } from './usageRibbonProbe'; // REQ-0287
import { publishCursorProbe, type CursorProbeEntry } from './cursorProbe'; // REQ-0290
import { countPaint } from './paintProbe'; // REQ-0345
import { flash, paintNeutralReturn, pulseCellsSuccess, renderGhostAssembly, renderGhostBP, renderGhostPO } from './ghosts';
import { armUndoFrom, captureUndoState, clearUndo, notifyStateChanged } from '../store';
import { clearItemTip, clearItemTipForBoard, showItemTip } from './itemTip';
// REQ-0142 (link-trace diagnostics): beam hover is ephemeral INTERACTION
// state (board/beamHover.ts, the same pub-sub shape as itemTip/carry), and
// the trace itself is a READ-ONLY query over the engine (board/linkTrace.ts).
// Neither touches game state -- hovering a beam can never mutate a board.
import { clearBeamHoverForBoard, getBeamHover, setBeamHover, subscribeBeamHover } from './beamHover';
import { traceUnit } from './linkTrace';

// REQ-0133: registry-first item texture. Resolves a cell's texture through
// resolveItemIcon (item:<id> registry raster -> SVG sprite symbol -> nothing)
// over the SHARED texture map -- the exact machinery the Unit cell uses. A
// registry raster that 404'd / failed to decode is simply absent from the map,
// so has() says no and the chain falls through to the sprite symbol; missing art
// never blocks a draw. Contain-fit / aspect handling is unchanged at every call
// site (fitSpriteToBox), so a non-square item raster is fitted, never stretched.
// (itemTex moved to board/itemArt.ts -- REQ-0288: the ghosts must resolve through the same chain.)

/** REQ-0345: count every frame this Application submits, at the one seam both
 * producers share -- see paintProbe.ts for why the obvious lower-level
 * instrument (a patched WebGL context) was abandoned. Wraps the renderer INSTANCE's own `render`
 * (Application.render() resolves `this.renderer` per call, so the Ticker's
 * captured method reference still lands here), and must run AFTER app.init()
 * -- `app.renderer` does not exist before that. */
function countFrames(app: Application, boardKey: string): void {
  const target = app.renderer as unknown as { render: (opts: unknown) => void };
  const submit = target.render.bind(app.renderer);
  target.render = (opts: unknown) => {
    countPaint(boardKey);
    submit(opts);
  };
}

export interface BoardDeps {
  engine: EngineInstance;
  items: ItemDefMap;
  siDefs: SIDefMap;
  textures: Map<string, Texture>;
  layout: Layout;
  /** Per-board engine-call surface (REQ-0030 Phase 2) -- canvas ops or one
   * inventory page's ops. See board/boardOps.ts. */
  ops: BoardOps;
}

/**
 * Rotates+maps a point (x,y) in a PO's UNROTATED bbox (W0 x H0) into the
 * bbox's ROTATED frame -- exact port of mock-src/ui.js's `mapPt(k,x,y,W0,H0)`
 * (used there for socket anchor positioning). k is the rotation step
 * (0..3, 90° CW each). Kept as a free function (not engine logic -- this is
 * pure display-geometry, same category as cx()/cy()/DIR_ANGLES above).
 */
/** REQ-0142: a dashed segment (Pixi v8's Graphics has no native dash). Used
 * for the "the beam died here" ghost: from the Unit that took the first hit
 * to each Unit standing behind it, which therefore never hears the beam. */
function drawDashedSegment(parent: Container, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const DASH = 9;
  const GAP = 7;
  const g = new Graphics();
  for (let t = UNIT_CORE_RADIUS; t < len - UNIT_CORE_RADIUS; t += DASH + GAP) {
    const e = Math.min(t + DASH, len - UNIT_CORE_RADIUS);
    g.moveTo(x0 + ux * t, y0 + uy * t).lineTo(x0 + ux * e, y0 + uy * e);
  }
  g.stroke({ color, width: 2, alpha: 0.6 });
  g.eventMode = 'none'; // decorative, see BoardRenderer's constructor note
  parent.addChild(g);
}


// REQ-0336: per-item draw isolation. The loops below walk rows that came out of
// a SAVED PROFILE -- data whose shape this renderer does not control and cannot
// fully enumerate (REQ-0284's unit-less BP is the proof: `BP.unit` is typed
// non-optional in shared/engine.d.ts, and real stored canvases omit it anyway).
// Before this, ONE malformed row threw out of render() and, with no error
// boundary over the boards, tore down the React root -- a blank app, which the
// owner has reported repeatedly as "the freeze".
//
// This is the loop-level form of a rule the codebase already applies case by
// case: REQ-0170's unit-less-BP branch says "draw the bag and skip the unit --
// a degraded board beats a blank one", and REQ-0273 v4's poisoned-save handling
// says "degraded render beats data loss". Those are per-KNOWN-case guards; this
// makes it the invariant. An item that cannot be drawn is not drawn, is logged
// once WITH ITS ID, and every other item on the board still renders.
//
// Deliberately not a silent catch: the console.warn keeps a real data bug
// findable, and client/e2e/board-poisoned.spec.ts asserts the survivors stay
// interactive -- the coverage REQ-0284's post-mortem named as missing ("every
// fixture squad seated a Unit on EVERY BP", so no malformed shape was ever
// exercised by e2e).
function drawGuarded(what: string, id: string | undefined, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[backpack_ragnarok] BoardRenderer: skipping unrenderable ' + what +
      (id ? ' ' + id : '') + ' -- the rest of the board is unaffected', e);
  }
}

export class BoardRenderer {
  app: Application;
  root = new Container();
  gBase = new Container();
  // REQ-0266 (item 23): BP skin composites, plus the BP's own usage tint that
  // must read OVER them. ABOVE gBase (the grid the skin dresses) and BELOW
  // gBeams -- so beams, PO art, move-handle badges, sockets and unit cores every
  // one of them still draw ON TOP of the bag, and a skin can never come between
  // the player and the BP drag handle (those handles live in gBase and stay
  // hit-testable precisely because this whole layer is pruned from hit-testing).
  // Purely decorative: the layer is eventMode 'none' (constructor, below) and so
  // is every child added to it.
  // A composite lands here ONLY for a skin with real, decoded art -- see the
  // draw site's guard note; an art-less def would paint an opaque body over the
  // per-BP colour tint in gBase and is not drawn at all.
  gSkins = new Container();
  gBeams = new Container();
  gItems = new Container();
  gSock = new Container();
  gUnits = new Container();
  gChain = new Container();
  gTarget = new Container();
  /** REQ-0346: the claim pulse's OWN layer -- the one board layer that
   * render(state) does NOT clear.
   *
   * ghosts.ts pulseCellsSuccess() used to draw into gTarget, and so never
   * reached the screen once in its life. Both of its call sites
   * (useWarehouseData.ts's handleClaim, WorkshopPage.tsx's roll) call
   * notifyStateChanged() on the very next line; that re-enters render(state),
   * whose first act is gTarget.removeChildren(). The blink was destroyed in
   * the same frame it was created -- measured through the real warehouse-claim
   * flow at 0 pixels of its #59d68a across the whole 2s window, identically
   * with REQ-0345's frame loop off and with the old Ticker put back.
   *
   * The fix is a LAYER, not a reordering, because that keeps render(state) the
   * SINGLE authority over gTarget (REQ-0346's stated preference): the pulse is
   * a timer-owned overlay with a lifetime of its own, independent of any game
   * state, so it gets a container of its own rather than borrowing one whose
   * contents are a pure function of the state. Delaying the callback instead
   * would have made a product callback's ordering load-bearing for a visual --
   * the same class of invisible coupling that hid this bug in the first place.
   *
   * NOTHING may ever add this container to render(state)'s removeChildren()
   * list -- a state-driven repaint mid-pulse must leave the blink standing.
   * Its children are removed by exactly two things: the pulse's own final
   * rect.destroy() (Pixi v8 detaches a destroyed child from its parent), and
   * setOps()'s explicit sweep when this board changes identity out from under
   * an in-flight pulse.
   *
   * Above gTarget (a claim cue must read OVER a drop-target tint) and below
   * gCarry (a drag ghost still owns the topmost pixel). Purely decorative:
   * eventMode 'none', set in the constructor alongside its neighbours. */
  gPulse = new Container();
  gCarry = new Container();
  // REQ-0042: BP move-handle badge layer -- MUST render above gItems
  // (PO art), which is the whole point of the handle (grab a BP even
  // when every one of its cells is covered by placed POs, which leaves
  // no empty cell for the existing empty-cell-grab-handle mechanism
  // above to use). Positioned right after gItems/before gSock so the
  // badge sits below socket/unit glyphs but still clearly above PO
  // art -- see the constructor's addChild order below.
  gBadges = new Container();
  deps: BoardDeps;
  disposed = false;
  lastState: GameState | null = null;
  unsubscribeCarry: (() => void) | null = null;
  unregisterBoard: (() => void) | null = null;
  // Manual double-click bookkeeping (see DBLCLICK_WINDOW_MS above): last
  // pointerdown timestamp per uid, cleared once consumed or expired.
  lastPointerDown = new Map<string, number>();
  lastBPPointerDown = new Map<string, number>(); // REQ-0045 (a2): BP dblclick-rotate tracking, kept separate from PO's own map (see this field's sibling doc).
  flashTimers = new Set<ReturnType<typeof setTimeout>>();
  /** REQ-0345: the one in-flight requestAnimationFrame handle held by
   * requestRender(), or null when this board has nothing to paint. It is
   * null the overwhelming majority of the time -- that is the whole point:
   * an untouched board schedules nothing at all. */
  pendingPaint: number | null = null;
  // REQ-0142: link-trace hover subscription (redraw when the interrogated
  // Unit/beam changes -- hover lives outside the game store by design, so
  // nothing else would ever tell this board to repaint).
  unsubscribeHover: (() => void) | null = null;
  /** REQ-0142: every beam drawn by the last render(), in board-LOCAL pixel
   * space, so the pointermove hover hit-test can ask "is the pointer on a
   * beam?" against the beams that are ACTUALLY on screen rather than
   * re-deriving their geometry (and drifting from it). Canvas board only --
   * an inventory board draws no beams (Unit dormancy), so it stays empty. */
  // REQ-0170: `dir` is null on an OFFSET-shape link (a knight jump has no compass
  // direction). beamHover's own DirTrace already types dir as `number | null`, so
  // the hover/highlight path needs no change -- it simply never matches a null dir
  // against a traced direction, which is correct: there is no direction to trace.
  beamSegs: { from: string; dir: number | null; x0: number; y0: number; x1: number; y1: number }[] = [];
  /** REQ-0288: honest e2e seam -- what the LAST ghost pass on this board drew
   * (null when no armed carry has hovered it / the pointer left it). Exposed
   * via window.__backpackBoardProbes[boardIdKey(this.boardId)]. */
  ghostProbe: { kind: CarryKind; cells: Cell[]; hasArt: boolean; legal: boolean } | null = null;
  /** REQ-0288: how many revert ("snapped home") cues this board has fired. */
  revertCount = 0;
  /** REQ-0288: the BP id the LAST render() resolved as airborne (null when
   * nothing is being carried off this board). The lift shadow was originally
   * evidenced by screenshot alone, and a screenshot gate stays green while
   * the behaviour it depicts quietly stops happening -- which is precisely
   * what the 559-commit master merge did to it. This is the structural seam
   * that makes the lift assertable. */
  liftProbe: string | null = null;
  /** REQ-0288: has THIS board already repainted for the current carry's arm?
   * One-shot per carry (cleared when the carry ends). See onGlobalPointerMove's
   * arm block for why the repaint cannot live inside the `!carry.armed` branch. */
  private armRendered = false;
  /** REQ-0287: every ownership ribbon drawn by the last render(), for the
   * e2e probe seam (published to usageRibbonProbe.ts / __backpackDebug). */
  usageRibbonProbe: UsageRibbonProbeEntry[] = [];
  /** REQ-0290: the cursor assigned to every interactive object drawn by the
   * last render(), for the e2e probe seam (published to cursorProbe.ts /
   * __backpackDebug). See cursorProbe.ts for why the assignment is recorded
   * rather than read back off the canvas element. */
  cursorProbe: CursorProbeEntry[] = [];

  private constructor(app: Application, deps: BoardDeps) {
    this.app = app;
    this.deps = deps;
    this.root.addChild(
      this.gBase,
      this.gSkins, // REQ-0266: above the grid, below items -- see field comment
      this.gBeams,
      this.gItems,
      this.gBadges, // REQ-0042: above gItems (PO art), see field comment
      this.gSock,
      this.gUnits,
      this.gChain,
      this.gTarget,
      this.gPulse, // REQ-0346: above the drop tint, below the drag ghost -- see field comment
      this.gCarry
    );
    // PixiJS v8 hit-testing note (REQ-0027 T0.2 interaction bug fix): once
    // ANY ancestor in the scene graph has eventMode 'static'/'dynamic'
    // (the stage does, below), EventBoundary's hitTestRecursive() treats
    // that interactive mode as inherited by every descendant during
    // recursion -- a purely-decorative child (default eventMode 'passive',
    // never explicitly set) still gets hitTestFn() run against it and,
    // if its bounds contain the point, yields a match. That match is an
    // EMPTY array (since the decorative node itself is not
    // isInteractive()), but an empty array is still truthy in JS, so it
    // stops sibling iteration (which runs LAST-ADDED-FIRST) dead in its
    // tracks -- a decorative Sprite/Graphics added AFTER a sibling `hit`
    // target (e.g. a PO's art on top of its own hit rect) silently
    // swallows the pointer event before the real interactive sibling is
    // ever tested. This is what made every dblclick/drag on this board
    // resolve to the stage/root Container instead of the intended PO/BP/
    // SI target. Fix: explicitly mark every purely-decorative node
    // eventMode='none' (NOT the default 'passive') so
    // EventBoundary._interactivePrune() excludes it -- and its subtree --
    // from hit-testing entirely, regardless of add-order. gBeams (beam
    // lines/arrowheads/dud marks), gSkins (REQ-0266 BP skin composites),
    // gTarget (drop-target tint/rings, reject-flash), gPulse (REQ-0346
    // claim pulse), and gCarry (drag ghost sprites) never host a listener
    // anywhere in this file, so the whole group is marked here;
    // gBase/gItems/gSock/gUnits mix interactive hit objects with
    // decorative art and are annotated per-node at each creation site
    // below instead.
    this.gBeams.eventMode = 'none';
    this.gSkins.eventMode = 'none'; // REQ-0266
    this.gTarget.eventMode = 'none';
    this.gPulse.eventMode = 'none'; // REQ-0346
    this.gCarry.eventMode = 'none';
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.wireGlobalInteraction();
    // REQ-0288: e2e probe registry -- same rationale as boot.ts's
    // __backpackDebug (specs assert structured seams, never canvas pixels).
    const pw = window as unknown as { __backpackBoardProbes?: Record<string, () => unknown> };
    pw.__backpackBoardProbes = pw.__backpackBoardProbes || {};
    pw.__backpackBoardProbes[boardIdKey(this.boardId)] = () => ({ ghost: this.ghostProbe, reverts: this.revertCount, lift: this.liftProbe });
  }

  static async mount(canvas: HTMLCanvasElement, deps: BoardDeps): Promise<BoardRenderer> {
    const app = new Application();
    const width = PAD * 2 + deps.layout.COLS * CELL;
    const height = PAD * 2 + deps.layout.ROWS * CELL;
    // REQ-0070 (MJOLNIR re-skin): transparent canvas backdrop -- the DOM
    // board stage's radial night-iron gradient (index.css .board-wrap)
    // shows through the PAD margin and between draws, exactly like the
    // mock's .board-stage. Init-option-only change: same ONE Application
    // per board forever; nothing about the scene graph or events differs.
    // (Cells/items keep painting their own opaque fills on top, so board
    // content renders identically to the old flat #121212 backdrop.)
    // REQ-0345 -- autoStart:false. PixiJS's TickerPlugin otherwise defaults
    // autoStart to true (pixi.js 8.19.0 lib/app/TickerPlugin.mjs:14), adds
    // Application.render at UPDATE_PRIORITY.LOW (:28) and starts the Ticker
    // (:40), so EVERY mounted board re-rendered its whole scene ~60 times a
    // second, forever. This board has no continuous animation (see render()'s
    // tail comment, which said so long before anything acted on it) and
    // App.tsx keeps BOTH boards mounted on every route -- a route switch only
    // adds .route-hidden (display:none), which does not stop a Ticker -- so
    // that was two full WebGL scenes per frame on screens with no board at
    // all. Measured on the e2e box before this change: 41.2 frames/s per
    // board on #/backpacks and 59.7 frames/s per board on #/dex, where both
    // boards are display:none. After: 0.
    //
    // With autoStart:false the Ticker is created and Application.render is
    // still registered on it, but Ticker.autoStart defaults to false and
    // Ticker.add -> _startIfPossible() therefore requests no animation frame
    // (lib/ticker/Ticker.mjs:30,160-165), so nothing schedules anything.
    // Everything that must reach the screen now says so: render(state) paints
    // synchronously, and every mutation outside it calls requestRender().
    await app.init({ canvas, width, height, backgroundAlpha: 0, antialias: true, autoStart: false });
    countFrames(app, boardIdKey(deps.ops.boardId));
    return new BoardRenderer(app, deps);
  }

  /** This board's identity (canvas, or a specific inventory page) --
   * exposed so the React wrapper can register this instance's canvas DOM
   * element in the cross-board hit-test registry under the same id. */
  get boardId(): BoardId {
    return this.deps.ops.boardId;
  }

  /**
   * Re-points this ALREADY-MOUNTED renderer at a different BoardOps
   * (REQ-0031 Phase A bug fix -- "tab-switch freeze"). Replaces the old
   * remount-a-whole-new-PixiJS-Application-per-tab-click pattern (see
   * InventoryBoard.tsx's prior module comment, now superseded): destroying
   * a PixiJS Application calls GlContextSystem.destroy(), which releases
   * the WebGL context via the WEBGL_lose_context extension's
   * loseContext() -- per the WebGL spec this is ASYNCHRONOUS (the actual
   * `webglcontextlost` event and the browser/GPU-process's reclamation of
   * the context both fire on a later task, not synchronously when
   * loseContext() returns). InventoryBoard.tsx's old effect called
   * destroy() in its cleanup and then, in the SAME effect-flush, ran a
   * brand new BoardRenderer.mount() (a new Application + a new
   * canvas.getContext('webgl2', ...) call on the SAME <canvas> element)
   * before the browser had actually finished tearing down the old
   * context. Under this box's software GL path (swiftshader -- no real
   * GPU in this headless server environment), that race left the driver
   * in a state where every subsequent shader compile failed, which sent
   * PixiJS's GlLimitsSystem.contextChange() -> checkMaxIfStatementsInShader()
   * (rendering/batcher/gl/utils/checkMaxIfStatementsInShader.mjs) into its
   * `while(true){ compile; if(!ok) maxIfs=maxIfs/2|0; else break; }` loop
   * FOREVER (confirmed live via a CDP Debugger.pause taken mid-hang,
   * repeatedly landing on that exact frame; renderer process CPU pegged
   * at ~100% and climbing, page fully unresponsive for 16+ seconds and
   * still not recovered when observation stopped) -- a real infinite
   * busy-loop, not merely a slow stall.
   *
   * The fix: never destroy/recreate the Application or its <canvas>/WebGL
   * context for a tab switch at all. This board stays mounted for the
   * InventoryBoard component's entire lifetime; only its BoardOps (which
   * page's engine calls to use) changes. Because `ops.boardId` changes
   * too (canvas vs. a specific inventory page id), the drag.ts board
   * registry entry must be re-keyed: unregister the OLD boardId, swap
   * `this.deps.ops`, register the NEW boardId. Any in-flight carry/ghost/
   * target-tint visuals are cleared (a carry that started against the
   * OLD page's ops is meaningless once the ops swap -- same as if the
   * user had pressed Esc); the caller is responsible for calling
   * render(state) immediately after to redraw against the new ops.
   */
  setOps(ops: BoardOps): void {
    if (this.disposed) return;
    this.unregisterBoard?.();
    this.deps = { ...this.deps, ops };
    this.unregisterBoard = registerBoard(this.boardId, makeCommitApi(this));
    // A carry armed against the previous page's ops (e.g. mid-drag when
    // the page changed -- not expected via the Tabs UI per its own
    // module comment, but defensive regardless) is no longer meaningful
    // once this board's identity/ops change out from under it.
    cancelCarry();
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    // REQ-0346: an in-flight claim pulse names CELLS on the page that received
    // the item. Once this board points at different ops it is drawing a
    // different page, so those same cells now mean something else and the blink
    // would be highlighting the wrong squares. Sweep it for the same reason the
    // carry above is cancelled. Its blink timers keep running against detached
    // (then destroyed) Graphics, which is harmless -- destroy() is idempotent.
    this.gPulse.removeChildren();
    // REQ-0345: the caller is still expected to render(state) right after
    // (InventoryBoard.tsx's ops-swap effect does), but that is an unenforced
    // contract and the Ticker used to cover for it within one frame. Ask for
    // the repaint here too so a caller that forgets leaves a stale ghost on
    // screen for at most a frame instead of until the next state change; the
    // request is dropped for free if render(state) paints first.
    this.requestRender();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.flashTimers) clearTimeout(t);
    this.flashTimers.clear();
    this.unsubscribeCarry?.();
    this.unsubscribeHover?.();
    this.unregisterBoard?.();
    window.removeEventListener('keydown', this.onWindowKeyDown);
    // REQ-0142: drop any beam hover anchored to THIS board before its canvas
    // detaches -- same staleness hazard (and same fix) as the item tip below.
    this.app.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.app.canvas.removeEventListener('pointerleave', this.onCanvasPointerLeave);
    clearBeamHoverForBoard(boardIdKey(this.boardId));
    // REQ-0119: drop any floating tip anchored to THIS board before its
    // canvas detaches (a stale anchor would point at a gone element).
    clearItemTipForBoard(boardIdKey(this.boardId));
    this.app.stage.off('pointerup', this.onStagePointerUp);
    // REQ-0345: a frame requested moments before teardown would otherwise fire
    // against a destroyed renderer.
    if (this.pendingPaint !== null) {
      cancelAnimationFrame(this.pendingPaint);
      this.pendingPaint = null;
    }
    this.app.destroy(true, { children: true });
  }

  /** REQ-0345: submit the CURRENT scene graph, synchronously. The one paint
   * seam -- render(state) and the coalesced requestRender() below both end
   * here, and mount()'s countFrames wrapper counts what actually leaves. */
  paintNow(): void {
    if (this.disposed) return;
    // A frame already requested for this scene is now redundant.
    if (this.pendingPaint !== null) {
      cancelAnimationFrame(this.pendingPaint);
      this.pendingPaint = null;
    }
    this.app.renderer.render({ container: this.app.stage });
  }

  /** REQ-0345: ask for ONE paint on the next animation frame, coalescing every
   * request made in the same frame into it.
   *
   * This is what replaces the Ticker for the mutations that happen OUTSIDE
   * render(state) and never called render() themselves -- which is why the
   * always-on Ticker was NOT redundant and could not simply be deleted:
   *   - the drag ghost + drop-target tint (onGlobalPointerMove, and the carry
   *     subscription that clears them when a drag ends anywhere),
   *   - the reject flash (ghosts.ts flash(), a 350ms red outline whose
   *     setTimeout destroys the Graphics), and
   *   - the claim pulse (ghosts.ts pulseCellsSuccess(), ~2s of blinks whose
   *     setTimeout toggles rect.visible).
   * All three mutate the scene graph and would have gone silently invisible
   * the moment the frame loop stopped.
   *
   * rAF, not a loop: exactly one frame is requested per burst and nothing is
   * scheduled once the burst is done, so an idle board costs zero. A
   * pointermove storm collapses to one paint per displayed frame -- which is
   * the most a permanent Ticker could ever have achieved either. */
  requestRender(): void {
    if (this.disposed || this.pendingPaint !== null) return;
    this.pendingPaint = requestAnimationFrame(() => {
      this.pendingPaint = null;
      this.paintNow();
    });
  }

  render(state: GameState): void {
    this.lastState = state;
    const { engine, items, textures, layout, ops } = this.deps;
    this.gBase.removeChildren();
    this.gSkins.removeChildren(); // REQ-0266
    this.gBeams.removeChildren();
    this.gItems.removeChildren();
    this.gBadges.removeChildren(); // REQ-0042
    this.gSock.removeChildren();
    this.gUnits.removeChildren();
    this.gChain.removeChildren();
    this.gTarget.removeChildren();
    // REQ-0346: gPulse is DELIBERATELY absent from this list, and must stay
    // absent. It exists precisely so that this method -- which BOTH claim-pulse
    // call sites re-enter on the very next line via notifyStateChanged() --
    // cannot destroy the blink it was just asked to show. See that field's own
    // comment for the measurement that made it a separate layer.

    const container = ops.container(state);
    const cbp = ops.cellBPMap(state);
    const bpById = (id: string) => container.bps.find((b) => b.id === id)!;

    // REQ-0033 Phase 2: red/yellow usage-tint overlays (spec items 2-3).
    // Recomputed FRESH on every render() call (never cached) -- per
    // engine.js's own perf note on tintSets(), a full scan at this game's
    // scale (SQUAD_COUNT squads x a few dozen items) is comfortably
    // sub-millisecond, so there is no correctness/perf reason to memoize
    // this across renders; recomputing here guarantees it is always
    // correct after every state mutation AND every squad switch, with no
    // separate invalidation bookkeeping to get wrong.
    //   INVENTORY board: tint.red (used by the CURRENT squad) and
    //     tint.yellow (used by at least one OTHER squad) both apply --
    //     red takes visual precedence when a uid is in both sets (spec's
    //     red-vs-yellow framing puts "already used here" first).
    //   CANVAS board: only tint.canvasYellow applies (uids on the canvas
    //     right now that are ALSO shared with another squad) -- canvas
    //     never shows red, since every canvas item is by definition used
    //     by the current squad already (that's not useful information to
    //     highlight on the canvas itself).
    // Color choice (documented here once, reused by every draw site
    // below): selfSquad=vermillion, otherSquad=yellow (REQ-0143 CVD-safe) --
    // chosen to read clearly as a translucent wash against this app's
    // dark (#121212 background / #191919 grid cell) theme without
    // fighting the BP-color grid tint (alpha 0.26) or an item's own dark
    // backdrop (alpha 0.22) already drawn at similar alpha levels nearby.
    const tint = engine.tintSets(state);
    this.usageRibbonProbe = []; // REQ-0287: rebuilt fresh per render (probe seam)
    this.cursorProbe = []; // REQ-0290: same per-render discipline (probe seam)
    // REQ-0143: colourblind-safe usage wash from the central overlay palette
    // (was red 0xff3b3b / yellow 0xffd23b -- two warm hues that collapse under
    // deuteranopia). selfSquad=vermillion, otherSquad=blue: a blue/warm split
    // proven separable under all three CVD sims by overlay_a11y_harness.
    const TINT_RED = OVERLAY.usage.selfSquad.color;
    const TINT_YELLOW = OVERLAY.usage.otherSquad.color;
    const TINT_ALPHA = OVERLAY.usage.selfSquad.alpha;
    /** Draws a translucent tint wash over exactly `cells` (not a bounding
     * box -- correct for L-shapes/shapes-with-holes alike, matching every
     * other per-cell drawing loop in this file) into `layer`, colored red
     * if `uid` is in the CURRENT squad's usage set, else yellow if it is
     * in the shared/other-squads set, else nothing. `redSet`/`yellowSet`
     * are passed explicitly (rather than this method reading `tint`
     * directly) so the SAME helper serves both boards: the inventory call
     * sites pass {red:tint.red, yellow:tint.yellow}, the canvas call
     * sites pass {red:new Set(), yellow:tint.canvasYellow} (canvas never
     * shows red -- see the note above). */
    const drawTintOverlay = (layer: Container, cells: Cell[], uid: string, redSet: Set<string>, yellowSet: Set<string>): void => {
      const color = redSet.has(uid) ? TINT_RED : yellowSet.has(uid) ? TINT_YELLOW : null;
      if (color === null) return;
      for (const [r, c] of cells) {
        if (r < 1 || r > layout.ROWS || c < 1 || c > layout.COLS) continue;
        const g = new Graphics();
        g.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
        g.fill({ color, alpha: TINT_ALPHA });
        g.eventMode = 'none'; // decorative tint overlay, see constructor note
        layer.addChild(g);
      }
    };
    // Per-board red/yellow set selection (see color-choice note above):
    // inventory shows both red and yellow; canvas shows canvasYellow only
    // (as its own "yellow" set, with an empty red set so drawTintOverlay's
    // red-takes-precedence check never fires there).
    const tintRedSet = ops.isCanvas ? new Set<string>() : tint.red;
    const tintYellowSet = ops.isCanvas ? tint.canvasYellow : tint.yellow;

    // REQ-0288 (lift): resolve an armed BP carry ONCE, up front -- the grid
    // tint, the BP outline/skin/badge/handle sections and the beam layer all
    // need to know which bag (if any) is airborne. Container-scoped lookup:
    // a board that does not hold the carried bag resolves null and renders
    // exactly as before.
    const activeCarry = getCarry();
    const carriedBP =
      activeCarry && activeCarry.armed && activeCarry.kind === 'bp' && activeCarry.bpId
        ? (container.bps.find((b) => b.id === activeCarry.bpId) ?? null)
        : null;
    const carriedBPId = carriedBP ? carriedBP.id : null;
    this.liftProbe = carriedBPId; // REQ-0288: e2e seam -- see the field's doc

    // grid cells: canvas tints by BP color (dead-space cells get a flat
    // dark fill); inventory boards use a NEUTRAL grid background for every
    // cell regardless of BP occupancy (REQ-0030 spec item 1: "neutral grid
    // background (no canvas BP tint)") -- the BP itself is still drawn
    // (outline/label/cells) further below, just not reflected in the
    // under-grid tint color.
    for (let r = 1; r <= layout.ROWS; r++) {
      for (let c = 1; c <= layout.COLS; c++) {
        const bpId = ops.isCanvas ? cbp[`${r},${c}`] : null;
        const bp = bpId ? bpById(bpId) : null;
        const g = new Graphics();
        g.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
        if (bp) {
          const liftedCell = bp.id === carriedBPId; // REQ-0288: lift shadow
          g.fill({ color: bp.color, alpha: liftedCell ? 0.12 : 0.26 });
          g.stroke({ color: bp.color, alpha: liftedCell ? 0.4 : 0.35, width: 1 });
        } else {
          g.fill({ color: '#191919', alpha: 1 });
          g.stroke({ color: '#242424', alpha: 1, width: 1 });
        }
        g.eventMode = 'none'; // decorative cell tint, see constructor note
        this.gBase.addChild(g);
      }
    }

    // BP outlines + labels — drawn identically on both boards (REQ-0030
    // spec item 1: "BPs drawn as on canvas").
    for (const bp of container.bps) {
      drawGuarded('BP', bp.id, () => {
        const cells = engine.bpCells(bp);
        const lifted = bp.id === carriedBPId; // REQ-0288: this bag is airborne
        // REQ-0266 (item 23): the bag wears its skin. The 5-rung chain lives in
        // skin/bpSkinResolve.ts (instance -> profile -> set -> neutral -> plain).
        // `instanceSkinId` is null because a BP instance carries no bp_skin slot
        // yet; a BP with no unit has nothing to key on, so it passes neither the
        // profile nor the set id and lands on neutral -- exactly as D-C requires.
        // Building/caching the composite is skin/bpSkinTexture.ts's job, and so
        // is THE GUARD that keeps this binding a NO-DIFF for an unskinned BP: it
        // paints only when the resolved def declares real art (art.fill_texture)
        // AND that raster is decoded and in hand, and returns null otherwise. That
        // guard is not an optimisation. `neutral` is always registered, so this
        // chain lands on a def for EVERY BP on both boards; a composite body is
        // opaque and gSkins is above gBase; so an art-less def painted flat
        // #2b3240 over the per-BP colour tint -- the one cue that tells one BP
        // from another -- and over the inner half of its 3px coloured outline.
        // resolveBpSkin still REPORTS the rung it really took (`neutral`, or
        // `set` for a skin whose artwork is not adopted); it just no longer causes
        // a paint. Decoding is ASYNC and render() is not, so a skinned BP renders
        // unskinned on the frame that starts the decode and notifyStateChanged()
        // brings the pixels in on the next one; a raster that 404s is cached there
        // as a permanent miss and the BP stays unskinned. Missing art never blocks
        // a draw, and never degrades one either.
        // Golden G2 is untouched: nothing data-driven is baked into the composite
        // -- the connection-shape markers, the charge ring and the link/beam lines
        // are all still drawn per frame from engine state, further below.
        const bpSkin = resolveBpSkin(
          {
            instanceSkinId: null,
            profileSkinId: bp.unit ? pickedSkinId(bp.unit.id, 'bpskin') : null,
            unitSetSkinId: bp.unit ? defaultSkinId(bp.unit.id, 'bpskin') : null,
          },
          hasBpSkin
        );
        const skinSprite = bpSkin.skinId
          ? bpSkinSprite(cells, bpSkinDefs()[bpSkin.skinId], () => notifyStateChanged())
          : null;
        if (skinSprite && !lifted) { // REQ-0288: the skin composite rides with the ghost
          skinSprite.eventMode = 'none'; // decorative, see constructor note
          this.gSkins.addChild(skinSprite);
        }
        const outline = new Graphics();
        const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
        for (const [r, c] of cells) {
          const x = PAD + (c - 1) * CELL;
          const y = PAD + (r - 1) * CELL;
          if (!cellSet.has(`${r - 1},${c}`)) outline.moveTo(x, y).lineTo(x + CELL, y);
          if (!cellSet.has(`${r + 1},${c}`)) outline.moveTo(x, y + CELL).lineTo(x + CELL, y + CELL);
          if (!cellSet.has(`${r},${c - 1}`)) outline.moveTo(x, y).lineTo(x, y + CELL);
          if (!cellSet.has(`${r},${c + 1}`)) outline.moveTo(x + CELL, y).lineTo(x + CELL, y + CELL);
        }
        outline.stroke({ color: bp.color, width: 3, cap: 'square', alpha: lifted ? 0.4 : 1 }); // REQ-0288: shadow when airborne
        outline.eventMode = 'none'; // decorative, see constructor note
        this.gBase.addChild(outline);

        // REQ-0033 Phase 2: BP usage tint -- the BP's OWN footprint cells,
        // independent of whatever POs sitting on/inside it also get tinted
        // individually below (a BP used by the current squad = red on its
        // OWN cells too, per spec's "applies to POs, SIs, AND BPs alike").
        // REQ-0266: drawn into gSkins, NOT gBase. This wash is a STATE signal
        // ("this BP is committed to a squad"), not decoration, and a textured
        // skin -- which is opaque and sits in gSkins -- would otherwise hide it.
        // Zero visual difference when no skin paints: gSkins is the very next
        // layer above gBase and the only other thing in it is this BP's own
        // composite. (The PO/SI tints need no such move: they already draw into
        // gItems, which is above gSkins.)
        drawTintOverlay(this.gSkins, cells, bp.id, tintRedSet, tintYellowSet);

        const r0 = Math.min(...cells.map((cell) => cell[0]));
        const c0 = Math.min(...cells.filter((cell) => cell[0] === r0).map((cell) => cell[1]));
        const label = new Text({
          text: `${bp.name} · HP ${cells.length * 5}`,
          style: { fill: bp.color, fontSize: 12, fontWeight: 'bold' },
        });
        label.x = PAD + (c0 - 1) * CELL + 4;
        label.y = PAD + (r0 - 1) * CELL - 18;
        label.eventMode = 'none'; // decorative, see constructor note
        this.gBase.addChild(label);

        // REQ-0288: an airborne bag leaves ONLY its lift shadow behind. Every
        // draw below this line is bag furniture that rides with the ghost --
        // the ✥ move badge, the REQ-0287 ownership ribbons (a wedge hovering
        // over a lifted footprint reads as 'the bag is still here') and the
        // empty-cell grab handles (re-grabbing an airborne bag is nonsense).
        // They are the tail of this closure, so one early return serves all
        // three. The label above deliberately STAYS: it names the origin the
        // bag snaps back to when the drop is cancelled.
        if (lifted) return;

        // REQ-0042: move-handle badge at the BP's TOP-LEFT cell (r0,c0,
        // same top-left this label already computed above), on BOTH boards
        // (this loop runs for canvas and inventory alike -- no ops.isCanvas
        // gate, unlike the direction-dots block below which IS
        // canvas-only). Necessary because a BP fully covered by placed POs
        // has no empty cell left for the existing empty-cell-grab-handle
        // mechanism (this same loop, further below) to use -- the badge is
        // an ALWAYS-VISIBLE grab affordance regardless of what's on top of
        // the BP. Drawn into gBadges (above gItems/PO art, see the
        // constructor's addChild order) so it is never occluded by a PO's
        // own sprite. Only the badge glyph itself is pointer-interactive
        // (eventMode='static' + pointerdown) -- the decorative backing
        // circle behind it gets eventMode='none', same convention every
        // other decorative node in this file follows (see the constructor's
        // own doc comment on why this is load-bearing, not cosmetic).
        const badgeX = PAD + (c0 - 1) * CELL + 14;
        const badgeY = PAD + (r0 - 1) * CELL + 14;
        const badgeBg = new Graphics();
        badgeBg.circle(badgeX, badgeY, 12);
        badgeBg.fill({ color: '#0e0d0b', alpha: 0.85 });
        // REQ-0287: a shared-elsewhere BP tints its handle ring otherSquad so a
        // fully PO-covered BP still shows its shared status at the move handle.
        badgeBg.stroke({ color: tintYellowSet.has(bp.id) ? OVERLAY.usage.otherSquad.color : bp.color, width: 1.5 });
        badgeBg.eventMode = 'none'; // decorative backing, see constructor note
        this.gBadges.addChild(badgeBg);
        const badgeGlyph = new Text({
          text: '✥', // simple, reliably-rendering move/cross-arrows glyph
          style: { fill: '#f2fbff', fontSize: 16 },
        });
        badgeGlyph.anchor.set(0.5);
        badgeGlyph.x = badgeX;
        badgeGlyph.y = badgeY;
        badgeGlyph.eventMode = 'static';
        badgeGlyph.cursor = 'grab';
        // SAME whole-BP-move entry point the unit-grab core (below) and
        // the empty-cell handles (further below) both call -- reused
        // verbatim, not a new drag code path.
        badgeGlyph.on('pointerdown', (e: FederatedPointerEvent) => this.handleBPPointerDown(e, bp.id));
        // REQ-0290: with the seat core retired as a handle, this badge and the
        // empty-cell hits below are the WHOLE BP drag/rotate surface. Probed so
        // the spec pins that they still say 'grab' (design item 5: do not
        // over-lock -- 'grab' here even on a locked starter unit).
        this.cursorProbe.push({ uid: 'badge:' + bp.id, cursor: 'grab' });
        this.gBadges.addChild(badgeGlyph);
        // REQ-0287: ownership ribbons for this BP, drawn AFTER the badge so the
        // corner wedge never occludes the centred handle glyph. tr anchors on
        // the top-right-most cell, tl on the top-left-most (the BP:Unit law
        // welds Unit to BP -- the BP ribbon speaks for its Unit, no separate
        // Unit marker).
        paintUsageRibbons(this, bp.id, topRightCellBBoxPx(cells), topLeftCellBBoxPx(cells), tintRedSet, tintYellowSet);

        // Empty-cell BP grab handles (REQ-0027 T0.2, generalized REQ-0030
        // Phase 2): every BP cell that is neither occupied by a placed PO
        // nor the unit's own cell is an invisible drag source for moving
        // the whole BP (matches the mock's `hit` rects in this exact spot in
        // its renderAll()). Works identically on an inventory page -- BP
        // drag semantics are "grab = unit core or empty BP cell" on both
        // boards per REQ-0030 spec item 3.
        const occForHandles = ops.occupancy(state);
        const unitMapForHandles: Record<string, string> = {};
        for (const b of container.bps) { if (!b.unit) continue; unitMapForHandles[engine.key(...engine.unitCell(b))] = b.id; } // REQ-0170: same skip-a-unitless-BP policy as engine.unitMap()
        for (const [r, c] of cells) {
          const ck = `${r},${c}`;
          if (occForHandles[ck] || unitMapForHandles[ck]) continue;
          const hit = new Graphics();
          hit.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
          hit.fill({ color: '#000000', alpha: 0.001 }); // invisible but hit-testable
          hit.eventMode = 'static';
          hit.cursor = 'grab';
          hit.on('pointerdown', (e: FederatedPointerEvent) => this.handleBPPointerDown(e, bp.id));
          this.cursorProbe.push({ uid: 'cell:' + bp.id + ':' + ck, cursor: 'grab' }); // REQ-0290
          this.gBase.addChild(hit);
        }
      });
    }

    // beams — CANVAS ONLY (REQ-0030 spec item 7 / Unit dormancy: "no
    // beams" in the inventory; the engine itself never computes beams for
    // BPs sitting in an inventory page in the first place -- traceBeams
    // only ever iterates st.bps -- but this guard also skips the call
    // entirely for an inventory board rather than relying solely on that).
    //
    // REQ-0142 (link-trace diagnostics): this layer is now TRACE-AWARE.
    //   AT REST it draws exactly what it always drew (same #59d6d6 link
    //   lines, same grey dud line + ×, same 5px mutual-pair offset), plus
    //   ONE always-on addition the REQ asks for: a ⇄ badge on mutually
    //   linked pairs. canvas_spec calls mutual links "allowed, not always
    //   optimal" and duds "intentional" -- so both are MARKED, never nagged
    //   about (REQ-0142: "mark, don't nag").
    //   UNDER HOVER it becomes a diagnostic instrument: the interrogated
    //   Unit's ray fan lights up (origin ring -> traversed cells -> first-hit
    //   receiver ring) while every unrelated beam drops to BEAM_DIM_ALPHA, so
    //   a spaghetti board collapses to the one fan being read. Where the
    //   first-hit rule CONSUMED a beam, a dashed ghost continues from the
    //   receiver to each shadowed Unit -- the geometry of "blocked by X",
    //   drawn rather than described.
    // The PROSE ("why not", plain language, EN + ja) is not here: it lives in
    // the HTML panel (BeamTracePanel.tsx), which reads the same linkTrace
    // query. This layer draws only what geometry alone can honestly say.
    this.beamSegs = [];
    if (ops.isCanvas) {
      const hover = getBeamHover();
      const active = hover && hover.boardKey === boardIdKey(this.boardId) ? hover : null;
      const trace = active ? traceUnit(engine, state, layout, active.bp) : null;
      // Which beams are "the subject": the hovered Unit's whole fan, or the
      // single direction when a beam SEGMENT (not the core) is hovered.
      const isSubject = (from: string, dir: number | null): boolean =>
        !!trace && from === trace.bp && (active!.dir === null || active!.dir === dir);
      const beamAlpha = (from: string, dir: number | null, base: number): number =>
        !trace || isSubject(from, dir) ? base : base * BEAM_DIM_ALPHA;

      // Traced-ray backdrop: origin ring, traversed cells, receiver ring.
      // Drawn FIRST so every beam line lands on top of its own highlight.
      if (trace) {
        const originRing = new Graphics();
        originRing.circle(cx(trace.cell[1]), cy(trace.cell[0]), UNIT_CORE_RADIUS + 6);
        originRing.stroke({ color: '#9ff0f0', width: 2, alpha: 0.9 });
        this.gBeams.addChild(originRing);
        for (const dt of trace.dirs) {
          if (!dt.active) continue; // an unfired direction has no ray to light up (the panel says why)
          if (active!.dir !== null && dt.dir !== active!.dir) continue;
          for (const [r, c] of dt.path) {
            const cellHi = new Graphics();
            cellHi.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
            cellHi.fill({ color: dt.to ? '#59d6d6' : '#8a8a8a', alpha: 0.10 });
            this.gBeams.addChild(cellHi);
          }
          if (dt.to && dt.firstOnRay) {
            const rx = cx(dt.firstOnRay.cell[1]);
            const ry = cy(dt.firstOnRay.cell[0]);
            const hitRing = new Graphics();
            hitRing.circle(rx, ry, UNIT_CORE_RADIUS + 6);
            hitRing.stroke({ color: '#9ff0f0', width: 2, alpha: 0.75 });
            this.gBeams.addChild(hitRing);
            // "blocked by X": the beam DIED at the receiver, so every Unit
            // further down the ray never hears it. Draw that death as a
            // dashed ghost from the receiver to each shadowed Unit.
            for (const shadow of dt.unitsOnRay.slice(1)) {
              drawDashedSegment(
                this.gBeams,
                rx,
                ry,
                cx(shadow.cell[1]),
                cy(shadow.cell[0]),
                '#d98a4a'
              );
              const miss = new Graphics();
              miss.circle(cx(shadow.cell[1]), cy(shadow.cell[0]), UNIT_CORE_RADIUS + 6);
              miss.stroke({ color: '#d98a4a', width: 2, alpha: 0.55 });
              this.gBeams.addChild(miss);
            }
          }
        }
      }

      for (const bm of engine.traceBeams(state)) {
        if (carriedBPId && (bm.from === carriedBPId || bm.to === carriedBPId)) continue; // REQ-0288: airborne bag's links lift with it
        const bp = bpById(bm.from);
        const lc = engine.unitCell(bp);
        const x0base = cx(lc[1]);
        const y0base = cy(lc[0]);
        if (bm.to) {
          const last = bm.path[bm.path.length - 1];
          const x1 = cx(last[1]);
          const y1 = cy(last[0]);
          const len = Math.hypot(x1 - x0base, y1 - y0base) || 1;
          const ux = (x1 - x0base) / len;
          const uy = (y1 - y0base) / len;
          const x0 = x0base + ux * 28;
          const y0 = y0base + uy * 28;
          const x1t = x1 - ux * 26;
          const y1t = y1 - uy * 26;
          let px = 0;
          let py = 0;
          if (bm.mutual) {
            px = -uy * 5;
            py = ux * 5;
          }
          const subject = isSubject(bm.from, bm.dir);
          const line = new Graphics();
          line.moveTo(x0 + px, y0 + py).lineTo(x1t + px, y1t + py);
          line.stroke({ color: '#59d6d6', width: subject ? 5 : 3, alpha: beamAlpha(bm.from, bm.dir, 0.95) });
          this.gBeams.addChild(line);
          this.gBeams.addChild(arrowHead(this, x1t + px, y1t + py, Math.atan2(uy, ux), '#59d6d6'));
          // Mutual-link badge (REQ-0142): the pair each targets the other.
          // Drawn once per beam (so a mutual pair carries one badge on each
          // of its two offset lines -- symmetric, like the link itself).
          if (bm.mutual) {
            const badge = new Text({
              text: '⇄',
              style: { fill: '#9ff0f0', fontSize: 15, fontWeight: 'bold' },
            });
            badge.anchor.set(0.5);
            badge.x = (x0 + x1t) / 2 + px;
            badge.y = (y0 + y1t) / 2 + py;
            badge.alpha = beamAlpha(bm.from, bm.dir, 0.9);
            badge.eventMode = 'none'; // decorative, see constructor note
            this.gBeams.addChild(badge);
          }
          this.beamSegs.push({ from: bm.from, dir: bm.dir, x0: x0 + px, y0: y0 + py, x1: x1t + px, y1: y1t + py });
        } else if (bm.dir === null) {
          // REQ-0170: an OFFSET shape (knight jump) whose target cell holds no Unit.
          // There is no ray to draw to the board edge -- the reach is exactly one cell
          // and it is empty. Mark that cell as a dud and draw nothing else: a line
          // here would draw a beam that does not exist.
          const cell = bm.path[0];
          if (cell) {
            const dud = new Text({ text: '×', style: { fill: '#6a6a6a', fontSize: 15 } });
            dud.anchor.set(0.5);
            dud.x = cx(cell[1]);
            dud.y = cy(cell[0]);
            dud.alpha = beamAlpha(bm.from, bm.dir, 0.8);
            dud.eventMode = 'none';
            this.gBeams.addChild(dud);
          }
        } else {
          const dv = engine.DIRS[bm.dir];
          const vlen = Math.hypot(dv[1], dv[0]) || 1;
          const ux = dv[1] / vlen;
          const uy = dv[0] / vlen;
          const bounds = { x0: PAD, y0: PAD, x1: PAD + layout.COLS * CELL, y1: PAD + layout.ROWS * CELL };
          let t = Infinity;
          if (ux > 0) t = Math.min(t, (bounds.x1 - x0base) / ux);
          if (ux < 0) t = Math.min(t, (bounds.x0 - x0base) / ux);
          if (uy > 0) t = Math.min(t, (bounds.y1 - y0base) / uy);
          if (uy < 0) t = Math.min(t, (bounds.y0 - y0base) / uy);
          const x1 = x0base + ux * t;
          const y1 = y0base + uy * t;
          const x0 = x0base + ux * 28;
          const y0 = y0base + uy * 28;
          const subject = isSubject(bm.from, bm.dir);
          const line = new Graphics();
          line.moveTo(x0, y0).lineTo(x1 + ux * 8, y1 + uy * 8);
          line.stroke({ color: '#6a6a6a', width: subject ? 3 : 2, alpha: beamAlpha(bm.from, bm.dir, 0.7) });
          this.gBeams.addChild(line);
          const dud = new Text({ text: '×', style: { fill: '#6a6a6a', fontSize: 15 } });
          dud.anchor.set(0.5);
          dud.x = x1 + ux * 20;
          dud.y = y1 + uy * 20;
          dud.alpha = beamAlpha(bm.from, bm.dir, 1);
          this.gBeams.addChild(dud);
          this.beamSegs.push({ from: bm.from, dir: bm.dir, x0, y0, x1: x1 + ux * 8, y1: y1 + uy * 8 });
        }
      }
    }

    // Assembled Longsword (blade+hilt flush-joined, BP linked) — CANVAS
    // ONLY (REQ-0030: no 'bond' pseudo-socket/assembly concept exists in
    // an inventory page, per engine.js's pageSockets() design note).
    // Mirrors mock-src/ui.js's `mergeSword` special-case exactly (REQ-0026
    // follow-up, PO orientation bug). When active, the mock does NOT run
    // the generic rotation-aware drawPOArt() for blade/hilt -- it draws a
    // dedicated merged visual instead: each part's own icon in its own
    // (unrotated) poBox, no rotation wrapper, plus a dashed outline
    // spanning all 3 cells.
    const asm = ops.isCanvas ? engine.assembly(state) : null;
    // A carried blade/hilt should not render as the merged visual (matches
    // the mock's `mergeSword=asm&&state.linked&&!carriedUids.length`).
    const carriedUids = new Set<string>();
    if (activeCarry && activeCarry.armed) {
      if (activeCarry.kind === 'po' || activeCarry.kind === 'si') carriedUids.add(activeCarry.uid);
      else if (activeCarry.kind === 'asm' && asm) {
        carriedUids.add(asm.blade.uid);
        carriedUids.add(asm.hilt.uid);
      } else if (activeCarry.kind === 'bp' && carriedBP) {
        // REQ-0288: the bag lifts WITH its contents. Containment is geometric
        // (anchor-cell membership -- a PO fits entirely inside ONE BP, law),
        // so one rule serves canvas and inventory containers alike.
        const cbCells = new Set(engine.bpCells(carriedBP).map(([r, c]) => `${r},${c}`));
        for (const p of container.pos) {
          if (p.loc === 'grid' && p.cell && cbCells.has(`${p.cell[0]},${p.cell[1]}`)) carriedUids.add(p.uid);
        }
      }
    }
    const mergeSword = !!(asm && state.linked && carriedUids.size === 0);

    // placed POs
    for (const p of container.pos) {
      if (p.loc !== 'grid' || !p.cell) continue;
      if (carriedUids.has(p.uid)) continue;
      if (mergeSword && (p.uid === asm!.blade.uid || p.uid === asm!.hilt.uid)) continue;
      const def = items[p.id];
      if (!def) continue;
      const { w, h } = engine.shapeInfo(p.id, p.rot);
      const box = {
        x: PAD + (p.cell[1] - 1) * CELL,
        y: PAD + (p.cell[0] - 1) * CELL,
        w: w * CELL,
        h: h * CELL,
      };
      const hit = new Graphics();
      hit.rect(box.x, box.y, box.w, box.h);
      hit.fill({ color: '#000000', alpha: 0.001 });
      hit.eventMode = 'static';
      // REQ-0290 design item 3 (user ruling 3, 2026-07-22): a FIXED PO shows
      // the DEFAULT arrow -- explicitly NOT 'not-allowed'. The ruling reserves
      // the X for the seat cell alone; a fixed interior piece instead shows no
      // grab affordance at all plus the persistent padlock drawn below, so its
      // immovability is stated BEFORE the click rather than discovered by one.
      // ('grab' was the pre-REQ-0290 lie: the engine has refused both drag and
      // rotate for these since REQ-0051, and handlePOPointerDown has
      // short-circuited them since -- the cursor simply never said so.)
      hit.cursor = p.fixed ? 'default' : 'grab';
      this.cursorProbe.push({ uid: p.uid, cursor: hit.cursor }); // REQ-0290
      const isAssemblyPart = !!(state.linked && asm && (p.uid === asm.blade.uid || p.uid === asm.hilt.uid));
      hit.on('pointerdown', (e: FederatedPointerEvent) => this.handlePOPointerDown(e, p, isAssemblyPart, asm));
      hit.on('pointerup', () => this.handleItemTap('po', p.id, box, p.uid));
      this.gItems.addChild(hit);
      for (const [r, c] of ops.cellsOf(state, p)) {
        const bg = new Graphics();
        bg.roundRect(PAD + (c - 1) * CELL + 3, PAD + (r - 1) * CELL + 3, CELL - 6, CELL - 6, 6);
        bg.fill({ color: '#000000', alpha: 0.22 });
        bg.eventMode = 'none'; // decorative backdrop, see constructor note
        this.gItems.addChild(bg);
      }
      // REQ-0033 Phase 2: PO usage tint, drawn into gItems (same layer as
      // this PO's own backdrop above, so it paints above the base grid/
      // BP-color tint but stays below the PO's own sprite art, which is
      // added to gItems next).
      drawTintOverlay(this.gItems, ops.cellsOf(state, p), p.uid, tintRedSet, tintYellowSet);
      // REQ-0287: ownership ribbon over the PO footprint bbox (into gBadges).
      const poRibbonBbox = cellsBBoxPx(ops.cellsOf(state, p));
      paintUsageRibbons(this, p.uid, poRibbonBbox, poRibbonBbox, tintRedSet, tintYellowSet);
      // REQ-0290 design item 3, second half: the persistent padlock. Drawn into
      // gBadges (above gItems, same reason the ✥ badge is there -- a PO's own
      // sprite must never occlude it) and eventMode 'none' so it cannot eat the
      // hit rect underneath it.
      //
      // Corner arbitration with REQ-0287's shared-usage ribbon: the REQ ratified
      // "top-right of the footprint bbox, and if REQ-0287's ribbon occupies that
      // corner, nudge one cell-corner inward -- whichever REQ lands second
      // implements the nudge". REQ-0287 is live, so this is that nudge. It is
      // deterministic and always lands INSIDE the footprint bbox: one cell left
      // if the footprint has a second column, else one cell down if it has a
      // second row, else (a 1x1 fixed PO, where no cell corner exists to move to)
      // inset by the ribbon's own leg so the glyph clears the wedge. Only the
      // SHARED (tr) ribbon contends -- REQ-0287's self ribbon is a tl wedge.
      if (p.fixed) {
        const RIBBON_LEG = 16; // usageRibbons.ts LEG -- the wedge's reach along each edge
        let lockX = poRibbonBbox.x + poRibbonBbox.w - 3;
        let lockY = poRibbonBbox.y + 3;
        if (tintYellowSet.has(p.uid)) {
          if (poRibbonBbox.w > CELL) lockX -= CELL;
          else if (poRibbonBbox.h > CELL) lockY += CELL;
          else { lockX -= RIBBON_LEG; lockY += RIBBON_LEG; }
        }
        const padlock = new Text({ text: '🔒', style: { fill: '#f2fbff', fontSize: 9 } });
        padlock.anchor.set(1, 0);
        padlock.x = lockX;
        padlock.y = lockY;
        padlock.alpha = 0.85;
        padlock.eventMode = 'none'; // decorative, see constructor note
        this.gBadges.addChild(padlock);
        // REQ-0290 gate "padlock exactly once per fixed PO": recorded so the
        // spec can COUNT the glyph. 'inert' is not a CSS cursor -- the padlock
        // is eventMode 'none' and therefore has no cursor at all; the value
        // records exactly that while keeping one probe shape (see
        // cursorProbe.ts). A second entry for one uid means the fixed branch
        // ran twice in a single render.
        this.cursorProbe.push({ uid: 'lock:' + p.uid, cursor: 'inert' });
      }
      const texture = itemTex(textures, p.id, def.icon);
      if (texture) {
        const sprite = new Sprite(texture);
        const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
        const W0 = cw * CELL;
        const H0 = ch * CELL;
        const k = ((p.rot % 4) + 4) % 4;
        // REQ-0028 (aspect law): uniform contain-fit box (was independent
        // x/y insets per def.stretch branch -- see fitSpriteToBox doc).
        // Box tightness squads (stretch vs non-stretch) preserved.
        if (def.stretch) {
          fitSpriteToBox(sprite, W0 * 0.1, H0 * 0.1, W0 * 0.8, H0 * 0.8, def.align, { x: 0, y: 0, w: W0, h: H0 });
        } else {
          fitSpriteToBox(sprite, W0 * 0.06, H0 * 0.05, W0 * 0.88, H0 * 0.9, def.align, { x: 0, y: 0, w: W0, h: H0 });
        }
        const inner = new Container();
        inner.eventMode = 'none'; // decorative art, see constructor note
        inner.addChild(sprite);
        if (k === 0) {
          inner.position.set(box.x, box.y);
        } else if (k === 1) {
          inner.position.set(box.x + w * CELL, box.y);
          inner.rotation = Math.PI / 2;
        } else if (k === 2) {
          inner.position.set(box.x + w * CELL, box.y + h * CELL);
          inner.rotation = Math.PI;
        } else {
          inner.position.set(box.x, box.y + h * CELL);
          inner.rotation = -Math.PI / 2;
        }
        this.gItems.addChild(inner);
      }
      // REQ-0273 (feature): per-PO footprint outline -- ink+rim, inset 3px
      // inside the boundary (see poOutline.ts for the full design note).
      // Drawn ABOVE the sprite deliberately: contain-fit art fills the
      // footprint's BOUNDING BOX, so an L/T-shaped PO's art can overhang
      // cells outside its true footprint, and the outline's whole job is to
      // state true cell ownership. Also drawn when no texture resolved (the
      // no-art case is where the footprint is hardest to read). Decorative:
      // never a hit target (see constructor note). gUnits stays above gItems,
      // so unit cores/art still paint over this (REQ-0266 invariant).
      const poOutline = new Graphics();
      drawPOOutline(poOutline, ops.cellsOf(state, p));
      poOutline.eventMode = 'none';
      this.gItems.addChild(poOutline);
    }
    // merged Longsword visual (mock-src/ui.js's mergeSword block, ~L250-262)
    // — CANVAS ONLY (mergeSword is always false on an inventory board,
    // asm is always null there -- see above). Kept unguarded here since
    // `mergeSword` already folds in `ops.isCanvas` via `asm`.
    if (mergeSword) {
      const a = asm!;
      const poBox = (p: (typeof a)['blade']) => {
        const { w, h } = engine.shapeInfo(p.id, p.rot);
        return {
          x: PAD + (p.cell![1] - 1) * CELL,
          y: PAD + (p.cell![0] - 1) * CELL,
          w: w * CELL,
          h: h * CELL,
        };
      };
      const asmHit = new Graphics();
      asmHit.rect(
        PAD + (Math.min(...a.cells.map((c) => c[1])) - 1) * CELL,
        PAD + (Math.min(...a.cells.map((c) => c[0])) - 1) * CELL,
        (Math.max(...a.cells.map((c) => c[1])) - Math.min(...a.cells.map((c) => c[1])) + 1) * CELL,
        (Math.max(...a.cells.map((c) => c[0])) - Math.min(...a.cells.map((c) => c[0])) + 1) * CELL
      );
      asmHit.fill({ color: '#000000', alpha: 0.001 });
      asmHit.eventMode = 'static';
      asmHit.cursor = 'grab';
      asmHit.on('pointerdown', (e: FederatedPointerEvent) => this.handlePOPointerDown(e, a.blade, true, a));
      asmHit.on('pointerup', () =>
        this.handleItemTap('po', a.blade.id, {  // REQ-0198 (B): 4th arg (uid) supplied after the box literal
          x: PAD + (Math.min(...a.cells.map((c) => c[1])) - 1) * CELL,
          y: PAD + (Math.min(...a.cells.map((c) => c[0])) - 1) * CELL,
          w: (Math.max(...a.cells.map((c) => c[1])) - Math.min(...a.cells.map((c) => c[1])) + 1) * CELL,
          h: (Math.max(...a.cells.map((c) => c[0])) - Math.min(...a.cells.map((c) => c[0])) + 1) * CELL,
        }, a.blade.uid)
      );
      this.gItems.addChild(asmHit);
      for (const [r, c] of a.cells) {
        const bg = new Graphics();
        bg.roundRect(PAD + (c - 1) * CELL + 3, PAD + (r - 1) * CELL + 3, CELL - 6, CELL - 6, 6);
        bg.fill({ color: '#000000', alpha: 0.22 });
        bg.eventMode = 'none'; // decorative backdrop, see constructor note
        this.gItems.addChild(bg);
      }
      const cellSet = new Set(a.cells.map(([r, c]) => `${r},${c}`));
      const outline = new Graphics();
      for (const [r, c] of a.cells) {
        const x = PAD + (c - 1) * CELL;
        const y = PAD + (r - 1) * CELL;
        if (!cellSet.has(`${r - 1},${c}`)) outline.moveTo(x, y).lineTo(x + CELL, y);
        if (!cellSet.has(`${r + 1},${c}`)) outline.moveTo(x, y + CELL).lineTo(x + CELL, y + CELL);
        if (!cellSet.has(`${r},${c - 1}`)) outline.moveTo(x, y).lineTo(x, y + CELL);
        if (!cellSet.has(`${r},${c + 1}`)) outline.moveTo(x + CELL, y).lineTo(x + CELL, y + CELL);
      }
      outline.stroke({ color: '#d7dfe6', width: 1.5, alpha: 0.9 });
      outline.eventMode = 'none'; // decorative, see constructor note
      this.gItems.addChild(outline);

      // REQ-0028 (aspect law): uniform contain-fit box (was independent
      // x/y insets: bx.w*0.10..0.80 vs +6..-6 for blade, hx.w*0.10..0.80 vs
      // +0..-8 for hilt -- see fitSpriteToBox doc).
      const bx = poBox(a.blade);
      const bladeDef = items[a.blade.id];
      const bladeTexture = bladeDef && itemTex(textures, a.blade.id, bladeDef.icon);
      if (bladeTexture) {
        const sprite = new Sprite(bladeTexture);
        fitSpriteToBox(sprite, bx.x + bx.w * 0.1, bx.y + bx.h * 0.1, bx.w * 0.8, bx.h * 0.8, bladeDef?.align, bx);
        sprite.eventMode = 'none'; // decorative art, see constructor note
        this.gItems.addChild(sprite);
      }
      const hx = poBox(a.hilt);
      const hiltDef = items[a.hilt.id];
      const hiltTexture = hiltDef && itemTex(textures, a.hilt.id, hiltDef.icon);
      if (hiltTexture) {
        const sprite = new Sprite(hiltTexture);
        fitSpriteToBox(sprite, hx.x + hx.w * 0.1, hx.y + hx.h * 0.1, hx.w * 0.8, hx.h * 0.8, hiltDef?.align, hx);
        sprite.eventMode = 'none'; // decorative art, see constructor note
        this.gItems.addChild(sprite);
      }
    }

    // Chain-link toggle — CANVAS ONLY (no assembly concept in inventory).
    if (asm && carriedUids.size === 0) {
      const rs = asm.cells.map((c) => c[0]);
      const csn = asm.cells.map((c) => c[1]);
      const tx = PAD + Math.max(...csn) * CELL - 2;
      const ty = PAD + (Math.min(...rs) - 1) * CELL + 2;
      const col = state.linked ? 0x59d6d6 : 0x7a7568;
      const btn = new Graphics();
      btn.circle(tx, ty, 11);
      btn.fill({ color: '#0e0d0b' });
      btn.stroke({ color: col, width: 2 });
      btn.circle(tx - 3.5, ty, 3.2);
      btn.stroke({ color: col, width: 2 });
      btn.circle(tx + 3.5, ty, 3.2);
      btn.stroke({ color: col, width: 2 });
      if (!state.linked) {
        btn.moveTo(tx - 6, ty + 6).lineTo(tx + 6, ty - 6);
        btn.stroke({ color: '#c05050', width: 2 });
      }
      btn.eventMode = 'static';
      btn.cursor = 'pointer';
      btn.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
      btn.on('click', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        // REQ-0367: the chain-link toggle is OUTSIDE undo's scope (place/
        // move/rotate/remove only) -- clear the slot so a later undo can
        // never silently revert this toggle as a side effect of the
        // whole-state restore.
        clearUndo();
        state.linked = !state.linked;
        notifyStateChanged();
      });
      this.gChain.addChild(btn);
    }

    // port target ◇ marks + established connection ◆ marks — CANVAS ONLY
    // (REQ-0030 spec item 1: "no port ◇ evaluation" / "no ◆ connection
    // marks" in the inventory -- placement-only world).
    if (ops.isCanvas) {
      for (const p of container.pos) {
        if (p.loc !== 'grid') continue;
        for (const [r, c] of engine.connTargets(state, p)) {
          if (r < 1 || r > layout.ROWS || c < 1 || c > layout.COLS) continue;
          const nx = cx(c);
          const ny = cy(r);
          const diamond = new Graphics();
          diamond.moveTo(nx, ny - 8).lineTo(nx + 8, ny).lineTo(nx, ny + 8).lineTo(nx - 8, ny).closePath();
          diamond.stroke({ color: '#e9b64d', width: 1.5, alpha: 0.8 });
          this.gTarget.addChild(diamond);
        }
      }
      for (const conn of engine.allConnections(state)) {
        const nx = cx(conn.tile[1]);
        const ny = cy(conn.tile[0]);
        const diamond = new Graphics();
        diamond.moveTo(nx, ny - 9).lineTo(nx + 9, ny).lineTo(nx, ny + 9).lineTo(nx - 9, ny).closePath();
        diamond.fill({ color: '#f5a93b', alpha: 0.65 });
        diamond.stroke({ color: '#2b2016', width: 1.5 });
        diamond.eventMode = 'none'; // decorative, see constructor note
        this.gItems.addChild(diamond);
      }
    }

    // units — drawn on BOTH boards (REQ-0030 spec item 1: BP unit
    // cores render but DIMMED in inventory, no beams/no direction dots).
    // Still a valid BP-drag grab handle on both boards (spec item 3).
    for (const bp of container.bps) {
      drawGuarded('BP unit', bp.id, () => {
        // REQ-0170: a BP without a Unit cannot exist (the BP:Unit law) and the purge
        // removed every one that did. If a stale save ever produces one anyway, draw
        // the bag and skip the unit -- a degraded board beats a blank one.
        if (!bp.unit) return;
        if (bp.id === carriedBPId) return; // REQ-0288: the unit core + art ride with the ghost
        const lc = engine.unitCell(bp);
        const x = cx(lc[1]);
        const y = cy(lc[0]);
        const core = new Graphics();
        core.circle(x, y, 26);
        core.fill({ color: '#0e0d0b', alpha: ops.isCanvas ? 0.55 : INV_UNIT_ALPHA });
        core.stroke({ color: '#59d6d6', alpha: ops.isCanvas ? 0.5 : INV_UNIT_ALPHA, width: 1 });
        // REQ-0290 design item 1 -- the seat cell is X and INERT, on EVERY
        // unit (starter and normal) and on BOTH boards. Reading of record
        // (user ruling, 2026-07-22): the X states that a Unit PIECE can never
        // be moved or re-seated -- its seat is stamped at mint (canvas_spec
        // law, true for every unit), which is a different and permanent fact
        // from "this BP is locked". So the affordance is unconditional here
        // and does NOT consult bp.locked.
        //
        // eventMode stays 'static' for ONE reason only: a Pixi hit object is
        // what carries `cursor`, so the core must remain hit-testable for the
        // X to render at all. Its pointerdown wiring is GONE -- and with it
        // the dblclick-rotate path that used to run THROUGH this core, since
        // that trigger was handleBPPointerDown's own double-tap branch. BP
        // drag and rotate consolidate on the two handles that remain (the
        // badge above, empty BP cells below), which keep 'grab'.
        //
        // NOT over-locked (REQ-0290 design item 5): moving/transferring/
        // rotating a locked starter unit's BAG stays legal (REQ-0209 design).
        // Only this one cell stops being a handle.
        core.eventMode = 'static';
        core.cursor = 'not-allowed';
        this.cursorProbe.push({ uid: 'seat:' + bp.id, cursor: 'not-allowed' });
        this.gUnits.addChild(core);
        // REQ-0125a: the art in a Unit cell is no longer a string literal. It
        // comes from THE resolver (board/unitIcon.ts), through the ratified G6
        // skin chain: active skin -> default unit icon -> legacy glyph ->
        // placeholder. Today no BP carries a skin or a default icon (no unit art
        // exists -- REQ-0127 is on hold behind REQ-0136 -- and no unit IDENTITY
        // exists to key one on -- REQ-0128 owns the Unit model, and the user's
        // 2026-07-12 ruling was explicitly NOT to invent a unitId field here to
        // unblock the renderer). So every BP falls through to the legacy
        // `icon-unit_core` glyph and this board stays pixel-identical to
        // pre-REQ-0125a. That fall-through IS the deliverable: REQ-0125b lands
        // identity and REQ-0127 lands art as DATA, without touching this file,
        // and REQ-0133 reuses this same chain for item rasters.
        const icon = resolveUnitIcon(
          {
            // REQ-0266: the `skin` rung is fed for real at last. activeUnitSkinKey()
            // runs the profile-pick -> def-default chain over the unit_skin/1 defs and
            // returns NULL -- never the default key -- when the unit has no skin, or
            // when that skin's artwork is not adopted. So a BP with no skin still
            // reports rung 'default' and the chain's own report stays honest.
            // Identity + default art landed in REQ-0170, so `defaultKey` is a real key:
            // the BP's Unit id, namespaced by unitIconKey(). A BP whose art failed to
            // load (or whose unit id is unknown) simply falls through the chain to the
            // legacy glyph -- the seam does its job without a change at this draw site.
            skinKey: bp.unit ? activeUnitSkinKey(bp.unit.id) : null,
            defaultKey: bp.unit ? unitIconKey(bp.unit.id) : null,
          },
          (k) => textures.has(k)
        );
        const unitTexture = icon.key ? textures.get(icon.key) : undefined;
        if (unitTexture) {
          const sprite = new Sprite(unitTexture);
          // Contain-fit into the 44x44 art box via the SHARED box-fit every other
          // icon on this board already uses (geom.fitSpriteToBox ->
          // render/itemCard.fitBoxInBounds). The old code hard-set width/height to
          // 44x44, which is a no-op for the 1:1 legacy glyph but would STRETCH any
          // non-square art -- and aspect is inviolable (common_content_pipeline.md
          // section 2). Unit icons are 1:1 by definition (unit_icon_pipeline.md
          // section 0), so this changes nothing today; it is the path REQ-0133's
          // non-square item rasters will come through.
          fitSpriteToBox(sprite, x - 22, y - 22, 44, 44);
          // REQ-0273 (bug 1): real art (resolver rungs 'skin'/'default') is the
          // character's identity and draws at FULL opacity on every board. The
          // REQ-0030 dormancy dim (INV_UNIT_ALPHA * 2) now applies only to the
          // legacy placeholder glyph -- a UI symbol, not art -- so boards with no
          // unit art stay pixel-identical to before. Before REQ-0266 fed the skin
          // rung, the glyph was the only thing that ever reached this line, which
          // is why the dim read as intentional for years and as a defect the day
          // real art arrived.
          sprite.alpha = ops.isCanvas || icon.rung !== 'legacy' ? 1 : INV_UNIT_ALPHA * 2;
          sprite.eventMode = 'none'; // decorative art, see constructor note
          this.gUnits.addChild(sprite);
        }

        // G7 charge ring (unit_icon_pipeline.md section 1). Renderer-drawn, never
        // baked into art (G2). NULL today at every production call site: no charge
        // data exists anywhere in the codebase (see chargeRing.ts's header for the
        // audit -- the placement engine has no time axis at all, and sim's only
        // `cooldown` is the ROOM re-entry timer, which is REQ-0098's ring, not a
        // unit's; canvas units are dormant by construction anyway). So
        // drawChargeRing() no-ops and no ring appears. The drawing itself is
        // finished and visually verified (web/preview/unit-charge-ring/); REQ-0129
        // changes this ONE argument from null to a real 0-1 value and it lights up.
        const ring = new Graphics();
        drawChargeRing(ring, x, y, null);
        ring.eventMode = 'none'; // decorative, must not eat the BP drag handle
        this.gUnits.addChild(ring);
        // Direction dots (which way the unit's rays would fire) are a canvas-only
        // concept -- an inventory BP's unit is dormant, so no dots are drawn there
        // (REQ-0030 spec item 1: "no beams").
        //
        // REQ-0170: the dirs come from the Unit's connection_shape, not from the BP.
        // OFFSET shapes (the knight jumps) get NO dots on purpose: a jump has no
        // compass angle, and faking one by pointing a dot at the nearest 45 degrees
        // would tell the player something untrue. Their links still render as beams
        // (drawn from engine.traceBeams above), which is the honest picture.
        const connShape = ops.isCanvas ? engine.connShapeOf(bp) : null;
        if (connShape && connShape.kind === 'ray') {
          for (const d of (connShape.dirs ?? [])) {
            const ang = (DIR_ANGLES[d] * Math.PI) / 180;
            const dot = new Graphics();
            dot.circle(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 4);
            dot.fill({ color: '#59d6d6' });
            dot.eventMode = 'none'; // decorative, see constructor note
            this.gUnits.addChild(dot);
          }
        }
      });
    }
    // Sockets (diegetic, REQ-0027 T0.2, generalized REQ-0030 Phase 2):
    // empty-socket outlines (dashed circle/rounded-rect + glyph, per socket
    // type) and seated SI icons (drag sources). Mirrors the mock's sockets
    // rendering block exactly, including the special acc_guard "guard bar"
    // visual and the host==='bond' special-case position (hilt's top cell
    // edge) -- 'bond' sockets only ever appear via ops.sockets() on the
    // canvas board (pageSockets() never emits one, per engine.js design).
    for (const s of ops.sockets(state)) {
      drawGuarded('socket', s.host, () => {
        if (carriedUids.has(s.host) || (s.siUid && carriedUids.has(s.siUid))) return;
        const pos = socketScreenPos(this, state, s, asm);
        if (!pos) return;
        const { x, y } = pos;
        if (s.siUid) {
          const a = container.sis.find((z) => z.uid === s.siUid);
          if (!a) return;
          const siDef = this.deps.siDefs[a.id];
          // REQ-0290 design item 4: an SI seated inside a PO that sits in a
          // LOCKED BP cannot be unseated -- engine.js's seatSI/stowSI (and the
          // page twins) have refused it with why:'locked unit' since REQ-0209.
          // Until now the client still said 'grab' and let the drag start, so
          // the refusal only surfaced at DROP time, reading as a malfunction.
          // Lock topology comes from the engine through ops.poInLockedBP (never
          // re-derived here); a bond socket has no single host PO, hence the
          // 'bond' guard -- the same guard engine.seatSI itself uses.
          const hostPo = s.host !== 'bond' ? container.pos.find((z) => z.uid === s.host) : undefined;
          const siLocked = !!hostPo && ops.poInLockedBP(state, hostPo);
          const g = new Container();
          g.eventMode = 'static';
          // Default arrow, NOT 'not-allowed' -- consistent with the fixed-PO
          // ruling above (the X belongs to the seat cell alone). No glyph
          // either: the REQ is explicit that the padlock is a fixed-PO mark.
          g.cursor = siLocked ? 'default' : 'grab';
          this.cursorProbe.push({ uid: a.uid, cursor: g.cursor }); // REQ-0290
          if (a.id === 'acc_guard') {
            const bar = new Graphics();
            bar.roundRect(x - 23, y - 7, 46, 14, 6);
            bar.fill({ color: '#b08340' });
            bar.stroke({ color: '#2b2016', width: 2.5 });
            bar.circle(x - 12, y, 2.2);
            bar.fill({ color: '#e9b64d' });
            bar.circle(x + 12, y, 2.2);
            bar.fill({ color: '#e9b64d' });
            bar.eventMode = 'none'; // decorative, see constructor note
            g.addChild(bar);
          } else if (siDef) {
            const tex = itemTex(textures, a.id, siDef.icon);
            if (tex) {
              const sprite = new Sprite(tex);
              sprite.x = x - 12;
              sprite.y = y - 12;
              sprite.width = 24;
              sprite.height = 24;
              sprite.eventMode = 'none'; // decorative art, see constructor note
              g.addChild(sprite);
            }
          }
          // REQ-0033 Phase 2: seated-SI usage tint -- a small translucent
          // wash directly under the SI's own icon (a circle, not a full
          // grid cell, since a seated SI's visual footprint is the socket
          // glyph itself, not a cell-aligned box -- matching the acc_guard
          // bar / icon sizing immediately above, which are also drawn in
          // raw x/y screen space rather than cell-snapped).
          const siTintColor = tintRedSet.has(a.uid) ? TINT_RED : tintYellowSet.has(a.uid) ? TINT_YELLOW : null;
          if (siTintColor !== null) {
            const siTint = new Graphics();
            siTint.circle(x, y, 16);
            siTint.fill({ color: siTintColor, alpha: TINT_ALPHA });
            siTint.eventMode = 'none'; // decorative tint overlay, see constructor note
            g.addChild(siTint);
          }
          const hitCircle = new Graphics();
          hitCircle.circle(x, y, 15);
          hitCircle.fill({ color: '#000000', alpha: 0.001 });
          g.addChild(hitCircle);
          // REQ-0290: mirror of handlePOPointerDown's fixed-PO short-circuit --
          // never lift, flash the cell instead. Tap-to-inspect (pointerup) is
          // untouched: a locked SI is still inspectable, just not draggable.
          g.on('pointerdown', (e: FederatedPointerEvent) => {
            if (siLocked) { flash(this, [cellAt(this, x, y)]); return; }
            this.beginDrag(e, 'si', a.uid, undefined);
          });
          g.on('pointerup', () => this.handleItemTap('si', a.id, { x: x - 16, y: y - 16, w: 32, h: 32 }, a.uid));
          this.gSock.addChild(g);
        } else {
          const g = new Graphics();
          g.eventMode = 'none'; // decorative empty-socket outline, see constructor note
          if (s.t === 'bond') {
            g.roundRect(x - 23, y - 7, 46, 14, 6);
            g.stroke({ color: '#b08340', width: 1.5, alpha: 0.8 });
            this.gSock.addChild(g);
          } else {
            g.circle(x, y, 9);
            g.fill({ color: '#0e0d0b', alpha: 0.5 });
            g.stroke({ color: '#b08340', width: 1.5, alpha: 0.8 });
            // Graphics has allowChildren=false in PixiJS v8 (it's a leaf
            // "view" node, like Sprite/Text) -- calling g.addChild(glyph)
            // directly triggers the "addChild: Only Containers will be
            // allowed to add children in v8.0.0" deprecation warning (the
            // only console warning this app produced). Fixed by wrapping
            // both the Graphics and the Text in a plain Container (which
            // does allow children) and adding that to gSock instead.
            const glyph = new Text({
              text: SOCK_GLYPH[s.t] ?? '?',
              style: { fill: '#b08340', fontSize: 9 },
            });
            glyph.anchor.set(0.5);
            glyph.x = x;
            glyph.y = y + 1;
            glyph.eventMode = 'none'; // decorative, see constructor note
            const wrap = new Container();
            wrap.eventMode = 'none'; // decorative, see constructor note
            wrap.addChild(g, glyph);
            this.gSock.addChild(wrap);
          }
        }
      });
    }

    // Free-placed SIs (REQ-0030 Phase 2, inventory-only): an SI whose host
    // is a page-local {page,cell} object occupies exactly 1 cell with no
    // hosting PO -- rendered as a plain icon + drag-source hit circle,
    // same visual language as a seated SI's icon but centered in its own
    // grid cell instead of anchored to a socket position. Canvas SIs never
    // take this host shape (SIs cannot be free-placed on canvas), so this
    // block is a no-op there (container.sis' host is always 'inv'/'bond'/
    // {po,si} on canvas).
    for (const a of container.sis) {
      if (!a.host || typeof a.host !== 'object' || !('cell' in a.host)) continue;
      if (carriedUids.has(a.uid)) continue;
      const [r, c] = (a.host as { cell: Cell }).cell;
      const x = cx(c);
      const y = cy(r);
      const siDef = this.deps.siDefs[a.id];
      const g = new Container();
      g.eventMode = 'static';
      g.cursor = 'grab';
      const bg = new Graphics();
      bg.roundRect(PAD + (c - 1) * CELL + 6, PAD + (r - 1) * CELL + 6, CELL - 12, CELL - 12, 6);
      bg.fill({ color: '#000000', alpha: 0.22 });
      bg.eventMode = 'none';
      g.addChild(bg);
      // REQ-0033 Phase 2: free-placed SI usage tint (inventory-only, same
      // as every other tint call site -- see the drawTintOverlay doc
      // comment near `container`/`cbp` above for the color/alpha choice).
      drawTintOverlay(g, [[r, c]], a.uid, tintRedSet, tintYellowSet);
      // REQ-0287: ownership ribbon over the SI single-cell footprint.
      const siRibbonBbox = cellsBBoxPx([[r, c]]);
      paintUsageRibbons(this, a.uid, siRibbonBbox, siRibbonBbox, tintRedSet, tintYellowSet);
      if (siDef) {
        const tex = itemTex(textures, a.id, siDef.icon);
        if (tex) {
          const sprite = new Sprite(tex);
          sprite.x = x - 18;
          sprite.y = y - 18;
          sprite.width = 36;
          sprite.height = 36;
          sprite.eventMode = 'none';
          g.addChild(sprite);
        }
      }
      const hitRect = new Graphics();
      hitRect.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
      hitRect.fill({ color: '#000000', alpha: 0.001 });
      g.addChild(hitRect);
      g.on('pointerdown', (e: FederatedPointerEvent) => this.beginDrag(e, 'si', a.uid, undefined));
      g.on('pointerup', () => this.handleItemTap('si', a.id, { x: PAD + (c - 1) * CELL, y: PAD + (r - 1) * CELL, w: CELL, h: CELL }, a.uid));
      this.gItems.addChild(g);
    }

    // Force an immediate render pass (REQ-0027 T0.2 interaction bug fix,
    // root cause #2): PixiJS's EventBoundary resolves hit targets against
    // `renderer.lastObjectRendered`, which is ONLY ever assigned inside
    // renderer.render() -- normally invoked automatically once per frame
    // by the Application's Ticker (via TickerPlugin -> app.render() ->
    // renderer.render({container: stage})). That auto-render loop is
    // driven by requestAnimationFrame, which browsers suspend/throttle
    // for backgrounded or non-visible tabs (document.hidden) -- so on a
    // tab that hasn't had a chance to paint a real animation frame yet
    // (or one the browser has deprioritized), `lastObjectRendered` can
    // stay stale/unset indefinitely, and EVERY pointer event resolves to
    // the wrong hit-test root (observed: every click hit-tested as the
    // bare stage Container, never any actual PO/BP/SI target). This board
    // has no continuous animation -- it only needs to redraw when
    // `render(state)` is called (i.e. on a real state change) -- so it
    // must not depend on an implicit, timing-sensitive animation-frame
    // loop for event-routing correctness. Rendering synchronously here
    // makes hit-testing correct immediately after every state change,
    // independent of tab visibility/ticker timing.
    // REQ-0345: that auto-render loop is now gone for good (mount() passes
    // autoStart:false), so this call is no longer merely an ordering fix for
    // hit-testing -- it is the ONLY thing that puts a state change on screen.
    // It stays SYNCHRONOUS rather than going through requestRender() for
    // exactly the reason above: lastObjectRendered must be correct before the
    // caller's next pointer event, not one animation frame later.
    // REQ-0287: publish this board's ribbon probe snapshot (e2e read seam).
    publishRibbonProbe(boardIdKey(this.boardId), this.usageRibbonProbe);
    // REQ-0290: ditto for the affordance (cursor) snapshot.
    publishCursorProbe(boardIdKey(this.boardId), this.cursorProbe);
    this.paintNow();
  }
  /**
   * Screen (board-canvas-local pixel) position of a socket -- REQ-0027
   * T0.2, generalized REQ-0030 Phase 2 (works for a page's pageSockets()
   * output identically -- Socket's shape is the same on both boards).
   * Mirrors the mock's inline math in renderAll()'s sockets block and
   * pointermove's 'si' branch (both duplicate the same computation there;
   * consolidated into one helper here). Two cases:
   *  - host==='bond': the Blade-Hilt bond socket (canvas only), positioned
   *    at the hilt's top cell edge (asm.hilt.cell's row, one cell up from
   *    center).
   *  - per-PO socket: the socket's ax/ay anchor fractions (0..1 of the
   *    PO's UNROTATED bbox) mapped through the PO's current rotation via
   *    mapPt(), then offset by the PO's screen-space box origin.
   * Returns null if the socket cannot be positioned (e.g. bond socket but
   * no assembly currently exists, or the hosting PO isn't in THIS board's
   * container).
   */
  handleBPPointerDown(e: FederatedPointerEvent, bpId: string): void {
    if (getCarry()) return;
    const now = performance.now();
    const last = this.lastBPPointerDown.get(bpId);
    this.lastBPPointerDown.delete(bpId);
    if (last !== undefined && now - last <= DBLCLICK_WINDOW_MS) {
      const { ops } = this.deps;
      // REQ-0367: arm only on SUCCESS -- a refused rotate must not
      // overwrite a slot armed by an earlier successful mutation with a
      // copy that undoes nothing. The copy is still taken BEFORE the
      // mutator runs (spec item 2).
      const undoCopy = captureUndoState();
      const r = ops.rotateBP(this.lastState!, bpId);
      if (r.ok) { armUndoFrom(undoCopy); notifyStateChanged(); }
      else flash(this, r.cells);
      return;
    }
    this.lastBPPointerDown.set(bpId, now);
    this.beginDrag(e, 'bp', bpId, bpId);
  }

  handlePOPointerDown(
    e: FederatedPointerEvent,
    p: PO,
    isAssemblyPart: boolean,
    asm: Assembly | null
  ): void {
    if (getCarry()) return; // matches mock's `if(carry)return` guard (dblclick) / `if(carry||!kind)return` (startCarry)
    // REQ-0051: a starter-unit fixed PO is pinned in its BP -- it neither
    // drags nor double-click-rotates (the engine refuses both). Short-circuit
    // so it never even lifts, with a brief locked-cells flash for feedback.
    if (p.fixed) { flash(this, this.deps.engine.cellsOf(this.lastState!, p)); return; }
    const now = performance.now();
    const last = this.lastPointerDown.get(p.uid);
    this.lastPointerDown.delete(p.uid);
    if (last !== undefined && now - last <= DBLCLICK_WINDOW_MS) {
      // Double-click: rotate in place. rotatePO always targets the PO
      // whose uid started the carry-equivalent gesture -- for an assembled+
      // linked pair this is always the blade (matches the mock's asm block
      // calling `E.rotatePO(state,asm.blade.uid)`). Assembly only ever
      // exists on the canvas board (isAssemblyPart is always false on an
      // inventory board, since `asm` there is always null).
      const rotateUid = isAssemblyPart && asm ? asm.blade.uid : p.uid;
      const undoCopy = captureUndoState(); // REQ-0367: arm-on-success, see handleBPPointerDown.
      const r = this.deps.ops.rotatePO(this.lastState!, rotateUid);
      if (r.ok) { armUndoFrom(undoCopy); notifyStateChanged(); }
      else flash(this, r.cells);
      return;
    }
    this.lastPointerDown.set(p.uid, now);
    // Kind selection mirrors the mock exactly: an assembled+linked blade/
    // hilt drags as 'asm' (the whole assembly), everything else as 'po'.
    const kind = isAssemblyPart ? 'asm' : 'po';
    this.beginDrag(e, kind, isAssemblyPart && asm ? asm.blade.uid : p.uid, undefined);
  }

  /** Starts a carry from a Pixi pointerdown event (board-originated drag:
   * PO, assembly, BP/unit, or a free-placed/seated SI). Computes grabOff
   * in CELL space, matching the mock's startCarry() branches per kind.
   * `originBoard` is always THIS renderer's own board id -- a drag always
   * starts on the board the pointerdown fired on. */
  beginDrag(e: FederatedPointerEvent, kind: CarryState['kind'], uid: string, bpId?: string): void {
    if (getCarry()) return;
    const state = this.lastState;
    if (!state) return;
    const { engine, ops } = this.deps;
    const container = ops.container(state);
    const local = { x: e.global.x, y: e.global.y };
    const cell = cellAt(this, local.x, local.y);
    let grabOff: [number, number] = [0, 0];
    if (kind === 'po') {
      const p = container.pos.find((z) => z.uid === uid);
      if (p && p.loc === 'grid' && p.cell) grabOff = [cell[0] - p.cell[0], cell[1] - p.cell[1]];
    } else if (kind === 'asm') {
      const asm = ops.isCanvas ? engine.assembly(state) : null;
      if (asm) grabOff = [cell[0] - asm.anchor[0], cell[1] - asm.anchor[1]];
    } else if (kind === 'bp' && bpId) {
      const bp = container.bps.find((b) => b.id === bpId);
      if (bp) grabOff = [cell[0] - bp.origin[0], cell[1] - bp.origin[1]];
    }
    startCarry({ kind, uid, bpId, originBoard: this.boardId, sx: e.clientX, sy: e.clientY, grabOff });
  }

  /** REQ-0119: a single-tap on an item icon floats the styleguide tooltip
   * panel for that item (FloatingItemTip.tsx renders it; itemTip.ts is the
   * pub-sub seam). Called from each interactive item's own Pixi 'pointerup'.
   * A tap that ARMED a drag is a move, not a tap -- getCarry().armed is
   * still true here (this object 'pointerup' is dispatched during PixiJS's
   * document-capture-phase processing, BEFORE drag.ts's bubble-phase window
   * 'pointerup' clears the carry) -- so it is filtered out. A double-tap
   * (rotate) leaves no carry and re-floats the now-rotated item's tip
   * idempotently: the intended immediate, non-toggle behavior (closing is
   * via an outside/empty tap, never a re-tap). `box` is the icon footprint
   * in this board's local pixel space; localBoxToClient maps it to the
   * viewport for the HTML overlay. */
  handleItemTap(kind: 'po' | 'si', id: string, box: { x: number; y: number; w: number; h: number }, uid?: string): void {
    if (getCarry()?.armed) return;
    const anchor = localBoxToClient(this, box.x, box.y, box.w, box.h);
    showItemTip({ kind, id, uid, anchor, boardKey: boardIdKey(this.boardId) });
  }

  /** Dismiss the floating tip when a tap lands on EMPTY board space (the
   * stage's own hitArea, e.target === stage) rather than on an item's hit
   * graphic. Item taps set e.target to their own hit object (and float or
   * switch the tip via that object's 'pointerup'), so this only ever fires
   * the CLEAR for genuinely empty taps -- the "tap outside/empty to close"
   * dismissal (REQ-0119). */
  onStagePointerUp = (e: FederatedPointerEvent): void => {
    if (e.target === this.app.stage) clearItemTip();
  };

  /** REQ-0142: the pointer left this board's canvas -- nothing is being
   * interrogated any more. (pointermove cannot report this: it simply stops
   * firing once the pointer is gone, leaving the last hover stuck on.) */
  onCanvasPointerLeave = (): void => {
    clearBeamHoverForBoard(boardIdKey(this.boardId));
  };

  /** REQ-0142: hover interrogation rides a PLAIN DOM pointermove on this
   * board's own <canvas>, NOT PixiJS's stage 'globalpointermove'.
   *
   * Two reasons, and both matter:
   *   1. globalpointermove is the DRAG channel (onGlobalPointerMove below),
   *      whose very first line returns unless a carry is in flight -- and
   *      hover is precisely the no-carry case. Hanging hover off the same
   *      event would have entangled two unrelated interactions in one
   *      handler, with the drag's own semantics (and Pixi's hit-test
   *      bookkeeping) sitting between the pointer and the answer.
   *   2. A DOM listener on the canvas is scoped to THIS board by
   *      construction: it fires only when the pointer is actually over this
   *      canvas, so no cross-board coordinate confusion is even possible
   *      (the hazard onGlobalPointerMove documents at length, since Pixi's
   *      EventSystem listens on `document` and fires BOTH boards' stages for
   *      every native move).
   * Hover must also never perturb hit-testing: no Pixi interactive object is
   * added for it, so a beam crossing a BP cell can never swallow that cell's
   * own pointerdown (the BP drag handle). Pure read, zero interference. */
  onCanvasPointerMove = (e: PointerEvent): void => {
    this.updateBeamHover(e.clientX, e.clientY);
  };

  /** REQ-0142: resolve what the pointer is interrogating, and publish it.
   *
   * Priority is Unit core FIRST, beam segment second: a beam passing through
   * a Unit's own cell must never out-compete that Unit (the core is the
   * richer subject -- its whole 8-direction fan -- and it is what the player
   * is pointing at). Both hits are computed against this board's OWN drawn
   * geometry (unitCell + this.beamSegs, rebuilt by render()), so the hover
   * target can never drift from the pixels.
   *
   * Canvas board only: an inventory page's Units are DORMANT (REQ-0030) --
   * they fire no beams, so there is nothing there to trace.
   */
  updateBeamHover(clientX: number, clientY: number): void {
    if (this.disposed || !this.lastState) return;
    const { engine, ops } = this.deps;
    if (!ops.isCanvas) return;
    const boardKey = boardIdKey(this.boardId);
    // A drag in flight is not an interrogation -- get out of the way (the
    // same reason the item tip hides the moment a carry arms).
    if (getCarry()) {
      clearBeamHoverForBoard(boardKey);
      return;
    }
    // globalpointermove fires on EVERY mounted board's stage for EVERY native
    // pointermove -- including the board the pointer is not physically over
    // (see this handler's own REQ-0031 note below). So a board must first ask
    // whether the pointer is even on it, or the canvas board would happily
    // publish a hover computed from a pointer sitting over the inventory.
    const rect = this.app.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      clearBeamHoverForBoard(boardKey);
      return;
    }
    const { x, y } = clientToLocal(this, clientX, clientY);
    const container = ops.container(this.lastState);
    for (const bp of container.bps) {
      const lc = engine.unitCell(bp);
      const ux = cx(lc[1]);
      const uy = cy(lc[0]);
      if (Math.hypot(x - ux, y - uy) <= UNIT_CORE_RADIUS) {
        setBeamHover({
          bp: bp.id,
          dir: null,
          anchor: localBoxToClient(this, ux - UNIT_CORE_RADIUS, uy - UNIT_CORE_RADIUS, UNIT_CORE_RADIUS * 2, UNIT_CORE_RADIUS * 2),
          boardKey,
        });
        return;
      }
    }
    let best: (typeof this.beamSegs)[number] | null = null;
    let bestDist = BEAM_HOVER_SLOP;
    for (const seg of this.beamSegs) {
      const d = pointSegDistance(x, y, seg.x0, seg.y0, seg.x1, seg.y1);
      if (d <= bestDist) {
        bestDist = d;
        best = seg;
      }
    }
    if (best) {
      const mx = (best.x0 + best.x1) / 2;
      const my = (best.y0 + best.y1) / 2;
      setBeamHover({
        bp: best.from,
        dir: best.dir,
        anchor: localBoxToClient(this, mx - 12, my - 12, 24, 24),
        boardKey,
      });
      return;
    }
    clearBeamHoverForBoard(boardKey);
  }

  /** Wires stage-wide pointermove (arm + legality preview + ghost) and
   * window keydown (Esc cancel). Called once from the constructor. Also
   * registers this board's BoardCommitApi (drag.ts) and ensures the
   * SINGLE shared window pointerup listener is installed (idempotent --
   * see drag.ts's ensurePointerUpWired doc). REQ-0030 Phase 2: pointerup
   * itself is no longer wired per-instance (was `window.addEventListener
   * ('pointerup', this.onWindowPointerUp)` pre-Phase-2) -- centralizing it
   * is what makes a drag that ends on the OTHER board resolve exactly
   * once (see drag.ts module comment). */
  wireGlobalInteraction(): void {
    this.app.stage.on('globalpointermove', this.onGlobalPointerMove);
    this.app.stage.on('pointerup', this.onStagePointerUp);
    window.addEventListener('keydown', this.onWindowKeyDown);
    // REQ-0142: hover interrogation (see onCanvasPointerMove for why this is
    // a DOM listener on the canvas rather than a Pixi stage event), plus the
    // pointer LEAVING the canvas entirely -- which pointermove cannot report,
    // since it simply stops firing once the pointer is gone.
    this.app.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    this.app.canvas.addEventListener('pointerleave', this.onCanvasPointerLeave);
    // REQ-0142: beam hover is not game state (it lives in beamHover.ts's
    // pub-sub, exactly like drag.ts's carry), so the store will never tell
    // this board to repaint when it changes -- subscribe and repaint here.
    // render() is the ONLY place that reads the hover, so a repaint of the
    // last state is a complete, correct response to any hover change.
    this.unsubscribeHover = subscribeBeamHover(() => {
      if (!this.disposed && this.lastState) this.render(this.lastState);
    });
    ensurePointerUpWired();
    this.unregisterBoard = registerBoard(this.boardId, makeCommitApi(this));
    // Re-render ghost/target layers whenever drag.ts's carry state changes
    // for reasons other than a pointermove THIS instance already handles
    // inline below (e.g. the carry being cleared by the OTHER board's
    // commit, or by the centralized pointerup handler after an unresolved
    // drop) -- keeps this board's ghost/legality-tint in sync regardless
    // of where the drag began or ended.
    this.unsubscribeCarry = subscribeCarry(() => {
      const carry = getCarry();
      if (!carry) {
        this.gCarry.removeChildren();
        this.gTarget.removeChildren();
        this.ghostProbe = null; // REQ-0288: carry ended
        this.armRendered = false; // REQ-0288: re-arm the one-shot for the next carry
        // REQ-0345: an unresolved drop (outside both boards, or on a tab
        // button) clears the overlays with NO engine call and therefore no
        // notifyStateChanged()/render() -- nothing else would repaint here.
        this.requestRender();
      }
    });
  }

  /** Builds this board's BoardCommitApi (registered with drag.ts's board
   * registry) -- the centralized pointerup handler calls into these
   * closures, which bind `this.lastState`/`this.deps.ops`/`this.deps.engine`
   * for THIS specific board (canvas or one inventory page). Handles both
   * same-board commits (drop.board === carry.originBoard) and cross-board
   * transfers (BP: engine.transferBP; PO/SI: ops.movePO/moveSI/seatSI
   * bound to the DESTINATION board, since a PO/SI "moving board" is really
   * just "stop existing in the source board's arrays, start existing in
   * the destination's" -- which for a PO/SI (unlike a BP-with-contents) is
   * not a thing the CURRENT engine surface does atomically... see inline
   * notes at each commit method below for exactly how each kind's
   * cross-board case is handled. */
  onGlobalPointerMove = (e: FederatedPointerEvent): void => {
    const carry = getCarry();
    if (!carry || !this.lastState) return;
    if (!carry.armed) {
      if (Math.hypot(e.clientX - carry.sx, e.clientY - carry.sy) < DRAG_ARM_THRESHOLD) return;
      armCarry();
    }
    // Re-render so the carried item's original-position art disappears
    // (matches the mock's `hideTip();renderAll();` on arm) -- the carriedUids
    // computation in render() reads getCarry() fresh. Only the ORIGIN board
    // needs this (a cross-board carry's item never rendered on the destination
    // board in the first place).
    //
    // REQ-0288 -- WHY THIS IS NOT INSIDE THE `!carry.armed` BRANCH ABOVE.
    // Every Pixi Application's EventSystem listens on `document`, so BOTH
    // boards run this handler for EVERY pointermove (the REQ-0031 note just
    // below spells that out). armCarry() is global and one-shot: whichever
    // board's handler crosses the threshold first arms the carry. With the
    // repaint inside that branch, an origin board that LOST the race saw
    // `carry.armed === true` on its own pass, skipped the branch, and never
    // repainted -- the item stayed fully painted at its origin. Which board
    // won was pure mount order, so this was a silent, order-dependent flake
    // for the PO hide-in-place case long before REQ-0288; the BP lift shadow
    // simply made it impossible to miss (found by reading the evidence
    // screenshot, NOT by a gate -- the gate was the screenshot).
    // The latch keeps it one repaint per carry, not one per pointermove.
    if (carry.armed && !this.armRendered && boardIdEquals(carry.originBoard, this.boardId)) {
      this.armRendered = true;
      this.render(this.lastState);
    }
    // REQ-0031 Phase A bug fix (BP inventory<->canvas transfer sometimes
    // silently failing): every PixiJS Application's EventSystem listens
    // for native `pointermove` on `document` itself (see PixiJS's
    // EventSystem.addEvents: `globalThis.document.addEventListener
    // ('pointermove', this._onPointerMove, true)`), NOT scoped to that
    // Application's own <canvas> bounds. Since the canvas board and the
    // inventory board are TWO independent PixiJS Applications, EVERY
    // mouse move during a drag fires `globalpointermove` on BOTH boards'
    // stages -- including the board the pointer is NOT physically over,
    // which then maps the pointer's (foreign) screen coordinates into ITS
    // OWN local cell space and computes a nonsense (usually out-of-bounds
    // or bogusly-legal) cell, then unconditionally calls updateCarry(),
    // clobbering whatever `carry.drop` the CORRECT board (the one the
    // pointer is actually over) had just set. Confirmed live: a CDP-
    // captured trace of a failing drag showed the canvas board correctly
    // computing `{ok:true, drop:{origin:[6,4]}}` on the pointer's real
    // final position, immediately followed by the INVENTORY board's
    // handler for the SAME native event overwriting `carry.drop` back to
    // null (it mapped the same screen point into its own coordinate
    // space, got an out-of-page cell, and legitimately reported "outside
    // page" -- but that result is meaningless since the pointer was never
    // over the inventory board at that moment). Listener registration
    // order made this a race that failed roughly half the time depending
    // on drag speed/sample count. Fix: a board only acts as the authority
    // for a move event when the pointer is ACTUALLY within its own
    // canvas's current bounding rect; otherwise it clears its own
    // ghost/target visuals (the pointer left it) but does NOT touch
    // `carry.drop` at all, leaving that decision to whichever board's
    // handler for this SAME event finds the pointer genuinely inside its
    // own bounds.
    const rect = this.app.canvas.getBoundingClientRect();
    const withinBounds = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!withinBounds) {
      this.gCarry.removeChildren();
      this.gTarget.removeChildren();
      this.ghostProbe = null; // REQ-0288: the pointer left this board
      this.requestRender(); // REQ-0345: the ghost/tint just went away -- repaint without them
      return;
    }
    const local = clientToLocal(this, e.clientX, e.clientY);
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    this.ghostProbe = null; // REQ-0288: repopulated by whichever branch draws
    const state = this.lastState;
    const { engine, ops } = this.deps;
    const cell = cellAt(this, local.x, local.y);
    const sameBoard = boardIdEquals(carry.originBoard, this.boardId);

    const paint = (cells: Cell[] | undefined, ok: boolean) => {
      for (const [r, c] of cells ?? []) {
        if (r < 1 || r > this.deps.layout.ROWS || c < 1 || c > this.deps.layout.COLS) continue;
        const rect = new Graphics();
        rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
        rect.fill({ color: ok ? OVERLAY.dropTarget.ok.color : OVERLAY.dropTarget.bad.color, alpha: 0.25 });
        rect.stroke({ color: ok ? OVERLAY.dropTarget.ok.color : OVERLAY.dropTarget.bad.color, width: 2 });
        this.gTarget.addChild(rect);
      }
    };

    let drop: DropTarget | null = null;
    if (carry.kind === 'po') {
      const anchor: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
      // PO rot/def for the ghost sprite always come from the ORIGIN
      // board's container (the PO physically still lives there until
      // commit) -- read-only peek, matches carry semantics elsewhere.
      const originContainer = carry.originBoard.loc === 'canvas' ? state : state.inv!.pages[carry.originBoard.page];
      const p = originContainer.pos.find((z) => z.uid === carry.uid);
      if (p) {
        // REQ-0033 Phase 2: a canvas-originated PO hovering an INVENTORY
        // board is always a reference REMOVAL on commit (removeRef),
        // which per spec always succeeds and ignores the drop cell
        // entirely ("ghost should communicate 'return' e.g. neutral
        // tint, never red for legality since removal always succeeds").
        // Skip canPlacePO/previewCrossBoardPO's geometric check
        // completely for this direction -- there is no geometric
        // legality question to ask, since the home position is untouched
        // regardless of where the pointer happens to be -- and paint a
        // neutral (not green, not red) "will return to inventory"
        // indicator at the hovered cell instead. `drop` still needs a
        // concrete DropTarget so the centralized pointerup commit has
        // somewhere to route to (commitPODrop for this direction ignores
        // drop.anchor entirely, so the exact cell recorded here is moot).
        let probeCells: Cell[] = [anchor]; // REQ-0288 ghost probe
        if (carry.originBoard.loc === 'canvas' && this.boardId.loc === 'inv') {
          drop = { type: 'grid', anchor, board: this.boardId };
          paintNeutralReturn(this, anchor);
        } else {
          const chk = sameBoard
            ? ops.canPlacePO(state, p.uid, p.rot, anchor)
            : previewCrossBoardPO(this, state, p.uid, carry.originBoard, p.rot, anchor);
          drop = chk.ok ? { type: 'grid', anchor, board: this.boardId } : null;
          paint(chk.cells, chk.ok);
          probeCells = chk.cells;
        }
        const def = this.deps.items[p.id];
        const { w, h } = engine.shapeInfo(p.id, p.rot);
        const hasArt = renderGhostPO(this, p, def, local.x - (w * CELL) / 2, local.y - (h * CELL) / 2);
        this.ghostProbe = { kind: 'po', cells: probeCells, hasArt, legal: drop !== null };
      }
    } else if (carry.kind === 'asm') {
      // Assemblies are canvas-only -- a cross-board 'asm' carry never
      // occurs (asm can't exist while carried onto/from an inventory
      // board, see render()'s isCanvas guard), so this branch only ever
      // runs meaningfully when sameBoard && ops.isCanvas.
      if (ops.isCanvas) {
        const asm = engine.assembly(state);
        if (asm) {
          const anchor: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
          const chk = engine.canPlaceAssembly(state, anchor);
          drop = chk.ok ? { type: 'grid', anchor, board: this.boardId } : null;
          paint(chk.cells, chk.ok);
          renderGhostAssembly(this, asm, local.x, local.y);
          this.ghostProbe = { kind: 'asm', cells: chk.cells, hasArt: true, legal: chk.ok }; // REQ-0288
        }
      }
    } else if (carry.kind === 'bp' && carry.bpId) {
      const originContainer = carry.originBoard.loc === 'canvas' ? state : state.inv!.pages[carry.originBoard.page];
      const bp = originContainer.bps.find((b) => b.id === carry.bpId);
      if (bp) {
        const origin: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
        const chk = sameBoard
          ? ops.canMoveBP(state, carry.bpId, origin)
          : engine.canTransferBP(state, carry.originBoard, this.boardId, carry.bpId, origin);
        drop = chk.ok ? { type: 'bp', origin, board: this.boardId } : null;
        paint(chk.cells, chk.ok);
        // REQ-0288: the WHOLE bag ghosts at the snapped origin, legal or not
        // (illegal reads dimmer, under the red target paint above) -- with
        // its unit disc and contained-PO art riding along.
        const hasArt = renderGhostBP(this, originContainer, bp, origin, chk.ok);
        this.ghostProbe = {
          kind: 'bp',
          cells: bp.shape.map(([dr, dc]) => [origin[0] + dr, origin[1] + dc] as Cell),
          hasArt,
          legal: chk.ok,
        };
      }
    } else if (carry.kind === 'si') {
      const originContainer = carry.originBoard.loc === 'canvas' ? state : state.inv!.pages[carry.originBoard.page];
      const a = originContainer.sis.find((z) => z.uid === carry.uid);
      if (a) {
        // REQ-0033 Phase 2: same neutral-return special-case as the 'po'
        // branch above -- a canvas-originated SI hovering an INVENTORY
        // board is always a reference REMOVAL on commit (removeRef),
        // which always succeeds and ignores the drop cell entirely. Skip
        // the socket search AND the free-cell geometric check completely
        // for this direction (neither hostOk/previewCrossBoardSocket nor
        // canPlaceSI/previewCrossBoardSIFreeCell have any bearing on
        // whether the removal will succeed -- it always will), and paint
        // a neutral "will return to inventory" indicator instead.
        if (carry.originBoard.loc === 'canvas' && this.boardId.loc === 'inv') {
          drop = { type: 'grid', anchor: cell, board: this.boardId };
          paintNeutralReturn(this, cell);
        } else {
          const asm = ops.isCanvas ? engine.assembly(state) : null;
          let best: { s: Socket; v: { ok: boolean; why?: string } } | null = null;
          let bd = SOCKET_SEARCH_RADIUS;
          for (const s of ops.sockets(state)) {
            const pos = socketScreenPos(this, state, s, asm);
            if (!pos) continue;
            const v = sameBoard ? ops.hostOk(state, carry.uid, s) : previewCrossBoardSocket(this, state, carry.uid, carry.originBoard, s);
            const dist = Math.hypot(pos.x - local.x, pos.y - local.y);
            const ring = new Graphics();
            ring.circle(pos.x, pos.y, 12);
            ring.stroke({ color: v.ok ? OVERLAY.dropTarget.ok.color : OVERLAY.dropTarget.bad.color, width: 2, alpha: dist < bd ? 1 : 0.55 });
            this.gTarget.addChild(ring);
            if (dist < bd) {
              bd = dist;
              best = { s, v };
            }
          }
          if (best && best.v.ok) {
            drop = { type: 'sock', skey: best.s.skey, board: this.boardId };
          } else {
            // No socket hit -- a free inventory cell is a valid drop target
            // (REQ-0030: free-placed SIs); canvas has no free-cell concept
            // for SIs, so ops.canPlaceSI there always reports failure and
            // this simply paints red/no-drop, matching pre-Phase-2 behavior
            // for "dropped on empty canvas space".
            const freeChk = sameBoard
              ? ops.canPlaceSI(state, carry.uid, cell)
              : previewCrossBoardSIFreeCell(this, state, carry.uid, carry.originBoard, cell);
            if (freeChk.ok) {
              drop = { type: 'grid', anchor: cell, board: this.boardId };
              paint(freeChk.cells, true);
            } else if (!ops.isCanvas) {
              paint(freeChk.cells.length ? freeChk.cells : [cell], false);
            }
          }
        }
        const siDef = this.deps.siDefs[a.id];
        let siHasArt = false; // REQ-0288 ghost probe
        if (siDef) {
          const tex = itemTex(this.deps.textures, a.id, siDef.icon);
          if (tex) {
            siHasArt = true;
            const sprite = new Sprite(tex);
            sprite.x = local.x - 16;
            sprite.y = local.y - 16;
            sprite.width = 32;
            sprite.height = 32;
            sprite.alpha = 0.85;
            this.gCarry.addChild(sprite);
          }
        }
        this.ghostProbe = { kind: 'si', cells: [cell], hasArt: siHasArt, legal: drop !== null }; // REQ-0288
      }
    }
    updateCarry(local.x, local.y, drop);
    // REQ-0345: everything above rebuilt gCarry/gTarget for this pointer
    // position. Coalesced, so a fast drag paints once per frame, not once per
    // native pointermove.
    this.requestRender();
  };

  /** Cross-board socket legality preview for an SI -- splices the SI
   * across, runs hostOk (bound to THIS board's state/def lookup, which is
   * container-independent already -- see boardOps.ts's makeInvOps note),
   * then unsplices. Same rationale as previewCrossBoardPO. */
  onWindowKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && getCarry()) {
      cancelCarryWithFeedback(); // REQ-0288: the origin board flashes "snapped home"
      this.gCarry.removeChildren();
      this.gTarget.removeChildren();
      // REQ-0345: render(state) paints; the no-state case still has cleared
      // layers to get rid of.
      if (this.lastState) this.render(this.lastState);
      else this.requestRender();
    }
  };

  /** Ghost PO art following the pointer during a drag -- reuses the same
   * rotation-aware art placement as the placed-PO rendering above
   * (drawPOArt equivalent), at reduced opacity, matching the mock's
   * `opacity:.75` ghost. */
  // REQ-0047 (f2-3): public delegate -- implementation in ./ghosts (external
  // callers: WarehouseTab/WorkshopPage hold a renderer instance).
  pulseCellsSuccess(cells: Cell[] | undefined): void {
    pulseCellsSuccess(this, cells);
  }
}
