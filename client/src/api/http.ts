// client/src/api/http.ts -- REQ-0145b (ca): the fetch core every api/
// domain module shares -- token storage + X-Auth-Token header assembly
// (REQ-0037), ApiError, and the two JSON fetch conventions (getJSON /
// scheduleJSON). Extracted VERBATIM from the old flat api.ts; api.ts is
// now a barrel re-exporting the public subset (the fetch helpers +
// authHeaders are module-internal to src/api/ and are deliberately NOT
// part of the public surface).

// ---- REQ-0037: token storage ----

export const TOKEN_STORAGE_KEY = 'backpack_ragnarok:auth_token';

/** Reads the currently-stored auth token, if any. Guarded for SSR/non-DOM
 * contexts (none exist in this app today, but consistent with the rest
 * of this file's defensive `typeof window/location` checks elsewhere in
 * the codebase, e.g. store.ts's routing helpers). */
export function getStoredToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

/** Persists a freshly-resolved invite token (called by the #/invite/<token>
 * route handler -- see store.ts). */
export function setStoredToken(token: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch (e) {
    // ignore (e.g. storage disabled/full) -- the session simply won't persist
  }
}

/** Clears the stored token (Settings page's Logout action). */
export function clearStoredToken(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    // ignore
  }
}

/** Builds the X-Auth-Token header object when a token is stored, or an
 * empty object when not (so callers can always spread this into their
 * headers without an `if` at every call site). */
export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { 'X-Auth-Token': token } : {};
}

export class ApiError extends Error {
  readonly status?: number;
  /** REQ-0041: a structured machine-readable reason string, when the
   * server attached one (e.g. server/schedule.cjs's assignSlot sets
   * err.reason='empty_squad' for the empty-BP deploy-gate 409, threaded
   * through by server/api.cjs's sendScheduleError as a `reason` field on
   * the JSON error body) -- undefined for every error body that doesn't
   * carry one (every OTHER existing 409/4xx/5xx this client surfaces).
   * schedule/errors.ts's friendlyScheduleError checks this FIRST,
   * preferentially, before falling back to its existing message-substring
   * matching for older/other error shapes. */
  readonly reason?: string;
  constructor(message: string, status?: number, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

export async function getJSON<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(path, headers ? { headers } : undefined);
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

export async function scheduleJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (e) {
    parsed = null;
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `HTTP ${res.status} for ${path}`;
    const reason =
      parsed && typeof parsed === 'object' && parsed !== null && 'reason' in parsed && typeof (parsed as { reason: unknown }).reason === 'string'
        ? (parsed as { reason: string }).reason
        : undefined;
    throw new ApiError(message, res.status, reason);
  }
  return parsed as T;
}
