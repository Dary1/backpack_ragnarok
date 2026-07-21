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
import type { ApiRunEvent, ApiRunRoster } from '../api';
import type { ChimeSink } from './chimes/chimeMapping';
import { cellIdToXY, FIELD_COLS, FIELD_ROWS, parseBoxToPixelRect, type RawCell } from './fieldGeometry';
import { computeFootprintCells } from '../render/itemCard';
import type { Offset } from '../engine/engine.d.ts';
import { EnemyPlane } from './monitorActors';
import { MJ } from './monitorTheme';
import { gimicGlyph } from './monitorGlyphs';
import { t } from '../i18n';
import type { Locale } from '../store';

export const FIELD_CELL_PX = 18; // small-scale -- 26x18 cells at 18px = 468x324px per field
const FIELD_GAP_PX = 24;
export const FIELD_W = FIELD_COLS * FIELD_CELL_PX;
const FIELD_H = FIELD_ROWS * FIELD_CELL_PX;
const STEP_ANIM_MS = 200; // per ray_step segment, within the 150-300ms band the task brief calls for
const FLASH_MS = 300;
const HEAL_GREEN = 0x76c48a; // REQ-0276 B2: heal / lifesteal-heal green (+n); Phase C may re-tune.

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
  /** REQ-0276 B2: the seated Unit's def id (bp.unit.id) -- resolves `unit:<id>`
   * raster art for the unit-art hook. Optional (absent on synthetic literals). */
  unitId?: string;
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
  /** REQ-0276 B2: the PO's item def id (po.id) -- source-item key for the
   * ray_fire muzzle flash. */
  itemId?: string;
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

/** REQ-0276 B2: a mounted player squad slot's handle -- geometry + the overlay
 * bits run events mutate (charge pips, KO stamp) + its placed-item cells for the
 * item-fire flash. */
interface SquadSlotHandle {
  slotIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  cellW: number;
  cellH: number;
  container: Container;
  icons: Array<{ itemId: string; x: number; y: number; w: number; h: number }>;
  pips: Graphics;
  koStamp: Text;
  charge: number;
  ko: boolean;
  label: string;
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
  /** REQ-0276 B1: roster-driven enemy actor plane (art / HP / reveal / waves). */
  private enemyPlane!: EnemyPlane;
  /** REQ-0276 B2: overlay for gimic-attachment badges, keyed by att id. */
  private enemyOverlay!: Container;
  private gimicBadges = new Map<string, { container: Container; glyph: Text; state: string }>();
  /** REQ-0276 B2: mounted player squad-slot handles (pips / KO / item-fire). */
  private squadSlots = new Map<number, SquadSlotHandle>();
  /** REQ-0276 B3: locale for enemy nameJa + KO stamp copy. */
  private locale: Locale = 'en';
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
  /** REQ-0240: 'row' (fields side-by-side) or 'column' (stacked, narrow). */
  private layout: 'row' | 'column' = 'row';
  /** REQ-0240 M1: run roster (enemy hpMax etc.), pushed by Monitor.setRoster. */
  private roster: ApiRunRoster | null = null;
  /** REQ-0240: the field the most recent ray_fire targeted -- ray_hit carries
   * no field, so damage numbers read their side from here. */
  private currentRayField: 'player' | 'enemy' = 'enemy';
  private dmgSeq = 0;

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

    this.drawFieldBackdrop(this.playerField, MJ.frost);
    this.drawFieldBackdrop(this.enemyField, MJ.blood);

    this.app.stage.addChild(this.playerField);
    this.app.stage.addChild(this.enemyField);
    this.app.stage.addChild(this.rayLayer);

    // REQ-0276 B1: roster-driven enemy actors live in their own sublayer of the
    // enemy field; the gimic-badge overlay sits above them.
    this.enemyPlane = new EnemyPlane(this.enemyField, FIELD_CELL_PX, FIELD_W);
    this.enemyOverlay = new Container();
    this.enemyOverlay.eventMode = 'none';
    this.enemyField.addChild(this.enemyOverlay);
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

  /** REQ-0240 (03 ss3 narrow): relayout the two fields row<->column WITHOUT
   * recreating the Pixi app -- the enemy field moves and the canvas resizes. */
  setLayout(layout: 'row' | 'column'): void {
    if (this.layout === layout) return;
    this.layout = layout;
    if (layout === 'column') {
      this.enemyField.x = 0;
      this.enemyField.y = FIELD_H + FIELD_GAP_PX;
      this.app.renderer.resize(FIELD_W, FIELD_H * 2 + FIELD_GAP_PX);
    } else {
      this.enemyField.x = FIELD_W + FIELD_GAP_PX;
      this.enemyField.y = 0;
      this.app.renderer.resize(FIELD_W * 2 + FIELD_GAP_PX, FIELD_H);
    }
  }

  /** REQ-0240 M1: store the run roster (enemy hpMax etc.) for stage readouts. */
  setRoster(roster: ApiRunRoster | null): void {
    this.roster = roster;
    // REQ-0276 B1: (re)build the roster-driven enemy actor plane. Locale first so
    // nameplates resolve nameJa under ja.
    this.enemyPlane.setLocale(this.locale === 'ja' ? 'ja' : 'en');
    this.enemyPlane.setRoster(roster);
  }

  /** REQ-0276 B3: locale for enemy nameJa + KO stamp copy. Forwarded to the
   * enemy plane; player KO stamps are re-labelled in place. */
  setLocale(locale: Locale): void {
    this.locale = locale;
    this.enemyPlane.setLocale(locale === 'ja' ? 'ja' : 'en');
    for (const h of this.squadSlots.values()) this.refreshKoStamp(h);
  }

  /** REQ-0240 test/inspection seam: enemy count the roster (M1) declared -- a
   * read of the stored roster so it is a live input, and a hook an e2e can use
   * to assert the roster reached the renderer. */
  getRosterEnemyCount(): number {
    return this.roster ? this.roster.enemies.length : 0;
  }

  /** REQ-0240 (03 ss5.5): a floating, tier-sized, side-coloured damage number
   * that rises and fades. Placed in the field the ray targeted; positioned by a
   * small rotating spread (ray_hit carries a masked label, not a cell). Appears
   * under reduced motion too (fade only). */
  private floatDamage(field: 'player' | 'enemy', amount: number): void {
    if (!(amount > 0)) return;
    const ox = field === 'enemy' ? this.enemyField.x : this.playerField.x;
    const oy = field === 'enemy' ? this.enemyField.y : this.playerField.y;
    const spread = (this.dmgSeq++ % 5) - 2;
    const x = ox + FIELD_W / 2 + spread * 24;
    const y = oy + FIELD_H / 2 + spread * 6;
    // player field = WE take the hit (blood); enemy field = we dealt it (ember).
    this.floatNumberAt(x, y, amount, field === 'player' ? MJ.blood : MJ.ember);
  }

  /** REQ-0276 B2: a floating tier-sized number that rises + fades at an ABSOLUTE
   * stage position, so damage lands on the ACTUAL hit cell/actor (not a field-
   * centre spread). `prefix` carries the heal '+'. PHASE-C HOOK: restyle here. */
  private floatNumberAt(x: number, y: number, amount: number, color: number, prefix = ''): void {
    if (!(amount > 0)) return;
    const size = amount < 10 ? 15 : amount < 30 ? 18 : 22;
    const label = new Text({ text: prefix + String(Math.round(amount)), style: { fill: color, fontSize: size, fontWeight: 'bold' } });
    label.eventMode = 'none';
    label.x = x; label.y = y;
    this.app.stage.addChild(label);
    const start = performance.now();
    this.addTicker((): boolean => {
      const e = performance.now() - start; const fr = Math.min(1, e / 600);
      label.y = y - 18 * fr; label.alpha = 1 - fr;
      if (e >= 600) { if (label.parent) this.app.stage.removeChild(label); label.destroy(); return true; }
      return false;
    });
  }

  /** REQ-0240 (03 ss5.6): the telegraph as theatre -- a wind-up edge glow on the
   * targeted edge of the player field for a short hold (the "Telegraph:" text
   * line dies; the stage IS the telegraph). */
  private telegraphGlow(edge: string): void {
    const g = new Graphics();
    const th = 8;
    if (edge === 'top') g.rect(0, 0, FIELD_W, th);
    else if (edge === 'bottom') g.rect(0, FIELD_H - th, FIELD_W, th);
    else if (edge === 'left') g.rect(0, 0, th, FIELD_H);
    else g.rect(FIELD_W - th, 0, th, FIELD_H);
    g.fill({ color: MJ.ember, alpha: 0.85 });
    g.eventMode = 'none';
    g.x = this.playerField.x; g.y = this.playerField.y;
    this.app.stage.addChild(g);
    const start = performance.now();
    this.addTicker((): boolean => {
      const e = performance.now() - start; const fr = Math.min(1, e / 700);
      g.alpha = 0.85 * (1 - fr);
      if (e >= 700) { if (g.parent) this.app.stage.removeChild(g); g.destroy(); return true; }
      return false;
    });
  }

  private drawFieldBackdrop(field: Container, tint = 0): void {
    const bg = new Graphics();
    bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: MJ.void, alpha: 0.6 }).stroke({ color: MJ.borderLo, width: 1 });
    // REQ-0240 ss5.1: a faint per-side tint wash so the fields read PLAYER vs
    // ENEMY. Drawn into the backdrop (child 0), which mountSquads never clears.
    if (tint) bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: tint, alpha: 0.06 });
    bg.eventMode = 'none';
    field.addChild(bg);
    // REQ-0169 M3: a faint cell grid so positions read as a BOARD even at
    // 18px cells (the flat backdrop gave the eye nothing to register the
    // grid scale against -- formation outlines and BP footprints floated in
    // a void).
    const grid = new Graphics();
    for (let c = 1; c < FIELD_COLS; c++) grid.moveTo(c * FIELD_CELL_PX, 0).lineTo(c * FIELD_CELL_PX, FIELD_H);
    for (let r = 1; r < FIELD_ROWS; r++) grid.moveTo(0, r * FIELD_CELL_PX).lineTo(FIELD_W, r * FIELD_CELL_PX);
    grid.stroke({ color: MJ.borderLo, width: 1, alpha: 0.18 });
    grid.eventMode = 'none';
    field.addChild(grid);
  }

  /** Draws each squad's formation box + BP-colored footprint + (optional)
   * a small representative icon, on the PLAYER side. Idempotent-ish:
   * clears any prior squad visuals first (called once per room-open, not
   * per poll -- formation/squad assignment doesn't change mid-run). */
  mountSquads(squads: MonitorSquadVisual[]): void {
    this.lastMountedSquads = squads;
    // Keep the backdrop (child 0) + grid (child 1); clear prior squad visuals.
    while (this.playerField.children.length > 2) this.playerField.removeChildAt(2);
    this.squadSlots.clear();
    for (const squad of squads) {
      const rect = parseBoxToPixelRect(squad.box, FIELD_CELL_PX);
      if (rect.w <= 0 || rect.h <= 0) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] MonitorRenderer: squad', squad.slotIndex, 'has no real formation box (got', JSON.stringify(squad.box) + ') -- drawing a dim fallback outline');
        const fb = new Graphics();
        const fx = 4 + squad.slotIndex * (8 * FIELD_CELL_PX + 6);
        fb.rect(fx, 4, 8 * FIELD_CELL_PX, 8 * FIELD_CELL_PX).stroke({ color: MJ.frost, width: 1, alpha: 0.35 });
        fb.eventMode = 'none';
        this.playerField.addChild(fb);
        const fbLabel = new Text({ text: squad.label, style: { fill: MJ.bone, fontSize: 10 } });
        fbLabel.x = fx + 2; fbLabel.y = 6; fbLabel.eventMode = 'none';
        this.playerField.addChild(fbLabel);
        continue;
      }
      const cellW = rect.w / 8;
      const cellH = rect.h / 8;

      const slotBox = new Container();
      slotBox.eventMode = 'none';
      this.playerField.addChild(slotBox);

      // REQ-0276 B: formation-box outline -- gold = STRUCTURAL frame only.
      const outline = new Graphics();
      outline.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: MJ.gold, width: 1.5, alpha: 0.7 });
      outline.eventMode = 'none';
      slotBox.addChild(outline);

      // REQ-0045 (d): every BP footprint at its own absolute cells; (REQ-0276 B2)
      // unit art contain-fit over the colour fill when it resolves.
      for (const bp of squad.bps) {
        const g = new Graphics();
        const colorNum = parseInt(bp.color.replace('#', ''), 16) || 0x888888;
        for (const [r, c] of bp.cells) {
          g.rect(rect.x + c * cellW, rect.y + r * cellH, cellW, cellH)
            .fill({ color: colorNum, alpha: 0.72 })
            .stroke({ color: MJ.void, width: 1, alpha: 0.55 });
        }
        g.eventMode = 'none';
        slotBox.addChild(g);
        this.drawUnitArt(slotBox, bp, rect, cellW, cellH);
      }

      const label = new Text({ text: squad.label, style: { fill: MJ.bone, fontSize: 10 } });
      label.x = rect.x + 2; label.y = rect.y + 2; label.eventMode = 'none';
      slotBox.addChild(label);

      const plate = new Text({ text: squad.label, style: { fill: MJ.bone2, fontSize: 11 } });
      plate.x = rect.x; plate.y = rect.y + rect.h + 3; plate.eventMode = 'none';
      slotBox.addChild(plate);

      // REQ-0276 B2: charge pips (mirror SquadDock) on the plate; hidden until a
      // unit_charge_* event lights them.
      const pips = new Graphics();
      pips.eventMode = 'none';
      slotBox.addChild(pips);

      // REQ-0276 B2: KO stamp (structural: dim + label). Hidden until KO.
      const koStamp = new Text({ text: t(this.locale, 'schedule.monitor.dock.ko'), style: { fill: MJ.blood, fontSize: 12, fontWeight: 'bold' } });
      koStamp.x = rect.x + rect.w / 2 - 12; koStamp.y = rect.y + rect.h / 2 - 6; koStamp.eventMode = 'none'; koStamp.visible = false;
      slotBox.addChild(koStamp);

      const iconCells: Array<{ itemId: string; x: number; y: number; w: number; h: number }> = [];
      for (const icon of squad.icons) {
        const footprint = computeFootprintCells(icon.shape, icon.rot);
        const [originR, originC] = icon.origin;
        const boxW = footprint.w * cellW;
        const boxH = footprint.h * cellH;
        const ix = rect.x + originC * cellW;
        const iy = rect.y + originR * cellH;
        if (icon.itemId) iconCells.push({ itemId: icon.itemId, x: ix, y: iy, w: boxW, h: boxH });
        const texture = this.textures.get(icon.textureKey);
        if (!texture) continue;
        const sprite = new Sprite(texture);
        sprite.eventMode = 'none';
        const scale = Math.min(boxW / texture.width, boxH / texture.height);
        sprite.width = texture.width * scale;
        sprite.height = texture.height * scale;
        sprite.x = ix + (boxW - sprite.width) / 2;
        sprite.y = iy + (boxH - sprite.height) / 2;
        slotBox.addChild(sprite);
      }

      this.squadSlots.set(squad.slotIndex, {
        slotIndex: squad.slotIndex, rect, cellW, cellH, container: slotBox,
        icons: iconCells, pips, koStamp, charge: 0, ko: false, label: squad.label,
      });
    }
  }

  /** REQ-0276 B2: draw a BP's unit art (`unit:<id>` raster) contain-fit over its
   * colour fill at reduced alpha. No unit rasters exist yet (unitIconRasters()
   * returns []), so this is a no-op hook today -- when art lands it renders with
   * NO renderer change. PHASE-C HOOK: unit-art treatment. */
  private drawUnitArt(slotBox: Container, bp: MonitorSquadBP, rect: { x: number; y: number }, cellW: number, cellH: number): void {
    if (!bp.unitId) return;
    const tex = this.textures.get('unit:' + bp.unitId);
    if (!tex) return;
    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    for (const [r, c] of bp.cells) { if (r < minR) minR = r; if (c < minC) minC = c; if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    if (!Number.isFinite(minR)) return;
    const bx = rect.x + minC * cellW, by = rect.y + minR * cellH;
    const bw = (maxC - minC + 1) * cellW, bh = (maxR - minR + 1) * cellH;
    const scale = Math.min(bw / tex.width, bh / tex.height);
    const sprite = new Sprite(tex);
    sprite.eventMode = 'none';
    sprite.alpha = 0.85;
    sprite.width = tex.width * scale; sprite.height = tex.height * scale;
    sprite.x = bx + (bw - sprite.width) / 2; sprite.y = by + (bh - sprite.height) / 2;
    slotBox.addChild(sprite);
  }

  /** REQ-0276 B2: light N charge pips (0..4) on a squad plate; cleared (hidden)
   * at 0 to mirror the DOM dock's "no telemetry -> no pips". */
  private refreshChargePips(h: SquadSlotHandle): void {
    const g = h.pips; g.clear();
    if (h.charge <= 0) return;
    const y = h.rect.y + h.rect.h + 16;
    for (let i = 0; i < 4; i++) {
      const on = i < h.charge;
      g.circle(h.rect.x + 4 + i * 8, y, 2.4).fill({ color: on ? MJ.gold : MJ.borderLo, alpha: on ? 0.95 : 0.6 });
    }
  }

  /** REQ-0276 B2: KO stamp toggle (structural dim + label). PHASE-C HOOK: the
   * Yuji-Syuku stamp styling. */
  private refreshKoStamp(h: SquadSlotHandle): void {
    h.koStamp.text = t(this.locale, 'schedule.monitor.dock.ko');
    h.koStamp.visible = h.ko;
    h.container.alpha = h.ko ? 0.55 : 1;
  }

  /** REQ-0276 B2: bright flash on a fired item's cell(s) in its squad box. Maps
   * ev.src item id -> every placed PO with that id (ambiguous -> all fire).
   * PHASE-C HOOK: restyle the muzzle flash. */
  private flashSourceItem(itemId: string): void {
    for (const h of this.squadSlots.values()) {
      for (const ic of h.icons) {
        if (ic.itemId !== itemId) continue;
        const flash = new Graphics();
        flash.rect(ic.x, ic.y, ic.w, ic.h).fill({ color: MJ.ember, alpha: 0.8 });
        flash.eventMode = 'none';
        this.playerField.addChild(flash);
        const start = performance.now();
        this.addTicker((): boolean => {
          const e = performance.now() - start;
          flash.alpha = Math.max(0, 0.8 * (1 - e / FLASH_MS));
          if (e >= FLASH_MS) { if (flash.parent) this.playerField.removeChild(flash); flash.destroy(); return true; }
          return false;
        });
      }
    }
  }

  /** REQ-0276 B2: settle per-slot KO from a troop_bp_hp array (encounter_end /
   * run_end) -- summed per slot via the roster's slot BP counts, the same
   * reduction the DOM dock uses. */
  private settleKoFromHp(hps: number[]): void {
    if (!this.roster) return;
    let off = 0;
    for (const sl of this.roster.slots) {
      const n = sl.bps.length;
      let hp = 0; for (let k = 0; k < n; k++) hp += Math.max(0, hps[off + k] ?? 0);
      off += n;
      const hpMax = sl.bps.reduce((acc, b) => acc + (b.hpMax || 0), 0);
      const h = this.squadSlots.get(sl.index);
      if (h) { h.ko = hpMax > 0 && hp <= 0; this.refreshKoStamp(h); }
    }
  }

  /** REQ-0276 B2: reset per-slot overlays (pips / KO) on a run reset / seek. */
  private resetSlotOverlays(): void {
    for (const h of this.squadSlots.values()) {
      h.charge = 0; h.ko = false;
      this.refreshChargePips(h); this.refreshKoStamp(h);
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
    graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: MJ.blood, alpha: 0.55 }).stroke({ color: MJ.bone2, width: 1, alpha: 0.5 });
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
    flash.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX).fill({ color: MJ.gold, alpha: 0.85 });
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

  private pulseCell(cellId: string | RawCell, color = MJ.blood): void {
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

  private animateStep(path: RawCell[], color = MJ.frost): void {
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
      case 'encounter_start': {
        // REQ-0276 B1: advance the visible enemy wave on pack/boss encounters.
        if (typeof ev.kind === 'string') this.enemyPlane.onEncounterStart(ev.kind);
        break;
      }
      case 'encounter_end': {
        this.enemyPlane.onEncounterEnd();
        if (Array.isArray(ev.troop_bp_hp)) this.settleKoFromHp(ev.troop_bp_hp as number[]);
        break;
      }
      case 'run_end': {
        if (Array.isArray(ev.troop_bp_hp)) this.settleKoFromHp(ev.troop_bp_hp as number[]);
        break;
      }
      case 'ray_fire': {
        const field = ev.field === 'enemy' ? 'enemy' : 'player';
        this.currentRayField = field; // REQ-0240: ray_hit reads its side from here
        // REQ-0276 B2: player-origin fire (ray on the enemy field) -> flash the
        // SOURCE item's cell(s). src is the item def id (skills.cjs ownerId=po.id),
        // possibly '#'-suffixed on charge/react firings.
        if (field === 'enemy' && !silent && typeof ev.src === 'string' && ev.src !== '?') {
          this.flashSourceItem(String(ev.src).split('#')[0]);
        }
        // Legacy fallback (no roster actors): lazy first-seen enemy blob.
        const entry = isRawCell(ev.entry) ? ev.entry : null;
        if (field === 'enemy' && entry && !this.enemyPlane.hasRoster()) {
          this.getOrCreateEnemyMarker(entry, String(ev.src ?? '?'), ev.src === '?');
        }
        break;
      }
      case 'telegraph': {
        if (!silent && typeof ev.edge === 'string') this.telegraphGlow(ev.edge);
        break;
      }
      case 'ray_step': {
        const path = Array.isArray(ev.path) ? (ev.path as unknown[]).filter(isRawCell) : [];
        const pulseRay = ev.cause === 'pulse';
        if (pulseRay) this.pulseCounts.rays++;
        if (!silent) this.animateStep(path, pulseRay ? MJ.gold : MJ.frost);
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
        const amt = ev.pcoalesce ? ev.pcoalesce.amount : (typeof ev.amount === 'number' ? ev.amount : 0);
        // REQ-0276 B1: attribute to the roster enemy + deplete its HP.
        const idx = typeof ev.enemyIdx === 'number' ? ev.enemyIdx : null;
        if (idx != null) this.enemyPlane.hit(idx, typeof ev.hp_after === 'number' ? ev.hp_after : undefined, amt);
        // REQ-0276 B2: damage number at the ACTUAL hit location.
        if (!silent && !ev.pcoalesceHidden) this.floatDamageLocated(idx, amt);
        break;
      }
      case 'ray_aoe':
      case 'ray_hit_all': {
        const hits = Array.isArray(ev.hits) ? (ev.hits as Array<{ dst?: string; amount?: number; hp_after?: number; enemyIdx?: number }>) : [];
        let total = 0;
        let located = false;
        for (const h of hits) {
          if (h.dst && h.dst !== '?') this.markDiscovered(h.dst);
          if (typeof h.amount === 'number') total += h.amount;
          if (typeof h.enemyIdx === 'number') {
            located = true;
            this.enemyPlane.hit(h.enemyIdx, typeof h.hp_after === 'number' ? h.hp_after : undefined, typeof h.amount === 'number' ? h.amount : undefined);
            if (!silent && typeof h.amount === 'number') this.floatDamageLocated(h.enemyIdx, h.amount);
          }
        }
        if (!silent && !located) {
          if (total > 0) this.floatDamage(this.currentRayField, total);
          else if (ev.ev === 'ray_hit_all') this.pulseCell('N9');
        }
        break;
      }
      case 'reflect_damage': {
        if (!silent) this.pulseCell('N9', MJ.blood);
        break;
      }
      case 'heal_ally':
      case 'lifesteal_heal': {
        // REQ-0276 B2: these were IGNORED -- green (+n) at the healed target when
        // it resolves to an enemy actor, else at the field centre.
        const amount = typeof ev.amount === 'number' ? ev.amount : (typeof ev.heal === 'number' ? ev.heal : 0);
        if (!silent && amount > 0) {
          const dst = typeof ev.dst === 'string' ? ev.dst : null;
          const pos = dst ? this.enemyPlane.centroidOfInstance(dst) : null;
          if (pos) this.floatNumberAt(pos.x, pos.y, amount, HEAL_GREEN, '+');
          else this.floatNumberAt(this.enemyField.x + FIELD_W / 2, this.enemyField.y + FIELD_H / 2, amount, HEAL_GREEN, '+');
        }
        break;
      }
      case 'apply_status': {
        // REQ-0276 B2: status chip on a resolved enemy actor (dst=maskLabel).
        const dst = typeof ev.dst === 'string' ? ev.dst : null;
        const status = typeof ev.status === 'string' ? ev.status : null;
        if (dst && status) this.enemyPlane.applyStatusByInstance(dst, status, typeof ev.n === 'number' ? ev.n : 1);
        break;
      }
      case 'status_tick': {
        const dst = typeof ev.dst === 'string' ? ev.dst : null;
        const status = typeof ev.status === 'string' ? ev.status : '';
        if (dst) this.enemyPlane.statusTickByInstance(dst, status, typeof ev.hp_after === 'number' ? ev.hp_after : undefined);
        break;
      }
      // REQ-0048: linker pulse visuals.
      case 'link_pulse': {
        this.pulseCounts.linkPulses++;
        if (!silent) this.pulseCell('N9', MJ.gold);
        break;
      }
      case 'pulse_payload': { this.pulseCounts.payloads++; break; }
      case 'pulse_fizzle': { this.pulseCounts.fizzles++; break; }
      // REQ-0276 B2: charge pips (slot 0..3 from A2's serve-time attribution).
      case 'unit_charge_spend':
      case 'unit_charge_stack':
      case 'unit_charge_transform':
      case 'unit_charge_strike':
      case 'unit_charge_onhit':
      case 'unit_charge_lifesteal':
      case 'unit_charge_reflect':
      case 'unit_charge_transfer':
      case 'unit_charge_shieldbreak': {
        if (typeof ev.slot === 'number') this.lightChargePips(ev.slot, ev.ev, ev);
        break;
      }
      // REQ-0049 / REQ-0276 B1: gimic-attachment badges on the enemy field.
      case 'att_reveal': {
        this.attCounts.reveal++;
        this.updateGimicBadge(ev, 'revealed');
        if (isRawCell(ev.at) && !silent) this.flashCell(ev.at); // "?" -> revealed flash
        break;
      }
      case 'att_disarm': { this.attCounts.disarm++; this.updateGimicBadge(ev, 'disarmed'); break; }
      case 'att_open': { this.attCounts.open++; this.updateGimicBadge(ev, 'opened'); if (!silent) this.pulseCell('N9', MJ.frost); break; }
      case 'att_lost': { this.attCounts.lost++; this.updateGimicBadge(ev, 'lost'); break; }
      case 'att_fire': { this.attCounts.fire++; this.updateGimicBadge(ev, 'fired'); if (!silent) this.pulseCell('N9', MJ.blood); break; }
      default:
        break;
    }
  }

  /** REQ-0276 B2: damage number placed at a roster enemy's footprint centroid,
   * falling back to the field centre when the hit is unattributed (masked / no
   * enemyIdx). */
  private floatDamageLocated(enemyIdx: number | null, amount: number): void {
    if (!(amount > 0)) return;
    const pos = enemyIdx != null ? this.enemyPlane.centroidOf(enemyIdx) : null;
    if (pos) this.floatNumberAt(pos.x, pos.y, amount, MJ.ember);
    else this.floatDamage(this.currentRayField, amount);
  }

  /** REQ-0276 B2: light the pips on a charging squad slot. stack sets the count;
   * spend clears; the rest give a minimal single-pip cue. PHASE-C HOOK. */
  private lightChargePips(slot: number, ev: string, payload: ApiRunEvent): void {
    const h = this.squadSlots.get(slot);
    if (!h) return;
    if (ev === 'unit_charge_stack' && typeof payload.stacks === 'number') h.charge = Math.max(0, Math.min(4, payload.stacks));
    else if (ev === 'unit_charge_spend') h.charge = 0;
    else h.charge = Math.max(h.charge, 1);
    this.refreshChargePips(h);
  }

  /** REQ-0276 B1/B2: create / transition a gimic badge on the enemy field. Keyed
   * by the attachment id (`att`); only att_reveal carries a cell, so a badge with
   * no known position tracks STATE without drawing. PHASE-C HOOK: badge art +
   * reveal/armed/disarmed/opened/lost/fired styling. */
  private updateGimicBadge(ev: ApiRunEvent, state: string): void {
    const attId = typeof ev.att === 'string' ? ev.att : null;
    if (!attId) return;
    const glyphCh = gimicGlyph(typeof ev.gimicId === 'string' ? ev.gimicId : undefined, ev.ev);
    let badge = this.gimicBadges.get(attId);
    if (!badge) {
      if (!isRawCell(ev.at)) {
        const c = new Container();
        const g = new Text({ text: glyphCh, style: { fill: MJ.bone2, fontSize: 11 } });
        c.addChild(g);
        this.gimicBadges.set(attId, { container: c, glyph: g, state });
        return;
      }
      const container = new Container();
      container.eventMode = 'none';
      const bg = new Graphics();
      bg.roundRect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX, 3).fill({ color: MJ.raised, alpha: 0.9 }).stroke({ color: MJ.gold, width: 1, alpha: 0.8 });
      bg.eventMode = 'none';
      const glyph = new Text({ text: glyphCh, style: { fill: MJ.bone, fontSize: 11 } });
      glyph.eventMode = 'none'; glyph.x = 3; glyph.y = 2;
      container.addChild(bg); container.addChild(glyph);
      const p = cellIdToXY(ev.at, FIELD_CELL_PX);
      container.x = p.x; container.y = p.y;
      this.enemyOverlay.addChild(container);
      badge = { container, glyph, state };
      this.gimicBadges.set(attId, badge);
    }
    badge.state = state;
    badge.glyph.text = glyphCh;
    // Minimal state tint (structural). PHASE-C HOOK.
    badge.glyph.style.fill = state === 'fired' ? MJ.blood : (state === 'opened' || state === 'disarmed') ? MJ.frost : state === 'lost' ? MJ.bone3 : MJ.gold;
    if (state === 'lost' || state === 'disarmed') badge.container.alpha = 0.5;
  }

  private clearGimicBadges(): void {
    for (const b of this.gimicBadges.values()) {
      if (!b.container.destroyed) {
        if (b.container.parent) b.container.parent.removeChild(b.container);
        b.container.destroy({ children: true });
      }
    }
    this.gimicBadges.clear();
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
    if (this.enemyPlane.hasRoster()) return this.enemyPlane.getMarkerBounds();
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
    // REQ-0276 B1/B2: rewind the roster actor plane + clear gimic badges + slot
    // overlays (structural layers persist; only per-run dynamic state rewinds).
    this.enemyPlane.reset();
    this.clearGimicBadges();
    this.resetSlotOverlays();
  }

  /** REQ-0097: point this ONE shared monitor at a DIFFERENT room's run -- reset all
   * per-run state, then re-mount the newly-selected run's player squads. The caller
   * (Monitor.tsx) resets its own event cursor so applyEvents() feeds from the top. */
  retarget(squads: MonitorSquadVisual[]): void {
    this.reset();
    this.mountSquads(squads);
  }

  /** REQ-0276 B3 e2e seam: roster enemy actor state (id/instanceId/hp/hpMax/
   * revealed/artLoaded/dead/wave/cells) so an e2e can assert the roster reached
   * the actor plane and art/HP wired. */
  getEnemyActors(): ReturnType<EnemyPlane['getActors']> {
    return this.enemyPlane.getActors();
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
