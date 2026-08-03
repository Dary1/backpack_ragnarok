// client/src/lib/itemContent.ts -- REQ-0145b (cb): canonical home of the
// itemId -> content-entry resolution helpers previously duplicated
// across pages (localizedItemName lived in both warehouse/
// WarehousePage.tsx and schedule/Monitor.tsx; contentEntryFor/
// rewardVisual followed the same lookup order in both).
//
// ADOPTION NOTE (REQ-0099): schedule/Monitor.tsx keeps its own local
// copies of localizedItemName / rewardVisual / formatClock (that file is
// excluded from REQ-0145b, owned by the settled-run-replay rework) --
// adopt these canonical imports when Monitor is rewritten. NB Monitor's
// local localizedItemName predates the REQ-0072 fix below and does NOT
// resolve content.tms ids; this canonical version does.
import type { ApiContentPayload, ApiWarehouseItem } from '../api';
import { iconDataUrl } from '../dex/dexIcons';
import type { Locale } from '../store';

/** itemId -> localized display name, falling back to the raw id if
 * content hasn't loaded yet or the id is unrecognized.
 * REQ-0072: TM ids (kind:'tm' rows, e.g. LRDST) live in content.tms,
 * which this lookup used to miss entirely -- a TM row rendered as its
 * raw id. Checked last, same order contentEntryFor uses. */
export function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId] ?? content?.sis[itemId] ?? content?.tms[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}

/* REQ-0310: itemKindOf moved to shared/player_actions.mjs -- the warehouse
 * claim transition that is its only real consumer now lives there, and a
 * second client (REQ-0314) needs it. Import it from shared/, not from here. */

/** Resolves the content entry (for its rarity + icon) for a warehouse
 * row of a given kind. TM stacks live in content.tms; plain PO/SI items
 * live in content.items/content.sis (checked in that order, mirroring
 * localizedItemName/itemKindOf above). Returns null when content hasn't
 * loaded yet or the id resolves against no map (defensive -- the row
 * simply renders without an icon/rarity in that case). */
export function contentEntryFor(content: ApiContentPayload | null, kind: 'po' | 'si' | 'tm', itemId: string): { rarity: string; icon: string } | null {
  if (!content) return null;
  if (kind === 'tm') return content.tms[itemId] ?? null;
  return content.items[itemId] ?? content.sis[itemId] ?? null;
}

/** REQ-0071: icon + rarity for a reward row -- the SAME content-map
 * resolution contentEntryFor uses (TM stacks live in content.tms; plain
 * PO/SI items in content.items/content.sis), degrading to "no icon, no
 * tint" while content is still loading or for an unrecognized id. */
export function rewardVisual(content: ApiContentPayload | null, item: ApiWarehouseItem): { icon: string | null; rarity: string | null } {
  if (!content) return { icon: null, rarity: null };
  const entry = item.kind === 'tm' ? content.tms[item.itemId] : content.items[item.itemId] ?? content.sis[item.itemId];
  if (!entry) return { icon: null, rarity: null };
  return { icon: iconDataUrl(entry.icon), rarity: entry.rarity ?? null };
}
