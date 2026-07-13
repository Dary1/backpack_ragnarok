// client/src/api/warehouse.ts -- REQ-0145b (ca): Warehouse endpoints --
// list, the REQ-0041 two-phase claim, and the dev grant (extracted
// VERBATIM from the old flat api.ts).
import { scheduleJSON } from './http';
import type { ApiWarehouseItem } from '../../../shared/dto';

// ---- REQ-0036 P1-C / REQ-0041: Warehouse client API ----

/** GET /api/warehouse -- lists the caller's own warehouse items (server
 * purges expired rows first). */
export function fetchWarehouse(): Promise<{ ok: true; items: ApiWarehouseItem[] }> {
  return scheduleJSON('/api/warehouse');
}

/** POST /api/warehouse/claim {itemUid} -- REQ-0041 two-phase claim (bug
 * #3 fix). No longer places anything server-side: marks the warehouse
 * row 'claiming' and returns the CONTENT def id (`itemId`) plus the
 * row's own `itemUid` (which the CALLER reuses AS the new inventory
 * PO/SI's own uid -- see server/schedule.cjs's claimWarehouseItem doc
 * for why this makes server-side finalization exact). The caller
 * (WarehouseTab.tsx) is responsible for running the engine's own
 * first-fit placement and then letting the normal auto-save
 * (notifyStateChanged()) persist it -- this function's job ends at
 * "the row is now claiming, here's what it is". Throws ApiError(409)
 * if the row is already claiming/gone, ApiError(404) if unknown/expired. */
export function claimWarehouseItem(itemUid: string): Promise<{ ok: true; itemUid: string; itemId: string; kind?: 'tm'; qty?: number }> {
  return scheduleJSON('/api/warehouse/claim', { method: 'POST', body: JSON.stringify({ itemUid }) });
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
