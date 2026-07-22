// REQ-0276 Phase C: the monitor's VFX toolkit -- every transient effect the
// battle stage plays lives here, so the MJOLNIR discipline (styleguide §6.0)
// is enforced in ONE place:
//
//   * Glow is spent ONLY at the sanctioned moments (a LIVE ray's head, the
//     instant of a hit, link pulses). It is implemented as additive blending
//     on a small bright core -- never a blur filter, never on an idle
//     element -- and hard-capped at GLOW_BUDGET concurrent sources via
//     tryGlow()/releaseGlow(). When the budget is spent an effect simply
//     renders in normal blend: quieter, never broken.
//   * Colour semantics (fx.js, the user-accepted RayMonitor reference):
//     frost = player-origin attack, ember = enemy-origin attack, gold =
//     STRUCTURE's voice (pulse payloads, bounce sparks, kill flourish,
//     telegraph hairline), blood = the player taking damage.
//   * Motion: 120-180ms ease-out births, ~0.7s expand+fade impacts (fx.js's
//     own hit-flash timing), nothing loops, nothing persists, idle elements
//     are never touched from here.
//
// Gating (REQ-0276 C7, the landing/particles.ts pattern):
//   - navigator.webdriver    -> 'off'     (E2E/automation: zero transient
//     VFX; the pulse/att counters and every __monitorDebug seam live in
//     MonitorRenderer and never depended on VFX -- they keep incrementing
//     exactly as before).
//   - prefers-reduced-motion -> 'reduced' (damage/heal numbers still appear,
//     they are information -- but static: no pop, no drift, no decoration).
//   - otherwise              -> 'full'.
// The renderer's `silent` apply path (replay scrub / catch-up) never calls
// into this module at all, so silent === zero VFX holds by construction.
//
// Every effect draws into ONE layer (the renderer's rayLayer) and registers
// through the renderer's addTicker, so MonitorRenderer.reset() cancels and
// purges everything here in one sweep; resetBudget() re-zeroes the glow
// ledger for the holds those cancelled tickers could not release.
import { Container, Graphics, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import { MJ } from './monitorTheme';

export type FxMode = 'full' | 'reduced' | 'off';

/** Evaluated once at module load -- same gate landing/particles.ts uses. */
export function computeFxMode(): FxMode {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'off';
  if (navigator.webdriver) return 'off';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced';
  return 'full';
}

export const FX_MODE: FxMode = computeFxMode();

export interface FxPoint { x: number; y: number }
export interface FxRect { x: number; y: number; w: number; h: number }
/** Damage-number tier (REQ-0276 C4): small <10, mid <30, large otherwise. */
export type FxNumberKind = 'small' | 'mid' | 'large' | 'heal';

type TickerHost = (step: () => boolean) => void;

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k) * (1 - k);
const smoothstep = (k: number): number => k * k * (3 - 2 * k);
/** Trail cost cap per ray -- at most this many segments are redrawn per frame. */
const RAY_TRAIL_CELLS = 6;
/** Styleguide §6.0: at most 3 concurrent glow sources on screen. */
const GLOW_BUDGET = 3;
/** REQ-0280 P3: textured-trail band height as a fraction of a cell (the 256x64
 * ray strip is drawn this tall along the path -- modest so it reads as a trail,
 * not a slab). */
const TRAIL_TEX_H_FRAC = 0.55;
/** REQ-0280 P3: head-of-trail alpha for the textured strip; fades to 0 across
 * the RAY_TRAIL_CELLS window (same head->tail law as the procedural trail). */
const TRAIL_TEX_ALPHA = 0.85;

export class MonitorFx {
  private layer: Container;
  private addTicker: TickerHost;
  private cell: number;
  private glowCount = 0;
  private sparkSeq = 0;

  constructor(layer: Container, addTicker: TickerHost, cellPx: number) {
    this.layer = layer;
    this.addTicker = addTicker;
    this.cell = cellPx;
  }

  /** True when full transient animation may run (not reduced-motion/webdriver). */
  get animated(): boolean {
    return FX_MODE === 'full';
  }

  /** MonitorRenderer.reset() cancels in-flight tickers without running them,
   * so their glow holds can never be released -- zero the ledger with them. */
  resetBudget(): void {
    this.glowCount = 0;
  }

  private tryGlow(): boolean {
    if (this.glowCount >= GLOW_BUDGET) return false;
    this.glowCount++;
    return true;
  }

  private releaseGlow(): void {
    if (this.glowCount > 0) this.glowCount--;
  }

  /** Spawn a Graphics driven by a normalized-time draw callback; removal +
   * destroy are guaranteed at the end (or by the reset() layer purge). */
  private spawn(ms: number, draw: (k: number, g: Graphics) => void, onDone?: () => void): void {
    const g = new Graphics();
    g.eventMode = 'none';
    this.layer.addChild(g);
    const start = performance.now();
    this.addTicker((): boolean => {
      if (g.destroyed) {
        if (onDone) onDone();
        return true;
      }
      const e = performance.now() - start;
      draw(Math.min(1, e / ms), g);
      if (e >= ms) {
        if (g.parent) g.parent.removeChild(g);
        g.destroy();
        if (onDone) onDone();
        return true;
      }
      return false;
    });
  }

  /** REQ-0276 C1: a ray as a PROJECTILE -- an elongated luminous head (the
   * LIVE-beam glow moment, additive while the budget allows) walking the
   * path's cell centres, dragging a short fading trail. `centers` are stage
   * coords; total flight time is msPerStep per path segment, then a ~240ms
   * afterglow fade of whatever trail remains. */
  rayProjectile(centers: FxPoint[], color: number, bright: number, msPerStep: number, tex?: Texture | null): void {
    if (FX_MODE !== 'full' || centers.length === 0) return;
    const n = centers.length;
    const total = msPerStep * Math.max(1, n - 1);
    const fadeMs = 240;
    const cell = this.cell;
    const at = (t: number): FxPoint => {
      const c = Math.max(0, Math.min(n - 1, t));
      const i = Math.min(n - 2, Math.floor(c));
      if (n === 1 || i < 0) return centers[0];
      const f = c - i;
      const a = centers[i];
      const b = centers[i + 1];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    // REQ-0280 P3: when a ray strip texture is already cached (peeked in time by
    // the renderer) the TRAIL is drawn as per-segment TilingSprites laid along
    // the polyline; otherwise the procedural stroke trail below. The luminous
    // procedural HEAD and the head->tail per-segment alpha fade stay
    // renderer-owned either way; a textured trail spends no extra glow.
    const textured = !!tex && n >= 2;
    const glow = this.tryGlow();
    const head = new Graphics();
    head.eventMode = 'none';
    if (glow) head.blendMode = 'add';
    const trailG = textured ? null : new Graphics();
    if (trailG) { trailG.eventMode = 'none'; this.layer.addChild(trailG); }
    // Textured trail: one TilingSprite per polyline segment + the cumulative
    // path distances so tilePosition.x flows continuously from the ray's origin
    // (texture NEVER stretches: 1 tile spans one diagonal cell run -- REQ-0264
    // s7.2 adapted from the expedition's 56.57px to the monitor's 18px cells).
    const segs: (TilingSprite | null)[] = [];
    const cum: number[] = [0];
    if (textured) {
      for (let i = 1; i < n; i++) {
        cum[i] = cum[i - 1] + Math.hypot(centers[i].x - centers[i - 1].x, centers[i].y - centers[i - 1].y);
      }
      const bandH = cell * TRAIL_TEX_H_FRAC;
      const tilePx = cell * Math.SQRT2; // one tile = one diagonal cell run
      const t0 = tex as Texture;
      for (let s = 0; s < n - 1; s++) {
        const a = centers[s];
        const b = centers[s + 1];
        const segLen = cum[s + 1] - cum[s];
        if (!(segLen > 0)) { segs.push(null); continue; }
        const sp = new TilingSprite(t0, segLen, bandH);
        sp.eventMode = 'none';
        sp.anchor.set(0, 0.5); // left-centre: start at the segment start, band on the line
        sp.tileScale.set(tilePx / t0.width, bandH / t0.height);
        sp.tilePosition.set(-cum[s], 0); // continue the tiling from the ray origin
        sp.x = a.x;
        sp.y = a.y;
        sp.rotation = Math.atan2(b.y - a.y, b.x - a.x);
        sp.visible = false;
        this.layer.addChild(sp);
        segs.push(sp);
      }
    }
    this.layer.addChild(head); // head always on top of the trail
    const start = performance.now();
    let released = !glow;
    const release = (): void => {
      if (!released) {
        this.releaseGlow();
        released = true;
      }
    };
    const trailLen = RAY_TRAIL_CELLS * cell;
    this.addTicker((): boolean => {
      if (head.destroyed || (trailG != null && trailG.destroyed)) {
        release();
        return true;
      }
      const e = performance.now() - start;
      const k = Math.min(1, e / total);
      const fade = e > total ? Math.max(0, 1 - (e - total) / fadeMs) : 1;
      const t = k * (n - 1);
      if (textured) {
        const ti = Math.min(n - 2, Math.floor(t));
        const tf = Math.max(0, Math.min(1, t - ti));
        const headDist = n === 1 ? 0 : cum[ti] + (cum[ti + 1] - cum[ti]) * tf;
        for (let s = 0; s < segs.length; s++) {
          const sp = segs[s];
          if (!sp) continue;
          const segStart = cum[s];
          if (segStart >= headDist) { sp.visible = false; continue; }
          const visEnd = Math.min(cum[s + 1], headDist);
          const w = visEnd - segStart;
          if (!(w > 0)) { sp.visible = false; continue; }
          const behind = headDist - (segStart + visEnd) / 2;
          const a = behind >= trailLen ? 0 : TRAIL_TEX_ALPHA * (1 - behind / trailLen) * fade;
          if (!(a > 0)) { sp.visible = false; continue; }
          sp.width = w;
          sp.alpha = a;
          sp.visible = true;
        }
      } else if (trailG != null) {
        trailG.clear();
        for (let j = 0; j < RAY_TRAIL_CELLS; j++) {
          const t1 = t - j;
          if (t1 <= 0) break;
          const p1 = at(t1);
          const p0 = at(Math.max(0, t1 - 1));
          trailG.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({
            color,
            width: Math.max(1.5, cell * 0.16),
            alpha: 0.5 * (1 - j / RAY_TRAIL_CELLS) * fade,
            cap: 'round',
          });
        }
      }
      head.clear();
      if (k < 1) {
        const hp = at(t);
        const back = at(Math.max(0, t - 0.9));
        head.moveTo(back.x, back.y).lineTo(hp.x, hp.y).stroke({
          color: bright,
          width: Math.max(2, cell * 0.28),
          alpha: 0.95,
          cap: 'round',
        });
        head.circle(hp.x, hp.y, Math.max(2, cell * 0.2)).fill({ color: 0xffffff, alpha: 0.9 });
      } else {
        release(); // head is gone -- give the glow back before the trail dies
      }
      if (e >= total + fadeMs) {
        release();
        if (trailG != null) { if (trailG.parent) trailG.parent.removeChild(trailG); trailG.destroy(); }
        for (const sp of segs) { if (sp && !sp.destroyed) { if (sp.parent) sp.parent.removeChild(sp); sp.destroy(); } }
        if (head.parent) head.parent.removeChild(head);
        head.destroy();
        return true;
      }
      return false;
    });
  }

  /** REQ-0276 C1: boundary bounce -- a brief GOLD spark burst (structure's
   * voice, per fx.js's bounce rings): five short radial slivers flying out,
   * gold-hi core for the first frames. Normal blend; no glow spent. */
  bounceSpark(x: number, y: number): void {
    if (FX_MODE !== 'full') return;
    const cell = this.cell;
    const seed = (this.sparkSeq++ % 5) * 0.4;
    this.spawn(320, (k, g) => {
      g.clear();
      const inner = cell * (0.12 + 0.6 * easeOut(k));
      const len = cell * 0.26 * (1 - k * 0.6);
      for (let i = 0; i < 5; i++) {
        const th = seed + i * ((Math.PI * 2) / 5);
        g.moveTo(x + Math.cos(th) * inner, y + Math.sin(th) * inner)
          .lineTo(x + Math.cos(th) * (inner + len), y + Math.sin(th) * (inner + len))
          .stroke({ color: k < 0.35 ? MJ.goldHi : MJ.gold, width: 1.5, alpha: 0.9 * (1 - k), cap: 'round' });
      }
      if (k < 0.25) g.circle(x, y, cell * 0.18).fill({ color: MJ.goldHi, alpha: 0.9 * (1 - k / 0.25) });
    });
  }

  /** REQ-0276 C2: THE hit flash -- fx.js's 0.7s expand+fade circle in the
   * attack's colour, with a bright additive core for the opening instant
   * (one of the four sanctioned glow moments; falls back to normal blend
   * when the budget is spent). */
  impactBurst(x: number, y: number, color: number, bright: number, scale = 1, tex?: Texture | null): void {
    if (FX_MODE !== 'full') return;
    const cell = this.cell;
    // REQ-0280 P3: when a hit still is already cached, blit it centred at the
    // cell BENEATH the procedural core flash, under the renderer ramp
    // (scale .35 -> 1.0, alpha 1 -> 0 over the burst) -- the art supplies the
    // still, the renderer supplies the ramp (REQ-0264 s7.3). Absent -> the
    // procedural burst only; the sprite spends no extra glow.
    let sprite: Sprite | null = null;
    if (tex) {
      sprite = new Sprite(tex);
      sprite.eventMode = 'none';
      sprite.anchor.set(0.5);
      sprite.x = x;
      sprite.y = y;
      this.layer.addChild(sprite); // below the spawn() Graphics -> under the core
    }
    const peakPx = cell * 2.8 * scale; // matches the procedural circle peak diameter
    const glow = this.tryGlow();
    let released = !glow;
    const release = (): void => {
      if (!released) {
        this.releaseGlow();
        released = true;
      }
    };
    this.spawn(700, (k, g) => {
      if (sprite && !sprite.destroyed) {
        const rs = 0.35 + easeOut(k) * 0.65; // .35 -> 1.0
        sprite.width = peakPx * rs;
        sprite.height = peakPx * rs;
        sprite.alpha = 1 - easeOut(k); // 1 -> 0
      }
      // additive only while the bright core lives; back to normal after.
      if (glow) g.blendMode = k <= 0.25 ? 'add' : 'normal';
      if (k > 0.25) release();
      g.clear();
      const r = cell * (0.5 + easeOut(k) * 0.9) * scale;
      g.circle(x, y, r).fill({ color, alpha: 0.5 * (1 - k) });
      g.circle(x, y, r).stroke({ color, width: 1.5, alpha: 0.85 * (1 - k) });
      if (k < 0.16) g.circle(x, y, cell * 0.45 * scale).fill({ color: bright, alpha: 0.95 * (1 - k / 0.16) });
    }, () => {
      release();
      if (sprite && !sprite.destroyed) {
        if (sprite.parent) sprite.parent.removeChild(sprite);
        sprite.destroy();
      }
    });
  }

  /** Radial sweep across a field rect, masked to the field so it never
   * spills into the gap or the other pane. Low-alpha body + a wide leading
   * ring: a wash, deliberately NOT a screen-white flashbang. */
  private radialSweep(rect: FxRect, color: number, bright: number, converge: boolean, ms: number): void {
    if (FX_MODE !== 'full') return;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const maxR = Math.hypot(rect.w, rect.h) / 2;
    const minR = this.cell;
    const wash = new Container();
    wash.eventMode = 'none';
    const mask = new Graphics();
    mask.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: 0xffffff });
    mask.eventMode = 'none';
    const g = new Graphics();
    g.eventMode = 'none';
    g.mask = mask;
    wash.addChild(mask);
    wash.addChild(g);
    this.layer.addChild(wash);
    const start = performance.now();
    this.addTicker((): boolean => {
      if (g.destroyed || wash.destroyed) return true;
      const e = performance.now() - start;
      const k = Math.min(1, e / ms);
      const r = converge ? maxR - (maxR - minR) * easeOut(k) : minR + (maxR - minR) * easeOut(k);
      g.clear();
      g.circle(cx, cy, r).fill({ color, alpha: 0.1 * (1 - k) });
      g.circle(cx, cy, r).stroke({ color: bright, width: this.cell * 1.1, alpha: 0.32 * (1 - k) });
      if (e >= ms) {
        if (wash.parent) wash.parent.removeChild(wash);
        wash.destroy({ children: true });
        return true;
      }
      return false;
    });
  }

  /** REQ-0276 C2: ray_hit_all / nova -- a fast element-coloured radial wash
   * sweeping out from the field's centre. */
  fieldWash(rect: FxRect, color: number, bright: number): void {
    this.radialSweep(rect, color, bright, false, 700);
  }

  /** REQ-0276 C2: reflect_damage -- a blood-tinted pulse CONVERGING on the
   * player field (harm coming back to us). */
  returnPulse(rect: FxRect): void {
    this.radialSweep(rect, MJ.blood, MJ.blood, true, 550);
  }

  /** REQ-0276 C4: the killing-blow flourish -- one tiny gold four-point star
   * (structure's kill-spark voice), 350ms, normal blend. */
  killSpark(x: number, y: number): void {
    if (FX_MODE !== 'full') return;
    const cell = this.cell;
    this.spawn(350, (k, g) => {
      g.clear();
      const r = cell * 0.55 * easeOut(k);
      const a = 0.95 * (1 - k);
      for (const th of [0, Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4]) {
        const arm = th === 0 || th === Math.PI / 2 ? 1 : 0.55; // long orthogonals, short diagonals
        g.moveTo(x - Math.cos(th) * r * arm, y - Math.sin(th) * r * arm)
          .lineTo(x + Math.cos(th) * r * arm, y + Math.sin(th) * r * arm)
          .stroke({ color: MJ.goldHi, width: 1.5, alpha: a, cap: 'round' });
      }
    });
  }

  /** REQ-0276 C3: telegraph wind-up -- a thin gold hairline on the targeted
   * edge that breathes IN over ~500ms (smoothstep), then releases. */
  telegraph(x: number, y: number, w: number, h: number): void {
    if (FX_MODE !== 'full') return;
    const inMs = 520;
    const outMs = 200;
    this.spawn(inMs + outMs, (k, g) => {
      const e = k * (inMs + outMs);
      const a = e <= inMs ? 0.85 * smoothstep(e / inMs) : 0.85 * (1 - (e - inMs) / outMs);
      g.clear();
      g.rect(x, y, w, h).fill({ color: MJ.gold, alpha: a });
    });
  }

  /** REQ-0276 C1: muzzle flash on the firing item's footprint -- element rim
   * + soft fill, 200ms ease-out, no glow. */
  muzzle(x: number, y: number, w: number, h: number, color: number, bright: number): void {
    if (FX_MODE !== 'full') return;
    this.spawn(200, (k, g) => {
      g.clear();
      const a = 1 - easeOut(k);
      g.rect(x, y, w, h).fill({ color, alpha: 0.28 * a });
      g.rect(x + 0.5, y + 0.5, w - 1, h - 1).stroke({ color: bright, width: 1.5, alpha: 0.85 * a });
    });
  }

  /** REQ-0276 C5: reveal -- a bone-white rim that swells ~2px and dies in
   * 180ms (the silhouette -> art wipe). */
  revealRim(x: number, y: number, w: number, h: number): void {
    if (FX_MODE !== 'full') return;
    this.spawn(180, (k, g) => {
      g.clear();
      const grow = 2 * easeOut(k);
      g.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, 3)
        .stroke({ color: MJ.bone, width: 2, alpha: 0.85 * (1 - k) });
    });
  }

  /** REQ-0276 C5: death -- short blood flash over the actor's box while the
   * actor container fades to its corpse-ghost alpha over ~400ms. Returns
   * false when animation is off so the caller applies the state instantly;
   * the final alpha is also re-settled by any silent re-apply, so a fade
   * cancelled by reset() can never stick. */
  deathFade(target: Container, x: number, y: number, w: number, h: number, toAlpha: number): boolean {
    if (FX_MODE !== 'full') return false;
    this.spawn(180, (k, g) => {
      g.clear();
      g.roundRect(x, y, w, h, 3).fill({ color: MJ.blood, alpha: 0.4 * (1 - k) });
    });
    const start = performance.now();
    this.addTicker((): boolean => {
      if (target.destroyed) return true;
      const k = Math.min(1, (performance.now() - start) / 400);
      target.alpha = 1 + (toAlpha - 1) * easeOut(k);
      return k >= 1;
    });
    return true;
  }

  /** REQ-0276 C5: 150ms ease-out alpha settle for freshly-arrived art (no
   * hard pop-in). Instant when animation is off. */
  spriteIntro(target: Container, toAlpha = 1): void {
    if (FX_MODE !== 'full') {
      target.alpha = toAlpha;
      return;
    }
    target.alpha = 0;
    const start = performance.now();
    this.addTicker((): boolean => {
      if (target.destroyed) return true;
      const k = Math.min(1, (performance.now() - start) / 150);
      target.alpha = toAlpha * easeOut(k);
      return k >= 1;
    });
  }

  /** REQ-0276 C5: the KO seal slam -- styleguide "stampin": scale 2.4 ->
   * overshoot 0.94 -> settle 1 (the plate is pre-rotated by its owner).
   * Returns false when animation is off (caller shows it plainly). */
  stampSlam(root: Container): boolean {
    if (FX_MODE !== 'full') {
      root.scale.set(1);
      root.alpha = 1;
      return false;
    }
    root.scale.set(2.4);
    root.alpha = 0;
    const start = performance.now();
    this.addTicker((): boolean => {
      if (root.destroyed) return true;
      const k = Math.min(1, (performance.now() - start) / 300);
      const s = k < 0.6 ? 2.4 + (0.94 - 2.4) * easeOut(k / 0.6) : 0.94 + 0.06 * ((k - 0.6) / 0.4);
      root.scale.set(s);
      root.alpha = Math.min(1, k * 3);
      if (k >= 1) {
        root.scale.set(1);
        root.alpha = 1;
        return true;
      }
      return false;
    });
    return true;
  }

  /** REQ-0276 C5: charge spend -- the previously-lit pips flash gold-hi and
   * drain out over 240ms. */
  pipDrain(points: FxPoint[], r: number): void {
    if (FX_MODE !== 'full' || points.length === 0) return;
    this.spawn(240, (k, g) => {
      g.clear();
      const a = 0.9 * (1 - k);
      for (const p of points) g.circle(p.x, p.y, r + 2.5 * easeOut(k)).fill({ color: MJ.goldHi, alpha: a });
    });
  }

  /** REQ-0276 C4: a floating combat number. Tiered pop-in (bigger tiers pop
   * harder), upward ease-out drift, late fade; heals drift gently with no
   * pop; a killing blow gets the one gold flourish. Legibility comes from a
   * thin void outline -- never glow. Under reduced motion the number appears
   * statically (information, not decoration) and is removed after 600ms;
   * under webdriver nothing is drawn at all. */
  floatNumber(x: number, y: number, str: string, color: number, kind: FxNumberKind, kill = false): void {
    if (FX_MODE === 'off') return;
    const size = kind === 'large' ? 22 : kind === 'mid' ? 17 : 13;
    const label = new Text({
      text: str,
      style: {
        fill: color,
        fontSize: size,
        fontWeight: 'bold',
        fontFamily: 'Zen Kaku Gothic New, sans-serif',
        stroke: { color: MJ.void, width: 3 },
      },
    });
    label.eventMode = 'none';
    label.anchor.set(0.5);
    label.x = x;
    label.y = y;
    this.layer.addChild(label);
    const start = performance.now();
    if (FX_MODE === 'reduced') {
      this.addTicker((): boolean => {
        if (label.destroyed) return true;
        if (performance.now() - start < 600) return false;
        if (label.parent) label.parent.removeChild(label);
        label.destroy();
        return true;
      });
      return;
    }
    const heal = kind === 'heal';
    const total = heal ? 800 : 650;
    const drift = heal ? 12 : 20;
    const pop = heal ? 1 : kind === 'large' ? 2.2 : kind === 'mid' ? 1.8 : 1.45;
    if (kill) this.killSpark(x + label.width / 2 + 7, y - 4);
    this.addTicker((): boolean => {
      if (label.destroyed) return true;
      const e = performance.now() - start;
      const k = Math.min(1, e / total);
      label.scale.set(pop + (1 - pop) * easeOut(Math.min(1, e / 140)));
      label.y = y - drift * easeOut(k);
      label.alpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      if (e >= total) {
        if (label.parent) label.parent.removeChild(label);
        label.destroy();
        return true;
      }
      return false;
    });
  }
}
