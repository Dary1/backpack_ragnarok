// client/src/board/ghosts.ts -- REQ-0047 (f2-3): carry ghosts, reject-flash, neutral-return paint, claim success pulse.
// Moved MECHANICALLY from BoardRenderer.ts (this. -> self. receiver).
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Assembly, Cell, ItemDefMap, PO } from '../engine/engine.d.ts';
import { CELL, CLAIM_PULSE_BLINK_MS, CLAIM_PULSE_TOTAL_MS, FLASH_MS, PAD, fitSpriteToBox } from './geom';
import type { BoardRenderer } from './BoardRenderer';

export function renderGhostPO(self: BoardRenderer, p: PO, def: ItemDefMap[string] | undefined, x: number, y: number): void {
    if (!def) return;
    const { engine, textures } = self.deps;
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
  }

  /** Ghost for the carried Blade+Hilt assembly -- fixed-size icons at
   * offsets from the pointer, matching the mock's assembly ghost
   * (`x:pt.x-32,y:pt.y-110,w:64,h:150` for blade, `y:pt.y+40,h:66` hilt).
   * Canvas-only (see onGlobalPointerMove's 'asm' branch). */
export function renderGhostAssembly(self: BoardRenderer, asm: Assembly, px: number, py: number): void {
    const { items, textures } = self.deps;
    const bladeDef = items[asm.blade.id];
    const bladeTex = bladeDef && textures.get(bladeDef.icon);
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
    const hiltTex = hiltDef && textures.get(hiltDef.icon);
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

  /** Ghost preview for a dragged BP -- tinted cells in the BP's own color
   * at low alpha, matching the mock's BP-carry ghost. Shows the WHOLE BP
   * footprint (REQ-0030 spec item 3), same on both boards and during a
   * cross-board transfer preview (the cells are already computed in the
   * TARGET board's coordinate space by canMoveBP/invCanPlaceBP/
   * canTransferBP, so no extra translation is needed here). */
export function renderGhostBP(self: BoardRenderer, color: string, cells: Cell[]): void {
    for (const [r, c] of cells) {
      if (r < 1 || r > self.deps.layout.ROWS || c < 1 || c > self.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 4, PAD + (r - 1) * CELL + 4, CELL - 8, CELL - 8, 6);
      rect.fill({ color, alpha: 0.4 });
      self.gCarry.addChild(rect);
    }
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
export function flash(self: BoardRenderer, cells: Cell[] | undefined): void {
    for (const [r, c] of cells ?? []) {
      if (r < 1 || r > self.deps.layout.ROWS || c < 1 || c > self.deps.layout.COLS) continue;
      const rect = new Graphics();
      rect.roundRect(PAD + (c - 1) * CELL + 2, PAD + (r - 1) * CELL + 2, CELL - 4, CELL - 4, 6);
      rect.stroke({ color: '#c05050', width: 3 });
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
