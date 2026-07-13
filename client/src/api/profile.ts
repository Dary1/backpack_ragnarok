// client/src/api/profile.ts -- REQ-0145b (ca): profile canvas GET/PUT
// (+ the keepalive beacon variant) and /api/me identity resolution
// (extracted VERBATIM from the old flat api.ts).
import { authHeaders, getJSON, ApiError } from './http';
import type { GameState } from '../engine/engine.d.ts';
import type { ApiCanvasDoc, ApiMe } from '../../../shared/dto';

// ---- REQ-0026/0027 profile canvas + REQ-0035/0037 /api/me ----

/**
 * GET /api/profile/:id/canvas. Sends X-Auth-Token when a token is stored
 * (REQ-0037). Returns null on 404 (no saved canvas yet -- NOT an error
 * state; callers should fall back to the content payload's baked
 * `scenario`), throws ApiError on any other failure (including 401/403,
 * which callers should surface, not silently swallow -- a 403 here means
 * the caller asked for a DIFFERENT player's profile than their own token
 * authorizes).
 */
export async function fetchCanvas(profileId: string): Promise<ApiCanvasDoc | null> {
  const res = await fetch(`/api/profile/${encodeURIComponent(profileId)}/canvas`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for /api/profile/${profileId}/canvas`, res.status);
  }
  return (await res.json()) as ApiCanvasDoc;
}

/**
 * PUT /api/profile/:id/canvas — REQ-0027 T0.2, extended REQ-0037 (sends
 * X-Auth-Token when a token is stored). Body is the BARE GameState object
 * (not wrapped in {canvas:...} -- the server wraps it in storage), exactly
 * mirroring mock-src/ui.js's save handler:
 *   fetch('/api/profile/default/canvas', {method:'PUT', body:JSON.stringify(state)})
 * Throws ApiError on any non-2xx response (including 413 if the body
 * exceeds the server's size cap, per server/README.md).
 */
export async function saveCanvas(profileId: string, state: GameState): Promise<ApiCanvasDoc> {
  const res = await fetch(`/api/profile/${encodeURIComponent(profileId)}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for PUT /api/profile/${profileId}/canvas`, res.status);
  }
  return (await res.json()) as ApiCanvasDoc;
}

/**
 * Best-effort PUT of the profile canvas using fetch keepalive, so a save
 * fired from a page-hide/unload handler (see store/autosave.ts's
 * initAutoSaveLifecycle) can outlive the page. Fire-and-forget: never
 * throws, returns nothing. Body is the bare GameState, exactly like
 * saveCanvas(). keepalive caps total in-flight body at 64KB, matching the
 * server's own profile size cap.
 */
export function saveCanvasBeacon(profileId: string, state: GameState): void {
  try {
    void fetch(`/api/profile/${encodeURIComponent(profileId)}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(state),
      keepalive: true,
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

export function fetchMe(): Promise<ApiMe> {
  return getJSON<ApiMe>('/api/me', authHeaders());
}
