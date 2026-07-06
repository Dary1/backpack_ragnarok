// client/src/ragnarok/ragnarokShared.tsx -- REQ-0066. Small shared bits
// for the Hall of Ragnarok screen: the valknut glyph (the mock's #vkn
// symbol -- the devotion/einherjar badge, used ONLY in this context per
// the mock's own comment), tier label lookup, and formatting helpers.
import type { Locale } from '../store';
import { t } from '../i18n';
import type { ApiRagnarokTier } from '../api';

/** The valknut (three interlaced triangles) -- the devotion badge from
 * web/redesign/ragnarok.html's inline <symbol id="vkn">. Rendered inline
 * (not via <use href>) so it needs no page-level <defs>. */
export function Valknut({ size = 34, className }: { size?: number; className?: string }) {
  const h = Math.round((size * 30) / 34);
  return (
    <svg
      className={className}
      width={size}
      height={h}
      viewBox="0 0 36 31"
      fill="none"
      stroke="#C9A959"
      strokeWidth={1.4}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 2.5 L27.6 19 L8.4 19 Z" />
      <path d="M12.9 11.5 L22.5 28 L3.3 28 Z" />
      <path d="M23.1 11.5 L32.7 28 L13.5 28 Z" />
    </svg>
  );
}

/** The mock's tablet header rune. */
export const RAGNAROK_RUNE = 'ᛏ';

/** Placeholder crest asset (the DTO's `emblem` is 'emblem_horn3' until a
 * real emblem system ships -- ORDER_EMBLEM_PLACEHOLDER). Served from the
 * redesign asset dir the same way the mock references it. */
export function emblemSrc(_emblem: string): string {
  // The redesign mock's crest lives at assets/emblem_horn3.png; the built
  // client serves the redesign assets under /redesign/assets (same origin
  // the dev server exposes them from). A single placeholder today.
  return '/redesign/assets/emblem_horn3.png';
}

/** Localized tier label: JA shows the mock's 奴僕/自由民/族長/選定者/神域
 * word; EN shows the runic tier name. Includes VALHALLA (client-side
 * only -- the server never assigns it, but the chip row renders it). */
export function tierLabel(locale: Locale, tier: ApiRagnarokTier | 'VALHALLA'): string {
  const en = t(locale, `ragnarok.tier.${tier}` as never);
  if (locale === 'ja') {
    const ja = t(locale, `ragnarok.tier.${tier}.ja` as never);
    return `${ja} ${en}`;
  }
  return en;
}

/** All tiers the chip row renders, in ladder order (VALHALLA last --
 * horizon beyond the server ladder). */
export const TIER_LADDER: Array<ApiRagnarokTier | 'VALHALLA'> = ['THRALL', 'KARL', 'JARL', 'EINHERJAR', 'VALHALLA'];

/** Formats an integer with thousands separators (matches the mock's
 * .tnum readouts). */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

/** A short human date for "serving since" / einherjar devotedAt lines.
 * Locale-aware; falls back to the raw ISO on a parse failure. */
export function fmtDate(locale: Locale, iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Date(ms).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
