// REQ-0240 (03 spec ss6.3 / ss9): event -> localized feed sentence + class
// icon glyph + tone/category. Replaces/absorbs Monitor's old humanizeEvent for
// the humanized feed; a raw fallback line keeps an unknown ev type visible.
import { t, type TranslationKey } from '../../i18n';
import type { Locale } from '../../store';
import type { ApiRunEvent } from '../../api';

export type FeedTone = 'dmgDeal' | 'dmgTake' | 'loot' | 'gimic' | 'system' | 'heal';
export type FeedCategory = 'all' | 'damage' | 'loot' | 'gimic';

export interface FeedRow {
  index: number;
  text: string;
  icon: string; // class glyph (art thumbs are a future enhancement; glyph is the spec fallback)
  tone: FeedTone;
  category: Exclude<FeedCategory, 'all'> | 'system';
  ptMs: number;
}

const KIND_KEYS: Record<string, TranslationKey> = {
  pack: 'schedule.monitor.kind.pack', boss: 'schedule.monitor.kind.boss',
  trap: 'schedule.monitor.kind.trap', chest: 'schedule.monitor.kind.chest', door: 'schedule.monitor.kind.door',
};
const SKILL_KEYS: Record<string, TranslationKey> = {
  strike: 'schedule.monitor.skill.strike', multi_strike: 'schedule.monitor.skill.multi_strike',
};
const EDGE_KEYS: Record<string, TranslationKey> = {
  top: 'schedule.monitor.edge.top', bottom: 'schedule.monitor.edge.bottom',
  left: 'schedule.monitor.edge.left', right: 'schedule.monitor.edge.right',
};
function tok(locale: Locale, map: Record<string, TranslationKey>, token: unknown): string {
  const k = typeof token === 'string' ? map[token] : undefined;
  return k ? t(locale, k) : String(token ?? '?');
}
function num(v: unknown): string { return typeof v === 'number' ? String(Math.round(v)) : '?'; }

export interface FeedCtx {
  dungeonName: string;
  /** enemy id -> localized display name (from roster, revealed on first-seen). */
  enemyName: (id: string) => string;
}

/** Map one released event to a feed row, or null if it should not surface
 * (travel/step frames, hidden coalesce members, pure progress ticks). */
export function feedRow(locale: Locale, ev: ApiRunEvent, index: number, ctx: FeedCtx): FeedRow | null {
  if (ev.pcoalesceHidden) return null;
  const ptMs = typeof ev.pt === 'number' ? ev.pt : (typeof ev.t === 'number' ? ev.t * 1000 : 0);
  const mk = (key: TranslationKey, params: Record<string, string>, icon: string, tone: FeedTone, category: FeedRow['category']): FeedRow =>
    ({ index, text: t(locale, key, params), icon, tone, category, ptMs });
  const dst = (v: unknown): string => (typeof v === 'string' ? ctx.enemyName(v) : '?');
  switch (ev.ev) {
    case 'encounter_start':
      return ev.kind === 'boss'
        ? mk('schedule.monitor.feed.encounterBoss', { name: tok(locale, KIND_KEYS, ev.kind) }, '👑', 'system', 'system')
        : mk('schedule.monitor.feed.encounter', { name: tok(locale, KIND_KEYS, ev.kind) }, '⚔', 'system', 'system');
    case 'telegraph':
      return mk('schedule.monitor.feed.telegraph', { src: String(ev.src ?? '?'), skill: tok(locale, SKILL_KEYS, ev.skill), edge: tok(locale, EDGE_KEYS, ev.edge) }, '◔', 'system', 'system');
    case 'ray_hit': {
      const isPlayerTaking = ev.field === 'player';
      if (ev.pcoalesce) {
        return mk('schedule.monitor.feed.multiHit', { src: String(ev.src ?? '?'), dst: dst(ev.dst), n: String(ev.pcoalesce.hits), amount: String(ev.pcoalesce.amount) }, '✷', isPlayerTaking ? 'dmgTake' : 'dmgDeal', 'damage');
      }
      return mk('schedule.monitor.feed.hit', { src: String(ev.src ?? '?'), dst: dst(ev.dst), amount: num(ev.amount) }, '✦', isPlayerTaking ? 'dmgTake' : 'dmgDeal', 'damage');
    }
    case 'ray_aoe':
    case 'ray_hit_all': {
      const hits = Array.isArray(ev.hits) ? ev.hits as Array<{ amount?: number }> : [];
      const total = hits.reduce((s, h) => s + (typeof h.amount === 'number' ? h.amount : 0), 0);
      return mk('schedule.monitor.feed.aoe', { n: String(hits.length), amount: String(Math.round(total)) }, '✸', ev.field === 'player' ? 'dmgTake' : 'dmgDeal', 'damage');
    }
    case 'reflect_damage':
      return mk('schedule.monitor.feed.reflect', { dst: dst(ev.dst), amount: num(ev.amount) }, '⟲', 'dmgDeal', 'damage');
    case 'att_reveal': {
      const kind = ev.kind === 'chest' ? 'chestFound' : ev.kind === 'door' ? 'doorFound' : 'trapFound';
      const glyph = ev.kind === 'chest' ? 'ᚷ' : ev.kind === 'door' ? 'ᛞ' : 'ᚦ';
      return mk(('schedule.monitor.feed.' + kind) as TranslationKey, {}, glyph, 'gimic', 'gimic');
    }
    case 'att_disarm':
      return ev.reward
        ? mk('schedule.monitor.feed.trapDisarmedReward', { reward: String(ev.reward) }, '✓', 'gimic', 'gimic')
        : mk('schedule.monitor.feed.trapDisarmed', {}, '✓', 'gimic', 'gimic');
    case 'att_open':
      return ev.shortcut
        ? mk('schedule.monitor.feed.doorOpened', {}, '✦', 'gimic', 'gimic')
        : mk('schedule.monitor.feed.chestOpened', { reward: String(ev.reward ?? '') }, '✦', 'loot', 'loot');
    case 'att_lost':
      return mk('schedule.monitor.feed.gimicLost', {}, '✕', 'gimic', 'gimic');
    case 'att_fire':
      return mk('schedule.monitor.feed.trapFired', {}, '💥', 'dmgTake', 'gimic');
    case 'shortcut':
      return mk('schedule.monitor.feed.shortcut', { pct: num(ev.jump_pct) }, '✦', 'system', 'system');
    case 'run_end':
      return ev.result === 'wipe'
        ? mk('schedule.monitor.feed.runEnd.wipe', {}, '☠', 'dmgTake', 'system')
        : mk('schedule.monitor.feed.runEnd.victory', {}, '★', 'loot', 'system');
    default:
      return null; // step/fire/bounce/progress/link internals do not get their own feed line
  }
}
