// PixiJS board renderer — REQ-0026 T0.1 (read-only), extended REQ-0027 T0.2
// with edit interactions (drag/drop, rotate, BP move, SI seat/unseat),
// extended REQ-0030 Phase 2 to be a SHARED renderer for both the canvas
// board and any inventory-page board (5 tabs) rather than a canvas-only
// class. Framework-free (no React here); layout constants (CELL/PAD) and
// the overall composition mirror mock-src/ui.js's SVG renderAll() for
// visual parity (same reference, not pixel-exact): grid cells tinted by BP
// (canvas only -- see REQ-0030 note below), BP outlines + name/HP label,
// linker cores + direction dots (canvas: full; inventory: dimmed core, no
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
// mock-src/engine.js's canvas-only functions directly for legality/
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
// combos/beams; a BP's linker is rendered but DORMANT -- dimmed, no beams,
// no direction dots).
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Assembly, Cell, EngineInstance, GameState, ItemDefMap, Layout, PO, SIDefMap, Socket } from '../engine/engine.d.ts';
import {
  armCarry,
  boardIdEquals,
  cancelCarry,
  ensurePointerUpWired,
  getCarry,
  registerBoard,
  startCarry,
  subscribeCarry,
  updateCarry,
  type BoardCommitApi,
  type BoardId,
  type CarryState,
  type DropTarget,
} from './drag';
import type { BoardOps } from './boardOps';
import { notifyStateChanged } from '../store';

const SOCK_GLYPH: Record<string, string> = { gem: '◆', edge: '▷', coat: '●', bond: '▬' };
// Nearest-socket search radius in board-canvas pixels — CELL is 80 in both
// the mock and this renderer, so the mock's absolute-pixel threshold (26px)
// ports directly with no rescaling.
const SOCKET_SEARCH_RADIUS = 26;
// Plain-click vs drag threshold, pixels — same as the mock's
// `Math.hypot(dx,dy) < 5`.
const DRAG_ARM_THRESHOLD = 5;
// Double-click detection window, ms — Pixi's federated events do not expose
// a native multi-click/dblclick concept the way DOM elements do, so this is
// tracked manually: a second pointerdown on the SAME uid within this window
// (with the first pointerdown never having armed a drag) is treated as a
// double-click-rotate, mirroring the mock's native SVG `dblclick` listener
// behaviorally (not mechanically).
const DBLCLICK_WINDOW_MS = 300;
// Reject-flash duration, ms — matches the mock's flash()'s `setTimeout(...,
// 350)`.
const FLASH_MS = 350;
// Inventory linker dormancy visual (REQ-0030): dimmed core alpha, vs the
// canvas core's alpha (0.5 stroke / 0.55 fill, see render()).
const INV_LINKER_ALPHA = 0.22;

const CELL = 80;
const PAD = 38;
const DIR_ANGLES: Record<number, number> = {
  0: -90,
  1: -45,
  2: 0,
  3: 45,
  4: 90,
  5: 135,
  6: 180,
  7: -135,
};

function cx(c: number): number {
  return PAD + (c - 1) * CELL + CELL / 2;
}
function cy(r: number): number {
  return PAD + (r - 1) * CELL + CELL / 2;
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
function mapPt(k: number, x: number, y: number, W0: number, H0: number): [number, number] {
  const kk = k % 4;
  if (kk === 0) return [x, y];
  if (kk === 1) return [H0 - y, x];
  if (kk === 2) return [W0 - x, H0 - y];
  return [y, W0 - x];
}

export class BoardRenderer {
  private app: Application;
  private root = new Container();
  private gBase = new Container();
  private gBeams = new Container();
  private gItems = new Container();
  private gSock = new Container();
  private gLinkers = new Container();
  private gChain = new Container();
  private gTarget = new Container();
  private gCarry = new Container();
  private deps: BoardDeps;
  private disposed = false;
  private lastState: GameState | null = null;
  private unsubscribeCarry: (() => void) | null = null;
  private unregisterBoard: (() => void) | null = null;
  // Manual double-click bookkeeping (see DBLCLICK_WINDOW_MS above): last
  // pointerdown timestamp per uid, cleared once consumed or expired.
  private lastPointerDown = new Map<string, number>();
  private flashTimers = new Set<ReturnType<typeof setTimeout>>();

  private constructor(app: Application, deps: BoardDeps) {
    this.app = app;
    this.deps = deps;
    this.root.addChild(
      this.gBase,
      this.gBeams,
      this.gItems,
      this.gSock,
      this.gLinkers,
      this.gChain,
      this.gTarget,
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
    // lines/arrowheads/dud marks), gTarget (drop-target tint/rings,
    // reject-flash), and gCarry (drag ghost sprites) never host a
    // listener anywhere in this file, so the whole group is marked here;
    // gBase/gItems/gSock/gLinkers mix interactive hit objects with
    // decorative art and are annotated per-node at each creation site
    // below instead.
    this.gBeams.eventMode = 'none';
    this.gTarget.eventMode = 'none';
    this.gCarry.eventMode = 'none';
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.wireGlobalInteraction();
  }

  static async mount(canvas: HTMLCanvasElement, deps: BoardDeps): Promise<BoardRenderer> {
    const app = new Application();
    const width = PAD * 2 + deps.layout.COLS * CELL;
    const height = PAD * 2 + deps.layout.ROWS * CELL;
    await app.init({ canvas, width, height, background: '#121212', antialias: true });
    return new BoardRenderer(app, deps);
  }

  /** This board's identity (canvas, or a specific inventory page) --
   * exposed so the React wrapper can register this instance's canvas DOM
   * element in the cross-board hit-test registry under the same id. */
  get boardId(): BoardId {
    return this.deps.ops.boardId;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.flashTimers) clearTimeout(t);
    this.flashTimers.clear();
    this.unsubscribeCarry?.();
    this.unregisterBoard?.();
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.app.destroy(true, { children: true });
  }
  render(state: GameState): void {
    this.lastState = state;
    const { engine, items, textures, layout, ops } = this.deps;
    this.gBase.removeChildren();
    this.gBeams.removeChildren();
    this.gItems.removeChildren();
    this.gSock.removeChildren();
    this.gLinkers.removeChildren();
    this.gChain.removeChildren();
    this.gTarget.removeChildren();

    const container = ops.container(state);
    const cbp = ops.cellBPMap(state);
    const bpById = (id: string) => container.bps.find((b) => b.id === id)!;

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
          g.fill({ color: bp.color, alpha: 0.26 });
          g.stroke({ color: bp.color, alpha: 0.35, width: 1 });
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
      const cells = engine.bpCells(bp);
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
      outline.stroke({ color: bp.color, width: 3, cap: 'square' });
      outline.eventMode = 'none'; // decorative, see constructor note
      this.gBase.addChild(outline);

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

      // Empty-cell BP grab handles (REQ-0027 T0.2, generalized REQ-0030
      // Phase 2): every BP cell that is neither occupied by a placed PO
      // nor the linker's own cell is an invisible drag source for moving
      // the whole BP (matches the mock's `hit` rects in this exact spot in
      // its renderAll()). Works identically on an inventory page -- BP
      // drag semantics are "grab = linker core or empty BP cell" on both
      // boards per REQ-0030 spec item 3.
      const occForHandles = ops.occupancy(state);
      const linkerMapForHandles: Record<string, string> = {};
      for (const b of container.bps) linkerMapForHandles[engine.key(...engine.linkerCell(b))] = b.id;
      for (const [r, c] of cells) {
        const ck = `${r},${c}`;
        if (occForHandles[ck] || linkerMapForHandles[ck]) continue;
        const hit = new Graphics();
        hit.rect(PAD + (c - 1) * CELL, PAD + (r - 1) * CELL, CELL, CELL);
        hit.fill({ color: '#000000', alpha: 0.001 }); // invisible but hit-testable
        hit.eventMode = 'static';
        hit.cursor = 'grab';
        hit.on('pointerdown', (e: FederatedPointerEvent) => this.beginDrag(e, 'bp', bp.id, bp.id));
        this.gBase.addChild(hit);
      }
    }

    // beams — CANVAS ONLY (REQ-0030 spec item 7 / Linker dormancy: "no
    // beams" in the inventory; the engine itself never computes beams for
    // BPs sitting in an inventory page in the first place -- traceBeams
    // only ever iterates st.bps -- but this guard also skips the call
    // entirely for an inventory board rather than relying solely on that).
    if (ops.isCanvas) {
      for (const bm of engine.traceBeams(state)) {
        const bp = bpById(bm.from);
        const lc = engine.linkerCell(bp);
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
          const line = new Graphics();
          line.moveTo(x0 + px, y0 + py).lineTo(x1t + px, y1t + py);
          line.stroke({ color: '#59d6d6', width: 3, alpha: 0.95 });
          this.gBeams.addChild(line);
          this.gBeams.addChild(this.arrowHead(x1t + px, y1t + py, Math.atan2(uy, ux), '#59d6d6'));
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
          const line = new Graphics();
          line.moveTo(x0, y0).lineTo(x1 + ux * 8, y1 + uy * 8);
          line.stroke({ color: '#6a6a6a', width: 2, alpha: 0.7 });
          this.gBeams.addChild(line);
          const dud = new Text({ text: '×', style: { fill: '#6a6a6a', fontSize: 15 } });
          dud.anchor.set(0.5);
          dud.x = x1 + ux * 20;
          dud.y = y1 + uy * 20;
          this.gBeams.addChild(dud);
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
    const activeCarry = getCarry();
    const carriedUids = new Set<string>();
    if (activeCarry && activeCarry.armed) {
      if (activeCarry.kind === 'po' || activeCarry.kind === 'si') carriedUids.add(activeCarry.uid);
      else if (activeCarry.kind === 'asm' && asm) {
        carriedUids.add(asm.blade.uid);
        carriedUids.add(asm.hilt.uid);
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
      hit.cursor = 'grab';
      const isAssemblyPart = !!(state.linked && asm && (p.uid === asm.blade.uid || p.uid === asm.hilt.uid));
      hit.on('pointerdown', (e: FederatedPointerEvent) => this.handlePOPointerDown(e, p, isAssemblyPart, asm));
      this.gItems.addChild(hit);
      for (const [r, c] of ops.cellsOf(state, p)) {
        const bg = new Graphics();
        bg.roundRect(PAD + (c - 1) * CELL + 3, PAD + (r - 1) * CELL + 3, CELL - 6, CELL - 6, 6);
        bg.fill({ color: '#000000', alpha: 0.22 });
        bg.eventMode = 'none'; // decorative backdrop, see constructor note
        this.gItems.addChild(bg);
      }
      const texture = textures.get(def.icon);
      if (texture) {
        const sprite = new Sprite(texture);
        const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
        const W0 = cw * CELL;
        const H0 = ch * CELL;
        const k = ((p.rot % 4) + 4) % 4;
        // REQ-0028 (aspect law): uniform contain-fit box (was independent
        // x/y insets per def.stretch branch -- see fitSpriteToBox doc).
        // Box tightness presets (stretch vs non-stretch) preserved.
        if (def.stretch) {
          BoardRenderer.fitSpriteToBox(sprite, W0 * 0.1, H0 * 0.1, W0 * 0.8, H0 * 0.8);
        } else {
          BoardRenderer.fitSpriteToBox(sprite, W0 * 0.06, H0 * 0.05, W0 * 0.88, H0 * 0.9);
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
      const bladeTexture = bladeDef && textures.get(bladeDef.icon);
      if (bladeTexture) {
        const sprite = new Sprite(bladeTexture);
        BoardRenderer.fitSpriteToBox(sprite, bx.x + bx.w * 0.1, bx.y + bx.h * 0.1, bx.w * 0.8, bx.h * 0.8);
        sprite.eventMode = 'none'; // decorative art, see constructor note
        this.gItems.addChild(sprite);
      }
      const hx = poBox(a.hilt);
      const hiltDef = items[a.hilt.id];
      const hiltTexture = hiltDef && textures.get(hiltDef.icon);
      if (hiltTexture) {
        const sprite = new Sprite(hiltTexture);
        BoardRenderer.fitSpriteToBox(sprite, hx.x + hx.w * 0.1, hx.y + hx.h * 0.1, hx.w * 0.8, hx.h * 0.8);
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

    // linkers — drawn on BOTH boards (REQ-0030 spec item 1: BP linker
    // cores render but DIMMED in inventory, no beams/no direction dots).
    // Still a valid BP-drag grab handle on both boards (spec item 3).
    for (const bp of container.bps) {
      const lc = engine.linkerCell(bp);
      const x = cx(lc[1]);
      const y = cy(lc[0]);
      const core = new Graphics();
      core.circle(x, y, 26);
      core.fill({ color: '#0e0d0b', alpha: ops.isCanvas ? 0.55 : INV_LINKER_ALPHA });
      core.stroke({ color: '#59d6d6', alpha: ops.isCanvas ? 0.5 : INV_LINKER_ALPHA, width: 1 });
      core.eventMode = 'static';
      core.cursor = 'grab';
      core.on('pointerdown', (e: FederatedPointerEvent) => this.beginDrag(e, 'bp', bp.id, bp.id));
      this.gLinkers.addChild(core);
      const linkerTexture = textures.get('icon-linker_core');
      if (linkerTexture) {
        const sprite = new Sprite(linkerTexture);
        sprite.width = 44;
        sprite.height = 44;
        sprite.x = x - 22;
        sprite.y = y - 22;
        sprite.alpha = ops.isCanvas ? 1 : INV_LINKER_ALPHA * 2;
        sprite.eventMode = 'none'; // decorative art, see constructor note
        this.gLinkers.addChild(sprite);
      }
      // Direction dots (which way the linker's beams would fire) are a
      // canvas-only concept -- an inventory BP's linker is dormant, so no
      // dots are drawn there (REQ-0030 spec item 1: "no beams").
      if (ops.isCanvas) {
        for (const d of bp.linker.dirs) {
          const ang = (DIR_ANGLES[d] * Math.PI) / 180;
          const dot = new Graphics();
          dot.circle(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 4);
          dot.fill({ color: '#59d6d6' });
          dot.eventMode = 'none'; // decorative, see constructor note
          this.gLinkers.addChild(dot);
        }
      }
    }
    // Sockets (diegetic, REQ-0027 T0.2, generalized REQ-0030 Phase 2):
    // empty-socket outlines (dashed circle/rounded-rect + glyph, per socket
    // type) and seated SI icons (drag sources). Mirrors the mock's sockets
    // rendering block exactly, including the special acc_guard "guard bar"
    // visual and the host==='bond' special-case position (hilt's top cell
    // edge) -- 'bond' sockets only ever appear via ops.sockets() on the
    // canvas board (pageSockets() never emits one, per engine.js design).
    for (const s of ops.sockets(state)) {
      if (carriedUids.has(s.host) || (s.siUid && carriedUids.has(s.siUid))) continue;
      const pos = this.socketScreenPos(state, s, asm);
      if (!pos) continue;
      const { x, y } = pos;
      if (s.siUid) {
        const a = container.sis.find((z) => z.uid === s.siUid);
        if (!a) continue;
        const siDef = this.deps.siDefs[a.id];
        const g = new Container();
        g.eventMode = 'static';
        g.cursor = 'grab';
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
          const tex = textures.get(siDef.icon);
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
        const hitCircle = new Graphics();
        hitCircle.circle(x, y, 15);
        hitCircle.fill({ color: '#000000', alpha: 0.001 });
        g.addChild(hitCircle);
        g.on('pointerdown', (e: FederatedPointerEvent) => this.beginDrag(e, 'si', a.uid, undefined));
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
      if (siDef) {
        const tex = textures.get(siDef.icon);
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
    this.app.renderer.render({ container: this.app.stage });
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
  private socketScreenPos(state: GameState, s: Socket, asm: Assembly | null): { x: number; y: number } | null {
    const { engine, ops } = this.deps;
    if (s.host === 'bond') {
      if (!asm) return null;
      return { x: cx(asm.hilt.cell![1]), y: PAD + (asm.hilt.cell![0] - 1) * CELL };
    }
    const container = ops.container(state);
    const p = container.pos.find((z) => z.uid === s.host);
    if (!p || p.loc !== 'grid' || !p.cell) return null;
    const box = { x: PAD + (p.cell[1] - 1) * CELL, y: PAD + (p.cell[0] - 1) * CELL };
    const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
    const W0 = cw * CELL;
    const H0 = ch * CELL;
    const [mx, my] = mapPt(((p.rot % 4) + 4) % 4, (s.ax ?? 0) * W0, (s.ay ?? 0) * H0, W0, H0);
    return { x: box.x + mx, y: box.y + my };
  }

  private arrowHead(x: number, y: number, angle: number, color: string): Graphics {
    const g = new Graphics();
    const size = 8;
    g.moveTo(x, y);
    g.lineTo(x - size * Math.cos(angle - Math.PI / 7), y - size * Math.sin(angle - Math.PI / 7));
    g.lineTo(x - size * Math.cos(angle + Math.PI / 7), y - size * Math.sin(angle + Math.PI / 7));
    g.closePath();
    g.fill({ color });
    return g;
  }

  // -----------------------------------------------------------------------
  // Interaction machinery — REQ-0027 T0.2, extended REQ-0030 Phase 2 for
  // cross-board drags. See drag.ts's module comment for the overall
  // design: each mounted BoardRenderer registers a BoardCommitApi under
  // its own BoardId; pointerdown/pointermove stay per-instance (Pixi-
  // scoped: only the board currently under the pointer fires them, which
  // is exactly the board whose legality/ghost should be shown); pointerup
  // is handled by ONE centralized window listener (drag.ts's
  // ensurePointerUpWired) that looks up the drop's target board and
  // delegates the commit to it -- never duplicated per-instance, so a
  // drag ending on board B while it started on board A is never
  // double-committed by two independent listeners.
  // -----------------------------------------------------------------------

  /** Board-canvas-local pixel coords -> grid cell, matching the mock's
   * `cellAt(pt)`. */
  private cellAt(x: number, y: number): Cell {
    return [Math.floor((y - PAD) / CELL) + 1, Math.floor((x - PAD) / CELL) + 1];
  }

  /** Converts a raw client (viewport) coordinate to board-canvas-local
   * pixel space, accounting for CSS scaling of the canvas element -- same
   * purpose as the mock's `svgPt(e)` (which scales by `W/rect.width`). */
  private clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const scaleX = this.app.canvas.width / (rect.width || 1) / (this.app.renderer.resolution || 1);
    const scaleY = this.app.canvas.height / (rect.height || 1) / (this.app.renderer.resolution || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  /** REQ-0028 (aspect law): sizes+positions a Sprite to uniformly contain-fit
   * its texture's OWN native aspect ratio inside a (bx, by, bw, bh) box,
   * centered -- never stretching width/height independently. Replaces the
   * old pattern (three call sites: placed-PO art, ghost-PO art, merged
   * Longsword blade/hilt art) that set sprite.width/sprite.height from two
   * DIFFERENT box-fraction formulas per axis (e.g. `W0*0.8` for width vs
   * `H0-8` for height), which would visibly distort any icon whose native
   * texture aspect didn't exactly match the box aspect. With v8's
   * exact-aspect viewBoxes for all symbols, contain-fit and the old
   * stretch-fill produce IDENTICAL pixels for placed art (box aspect ==
   * texture aspect already) -- this is a correctness/safety fix, not a
   * visual change, for any icon actually shipped today. */
  private static fitSpriteToBox(sprite: Sprite, bx: number, by: number, bw: number, bh: number): void {
    const texW = sprite.texture.width;
    const texH = sprite.texture.height;
    const scale = texW > 0 && texH > 0 ? Math.min(bw / texW, bh / texH) : 1;
    const w = texW * scale;
    const h = texH * scale;
    sprite.width = w;
    sprite.height = h;
    sprite.x = bx + (bw - w) / 2;
    sprite.y = by + (bh - h) / 2;
  }

  /** pointerdown on a PO group -- REQ-0027 T0.2 double-click vs drag
   * disambiguation (see DBLCLICK_WINDOW_MS's module comment). Manual
   * bookkeeping: if a second pointerdown for this uid arrives within the
   * window AND the carry that the first pointerdown may have started never
   * armed (i.e. it was a plain click), treat this as a double-click and
   * call rotatePO immediately -- otherwise, start a normal drag exactly
   * like any other pointerdown (matches the mock's own dual dblclick+
   * pointerdown listeners coexisting on the same SVG group). Works
   * identically on an inventory board via this.deps.ops.rotatePO
   * (invRotatePO), REQ-0030 spec item 3: "rotate with dblclick works in
   * inventory too". */
  private handlePOPointerDown(
    e: FederatedPointerEvent,
    p: PO,
    isAssemblyPart: boolean,
    asm: Assembly | null
  ): void {
    if (getCarry()) return; // matches mock's `if(carry)return` guard (dblclick) / `if(carry||!kind)return` (startCarry)
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
      const r = this.deps.ops.rotatePO(this.lastState!, rotateUid);
      if (r.ok) notifyStateChanged();
      else this.flash(r.cells);
      return;
    }
    this.lastPointerDown.set(p.uid, now);
    // Kind selection mirrors the mock exactly: an assembled+linked blade/
    // hilt drags as 'asm' (the whole assembly), everything else as 'po'.
    const kind = isAssemblyPart ? 'asm' : 'po';
    this.beginDrag(e, kind, isAssemblyPart && asm ? asm.blade.uid : p.uid, undefined);
  }

  /** Starts a carry from a Pixi pointerdown event (board-originated drag:
   * PO, assembly, BP/linker, or a free-placed/seated SI). Computes grabOff
   * in CELL space, matching the mock's startCarry() branches per kind.
   * `originBoard` is always THIS renderer's own board id -- a drag always
   * starts on the board the pointerdown fired on. */
  private beginDrag(e: FederatedPointerEvent, kind: CarryState['kind'], uid: string, bpId?: string): void {
    if (getCarry()) return;
    const state = this.lastState;
    if (!state) return;
    const { engine, ops } = this.deps;
    const container = ops.container(state);
    const local = { x: e.global.x, y: e.global.y };
    const cell = this.cellAt(local.x, local.y);
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
  /** Wires stage-wide pointermove (arm + legality preview + ghost) and
   * window keydown (Esc cancel). Called once from the constructor. Also
   * registers this board's BoardCommitApi (drag.ts) and ensures the
   * SINGLE shared window pointerup listener is installed (idempotent --
   * see drag.ts's ensurePointerUpWired doc). REQ-0030 Phase 2: pointerup
   * itself is no longer wired per-instance (was `window.addEventListener
   * ('pointerup', this.onWindowPointerUp)` pre-Phase-2) -- centralizing it
   * is what makes a drag that ends on the OTHER board resolve exactly
   * once (see drag.ts module comment). */
  private wireGlobalInteraction(): void {
    this.app.stage.on('globalpointermove', this.onGlobalPointerMove);
    window.addEventListener('keydown', this.onWindowKeyDown);
    ensurePointerUpWired();
    this.unregisterBoard = registerBoard(this.boardId, this.makeCommitApi());
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
  private makeCommitApi(): BoardCommitApi {
    return {
      commitPO: (uid, originBoard, drop) => this.commitPODrop(uid, originBoard, drop),
      commitAsm: (originBoard, drop) => this.commitAsmDrop(originBoard, drop),
      commitBP: (bpId, originBoard, drop) => this.commitBPDrop(bpId, originBoard, drop),
      commitSI: (uid, originBoard, drop) => this.commitSIDrop(uid, originBoard, drop),
    };
  }

  /** Commits a PO drop landing on THIS board. `drop.board` is always
   * `this.boardId` by construction (the registry only ever calls the API
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
  private commitPODrop(uid: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void {
    const state = this.lastState;
    if (!state) return;
    const { ops } = this.deps;
    const sameBoard = boardIdEquals(originBoard, this.boardId);
    if (!sameBoard) {
      this.splicePOAcrossBoards(state, uid, originBoard, this.boardId);
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
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    notifyStateChanged();
  }

  private commitAsmDrop(_originBoard: BoardId, drop: Extract<DropTarget, { type: 'grid' }> | Extract<DropTarget, { type: 'inv' }>): void {
    // Assemblies are canvas-only (see render()'s `ops.isCanvas` guard on
    // `asm`) -- an 'asm' carry can therefore only ever originate on, and
    // land on, the canvas board (moving INTO an inventory page would
    // require a bond-socket concept pageSockets() deliberately never
    // emits, per engine.js's design note). this.deps.engine.moveAssembly
    // is still the plain canvas mutator (no ops indirection needed: 'asm'
    // never applies to an inventory BoardOps instance).
    const state = this.lastState;
    if (!state || !this.deps.ops.isCanvas) return;
    if (drop.type === 'grid') this.deps.engine.moveAssembly(state, drop.anchor);
    else this.deps.engine.moveAssembly(state, 'inv');
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    notifyStateChanged();
  }

  /** Commits a BP drop landing on THIS board. Same-board reposition uses
   * ops.moveBP (moveBP/invMoveBP); cross-board uses engine.transferBP
   * directly (the one engine function that already knows how to carry a
   * BP's contents across a container boundary -- REQ-0030 Phase 1's
   * headline addition), addressed via LocRef built from each board's
   * BoardId (identical shape by construction, see boardOps.ts's BoardId/
   * LocRef parity note). */
  private commitBPDrop(bpId: string, originBoard: BoardId, drop: Extract<DropTarget, { type: 'bp' }>): void {
    const state = this.lastState;
    if (!state) return;
    const { engine, ops } = this.deps;
    if (boardIdEquals(originBoard, this.boardId)) {
      ops.moveBP(state, bpId, drop.origin);
    } else {
      engine.transferBP(state, originBoard, this.boardId, bpId, drop.origin);
    }
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
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
  private commitSIDrop(uid: string, originBoard: BoardId, drop: DropTarget): void {
    const state = this.lastState;
    if (!state) return;
    const { ops } = this.deps;
    const sameBoard = boardIdEquals(originBoard, this.boardId);
    if (!sameBoard) {
      this.spliceSIAcrossBoards(state, uid, originBoard, this.boardId);
    }
    if (drop.type === 'sock') {
      ops.seatSI(state, uid, drop.skey);
    } else if (drop.type === 'grid') {
      ops.moveSI(state, uid, drop.anchor);
    } else if (drop.type === 'inv') {
      ops.stowSI(state, uid);
    }
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    notifyStateChanged();
  }

  /** Splices a PO record (and any SI seated on it) out of `from`'s
   * container arrays and into `to`'s, WITHOUT yet validating/placing it --
   * the caller must immediately follow up with `to`'s own movePO-
   * equivalent (which both validates AND sets p.loc/p.cell). This is the
   * PO/SI-level analogue of engine.js's transferBP splice step (see
   * BoardCommitApi's commitPO doc) -- kept here (not in engine.js) because,
   * unlike a BP transfer, a lone PO/SI crossing containers has no BP-
   * shaped "contents" to carry and no shared bounds/overlap precheck to
   * reuse; it is a pure array-membership move, then a normal placement
   * call owns legality exactly as it already does for a same-board move. */
  private splicePOAcrossBoards(state: GameState, uid: string, from: BoardId, to: BoardId): void {
    const { engine } = this.deps;
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

  /** Splices a lone (not-seated-on-a-PO) SI record across containers --
   * same rationale as splicePOAcrossBoards, simpler (no dependent SI
   * records of its own to carry). */
  private spliceSIAcrossBoards(state: GameState, uid: string, from: BoardId, to: BoardId): void {
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
   * board's container, runs `this.deps.ops.canPlacePO` (the REAL engine
   * check, never a client reimplementation), then splices it back to
   * origin before returning -- so the probe is side-effect-free from the
   * caller's perspective (no render/notify in between, single synchronous
   * call). This is the only way to preview "would uid fit on a board it
   * is not yet a member of" without a dedicated cross-board engine query
   * (Phase 1 only added one for BPs, since only BP transfer needed to
   * carry contents) while still deferring 100% of the actual legality
   * rule to the engine.
   */
  private previewCrossBoardPO(state: GameState, uid: string, originBoard: BoardId, rot: number, anchor: Cell): { ok: boolean; cells: Cell[] } {
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.pos.findIndex((p) => p.uid === uid);
    if (idx === -1) return { ok: false, cells: [] };
    const [p] = originContainer.pos.splice(idx, 1);
    const savedLoc = p.loc;
    const savedCell = p.cell;
    const container = this.deps.ops.container(state);
    container.pos.push(p);
    let result: { ok: boolean; cells: Cell[] };
    try {
      const chk = this.deps.ops.canPlacePO(state, uid, rot, anchor);
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
  private previewCrossBoardSIFreeCell(state: GameState, uid: string, originBoard: BoardId, anchor: Cell): { ok: boolean; cells: Cell[] } {
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.sis.findIndex((a) => a.uid === uid);
    if (idx === -1) return { ok: false, cells: [] };
    const [a] = originContainer.sis.splice(idx, 1);
    const savedHost = a.host;
    const container = this.deps.ops.container(state);
    container.sis.push(a);
    let result: { ok: boolean; cells: Cell[] };
    try {
      const chk = this.deps.ops.canPlaceSI(state, uid, anchor);
      result = { ok: chk.ok, cells: chk.cells };
    } finally {
      container.sis.splice(container.sis.indexOf(a), 1);
      a.host = savedHost;
      originContainer.sis.splice(idx, 0, a);
    }
    return result;
  }

  private onGlobalPointerMove = (e: FederatedPointerEvent): void => {
    const carry = getCarry();
    if (!carry || !this.lastState) return;
    if (!carry.armed) {
      if (Math.hypot(e.clientX - carry.sx, e.clientY - carry.sy) < DRAG_ARM_THRESHOLD) return;
      armCarry();
      // Re-render so the carried item's original-position art disappears
      // (matches the mock's `hideTip();renderAll();` on arm) -- the
      // carriedUids computation in render() reads getCarry() fresh. Only
      // the ORIGIN board needs this (a cross-board carry's item never
      // rendered on the destination board in the first place).
      if (boardIdEquals(carry.originBoard, this.boardId)) this.render(this.lastState);
    }
    const local = this.clientToLocal(e.clientX, e.clientY);
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    const state = this.lastState;
    const { engine, ops } = this.deps;
    const cell = this.cellAt(local.x, local.y);
    const sameBoard = boardIdEquals(carry.originBoard, this.boardId);

    const paint = (cells: Cell[] | undefined, ok: boolean) => {
      for (const [r, c] of cells ?? []) {
        if (r < 1 || r > this.deps.layout.ROWS || c < 1 || c > this.deps.layout.COLS) continue;
        const rect = new Graphics();
        rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
        rect.fill({ color: ok ? '#5cb573' : '#c05050', alpha: 0.25 });
        rect.stroke({ color: ok ? '#5cb573' : '#c05050', width: 2 });
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
        const chk = sameBoard
          ? ops.canPlacePO(state, p.uid, p.rot, anchor)
          : this.previewCrossBoardPO(state, p.uid, carry.originBoard, p.rot, anchor);
        drop = chk.ok ? { type: 'grid', anchor, board: this.boardId } : null;
        paint(chk.cells, chk.ok);
        const def = this.deps.items[p.id];
        const { w, h } = engine.shapeInfo(p.id, p.rot);
        this.renderGhostPO(p, def, local.x - (w * CELL) / 2, local.y - (h * CELL) / 2);
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
          this.renderGhostAssembly(asm, local.x, local.y);
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
        if (chk.ok && chk.cells) this.renderGhostBP(bp.color, chk.cells);
      }
    } else if (carry.kind === 'si') {
      const originContainer = carry.originBoard.loc === 'canvas' ? state : state.inv!.pages[carry.originBoard.page];
      const a = originContainer.sis.find((z) => z.uid === carry.uid);
      if (a) {
        const asm = ops.isCanvas ? engine.assembly(state) : null;
        let best: { s: Socket; v: { ok: boolean; why?: string } } | null = null;
        let bd = SOCKET_SEARCH_RADIUS;
        for (const s of ops.sockets(state)) {
          const pos = this.socketScreenPos(state, s, asm);
          if (!pos) continue;
          const v = sameBoard ? ops.hostOk(state, carry.uid, s) : this.previewCrossBoardSocket(state, carry.uid, carry.originBoard, s);
          const dist = Math.hypot(pos.x - local.x, pos.y - local.y);
          const ring = new Graphics();
          ring.circle(pos.x, pos.y, 12);
          ring.stroke({ color: v.ok ? '#5cb573' : '#c05050', width: 2, alpha: dist < bd ? 1 : 0.55 });
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
            : this.previewCrossBoardSIFreeCell(state, carry.uid, carry.originBoard, cell);
          if (freeChk.ok) {
            drop = { type: 'grid', anchor: cell, board: this.boardId };
            paint(freeChk.cells, true);
          } else if (!ops.isCanvas) {
            paint(freeChk.cells.length ? freeChk.cells : [cell], false);
          }
        }
        const siDef = this.deps.siDefs[a.id];
        if (siDef) {
          const tex = this.deps.textures.get(siDef.icon);
          if (tex) {
            const sprite = new Sprite(tex);
            sprite.x = local.x - 16;
            sprite.y = local.y - 16;
            sprite.width = 32;
            sprite.height = 32;
            sprite.alpha = 0.85;
            this.gCarry.addChild(sprite);
          }
        }
      }
    }
    updateCarry(local.x, local.y, drop);
  };

  /** Cross-board socket legality preview for an SI -- splices the SI
   * across, runs hostOk (bound to THIS board's state/def lookup, which is
   * container-independent already -- see boardOps.ts's makeInvOps note),
   * then unsplices. Same rationale as previewCrossBoardPO. */
  private previewCrossBoardSocket(state: GameState, uid: string, originBoard: BoardId, sock: Socket): { ok: boolean; why?: string } {
    const originContainer = originBoard.loc === 'canvas' ? state : state.inv!.pages[originBoard.page];
    const idx = originContainer.sis.findIndex((a) => a.uid === uid);
    if (idx === -1) return { ok: false };
    const [a] = originContainer.sis.splice(idx, 1);
    const savedHost = a.host;
    const container = this.deps.ops.container(state);
    container.sis.push(a);
    let result: { ok: boolean; why?: string };
    try {
      result = this.deps.ops.hostOk(state, uid, sock);
    } finally {
      container.sis.splice(container.sis.indexOf(a), 1);
      a.host = savedHost;
      originContainer.sis.splice(idx, 0, a);
    }
    return result;
  }
  private onWindowKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && getCarry()) {
      cancelCarry();
      this.gCarry.removeChildren();
      this.gTarget.removeChildren();
      if (this.lastState) this.render(this.lastState);
    }
  };

  /** Ghost PO art following the pointer during a drag -- reuses the same
   * rotation-aware art placement as the placed-PO rendering above
   * (drawPOArt equivalent), at reduced opacity, matching the mock's
   * `opacity:.75` ghost. */
  private renderGhostPO(p: PO, def: ItemDefMap[string] | undefined, x: number, y: number): void {
    if (!def) return;
    const { engine, textures } = this.deps;
    const texture = textures.get(def.icon);
    if (!texture) return;
    const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
    const W0 = cw * CELL;
    const H0 = ch * CELL;
    const k = ((p.rot % 4) + 4) % 4;
    const sprite = new Sprite(texture);
    // REQ-0028 (aspect law): uniform contain-fit box, matching the
    // placed-PO draw path above (see fitSpriteToBox doc).
    if (def.stretch) {
      BoardRenderer.fitSpriteToBox(sprite, W0 * 0.1, H0 * 0.1, W0 * 0.8, H0 * 0.8);
    } else {
      BoardRenderer.fitSpriteToBox(sprite, W0 * 0.06, H0 * 0.05, W0 * 0.88, H0 * 0.9);
    }
    const inner = new Container();
    inner.alpha = 0.75;
    inner.addChild(sprite);
    const { w, h } = engine.shapeInfo(p.id, p.rot);
    if (k === 0) {
      inner.position.set(x, y);
    } else if (k === 1) {
      inner.position.set(x + w * CELL, y);
      inner.rotation = Math.PI / 2;
    } else if (k === 2) {
      inner.position.set(x + w * CELL, y + h * CELL);
      inner.rotation = Math.PI;
    } else {
      inner.position.set(x, y + h * CELL);
      inner.rotation = -Math.PI / 2;
    }
    this.gCarry.addChild(inner);
  }

  /** Ghost for the carried Blade+Hilt assembly -- fixed-size icons at
   * offsets from the pointer, matching the mock's assembly ghost
   * (`x:pt.x-32,y:pt.y-110,w:64,h:150` for blade, `y:pt.y+40,h:66` hilt).
   * Canvas-only (see onGlobalPointerMove's 'asm' branch). */
  private renderGhostAssembly(asm: Assembly, px: number, py: number): void {
    const { items, textures } = this.deps;
    const bladeDef = items[asm.blade.id];
    const bladeTex = bladeDef && textures.get(bladeDef.icon);
    if (bladeTex) {
      const sprite = new Sprite(bladeTex);
      sprite.x = px - 32;
      sprite.y = py - 110;
      sprite.width = 64;
      sprite.height = 150;
      sprite.alpha = 0.75;
      this.gCarry.addChild(sprite);
    }
    const hiltDef = items[asm.hilt.id];
    const hiltTex = hiltDef && textures.get(hiltDef.icon);
    if (hiltTex) {
      const sprite = new Sprite(hiltTex);
      sprite.x = px - 32;
      sprite.y = py + 40;
      sprite.width = 64;
      sprite.height = 66;
      sprite.alpha = 0.75;
      this.gCarry.addChild(sprite);
    }
  }

  /** Ghost preview for a dragged BP -- tinted cells in the BP's own color
   * at low alpha, matching the mock's BP-carry ghost. Shows the WHOLE BP
   * footprint (REQ-0030 spec item 3), same on both boards and during a
   * cross-board transfer preview (the cells are already computed in the
   * TARGET board's coordinate space by canMoveBP/invCanPlaceBP/
   * canTransferBP, so no extra translation is needed here). */
  private renderGhostBP(color: string, cells: Cell[]): void {
    for (const [r, c] of cells) {
      if (r < 1 || r > this.deps.layout.ROWS || c < 1 || c > this.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 4, PAD + (r - 1) * CELL + 4, CELL - 8, CELL - 8, 6);
      rect.fill({ color, alpha: 0.4 });
      this.gCarry.addChild(rect);
    }
  }

  /** Brief red-outline reject feedback on illegal double-click-rotate
   * targets -- matches the mock's flash() (350ms auto-remove). */
  private flash(cells: Cell[] | undefined): void {
    for (const [r, c] of cells ?? []) {
      if (r < 1 || r > this.deps.layout.ROWS || c < 1 || c > this.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
      rect.stroke({ color: '#c05050', width: 3 });
      this.gTarget.addChild(rect);
      const timer = setTimeout(() => {
        rect.destroy();
        this.flashTimers.delete(timer);
      }, FLASH_MS);
      this.flashTimers.add(timer);
    }
  }
}
