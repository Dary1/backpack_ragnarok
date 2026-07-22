// client/src/board/ghosts.ts -- REQ-0047 (f2-3): carry ghosts, reject-flash, neutral-return paint, claim success pulse.
// Moved MECHANICALLY from BoardRenderer.ts (this. -> self. receiver).
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Assembly, BP, Cell, ItemDefMap, PO } from '../engine/engine.d.ts';
import { CELL, CLAIM_PULSE_BLINK_MS, CLAIM_PULSE_TOTAL_MS, FLASH_MS, PAD, fitSpriteToBox } from './geom';
import { itemTex } from './itemArt'; // REQ-0288: ONE texture chain for placed art AND ghosts
import { drawPOOutline } from './poOutline'; // REQ-0288: no-art footprint fallback
import type { BoardRenderer } from './BoardRenderer';

export function renderGhostPO(self: BoardRenderer, p: PO, def: ItemDefMap[string] | undefined, x: number, y: number): boolean {
    const { engine, textures } = self.deps;
    // REQ-0288: resolve through THE chain (registry raster -> sprite symbol)
    // via itemTex, exactly like the placed-PO path. textures.get(def.icon)
    // was the LEGACY sprite key only -- the reason every registry-art PO
    // (most of the corpus since REQ-0133) dragged with no ghost at all.
    const texture = def ? itemTex(textures, p.id, def.icon) : undefined;
    if (!def || !texture) {
      // REQ-0288: a drag must NEVER be invisible -- degrade to a neutral
      // footprint ghost + the true-cell outline (drawPOOutline works in
      // cell space, so everything draws into a holder positioned at the
      // pointer box; shapeInfo's offsets are already rotation-applied).
      const offs: ReadonlyArray<[number, number]> = engine.shapeInfo(p.id, p.rot).off ?? [];
      const base: ReadonlyArray<[number, number]> = offs.length ? offs : [[0, 0]];
      const cells: Cell[] = base.map(([r, c]) => [r + 1, c + 1] as Cell);
      const holder = new Container();
      holder.alpha = 0.75;
      const g = new Graphics();
      for (const [r, c] of cells) g.roundRect(PAD + (c - 1) * CELL + 3, PAD + (r - 1) * CELL + 3, CELL - 6, CELL - 6, 6);
      g.fill({ color: '#8a8a8a', alpha: 0.35 });
      g.stroke({ color: '#8a8a8a', width: 2, alpha: 0.6 });
      holder.addChild(g);
      const outline = new Graphics();
      drawPOOutline(outline, cells);
      holder.addChild(outline);
      holder.position.set(x - PAD, y - PAD);
      self.gCarry.addChild(holder);
      return false;
    }
    const { w: cw, h: ch } = engine.shapeInfo(p.id, 0);
    const W0 = cw * CELL;
    const H0 = ch * CELL;
    const k = ((p.rot % 4) + 4) % 4;
    const sprite = new Sprite(texture);
    // REQ-0028 (aspect law): uniform contain-fit box, matching the
    // placed-PO draw path above (see fitSpriteToBox doc).
    if (def.stretch) {
      fitSpriteToBox(sprite, W0 * 0.1, H0 * 0.1, W0 * 0.8, H0 * 0.8, def.align, { x: 0, y: 0, w: W0, h: H0 });
    } else {
      fitSpriteToBox(sprite, W0 * 0.06, H0 * 0.05, W0 * 0.88, H0 * 0.9, def.align, { x: 0, y: 0, w: W0, h: H0 });
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
    self.gCarry.addChild(inner);
    return true;
  }

  /** Ghost for the carried Blade+Hilt assembly -- fixed-size icons at
   * offsets from the pointer, matching the mock's assembly ghost
   * (`x:pt.x-32,y:pt.y-110,w:64,h:150` for blade, `y:pt.y+40,h:66` hilt).
   * Canvas-only (see onGlobalPointerMove's 'asm' branch). */
export function renderGhostAssembly(self: BoardRenderer, asm: Assembly, px: number, py: number): void {
    const { items, textures } = self.deps;
    const bladeDef = items[asm.blade.id];
    const bladeTex = bladeDef && itemTex(textures, asm.blade.id, bladeDef.icon); // REQ-0288: registry-first, like everything else
    if (bladeTex) {
      const sprite = new Sprite(bladeTex);
      sprite.x = px - 32;
      sprite.y = py - 110;
      sprite.width = 64;
      sprite.height = 150;
      sprite.alpha = 0.75;
      self.gCarry.addChild(sprite);
    }
    const hiltDef = items[asm.hilt.id];
    const hiltTex = hiltDef && itemTex(textures, asm.hilt.id, hiltDef.icon); // REQ-0288
    if (hiltTex) {
      const sprite = new Sprite(hiltTex);
      sprite.x = px - 32;
      sprite.y = py + 40;
      sprite.width = 64;
      sprite.height = 66;
      sprite.alpha = 0.75;
      self.gCarry.addChild(sprite);
    }
  }

/** REQ-0289: a rotated VIEW of a floating bag -- the candidate the client
 * feeds renderGhostBP so the ghost previews the ROTATED footprint (shape),
 * Unit disc (unitOff, null for a unit-less BP) and each contained PO
 * (id + LOCAL offset from the new shape origin + rotated rot). Keeping the
 * view external keeps renderGhostBP itself dumb: it draws either the real bag
 * (no view) or this candidate, one code path. */
export interface BPGhostView {
  shape: [number, number][];
  unitOff: [number, number] | null;
  pos: { id: string; local: [number, number]; rot: number }[];
}

/** REQ-0288: ghost for a dragged BP -- the WHOLE bag at the snapped drop
 * origin, drawn on every hover (legal at the familiar 0.4 wash, illegal
 * dimmer -- the red target paint carries the verdict; the ghost carries the
 * SHAPE), with a mini unit-core disc at the seat cell and each contained PO's
 * art riding along (same contain-fit + k-quadrant math as the placed path, at
 * 0.6 alpha). REQ-0289: when `view` is supplied (a floating bag carrying a
 * pending rotation), the ghost draws the ROTATED shape/unit/PO layout the view
 * describes instead of the bag's current one -- geometry only, still dumb.
 * Returns whether any contained-PO art was drawn (e2e probe seam). Cells
 * outside this board's bounds clip, as before. */
export function renderGhostBP(
  self: BoardRenderer,
  originContainer: { pos: PO[] },
  bp: BP,
  origin: Cell,
  legal: boolean,
  view?: BPGhostView
): boolean {
    const { engine, textures, items, layout } = self.deps;
    const inBounds = ([r, c]: Cell): boolean => r >= 1 && r <= layout.ROWS && c >= 1 && c <= layout.COLS;
    const shape = view ? view.shape : bp.shape;
    for (const [dr, dc] of shape) {
      const cell: Cell = [origin[0] + dr, origin[1] + dc];
      if (!inBounds(cell)) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (cell[1] - 1) * CELL + 4, PAD + (cell[0] - 1) * CELL + 4, CELL - 8, CELL - 8, 6);
      rect.fill({ color: bp.color, alpha: legal ? 0.4 : 0.18 });
      self.gCarry.addChild(rect);
    }
    const unitOff = view ? view.unitOff : bp.unit ? bp.unit.off : null;
    if (unitOff) {
      const seat: Cell = [origin[0] + unitOff[0], origin[1] + unitOff[1]];
      if (inBounds(seat)) {
        const disc = new Graphics();
        disc.circle(PAD + (seat[1] - 0.5) * CELL, PAD + (seat[0] - 0.5) * CELL, CELL * 0.27);
        disc.fill({ color: '#0e0d0b', alpha: 0.55 });
        disc.stroke({ color: '#59d6d6', alpha: 0.6, width: 1 });
        self.gCarry.addChild(disc);
      }
    }
    let drewArt = false;
    const drawPOArt = (id: string, at: Cell, rot: number): void => {
      const def = items[id];
      if (!def) return;
      const texture = itemTex(textures, id, def.icon);
      if (!texture) return;
      if (!inBounds(at)) return;
      const bx = PAD + (at[1] - 1) * CELL;
      const by = PAD + (at[0] - 1) * CELL;
      const { w, h } = engine.shapeInfo(id, rot);
      const { w: cw, h: ch } = engine.shapeInfo(id, 0);
      const W0 = cw * CELL;
      const H0 = ch * CELL;
      const k = ((rot % 4) + 4) % 4;
      const sprite = new Sprite(texture);
      if (def.stretch) {
        fitSpriteToBox(sprite, W0 * 0.1, H0 * 0.1, W0 * 0.8, H0 * 0.8, def.align, { x: 0, y: 0, w: W0, h: H0 });
      } else {
        fitSpriteToBox(sprite, W0 * 0.06, H0 * 0.05, W0 * 0.88, H0 * 0.9, def.align, { x: 0, y: 0, w: W0, h: H0 });
      }
      const inner = new Container();
      inner.alpha = 0.6;
      inner.addChild(sprite);
      if (k === 0) {
        inner.position.set(bx, by);
      } else if (k === 1) {
        inner.position.set(bx + w * CELL, by);
        inner.rotation = Math.PI / 2;
      } else if (k === 2) {
        inner.position.set(bx + w * CELL, by + h * CELL);
        inner.rotation = Math.PI;
      } else {
        inner.position.set(bx, by + h * CELL);
        inner.rotation = -Math.PI / 2;
      }
      self.gCarry.addChild(inner);
      drewArt = true;
    };
    if (view) {
      for (const p of view.pos) drawPOArt(p.id, [origin[0] + p.local[0], origin[1] + p.local[1]], p.rot);
    } else {
      const bpCellSet = new Set(engine.bpCells(bp).map(([r, c]) => `${r},${c}`));
      for (const p of originContainer.pos) {
        if (p.loc !== 'grid' || !p.cell) continue;
        if (!bpCellSet.has(`${p.cell[0]},${p.cell[1]}`)) continue;
        const local: Cell = [p.cell[0] - bp.origin[0], p.cell[1] - bp.origin[1]];
        drawPOArt(p.id, [origin[0] + local[0], origin[1] + local[1]], p.rot);
      }
    }
    return drewArt;
  }

  /** REQ-0033 Phase 2: neutral "will return to inventory" hover
   * indicator for a canvas-originated PO/SI carry hovering an inventory
   * board -- a dim/neutral-gray tint (NOT green, NOT red) at the hovered
   * cell, communicating "dropping anywhere here removes the canvas
   * reference and the item stays exactly where its home already is" --
   * there is no legality question to visualize for this direction
   * (removeRef always succeeds, drop cell is irrelevant), so this is
   * deliberately never colored as a pass/fail judgment the way `paint`
   * above is for every OTHER drag direction. */
export function paintNeutralReturn(self: BoardRenderer, cell: Cell): void {
    const [r, c] = cell;
    if (r < 1 || r > self.deps.layout.ROWS || c < 1 || c > self.deps.layout.COLS) return;
    const rect = new Graphics();
    rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
    rect.fill({ color: '#8a8a8a', alpha: 0.18 });
    rect.stroke({ color: '#8a8a8a', width: 2, alpha: 0.5 });
    self.gTarget.addChild(rect);
  }

  /** Brief red-outline reject feedback on illegal double-click-rotate
   * targets -- matches the mock's flash() (350ms auto-remove). */
export function flash(self: BoardRenderer, cells: Cell[] | undefined, color: string = '#c05050'): void {
    for (const [r, c] of cells ?? []) {
      if (r < 1 || r > self.deps.layout.ROWS || c < 1 || c > self.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
      rect.stroke({ color, width: 3 });
      self.gTarget.addChild(rect);
      const timer = setTimeout(() => {
        rect.destroy();
        self.flashTimers.delete(timer);
      }, FLASH_MS);
      self.flashTimers.add(timer);
    }
  }

  /** REQ-0041 -- warehouse-claim placement pulse ("ピコンピコン"): a
   * SUCCESS-colored (green) blinking outline over `cells` for ~2 seconds
   * total, reusing this class's EXISTING flash-overlay mechanism
   * (gTarget layer + self.flashTimers bookkeeping, same as the private
   * flash() reject-feedback above) rather than inventing a new Pixi
   * overlay approach -- per the task brief's own instruction to reuse
   * an existing highlight/flash mechanism if the renderer already has
   * one. PUBLIC (unlike flash()) so WarehouseTab.tsx's claim-flow code
   * can call it directly on the renderer instance it already holds a
   * ref to, immediately after committing the engine placement mutation
   * (before/alongside notifyStateChanged()). Composed of repeated
   * on/off blinks (not a single fade) to read as a distinct "received an
   * item" cue, visually different from the reject-flash's single red
   * outline. Safe to call on a disposed renderer (no-op) or with no
   * cells (no-op either way).
   */
export function pulseCellsSuccess(self: BoardRenderer, cells: Cell[] | undefined): void {
    if (self.disposed) return;
    for (const [r, c] of cells ?? []) {
      if (r < 1 || r > self.deps.layout.ROWS || c < 1 || c > self.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
      rect.stroke({ color: '#59d68a', width: 3 });
      rect.visible = true;
      self.gTarget.addChild(rect);
      let elapsed = 0;
      let currentTimer: ReturnType<typeof setTimeout>;
      const blink = (): void => {
        self.flashTimers.delete(currentTimer);
        elapsed += CLAIM_PULSE_BLINK_MS;
        rect.visible = !rect.visible;
        if (elapsed >= CLAIM_PULSE_TOTAL_MS) {
          rect.destroy();
          return;
        }
        currentTimer = setTimeout(blink, CLAIM_PULSE_BLINK_MS);
        self.flashTimers.add(currentTimer);
      };
      currentTimer = setTimeout(blink, CLAIM_PULSE_BLINK_MS);
      self.flashTimers.add(currentTimer);
    }
  }
