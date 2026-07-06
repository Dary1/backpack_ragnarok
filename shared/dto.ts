// shared/dto.ts -- REQ-0047 (f2): THE wire-shape DTO types for the HTTP
// API (request/response bodies as served by server/api.cjs + routes/).
// Moved VERBATIM from client/src/api.ts, which re-exports them so every
// existing client import keeps working. Server-side JSDoc can reference
// these via import('../shared/dto') types. Types only -- no runtime code.
// Rules: shared/ may not import from client/, server/, sim/, mock-src/
// -- the one exception is shared/engine.d.ts (also in shared/).
import type { GameState, Layout } from './engine.d.ts';

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

// REQ-0042: TM (Transmutator) content def -- stackable inventory-only
// currency/crafting-material kind. No / (always 1x1, no
// canvas role) and no  (no use-effect v1, per the REQ doc).
export interface ApiTmEntry {
  id: string;
  name: string;
  name_ja?: string;
  i18n?: ApiI18nMap;
  short: string;
  rarity: string;
  icon: string;
  stackable: boolean;
  flavor?: string;
  flavor_ja?: string;
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
  tms: Record<string, ApiTmEntry>; // REQ-0042
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
  /** REQ-0043: which generator produced (or will produce) this room's
   * dungeon def -- 'default' (procedural) or 'test_fixed' (hand-authored
   * batch-002 sequence, verbatim). Always present on a room created
   * after REQ-0043 landed; see server/schedule.cjs's resolveDungeonType()
   * for how a legacy room without this field is still handled server-side. */
  dungeonType?: 'default' | 'test_fixed';
  level: number;
  /** REQ-0043: the seed sim/dungen.cjs's generator used (or will use) to
   * build this room's dungeon layout. Always present (random by default);
   * only a dev/item_admin caller may have CHOSEN this value explicitly at
   * create-room time (see ApiCreateRoomBody.genSeed). */
  genSeed?: string;
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

/** POST /api/schedule/rooms body. REQ-0043: `dungeonType` selects which
 * sim/dungen.cjs generator produces this room's dungeon ('default' or
 * 'test_fixed'); `genSeed` lets a caller pin the generator's seed for a
 * reproducible layout -- server-side GATED to a dev/item_admin caller
 * only (403 for anyone else who sends a non-empty genSeed, same pattern
 * as the dev/backdate route), so the client only ever renders the seed
 * input when `/api/me`'s roles include item_admin (see CreateRoomForm.tsx). */
export interface ApiCreateRoomBody {
  dungeonId: string;
  dungeonType?: 'default' | 'test_fixed';
  level?: number;
  genSeed?: string;
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
/** REQ-0043: one entry per sim/dungen.cjs generator type ('default' /
 * 'test_fixed'). `i18n[locale].note` is a short level-scaling/fixed-spawn
 * hint shown under the type selector. */
export interface ApiDungeonTypeEntry {
  id: 'default' | 'test_fixed';
  name: string;
  i18n?: Record<string, { name?: string; note?: string }>;
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
  /** REQ-0043: the generator type list (kept alongside `dungeons` for
   * back-compat -- `dungeons` is untouched). */
  types: ApiDungeonTypeEntry[];
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
  /** REQ-0042: present (and 'tm') for a TM (Transmutator)-kind row, e.g.
   * an LRDST reward/grant -- absent for a plain PO/SI row. */
  kind?: 'tm';
  /** REQ-0042: TM-kind rows carry a stack quantity. Absent for a plain
   * PO/SI row (those are always singular). */
  qty?: number;
}


/** GET /api/schedule/dungeons -- no auth required (public read data,
 * matches /api/content's own no-auth convention). Used by the
 * create-room form's dungeon/formation selects. */

