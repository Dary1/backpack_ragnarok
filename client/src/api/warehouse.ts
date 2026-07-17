// client/src/api/warehouse.ts -- REQ-0145b (ca): Warehouse endpoints --
// list, the REQ-0041 two-phase claim, and the dev grant (extracted
// VERBATIM from the old flat api.ts).
import { scheduleJSON } from './http';
import type { ApiWarehouseBp, ApiWarehouseItem } from '../../../shared/dto';
import type { FitSpot } from '../lib/placement'; // REQ-0215: the claim carries the client's own fit result

// ---- REQ-0036 P1-C / REQ-0041: Warehouse client API ----

/** GET /api/warehouse -- lists the caller's own warehouse items (server
 * purges expired rows first). */
export function fetchWarehouse(): Promise<{ ok: true; items: ApiWarehouseItem[] }> {
  return scheduleJSON('/api/warehouse');
}

/** POST /api/warehouse/claim {itemUid, page, position} -- REQ-0041's two-phase
 * claim (bug #3 fix), with REQ-0215's fit contract.
 *
 * Still places nothing server-side: it marks the row 'claiming' and returns the
 * content def id (`itemId`) plus the row's own `itemUid`, which the CALLER reuses
 * AS the new inventory record's uid (that reuse is what makes the server's
 * finalize-on-next-PUT an exact uid-membership check -- see
 * server/services/warehouse.cjs's claimWarehouseItem doc).
 *
 * REQ-0215: `spot` is REQUIRED and is the caller's OWN fit search result (the user
 * specified that the search is the client's job). The server tests THAT ONE SPOT
 * against the last-saved canvas and rejects the claim if the engine refuses it --
 * it never searches, and there is no fallback for an omitted spot. Two obligations
 * follow for the caller:
 *   1. flushAutoSave() BEFORE calling, or the server judges the spot against a
 *      stale board (it can only see the last-SAVED canvas -- design rule 5).
 *   2. place at the RETURNED page/position (echoed back verbatim), not at a
 *      freshly re-searched one.
 * Throws ApiError(409, reason:'no_space') if the spot is not legal, ApiError(409)
 * if the row is already claiming, ApiError(404) if unknown/expired. */
export function claimWarehouseItem(
  itemUid: string,
  spot: FitSpot
): Promise<{ ok: true; itemUid: string; itemId: string; kind?: 'tm' | 'bp'; qty?: number; bp?: ApiWarehouseBp; page: number; position: [number, number] }> {
  return scheduleJSON('/api/warehouse/claim', {
    method: 'POST',
    body: JSON.stringify({ itemUid, page: spot.page, position: spot.position }),
  });
}

/** POST /api/admin/warehouse/grant {itemId} -- REQ-0041 feedback 1 (dev
 * grant). item_admin only (403 otherwise, same auth-gate convention as
 * putAdminItem above). Inserts a warehouse row for the CALLER (the
 * resolved item_admin themselves) referencing content item `itemId`,
 * subject to the same cap/TTL rules as any other warehouse insertion.
 * 400 if `itemId` isn't a known content item id. */
export function grantWarehouseItem(itemId: string): Promise<{ ok: true; item: ApiWarehouseItem }> {
  return scheduleJSON('/api/admin/warehouse/grant', { method: 'POST', body: JSON.stringify({ itemId }) });
}
