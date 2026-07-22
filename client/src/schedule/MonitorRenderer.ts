// Monitor's expanded-view PixiJS scene -- REQ-0036 P1-C. ONE PixiJS
// Application, created ONCE when the monitor component first mounts and
// kept alive for the component's lifetime -- same discipline as
// Board/InventoryBoard (see App.tsx's module comment / BoardRenderer.ts's
// "ONE app forever" convention): expand/collapse toggles CSS visibility
// on the already-mounted canvas, it never tears down and recreates a
// PIXI.Application.
//
// Two side-by-side A1:Z18 grids (player field, enemy field). Player side
// composes each squad through the SHARED squadCompositor (REQ-0283): BP cell
// fill (+ bp-skin tiling), placed POs contain-fit with the board's footprint
// outline, and the unit core disc + icon at the Unit's SEAT CELL -- the same
// mechanism Canvas/Inventory use, NOT a footprint-bbox wash. Enemy side draws
// roster-driven actors with real monster art (monitorActors.ts, art via the Dex
// art_urls chain); a footprint-colored blob + name label survives only as the
// LEGACY FALLBACK for runs that carry no placed roster actors. Decorative
// sprites are eventMode='none' (Pixi lesson from the task brief: decorative
// sprites should not eat pointer events).
//
// Ray animation (REQ-0276 Phase C): ray_fire+ray_step drive a luminous
// projectile head with a fading trail along the path cells
// (monitorFx.rayProjectile), ray_bounce is a gold spark burst at the bounce
// cell, ray_hit/ray_aoe are element-coloured impact bursts + tiered damage
// numbers, ray_hit_all a full-field radial wash, reflect_damage a blood
// pulse converging on the player field. ALL transient FX live in
// monitorFx.ts (glow budget + reduced-motion/webdriver gating); the `silent`
// apply path spawns none of them.
import { Application, Container, Graphics, Text, type Texture } from 'pixi.js';
import type { ApiRunEvent, ApiRunRoster } from '../api';
import type { ChimeSink } from './chimes/chimeMapping';
import { cellIdToXY, FIELD_COLS, FIELD_ROWS, parseBoxToPixelRect, type RawCell } from './fieldGeometry';
import { computeFootprintCells } from '../render/itemCard';
import { composeSquad } from '../board/squadCompositor';
import type { Offset } from '../engine/engine.d.ts';
import { EnemyPlane } from './monitorActors';
import { MJ } from './monitorTheme';
import { gimicGlyph } from './monitorGlyphs';
import { MonitorFx } from './monitorFx';
// REQ-0280 P3: per-skill ray/hit VFX-art resolver (composed-name chain, direct
// /api/art fetch, per-NAME cache incl. null misses -- see monitorVfxArt.ts).
import { resolveVfxTexture, peekVfxTexture } from './monitorVfxArt';
import { t } from '../i18n';
import type { Locale } from '../store';

export const FIELD_CELL_PX = 18; // small-scale -- 26x18 cells at 18px = 468x324px per field
const FIELD_GAP_PX = 24;
export const FIELD_W = FIELD_COLS * FIELD_CELL_PX;
const FIELD_H = FIELD_ROWS * FIELD_CELL_PX;
const STEP_ANIM_MS = 200; // per ray_step segment, within the 150-300ms band the task brief calls for
const HEAL_GREEN = 0x76c48a; // REQ-0276 B2: heal / lifesteal-heal green (+n); Phase C may re-tune.

// REQ-0283 (cell fidelity): the legacy enemy fallback markers anchor their
// label at a FIXED offset from their own cell and NEVER move. Colliding labels
// are resolved non-spatially only -- the topmost-leftmost keeps its full label,
// the rest hide (no lane bumping; the REQ-0169 M2 lane machinery is removed).
const ENEMY_LABEL_STYLE = { fill: 0xe8e0d0, fontSize: 9 };
const LABEL_LANE_H = 11; // label row height -- used only as the collision-test box height now

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
  /** REQ-0283: the Unit's SEAT CELL (engine.unitCell(bp) = origin + unit.off),
   * in the SAME absolute local-grid space as `cells`. Drives the board-style
   * unit core disc + icon placement in squadCompositor. Optional (absent on
   * synthetic literals / legacy squads without a unit seat). */
  seatCell?: Offset;
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
  /** REQ-0276 C5: seal-style KO stamp -- blood plate + bone Yuji-Syuku label,
   * pre-rotated; slammed in by refreshKoStamp on a live KO. */
  koStamp: Container;
  koLabel: Text;
  koPlate: Graphics;
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
  /** REQ-0283: 0 = label shown at its FIXED anchor, -1 = hidden by the
   * non-spatial collision-priority pass. Never a lane index -- labels no longer
   * move; the REQ-0169 M2 lane field is retained only as a shown/hidden flag
   * for the getEnemyMarkerBounds e2e seam. */
  lane?: number;
  /** REQ-0283: true when this label is hidden (a masked/duplicate collapse, or
   * lost the collision-priority tie) -- the dot is still drawn at its cell. */
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
  private gimicBadges = new Map<string, { container: Container; glyph: Text; bg?: Graphics; strike?: Graphics; state: string }>();
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
  /** REQ-0276 C: the shared VFX toolkit (glow budget, reduced-motion gate). */
  private fx: MonitorFx;
  /** REQ-0276 C1: the in-flight ray's element colour (fx.js semantics --
   * frost = player-origin, ember = enemy-origin, gold = pulse payload). Set
   * at ray_fire/ray_step; ray_hit/ray_aoe read it for impact colours. */
  private currentRayColor: number = MJ.frost;
  private currentRayBright: number = MJ.frostHi;
  /** REQ-0280 P3: the in-flight ray's VFX-art key -- skill = skills.json def id
   * on enemy/trap/door rays, src = the firing item id otherwise. Latched at
   * ray_fire so ray_step (trail) and ray_hit (impact) resolve the SAME art. */
  private currentRayVfxKey: { skill: string | null; src: string | null } = { skill: null, src: null };

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

    // REQ-0276 C: ONE FX toolkit drives every transient effect; it draws into
    // rayLayer (purged by reset()) and registers through addTicker (cancelled
    // by reset()), so no effect can outlive a retarget or a replay seek.
    this.fx = new MonitorFx(this.rayLayer, (step) => this.addTicker(step), FIELD_CELL_PX);
    // REQ-0276 B1: roster-driven enemy actors live in their own sublayer of the
    // enemy field; the gimic-badge overlay sits above them.
    this.enemyPlane = new EnemyPlane(this.enemyField, FIELD_CELL_PX, FIELD_W, this.fx);
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
  /** REQ-0280 P3: the CURRENT ray's cached hit-still texture (peek only -- never
   * waits; null until the ray_fire prefetch warms the cache, so the first hit of
   * a key falls back procedurally and the next lands the art). */
  private currentHitTexture(): Texture | null {
    if (!this.fx.animated) return null;
    return peekVfxTexture('hit', this.currentRayVfxKey.skill, this.currentRayVfxKey.src);
  }

  private floatDamage(field: 'player' | 'enemy', amount: number): void {
    if (!(amount > 0)) return;
    const ox = field === 'enemy' ? this.enemyField.x : this.playerField.x;
    const oy = field === 'enemy' ? this.enemyField.y : this.playerField.y;
    const spread = (this.dmgSeq++ % 5) - 2;
    const x = ox + FIELD_W / 2 + spread * 24;
    const y = oy + FIELD_H / 2 + spread * 6;
    // REQ-0276 C2/C4: even an unlocated hit gets its impact burst at the
    // spread position -- blood when WE take it, the ray's element otherwise.
    const hitTex = this.currentHitTexture();
    if (field === 'player') this.fx.impactBurst(x, y, MJ.blood, MJ.emberHi, 1, hitTex);
    else this.fx.impactBurst(x, y, this.currentRayColor, this.currentRayBright, 1, hitTex);
    // player field = WE take the hit (blood); enemy field = we dealt it (ember-hi).
    this.floatNumberAt(x, y, amount, field === 'player' ? MJ.blood : MJ.emberHi);
  }

  /** REQ-0276 B2: a floating tier-sized number that rises + fades at an ABSOLUTE
   * stage position, so damage lands on the ACTUAL hit cell/actor (not a field-
   * centre spread). `prefix` carries the heal '+'; opts pick the C4 treatment. */
  private floatNumberAt(x: number, y: number, amount: number, color: number, prefix = '', opts?: { heal?: boolean; kill?: boolean }): void {
    if (!(amount > 0)) return;
    const n = Math.round(amount);
    // REQ-0276 C4: tier by amount (small <10 / mid <30 / large); pop-in, rise
    // and fade live in monitorFx. Heals drift gently with no pop; a killing
    // blow gets the single gold flourish. Legibility comes from a thin void
    // outline on the glyphs -- never glow.
    const kind: 'small' | 'mid' | 'large' | 'heal' = opts?.heal ? 'heal' : n < 10 ? 'small' : n < 30 ? 'mid' : 'large';
    this.fx.floatNumber(x, y, prefix + String(n), color, kind, !!opts?.kill);
  }

  /** REQ-0240 (03 ss5.6): the telegraph as theatre -- a wind-up edge glow on the
   * targeted edge of the player field for a short hold (the "Telegraph:" text
   * line dies; the stage IS the telegraph). */
  private telegraphGlow(edge: string): void {
    // REQ-0276 C3: the wind-up is a thin GOLD hairline on the threatened edge
    // (structure warns; the ember arrives with the ray itself). It breathes
    // in over ~500ms, then releases.
    const th = 2;
    const o = this.fieldOrigin('player');
    let x = o.x;
    let y = o.y;
    let w = FIELD_W;
    let h = th;
    if (edge === 'bottom') { y = o.y + FIELD_H - th; }
    else if (edge === 'left') { w = th; h = FIELD_H; }
    else if (edge === 'right') { x = o.x + FIELD_W - th; w = th; h = FIELD_H; }
    this.fx.telegraph(x, y, w, h);
  }

  /** REQ-0276 C: stage-space origin of a field -- transient FX draw into the
   * stage-level rayLayer, so cell positions must be offset by the field the
   * effect belongs to (the enemy field moves under setLayout('column')). */
  private fieldOrigin(field: 'player' | 'enemy'): { x: number; y: number } {
    const f = field === 'enemy' ? this.enemyField : this.playerField;
    return { x: f.x, y: f.y };
  }

  private drawFieldBackdrop(field: Container, tint = 0): void {
    const bg = new Graphics();
    // REQ-0276 C6: deepen to the void -- the idle stage is calm, dark, matte.
    bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: MJ.void, alpha: 0.9 }).stroke({ color: MJ.borderLo, width: 1 });
    // REQ-0240 ss5.1: a faint per-side tint wash so the fields read PLAYER vs
    // ENEMY. Drawn into the backdrop (child 0), which mountSquads never clears.
    if (tint) bg.rect(0, 0, FIELD_W, FIELD_H).fill({ color: tint, alpha: 0.05 }); // REQ-0276 C6: washes stay <=6%
    bg.eventMode = 'none';
    field.addChild(bg);
    // REQ-0169 M3: a faint cell grid so positions read as a BOARD even at
    // 18px cells (the flat backdrop gave the eye nothing to register the
    // grid scale against -- formation outlines and BP footprints floated in
    // a void).
    const grid = new Graphics();
    for (let c = 1; c < FIELD_COLS; c++) grid.moveTo(c * FIELD_CELL_PX, 0).lineTo(c * FIELD_CELL_PX, FIELD_H);
    for (let r = 1; r < FIELD_ROWS; r++) grid.moveTo(0, r * FIELD_CELL_PX).lineTo(FIELD_W, r * FIELD_CELL_PX);
    grid.stroke({ color: MJ.borderLo, width: 1, alpha: 0.14 }); // REQ-0276 C6: fainter -- a whisper, not a lattice
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
        fb.rect(fx, 4, 8 * FIELD_CELL_PX, 8 * FIELD_CELL_PX).stroke({ color: MJ.goldLo, width: 1, alpha: 0.5 });
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

      // REQ-0276 B/C6: formation-box outline -- a gold-lo hairline, the
      // STRUCTURE's quiet frame (idle never glows, never shouts).
      const outline = new Graphics();
      outline.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: MJ.goldLo, width: 1, alpha: 0.9 });
      outline.eventMode = 'none';
      slotBox.addChild(outline);

      // REQ-0283: the shared squad compositor draws every BP faithfully at its
      // own cells -- BP fill (+ bp-skin tiling), placed POs contain-fit with the
      // board's footprint outline, then the unit core disc + icon AT THE SEAT
      // CELL (origin+unit.off), full alpha, on top. This replaces REQ-0276's
      // drawUnitArt footprint-bbox wash (deleted) per the user's cell-fidelity
      // ruling: unit art is not the BP background. cellW === cellH here
      // (formation boxes are square 8x8), so one cellPx drives the board-ratio
      // disc/icon/outline sizing.
      composeSquad(
        slotBox,
        {
          bps: squad.bps.map((bp) => ({ cells: bp.cells, seatCell: bp.seatCell ?? null, color: bp.color, unitId: bp.unitId })),
          pos: squad.icons.map((icon) => ({ shape: icon.shape, rot: icon.rot, origin: icon.origin, spriteKey: icon.textureKey, itemId: icon.itemId })),
        },
        { cellPx: cellW, originX: rect.x, originY: rect.y, textures: this.textures, fillAlpha: 0.72, cellStrokeColor: MJ.void, cellStrokeAlpha: 0.55, cellStrokeWidth: 1 }
      );

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

      // REQ-0276 C5: seal-style KO stamp -- bone lettering (Yuji Syuku, the
      // styleguide's seal face, loaded by index.html) on a blood plate,
      // tilted like a hanko; refreshKoStamp slams it in when KO lands live.
      const koLabel = new Text({ text: t(this.locale, 'schedule.monitor.dock.ko'), style: { fill: MJ.bone, fontSize: 13, fontWeight: 'bold', fontFamily: 'Yuji Syuku, serif' } });
      koLabel.anchor.set(0.5);
      koLabel.eventMode = 'none';
      const koPlate = new Graphics();
      koPlate.eventMode = 'none';
      const koStamp = new Container();
      koStamp.addChild(koPlate);
      koStamp.addChild(koLabel);
      koStamp.x = rect.x + rect.w / 2; koStamp.y = rect.y + rect.h / 2;
      koStamp.rotation = -0.14; // ~-8deg, the styleguide's stamp tilt
      koStamp.eventMode = 'none'; koStamp.visible = false;
      slotBox.addChild(koStamp);

      // REQ-0283: PO art is now drawn by composeSquad above; this loop only
      // collects each placed PO's px box for the item-fire muzzle-flash handle
      // (SquadSlotHandle.icons), the geometry ray_fire FX anchors to.
      const iconCells: Array<{ itemId: string; x: number; y: number; w: number; h: number }> = [];
      for (const icon of squad.icons) {
        if (!icon.itemId) continue;
        const footprint = computeFootprintCells(icon.shape, icon.rot);
        const [originR, originC] = icon.origin;
        iconCells.push({ itemId: icon.itemId, x: rect.x + originC * cellW, y: rect.y + originR * cellH, w: footprint.w * cellW, h: footprint.h * cellH });
      }

      this.squadSlots.set(squad.slotIndex, {
        slotIndex: squad.slotIndex, rect, cellW, cellH, container: slotBox,
        icons: iconCells, pips, koStamp, koLabel, koPlate, charge: 0, ko: false, label: squad.label,
      });
    }
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

  /** REQ-0276 C5: seal-style KO stamp -- redraw the blood plate to fit the
   * (locale-dependent) label, dim the slot, and, when the KO lands LIVE
   * (animate), slam it in with the styleguide's stampin overshoot. */
  private refreshKoStamp(h: SquadSlotHandle, animate = false): void {
    h.koLabel.text = t(this.locale, 'schedule.monitor.dock.ko');
    const w = h.koLabel.width + 14;
    const hh = h.koLabel.height + 6;
    h.koPlate.clear();
    h.koPlate.roundRect(-w / 2, -hh / 2, w, hh, 4).fill({ color: MJ.blood, alpha: 0.92 }).stroke({ color: MJ.bone, width: 1, alpha: 0.5 });
    const wasVisible = h.koStamp.visible;
    h.koStamp.visible = h.ko;
    h.container.alpha = h.ko ? 0.55 : 1;
    if (h.ko && !wasVisible && animate) this.fx.stampSlam(h.koStamp);
    else if (!h.ko || !wasVisible) { h.koStamp.scale.set(1); h.koStamp.alpha = 1; }
  }

  /** REQ-0276 C1: muzzle flash on a fired item's cell(s) -- a frost rim +
   * soft fill (the player's attack element, continuous with the outgoing
   * ray), 200ms ease-out, no glow. Maps ev.src item id -> every placed PO
   * with that id (ambiguous -> all fire). */
  private flashSourceItem(itemId: string): void {
    const o = this.fieldOrigin('player');
    for (const h of this.squadSlots.values()) {
      for (const ic of h.icons) {
        if (ic.itemId !== itemId) continue;
        this.fx.muzzle(o.x + ic.x, o.y + ic.y, ic.w, ic.h, MJ.frost, MJ.frostHi);
      }
    }
  }

  /** REQ-0276 B2: settle per-slot KO from a troop_bp_hp array (encounter_end /
   * run_end) -- summed per slot via the roster's slot BP counts, the same
   * reduction the DOM dock uses. */
  private settleKoFromHp(hps: number[], silent = false): void {
    if (!this.roster) return;
    let off = 0;
    for (const sl of this.roster.slots) {
      const n = sl.bps.length;
      let hp = 0; for (let k = 0; k < n; k++) hp += Math.max(0, hps[off + k] ?? 0);
      off += n;
      const hpMax = sl.bps.reduce((acc, b) => acc + (b.hpMax || 0), 0);
      const h = this.squadSlots.get(sl.index);
      if (h) { h.ko = hpMax > 0 && hp <= 0; this.refreshKoStamp(h, !silent); }
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

  // REQ-0283 (cell fidelity): dots stay at their true cells and every label
  // sits at a FIXED offset from its own dot -- labels NEVER move to make room.
  // (1) Same-text markers (many masked '?' or repeated 'dagger') collapse to
  // ONE representative label suffixed " x{count}"; the rest keep their dot but
  // hide their label (non-spatial). (2) The surviving labels are resolved
  // against each other NON-SPATIALLY only: in topmost-leftmost priority order, a
  // label that would overlap an already-kept one HIDES (it never bumps to a
  // lane). Every label is still truncated to the field's right edge, so REQ-0045
  // (f)'s "x + labelWidth <= FIELD_W" invariant continues to hold.
  private relayoutEnemyLabels(): void {
    const markers = Array.from(this.enemyMarkers.values());
    for (const m of markers) { m.lane = 0; m.hidden = false; }
    // (1) collapse duplicates by rawText (topmost-leftmost marker is the rep).
    const byText = new Map<string, FieldMarker[]>();
    for (const m of markers) {
      const g = byText.get(m.rawText);
      if (g) g.push(m);
      else byText.set(m.rawText, [m]);
    }
    const reps: Array<{ marker: FieldMarker; shown: string }> = [];
    for (const [txt, group] of byText) {
      group.sort((a, b) => (a.container.y - b.container.y) || (a.container.x - b.container.x));
      for (let i = 1; i < group.length; i++) {
        group[i].label.visible = false;
        group[i].hidden = true;
      }
      const rep = group[0];
      rep.label.visible = true;
      reps.push({ marker: rep, shown: group.length > 1 ? `${txt} x${group.length}` : txt });
    }
    // (2) FIXED anchor: every rep's label sits at label.y = 0 (its own cell),
    // truncated to the field's right edge. NO lane offset is ever applied.
    for (const { marker, shown } of reps) {
      marker.label.text = this.truncateLabelToFit(shown, ENEMY_LABEL_STYLE, Math.max(0, FIELD_W - marker.container.x));
      marker.label.x = 0;
      marker.label.y = 0;
    }
    // (3) non-spatial collision resolution: topmost-leftmost priority keeps its
    // full label; any later rep whose fixed-anchor box overlaps a kept one is
    // hidden (never moved). Deterministic -- ties break by (y, x).
    const shownReps = reps.filter((r) => r.marker.label.visible);
    shownReps.sort((a, b) => (a.marker.container.y - b.marker.container.y) || (a.marker.container.x - b.marker.container.x));
    const kept: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const overlaps = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    for (const { marker } of shownReps) {
      const x = marker.container.x;
      const y = marker.container.y;
      const box = { x1: x, y1: y, x2: x + marker.label.width, y2: y + LABEL_LANE_H };
      if (kept.some((k) => overlaps(k, box))) {
        marker.label.visible = false;
        marker.hidden = true;
        marker.lane = -1;
      } else {
        kept.push(box);
        marker.label.visible = true;
        marker.hidden = false;
        marker.lane = 0;
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

  /** REQ-0276 C1: boundary bounce / reveal moment -- a brief GOLD spark
   * burst (structure's voice) at the cell, in the given field's space. */
  private flashCell(cellId: string | RawCell, field: 'player' | 'enemy' = 'enemy'): void {
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    const o = this.fieldOrigin(field);
    this.fx.bounceSpark(o.x + pos.x + FIELD_CELL_PX / 2, o.y + pos.y + FIELD_CELL_PX / 2);
  }

  /** REQ-0276 C2: a small impact burst at a cell (link pulses land here) --
   * fx.js's expand+fade with a 1-frame bright core, the sanctioned hit-glow
   * moment. */
  private pulseCell(cellId: string | RawCell, color = MJ.blood, bright = MJ.goldHi, field: 'player' | 'enemy' = 'player'): void {
    const pos = cellIdToXY(cellId, FIELD_CELL_PX);
    const o = this.fieldOrigin(field);
    this.fx.impactBurst(o.x + pos.x + FIELD_CELL_PX / 2, o.y + pos.y + FIELD_CELL_PX / 2, color, bright);
  }

  /** REQ-0276 C1: ray as a projectile -- a luminous elongated head walking
   * the path with a short fading trail (trail cost capped in monitorFx), in
   * the CURRENT ray's field space. */
  private animateStep(path: RawCell[], color = MJ.frost, bright = MJ.frostHi): void {
    if (path.length === 0) return;
    const o = this.fieldOrigin(this.currentRayField);
    const centers = path.map((id) => {
      const p = cellIdToXY(id, FIELD_CELL_PX);
      return { x: o.x + p.x + FIELD_CELL_PX / 2, y: o.y + p.y + FIELD_CELL_PX / 2 };
    });
    // REQ-0280 P3: use the ray strip art ONLY if it is already cached (peek --
    // never waits); an unwarmed key falls back procedurally for this ray.
    const rayTex = this.fx.animated
      ? peekVfxTexture('ray', this.currentRayVfxKey.skill, this.currentRayVfxKey.src)
      : null;
    this.fx.rayProjectile(centers, color, bright, STEP_ANIM_MS, rayTex);
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
        if (Array.isArray(ev.troop_bp_hp)) this.settleKoFromHp(ev.troop_bp_hp as number[], silent);
        break;
      }
      case 'run_end': {
        if (Array.isArray(ev.troop_bp_hp)) this.settleKoFromHp(ev.troop_bp_hp as number[], silent);
        break;
      }
      case 'ray_fire': {
        const field = ev.field === 'enemy' ? 'enemy' : 'player';
        this.currentRayField = field; // REQ-0240: ray_hit reads its side from here
        // REQ-0280 P3: latch this ray's VFX-art key + prefetch BOTH roles
        // (fire-and-forget) so the impending impact usually hits cache. Gated to
        // full mode -- off/reduced draw no VFX, so no art fetch (e2e stays inert).
        {
          const vfxSkill = typeof ev.skill === 'string' ? ev.skill : null;
          const vfxSrc = typeof ev.src === 'string' ? ev.src : null;
          this.currentRayVfxKey = { skill: vfxSkill, src: vfxSrc };
          if (!silent && this.fx.animated) {
            void resolveVfxTexture('ray', vfxSkill, vfxSrc);
            void resolveVfxTexture('hit', vfxSkill, vfxSrc);
          }
        }
        // REQ-0276 C1: element colour by origin (the wire carries none) --
        // frost = our volley crossing to the enemy field, ember = theirs
        // arriving on ours; a pulse payload overrides to gold at ray_step.
        this.currentRayColor = field === 'enemy' ? MJ.frost : MJ.ember;
        this.currentRayBright = field === 'enemy' ? MJ.frostHi : MJ.emberHi;
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
        if (pulseRay) {
          this.pulseCounts.rays++;
          // gold payload: the LIVE-link voice -- and what its hits flash in.
          this.currentRayColor = MJ.gold;
          this.currentRayBright = MJ.goldHi;
        }
        if (!silent) this.animateStep(path, this.currentRayColor, this.currentRayBright);
        break;
      }
      case 'ray_bounce': {
        const at = isRawCell(ev.at) ? ev.at : null;
        if (at && !silent) this.flashCell(at, this.currentRayField);
        break;
      }
      case 'ray_hit': {
        const dst = typeof ev.dst === 'string' ? ev.dst : null;
        if (dst && dst !== '?') this.markDiscovered(dst);
        const amt = ev.pcoalesce ? ev.pcoalesce.amount : (typeof ev.amount === 'number' ? ev.amount : 0);
        // REQ-0276 B1: attribute to the roster enemy + deplete its HP.
        const idx = typeof ev.enemyIdx === 'number' ? ev.enemyIdx : null;
        const kill = typeof ev.hp_after === 'number' && ev.hp_after <= 0 && amt > 0;
        if (idx != null) this.enemyPlane.hit(idx, typeof ev.hp_after === 'number' ? ev.hp_after : undefined, amt, silent);
        // REQ-0276 C2/C4: impact burst + tiered damage number at the hit.
        if (!silent && !ev.pcoalesceHidden) this.floatDamageLocated(idx, amt, kill);
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
            this.enemyPlane.hit(h.enemyIdx, typeof h.hp_after === 'number' ? h.hp_after : undefined, typeof h.amount === 'number' ? h.amount : undefined, silent);
            // REQ-0276 C2: AoE = simultaneous SMALL bursts over each hit cell.
            if (!silent && typeof h.amount === 'number') {
              this.floatDamageLocated(h.enemyIdx, h.amount, typeof h.hp_after === 'number' && h.hp_after <= 0, 0.7);
            }
          }
        }
        // REQ-0276 C2: ray_hit_all (nova) = a fast element-coloured radial
        // wash from the field centre -- masked to the field, low alpha,
        // deliberately NOT a screen-white flashbang.
        if (!silent && ev.ev === 'ray_hit_all') {
          const o = this.fieldOrigin(this.currentRayField);
          this.fx.fieldWash({ x: o.x, y: o.y, w: FIELD_W, h: FIELD_H }, this.currentRayColor, this.currentRayBright);
        }
        if (!silent && !located && total > 0) this.floatDamage(this.currentRayField, total);
        break;
      }
      case 'reflect_damage': {
        // REQ-0276 C2: reflected harm returns to US -- a blood-tinted pulse
        // converging on the player field.
        if (!silent) {
          const o = this.fieldOrigin('player');
          this.fx.returnPulse({ x: o.x, y: o.y, w: FIELD_W, h: FIELD_H });
        }
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
          if (pos) this.floatNumberAt(pos.x, pos.y, amount, HEAL_GREEN, '+', { heal: true });
          else this.floatNumberAt(this.enemyField.x + FIELD_W / 2, this.enemyField.y + FIELD_H / 2, amount, HEAL_GREEN, '+', { heal: true });
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
        if (dst) this.enemyPlane.statusTickByInstance(dst, status, typeof ev.hp_after === 'number' ? ev.hp_after : undefined, silent);
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
        if (typeof ev.slot === 'number') this.lightChargePips(ev.slot, ev.ev, ev, silent);
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
      case 'att_open': { this.attCounts.open++; this.updateGimicBadge(ev, 'opened'); if (!silent) this.gimicBurst(ev, MJ.gold, MJ.goldHi); break; }
      case 'att_lost': { this.attCounts.lost++; this.updateGimicBadge(ev, 'lost'); break; }
      case 'att_fire': { this.attCounts.fire++; this.updateGimicBadge(ev, 'fired'); if (!silent) this.gimicBurst(ev, MJ.blood, MJ.emberHi); break; }
      default:
        break;
    }
  }

  /** REQ-0276 C2/C4: impact burst (ray-element colour, 1-frame bright core --
   * the sanctioned hit glow) + tiered damage number at a roster enemy's
   * centroid; a killing blow adds the single gold flourish. Falls back to
   * the field-centre spread when the hit is unattributed (masked / no
   * enemyIdx). AoE passes burstScale < 1 for its simultaneous small bursts. */
  private floatDamageLocated(enemyIdx: number | null, amount: number, kill = false, burstScale = 1): void {
    if (!(amount > 0)) return;
    const pos = enemyIdx != null ? this.enemyPlane.centroidOf(enemyIdx) : null;
    if (pos) {
      this.fx.impactBurst(pos.x, pos.y, this.currentRayColor, this.currentRayBright, burstScale, this.currentHitTexture());
      this.floatNumberAt(pos.x, pos.y, amount, MJ.emberHi, '', { kill });
    } else {
      this.floatDamage(this.currentRayField, amount);
    }
  }

  /** REQ-0276 C5: light the pips on a charging squad slot. stack sets the
   * count; spend clears them behind a quick gold drain sweep; the rest give
   * a minimal single-pip cue. */
  private lightChargePips(slot: number, ev: string, payload: ApiRunEvent, silent = false): void {
    const h = this.squadSlots.get(slot);
    if (!h) return;
    if (ev === 'unit_charge_stack' && typeof payload.stacks === 'number') h.charge = Math.max(0, Math.min(4, payload.stacks));
    else if (ev === 'unit_charge_spend') {
      if (!silent && h.charge > 0) {
        const pts: Array<{ x: number; y: number }> = [];
        const py = h.rect.y + h.rect.h + 16;
        for (let i = 0; i < h.charge; i++) pts.push({ x: h.rect.x + 4 + i * 8, y: py });
        this.fx.pipDrain(pts, 2.4);
      }
      h.charge = 0;
    } else h.charge = Math.max(h.charge, 1);
    this.refreshChargePips(h);
  }

  /** REQ-0276 C5: burst at a gimic badge's cell (chest opened = structure's
   * gold, trap fired = blood with an ember core) -- falls back to the enemy
   * field centre when the badge never got a position (no att_reveal cell). */
  private gimicBurst(ev: ApiRunEvent, color: number, bright: number): void {
    const attId = typeof ev.att === 'string' ? ev.att : null;
    const b = attId ? this.gimicBadges.get(attId) : null;
    const o = this.fieldOrigin('enemy');
    const placed = b && b.container.parent ? b.container : null;
    const x = placed ? o.x + placed.x + FIELD_CELL_PX / 2 : o.x + FIELD_W / 2;
    const y = placed ? o.y + placed.y + FIELD_CELL_PX / 2 : o.y + FIELD_H / 2;
    this.fx.impactBurst(x, y, color, bright, 0.8);
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
      bg.eventMode = 'none';
      const glyph = new Text({ text: glyphCh, style: { fill: MJ.bone, fontSize: 11 } });
      glyph.eventMode = 'none'; glyph.x = 3; glyph.y = 2;
      // REQ-0276 C5: the "lost" strikethrough bar, hidden until that state.
      const strike = new Graphics();
      strike.moveTo(2, FIELD_CELL_PX / 2).lineTo(FIELD_CELL_PX - 2, FIELD_CELL_PX / 2).stroke({ color: MJ.bone3, width: 1, alpha: 0.9 });
      strike.eventMode = 'none'; strike.visible = false;
      container.addChild(bg); container.addChild(glyph); container.addChild(strike);
      const p = cellIdToXY(ev.at, FIELD_CELL_PX);
      container.x = p.x; container.y = p.y;
      this.enemyOverlay.addChild(container);
      badge = { container, glyph, bg, strike, state };
      this.gimicBadges.set(attId, badge);
    }
    badge.state = state;
    badge.glyph.text = glyphCh;
    // REQ-0276 C5 state tints: armed lurks in ember-lo, disarmed/lost recede
    // to bone-3 (lost also struck through), opened is structure's gold-lo,
    // fired is blood. The frame follows the state; the armed glyph keeps a
    // readable ember so the threat doesn't sink into the panel.
    const tint = state === 'fired' ? MJ.blood
      : state === 'opened' ? MJ.goldLo
      : state === 'disarmed' || state === 'lost' ? MJ.bone3
      : MJ.emberLo;
    badge.glyph.style.fill = state === 'revealed' ? MJ.ember : tint;
    if (badge.bg) {
      badge.bg.clear();
      badge.bg.roundRect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX, 3).fill({ color: MJ.raised, alpha: 0.9 }).stroke({ color: tint, width: 1, alpha: 0.75 });
    }
    if (badge.strike) badge.strike.visible = state === 'lost';
    badge.container.alpha = state === 'lost' || state === 'disarmed' ? 0.5 : 1;
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
    // REQ-0283: x/labelWidth/labelText keep their exact prior shape (REQ-0045
    // (f)'s FIELD_W assertion is unchanged); hidden/lane are ADDITIVE and now
    // report the HONEST fixed-anchor contract -- lane is only ever 0 (shown at
    // the fixed anchor) or -1 (hidden by collision priority), never a bumped
    // lane index. The enemyPlane path reports the same via getMarkerBounds().
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
      child.destroy({ children: true }); // REQ-0276 C: fx washes carry children (mask)
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
    // REQ-0276 C: cancelled tickers can never release their glow holds --
    // zero the budget alongside them.
    this.fx.resetBudget();
    this.currentRayVfxKey = { skill: null, src: null }; // REQ-0280 P3
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
