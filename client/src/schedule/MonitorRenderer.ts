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
import type { ChimeSink } from './chimes/chimeMapping';
import { cellIdToXY, FIELD_COLS, FIELD_ROWS, parseBoxToPixelRect, type RawCell } from './fieldGeometry';
import { computeFootprintCells } from '../render/itemCard';
import type { Offset } from '../engine/engine.d.ts';

export const FIELD_CELL_PX = 18; // small-scale -- 26x18 cells at 18px = 468x324px per field
const FIELD_GAP_PX = 24;
export const FIELD_W = FIELD_COLS * FIELD_CELL_PX;
const FIELD_H = FIELD_ROWS * FIELD_CELL_PX;
const STEP_ANIM_MS = 200; // per ray_step segment, within the 150-300ms band the task brief calls for
const FLASH_MS = 300;

// REQ-0169 M2: enemy label style + lane geometry (dots stay at their true
// cells; colliding labels bump DOWN a lane, up to MAX_LABEL_LANES, then
// hide).
const ENEMY_LABEL_STYLE = { fill: 0xe8e0d0, fontSize: 9 };
const LABEL_LANE_H = 11;
const MAX_LABEL_LANES = 3;

/** Type guard for the RawCell ([row,col] number tuple) wire shape -- see
 * fieldGeometry.ts's RawCell/cellIdToColRow doc for why this is the
 * ACTUAL shape sim/combat.cjs sends for entry/at/path[] entries (BUG #4's
 * root cause was this renderer assuming a "M9"-string shape instead). */
function isRawCell(v: unknown): v is RawCell {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** One BP's footprint for monitor display, ALREADY positioned at its own
 * absolute canvas origin (row/col offset from the squad's local (1,1) --
 * NOT renormalized to (0,0) the way a single isolated BP's `shape` is).
 * REQ-0045 (d): a squad's canvas can hold MULTIPLE BPs, each at its own
 * place on the shared 8x8 local grid -- see sim/combat.cjs's
 * compileSquadSnapshot/localBpCells, which already does exactly this for
 * the actual combat simulation (bps.map(...) over EVERY bp, each cell
 * offset by its own bpDef.origin) -- this client-side visual type used
 * to carry only ONE representative {bpColor,bpShape} pair per squad
 * (always the FIRST bp, always drawn as if `origin` were (0,0)/top-left
 * of the formation box), which is the client-only root of the "only the
 * first BP is copied, auto-placed top-left" bug; the sim itself was
 * always correct. */
export interface MonitorSquadBP {
  color: string;
  /** Absolute local-grid cells this BP occupies, i.e. shape offsets
   * already added to the BP's own origin (mirrors sim/combat.cjs's
   * localBpCells: origin[0]+dr, origin[1]+dc) -- NOT re-normalized. */
  cells: Offset[];
}

/** One placed PO's icon, positioned at its own absolute local-grid
 * origin cell (top-left of its footprint) -- REQ-0045 (d): a squad's
 * canvas can hold multiple placed POs across its BPs; this used to carry
 * only one optional representative icon (never actually populated by
 * Monitor.tsx in practice), now a full list mirroring the squad's real
 * `pos` array. */
export interface MonitorSquadIcon {
  textureKey: string;
  shape: Offset[]; // unrotated PO footprint offsets (drawn at `rot`, matching computeFootprintCells' own rot param)
  rot: number;
  origin: Offset; // absolute local-grid top-left cell (PO.cell, 1-indexed local coords)
}

export interface MonitorSquadVisual {
  slotIndex: number;
  box: string; // "TopLeft:BottomRight", e.g. "F2:M9"
  /** REQ-0045 (d): EVERY BP on this squad's canvas, each already
   * positioned at its own absolute origin -- a full 1:1 copy of the
   * squad's `bps` array, not just bps[0]. */
  bps: MonitorSquadBP[];
  label: string;
  /** REQ-0045 (d): EVERY placed PO on this squad's canvas (small-scale
   * art per the task brief -- "small-scale BP/PO art", not a full
   * per-item render), each at its own absolute origin cell. Empty array
   * (not optional) when the squad has no placed POs. */
  icons: MonitorSquadIcon[];
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
  /** REQ-0169 M2: the un-suffixed, un-truncated label text -- the key the
   * de-overlap pass groups duplicates by, and re-fits/suffixes from. */
  rawText: string;
  /** REQ-0169 M2: vertical lane the de-overlap pass placed this label in
   * (-1 = hidden, no free lane). */
  lane?: number;
  /** REQ-0169 M2: true when this label is hidden (a masked/duplicate
   * collapse, or no free lane) -- the dot is still drawn. */
  hidden?: boolean;
}

/** Persistent Pixi scene for the monitor's expanded view. Construct once
 * (Monitor.tsx's useEffect, mount-once dependency array), call
 * mountSquads() once player-side data is known, then feed NEW (only)
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
  /** REQ-0045 (d) regression-test seam: the exact squads array mountSquads()
   * was last called with, exposed read-only via getLastMountedSquads() so
   * client/e2e/*.spec.ts can assert on the full BP/PO copy (every BP's
   * cells, every placed PO's icon) instead of reverse-engineering PixiJS
   * canvas pixel colors -- same rationale as store.ts's own
   * __backpackDebug hook. Never read by any production UI code path. */
  private lastMountedSquads: MonitorSquadVisual[] = [];
  /** REQ-0097 / REQ-0099: every ticker callback currently animating a
   * transient ray/flash/pulse effect. reset() removes them all from the
   * PIXI ticker synchronously (and purges the ray layer alongside), so an
   * in-flight self-removing tick can never fire against an already-
   * cleared/destroyed graphic after a retarget or a replay seek. */
  private activeTickers = new Set<() => void>();
  /** REQ-0059: optional chime sink -- fed every NON-silent event (the same
   * gate the transient VFX use) so audio stays perfectly in sync with the
   * animation. null until/unless attached (chimes unavailable). */
  private chimeSink: ChimeSink | null = null;

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

  /** REQ-0059: attach (or detach with null) the chime sink fed by
   * applyEvents. Called by Monitor.tsx right after mount. */
  setChimeSink(sink: ChimeSink | null): void {
    this.chimeSink = sink;
  }

  private drawFieldBackdrop(field: Container): void {
    const bg = new Graphics();
    bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: 0x0e0d0b, alpha: 0.6 }).stroke({ color: 0x2e2a24, width: 1 });
    bg.eventMode = 'none';
    field.addChild(bg);
    // REQ-0169 M3: a faint cell grid so positions read as a BOARD even at
    // 18px cells (the flat backdrop gave the eye nothing to register the
    // grid scale against -- formation outlines and BP footprints floated in
    // a void).
    const grid = new Graphics();
    for (let c = 1; c < FIELD_COLS; c++) grid.moveTo(c * FIELD_CELL_PX, 0).lineTo(c * FIELD_CELL_PX, FIELD_H);
    for (let r = 1; r < FIELD_ROWS; r++) grid.moveTo(0, r * FIELD_CELL_PX).lineTo(FIELD_W, r * FIELD_CELL_PX);
    grid.stroke({ color: 0x3a4048, width: 1, alpha: 0.18 });
    grid.eventMode = 'none';
    field.addChild(grid);
  }

  /** Draws each squad's formation box + BP-colored footprint + (optional)
   * a small representative icon, on the PLAYER side. Idempotent-ish:
   * clears any prior squad visuals first (called once per room-open, not
   * per poll -- formation/squad assignment doesn't change mid-run). */
  mountSquads(squads: MonitorSquadVisual[]): void {
    this.lastMountedSquads = squads;
    // Remove any previously-drawn squad graphics (keep the backdrop, which
    // is always this container's first child).
    while (this.playerField.children.length > 1) {
      this.playerField.removeChildAt(1);
    }
    for (const squad of squads) {
      const rect = parseBoxToPixelRect(squad.box, FIELD_CELL_PX);
      // REQ-0169 M3: a degenerate box (w/h 0) means the formation-canvas
      // JOIN failed silently upstream (Monitor.tsx's fetchDungeons lookup
      // returned no real 'F2:M9'-style box, so the placeholder 'squad1'
      // string parsed to a zero-size rect). Rather than draw nothing (the
      // old silent no-op), warn and draw a dim fallback outline offset per
      // slot so the failure is at least VISIBLE in dev.
      if (rect.w <= 0 || rect.h <= 0) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] MonitorRenderer: squad', squad.slotIndex, 'has no real formation box (got', JSON.stringify(squad.box) + ') -- drawing a dim fallback outline');
        const fb = new Graphics();
        const fx = 4 + squad.slotIndex * (8 * FIELD_CELL_PX + 6);
        fb.rect(fx, 4, 8 * FIELD_CELL_PX, 8 * FIELD_CELL_PX).stroke({ color: 0x59d6d6, width: 1, alpha: 0.35 });
        fb.eventMode = 'none';
        this.playerField.addChild(fb);
        const fbLabel = new Text({ text: squad.label, style: { fill: 0xe8e0d0, fontSize: 10 } });
        fbLabel.x = fx + 2; fbLabel.y = 6; fbLabel.eventMode = 'none';
        this.playerField.addChild(fbLabel);
        continue;
      }
      const cellW = rect.w / 8;
      const cellH = rect.h / 8;

      // REQ-0169 M3: raise the formation-box outline contrast (was a barely-
      // visible alpha-0.5 hairline).
      const outline = new Graphics();
      outline.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: 0x59d6d6, width: 1.5, alpha: 0.9 });
      outline.eventMode = 'none';
      this.playerField.addChild(outline);

      // REQ-0045 (d): draw EVERY BP's footprint, each at its OWN absolute
      // local-grid cells (squad.bps[i].cells already carries origin-
      // adjusted offsets -- see MonitorSquadBP's own doc) -- a 1:1 visual
      // copy of the squad's real bps array, not just bps[0] drawn as if
      // it alone occupied the whole box from (0,0).
      for (const bp of squad.bps) {
        const g = new Graphics();
        const colorNum = parseInt(bp.color.replace('#', ''), 16) || 0x888888;
        // REQ-0169 M3: a visible fill + a 1px dark outline per cell so the
        // 2x2 (or larger) BP footprints read as solid pieces against the
        // dark backdrop, not faint washes.
        for (const [r, c] of bp.cells) {
          g.rect(rect.x + c * cellW, rect.y + r * cellH, cellW, cellH)
            .fill({ color: colorNum, alpha: 0.72 })
            .stroke({ color: 0x14100a, width: 1, alpha: 0.55 });
        }
        g.eventMode = 'none';
        this.playerField.addChild(g);
      }

      const label = new Text({ text: squad.label, style: { fill: 0xe8e0d0, fontSize: 10 } });
      label.x = rect.x + 2;
      label.y = rect.y + 2;
      label.eventMode = 'none';
      this.playerField.addChild(label);

      // REQ-0045 (d): draw EVERY placed PO's icon (small-scale art, per
      // the task brief), each at its own absolute origin cell -- a 1:1
      // copy of the squad's real pos array, not a single "one
      // representative" icon (which Monitor.tsx never actually populated
      // in practice anyway -- squads[].icon was always undefined before
      // this fix).
      for (const icon of squad.icons) {
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
    let marker = this.enemyMarkers.get(mapKey);
    if (marker) return marker;
    const container = new Container();
    const graphic = new Graphics();
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    // REQ-0169 M2: a 1px lighter outline gives the dot a defined edge so a
    // cluster of dots reads as distinct cells even when their labels have
    // been de-overlapped away from them.
    graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: 0xc05050, alpha: 0.55 }).stroke({ color: 0xe8b0a0, width: 1, alpha: 0.5 });
    graphic.eventMode = 'none';
    const rawLabel = masked ? '?' : label;
    // REQ-0045 (f): clamp to whatever horizontal space remains between this
    // marker's own cell and the enemy field's right edge (FIELD_W - pos.x).
    // relayoutEnemyLabels() re-fits + lanes it below, but this keeps the
    // invariant even before the first relayout.
    const fittedLabel = this.truncateLabelToFit(rawLabel, ENEMY_LABEL_STYLE, Math.max(0, FIELD_W - pos.x));
    const text = new Text({ text: fittedLabel, style: { ...ENEMY_LABEL_STYLE } });
    text.eventMode = 'none';
    container.x = pos.x;
    container.y = pos.y;
    container.addChild(graphic);
    container.addChild(text);
    this.enemyField.addChild(container);
    marker = { container, graphic, label: text, rawText: rawLabel, lane: 0, hidden: false };
    this.enemyMarkers.set(mapKey, marker);
    // REQ-0169 M2: de-overlap ALL enemy labels whenever a new marker joins.
    this.relayoutEnemyLabels();
    return marker;
  }

  // REQ-0169 M2: dots stay at their true cells; only the LABELS are de-
  // conflicted. (1) Same-text markers (many masked '?' or repeated
  // 'dagger') collapse to ONE representative label suffixed " x{count}";
  // the rest keep their dot but hide their label. (2) The surviving labels
  // are placed into vertical lanes: each starts at its dot's own cell row
  // and is bumped DOWN one LABEL_LANE_H at a time until it clears every
  // already-placed label (a simple per-frame bounds check), up to
  // MAX_LABEL_LANES; a label with no free lane hides (dot kept). Every
  // label is still truncated to the field's own right edge, so REQ-0045
  // (f)'s "x + labelWidth <= FIELD_W" invariant continues to hold.
  private relayoutEnemyLabels(): void {
    const markers = Array.from(this.enemyMarkers.values());
    for (const m of markers) { m.lane = 0; m.hidden = false; }
    // (1) collapse duplicates by rawText (leftmost marker is the rep).
    const byText = new Map<string, FieldMarker[]>();
    for (const m of markers) {
      const g = byText.get(m.rawText);
      if (g) g.push(m);
      else byText.set(m.rawText, [m]);
    }
    const reps: Array<{ marker: FieldMarker; shown: string }> = [];
    for (const [txt, group] of byText) {
      group.sort((a, b) => a.container.x - b.container.x);
      for (let i = 1; i < group.length; i++) {
        group[i].label.visible = false;
        group[i].hidden = true;
      }
      const rep = group[0];
      rep.label.visible = true;
      reps.push({ marker: rep, shown: group.length > 1 ? `${txt} x${group.length}` : txt });
    }
    // (2) 2D lane placement: sort by row then column; bump each label down
    //     until it clears already-placed labels, else hide it.
    reps.sort((a, b) => (a.marker.container.y - b.marker.container.y) || (a.marker.container.x - b.marker.container.x));
    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const overlaps = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    for (const { marker, shown } of reps) {
      const x = marker.container.x;
      marker.label.text = this.truncateLabelToFit(shown, ENEMY_LABEL_STYLE, Math.max(0, FIELD_W - x));
      const w = marker.label.width;
      const baseY = marker.container.y;
      let placedOk = false;
      for (let lane = 0; lane < MAX_LABEL_LANES; lane++) {
        const y = baseY + lane * LABEL_LANE_H;
        const box = { x1: x, y1: y, x2: x + w, y2: y + LABEL_LANE_H };
        if (!placed.some((pl) => overlaps(pl, box))) {
          placed.push(box);
          marker.label.visible = true;
          marker.label.x = 0;
          marker.label.y = lane * LABEL_LANE_H;
          marker.lane = lane;
          marker.hidden = false;
          placedOk = true;
          break;
        }
      }
      if (!placedOk) {
        marker.label.visible = false;
        marker.hidden = true;
        marker.lane = -1;
      }
    }
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

  /** Registers a self-cancelling ticker step. `step()` runs each frame
   * and returns true once finished (removing itself). reset() can also
   * cancel it mid-flight via activeTickers -- keeps the three transient
   * effects below uniform AND cancellable on a retarget/replay-seek. */
  private addTicker(step: () => boolean): void {
    const tick = (): void => {
      let done: boolean;
      try {
        done = step();
      } catch {
        done = true;
      }
      if (done) {
        this.app.ticker.remove(tick);
        this.activeTickers.delete(tick);
      }
    };
    this.activeTickers.add(tick);
    this.app.ticker.add(tick);
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
    this.addTicker((): boolean => {
      const elapsed = performance.now() - start;
      flash.alpha = Math.max(0, 1 - elapsed / FLASH_MS);
      if (elapsed >= FLASH_MS) {
        if (flash.parent) this.rayLayer.removeChild(flash);
        flash.destroy();
        return true;
      }
      return false;
    });
  }

  private pulseCell(cellId: string | RawCell, color = 0xff6666): void {
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    const pulse = new Graphics();
    pulse.circle(FIELD_CELL_PX / 2, FIELD_CELL_PX / 2, FIELD_CELL_PX / 2).fill({ color, alpha: 0.9 });
    pulse.eventMode = 'none';
    pulse.x = pos.x;
    pulse.y = pos.y;
    pulse.scale.set(0.4);
    this.rayLayer.addChild(pulse);
    const start = performance.now();
    this.addTicker((): boolean => {
      const elapsed = performance.now() - start;
      const frac = Math.min(1, elapsed / FLASH_MS);
      pulse.scale.set(0.4 + 0.9 * frac);
      pulse.alpha = 1 - frac;
      if (elapsed >= FLASH_MS) {
        if (pulse.parent) this.rayLayer.removeChild(pulse);
        pulse.destroy();
        return true;
      }
      return false;
    });
  }

  private animateStep(path: RawCell[], color = 0x59d6d6): void {
    if (path.length === 0) return;
    const marker = new Graphics();
    marker.circle(FIELD_CELL_PX / 2, FIELD_CELL_PX / 2, FIELD_CELL_PX / 3).fill({ color, alpha: 0.9 });
    marker.eventMode = 'none';
    this.rayLayer.addChild(marker);
    const totalMs = STEP_ANIM_MS * Math.max(1, path.length - 1);
    const start = performance.now();
    const positions = path.map((id) => cellIdToXY(id, FIELD_CELL_PX));
    if (positions.length === 1) {
      marker.x = positions[0].x;
      marker.y = positions[0].y;
    }
    this.addTicker((): boolean => {
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
        if (marker.parent) this.rayLayer.removeChild(marker);
        marker.destroy();
        return true;
      }
      return false;
    });
  }

  /** Applies ONLY new (not-yet-rendered) events -- Monitor.tsx tracks
   * "last rendered event index" and passes events.slice(lastIndex) here
   * each poll (per the run-clock polling contract: each poll returns the
   * FULL events array up to elapsedSecs, not just deltas -- the diffing
   * happens one layer up, in Monitor.tsx, not in this renderer). */
  applyEvents(newEvents: ApiRunEvent[], opts?: { silent?: boolean }): void {
    // REQ-0099: `silent` rebuilds only PERSISTENT state (enemy markers,
    // discovered ids) with NO transient VFX -- used when a replay scrub
    // fast-applies every event up to the sought `t` right after reset(),
    // so a backward seek never sprays hundreds of overlapping flashes.
    const silent = opts?.silent ?? false;
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
        this.applyOneEvent(ev, silent);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] MonitorRenderer: skipping malformed run event', ev, e);
      }
      // REQ-0059: feed the chime engine the SAME event -- only when NOT
      // silent (a silent apply is a scrub/catch-up rebuild: no VFX, so no
      // audio). Wrapped on its own so an audio error can never break the
      // visual pipeline.
      if (!silent && this.chimeSink) {
        try {
          this.chimeSink.handleEvent(ev);
        } catch {
          // audio is best-effort
        }
      }
    }
  }

  private applyOneEvent(ev: ApiRunEvent, silent = false): void {
    switch (ev.ev) {
      case 'ray_fire': {
        const field = ev.field === 'enemy' ? 'enemy' : 'player';
        const entry = isRawCell(ev.entry) ? ev.entry : null;
        if (field === 'enemy' && entry) this.getOrCreateEnemyMarker(entry, String(ev.src ?? '?'), ev.src === '?');
        break;
      }
      case 'ray_step': {
        const path = Array.isArray(ev.path) ? (ev.path as unknown[]).filter(isRawCell) : [];
        const pulseRay = ev.cause === 'pulse';
        if (pulseRay) this.pulseCounts.rays++;
        if (!silent) this.animateStep(path, pulseRay ? 0xffd166 : 0x59d6d6);
        break;
      }
      case 'ray_bounce': {
        const at = isRawCell(ev.at) ? ev.at : null;
        if (at && !silent) this.flashCell(at);
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
        if (!silent) this.pulseCell('N9');
        break;
      }
      // REQ-0048: linker pulse visuals -- a gold "circuit ignites" pulse per hop,
      // gold-tinted payload rays (via ray_step cause), honest counters (test seam).
      case 'link_pulse': {
        this.pulseCounts.linkPulses++;
        if (!silent) this.pulseCell('N9', 0xffd166);
        break;
      }
      case 'pulse_payload': {
        this.pulseCounts.payloads++;
        break;
      }
      case 'pulse_fizzle': {
        this.pulseCounts.fizzles++;
        break;
      }
      // REQ-0049: layered-encounter attachment badges on the enemy field.
      case 'att_reveal': {
        this.attCounts.reveal++;
        if (isRawCell(ev.at) && !silent) this.flashCell(ev.at); // "?" -> revealed flash
        break;
      }
      case 'att_disarm': { this.attCounts.disarm++; break; }
      case 'att_open': { this.attCounts.open++; if (!silent) this.pulseCell('N9', 0x66d6a0); break; } // green: reward/shortcut
      case 'att_lost': { this.attCounts.lost++; break; }
      case 'att_fire': { this.attCounts.fire++; if (!silent) this.pulseCell('N9', 0xff6666); break; } // red: trap volley
      default:
        break;
    }
  }

  /** REQ-0045 (d) regression-test seam -- read-only; exact array mountSquads() got. */
  getLastMountedSquads(): MonitorSquadVisual[] {
    return this.lastMountedSquads;
  }

  /** REQ-0048 test seam: counts of pulse-related visuals applied so far. */
  private pulseCounts = { linkPulses: 0, payloads: 0, fizzles: 0, rays: 0 };
  getPulseVisualCounts(): { linkPulses: number; payloads: number; fizzles: number; rays: number } {
    return { ...this.pulseCounts };
  }

  /** REQ-0049 test seam: counts of attachment-badge visuals applied so far. */
  private attCounts = { reveal: 0, disarm: 0, open: 0, lost: 0, fire: 0 };
  getAttachmentVisualCounts(): { reveal: number; disarm: number; open: number; lost: number; fire: number } {
    return { ...this.attCounts };
  }

  /** REQ-0045 (f) regression-test seam: each enemy marker's local x + rendered label width. */
  getEnemyMarkerBounds(): Array<{ x: number; labelWidth: number; labelText: string; hidden: boolean; lane: number }> {
    // REQ-0169 M2: hidden/lane are ADDITIVE (x/labelWidth/labelText keep
    // their exact prior shape, so REQ-0045 (f)'s e2e assertion is
    // unchanged) -- a de-overlap check asserts every VISIBLE pair is
    // pairwise disjoint OR one is hidden.
    return Array.from(this.enemyMarkers.values()).map((m) => ({
      x: m.container.x,
      labelWidth: m.label.width,
      labelText: m.label.text,
      hidden: !!m.hidden,
      lane: m.lane ?? 0,
    }));
  }

  /** REQ-0097 (shared re-targetable monitor) / REQ-0099 (replay scrub): clear ALL
   * per-run transient + discovered state back to the mounted-squads baseline -- cancel
   * every in-flight ticker animation, empty the ray layer, destroy every enemy marker,
   * and forget every discovered id. Player-side squad visuals (mountSquads) are left
   * untouched; retarget() re-mounts them for a different run. After reset(),
   * getEnemyMarkerBounds() is empty, so REQ-0097's "no residual actor/pip leak across
   * retargets" guard holds. */
  reset(): void {
    for (const tick of this.activeTickers) this.app.ticker.remove(tick);
    this.activeTickers.clear();
    while (this.rayLayer.children.length > 0) {
      const child = this.rayLayer.getChildAt(0);
      this.rayLayer.removeChild(child);
      child.destroy();
    }
    for (const marker of this.enemyMarkers.values()) {
      if (marker.container.parent) this.enemyField.removeChild(marker.container);
      marker.container.destroy({ children: true });
    }
    this.enemyMarkers.clear();
    this.discovered.clear();
  }

  /** REQ-0097: point this ONE shared monitor at a DIFFERENT room's run -- reset all
   * per-run state, then re-mount the newly-selected run's player squads. The caller
   * (Monitor.tsx) resets its own event cursor so applyEvents() feeds from the top. */
  retarget(squads: MonitorSquadVisual[]): void {
    this.reset();
    this.mountSquads(squads);
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
