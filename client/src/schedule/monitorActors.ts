// REQ-0276 B1: the ENEMY plane rebuilt as roster-driven ACTORS. Replaces the
// legacy "lazy red blob at the first-seen ray cell" flow (that stays as the
// fallback in MonitorRenderer when no roster / fieldCells exist -- e.g. legacy
// runs). Each roster enemy becomes an actor placed at its absolute fieldCells
// (REQ-0261 §8: server-derived, transpose-safe -- we NEVER derive geometry from
// the DISPLAY-only `footprint`). Monster art loads through the Dex art_urls
// chain (monitorArt) and contain-fits INTO the footprint box (REQ-0188: def
// footprint wins over art aspect; never stretch). While loading / when absent:
// a bone rune on a panel-dark cell block -- never a broken image, never a bare
// red blob when roster data exists.
//
// Structural only: HP-bar geometry + fill fraction + state colour, reveal/
// silhouette, defeat fade, subtle pack edge, status chips, and the fixed-anchor
// nameplates (REQ-0283: a label anchors at a FIXED offset from its actor's
// cells and NEVER moves; overlaps resolve by non-spatial priority-hide only,
// the REQ-0169 M2 lane system is gone) are all placed here; the Phase C VFX
// pass restyles the hooks (see the "PHASE-C HOOK" comments) without restructuring.
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { ApiRunRoster, ApiRunRosterEnemy } from '../api';
import { getCachedMonsterTexture, loadMonsterTexture } from './monitorArt';
import { MJ, hpColor, packTint } from './monitorTheme';
import { ENEMY_RUNE, statusGlyph, statusKind } from './monitorGlyphs';
import type { MonitorFx } from './monitorFx';

const NAME_STYLE = { fill: MJ.bone, fontSize: 9 } as const;
const LANE_H = 11; // label row height -- used only as the collision-test box height now
const HP_BAR_H = 3;
const PACK_KINDS = new Set(['pack', 'boss', 'combat', 'elite', 'miniboss']);

export interface EnemyActorDebug {
  id: string;
  instanceId: string;
  hp: number;
  hpMax: number;
  revealed: boolean;
  dead: boolean;
  artLoaded: boolean;
  wave: number;
  cells: [number, number][];
}

interface StatusChip {
  kind: string;
  text: Text;
  ttl: number; // frames-ish remaining before fade (structural; Phase C times it properly)
}

interface EnemyActor {
  enemy: ApiRunRosterEnemy;
  rosterIdx: number;
  wave: number;
  box: { x: number; y: number; w: number; h: number };
  container: Container;
  bg: Graphics;
  art: Sprite | null;
  rune: Text;
  silhouette: Graphics;
  nameplate: Text;
  /** REQ-0276 C6: small panel plate behind the nameplate (bone on panel,
   * 1px border-lo) so labels stay legible over the grid. */
  nameBg: Graphics;
  rawName: string;
  hpBar: Graphics;
  statusRow: Container;
  statuses: Map<string, StatusChip>;
  hp: number;
  hpMax: number;
  revealed: boolean;
  dead: boolean;
  artLoaded: boolean;
  lane: number;
  hidden: boolean;
}

/** REQ-0276 B1 §truncate: clamp a label to whatever horizontal space remains
 * from the actor's own left edge to the enemy field's right edge, ellipsizing
 * when cut -- keeps REQ-0045(f)'s "x + labelWidth <= FIELD_W" invariant (the
 * getEnemyMarkerBounds e2e seam) holding for actor nameplates too. */
function truncateToFit(label: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const probe = new Text({ text: label, style: { ...NAME_STYLE } });
  if (probe.width <= maxWidth) { probe.destroy(); return label; }
  let out = label;
  while (out.length > 1) {
    out = out.slice(0, -1);
    probe.text = out + '…';
    if (probe.width <= maxWidth) break;
  }
  probe.destroy();
  return out.length > 1 ? out + '…' : out;
}

/** REQ-0276 C5: status-chip alpha from remaining ttl -- full at 3+, receding
 * to a 0.35 floor at 0 (the state stays visible; only its urgency fades). */
function ttlAlpha(ttl: number): number {
  if (ttl >= 3) return 1;
  if (ttl === 2) return 0.75;
  if (ttl === 1) return 0.5;
  return 0.35;
}

export class EnemyPlane {
  private field: Container;
  private layer: Container;
  private cellPx: number;
  private fieldW: number;
  private locale: 'en' | 'ja' = 'en';
  private actors: EnemyActor[] = [];
  private byInstance = new Map<string, EnemyActor>();
  private waveOrder: string[] = [];
  private packEncountersSeen = 0;
  private activeWave = 0;
  private gen = 0;
  /** REQ-0276 C: the shared VFX toolkit (glow budget + reduced-motion gate
   * live there); null when the plane is built bare (tests). */
  private fx: MonitorFx | null;

  constructor(field: Container, cellPx: number, fieldW: number, fx: MonitorFx | null = null) {
    this.field = field;
    this.cellPx = cellPx;
    this.fieldW = fieldW;
    this.fx = fx;
    this.layer = new Container();
    this.layer.eventMode = 'none';
    this.field.addChild(this.layer);
  }

  setLocale(locale: 'en' | 'ja'): void {
    if (this.locale === locale) return;
    this.locale = locale;
    for (const a of this.actors) {
      a.rawName = this.nameOf(a.enemy);
      this.layoutName(a);
    }
    this.relayoutLabels();
  }

  /** True once a roster with placed enemies has been adopted -- the renderer
   * uses this to suppress the legacy lazy-blob flow. */
  hasRoster(): boolean {
    return this.actors.length > 0;
  }

  private nameOf(e: ApiRunRosterEnemy): string {
    return this.locale === 'ja' ? (e.nameJa || e.name) : e.name;
  }

  /** Rebuild the whole actor layer from a run roster. Enemies WITHOUT placed
   * fieldCells are skipped (legacy cursor-fill packs) -- the renderer then keeps
   * its lazy fallback for those. */
  setRoster(roster: ApiRunRoster | null): void {
    this.clear();
    if (!roster || !Array.isArray(roster.enemies)) return;
    // Distinct packIds in roster order == the encounter order of pack/boss
    // encounters (buildRoster iterates encounters in order); this is the wave
    // grouping key. Enemies with a null packId collapse into one leading wave.
    const waveIndex = new Map<string, number>();
    for (let idx = 0; idx < roster.enemies.length; idx++) {
      const e = roster.enemies[idx];
      const cells = Array.isArray(e.fieldCells) ? e.fieldCells : [];
      if (cells.length === 0) continue; // legacy: no placement -> lazy fallback
      const key = e.packId || '';
      let wv = waveIndex.get(key);
      if (wv === undefined) { wv = this.waveOrder.length; waveIndex.set(key, wv); this.waveOrder.push(key); }
      this.buildActor(e, idx, wv, cells);
    }
    this.packEncountersSeen = 0;
    this.activeWave = 0;
    this.showWave();
  }

  private buildActor(enemy: ApiRunRosterEnemy, rosterIdx: number, wave: number, cells: [number, number][]): void {
    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    for (const [r, c] of cells) { if (r < minR) minR = r; if (c < minC) minC = c; if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    const box = {
      x: (minC - 1) * this.cellPx,
      y: (minR - 1) * this.cellPx,
      w: (maxC - minC + 1) * this.cellPx,
      h: (maxR - minR + 1) * this.cellPx,
    };
    const container = new Container();
    container.x = box.x; container.y = box.y; container.eventMode = 'none';

    // Cell block: panel-dark rounded fill + border, plus a subtle pack-grouping
    // left edge keyed by packId. PHASE-C HOOK: restyle bg/frame here.
    const bg = new Graphics();
    this.paintBg(bg, box, enemy.packId);
    container.addChild(bg);

    // Masked silhouette (dark shape) shown until discovery -- monsters are
    // masked:false so this stays hidden for them.
    const silhouette = new Graphics();
    silhouette.roundRect(1, 1, box.w - 2, box.h - 2, 3).fill({ color: MJ.void, alpha: 0.9 });
    silhouette.eventMode = 'none';
    container.addChild(silhouette);

    // Rune placeholder (bone glyph) shown while art loads / when art is absent.
    const rune = new Text({ text: ENEMY_RUNE, style: { fill: MJ.bone3, fontSize: Math.max(11, Math.min(box.w, box.h) * 0.6) } });
    rune.eventMode = 'none';
    rune.anchor.set(0.5);
    rune.x = box.w / 2; rune.y = box.h / 2;
    container.addChild(rune);

    const hpBar = new Graphics();
    hpBar.eventMode = 'none';
    container.addChild(hpBar);

    const statusRow = new Container();
    statusRow.eventMode = 'none';
    statusRow.y = -HP_BAR_H - 9;
    container.addChild(statusRow);

    const nameBg = new Graphics();
    nameBg.eventMode = 'none';
    container.addChild(nameBg);
    const nameplate = new Text({ text: '', style: { ...NAME_STYLE } });
    nameplate.eventMode = 'none';
    container.addChild(nameplate);

    const actor: EnemyActor = {
      enemy, rosterIdx, wave, box, container, bg, art: null, rune, silhouette,
      nameplate, nameBg, rawName: this.nameOf(enemy), hpBar, statusRow, statuses: new Map(),
      hp: enemy.hpMax, hpMax: enemy.hpMax, revealed: !enemy.masked, dead: false,
      artLoaded: false, lane: 0, hidden: false,
    };
    this.actors[rosterIdx] = actor;
    if (enemy.instanceId) this.byInstance.set(enemy.instanceId, actor);
    this.layer.addChild(container);

    this.resolveArt(actor);
    this.applyRevealState(actor);
    this.redrawHp(actor);
    this.layoutName(actor);
  }

  private paintBg(bg: Graphics, box: { w: number; h: number }, packId: string | null): void {
    bg.clear();
    bg.roundRect(0, 0, box.w, box.h, 3).fill({ color: MJ.panel, alpha: 0.85 }).stroke({ color: MJ.borderLo, width: 1, alpha: 0.9 });
    // Subtle pack-grouping edge (structural, minimal).
    bg.rect(0, 0, 2, box.h).fill({ color: packTint(packId), alpha: 0.85 });
    bg.eventMode = 'none';
  }

  /** Resolve monster art through the art_urls chain; contain-fit into the box.
   * PHASE-C HOOK: intro/fade of the sprite lives here. */
  private resolveArt(actor: EnemyActor): void {
    const id = actor.enemy.id;
    const cached = getCachedMonsterTexture(id);
    if (cached) { this.placeArt(actor, cached); return; }
    if (cached === null) return; // known miss -> rune stays
    const gen = this.gen;
    void loadMonsterTexture(id).then((tex) => {
      if (tex && gen === this.gen && !actor.container.destroyed && this.actors[actor.rosterIdx] === actor) {
        this.placeArt(actor, tex);
      }
    });
  }

  private placeArt(actor: EnemyActor, tex: Texture): void {
    if (actor.art) { actor.art.destroy(); actor.art = null; }
    const { w, h } = actor.box;
    const scale = Math.min(w / tex.width, h / tex.height); // contain-fit, uniform (never stretch)
    const sprite = new Sprite(tex);
    sprite.eventMode = 'none';
    sprite.width = tex.width * scale;
    sprite.height = tex.height * scale;
    sprite.x = (w - sprite.width) / 2;
    sprite.y = (h - sprite.height) / 2;
    // insert above bg+silhouette, below hpBar/name
    actor.container.addChildAt(sprite, 2);
    actor.art = sprite;
    actor.artLoaded = true;
    actor.rune.visible = false;
    // REQ-0276 C5: art arrives with a 150ms alpha settle + one bone rim (the
    // manifestation moment) instead of a hard pop-in -- only when the actor
    // is actually showing it right now.
    if (this.fx && this.fx.animated && actor.revealed && !actor.dead && actor.container.visible) {
      this.fx.spriteIntro(sprite);
      this.fx.revealRim(this.field.x + actor.box.x, this.field.y + actor.box.y, actor.box.w, actor.box.h);
    }
    if (actor.dead) this.applyDeathVisual(actor);
    else this.applyRevealState(actor);
  }

  private applyRevealState(actor: EnemyActor): void {
    if (actor.revealed) {
      actor.silhouette.visible = false;
      actor.rune.visible = !actor.artLoaded;
      if (actor.art) actor.art.visible = true;
      actor.rawName = this.nameOf(actor.enemy);
    } else {
      actor.silhouette.visible = true;
      actor.rune.visible = false;
      if (actor.art) actor.art.visible = false;
      actor.rawName = '?';
    }
  }

  private redrawHp(actor: EnemyActor): void {
    const g = actor.hpBar;
    g.clear();
    if (actor.dead || !actor.revealed) { return; }
    const { w, h } = actor.box;
    const barW = w;
    const y = h + 1;
    const frac = actor.hpMax > 0 ? Math.max(0, Math.min(1, actor.hp / actor.hpMax)) : 0;
    g.roundRect(0, y, barW, HP_BAR_H, 1).fill({ color: MJ.void, alpha: 0.85 }).stroke({ color: MJ.borderLo, width: 1, alpha: 0.7 });
    if (frac > 0) g.roundRect(0, y, barW * frac, HP_BAR_H, 1).fill({ color: hpColor(frac), alpha: 0.95 });
    // 25%-notch markers (MJOLNIR). PHASE-C HOOK: notch emphasis / segmentation.
    for (const n of [0.25, 0.5, 0.75]) {
      g.rect(barW * n, y, 1, HP_BAR_H).fill({ color: MJ.void, alpha: 0.6 });
    }
  }

  private layoutName(actor: EnemyActor): void {
    const shown = actor.revealed ? actor.rawName : '?';
    actor.nameplate.text = truncateToFit(shown, Math.max(0, this.fieldW - actor.box.x));
    actor.nameplate.x = 0;
    actor.nameplate.y = actor.box.h + HP_BAR_H + 3;
    this.redrawNameBg(actor);
  }

  /** REQ-0276 C6: the nameplate's panel plate -- redrawn to the label's
   * current bounds; cleared while the label is hidden/empty. */
  private redrawNameBg(actor: EnemyActor): void {
    const g = actor.nameBg;
    g.clear();
    if (!actor.nameplate.visible || !actor.nameplate.text) return;
    const w = actor.nameplate.width + 4;
    const h = actor.nameplate.height + 2;
    g.roundRect(actor.nameplate.x - 2, actor.nameplate.y - 1, w, h, 2)
      .fill({ color: MJ.panel, alpha: 0.85 })
      .stroke({ color: MJ.borderLo, width: 1, alpha: 0.9 });
  }

  // ---- run-driven mutations -------------------------------------------------

  /** REQ-0276 B1: a hit attributed to a roster enemy (ray_hit/ray_aoe enemyIdx).
   * Reveals (first hit), depletes HP, and flips to the defeat state at <=0. */
  hit(rosterIdx: number, hpAfter?: number, amount?: number, silent = false): void {
    const actor = this.actors[rosterIdx];
    if (!actor) return;
    if (!actor.revealed) {
      actor.revealed = true;
      this.applyRevealState(actor);
      this.relayoutLabels();
      // REQ-0276 C5: reveal = one brief bone-white rim wipe, then settle.
      if (!silent && this.fx) {
        this.fx.revealRim(this.field.x + actor.box.x, this.field.y + actor.box.y, actor.box.w, actor.box.h);
      }
    }
    if (typeof hpAfter === 'number') actor.hp = Math.max(0, hpAfter);
    else if (typeof amount === 'number') actor.hp = Math.max(0, actor.hp - amount);
    if (actor.hp <= 0 && !actor.dead) this.kill(actor, silent);
    else this.redrawHp(actor);
  }

  reveal(rosterIdx: number): void {
    const actor = this.actors[rosterIdx];
    if (!actor || actor.revealed) return;
    actor.revealed = true;
    this.applyRevealState(actor);
    this.redrawHp(actor);
    this.layoutName(actor);
    this.relayoutLabels();
  }

  private kill(actor: EnemyActor, silent = false): void {
    actor.dead = true;
    this.redrawHp(actor);
    actor.nameplate.alpha = 0.4;
    actor.nameBg.alpha = 0.4;
    // REQ-0276 C5: a LIVE kill = short blood flash, then a ~400ms fade to
    // the corpse ghost. Corpse STATE (tint / hidden chips) applies up front,
    // so a fade cancelled by reset() can only leave an alpha -- which
    // reset() and any silent re-apply both settle.
    if (!silent && this.fx && this.fx.animated) {
      if (actor.art) actor.art.tint = MJ.bone3;
      actor.silhouette.visible = false;
      for (const chip of actor.statuses.values()) chip.text.visible = false;
      this.fx.deathFade(actor.container, this.field.x + actor.box.x, this.field.y + actor.box.y, actor.box.w, actor.box.h, 0.28);
    } else {
      this.applyDeathVisual(actor);
    }
  }

  /** PHASE-C HOOK: defeat styling (desaturate/fade + corpse ghost). Structural
   * now: dim the actor and drop the HP bar; pulses are stopped by the renderer's
   * ticker purge. */
  private applyDeathVisual(actor: EnemyActor): void {
    actor.container.alpha = 0.28;
    if (actor.art) actor.art.tint = MJ.bone3;
    actor.silhouette.visible = false;
    for (const chip of actor.statuses.values()) chip.text.visible = false;
  }

  /** REQ-0276 B2: status chip attached to a resolved enemy actor (dst matched to
   * instanceId). Player-side statuses (dst not an enemy instance) are left for
   * Phase C squad-box chips. PHASE-C HOOK: chip styling + real duration fade. */
  applyStatusByInstance(instanceId: string, status: string, n: number): void {
    const actor = this.byInstance.get(instanceId);
    if (!actor || actor.dead) return;
    let chip = actor.statuses.get(status);
    if (!chip) {
      // REQ-0276 C5: chip tinted by status class -- ember for burns, frost
      // for chills, bone-2 for the rest (the world's two voices; never gold).
      const kind = statusKind(status);
      const tint = kind === 'fire' ? MJ.ember : kind === 'frost' ? MJ.frost : MJ.bone2;
      const text = new Text({ text: statusGlyph(status), style: { fill: tint, fontSize: 9 } });
      text.eventMode = 'none';
      text.x = actor.statuses.size * 11;
      actor.statusRow.addChild(text);
      chip = { kind: status, text, ttl: 0 };
      actor.statuses.set(status, chip);
    }
    chip.ttl = Math.max(1, n | 0);
    chip.text.alpha = ttlAlpha(chip.ttl);
    chip.text.visible = true;
  }

  /** status_tick: refresh the chip and, when the tick carries hp_after for a
   * resolved enemy, keep the actor's HP bar honest. */
  statusTickByInstance(instanceId: string, status: string, hpAfter?: number, silent = false): void {
    const actor = this.byInstance.get(instanceId);
    if (!actor) return;
    const chip = actor.statuses.get(status);
    // REQ-0276 C5: each tick burns one unit of the chip's remaining ttl and
    // the chip fades with it (0.35 floor -- it recedes, never guess-vanishes).
    if (chip) {
      chip.ttl = Math.max(0, chip.ttl - 1);
      chip.text.alpha = ttlAlpha(chip.ttl);
    }
    if (typeof hpAfter === 'number') {
      actor.hp = Math.max(0, hpAfter);
      if (actor.hp <= 0 && !actor.dead) this.kill(actor, silent); else this.redrawHp(actor);
    }
  }

  /** heal_ally / lifesteal_heal target centroid, if it resolves to an enemy. */
  centroidOfInstance(instanceId: string): { x: number; y: number } | null {
    const actor = this.byInstance.get(instanceId);
    if (!actor) return null;
    return { x: this.field.x + actor.box.x + actor.box.w / 2, y: this.field.y + actor.box.y + actor.box.h / 2 };
  }

  /** Absolute (stage-space) centroid of a roster enemy's footprint, for placing
   * damage numbers at the ACTUAL hit location (REQ-0276 B2). */
  centroidOf(rosterIdx: number): { x: number; y: number } | null {
    const actor = this.actors[rosterIdx];
    if (!actor) return null;
    return { x: this.field.x + actor.box.x + actor.box.w / 2, y: this.field.y + actor.box.y + actor.box.h / 2 };
  }

  instanceIndex(instanceId: string): number | null {
    const a = this.byInstance.get(instanceId);
    return a ? a.rosterIdx : null;
  }

  // ---- waves ----------------------------------------------------------------

  /** encounter_start: pack/boss encounters advance the visible wave; gimic-only
   * encounters (trap/door/chest) do not. Non-active waves are hidden so packs
   * from later encounters never overlap the current fight. */
  onEncounterStart(kind: string): void {
    if (!PACK_KINDS.has(kind)) return;
    if (this.waveOrder.length === 0) return;
    this.activeWave = Math.min(this.packEncountersSeen, this.waveOrder.length - 1);
    this.packEncountersSeen++;
    this.showWave();
  }

  /** encounter_end: structural hook -- the current wave has resolved. Kept light
   * (the per-enemy defeat fade already handled deaths); Phase C may add a wave
   * clear/settle sweep here. */
  onEncounterEnd(): void {
    // no-op structural seam; wave advance happens on the next encounter_start.
  }

  private showWave(): void {
    for (const a of this.actors) {
      if (!a) continue;
      a.container.visible = a.wave === this.activeWave;
    }
    this.relayoutLabels();
  }

  // ---- label placement (REQ-0283: fixed anchors, non-spatial resolution) ----

  private relayoutLabels(): void {
    const visible = this.actors.filter((a) => a && a.container.visible);
    for (const a of visible) { a.lane = 0; a.hidden = false; a.nameplate.visible = true; }
    // (1) collapse duplicate texts: topmost-leftmost actor is the rep; the rest
    // keep their cell block + HP bar but hide their nameplate (non-spatial).
    const byText = new Map<string, EnemyActor[]>();
    for (const a of visible) {
      const t = a.revealed ? a.rawName : '?';
      const g = byText.get(t); if (g) g.push(a); else byText.set(t, [a]);
    }
    const reps: Array<{ actor: EnemyActor; shown: string }> = [];
    for (const [txt, group] of byText) {
      group.sort((x, y) => (x.box.y - y.box.y) || (x.box.x - y.box.x));
      for (let i = 1; i < group.length; i++) { group[i].nameplate.visible = false; group[i].hidden = true; }
      const rep = group[0]; rep.nameplate.visible = true;
      reps.push({ actor: rep, shown: group.length > 1 ? `${txt} x${group.length}` : txt });
    }
    // (2) FIXED anchor: each rep's nameplate sits directly under its footprint
    // bbox (box.h + HP bar + gap), truncated to the field's right edge. NEVER
    // moved -- no lane offset is ever applied (REQ-0283 cell fidelity).
    for (const { actor, shown } of reps) {
      actor.nameplate.text = truncateToFit(shown, Math.max(0, this.fieldW - actor.box.x));
      actor.nameplate.x = 0;
      actor.nameplate.y = actor.box.h + HP_BAR_H + 3;
    }
    // (3) non-spatial collision resolution: topmost-leftmost priority keeps its
    // full label; a later rep whose fixed-anchor box overlaps a kept one HIDES
    // (never moves). Deterministic -- ties break by (y, x).
    const shownReps = reps.filter((r) => r.actor.nameplate.visible);
    shownReps.sort((a, b) => (a.actor.box.y - b.actor.box.y) || (a.actor.box.x - b.actor.box.x));
    const kept: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const overlaps = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    for (const { actor } of shownReps) {
      const x = actor.box.x;
      const y = actor.box.y + actor.box.h + HP_BAR_H + 3;
      const b = { x1: x, y1: y, x2: x + actor.nameplate.width, y2: y + LANE_H };
      if (kept.some((pl) => overlaps(pl, b))) {
        actor.nameplate.visible = false; actor.hidden = true; actor.lane = -1;
      } else {
        kept.push(b); actor.nameplate.visible = true; actor.hidden = false; actor.lane = 0;
      }
    }
    // REQ-0276 C6: settle each nameplate's panel plate after resolution.
    for (const a of visible) this.redrawNameBg(a);
  }

  // ---- lifecycle / seams ----------------------------------------------------

  /** Reset per-run dynamic state to the mounted baseline WITHOUT destroying the
   * actors -- used on a replay backward-seek (renderer reset() + silent replay).
   * The structural actor layer persists across a seek; only HP/reveal/wave/death
   * rewind. */
  reset(): void {
    this.packEncountersSeen = 0;
    this.activeWave = 0;
    for (const a of this.actors) {
      if (!a) continue;
      a.hp = a.hpMax;
      a.dead = false;
      a.revealed = !a.enemy.masked;
      a.container.alpha = 1;
      a.nameplate.alpha = 1;
      a.nameBg.alpha = 1;
      if (a.art) { a.art.tint = 0xffffff; a.art.alpha = 1; }
      for (const chip of a.statuses.values()) chip.text.destroy();
      a.statuses.clear();
      a.statusRow.removeChildren();
      this.applyRevealState(a);
      this.redrawHp(a);
      this.layoutName(a);
    }
    this.showWave();
  }

  /** Destroy the whole actor layer (new roster / retarget). */
  clear(): void {
    this.gen++;
    for (const a of this.actors) { if (a && !a.container.destroyed) { a.container.destroy({ children: true }); } }
    this.actors = [];
    this.byInstance.clear();
    this.waveOrder = [];
    this.packEncountersSeen = 0;
    this.activeWave = 0;
  }

  getActors(): EnemyActorDebug[] {
    const out: EnemyActorDebug[] = [];
    for (const a of this.actors) {
      if (!a) continue;
      out.push({
        id: a.enemy.id, instanceId: a.enemy.instanceId || '', hp: a.hp, hpMax: a.hpMax,
        revealed: a.revealed, dead: a.dead, artLoaded: a.artLoaded, wave: a.wave,
        cells: Array.isArray(a.enemy.fieldCells) ? a.enemy.fieldCells : [],
      });
    }
    return out;
  }

  /** REQ-0045(f) e2e seam -- honest bounds for the actor nameplates (x + width
   * <= FIELD_W). Only visible, non-hidden nameplates count. */
  getMarkerBounds(): Array<{ x: number; labelWidth: number; labelText: string; hidden: boolean; lane: number }> {
    const out: Array<{ x: number; labelWidth: number; labelText: string; hidden: boolean; lane: number }> = [];
    for (const a of this.actors) {
      if (!a || !a.container.visible) continue;
      out.push({ x: a.box.x, labelWidth: a.nameplate.visible ? a.nameplate.width : 0, labelText: a.nameplate.text, hidden: !!a.hidden, lane: a.lane });
    }
    return out;
  }
}
