// PixiJS read-only board renderer — REQ-0026 T0.1.
// Framework-free (no React here); layout constants (CELL/PAD) and the
// overall composition mirror mock-src/ui.js's SVG renderAll() for visual
// parity (same reference, not pixel-exact): grid cells tinted by BP (dead
// space cells get a flat dark fill, same as the mock), BP outlines +
// name/HP label, linker cores + direction dots, beams (solid+arrowhead when
// linked, dashed+x when a dud), placed PO art, port target ◇ marks, and
// established-connection ◆ marks. Drag-drop, combos, inventory panel and
// Save/Load are NOT rendered here (T0.2 scope; see REQ-0026 spec's
// non-goals) -- this is the read-only subset only.
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { EngineInstance, GameState, ItemDefMap, Layout } from '../engine/engine.d.ts';

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
  textures: Map<string, Texture>;
  layout: Layout;
}

export class BoardRenderer {
  private app: Application;
  private root = new Container();
  private gBase = new Container();
  private gBeams = new Container();
  private gItems = new Container();
  private gLinkers = new Container();
  private gTarget = new Container();
  private deps: BoardDeps;
  private disposed = false;

  private constructor(app: Application, deps: BoardDeps) {
    this.app = app;
    this.deps = deps;
    this.root.addChild(this.gBase, this.gBeams, this.gItems, this.gLinkers, this.gTarget);
    this.app.stage.addChild(this.root);
  }

  static async mount(canvas: HTMLCanvasElement, deps: BoardDeps): Promise<BoardRenderer> {
    const app = new Application();
    const width = PAD * 2 + deps.layout.COLS * CELL;
    const height = PAD * 2 + deps.layout.ROWS * CELL;
    await app.init({ canvas, width, height, background: '#121212', antialias: true });
    return new BoardRenderer(app, deps);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.app.destroy(true, { children: true });
  }

  render(state: GameState): void {
    const { engine, items, textures, layout } = this.deps;
    this.gBase.removeChildren();
    this.gBeams.removeChildren();
    this.gItems.removeChildren();
    this.gLinkers.removeChildren();
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
      this.gBase.addChild(outline);

      const r0 = Math.min(...cells.map((cell) => cell[0]));
      const c0 = Math.min(...cells.filter((cell) => cell[0] === r0).map((cell) => cell[1]));
      const label = new Text({
        text: `${bp.name} · HP ${cells.length * 5}`,
        style: { fill: bp.color, fontSize: 12, fontWeight: 'bold' },
      });
      label.x = PAD + (c0 - 1) * CELL + 4;
      label.y = PAD + (r0 - 1) * CELL - 18;
      this.gBase.addChild(label);
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

    // placed POs
    for (const p of state.pos) {
      if (p.loc !== 'grid' || !p.cell) continue;
      const def = items[p.id];
      if (!def) continue;
      const { w, h } = engine.shapeInfo(p.id, p.rot);
      const box = {
        x: PAD + (p.cell[1] - 1) * CELL,
        y: PAD + (p.cell[0] - 1) * CELL,
        w: w * CELL,
        h: h * CELL,
      };
      for (const [r, c] of engine.cellsOf(state, p)) {
        const bg = new Graphics();
        bg.roundRect(PAD + (c - 1) * CELL + 3, PAD + (r - 1) * CELL + 3, CELL - 6, CELL - 6, 6);
        bg.fill({ color: '#000000', alpha: 0.22 });
        this.gItems.addChild(bg);
      }
      const texture = textures.get(def.icon);
      if (texture) {
        const sprite = new Sprite(texture);
        const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
        const W0 = cw * CELL;
        const H0 = ch * CELL;
        const k = ((p.rot % 4) + 4) % 4;
        if (def.stretch) {
          sprite.x = W0 * 0.1;
          sprite.y = 4;
          sprite.width = W0 * 0.8;
          sprite.height = H0 - 8;
        } else {
          sprite.x = W0 * 0.06;
          sprite.y = H0 * 0.05;
          sprite.width = W0 * 0.88;
          sprite.height = H0 * 0.9;
        }
        const inner = new Container();
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
      this.gLinkers.addChild(core);
      const linkerTexture = textures.get('icon-linker_core');
      if (linkerTexture) {
        const sprite = new Sprite(linkerTexture);
        sprite.width = 44;
        sprite.height = 44;
        sprite.x = x - 22;
        sprite.y = y - 22;
        this.gLinkers.addChild(sprite);
      }
      for (const d of bp.linker.dirs) {
        const ang = (DIR_ANGLES[d] * Math.PI) / 180;
        const dot = new Graphics();
        dot.circle(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 4);
        dot.fill({ color: '#59d6d6' });
        this.gLinkers.addChild(dot);
      }
    }
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
}
