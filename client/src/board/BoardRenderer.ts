// PixiJS board renderer — REQ-0026 T0.1 (read-only), extended REQ-0027 T0.2
// with edit interactions (drag/drop, rotate, BP move, SI seat/unseat).
// Framework-free (no React here); layout constants (CELL/PAD) and the
// overall composition mirror mock-src/ui.js's SVG renderAll() for visual
// parity (same reference, not pixel-exact): grid cells tinted by BP (dead
// space cells get a flat dark fill, same as the mock), BP outlines +
// name/HP label, linker cores + direction dots, beams (solid+arrowhead when
// linked, dashed+x when a dud), placed PO art, port target ◇ marks,
// established-connection ◆ marks, sockets (empty + seated SI), and the
// chain-link toggle button.
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
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Assembly, Cell, EngineInstance, GameState, ItemDefMap, Layout, PO, SIDefMap, Socket } from '../engine/engine.d.ts';
import {
  armCarry,
  cancelCarry,
  getCarry,
  startCarry,
  subscribeCarry,
  takeCarry,
  updateCarry,
  type CarryState,
  type DropTarget,
} from './drag';
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

export interface BoardCallbacks {
  /** Returns true if the given client (viewport) coordinates are over the
   * inventory drop zone. REQ-0027 T0.2 adaptation note: the mock detects
   * "pointer over inventory" via an SVG-local x threshold (`pt.x >
   * INVX-14`) because its inventory panel is laid out inside the SAME SVG
   * canvas as the board. Here the board is a separate PixiJS <canvas> from
   * the React-rendered inventory panel (a different DOM element entirely),
   * so that coordinate math does not carry over -- instead the caller
   * (Board.tsx) supplies a predicate that checks viewport-space
   * containment against the inventory panel DOM node's bounding rect. */
  isOverInventory: (clientX: number, clientY: number) => boolean;
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
  private callbacks: BoardCallbacks;
  private disposed = false;
  private lastState: GameState | null = null;
  private unsubscribeCarry: (() => void) | null = null;
  // Manual double-click bookkeeping (see DBLCLICK_WINDOW_MS above): last
  // pointerdown timestamp per uid, cleared once consumed or expired.
  private lastPointerDown = new Map<string, number>();
  private flashTimers = new Set<ReturnType<typeof setTimeout>>();

  private constructor(app: Application, deps: BoardDeps, callbacks: BoardCallbacks) {
    this.app = app;
    this.deps = deps;
    this.callbacks = callbacks;
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

  static async mount(canvas: HTMLCanvasElement, deps: BoardDeps, callbacks: BoardCallbacks): Promise<BoardRenderer> {
    const app = new Application();
    const width = PAD * 2 + deps.layout.COLS * CELL;
    const height = PAD * 2 + deps.layout.ROWS * CELL;
    await app.init({ canvas, width, height, background: '#121212', antialias: true });
    return new BoardRenderer(app, deps, callbacks);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.flashTimers) clearTimeout(t);
    this.flashTimers.clear();
    this.unsubscribeCarry?.();
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.app.destroy(true, { children: true });
  }

  render(state: GameState): void {
    this.lastState = state;
    const { engine, items, textures, layout } = this.deps;
    this.gBase.removeChildren();
    this.gBeams.removeChildren();
    this.gItems.removeChildren();
    this.gSock.removeChildren();
    this.gLinkers.removeChildren();
    this.gChain.removeChildren();
    this.gTarget.removeChildren();

    const cbp = engine.cellBPMap(state);
    const bpById = (id: string) => state.bps.find((b) => b.id === id)!;

    // grid cells (BP-tinted or plain dead-space fill), full canvas extent
    for (let r = 1; r <= layout.ROWS; r++) {
      for (let c = 1; c <= layout.COLS; c++) {
        const bpId = cbp[`${r},${c}`];
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

    // BP outlines + labels
    for (const bp of state.bps) {
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

      // Empty-cell BP grab handles (REQ-0027 T0.2): every BP cell that is
      // neither occupied by a placed PO nor the linker's own cell is an
      // invisible drag source for moving the whole BP (matches the mock's
      // `hit` rects in this exact spot in its renderAll()).
      const occForHandles = engine.occupancy(state);
      const linkerMapForHandles = engine.linkerMap(state);
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

    // beams
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

    // Assembled Longsword (blade+hilt flush-joined, BP linked): mirrors
    // mock-src/ui.js's `mergeSword` special-case exactly (REQ-0026 follow-up,
    // PO orientation bug). When active, the mock does NOT run the generic
    // rotation-aware drawPOArt() for blade/hilt -- it draws a dedicated merged
    // visual instead: each part's own icon in its own (unrotated) poBox, no
    // rotation wrapper, plus a dashed outline spanning all 3 cells. This
    // renderer used to have no such special-case at all, so blade (a
    // stretch:true, 1x2 vertical-footprint PO) fell into the generic path
    // and rendered using ITS OWN box math -- which is correct in isolation,
    // but wrong here because the live scenario always has blade+hilt
    // assembled+linked, so the mock never uses that path for this content;
    // the generic path's numbers were never wrong, they were simply the
    // wrong CODE PATH for this state. flame_tablet has no hilt to assemble
    // with, so it always takes the generic path and always looked correct.
    const asm = engine.assembly(state);
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
    for (const p of state.pos) {
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
      for (const [r, c] of engine.cellsOf(state, p)) {
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

    // merged Longsword visual (mock-src/ui.js's mergeSword block, ~L250-262):
    // dark cell backdrops across all 3 cells (blade's 2 + hilt's 1), a dashed
    // outline around the combined footprint, then blade's and hilt's icons
    // each in their own unrotated poBox -- same x/y/width/height formula as
    // the mock's `bx.x+bx.w*0.10, bx.y+6, bx.w*0.80, bx.h-6` (blade) and
    // `hx.x+hx.w*0.10, hx.y, hx.w*0.80, hx.h-8` (hilt). No rotation transform
    // here: assembly() only ever matches when blade.rot%4===0 (engine.js
    // guard), so the merged visual is always axis-aligned.
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

    // Chain-link toggle (REQ-0027 T0.2): a small clickable circle at the
    // top-right of the assembly's bounding box. Purely a UI-state toggle on
    // state.linked -- NOT an engine mutator (mirrors the mock's chain
    // button exactly: `state.linked=!state.linked; renderAll();`, no
    // E.* call). Only shown while an assembly exists and isn't currently
    // being carried (matches the mock's `if(asm&&!carriedUids.length...)`).
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

    // port target ◇ marks
    for (const p of state.pos) {
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

    // established connections ◆ marks
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

    // linkers
    for (const bp of state.bps) {
      const lc = engine.linkerCell(bp);
      const x = cx(lc[1]);
      const y = cy(lc[0]);
      const core = new Graphics();
      core.circle(x, y, 26);
      core.fill({ color: '#0e0d0b', alpha: 0.55 });
      core.stroke({ color: '#59d6d6', alpha: 0.5, width: 1 });
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
        sprite.eventMode = 'none'; // decorative art, see constructor note
        this.gLinkers.addChild(sprite);
      }
      for (const d of bp.linker.dirs) {
        const ang = (DIR_ANGLES[d] * Math.PI) / 180;
        const dot = new Graphics();
        dot.circle(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 4);
        dot.fill({ color: '#59d6d6' });
        dot.eventMode = 'none'; // decorative, see constructor note
        this.gLinkers.addChild(dot);
      }
    }

    // Sockets (diegetic, REQ-0027 T0.2): empty-socket outlines (dashed
    // circle/rounded-rect + glyph, per socket type) and seated SI icons
    // (drag sources). Mirrors the mock's sockets rendering block exactly,
    // including the special acc_guard "guard bar" visual and the
    // host==='bond' special-case position (hilt's top cell edge).
    for (const s of engine.sockets(state)) {
      if (carriedUids.has(s.host) || (s.siUid && carriedUids.has(s.siUid))) continue;
      const pos = this.socketScreenPos(state, s, asm);
      if (!pos) continue;
      const { x, y } = pos;
      if (s.siUid) {
        const a = state.sis.find((z) => z.uid === s.siUid);
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
   * T0.2. Mirrors the mock's inline math in renderAll()'s sockets block and
   * pointermove's 'si' branch (both duplicate the same computation there;
   * consolidated into one helper here). Two cases:
   *  - host==='bond': the Blade-Hilt bond socket, positioned at the hilt's
   *    top cell edge (asm.hilt.cell's row, one cell up from center).
   *  - per-PO socket: the socket's ax/ay anchor fractions (0..1 of the
   *    PO's UNROTATED bbox) mapped through the PO's current rotation via
   *    mapPt(), then offset by the PO's screen-space box origin.
   * Returns null if the socket cannot be positioned (e.g. bond socket but
   * no assembly currently exists).
   */
  private socketScreenPos(state: GameState, s: Socket, asm: Assembly | null): { x: number; y: number } | null {
    const { engine } = this.deps;
    if (s.host === 'bond') {
      if (!asm) return null;
      return { x: cx(asm.hilt.cell![1]), y: PAD + (asm.hilt.cell![0] - 1) * CELL };
    }
    const p = state.pos.find((z) => z.uid === s.host);
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
  // Interaction machinery — REQ-0027 T0.2.
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
   * pointerdown listeners coexisting on the same SVG group). */
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
      // calling `E.rotatePO(state,asm.blade.uid)`).
      const rotateUid = isAssemblyPart && asm ? asm.blade.uid : p.uid;
      const r = this.deps.engine.rotatePO(this.lastState!, rotateUid);
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
   * PO, assembly, BP/linker). Computes grabOff in CELL space, matching the
   * mock's startCarry() branches per kind. */
  private beginDrag(e: FederatedPointerEvent, kind: CarryState['kind'], uid: string, bpId?: string): void {
    if (getCarry()) return;
    const state = this.lastState;
    if (!state) return;
    const { engine } = this.deps;
    const local = { x: e.global.x, y: e.global.y };
    const cell = this.cellAt(local.x, local.y);
    let grabOff: [number, number] = [0, 0];
    if (kind === 'po') {
      const p = state.pos.find((z) => z.uid === uid);
      if (p && p.loc === 'grid' && p.cell) grabOff = [cell[0] - p.cell[0], cell[1] - p.cell[1]];
    } else if (kind === 'asm') {
      const asm = engine.assembly(state);
      if (asm) grabOff = [cell[0] - asm.anchor[0], cell[1] - asm.anchor[1]];
    } else if (kind === 'bp' && bpId) {
      const bp = state.bps.find((b) => b.id === bpId);
      if (bp) grabOff = [cell[0] - bp.origin[0], cell[1] - bp.origin[1]];
    }
    startCarry({ kind, uid, bpId, sx: e.clientX, sy: e.clientY, grabOff });
  }

  /**
   * Starts a carry from an EXTERNAL (non-Pixi, i.e. React inventory panel)
   * pointerdown -- REQ-0027 T0.2. Public so Board.tsx can wire the React
   * inventory panel's onPointerDown handlers into the same carry/drag
   * machinery the board canvas uses (single mental model per the task
   * spec's "pointer events let you unify board-originated and panel-
   * originated drags"). Inventory-sourced items are always loc/host==='inv'
   * so grabOff is always [0,0] (matches the mock's inventory pointerdown,
   * which also never sets a non-zero grabOff for inv-sourced drags).
   */
  startExternalDrag(kind: 'po' | 'si', uid: string, clientX: number, clientY: number): void {
    if (getCarry()) return;
    startCarry({ kind, uid, sx: clientX, sy: clientY, grabOff: [0, 0] });
  }

  /** Wires stage-wide pointermove (arm + legality preview + ghost), window
   * pointerup (commit), and window keydown (Esc cancel). Called once from
   * the constructor. */
  private wireGlobalInteraction(): void {
    this.app.stage.on('globalpointermove', this.onGlobalPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('keydown', this.onWindowKeyDown);
    // Re-render ghost/target layers whenever drag.ts's carry state changes
    // for reasons other than a pointermove we already handle inline below
    // (e.g. an external startExternalDrag() call from the React inventory
    // panel, which this renderer did not itself trigger) -- keeps the
    // canvas' ghost/legality-tint in sync regardless of WHERE the drag
    // began.
    this.unsubscribeCarry = subscribeCarry(() => {
      const carry = getCarry();
      if (!carry) {
        this.gCarry.removeChildren();
        this.gTarget.removeChildren();
      }
    });
  }

  private onGlobalPointerMove = (e: FederatedPointerEvent): void => {
    const carry = getCarry();
    if (!carry || !this.lastState) return;
    if (!carry.armed) {
      if (Math.hypot(e.clientX - carry.sx, e.clientY - carry.sy) < DRAG_ARM_THRESHOLD) return;
      armCarry();
      // Re-render so the carried item's original-position art disappears
      // (matches the mock's `hideTip();renderAll();` on arm) -- the
      // carriedUids computation in render() reads getCarry() fresh.
      this.render(this.lastState);
    }
    const local = this.clientToLocal(e.clientX, e.clientY);
    const overInv = this.callbacks.isOverInventory(e.clientX, e.clientY);
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    const state = this.lastState;
    const { engine } = this.deps;
    const cell = this.cellAt(local.x, local.y);

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
      const p = state.pos.find((z) => z.uid === carry.uid);
      if (p) {
        const anchor: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
        if (overInv) {
          drop = { type: 'inv' };
        } else {
          const chk = engine.canPlacePO(state, p.uid, p.rot, anchor);
          drop = chk.ok ? { type: 'grid', anchor } : null;
          paint(chk.cells, chk.ok);
        }
        const def = this.deps.items[p.id];
        const { w, h } = engine.shapeInfo(p.id, p.rot);
        this.renderGhostPO(p, def, local.x - (w * CELL) / 2, local.y - (h * CELL) / 2);
      }
    } else if (carry.kind === 'asm') {
      const asm = engine.assembly(state);
      if (asm) {
        const anchor: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
        if (overInv) {
          drop = { type: 'inv' };
        } else {
          const chk = engine.canPlaceAssembly(state, anchor);
          drop = chk.ok ? { type: 'grid', anchor } : null;
          paint(chk.cells, chk.ok);
        }
        this.renderGhostAssembly(asm, local.x, local.y);
      }
    } else if (carry.kind === 'bp' && carry.bpId) {
      const bp = state.bps.find((b) => b.id === carry.bpId);
      if (bp) {
        const origin: Cell = [cell[0] - carry.grabOff[0], cell[1] - carry.grabOff[1]];
        if (overInv) {
          drop = null;
        } else {
          const chk = engine.canMoveBP(state, carry.bpId, origin);
          drop = chk.ok ? { type: 'bp', origin } : null;
          paint(chk.cells, chk.ok);
          if (chk.ok && chk.cells) this.renderGhostBP(bp.color, chk.cells);
        }
      }
    } else if (carry.kind === 'si') {
      const a = state.sis.find((z) => z.uid === carry.uid);
      if (a) {
        const asm = engine.assembly(state);
        let best: { s: Socket; v: { ok: boolean; why?: string } } | null = null;
        let bd = SOCKET_SEARCH_RADIUS;
        for (const s of engine.sockets(state)) {
          const pos = this.socketScreenPos(state, s, asm);
          if (!pos) continue;
          const v = engine.hostOk(state, carry.uid, s);
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
        drop = overInv ? { type: 'inv' } : best && best.v.ok ? { type: 'sock', skey: best.s.skey } : null;
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

  private onWindowPointerUp = (): void => {
    const c = takeCarry();
    if (!c || !this.lastState) return;
    if (!c.armed) return; // plain click: no engine call, let dblclick logic (handlePOPointerDown) own it
    const state = this.lastState;
    const { engine } = this.deps;
    const drop = c.drop;
    if (c.kind === 'po' && drop && (drop.type === 'inv' || drop.type === 'grid')) {
      engine.movePO(state, c.uid, drop.type === 'inv' ? 'inv' : drop.anchor);
    } else if (c.kind === 'asm' && drop && (drop.type === 'inv' || drop.type === 'grid')) {
      engine.moveAssembly(state, drop.type === 'inv' ? 'inv' : drop.anchor);
    } else if (c.kind === 'bp' && drop && c.bpId && drop.type === 'bp') {
      engine.moveBP(state, c.bpId, drop.origin);
    } else if (c.kind === 'si') {
      if (drop?.type === 'sock') engine.seatSI(state, c.uid, drop.skey);
      else if (drop?.type === 'inv') engine.stowSI(state, c.uid);
    }
    this.gCarry.removeChildren();
    this.gTarget.removeChildren();
    notifyStateChanged();
  };

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
   * (`x:pt.x-32,y:pt.y-110,w:64,h:150` for blade, `y:pt.y+40,h:66` hilt). */
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
   * at low alpha, matching the mock's BP-carry ghost. */
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
