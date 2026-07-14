// client/src/lib/time.ts -- REQ-0145b (cb): canonical home of the
// shared time-formatting helpers previously living as page-local copies.
//
// formatCountdown itself (minute/second countdown text) still lives in
// schedule/RoomCard.tsx -- that file is owned by the in-flight room-UI
// REQs (REQ-0098/0100, see REQ-0145b section 2) and is imported here
// AS-IS rather than moved. ADOPTION NOTE for those REQs' owners: when
// RoomCard is next rewritten, move formatCountdown into this module and
// re-export it from RoomCard (or update its consumers) so the whole
// time-formatting cluster lives in one place.
import { formatCountdown } from '../schedule/RoomCard';
import type { Locale } from '../store';

/** REQ-0071: the mock ctrl bar's wall-clock readout -- mm:ss, tabular
 * digits via the theme's .tnum. Distinct from formatCountdown (kept
 * as-is for countdown TEXT lines): this one is a fixed-width clock face,
 * not a sentence fragment.
 *
 * ADOPTION NOTE (REQ-0099): schedule/Monitor.tsx keeps its own local
 * copy of this function (that file is excluded from REQ-0145b, owned by
 * the settled-run-replay rework) -- adopt this canonical import when
 * Monitor is rewritten. */
export function formatClock(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Day-aware countdown for the Warehouse's 7-day TTL. RoomCard's
 * formatCountdown is minute/second only (fine for a run's short
 * countdown), so a multi-day remaining duration would render as e.g.
 * "10080m 0s" -- a real display bug for this view. Tiers down to
 * days/hours/minutes and defers to formatCountdown for the final
 * sub-1-hour stretch (so the last hour still reads "12m 3s" exactly as
 * the rest of the app does). */
export function formatWarehouseCountdown(ms: number, locale: Locale): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  // REQ-0168 U13(c): formatCountdown is now locale-aware; thread the locale
  // through (and localize this helper's own d/h/m suffixes in JA to match).
  if (locale === 'ja') {
    if (days > 0) return hours > 0 ? `${days}日${hours}時間` : `${days}日`;
    if (hours > 0) return `${hours}時間${mins}分`;
    return formatCountdown(ms, locale);
  }
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return formatCountdown(ms, locale);
}
