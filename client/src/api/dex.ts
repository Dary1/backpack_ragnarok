// client/src/api/dex.ts -- REQ-0145b (ca): Dex-facing endpoints -- the
// REQ-0035/0038 admin item-edit PUT (DexAdmin's save) and the REQ-0052
// dex card DTO fetch (extracted VERBATIM from the old flat api.ts).
import { authHeaders, scheduleJSON, ApiError } from './http';
import type { AdminPutError, AdminPutResult, ApiDexCardDto } from '../../../shared/dto';

// ---- REQ-0035: admin item-edit endpoint (DexAdmin save path) ----

export async function putAdminItem(
  id: string,
  body: Record<string, unknown>
): Promise<AdminPutResult> {
  const res = await fetch(`/api/admin/item/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: AdminPutResult | AdminPutError | null = null;
  try {
    parsed = JSON.parse(text) as AdminPutResult | AdminPutError;
  } catch (e) {
    parsed = null;
  }
  if (!res.ok) {
    const message = parsed && 'error' in parsed && parsed.error ? parsed.error : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return parsed as AdminPutResult;
}

// ---- REQ-0052: Dex Card API ----

/** GET /api/dex/card/:kind/:id -- render-ready card DTO (server/routes/
 * dex.cjs) for the Dex subwindow (dex/DexCardWindow.tsx) and any other
 * card consumer. Public, no auth required (content is non-secret, same
 * posture as fetchContent()). Throws ApiError(404) for an unknown
 * kind/id (kind must be one of 'item'|'si'|'tm' -- 'bp' is not servable
 * here yet, see dex.cjs's module comment). */
export function fetchDexCard(kind: 'item' | 'si' | 'tm', id: string): Promise<{ ok: true; card: ApiDexCardDto }> {
  return scheduleJSON(`/api/dex/card/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
}
