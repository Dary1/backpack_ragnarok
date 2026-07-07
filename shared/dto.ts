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


// ---- REQ-0064: Market wire shapes (server/routes/market.cjs) ----
// Every /api/market response envelope carries `dtoVersion:
// MARKET_DTO_VERSION` (currently 1; server/services/market.cjs owns the
// runtime constant -- shared/dto.ts is types-only by rule). Bump the
// literal here AND there together whenever a market wire shape changes
// incompatibly.
export type MarketDtoVersion = 1;

/** Law 1 ("barter in kind"): a price is an integer qty of ONE TM.
 * v1's trade TM is content id 'lrdst' (content/live/live_tms.json). */
export interface ApiMarketPrice {
  tm: string;
  qty: number;
}

/** One settled-price engraving from the Dex price history (rolling
 * last-5 per itemId, newest first). */
export interface ApiMarketPriceHistoryEntry {
  qty: number;
  t: string;
}

/** One market listing, as browsed/owned. STORED states are
 * active/settled/withdrawn/expired; 'suspended' is DERIVED at read time
 * (the seller currently deploys the item -- Law of Possession) and
 * reverts to 'active' on its own when the deploy ends. A suspended
 * listing is browsable but unbuyable (buy -> 409 {reason:'suspended'}). */
export interface ApiMarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  itemUid: string;
  itemId: string;
  /** Display conveniences resolved server-side; the full item def
   * (icon/shape/effects) still comes from fetchContent()'s items map by
   * itemId, same as every other content-aware view. */
  itemName: string;
  itemNameJa: string | null;
  rarity: string | null;
  tags: string[];
  /** 1-based position in content/live/live_items.json (v1 dex
   * numbering; null = not in the dex, e.g. pilot-only items). */
  dexNo: number | null;
  price: ApiMarketPrice;
  /** Law 2: burn = max(1, ceil(qty * 0.08)), settlement-only. */
  burn: number;
  sellerReceives: number;
  createdAt: string;
  /** 7-day shelf life; lazily flips the listing to 'expired'. */
  expiresAt: string;
  state: 'active' | 'suspended' | 'settled' | 'withdrawn' | 'expired';
  suspended: boolean;
  priceHistory: ApiMarketPriceHistoryEntry[];
  settledAt?: string;
  buyerId?: string;
  withdrawnAt?: string;
  /** 'owner' = explicit withdrawal; 'item_gone' = auto-withdrawn when
   * the listed item vanished from the seller's inventory. */
  withdrawnReason?: 'owner' | 'item_gone';
  expiredAt?: string;
}

/** GET /api/market/listings?filter=&q= -- default: every active +
 * suspended listing market-wide; filter=mine: the caller's own listings
 * in every state (tag/q ignored); any other filter value matches item
 * tags[] or rarity case-insensitively; q matches a Dex No. ("61" /
 * "No.061") or an EN/JA name substring. */
export interface ApiMarketListingsResponse {
  ok: true;
  dtoVersion: MarketDtoVersion;
  /** The market's one trade TM id (law 1) -- 'lrdst' today. */
  tm: string;
  listings: ApiMarketListing[];
}

/** POST /api/market/listings request body. `price.tm` must equal the
 * market TM id; qty an integer in [1, 999]. Optional Idempotency-Key
 * HEADER dedupes retries (replayed:true on the response). */
export interface ApiMarketCreateListingRequest {
  itemUid: string;
  price: ApiMarketPrice;
}

/** POST /api/market/listings and .../:id/withdraw response. */
export interface ApiMarketListingResponse {
  ok: true;
  dtoVersion: MarketDtoVersion;
  /** true when an Idempotency-Key replay returned the ORIGINAL outcome
   * instead of performing a new mutation. */
  replayed: boolean;
  listing: ApiMarketListing;
}

/** The settlement receipt (POST .../:id/buy). */
export interface ApiMarketBuyReceipt {
  listingId: string;
  itemId: string;
  buyerId: string;
  price: ApiMarketPrice;
  burn: number;
  sellerReceives: number;
  settledAt: string;
}

/** POST /api/market/listings/:id/buy response. After a 200 the item is
 * a claimable row in the buyer's WAREHOUSE (ApiWarehouseItem with
 * sourceListingId) and the buyer's canvas was debited SERVER-side --
 * the client MUST re-GET its profile before its next auto-save PUT, or
 * a stale in-flight auto-save can resurrect the pre-trade balance
 * (REQ-0041's documented auto-save race class). Failure reasons (409):
 * already_settled / not_active / expired / self_buy / item_gone /
 * suspended / insufficient_balance / warehouse_full. */
export interface ApiMarketBuyResponse {
  ok: true;
  dtoVersion: MarketDtoVersion;
  replayed: boolean;
  receipt: ApiMarketBuyReceipt;
  listing: ApiMarketListing;
}

/** GET /api/market/furnace -- the burn ledger total, windowed to the
 * CURRENT season (REQ-0066: `since` carries the season start) with an
 * all-time fallback (`since` null, `season` null) when no season
 * registry exists / no season has started yet. */
export interface ApiMarketFurnaceResponse {
  ok: true;
  dtoVersion: MarketDtoVersion;
  /** REQ-0066: the season the window belongs to (index + ja name), or
   * null on the all-time fallback. */
  season?: { index: number; name: string } | null;
  furnace: {
    tm: string;
    total: number;
    count: number;
    since: string | null;
  };
}

// ---- REQ-0066: Hall of Ragnarok wire shapes (server/routes/ragnarok.cjs) ----
// Every /api/ragnarok response envelope carries `dtoVersion:
// RAGNAROK_DTO_VERSION` (currently 1; server/services/ragnarok.cjs owns
// the runtime constant -- shared/dto.ts is types-only by rule). Bump the
// literal here AND there together whenever a ragnarok wire shape
// changes incompatibly.
export type RagnarokDtoVersion = 1;

/** One season registry entry (content/live/seasons.json, normalized).
 * `name` is the ja display name (第N季 「狼の冬」); ragnarokAt = startAt +
 * phasesPerSeason * phaseDays days by seed convention (stored value
 * wins when content deliberately diverges). */
export interface ApiRagnarokSeason {
  index: number;
  name: string;
  nameEn: string | null;
  startAt: string;
  phaseDays: number;
  phasesPerSeason: number;
  ragnarokAt: string;
}

/** The lazily derived season clock (wall-clock derivation, no
 * scheduler). `phase` is 1-based, clamped to [1, phasesPerSeason] --
 * the mock's 12-wedge wheel marks phases 1..phase-1 done, `phase`
 * current. `daysToRagnarok` is the countdown number (ラグナロクまで N日;
 * ceil, so the final partial day still reads 1). `ended` = past
 * ragnarokAt with no successor season started yet. */
export interface ApiRagnarokSeasonClock {
  now: string;
  phase: number;
  phaseDay: number;
  daysToRagnarok: number;
  msToRagnarok: number;
  ended: boolean;
}

/** GET /api/ragnarok/season -- the full registry plus the current
 * season (most recently started; null when the registry is missing/
 * empty/entirely future -- the documented degenerate case) and its
 * derived clock. */
export interface ApiRagnarokSeasonResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  seasons: ApiRagnarokSeason[];
  season: ApiRagnarokSeason | null;
  derived: ApiRagnarokSeasonClock | null;
}

/** Eternal Order tiers (mock chip row). Thresholds are server tunables
 * ([ORCH defaults] 0/500/2000/8000); VALHALLA is never assigned by the
 * server (client-side semantics, beyond the ladder). */
export type ApiRagnarokTier = 'THRALL' | 'KARL' | 'JARL' | 'EINHERJAR';

export interface ApiRagnarokTierThreshold {
  tier: ApiRagnarokTier;
  min: number;
}

/** One Eternal Order row. `rank` is null ONLY on the synthetic `me`
 * entry of a caller who has never devoted (unranked -- not in the
 * stone). `emblem` is the placeholder asset key ('emblem_horn3') until
 * a real emblem system ships. `score` is the all-season 戦果 total --
 * 0 for everyone until REQ-0068's season-end battles land. */
export interface ApiRagnarokOrderEntry {
  playerId: string;
  name: string;
  emblem: string;
  einherjarCount: number;
  score: number;
  rank: number | null;
  tier: ApiRagnarokTier;
}

/** GET /api/ragnarok/order?top=&around=me&q= -- the standings, rebuilt
 * lazily once per dawn (rebuiltAt tells you which dawn; 「更新は毎暁」--
 * a rite completed at noon appears at the NEXT dawn). `top` = first N
 * rows (default 10, cap 100); `around` (present iff around=me was
 * requested) = the caller's rank window (me +/- 2, [] when unranked);
 * `matches` (present iff q= was sent) = find-by-name hits, capped at
 * `top`. `me` is always present. */
export interface ApiRagnarokOrderResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  rebuiltAt: string;
  total: number;
  tiers: ApiRagnarokTierThreshold[];
  top: ApiRagnarokOrderEntry[];
  me: ApiRagnarokOrderEntry;
  around?: ApiRagnarokOrderEntry[];
  matches?: ApiRagnarokOrderEntry[];
}

/** One einherjar record (list view). The frozen snapshot canvas itself
 * is deliberately NOT on the wire (server-side until a later unit needs
 * it); `counts` echoes what was devoted (mock: 鞄 3 ・ 物品 17 ・ 型 3 =
 * bps/pos/sis). `perSeason` is the 戦果 history REQ-0068 will append
 * ({season, battles:[...]}); empty today. `bioArchive` is reserved for
 * REQ-0060 (null until built). */
export interface ApiRagnarokEinherjar {
  id: string;
  playerId: string;
  unitName: string;
  seasonDevoted: number | null;
  devotedAt: string;
  counts: { bps: number; pos: number; sis: number };
  score: number;
  perSeason: Array<{ season: number; battles: unknown[] }>;
  emblems: string[];
  bioArchive: unknown | null;
}

/** GET /api/ragnarok/einherjar?player= -- newest first. ?player=
 * defaults to the caller; any registered player may be queried (hall
 * records are public, same visibility as the order's name column);
 * unknown player -> 404. */
export interface ApiRagnarokEinherjarResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  playerId: string;
  einherjar: ApiRagnarokEinherjar[];
}

/** The itemized blast radius: how many BPs/POs/SIs the rite destroys
 * (account-wide -- inventory homes AND every other preset's shared
 * references; REQ-0033 reference model), and which OTHER presets lose
 * pieces (`affectedPresets`, PRE-rite indices -- the rite deletes a
 * slot, so later indices shift left by one afterwards). */
export interface ApiRagnarokBlast {
  bps: number;
  pos: number;
  sis: number;
  total: number;
  affectedPresets: Array<{
    index: number;
    name: string;
    lostBps: number;
    lostPos: number;
    lostSis: number;
  }>;
}

/** The order projection shown on the preview (mock: 此度の献身による
 * 序列予測): einherjarCount+1 re-ranked against the current
 * (dawn-cached) order. `topPercentile` = ceil(projectedRank/totalAfter
 * *100), "you would stand within the top N%". An ESTIMATE against a
 * snapshot, not a promise. Degenerate-safe: an empty order projects
 * rank 1 of 1 / top 100%; `currentRank` is null when unranked. */
export interface ApiRagnarokProjection {
  currentRank: number | null;
  projectedRank: number;
  totalAfter: number;
  topPercentile: number | null;
  einherjarCountAfter: number;
}

/** GET /api/ragnarok/devotion/preview/:presetIndex -- read-only.
 * Ineligibility is DATA (eligible:false + reasons[]), not an error
 * status; only an unaddressable preset 404s (no-leak: out-of-range and
 * malformed indices are indistinguishable). Reasons vocabulary:
 * mid_rite / last_preset / empty_unit / deployed. */
export interface ApiRagnarokDevotionPreviewResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  preset: { index: number; name: string };
  eligible: boolean;
  reasons: Array<'mid_rite' | 'last_preset' | 'empty_unit' | 'deployed'>;
  blast: ApiRagnarokBlast;
  projection: ApiRagnarokProjection;
}

/** POST /api/ragnarok/devotion/:presetIndex -- THE rite, irreversible.
 * No request body; optional Idempotency-Key header dedupes retries
 * (replayed:true returns the ORIGINAL record without a second rite).
 * After a 200 the caller's canvas was rewritten SERVER-side (preset
 * slot deleted + every referenced item destroyed account-wide -- the
 * documented rule-5 divergence, market-settlement precedent): the
 * client MUST re-GET its profile before its next auto-save PUT, or a
 * stale in-flight auto-save can resurrect the destroyed items
 * (REQ-0041's documented auto-save race class). Failure statuses:
 * 404 preset not found (no-leak); 409 {reason} with reason one of
 * mid_rite / last_preset / empty_unit / deployed. */
export interface ApiRagnarokDevotionResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  replayed: boolean;
  einherjar: ApiRagnarokEinherjar;
  blast: ApiRagnarokBlast;
}

// ---- REQ-0052: Dex Card API ----
// Wire shape for GET /api/dex/card/:kind/:id (server/routes/dex.cjs).
// `kind:'bp'` is NOT yet a member here -- rolled Blueprint instances have
// no static content def to key off of (see dex.cjs's module comment);
// only item/si/tm are servable through this id-keyed public GET today.
export interface ApiDexCardDto {
  v: 1;
  kind: 'item' | 'si' | 'tm';
  id: string;
  name: string;
  name_ja?: string;
  i18n?: ApiI18nMap;
  rarity: string;
  icon: string;
  flavor?: string;
  flavor_ja?: string;
  eff_en?: string;
  eff_ja?: string;
  // kind:'item' only
  tags?: string[];
  shape?: Array<[number, number]>;
  sockets?: ApiSocketDef[];
  ports?: ApiPortDef[];
  stretch?: boolean;
  part?: { assembles: string; role: string };
  // kind:'si' only (also reuses `ports` above)
  slot?: string;
  reqTags?: string[];
  // kind:'tm' only
  short?: string;
  stackable?: boolean;
}
