// client/src/api/ragnarok.ts -- REQ-0145b (ca): Hall of Ragnarok
// endpoints + their dto type re-exports (extracted VERBATIM from the
// old flat api.ts).
import { scheduleJSON } from './http';

// ---- REQ-0066: Hall of Ragnarok ----
// Talks to server/routes/ragnarok.cjs (server/services/ragnarok.cjs is the
// business logic; server/ragnarok.cjs is its frozen facade). Same
// conventions as every function above: scheduleJSON() (ApiError on non-2xx,
// authHeaders() spread in, a JSDoc citing the exact server route). The
// wire response shapes are the ApiRagnarok* interfaces in shared/dto.ts
// (imported + re-exported just below), which are the ground truth for the
// exact field shapes.
import type {
  ApiRagnarokSeason, ApiRagnarokSeasonClock, ApiRagnarokSeasonResponse,
  ApiRagnarokTier, ApiRagnarokTierThreshold, ApiRagnarokOrderEntry, ApiRagnarokOrderResponse,
  ApiRagnarokEinherjar, ApiRagnarokEinherjarResponse,
  ApiRagnarokBlast, ApiRagnarokProjection, ApiRagnarokDevotionPreviewResponse, ApiRagnarokDevotionResponse,
} from '../../../shared/dto';
export type {
  ApiRagnarokSeason, ApiRagnarokSeasonClock, ApiRagnarokSeasonResponse,
  ApiRagnarokTier, ApiRagnarokTierThreshold, ApiRagnarokOrderEntry, ApiRagnarokOrderResponse,
  ApiRagnarokEinherjar, ApiRagnarokEinherjarResponse,
  ApiRagnarokBlast, ApiRagnarokProjection, ApiRagnarokDevotionPreviewResponse, ApiRagnarokDevotionResponse,
};

/** GET /api/ragnarok/season -- the season registry + the current season
 * (most recently started; `season`/`derived` are BOTH null when the
 * registry is missing/empty/entirely future -- the documented degenerate
 * case the client must render as an empty season strip). */
export function fetchRagnarokSeason(): Promise<ApiRagnarokSeasonResponse> {
  return scheduleJSON<ApiRagnarokSeasonResponse>('/api/ragnarok/season');
}

/** GET /api/ragnarok/order?top=&around=me&q= -- the Eternal Order, rebuilt
 * lazily once per dawn. `top` = first-N rows (server default 10, cap 100);
 * pass around='me' to also get the caller's rank window (me +/- 2, [] when
 * unranked); pass `q` to also get find-by-name matches (server-side
 * substring, capped at `top`). `me` is always present (rank null =
 * unranked). Server-paginated on purpose (12k+ rows) -- never fetch all. */
export function fetchRagnarokOrder(opts?: { top?: number; around?: 'me'; q?: string }): Promise<ApiRagnarokOrderResponse> {
  const params = new URLSearchParams();
  if (opts?.top != null) params.set('top', String(opts.top));
  if (opts?.around) params.set('around', opts.around);
  if (opts?.q != null && opts.q !== '') params.set('q', opts.q);
  const qs = params.toString();
  return scheduleJSON<ApiRagnarokOrderResponse>(`/api/ragnarok/order${qs ? `?${qs}` : ''}`);
}

/** GET /api/ragnarok/einherjar?player= -- devoted records, newest first.
 * Omit `player` for the caller's own hall (the common case); any
 * registered player id may be queried (records are public). Unknown
 * player -> ApiError(404). */
export function fetchRagnarokEinherjar(player?: string): Promise<ApiRagnarokEinherjarResponse> {
  const qs = player ? `?player=${encodeURIComponent(player)}` : '';
  return scheduleJSON<ApiRagnarokEinherjarResponse>(`/api/ragnarok/einherjar${qs}`);
}

/** GET /api/ragnarok/devotion/preview/:squadIndex -- READ-ONLY blast
 * radius + eligibility + projection for devoting one of the CALLER's own
 * squads. Ineligibility is DATA (`eligible:false` + `reasons[]`), NOT an
 * error; only an unaddressable squad (out-of-range / malformed / no
 * profile) 404s (no-leak). Reasons vocab: mid_rite / last_squad /
 * empty_squad / deployed. */
export function fetchRagnarokDevotionPreview(squadIndex: number): Promise<ApiRagnarokDevotionPreviewResponse> {
  return scheduleJSON<ApiRagnarokDevotionPreviewResponse>(`/api/ragnarok/devotion/preview/${encodeURIComponent(String(squadIndex))}`);
}

/** POST /api/ragnarok/devotion/:squadIndex -- THE rite, IRREVERSIBLE. No
 * request body. `idemKey` (optional) is sent as the Idempotency-Key header
 * so a retried request replays the ORIGINAL outcome (replayed:true) rather
 * than performing a second rite.
 *
 * CRITICAL, per shared/dto.ts's ApiRagnarokDevotionResponse doc: after a
 * 200 the caller's canvas was rewritten SERVER-side (squad slot deleted +
 * every referenced item destroyed account-wide). The client MUST re-GET
 * its profile (store.loadGame()) BEFORE its next auto-save PUT, or a stale
 * in-flight auto-save can resurrect the destroyed items (the REQ-0041
 * auto-save race class). See RagnarokPage's refreshAfterServerMutation.
 *
 * Throws ApiError(404) for an unaddressable squad (no-leak) or
 * ApiError(409) with `.reason` one of mid_rite / last_squad / empty_squad
 * / deployed. */
export function devoteRagnarok(squadIndex: number, idemKey?: string): Promise<ApiRagnarokDevotionResponse> {
  return scheduleJSON<ApiRagnarokDevotionResponse>(`/api/ragnarok/devotion/${encodeURIComponent(String(squadIndex))}`, {
    method: 'POST',
    ...(idemKey ? { headers: { 'Idempotency-Key': idemKey } } : {}),
  });
}
