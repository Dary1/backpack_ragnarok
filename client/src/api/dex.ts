// client/src/api/dex.ts -- REQ-0145b (ca): Dex-facing endpoints.
//
// REQ-0182b removed `putAdminItem` (the REQ-0035/0038 admin item-edit PUT that
// DexAdmin saved through). Content is edited through the ledger now — the
// contentadmin PO/SI editor (REQ-0182a) — because a live-file write no longer
// reaches the served payload, the gacha roll or the simulation for any adopted
// entity. The server-side route still exists and 409s such an id
// (server/routes/admin.cjs); nothing in the client calls it.
//
// The REQ-0052 dex card DTO fetch below is unrelated and stays.
import { scheduleJSON } from './http';
import type { ApiDexCardDto } from '../../../shared/dto';

// ---- REQ-0052: Dex Card API ----

/** GET /api/dex/card/:kind/:id -- render-ready card DTO (server/routes/
 * dex.cjs) for the Dex subwindow (dex/DexCardWindow.tsx) and any other
 * card consumer. Public, no auth required (content is non-secret, same
 * posture as fetchContent()). Throws ApiError(404) for an unknown
 * kind/id ('unit'/'monster' joined the allowlist in REQ-0227 -- 'bp' is
 * still not servable here, see dex.cjs's module comment). */
export function fetchDexCard(kind: 'item' | 'si' | 'tm' | 'unit' | 'monster', id: string): Promise<{ ok: true; card: ApiDexCardDto }> {
  return scheduleJSON(`/api/dex/card/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
}
