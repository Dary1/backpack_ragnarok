// client/src/lib/contentName.ts -- REQ-0239: shared content-name localizer.
// Relocated from schedule/CreateRoomForm.tsx (removed by the sortie-page
// redesign) so every consumer (SchedulePage, SealPanel, WarehousePage, the new
// sortie components) shares ONE implementation -- design 01 sec 4 ("moved to a
// shared client/src/lib/contentName.ts ... do not duplicate").
import type { Locale } from '../store';

/** The display name for a content entry in the caller's locale: the JA i18n
 * name when locale==='ja' and present, else the entry's default (EN) name. */
export function localizedName(
  locale: Locale,
  entry: { id: string; name: string; i18n?: Record<string, { name?: string }> },
): string {
  if (locale === 'ja' && entry.i18n?.ja?.name) return entry.i18n.ja.name;
  return entry.name;
}
