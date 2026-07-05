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
import { cellIdToXY, FIELD_COLS, FIELD_ROWS, parseBoxToPixelRect, type RawCell } from './fieldGeometry';
import { computeFootprintCells } from '../render/itemCard';
import type { Offset } from '../engine/engine.d.ts';

export const FIELD_CELL_PX = 18; // small-scale -- 26x18 cells at 18px = 468x324px per field
const FIELD_GAP_PX = 24;
export const FIELD_W = FIELD_COLS * FIELD_CELL_PX;
const FIELD_H = FIELD_ROWS * FIELD_CELL_PX;
const STEP_ANIM_MS = 200; // per ray_step segment, within the 150-300ms band the task brief calls for
const FLASH_MS = 300;

/** Type guard for the RawCell ([row,col] number tuple) wire shape -- see
 * fieldGeometry.ts's RawCell/cellIdToColRow doc for why this is the
 * ACTUAL shape sim/combat.cjs sends for entry/at/path[] entries (BUG #4's
 * root cause was this renderer assuming a "M9"-string shape instead). */
function isRawCell(v: unknown): v is RawCell {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** One BP's footprint for monitor display, ALREADY positioned at its own
 * absolute canvas origin (row/col offset from the unit's local (1,1) --
 * NOT renormalized to (0,0) the way a single isolated BP's `shape` is).
 * REQ-0045 (d): a unit's canvas can hold MULTIPLE BPs, each at its own
 * place on the shared 8x8 local grid -- see sim/combat.cjs's
 * compileUnitSnapshot/localBpCells, which already does exactly this for
 * the actual combat simulation (bps.map(...) over EVERY bp, each cell
 * offset by its own bpDef.origin) -- this client-side visual type used
 * to carry only ONE representative {bpColor,bpShape} pair per unit
 * (always the FIRST bp, always drawn as if `origin` were (0,0)/top-left
 * of the formation box), which is the client-only root of the "only the
 * first BP is copied, auto-placed top-left" bug; the sim itself was
 * always correct. */
export interface MonitorUnitBP {
  color: string;
  /** Absolute local-grid cells this BP occupies, i.e. shape offsets
   * already added to the BP's own origin (mirrors sim/combat.cjs's
   * localBpCells: origin[0]+dr, origin[1]+dc) -- NOT re-normalized. */
  cells: Offset[];
}

/** One placed PO's icon, positioned at its own absolute local-grid
 * origin cell (top-left of its footprint) -- REQ-0045 (d): a unit's
 * canvas can hold multiple placed POs across its BPs; this used to carry
 * only one optional representative icon (never actually populated by
 * Monitor.tsx in practice), now a full list mirroring the preset's real
 * `pos` array. */
export interface MonitorUnitIcon {
  textureKey: string;
  shape: Offset[]; // unrotated PO footprint offsets (drawn at `rot`, matching computeFootprintCells' own rot param)
  rot: number;
  origin: Offset; // absolute local-grid top-left cell (PO.cell, 1-indexed local coords)
}

export interface MonitorUnitVisual {
  slotIndex: number;
  box: string; // "TopLeft:BottomRight", e.g. "F2:M9"
  /** REQ-0045 (d): EVERY BP on this unit's canvas, each already
   * positioned at its own absolute origin -- a full 1:1 copy of the
   * preset's `bps` array, not just bps[0]. */
  bps: MonitorUnitBP[];
  label: string;
  /** REQ-0045 (d): EVERY placed PO on this unit's canvas (small-scale
   * art per the task brief -- "small-scale BP/PO art", not a full
   * per-item render), each at its own absolute origin cell. Empty array
   * (not optional) when the preset has no placed POs. */
  icons: MonitorUnitIcon[];
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
  /** REQ-0045 (d) regression-test seam: the exact units array mountUnits()
   * was last called with, exposed read-only via getLastMountedUnits() so
   * client/e2e/*.spec.ts can assert on the full BP/PO copy (every BP's
   * cells, every placed PO's icon) instead of reverse-engineering PixiJS
   * canvas pixel colors -- same rationale as store.ts's own
   * __backpackDebug hook. Never read by any production UI code path. */
  private lastMountedUnits: MonitorUnitVisual[] = [];

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
    this.lastMountedUnits = units;
    // Remove any previously-drawn unit graphics (keep the backdrop, which
    // is always this container's first child).
    while (this.playerField.children.length > 1) {
      this.playerField.removeChildAt(1);
    }
    for (const unit of units) {
      const rect = parseBoxToPixelRect(unit.box, FIELD_CELL_PX);
      const cellW = rect.w / 8;
      const cellH = rect.h / 8;

      // Formation box outline (unchanged).
      const outline = new Graphics();
      outline.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: 0x59d6d6, width: 1, alpha: 0.5 });
      outline.eventMode = 'none';
      this.playerField.addChild(outline);

      // REQ-0045 (d): draw EVERY BP's footprint, each at its OWN absolute
      // local-grid cells (unit.bps[i].cells already carries origin-
      // adjusted offsets -- see MonitorUnitBP's own doc) -- a 1:1 visual
      // copy of the preset's real bps array, not just bps[0] drawn as if
      // it alone occupied the whole box from (0,0).
      for (const bp of unit.bps) {
        const g = new Graphics();
        const colorNum = parseInt(bp.color.replace('#', ''), 16) || 0x888888;
        for (const [r, c] of bp.cells) {
          g.rect(rect.x + c * cellW, rect.y + r * cellH, cellW, cellH).fill({ color: colorNum, alpha: 0.55 });
        }
        g.eventMode = 'none';
        this.playerField.addChild(g);
      }

      const label = new Text({ text: unit.label, style: { fill: 0xe8e0d0, fontSize: 10 } });
      label.x = rect.x + 2;
      label.y = rect.y + 2;
      label.eventMode = 'none';
      this.playerField.addChild(label);

      // REQ-0045 (d): draw EVERY placed PO's icon (small-scale art, per
      // the task brief), each at its own absolute origin cell -- a 1:1
      // copy of the preset's real pos array, not a single "one
      // representative" icon (which Monitor.tsx never actually populated
      // in practice anyway -- units[].icon was always undefined before
      // this fix).
      for (const icon of unit.icons) {
        const texture = this.textures.get(icon.textureKey);
        if (!texture) continue;
        const footprint = computeFootprintCells(icon.shape, icon.rot);
        const sprite = new Sprite(texture);
        sprite.eventMode = 'none';
        const boxW = footprint.w * cellW;
        const boxH = footprint.h * cellH;
        const scale = Math.min(boxW / texture.width, boxH / texture.height);
        sprite.width = texture.width * scale;
        sprite.height = texture.height * scale;
        const [originR, originC] = icon.origin;
        sprite.x = rect.x + originC * cellW + (boxW - sprite.width) / 2;
        sprite.y = rect.y + originR * cellH + (boxH - sprite.height) / 2;
        this.playerField.addChild(sprite);
      }
    }
  }

  /** REQ-0045 (f) root cause: this Text label carried no width
   * constraint at all -- for a marker placed near the right edge of the
   * enemy field (FIELD_W = FIELD_COLS * FIELD_CELL_PX, 468px at the
   * current scale), a long enemy id/label (e.g. a real content id like
   * "frost_gnoll_scout", or any id longer than a couple of characters at
   * this tiny 9px scale) rendered well past the field's own right edge --
   * the footprint/column placement math itself was never at fault (see
   * the REQ-0045 outcome doc's seed-fuzz verification: hundreds of
   * seeds, up to 69-member packs, zero placement-math violations found).
   * Fixed by truncating (not scaling -- 9px text is already near the
   * legibility floor) the label to whatever fits within the remaining
   * horizontal space from this marker's own cell to the field's right
   * edge, with a trailing ellipsis when truncated, mirroring how a
   * plain CSS text-overflow:ellipsis behaves. */
  private truncateLabelToFit(label: string, style: { fill: number; fontSize: number }, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    const probe = new Text({ text: label, style });
    if (probe.width <= maxWidth) {
      probe.destroy();
      return label;
    }
    // Binary-search-free simple shrink loop -- label strings here are
    // short (enemy ids/names, not paragraphs), so a linear character
    // trim is plenty fast and keeps this straightforward to read.
    let truncated = label;
    while (truncated.length > 1) {
      truncated = truncated.slice(0, -1);
      probe.text = truncated + '…';
      if (probe.width <= maxWidth) break;
    }
    probe.destroy();
    return truncated.length > 1 ? truncated + '…' : truncated;
  }

  private getOrCreateEnemyMarker(cellId: string | RawCell, label: string, masked: boolean): FieldMarker {
    // Map key must be a plain string -- a RawCell (array) has no stable
    // value-equality as a Map key (two [row,col] arrays with the same
    // values are different references), so this derives a string key
    // from either shape (a string cellId is already a valid key; a
    // RawCell is joined into one) purely for the Map lookup/insert below.
    // Every other use of `cellId` (cellIdToXY) still gets the ORIGINAL
    // value, which already accepts either shape (see fieldGeometry.ts).
    const mapKey = Array.isArray(cellId) ? `${cellId[0]},${cellId[1]}` : cellId;
    const key = masked ? '?' : mapKey;
    let marker = this.enemyMarkers.get(mapKey);
    if (marker) return marker;
    const container = new Container();
    const graphic = new Graphics();
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: 0xc05050, alpha: 0.55 });
    graphic.eventMode = 'none';
    const textStyle = { fill: 0xe8e0d0, fontSize: 9 };
    const rawLabel = masked ? '?' : label;
    // REQ-0045 (f): clamp to whatever horizontal space remains between
    // this marker's own cell and the enemy field's right edge -- FIELD_W
    // is this field's full width; pos.x is already relative to the
    // enemy field's own local origin (see cellIdToXY/this.enemyField.x
    // offset), so (FIELD_W - pos.x) is exactly the remaining room.
    const maxWidth = Math.max(0, FIELD_W - pos.x);
    const fittedLabel = this.truncateLabelToFit(rawLabel, textStyle, maxWidth);
    const text = new Text({ text: fittedLabel, style: textStyle });
    text.eventMode = 'none';
    container.x = pos.x;
    container.y = pos.y;
    container.addChild(graphic);
    container.addChild(text);
    this.enemyField.addChild(container);
    marker = { container, graphic, label: text };
    this.enemyMarkers.set(mapKey, marker);
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

  private flashCell(cellId: string | RawCell): void {
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

  private pulseCell(cellId: string | RawCell): void {
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

  private animateStep(path: RawCell[]): void {
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
      // BUG #4 FIX (REQ-0041): each event is processed inside its own
      // try/catch. ROOT CAUSE this guards against (confirmed via a live
      // repro + captured browser exception -- see fieldGeometry.ts's
      // cellIdToColRow doc for the full mechanism): `entry`/`at`/`path[]`
      // on ray_fire/ray_bounce/ray_step are raw [row,col] NUMBER TUPLES on
      // the wire (sim/combat.cjs), not "M9"-style strings -- this renderer
      // used to assume the latter unconditionally and called `.trim()` on
      // them, throwing. Because Monitor.tsx's poll effect only advances
      // `lastEventIndexRef` AFTER applyEvents() returns without throwing,
      // an uncaught exception here meant the SAME stuck event got
      // re-thrown on every subsequent ~2s poll tick FOREVER -- a
      // permanent crash-loop that presented as the whole tab's renderer
      // becoming unresponsive, not a single frozen frame. Even with the
      // fieldGeometry.ts fix (which handles the specific [row,col]-tuple
      // shape correctly now), this per-event try/catch stays as
      // defense-in-depth: a MALFORMED or future-unknown event shape must
      // degrade to "skip this one event" (a dropped visual, not a crash),
      // and applyEvents() as a whole must ALWAYS finish so the caller can
      // always advance past whatever it just processed -- never spin.
      try {
        this.applyOneEvent(ev);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] MonitorRenderer: skipping malformed run event', ev, e);
      }
    }
  }

  private applyOneEvent(ev: ApiRunEvent): void {
    switch (ev.ev) {
      case 'ray_fire': {
        const field = ev.field === 'enemy' ? 'enemy' : 'player';
        const entry = isRawCell(ev.entry) ? ev.entry : null;
        if (field === 'enemy' && entry) this.getOrCreateEnemyMarker(entry, String(ev.src ?? '?'), ev.src === '?');
        break;
      }
      case 'ray_step': {
        const path = Array.isArray(ev.path) ? (ev.path as unknown[]).filter(isRawCell) : [];
        this.animateStep(path);
        break;
      }
      case 'ray_bounce': {
        const at = isRawCell(ev.at) ? ev.at : null;
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

  /** REQ-0045 (d) regression-test seam -- see lastMountedUnits' own doc
   * above. Returns the exact array (not a copy) mountUnits() was last
   * called with; callers must treat it as read-only. */
  getLastMountedUnits(): MonitorUnitVisual[] {
    return this.lastMountedUnits;
  }

  /** REQ-0045 (f) regression-test seam: every currently-mounted enemy
   * marker's actual PixiJS-computed local position + rendered text
   * width, so client/e2e/*.spec.ts can assert `x + labelWidth <=
   * FIELD_W` directly against the REAL rendered bounding box (not a
   * hand-recomputed estimate) -- same "assert on real data instead of
   * reverse-engineering canvas pixels" rationale as store.ts's own
   * __backpackDebug hook and getLastMountedUnits() above. Never read by
   * any production UI code path. */
  getEnemyMarkerBounds(): Array<{ x: number; labelWidth: number; labelText: string }> {
    return Array.from(this.enemyMarkers.values()).map((m) => ({
      x: m.container.x,
      labelWidth: m.label.width,
      labelText: m.label.text,
    }));
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
