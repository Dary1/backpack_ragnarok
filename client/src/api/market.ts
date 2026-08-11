// client/src/api/market.ts -- REQ-0145b (ca): Market endpoints
// (extracted VERBATIM from the old flat api.ts). newIdemKey stays
// module-private, exactly as it was file-private before.
import { scheduleJSON } from './http';
import type { ApiMarketBuyResponse, ApiMarketCreateListingRequest, ApiMarketDexInfoResponse, ApiMarketFurnaceResponse, ApiMarketListingResponse, ApiMarketListingsResponse, ApiMarketPrice } from '../../../shared/dto';

// ---- REQ-0064: Market (交易の火床 / Hearth of Barter) ----
// Client surface for server/routes/market.cjs. Shapes are EXACTLY
// shared/dto.ts's ApiMarket* (the wire contract). All four mutating
// helpers send an OPTIONAL Idempotency-Key header (server route doc:
// replays return the ORIGINAL outcome with {replayed:true}); we mint a
// fresh key per call via newIdemKey() so a network retry of the SAME
// logical action de-dupes server-side instead of double-settling. This
// is the first client use of that header -- prior mutations relied on
// the server's state-machine idempotency (double-buy -> 409
// already_settled) and still do when no key is sent, so this is purely
// additive hardening, matching the route's documented posture.

/** A fresh idempotency key. Prefers crypto.randomUUID() (present in
 * every browser this app targets + the E2E Chromium); falls back to a
 * timestamp+random string in the (test/SSR) case where crypto is absent,
 * so the header is always populated. */
function newIdemKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) {
    /* fall through to the manual key */
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** GET /api/market/listings?filter=&q= -- browse. Default (no filter):
 * every active + suspended listing market-wide. filter='mine': the
 * caller's OWN listings in every state (tag/q ignored server-side).
 * Any other filter value matches item tags[]/rarity case-insensitively;
 * q matches a Dex No. ("61" / "No.061") or an EN/JA name substring. */
export function fetchMarketListings(opts?: { filter?: string; q?: string }): Promise<ApiMarketListingsResponse> {
  const params = new URLSearchParams();
  if (opts?.filter) params.set('filter', opts.filter);
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString();
  return scheduleJSON<ApiMarketListingsResponse>(`/api/market/listings${qs ? `?${qs}` : ''}`);
}

/** REQ-0374: GET /api/market/dex/:itemId -- the per-item settled-price anchor
 * + on-hearth listing count the Dex detail's market block renders. Market-wide
 * (nothing here is scoped to the caller), token-gated like the rest of this
 * family. A rejection is NOT fatal to the Dex page: the block keeps the honest
 * empty state it has rendered since REQ-0075 (see dex/DexMarketBlock.tsx). */
export function fetchMarketDexInfo(itemId: string): Promise<ApiMarketDexInfoResponse> {
  return scheduleJSON<ApiMarketDexInfoResponse>(`/api/market/dex/${encodeURIComponent(itemId)}`);
}

/** POST /api/market/listings {itemUid, price:{tm,qty}} -- list one of
 * the caller's OWN eligible inventory POs. price.tm MUST equal the
 * market TM id (the response's `tm`, 'lrdst' today); qty an integer in
 * [1,999]. Throws ApiError(409 reason:'deployed'|'already_listed') /
 * ApiError(400) / ApiError(404). */
export function createMarketListing(body: ApiMarketCreateListingRequest): Promise<ApiMarketListingResponse> {
  return scheduleJSON<ApiMarketListingResponse>('/api/market/listings', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdemKey() },
    body: JSON.stringify(body),
  });
}

/** POST /api/market/listings/:id/withdraw -- owner-only, free (no burn).
 * Throws ApiError(404) if the listing isn't the caller's (no-leak house
 * pattern: a foreign/unknown id is a 404, never a 403), ApiError(409
 * reason:'not_active') on a terminal-state listing. */
export function withdrawMarketListing(listingId: string): Promise<ApiMarketListingResponse> {
  return scheduleJSON<ApiMarketListingResponse>(`/api/market/listings/${encodeURIComponent(listingId)}/withdraw`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdemKey() },
  });
}

/** POST /api/market/listings/:id/buy -- ATOMIC settle. On 200 the item
 * is a claimable row in the caller's WAREHOUSE and the caller's canvas
 * was debited SERVER-side; the caller MUST re-GET its own profile into
 * the store BEFORE its next auto-save PUT (loadGame() in the store), or
 * a stale in-flight auto-save can resurrect the pre-trade balance (the
 * REQ-0041 auto-save race class, called out verbatim in the DTO doc for
 * ApiMarketBuyResponse). Failure reasons (409): already_settled /
 * not_active / expired / self_buy / item_gone / suspended /
 * insufficient_balance / warehouse_full -- all threaded through as
 * ApiError.reason. */
export function buyMarketListing(listingId: string): Promise<ApiMarketBuyResponse> {
  return scheduleJSON<ApiMarketBuyResponse>(`/api/market/listings/${encodeURIComponent(listingId)}/buy`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdemKey() },
  });
}

/** GET /api/market/furnace -- the seasonal burn ledger total (REQ-0066
 * windows it from the current season start; all-time fallback with
 * season:null when no season has started). */
export function fetchMarketFurnace(): Promise<ApiMarketFurnaceResponse> {
  return scheduleJSON<ApiMarketFurnaceResponse>('/api/market/furnace');
}

/** POST /api/market/listings/from-warehouse {warehouseRowId, price} --
 * REQ-0328: the DIRECT warehouse->market sell. Consumes a CLAIMABLE
 * warehouse row and creates an active listing WITHOUT routing through the
 * seller's canvas/inventory (the item is escrowed on the listing;
 * withdraw/expiry returns it to the warehouse). price.tm must be a live TM
 * id; qty an integer in [1,999]. Sends a fresh Idempotency-Key so a retry
 * de-dupes server-side. Throws ApiError(404) for an unknown/expired row,
 * ApiError(409 reason:'claiming') for a row being claimed, ApiError(400
 * reason:'unsellable_kind' | bad price). */
export function sellFromWarehouse(warehouseRowId: string, price: ApiMarketPrice): Promise<ApiMarketListingResponse> {
  return scheduleJSON<ApiMarketListingResponse>('/api/market/listings/from-warehouse', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdemKey() },
    body: JSON.stringify({ warehouseRowId, price }),
  });
}
