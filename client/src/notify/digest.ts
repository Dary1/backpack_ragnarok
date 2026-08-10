// client/src/notify/digest.ts -- REQ-0368: the PURE derivations every
// notification surface shares, kept out of the provider module so the bell,
// the nav badges and the login digest can never disagree about what a kind
// means -- and so the aggregation is testable without mounting React.
import type { ApiNotification } from '../../../shared/dto';

/** Kinds the LOGIN DIGEST summarises. The two REQ-0327/0357 toast kinds are
 * deliberately absent: they are already pushed as toasts and are single
 * events, not "what happened while you were away" aggregate material. */
export const DIGEST_KINDS: ReadonlySet<string> = new Set([
  'run_settled', 'market_settled', 'warehouse_expired', 'warehouse_expiring',
]);

export interface NotificationDigest {
  wins: number;
  losses: number;
  spoils: number;
  marketNet: number;
  marketSales: number;
  expired: number;
  expiring: number;
  /** The entries this digest was built from -- acked together on dismiss. */
  ids: number[];
}

/** Pure aggregation of the notification rows (REQ-0368 spec item 4). */
export function buildDigest(entries: readonly ApiNotification[]): NotificationDigest {
  const d: NotificationDigest = { wins: 0, losses: 0, spoils: 0, marketNet: 0, marketSales: 0, expired: 0, expiring: 0, ids: [] };
  for (const n of entries) {
    if (!DIGEST_KINDS.has(n.kind)) continue;
    d.ids.push(n.id);
    if (n.kind === 'run_settled') {
      if (n.payload.result === 'victory') d.wins += 1;
      else d.losses += 1;
      d.spoils += n.payload.lootCount ?? 0;
    } else if (n.kind === 'market_settled') {
      d.marketSales += 1;
      d.marketNet += n.payload.net ?? 0;
    } else if (n.kind === 'warehouse_expired') {
      d.expired += n.payload.count ?? 0;
    } else if (n.kind === 'warehouse_expiring') {
      d.expiring += n.payload.count ?? 0;
    }
  }
  return d;
}

/** REQ-0368 spec item 3: unseen counts per NAV RAIL destination. A kind maps
 * to a hall only where opening that hall is the actual next action --
 * warehouse_expired is NOT counted, because the items are already gone and
 * there is nothing to do there (it reports through the bell and the digest
 * instead). */
export function navBadgeCounts(entries: readonly ApiNotification[]): { schedule: number; warehouse: number } {
  let schedule = 0;
  let warehouse = 0;
  for (const n of entries) {
    if (n.kind === 'run_settled') schedule += 1;
    else if (n.kind === 'warehouse_expiring') warehouse += n.payload.count ?? 0;
  }
  return { schedule, warehouse };
}
