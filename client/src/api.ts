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

// ---- raw wire shapes (as served by server/api.cjs's buildContentPayload) ----

/** Effect AST node -- opaque to the client; only eff_en/eff_ja (server-
 * rendered display text) are consumed. Kept as unknown[] rather than typed
 * out, since T0.1 never inspects the AST itself (tools/eff_render.cjs on the
 * server already renders it into eff_en/eff_ja before the client sees it). */
export type EffectAst = unknown;

export interface ApiSocketDef {
  t: string;
  tags?: string[];
  ax?: number;
  ay?: number;
}

export interface ApiPortDef {
  tiles: Array<[number, number]>;
  tag: string;
}

// REQ-0038: formal i18n content shape -- a map keyed by locale (today
// only "ja" is server-whitelisted, see server/admin.cjs's
// SUPPORTED_LOCALES), each locale carrying its own name/flavor override.
// Base name/flavor on the entry itself stay English always; this map is
// where every OTHER locale's copy lives. The server ALSO still computes
// back-compat top-level name_ja/flavor_ja fields (mirrored from
// i18n.ja) for legacy consumers (mock-src/ui.js, ItemPanel.tsx's
// localized() helper) -- the Dex v2 UI reads i18n directly instead.
export type ApiI18nMap = Record<string, { name?: string; flavor?: string }>;

export interface ApiItemEntry {
  id: string;
  name: string;
  name_ja?: string;
  i18n?: ApiI18nMap;
  tags: string[];
  rarity: string;
  shape: Array<[number, number]>;
  icon: string;
  sockets?: ApiSocketDef[];
  ports?: ApiPortDef[];
  stretch?: boolean;
  part?: { assembles: string; role: string };
  effects?: EffectAst[];
  flavor?: string;
  flavor_ja?: string;
  eff_en?: string;
  eff_ja?: string;
}

export interface ApiSIEntry {
  id: string;
  name: string;
  name_ja?: string;
  i18n?: ApiI18nMap;
  slot: string;
  reqTags?: string[];
  icon: string;
  rarity: string;
  ports?: ApiPortDef[];
  effects?: EffectAst[];
  flavor?: string;
  flavor_ja?: string;
  eff_en?: string;
  eff_ja?: string;
}

export interface ApiTrees {
  po: Record<string, string | null>;
  socket: Record<string, string | null>;
}

/** scenario.json shape: the baked default canvas, plus `layout` (stripped
 * off before use as GameState -- see gameDataFromApiContent below, matching
 * ui.js's `delete scenarioForState.layout`). */
export interface ApiScenario extends GameState {
  layout?: Layout;
}

/** Batch-level provenance record (content/registry.json's `batches[]`
 * entries) -- REQ-0035's Dex provenance section. This repo's registry
 * schema does not (yet) carry a per-item id list, so provenance
 * resolution in the Dex can only offer batch-level info, not a precise
 * per-item mapping -- see docs/REQ/REQ-0035-item-encyclopedia.md. */
export interface ApiRegistryBatch {
  id: string;
  date?: string;
  drafted_by?: string;
  icons_by?: string;
  submitted?: number;
  approved?: number;
  expected_rejects_confirmed?: number;
  s2_real_catches?: number;
  status?: string;
  preview?: string;
}

export interface ApiRegistry {
  batches: ApiRegistryBatch[];
}

/** Closed-vocabulary lists for the Dex admin edit form's dropdowns
 * (REQ-0035). Server-side validation in server/admin.cjs is the actual
 * source of truth/enforcement -- this is purely so the client can render
 * matching dropdown options without a separate vocab fetch. */
export interface ApiVocabLists {
  triggers: string[];
  verbs: string[];
  statuses: string[];
  rarities: string[];
}

export interface ApiContentPayload {
  items: Record<string, ApiItemEntry>;
  sis: Record<string, ApiSIEntry>;
  trees: ApiTrees;
  scenario: ApiScenario;
  layout: Layout | null;
  registry: ApiRegistry | null;
  vocab: ApiVocabLists;
}

export interface ApiCanvasDoc {
  schema_version: number;
  profile_id: string;
  updated_at: string;
  canvas: GameState;
}

export interface ApiErrorBody {
  ok: false;
  error: string;
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
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
    return { source: 'live', gameData };
  } catch (e) {
    return { source: 'error', gameData: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- REQ-0035: /api/me + admin item-edit endpoint, extended REQ-0037 ----

export interface ApiMe {
  playerId: string;
  name: string;
  roles: string[];
}

/** GET /api/me. REQ-0037: sends X-Auth-Token when a token is stored;
 * resolves to the dev player when no token is stored and the server's
 * dev_mode is true. Throws ApiError(401) when a stored token is invalid,
 * or when no token is stored and dev_mode is false -- callers (DexRoot,
 * store.ts's boot(), Settings.tsx) already treat a fetchMe() failure as
 * "roles-less / unauthenticated", non-fatal, see DexRoot.tsx's existing
 * pattern. */
export function fetchMe(): Promise<ApiMe> {
  return getJSON<ApiMe>('/api/me', authHeaders());
}

export interface AdminPutResult {
  ok: true;
  id: string;
  item: Record<string, unknown>;
}

export interface AdminPutError {
  ok: false;
  error: string;
}

/** PUT /api/admin/item/:id -- REQ-0035, updated REQ-0037: identity is now
 * carried ENTIRELY by the stored X-Auth-Token (no more playerId param /
 * X-Player-Id header -- the server resolves the acting player from the
 * token itself, exactly like every other authenticated route). Throws
 * ApiError on any non-2xx response; the error's `message` is the
 * server's own `error` string (surfaced verbatim to the edit form) where
 * the response body could be parsed as JSON, so validation failures are
 * readable, not just an HTTP status.
 */
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

// ---- REQ-0036 P1-C: Dungeon Schedule + Warehouse client API ----
// Talks to server/api.cjs's /api/schedule/* and /api/warehouse* routes
// (server/schedule.cjs is the business logic; see server/README.md's
// "Dungeon Schedule API" section for the full endpoint table). Same
// conventions as every function above: ApiError on non-2xx, authHeaders()
// spread into every request's headers, a JSDoc citing the exact server
// route each function hits.

/** One room's cancel policy (golden g). `immediate:false` means "cancel
 * after the current run finishes" rather than right away. */
export interface ApiCancelPolicy {
  immediate: boolean;
}

/** One unit slot (golden b) -- `presetIndex` is one of the OWNER's own
 * preset indices (0-based), or null if unfilled. */
export interface ApiRoomSlot {
  presetIndex: number | null;
}

/** A queued swap (golden j) -- present once `PUT .../swap` is queued
 * (`applied:false`) while a run is active; cleared once the queued swap
 * is applied at the next run settle. */
export interface ApiPendingSwap {
  slot: number;
  presetIndex: number;
  notify: boolean;
  queuedAt: string;
}

/** Room document shape -- mirrors server/schedule.cjs's room document
 * field-for-field (see that file's own header comment / server/README.md). */
export interface ApiRoom {
  id: string;
  ownerId: string;
  dungeonId: string;
  level: number;
  visibility: 'self';
  formationId: string;
  cancelPolicy: ApiCancelPolicy;
  slots: ApiRoomSlot[];
  status: 'open' | 'active' | 'canceled';
  cancelRequested: boolean;
  pendingSwap: ApiPendingSwap | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunId: string | null;
}

/** POST /api/schedule/rooms body. */
export interface ApiCreateRoomBody {
  dungeonId: string;
  level?: number;
  formationId?: string;
  cancelPolicy?: ApiCancelPolicy;
}

/** GET .../run's run-clock event -- opaque to the client's type system
 * beyond {t,seq,ev} (every event's own extra fields vary by `ev`, see
 * sim/README.md's event schema table / docs/combat_spec_draft.md
 * S1.5/S3.6) -- the monitor reads fields off this dynamically (dst/src/
 * path/cell ids etc.) rather than a fully-typed union, matching how
 * api.ts already treats EffectAst as opaque (server-rendered, client
 * never interprets the AST itself). */
export interface ApiRunEvent {
  t: number;
  seq: number;
  ev: string;
  [key: string]: unknown;
}

/** GET /api/schedule/rooms/:id/run response shape (server/api.cjs's
 * SCHEDULE_ROOM_RUN_RE handler). `result`/`rewards`-adjacent summary
 * fields are always the EVENTUAL final outcome, even before
 * `settled`/`clock.isSettled` is true -- see server/README.md's
 * "Run-clock design" section. */
export interface ApiRunView {
  ok: true;
  runId: string;
  roomId: string;
  startedAt: string;
  durationSecs: number;
  clock: { elapsedSecs: number; isSettled: boolean; pct: number };
  events: ApiRunEvent[];
  result: 'victory' | 'wipe' | 'incomplete';
  finalProgressPct: number;
  cooldownSecs: number;
  levelAfter: number;
  H: number;
  settled: boolean;
}

/** GET /api/schedule/dungeons's per-dungeon/-formation entries. */
export interface ApiDungeonEntry {
  id: string;
  name: string;
  i18n?: ApiI18nMap;
}
export interface ApiFormationEntry {
  id: string;
  name: string;
  i18n?: ApiI18nMap;
  canvases: Record<string, string>;
}
export interface ApiDungeonsPayload {
  ok: true;
  dungeons: ApiDungeonEntry[];
  formations: ApiFormationEntry[];
}

/** One warehouse row (golden e/f). `itemId` resolves against
 * fetchContent()'s items map for name/icon (see WarehouseTab.tsx --
 * reuses the SAME item lookup every other content-aware view already
 * uses, no second item-lookup path). */
export interface ApiWarehouseItem {
  itemUid: string;
  playerId: string;
  itemId: string;
  harvestedAt: string;
  expiresAt: string;
  sourceRoomId: string;
  sourceRunId: string;
}

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
    throw new ApiError(message, res.status);
  }
  return parsed as T;
}

/** GET /api/schedule/dungeons -- no auth required (public read data,
 * matches /api/content's own no-auth convention). Used by the
 * create-room form's dungeon/formation selects. */
export function fetchDungeons(): Promise<ApiDungeonsPayload> {
  return scheduleJSON<ApiDungeonsPayload>('/api/schedule/dungeons');
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

/** PUT /api/schedule/rooms/:id/slots/:slotIndex {presetIndex} -- assigns
 * one of the caller's OWN presets to a unit slot (golden b). Throws
 * ApiError(409) on a deploy-gate violation (see errorMessageFor() in
 * schedule/errors.ts for the human-readable mapping of the 409 message). */
export function assignSlot(roomId: string, slotIndex: number, presetIndex: number): Promise<{ ok: true; room: ApiRoom }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/slots/${slotIndex}`, {
    method: 'PUT',
    body: JSON.stringify({ presetIndex }),
  });
}

/** PUT /api/schedule/rooms/:id/swap {slot, presetIndex} -- golden j. */
export function swapUnit(
  roomId: string,
  slot: number,
  presetIndex: number
): Promise<{ ok: true; room: ApiRoom; applied: boolean }> {
  return scheduleJSON(`/api/schedule/rooms/${encodeURIComponent(roomId)}/swap`, {
    method: 'PUT',
    body: JSON.stringify({ slot, presetIndex }),
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

/** POST /api/warehouse/claim {itemUid} -- moves one warehouse item into
 * the caller's own inventory via first-fit placement (golden f). Throws
 * ApiError(409) when no inventory page has space (item stays in the
 * warehouse, untouched server-side). */
export function claimWarehouseItem(itemUid: string): Promise<{ ok: true; placed: { page: number; cell: [number, number] }; uid: string }> {
  return scheduleJSON('/api/warehouse/claim', { method: 'POST', body: JSON.stringify({ itemUid }) });
}
