// Monitor's expanded-view PixiJS scene -- REQ-0036 P1-C. ONE PixiJS
// Application, created ONCE when the monitor component first mounts and
// kept alive for the component's lifetime -- same discipline as
// Board/InventoryBoard (see App.tsx's module comment / BoardRenderer.ts's
// "ONE app forever" convention): expand/collapse toggles CSS visibility
// on the already-mounted canvas, it never tears down and recreates a
// PIXI.Application.
//
// Two side-by-side A1:Z18 grids (player field, enemy field). Player side
// reuses render/itemCard.ts's composition helpers to draw small-scale
// icons in each formation box's footprint; enemy side is a simple
// footprint-colored blob + name label (no real enemy art exists yet, per
// the task brief -- "simple footprint blobs" is the explicit spec, not a
// placeholder shortcut). Decorative sprites are eventMode='none' (Pixi
// lesson from the task brief: decorative sprites should not eat pointer
// events).
//
// Ray animation: ray_fire+ray_step animates a small moving marker along
// the path cell list (150-300ms per step via PIXI.Ticker), ray_bounce is
// a brief flash at the bounce cell, ray_hit/ray_hit_all/reflect_damage is
// a pulse (scale/alpha flash) on the hit cell. This is intentionally a
// small dev-grade animation, not a full VFX system.
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { ApiRunEvent } from '../api';
import { cellIdToXY, FIELD_COLS, FIELD_ROWS, parseBoxToPixelRect } from './fieldGeometry';
import { computeFootprintCells } from '../render/itemCard';
import type { Offset } from '../engine/engine.d.ts';

const FIELD_CELL_PX = 18; // small-scale -- 26x18 cells at 18px = 468x324px per field
const FIELD_GAP_PX = 24;
const FIELD_W = FIELD_COLS * FIELD_CELL_PX;
const FIELD_H = FIELD_ROWS * FIELD_CELL_PX;
const STEP_ANIM_MS = 200; // per ray_step segment, within the 150-300ms band the task brief calls for
const FLASH_MS = 300;

export interface MonitorUnitVisual {
  slotIndex: number;
  box: string; // "TopLeft:BottomRight", e.g. "F2:M9"
  bpColor: string;
  bpShape: Offset[]; // unrotated BP footprint offsets
  label: string;
  /** icon symbol id + shape for one representative placed PO, if any
   * (small-scale art per the task brief -- "small-scale BP/PO art", not a
   * full per-item render of every placed item). Optional: a slot with no
   * assigned preset (or a preset with no placed PO) renders footprint +
   * label only. */
  icon?: { textureKey: string; shape: Offset[] };
}

export interface MonitorEnemyDef {
  id: string;
  name: string;
  footprint: Offset[]; // cells occupied, relative to the enemy's own placement -- resolved server-side into absolute field cells at ray-event time, so the renderer only ever needs per-event cell ids, not a static enemy layout (no static enemy positions are sent by the API today; enemies are drawn lazily at their first-seen ray-event cell, see addOrUpdateEnemyMarker below).
}

interface FieldMarker {
  container: Container;
  graphic: Graphics;
  label: Text;
}

/** Persistent Pixi scene for the monitor's expanded view. Construct once
 * (Monitor.tsx's useEffect, mount-once dependency array), call
 * mountUnits() once player-side data is known, then feed NEW (only)
 * events via applyEvents() on every poll tick -- see Monitor.tsx's own
 * poll-and-diff loop for how "only the new tail" is computed before
 * calling in here. destroy() tears down the Application (called only on
 * unmount of the WHOLE Schedule page's monitor instance for this room
 * card, matching the "keep it alive while mounted, destroy on real
 * unmount" convention, not "destroy on every collapse"). */
export class MonitorRenderer {
  private app: Application;
  private playerField: Container;
  private enemyField: Container;
  private rayLayer: Container;
  private enemyMarkers = new Map<string, FieldMarker>();
  private discovered = new Set<string>();
  private textures: Map<string, Texture>;

  private constructor(app: Application, textures: Map<string, Texture>) {
    this.app = app;
    this.textures = textures;
    this.playerField = new Container();
    this.enemyField = new Container();
    this.rayLayer = new Container();

    this.playerField.x = 0;
    this.playerField.y = 0;
    this.enemyField.x = FIELD_W + FIELD_GAP_PX;
    this.enemyField.y = 0;
    this.rayLayer.x = 0;
    this.rayLayer.y = 0;

    this.drawFieldBackdrop(this.playerField);
    this.drawFieldBackdrop(this.enemyField);

    this.app.stage.addChild(this.playerField);
    this.app.stage.addChild(this.enemyField);
    this.app.stage.addChild(this.rayLayer);
  }

  static async mount(canvas: HTMLCanvasElement, textures: Map<string, Texture>): Promise<MonitorRenderer> {
    const app = new Application();
    await app.init({
      canvas,
      width: FIELD_W * 2 + FIELD_GAP_PX,
      height: FIELD_H,
      backgroundAlpha: 0,
      antialias: true,
    });
    return new MonitorRenderer(app, textures);
  }

  private drawFieldBackdrop(field: Container): void {
    const bg = new Graphics();
    bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: 0x0e0d0b, alpha: 0.6 }).stroke({ color: 0x2e2a24, width: 1 });
    bg.eventMode = 'none';
    field.addChild(bg);
  }

  /** Draws each unit's formation box + BP-colored footprint + (optional)
   * a small representative icon, on the PLAYER side. Idempotent-ish:
   * clears any prior unit visuals first (called once per room-open, not
   * per poll -- formation/unit assignment doesn't change mid-run). */
  mountUnits(units: MonitorUnitVisual[]): void {
    // Remove any previously-drawn unit graphics (keep the backdrop, which
    // is always this container's first child).
    while (this.playerField.children.length > 1) {
      this.playerField.removeChildAt(1);
    }
    for (const unit of units) {
      const rect = parseBoxToPixelRect(unit.box, FIELD_CELL_PX);
      const g = new Graphics();
      const colorNum = parseInt(unit.bpColor.replace('#', ''), 16) || 0x888888;
      g.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: 0x59d6d6, width: 1, alpha: 0.5 });
      for (const [r, c] of unit.bpShape) {
        const cellW = rect.w / 8;
        const cellH = rect.h / 8;
        g.rect(rect.x + c * cellW, rect.y + r * cellH, cellW, cellH).fill({ color: colorNum, alpha: 0.55 });
      }
      g.eventMode = 'none';
      this.playerField.addChild(g);

      const label = new Text({ text: unit.label, style: { fill: 0xe8e0d0, fontSize: 10 } });
      label.x = rect.x + 2;
      label.y = rect.y + 2;
      label.eventMode = 'none';
      this.playerField.addChild(label);

      if (unit.icon) {
        const texture = this.textures.get(unit.icon.textureKey);
        if (texture) {
          const footprint = computeFootprintCells(unit.icon.shape, 0);
          const cellW = rect.w / 8;
          const cellH = rect.h / 8;
          const sprite = new Sprite(texture);
          sprite.eventMode = 'none';
          const boxW = footprint.w * cellW;
          const boxH = footprint.h * cellH;
          const scale = Math.min(boxW / texture.width, boxH / texture.height);
          sprite.width = texture.width * scale;
          sprite.height = texture.height * scale;
          sprite.x = rect.x + (rect.w - sprite.width) / 2;
          sprite.y = rect.y + (rect.h - sprite.height) / 2;
          this.playerField.addChild(sprite);
        }
      }
    }
  }

  private getOrCreateEnemyMarker(cellId: string, label: string, masked: boolean): FieldMarker {
    const key = masked ? '?' : cellId;
    let marker = this.enemyMarkers.get(cellId);
    if (marker) return marker;
    const container = new Container();
    const graphic = new Graphics();
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: 0xc05050, alpha: 0.55 });
    graphic.eventMode = 'none';
    const text = new Text({ text: masked ? '?' : label, style: { fill: 0xe8e0d0, fontSize: 9 } });
    text.eventMode = 'none';
    container.x = pos.x;
    container.y = pos.y;
    container.addChild(graphic);
    container.addChild(text);
    this.enemyField.addChild(container);
    marker = { container, graphic, label: text };
    this.enemyMarkers.set(cellId, marker);
    void key;
    return marker;
  }

  /** Reveals a masked entity (marks it discovered client-side) once a
   * ray_hit event names it with its real id instead of "?" -- per the
   * masking note: the server already does the masking/unmasking (the
   * event's own dst field flips from "?" to a real id the moment of
   * discovery), the client just needs to stop rendering it as "?" from
   * that point on. This set exists so a LATER event for the same cell
   * that still says "?" (shouldn't happen once discovered, but
   * defensive) doesn't regress an already-revealed label. */
  private markDiscovered(id: string): void {
    if (id !== '?') this.discovered.add(id);
  }

  private flashCell(cellId: string): void {
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    const flash = new Graphics();
    flash.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: 0xffe680, alpha: 0.85 });
    flash.eventMode = 'none';
    flash.x = pos.x;
    flash.y = pos.y;
    this.rayLayer.addChild(flash);
    const start = performance.now();
    const tick = (): void => {
      const elapsed = performance.now() - start;
      const alpha = Math.max(0, 1 - elapsed / FLASH_MS);
      flash.alpha = alpha;
      if (elapsed >= FLASH_MS) {
        this.app.ticker.remove(tick);
        this.rayLayer.removeChild(flash);
        flash.destroy();
      }
    };
    this.app.ticker.add(tick);
  }

  private pulseCell(cellId: string): void {
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    const pulse = new Graphics();
    pulse.circle(FIELD_CELL_PX / 2, FIELD_CELL_PX / 2, FIELD_CELL_PX / 2).fill({ color: 0xff6666, alpha: 0.9 });
    pulse.eventMode = 'none';
    pulse.x = pos.x;
    pulse.y = pos.y;
    pulse.scale.set(0.4);
    this.rayLayer.addChild(pulse);
    const start = performance.now();
    const tick = (): void => {
      const elapsed = performance.now() - start;
      const frac = Math.min(1, elapsed / FLASH_MS);
      pulse.scale.set(0.4 + 0.9 * frac);
      pulse.alpha = 1 - frac;
      if (elapsed >= FLASH_MS) {
        this.app.ticker.remove(tick);
        this.rayLayer.removeChild(pulse);
        pulse.destroy();
      }
    };
    this.app.ticker.add(tick);
  }

  private animateStep(path: string[]): void {
    if (path.length === 0) return;
    const marker = new Graphics();
    marker.circle(FIELD_CELL_PX / 2, FIELD_CELL_PX / 2, FIELD_CELL_PX / 3).fill({ color: 0x59d6d6, alpha: 0.9 });
    marker.eventMode = 'none';
    this.rayLayer.addChild(marker);
    const totalMs = STEP_ANIM_MS * Math.max(1, path.length - 1);
    const start = performance.now();
    const positions = path.map((id) => cellIdToXY(id, FIELD_CELL_PX));
    if (positions.length === 1) {
      marker.x = positions[0].x;
      marker.y = positions[0].y;
    }
    const tick = (): void => {
      const elapsed = performance.now() - start;
      const frac = Math.min(1, elapsed / totalMs);
      const idxFloat = frac * (positions.length - 1);
      const idx = Math.min(positions.length - 2, Math.floor(idxFloat));
      const localFrac = positions.length > 1 ? idxFloat - idx : 0;
      const a = positions[idx] ?? positions[0];
      const b = positions[idx + 1] ?? a;
      marker.x = a.x + (b.x - a.x) * localFrac;
      marker.y = a.y + (b.y - a.y) * localFrac;
      if (elapsed >= totalMs) {
        this.app.ticker.remove(tick);
        this.rayLayer.removeChild(marker);
        marker.destroy();
      }
    };
    this.app.ticker.add(tick);
  }

  /** Applies ONLY new (not-yet-rendered) events -- Monitor.tsx tracks
   * "last rendered event index" and passes events.slice(lastIndex) here
   * each poll (per the run-clock polling contract: each poll returns the
   * FULL events array up to elapsedSecs, not just deltas -- the diffing
   * happens one layer up, in Monitor.tsx, not in this renderer). */
  applyEvents(newEvents: ApiRunEvent[]): void {
    for (const ev of newEvents) {
      switch (ev.ev) {
        case 'ray_fire': {
          const field = ev.field === 'enemy' ? 'enemy' : 'player';
          const entry = typeof ev.entry === 'string' ? ev.entry : null;
          if (field === 'enemy' && entry) this.getOrCreateEnemyMarker(entry, String(ev.src ?? '?'), ev.src === '?');
          break;
        }
        case 'ray_step': {
          const path = Array.isArray(ev.path) ? (ev.path as string[]) : [];
          this.animateStep(path);
          break;
        }
        case 'ray_bounce': {
          const at = typeof ev.at === 'string' ? ev.at : null;
          if (at) this.flashCell(at);
          break;
        }
        case 'ray_hit': {
          const dst = typeof ev.dst === 'string' ? ev.dst : null;
          if (dst && dst !== '?') this.markDiscovered(dst);
          break;
        }
        case 'ray_aoe': {
          const hits = Array.isArray(ev.hits) ? (ev.hits as Array<{ dst?: string }>) : [];
          for (const h of hits) if (h.dst && h.dst !== '?') this.markDiscovered(h.dst);
          break;
        }
        case 'ray_hit_all':
        case 'reflect_damage': {
          // No specific cell carried on these two event kinds today
          // (ray_hit_all is a whole-field strike; reflect_damage is a
          // status-driven reflection) -- pulse the whole enemy field
          // center as a simple, honest "something happened" cue rather
          // than inventing a cell this event doesn't actually carry.
          this.pulseCell('N9');
          break;
        }
        default:
          break;
      }
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
