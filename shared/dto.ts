// shared/dto.ts -- REQ-0047 (f2): THE wire-shape DTO types for the HTTP
// API (request/response bodies as served by server/api.cjs + routes/).
// Moved VERBATIM from client/src/api.ts, which re-exports them so every
// existing client import keeps working. Server-side JSDoc can reference
// these via import('../shared/dto') types. Types only -- no runtime code.
// Rules: shared/ may not import from client/, server/, sim/, mock-src/
// -- the one exception is shared/engine.d.ts (also in shared/).
import type { GameState, Layout, Cell, Offset, BPUnit } from './engine.d.ts';

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
  align?: { v?: 'top' | 'middle' | 'bottom'; h?: 'left' | 'center' | 'right' };
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

// REQ-0051: starter-unit definitions (content/live/starter_units.json),
// served on the /api/content payload. The client boot seed (fresh profile)
// and the regrant flow build the 4 starter units (5x5 BPs, connection_shape none) from this.
export interface ApiStarterUnitPO {
  id: string;
  cell: Cell;
  rot: number;
}
export interface ApiStarterUnit {
  id: string;
  name: string;
  i18n?: { ja?: { name?: string } };
  color: string;
  pos: ApiStarterUnitPO[];
}
export interface ApiStarterUnits {
  schema: string;
  hpMax: number;
  bpShape: Offset[];
  origin: Cell;
  unit: BPUnit;
  units: ApiStarterUnit[];
}

/** REQ-0170: a unit/1 def as served. `charge`/`effects` are absent BY DESIGN --
 * frozen in vocab, unimplemented in the engine (see REQ-0170 section 2.3). */
export interface ApiUnitEntry {
  id: string;
  name: string;
  name_ja?: string;
  rarity: string;
  /** Artwork system_name -- a FREE reference (two units may share one artwork). */
  icon: string;
  connection_shape: string;
  flavor?: string;
  flavor_ja?: string;
  i18n?: { ja?: { name?: string; flavor?: string } };
}

/** REQ-0170: a gacha_pack/1 def as served -- the emission pool the Workshop
 * rolls against. Served so the client shows the SAME cost/pool the server rolls
 * with, instead of a display constant that can drift. REQ-0171 makes these
 * authorable in the content admin. */
export interface ApiPackEntry {
  id: string;
  name: string;
  name_ja?: string;
  cost: number;
  cost_tm?: string;
  cells?: [number, number];
  hp_per_cell?: number;
  pool: Array<{ unit: string; weight: number }>;
  /** REQ-0062: 0..2 bonus slots -- the synergy bundle (PO / SI lens / TM) that rides
   * atop the guaranteed Backpack. Each slot draws one weighted entry from its own
   * transparent-odds table (surfaced on the pack Dex card + Workshop odds view). */
  bonus?: Array<{ pool: 'po' | 'si' | 'tm'; table: Array<{ id: string; weight: number; qty?: number }> }>;
  i18n?: { ja?: { name?: string } };
}

/** REQ-0208: a monster_def (enemy/1 dialect) as served for the Dex -- the
 * display slice of the SAME registry-first payload the sim fights with
 * (services/core.cjs getScheduleContent; see server/lib/content.cjs
 * monstersFromCore). `hp` is the [min,max] roll band; `footprint` is [w,h]
 * in cells (the REQ-0188 drift guard keeps the def field in agreement with
 * the linked artwork). `skills` are skill ids; display names resolve through
 * ApiContentPayload.monster_skills. */
export interface ApiMonsterEntry {
  id: string;
  name: string;
  name_ja?: string;
  /** enemy/1 dialect: lowercase (common/uncommon/rare/relic). */
  rarity: string;
  hp?: [number, number];
  footprint?: [number, number];
  skills?: string[];
  pack_role?: string;
  i18n?: { en?: { name?: string }; ja?: { name?: string } };
}

/** REQ-0208: display names for one skill id referenced by a served monster. */
export interface ApiSkillName {
  name: string;
  name_ja?: string;
}

/** REQ-0170 / REQ-0128b: one entry of vocab.json's connection_shapes table. */
export interface ApiConnShape {
  kind: 'ray' | 'offset' | 'none';
  ja?: string;
  dirs?: number[];
  range?: number | null;
  pierce?: boolean;
  offsets?: Array<[number, number]>;
  note?: string;
}

export interface ApiContentPayload {
  items: Record<string, ApiItemEntry>;
  sis: Record<string, ApiSIEntry>;
  tms: Record<string, ApiTmEntry>; // REQ-0042
  units: Record<string, ApiUnitEntry>; // REQ-0170
  packs: Record<string, ApiPackEntry>; // REQ-0170
  monsters: Record<string, ApiMonsterEntry>; // REQ-0208
  monster_skills: Record<string, ApiSkillName>; // REQ-0208
  connection_shapes: Record<string, ApiConnShape>; // REQ-0170
  trees: ApiTrees;
  scenario: ApiScenario;
  layout: Layout | null;
  registry: ApiRegistry | null;
  vocab: ApiVocabLists;
  starterUnits?: ApiStarterUnits | null; // REQ-0051
  /** REQ-0133 registry-first item art. A payload-level map from a served
   * entity id (po/si/tm -- one-name-one-entity, globally unique) to the
   * RESOLVED adopted-render URL (`/api/art/<artwork>.png`), following the chain
   * def.artwork_ref adopted -> exact-name artwork adopted (computed server-side
   * at the storage chokepoint). ADDITIVE + SPARSE: only ids that resolve to an
   * adopted render appear; an ABSENT id means "no registry art" and the client
   * falls back to the SVG sprite icon (the `icon` field) -- that fallback tier is
   * the client's, not the server's. Chosen over a per-entry `art_url` because it
   * is one small object the client reads once, keeps every existing entry shape
   * byte-unchanged, and is empty (not per-entry noise) under the files backend
   * where the registry is unavailable. */
  art_urls?: Record<string, string>;
}

// REQ-0178: per-section source accounting for registry-first /api/content
// serving (Phase 1: po/si/tm). Reported by GET /api/content/dev/sources -- a
// dev/meta endpoint, deliberately NOT folded into the /api/content payload so
// the served shape stays byte-identical under an empty registry tier. `registry`
// = entities served from an adopted registry variant; `fallback_file` = entities
// served from the live-file entry (no adopted variant); `file_only_names` = the
// fallback ids, so drift is observable.
export interface ContentSourceAccounting {
  registry: number;
  fallback_file: number;
  file_only_names: string[];
}
export interface ApiContentSourcesResponse {
  ok: true;
  backend: 'pg' | 'files';
  covered_kinds: { items: 'po_def'; sis: 'si_def'; tms: 'tm_def' };
  items: ContentSourceAccounting;
  sis: ContentSourceAccounting;
  tms: ContentSourceAccounting;
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

/** One squad slot (golden b) -- `squadIndex` is one of the OWNER's own
 * squad indices (0-based), or null if unfilled. */
export interface ApiRoomSlot {
  squadIndex: number | null;
}

/** A queued swap (golden j) -- present once `PUT .../swap` is queued
 * (`applied:false`) while a run is active; cleared once the queued swap
 * is applied at the next run settle. */
export interface ApiPendingSwap {
  slot: number;
  squadIndex: number;
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
  /** REQ-0058: when set, this room is a sealed-seed run -- its dungeon
   * tuple was copied verbatim from the shared seal (this sealId) and its
   * run is single-shot (it never auto-restarts). Absent on a normal room. */
  sealId?: string;
  /** REQ-0058: the seal's frozen affixes (REQ-0055), copied verbatim.
   * Present (possibly []) only on a sealed-seed room. */
  affixes?: string[];
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
  /** REQ-0058: join a sealed run. When present, dungeonId/dungeonType/
   * level/genSeed are IGNORED -- the room copies the seal's frozen tuple
   * verbatim. One room per (sealId, caller); a second attempt 409s. */
  sealId?: string;
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

/** REQ-0058: public sealed-seed metadata (genSeed deliberately withheld --
 * the recipient never handles the raw seed; the server copies it into
 * their room server-side). */
export interface ApiSealMeta {
  sealId: string;
  createdBy: string;
  dungeonId: string;
  dungeonType?: 'default' | 'test_fixed';
  level: number;
  affixes: string[];
  createdAt: string;
}

/** POST /api/schedule/seal response. shareToken === seal.sealId (the
 * unguessable token a minter passes to friends). */
export interface ApiSealMintResponse {
  ok: true;
  seal: ApiSealMeta;
  shareToken: string;
}

/** GET /api/schedule/seals/:sealId response. */
export interface ApiSealMetaResponse {
  ok: true;
  seal: ApiSealMeta;
  participantCount: number;
  youAreParticipant: boolean;
  yourRoomId: string | null;
}

/** REQ-0058: one encounter's slice of a participant's comparison timeline. */
export interface ApiSealEncounter {
  enc: number;
  kind: string;
  startSecs: number;
  durationSecs: number;
  endPct: number;
}

/** REQ-0058: the comparison metrics distilled from a participant's run
 * (clear time / finishing H / per-encounter durations / damage taken /
 * attachments resolved). */
export interface ApiSealTimeline {
  result: 'victory' | 'wipe' | 'incomplete';
  clearTimeSecs: number;
  finishingH: number | null;
  levelAfter: number | null;
  finalProgressPct: number | null;
  damageTaken: number;
  attachmentsResolved: number;
  encounters: ApiSealEncounter[];
}

/** REQ-0058: one participant's entry in the comparison view. */
export interface ApiSealParticipant {
  playerId: string;
  isSelf: boolean;
  roomId: string;
  hasRun: boolean;
  settled: boolean;
  runId: string | null;
  timeline: ApiSealTimeline | null;
}

/** GET /api/schedule/seals/:sealId/comparison response. Anti-spoiler:
 * `participants` is empty (and `unlocked` false) until the caller's own
 * run of this sealId settles; `self` is always present. */
export interface ApiSealComparison {
  ok: true;
  sealId: string;
  seal: ApiSealMeta;
  unlocked: boolean;
  participantCount: number;
  self: ApiSealParticipant;
  participants: ApiSealParticipant[];
}

/** GET /api/schedule/seals/:sealId/runs/:playerId response (seal-scoped
 * replay -- own always readable; another participant's is gated on the
 * caller's own settle). */
export interface ApiSealReplay {
  ok: true;
  sealId: string;
  playerId: string;
  roomId: string;
  runId: string;
  result: 'victory' | 'wipe' | 'incomplete';
  durationSecs: number;
  finalProgressPct: number;
  H: number;
  levelAfter: number;
  settled: boolean;
  events: ApiRunEvent[];
  timeline: ApiSealTimeline;
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
/** REQ-0057: ONE (enemy, skill) attack profile the Ray Forecast Overlay
 * walks. Everything the client needs to fire that skill's ray at the player
 * field itself -- entry projection base (the attacker's centroid on the enemy
 * plane), the attack profile's edge/penetration/aoe, the expected damage of
 * one firing, and how often it fires. Derived from enemy DEFs only; it can
 * never carry a specific run's hidden placements (REQ-0057: "forecast !=
 * spoiler"). See server/lib/forecast.cjs for the fold that produces it and
 * shared/forecast.mjs for the walk that consumes it. */
export interface ApiForecastProfile {
  /** Stable id: "<enemyId>#<skillId>@<row>,<col>". */
  key: string;
  enemyId: string;
  skillId: string;
  /** The SKILL's display name. */
  i18n?: ApiI18nMap;
  /** The ENEMY's display name. */
  enemyI18n?: ApiI18nMap;
  /** Attacker centroid on the ENEMY plane (the entry projection's base). */
  centroid: [number, number];
  /** Expected number of THIS attacker present in a randomly drawn battle. */
  weight: number;
  /** attack_profile.edge -- which side(s) of the player field the ray enters from. */
  edges: string[];
  penetration: number;
  aoe: number;
  aoeStatuses?: boolean;
  /** Expected damage of one firing at bounce multiplier 1.0 (0 for a status ray). */
  damage: number;
  /** Expected firings per second (1 / midpoint of the every_secs range). */
  rate: number;
  /** True when the verb deals no damage (apply_status / add_on_hit_status). */
  statusOnly?: boolean;
}

/** REQ-0057: GET /api/schedule/forecast?dungeonType=&level=. */
export interface ApiForecastPayload {
  ok: true;
  dungeonType: string;
  level: number;
  /** How many dungen seeds the profiles were marginalised over. */
  sampleSeeds: number;
  /** How many battle encounters that sampling produced (the weight denominator). */
  battlesSampled: number;
  /** The shared A1:Z18 field the rays are fired ONTO. */
  bounds: { ROWS: number; COLS: number };
  /** sim TUNABLES.ENTRY_JITTER_HALF_WIDTH -- the entry-jitter half-width J. */
  jitterHalfWidth: number;
  formations: ApiFormationEntry[];
  profiles: ApiForecastProfile[];
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
/** REQ-0195d: the full BP (unit) instance payload carried on a kind:'bp'
 * warehouse row (a bought unit). Delivered verbatim from the seller's
 * canvas BP and placed via lib/placement firstFitPlaceBp on claim; never
 * re-rolled. Extra verbatim fields (name/color/cellCount/bonuses/roll)
 * are merged onto the placed BP by the claim path. */
export interface ApiWarehouseBp {
  shape: Array<[number, number]>;
  unit: { id: string; off: [number, number] };
  hpMax: number;
  cellCount?: number;
  bonuses?: unknown[];
  name?: string;
  color?: string;
  origin?: [number, number];
  /** REQ-0196 roll container, when minted; carried verbatim. */
  roll?: { pct: number };
  id?: string;
}

export interface ApiWarehouseItem {
  itemUid: string;
  playerId: string;
  itemId: string;
  harvestedAt: string;
  expiresAt: string;
  sourceRoomId: string;
  sourceRunId: string;
  /** REQ-0042/0195d: 'tm' for a TM-stack row, 'bp' for a bought unit
   * (BP) row -- absent for a plain PO/SI row. */
  kind?: 'tm' | 'bp';
  /** REQ-0195d: for kind:'bp' rows -- the verbatim BP instance payload. */
  bp?: ApiWarehouseBp;
  /** REQ-0042: TM-kind rows carry a stack quantity. Absent for a plain
   * PO/SI row (those are always singular). */
  qty?: number;
}


/** GET /api/schedule/dungeons -- no auth required (public read data,
 * matches /api/content's own no-auth convention). Used by the
 * create-room form's dungeon/formation selects. */


// ---- REQ-0064: Market wire shapes (server/routes/market.cjs) ----
// Every /api/market response envelope carries `dtoVersion:
// MARKET_DTO_VERSION` (currently 2; server/services/market/lib.cjs owns
// the runtime constant -- shared/dto.ts is types-only by rule). Bump the
// literal here AND there together whenever a market wire shape changes
// incompatibly.
export type MarketDtoVersion = 2;

/** Law 1 ("barter in kind"): a price is an integer qty of ONE TM. That
 * tm is one of the live TM registry ids the LISTINGS envelope returns as
 * `tms[]` (content/live/live_tms.json); 'lrdst' is the sole live entry
 * today. Prices carved in different TMs never mix. */
export interface ApiMarketPrice {
  tm: string;
  qty: number;
}

/** One settled-price engraving from the Dex price history (rolling
 * last-5 per itemId, newest first). */
export interface ApiMarketPriceHistoryEntry {
  qty: number;
  /** REQ-0195a: the TM this price was denominated in. Prices in
   * different TMs never mix; the client anchor shows only entries whose
   * tm matches the currently-chosen price TM. Legacy entries read lrdst. */
  tm: string;
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
  /** REQ-0195b: the listed instance uid (po.uid / si.uid / bp.id), or
   * null for kind:'tm' (currency has no per-instance uid). */
  itemUid: string | null;
  /** REQ-0195a: the tradeable content kind. 'po' today (legacy listings,
   * which predate the field, normalize to 'po' at read); si/unit/tm land
   * in REQ-0195b-d. */
  kind: 'po' | 'si' | 'unit' | 'tm';
  /** REQ-0195b: for kind:'tm' only -- the integer amount of `itemId` (a
   * live TM) being sold, [1,999]. Absent for po/si/unit. */
  tmQty?: number;
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
  /** REQ-0195e: the roll-fulfillment fraction of the listed instance
   * (min=0, max=1), DTO-derived (never stored on the listing) -- po/si:
   * the instance q (REQ-0063); unit: bp.roll?.pct (the REQ-0196
   * container) else null; tm: null. A SETTLED listing carries the value
   * FROZEN at settle time (the live instance is gone by then), so
   * MinePane history stays honest. null renders as the "unmeasured"
   * badge (units) or nothing (tm); a number renders a 0-100% fill bar. */
  rollPct: number | null;
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
  /** REQ-0195a: the live TM registry ids (content/live/live_tms.json), in
   * display order -- the currency set every price.tm must draw from (was
   * the scalar `tm` at dtoVersion 1). 'lrdst' is the sole entry today. */
  tms: string[];
  listings: ApiMarketListing[];
}

/** POST /api/market/listings request body. `price.tm` must equal the
 * market TM id; qty an integer in [1, 999]. Optional Idempotency-Key
 * HEADER dedupes retries (replayed:true on the response). */
export interface ApiMarketCreateListingRequest {
  /** REQ-0195a: 'po' (the default when omitted); tm in REQ-0195b;
   * si/unit in REQ-0195c-d. */
  kind?: 'po' | 'si' | 'unit' | 'tm';
  /** po/si/unit: the instance uid to list. Absent for kind:'tm'. */
  itemUid?: string;
  /** kind:'tm': the live TM content id being sold. */
  itemId?: string;
  /** kind:'tm': the integer amount to sell, [1,999]. */
  tmQty?: number;
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
  /** REQ-0195a: per-TM burn rows (burns in different TMs never mix). One
   * row per TM that burned in the window; empty when nothing burned.
   * `since` is the season-window start (REQ-0066), null on the all-time
   * fallback. */
  furnace: {
    totals: { tm: string; total: number; count: number }[];
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
 * is deliberately NOT on the wire (server-side until a later squad needs
 * it); `counts` echoes what was devoted (mock: 鞄 3 ・ 物品 17 ・ 型 3 =
 * bps/pos/sis). `perSeason` is the 戦果 history REQ-0068 will append
 * ({season, battles:[...]}); empty today. `bioArchive` is reserved for
 * REQ-0060 (null until built). */
export interface ApiRagnarokEinherjar {
  id: string;
  playerId: string;
  squadName: string;
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
 * (account-wide -- inventory homes AND every other squad's shared
 * references; REQ-0033 reference model), and which OTHER squads lose
 * pieces (`affectedSquads`, PRE-rite indices -- the rite deletes a
 * slot, so later indices shift left by one afterwards). */
export interface ApiRagnarokBlast {
  bps: number;
  pos: number;
  sis: number;
  total: number;
  affectedSquads: Array<{
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

/** GET /api/ragnarok/devotion/preview/:squadIndex -- read-only.
 * Ineligibility is DATA (eligible:false + reasons[]), not an error
 * status; only an unaddressable squad 404s (no-leak: out-of-range and
 * malformed indices are indistinguishable). Reasons vocabulary:
 * mid_rite / last_squad / empty_squad / deployed. */
export interface ApiRagnarokDevotionPreviewResponse {
  ok: true;
  dtoVersion: RagnarokDtoVersion;
  squad: { index: number; name: string };
  eligible: boolean;
  reasons: Array<'mid_rite' | 'last_squad' | 'empty_squad' | 'deployed'>;
  blast: ApiRagnarokBlast;
  projection: ApiRagnarokProjection;
}

/** POST /api/ragnarok/devotion/:squadIndex -- THE rite, irreversible.
 * No request body; optional Idempotency-Key header dedupes retries
 * (replayed:true returns the ORIGINAL record without a second rite).
 * After a 200 the caller's canvas was rewritten SERVER-side (squad
 * slot deleted + every referenced item destroyed account-wide -- the
 * documented rule-5 divergence, market-settlement precedent): the
 * client MUST re-GET its profile before its next auto-save PUT, or a
 * stale in-flight auto-save can resurrect the destroyed items
 * (REQ-0041's documented auto-save race class). Failure statuses:
 * 404 squad not found (no-leak); 409 {reason} with reason one of
 * mid_rite / last_squad / empty_squad / deployed. */
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
// REQ-0227: unit/monster joined the servable kinds -- their slices mirror
// the REQ-0208 catalog detail panes (see dex.cjs's buildCardDto branches).
export interface ApiDexCardDto {
  v: 1;
  kind: 'item' | 'si' | 'tm' | 'unit' | 'monster';
  id: string;
  name: string;
  name_ja?: string;
  i18n?: ApiI18nMap;
  rarity: string;
  /** REQ-0227: absent for kind:'monster' (monster art resolves by id via
   * the art_urls map, not an icon ref); for kind:'unit' this is an
   * artwork system_name reference (unitArtUrl), never a sprite id. */
  icon?: string;
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
  align?: { v?: 'top' | 'middle' | 'bottom'; h?: 'left' | 'center' | 'right' };
  part?: { assembles: string; role: string };
  // kind:'si' only (also reuses `ports` above)
  slot?: string;
  reqTags?: string[];
  // kind:'tm' only
  short?: string;
  stackable?: boolean;
  // kind:'unit' only (REQ-0227) -- the referenced connection_shapes vocab
  // entry rides along so a zero-context consumer can label the connection
  // the same way the catalog does (lib/connShapeLabel).
  connection_shape?: string;
  connection_shape_def?: ApiConnShape;
  // kind:'monster' only (REQ-0227) -- skill display names ride along,
  // keyed by skill id, LIMITED to the ids this monster references.
  hp?: [number, number];
  footprint?: [number, number];
  skills?: string[];
  pack_role?: string;
  skill_names?: Record<string, ApiSkillName>;
  // REQ-0063: the CALLER's own 分解値 (dismantle count) + current
  // mechanical suppression for this id. kind:'item'|'si' only (kind:'tm'
  // can never be dismantled); also absent when no caller could be
  // resolved from the request (keeps the base card fully public/
  // anonymous-safe -- see server/routes/dex.cjs's tryReadDismantleInfo).
  dismantle?: { count: number; suppression: number };
}

// ---- REQ-0063: Dismantle System ----
// Wire shapes for POST /api/dismantle and GET /api/dismantle/ledger
// (server/routes/dismantle.cjs).
export interface ApiDismantleYield {
  tmId: string;
  qty: number;
}
export interface ApiDismantleResponse {
  ok: true;
  itemId: string;
  dismantleCount: number;
  suppression: number;
  yield: ApiDismantleYield;
}
export interface ApiDismantleLedgerEntry {
  itemId: string;
  dismantleCount: number;
  suppression: number;
}
export interface ApiDismantleLedgerResponse {
  ok: true;
  entries: ApiDismantleLedgerEntry[];
}
