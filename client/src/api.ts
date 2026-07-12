// Typed API client — REQ-0026 T0.1.
// Talks to server/api.cjs: GET /api/content, GET/PUT /api/profile/:id/canvas.
// Mirrors the ACTUAL live response shapes (inspected via
// `curl https://backpack-dev.qtie.jp/api/content` and .../profile/default/canvas
// during T0.1 implementation) -- not a guess from the spec doc. The
// normalization from raw wire payload -> engine-ready GameData is a direct
// TypeScript port of mock-src/ui.js's gameDataFromApiContent(): same fields,
// same defaulting rules, now typed. This is glue/data-shaping code, not
// engine logic -- Engine.create() itself is untouched (see engine/adapter.ts).
//
// REQ-0037: token-based guest auth. A token minted by an operator's
// invite link (server/cli_invite.cjs) is stored in localStorage (see
// TOKEN_STORAGE_KEY below) and attached as X-Auth-Token on every request
// that supports it (authHeaders()). No token stored -> no header sent at
// all, which the server treats as "dev_mode fallback" (see
// docs/REQ/REQ-0037-guest-auth.md) -- the client does not special-case
// "no token" beyond simply not sending the header.
import type { GameState, ItemDefMap, Layout, SIDefMap, Trees } from './engine/engine.d.ts';

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
function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { 'X-Auth-Token': token } : {};
}

// ---- wire-shape DTO types: moved to shared/dto.ts (REQ-0047 (f2)) ----
// Imported for local use in the fetch helpers below, and re-exported so
// every existing `import type { ... } from './api'` keeps working.
import type { ApiMarketPrice, ApiMarketPriceHistoryEntry, ApiMarketListing, ApiMarketListingsResponse, ApiMarketCreateListingRequest, ApiMarketListingResponse, ApiMarketBuyReceipt, ApiMarketBuyResponse, ApiMarketFurnaceResponse, EffectAst, ApiSocketDef, ApiPortDef, ApiI18nMap, ApiItemEntry, ApiSIEntry, ApiTmEntry, ApiTrees, ApiScenario, ApiRegistryBatch, ApiRegistry, ApiVocabLists, ApiContentPayload, ApiCanvasDoc, ApiErrorBody, ApiMe, AdminPutResult, AdminPutError, ApiCancelPolicy, ApiRoomSlot, ApiPendingSwap, ApiRoom, ApiCreateRoomBody, ApiRunEvent, ApiRunView, ApiDungeonEntry, ApiDungeonTypeEntry, ApiFormationEntry, ApiDungeonsPayload, ApiForecastProfile, ApiForecastPayload, ApiWarehouseItem, ApiDexCardDto, ApiDismantleResponse, ApiDismantleLedgerEntry, ApiDismantleLedgerResponse } from '../../shared/dto';
export type { ApiMarketPrice, ApiMarketPriceHistoryEntry, ApiMarketListing, ApiMarketListingsResponse, ApiMarketCreateListingRequest, ApiMarketListingResponse, ApiMarketBuyReceipt, ApiMarketBuyResponse, ApiMarketFurnaceResponse, EffectAst, ApiSocketDef, ApiPortDef, ApiI18nMap, ApiItemEntry, ApiSIEntry, ApiTmEntry, ApiTrees, ApiScenario, ApiRegistryBatch, ApiRegistry, ApiVocabLists, ApiContentPayload, ApiCanvasDoc, ApiErrorBody, ApiMe, AdminPutResult, AdminPutError, ApiCancelPolicy, ApiRoomSlot, ApiPendingSwap, ApiRoom, ApiCreateRoomBody, ApiRunEvent, ApiRunView, ApiDungeonEntry, ApiDungeonTypeEntry, ApiFormationEntry, ApiDungeonsPayload, ApiForecastProfile, ApiForecastPayload, ApiWarehouseItem, ApiDexCardDto, ApiDismantleResponse, ApiDismantleLedgerEntry, ApiDismantleLedgerResponse };


async function scheduleJSON<T>(path: string, init?: RequestInit): Promise<T> {
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

// ---- engine-ready shape (what Engine.create(...) + makeState() consume) ----

export interface GameData {
  LAYOUT: Layout;
  ITEMS: ItemDefMap;
  SI_DEFS: SIDefMap;
  TREES: Trees;
  makeState: () => GameState;
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

async function getJSON<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(path, headers ? { headers } : undefined);
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

/** GET /api/content. Throws ApiError on network failure or non-2xx. No
 * auth needed -- content is public read data, same as before REQ-0037. */
export function fetchContent(): Promise<ApiContentPayload> {
  return getJSON<ApiContentPayload>('/api/content');
}

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

/**
 * Converts the /api/content payload into the engine-ready GameData shape --
 * a typed port of mock-src/ui.js's gameDataFromApiContent(). Field-for-field
 * identical defaulting: eff falls back to eff_en, TREES defaults to
 * {po:{},socket:{}} (degenerate/exact-match only), scenario's `layout` key
 * is stripped before use as the makeState() template (layout is carried
 * separately as GameData.LAYOUT).
 */
export function gameDataFromApiContent(payload: ApiContentPayload): GameData {
  const LAYOUT = payload.layout ?? payload.scenario?.layout;
  if (!LAYOUT || !Number.isInteger(LAYOUT.ROWS) || !Number.isInteger(LAYOUT.COLS)) {
    throw new Error('content: missing layout');
  }

  const ITEMS: ItemDefMap = {};
  for (const id in payload.items) {
    const e = payload.items[id];
    ITEMS[id] = {
      name: e.name,
      name_ja: e.name_ja,
      tags: e.tags,
      rarity: e.rarity,
      shape: e.shape,
      icon: e.icon,
      sockets: (e.sockets ?? []).map((s) => ({ t: s.t, tags: s.tags ?? [], ax: s.ax, ay: s.ay })),
      eff: e.eff_en ?? '',
      eff_en: e.eff_en ?? '',
      eff_ja: e.eff_ja ?? '',
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
      ...(e.stretch ? { stretch: e.stretch } : {}),
      ...(e.align ? { align: e.align } : {}),
      ...(e.ports !== undefined ? { ports: e.ports } : {}),
    };
  }

  const SI_DEFS: SIDefMap = {};
  for (const id in payload.sis) {
    const e = payload.sis[id];
    SI_DEFS[id] = {
      name: e.name,
      name_ja: e.name_ja,
      slot: e.slot,
      reqTags: e.reqTags ?? [],
      icon: e.icon,
      rarity: e.rarity,
      eff: e.eff_en ?? '',
      eff_en: e.eff_en ?? '',
      eff_ja: e.eff_ja ?? '',
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
      ...(e.ports !== undefined ? { ports: e.ports } : {}),
    };
  }

  const TREES: Trees = payload.trees ?? { po: {}, socket: {} };

  const scenarioForState: Partial<ApiScenario> = JSON.parse(JSON.stringify(payload.scenario ?? {}));
  delete scenarioForState.layout;
  const scenarioClone = scenarioForState as GameState;

  function makeState(): GameState {
    return JSON.parse(JSON.stringify(scenarioClone));
  }

  return { LAYOUT, ITEMS, SI_DEFS, TREES, makeState };
}

export type DataSource = 'live' | 'error';

export interface ResolvedGameData {
  source: DataSource;
  gameData: GameData | null;
  error?: string;
  /** REQ-0042: true iff GET /api/profile/:id/canvas 404'd (no saved
   * canvas existed for this player yet) -- i.e. this is a GENUINELY
   * fresh profile, never saved before. store.ts's boot() uses this
   * (and ONLY this -- never re-checked on any later boot, since a
   * fresh profile's first save makes canvasDoc.canvas truthy forever
   * after) to seed a one-time starter LRDST stack, exactly once, on a
   * brand new profile -- see boot()'s own comment for why this is the
   * correct, safe hook (never re-fires for an existing save, including
   * the dev player's, which already has a saved profile from long
   * before this REQ existed). */
  isFreshProfile: boolean;
}

/**
 * Resolves GameData: always live (per REQ-0026 T0.1 scope -- no baked-data
 * fallback in the client; that offline-first behavior belongs to the
 * mock, per mock-src/ui.js). On failure, returns source:'error' so the UI
 * can show an explicit error state instead of silently rendering nothing.
 * Canvas resolution: GET /api/profile/:profileId/canvas; on 404 (no saved
 * canvas yet) falls back to the content payload's baked `scenario`, per
 * the spec's "saved profile (fallback scenario)" instruction.
 *
 * REQ-0037: `profileId` is the AUTHENTICATED player's own playerId
 * (resolved via /api/me -- see store.ts's boot(), which calls fetchMe()
 * first and passes its playerId here), not a hardcoded 'default' string
 * -- so different logged-in guests get isolated boards. A caller with no
 * stored token still gets a working profileId because /api/me itself
 * resolves to the dev player under dev_mode, and store.ts uses THAT
 * playerId here, not a literal 'default'.
 */
export async function resolveGameData(profileId: string): Promise<ResolvedGameData> {
  try {
    const content = await fetchContent();
    const gameData = gameDataFromApiContent(content);
    const canvasDoc = await fetchCanvas(profileId).catch(() => null);
    if (canvasDoc?.canvas) {
      const canvas = canvasDoc.canvas;
      gameData.makeState = () => JSON.parse(JSON.stringify(canvas));
    }
    return { source: 'live', gameData, isFreshProfile: !canvasDoc?.canvas };
  } catch (e) {
    return { source: 'error', gameData: null, error: e instanceof Error ? e.message : String(e), isFreshProfile: false };
  }
}

// ---- REQ-0035: /api/me + admin item-edit endpoint, extended REQ-0037 ----

export function fetchMe(): Promise<ApiMe> {
  return getJSON<ApiMe>('/api/me', authHeaders());
}

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

// ---- REQ-0063: Dismantle System client API ----
// Talks to server/routes/dismantle.cjs. postDismantle removes the given
// inventory PO/SI server-side (RULE-5 sanctioned direct-canvas removal)
// and returns the real yield + updated ledger numbers -- callers MUST
// follow a successful call with the store's loadGame() to pull the
// authoritative post-removal canvas (see DismantlePanel.tsx's module
// comment for why: same auto-save race MarketPage.tsx's buy flow guards
// against).
export function postDismantle(itemUid: string, kind: 'po' | 'si'): Promise<ApiDismantleResponse> {
  return scheduleJSON('/api/dismantle', { method: 'POST', body: JSON.stringify({ itemUid, kind }) });
}

/** The caller's own full 分解値 ledger (every id ever dismantled, with
 * its cumulative count + current suppression). Backs DismantlePanel's
 * per-item preview numbers. */
export function fetchDismantleLedger(): Promise<ApiDismantleLedgerResponse> {
  return scheduleJSON('/api/dismantle/ledger');
}

// ---- REQ-0036 P1-C: Dungeon Schedule + Warehouse client API ----
// Talks to server/api.cjs's /api/schedule/* and /api/warehouse* routes
// (server/schedule.cjs is the business logic; see server/README.md's
// "Dungeon Schedule API" section for the full endpoint table). Same
// conventions as every function above: ApiError on non-2xx, authHeaders()
// spread into every request's headers, a JSDoc citing the exact server
// route each function hits.

/** One room's cancel policy (golden g). `immediate:false` means "cancel
 * after the current run finishes" rather than right away. */
export function fetchDungeons(): Promise<ApiDungeonsPayload> {
  return scheduleJSON<ApiDungeonsPayload>('/api/schedule/dungeons');
}

/** GET /api/schedule/forecast -- REQ-0057. The enemy attack profiles the Ray
 * Forecast Overlay walks for a given (dungeonType, level). Public/no-auth,
 * exactly like fetchDungeons above: this is CONTENT (enemy defs folded to ray
 * profiles), not run state, so it is scoped to no caller and reveals no run's
 * hidden placements. */
export function fetchForecast(dungeonType: string, level: number): Promise<ApiForecastPayload> {
  const qs = new URLSearchParams({ dungeonType, level: String(level) });
  return scheduleJSON<ApiForecastPayload>('/api/schedule/forecast?' + qs.toString());
}

/** POST /api/schedule/rooms -- creates a room owned by the caller. */
export function createRoom(body: ApiCreateRoomBody): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON('/api/schedule/rooms', { method: 'POST', body: JSON.stringify(body) });
}

/** GET /api/schedule/rooms -- lists the CALLER's own rooms only. */
export function fetchRooms(): Promise<{ ok: true; rooms: ApiRoom[] }> {
  return scheduleJSON('/api/schedule/rooms');
}

/** GET /api/schedule/rooms/:id -- settles a due run first (server-side
 * lazy settlement), then returns the room. */
export function fetchRoom(roomId: string): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}`);
}

/** DELETE /api/schedule/rooms/:id -- cancel (golden g). Immediate or
 * queued (`cancelRequested`) depending on the room's own cancelPolicy +
 * whether a run is currently active. */
export function cancelRoom(roomId: string): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}

/** PUT /api/schedule/rooms/:id/slots/:slotIndex {squadIndex} -- assigns
 * one of the caller's OWN squads to a squad slot (golden b). Throws
 * ApiError(409) on a deploy-gate violation (see errorMessageFor() in
 * schedule/errors.ts for the human-readable mapping of the 409 message). */
export function assignSlot(roomId: string, slotIndex: number, squadIndex: number): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/slots/${slotIndex}`, {
    method: 'PUT',
    body: JSON.stringify({ squadIndex }),
  });
}

/** PUT /api/schedule/rooms/:id/swap {slot, squadIndex} -- golden j. */
export function swapSquad(
  roomId: string,
  slot: number,
  squadIndex: number
): Promise<{ ok: true; room: ApiRoom; applied: boolean }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/swap`, {
    method: 'PUT',
    body: JSON.stringify({ slot, squadIndex }),
  });
}

/** GET /api/schedule/rooms/:id/run -- run-clock-paced replay view (see
 * server/README.md's "Run-clock design"). Poll roughly every ~2s while a
 * room is active/has a recent run; each poll returns the FULL events
 * array up to the current elapsedSecs (not just new deltas) -- see
 * Monitor.tsx's own poll-and-diff loop for how the client tracks "last
 * rendered event index" across polls. */
export function fetchRun(roomId: string): Promise<ApiRunView> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/run`);
}

/** POST /api/schedule/rooms/:id/dev/backdate -- REQ-0036 P1-C dev-only
 * E2E time-control seam (see server/README.md's "P1-C addendum" /
 * schedule.cjs's devBackdateActiveRun() doc comment). ONLY succeeds
 * (200) when the caller resolved via the dev_mode no-token fallback;
 * any real guest token gets 403. Not called by any production UI path --
 * exported here solely so client/e2e/schedule.spec.ts can drive it over
 * the same typed client every other test helper uses, rather than a raw
 * fetch call in the spec file. */
export function devBackdateRun(roomId: string, extraSecsIntoPast?: number): Promise<{ ok: true; runId: string; startedAt: string; durationSecs: number }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/dev/backdate`, {
    method: 'POST',
    body: JSON.stringify(extraSecsIntoPast != null ? { extraSecsIntoPast } : {}),
  });
}

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

// ---- REQ-0042: Workshop gacha ----

/** A freshly-rolled common_bp gacha result -- server/schedule.cjs's
 * rollCommonBp() output shape, echoed verbatim in the POST /api/workshop/
 * gacha response. */
export interface ApiRolledBp {
  uid: string;
  shape: Array<[number, number]>;
  linker: { off: [number, number]; dirs: number[] };
  hpMax: number;
  cellCount: number;
}

/** POST /api/workshop/gacha {kind:'common_bp'} -- REQ-0042 two-phase
 * roll (mirrors POST /api/warehouse/claim's two-phase shape, see
 * server/schedule.cjs's startGachaRoll doc). Verifies the caller's
 * LAST-SAVED LRDST balance >= cost server-side and returns the rolled BP
 * definition WITHOUT deducting anything yet -- the caller (WorkshopPage)
 * is responsible for deducting `cost` from its own LRDST stack via
 * engine.spendTM, first-fit-placing the rolled BP, and then letting the
 * normal auto-save (notifyStateChanged()) persist it, exactly like
 * claimWarehouseItem's own doc describes for warehouse claims. Throws
 * ApiError(409) if the balance is insufficient. */
export function rollWorkshopGacha(kind: 'common_bp' = 'common_bp'): Promise<{ ok: true; cost: number; rolled: ApiRolledBp }> {
  return scheduleJSON('/api/workshop/gacha', { method: 'POST', body: JSON.stringify({ kind }) });
}

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
} from '../../shared/dto';
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
