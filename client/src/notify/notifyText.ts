// client/src/notify/notifyText.ts -- REQ-0368: ONE place that turns a feed
// entry into the line a player reads. The bell list and the login digest
// both go through it, so the two surfaces can never describe the same event
// differently, and every string lands in the chrome dictionary (i18n/
// notify.ts, en/ja parity gated by i18n.ts) rather than being assembled
// inline at a render site.
import { t } from '../i18n';
import type { Locale } from '../store';
import type { ApiNotification } from '../../../shared/dto';

/** The item name to show for a market_settled entry: the ja name when the
 * UI is in ja and the content actually carries one, else the en name --
 * the same locale rule market/BuyPane.tsx and MinePane.tsx already use for
 * a listing card. */
function marketItemName(locale: Locale, n: ApiNotification): string {
  const en = n.payload.itemName ?? n.payload.itemId ?? '';
  const ja = n.payload.itemNameJa;
  return locale === 'ja' && ja ? ja : en;
}

/** The one-line description of an entry. Returns null for a kind this
 * client does not know -- a feed written by a NEWER server must degrade to
 * "not shown" rather than rendering a broken row. */
export function notificationLine(locale: Locale, n: ApiNotification): string | null {
  switch (n.kind) {
    case 'troop_disbanded':
      return n.payload.reason === 'wipe_streak'
        ? t(locale, 'notify.troopDisbandedWipeStreak')
        : n.attackLv !== null
          ? t(locale, 'notify.troopDisbanded', { level: String(n.attackLv) })
          : t(locale, 'notify.troopDisbandedNoLevel');
    case 'room_halted':
      return t(locale, 'notify.roomHalted');
    case 'run_settled': {
      const loot = String(n.payload.lootCount ?? 0);
      if (n.payload.result === 'victory') return t(locale, 'notify.runSettledVictory', { loot });
      if (n.payload.result === 'wipe') return t(locale, 'notify.runSettledWipe');
      return t(locale, 'notify.runSettledIncomplete', { loot });
    }
    case 'market_settled':
      return t(locale, 'notify.marketSettled', {
        item: marketItemName(locale, n),
        net: String(n.payload.net ?? 0),
        burn: String(n.payload.burn ?? 0),
      });
    case 'warehouse_expiring':
      return t(locale, 'notify.warehouseExpiring', { count: String(n.payload.count ?? 0) });
    case 'warehouse_expired':
      return t(locale, 'notify.warehouseExpired', { count: String(n.payload.count ?? 0) });
    default:
      return null;
  }
}

/** A decorative rune per kind (aria-hidden at the render site). Doubles as
 * the non-colour cue REQ-0143 asks for: a row is identifiable by its glyph
 * and its text, never by colour alone. Runes are drawn from the same set
 * the nav rail uses for the matching hall (ᚱ expedition, ᚠ market,
 * ᚷ warehouse) so the bell reads as a pointer to a place. */
export function notificationRune(kind: ApiNotification['kind']): string {
  switch (kind) {
    case 'run_settled': return 'ᚱ';
    case 'market_settled': return 'ᚠ';
    case 'warehouse_expiring':
    case 'warehouse_expired': return 'ᚷ';
    default: return 'ᛉ'; // algiz -- the two alarm kinds (disband / halt)
  }
}
