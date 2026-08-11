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

/** REQ-0211: a gimic/1 def as served for the Dex -- the interactable dungeon
 * gimmicks (trap / treasure box / hidden door). Display slice of the SAME
 * registry-first payload the dungeon generator consumes (services/core.cjs
 * getScheduleContent; see server/lib/content.cjs gimicsFromCore). `behavior`
 * is the coarse family; `type`/`mode` are the fine-grained engine interaction
 * subtype; `footprint` is [fh,fw] in cells; `skills` are ids resolved through
 * ApiContentPayload.gimic_skills. */
export interface ApiGimicEntry {
  id: string;
  name: string;
  name_ja?: string;
  /** trap | treasure | hidden_door -- the registry-facing family discriminator. */
  behavior: string;
  /** engine subtype: trap | door_stage1 | door_stage2 | chest. */
  type?: string;
  /** detection (found) | unlock (opened). */
  mode?: string;
  hp?: number;
  footprint?: [number, number];
  masked?: boolean;
  timeout_secs?: number;
  skills?: string[];
  i18n?: { en?: { name?: string }; ja?: { name?: string } };
}

/** REQ-0266: a unit_skin/1 def as served -- a COSMETIC skin. ONE content kind
 * carries both meanings (ruling D1): `slot` is the discriminator, and it must
 * agree with the KIND of the artwork `art_ref` names -- "unit" dresses a unit
 * PORTRAIT, "bpskin" dresses a BACKPACK. Display slice of the SAME
 * registry-first payload the resolution chains consume (services/core.cjs
 * getScheduleContent; see server/lib/content.cjs unitSkinsFromCore).
 *
 * The resolved artwork URL is NOT on the entry: it arrives through
 * ApiContentPayload.art_urls keyed by this def's own `id` (D-A), which is what
 * keeps /api/content free of per-player state. The player's PICK is a separate,
 * authenticated fetch (GET /api/profile/:id/skins). */
export interface ApiUnitSkinEntry {
  id: string;
  name: string;
  name_ja?: string;
  /** unit | bpskin -- the D1 discriminator; equals the referenced artwork's kind. */
  slot: string;
  /** Artwork system_name -- a FREE reference (two skins may share one artwork). */
  art_ref: string;
  /** The unit def ids this skin may dress. Non-empty; no wildcard (D3). */
  units: string[];
  /** When true, the fall-back skin for every unit in `units[]` FOR ITS SLOT.
   * At most one default per (unit, slot). */
  default?: boolean;
  /** Optional grouping key -- how a unit skin and a BP skin are paired as a SET
   * (golden G6). The field ships here; the pairing logic does not (REQ-0266 s9). */
  set?: string;
  i18n?: { ja?: { name?: string } };
}

/** REQ-0126: one `bpskin/1` def as served in ApiContentPayload.bpskins. This
 * mirrors client/src/board/skin/skinRegistry.ts's BpSkinDef -- shared/ may not
 * import out of shared/, so the wire shape is DECLARED here and the client's
 * loadSkinDefs() re-validates it structurally at the seam (a UGC-ready gate,
 * which is why the two are deliberately not one type). Palette-procedural by
 * default; `art.fill_texture` names the raster a skin paints with when it has one. */
export interface ApiBpSkinEntry {
  kind: string;
  id: string;
  name: string;
  i18n?: { ja?: { name?: string } };
  set?: string | null;
  palette: { canvas?: string; fill: string; fill2?: string; welt?: string };
  corner_radius: number;
  border_band: number;
  art?: {
    fill_texture?: string | null;
    tile_fill_override?: string | null;
    edge_tiles?: { straight?: string; outer_corner?: string; inner_corner?: string };
    clip_masks?: { straight?: string; outer_corner?: string; inner_corner?: string };
  };
  neutral?: boolean;
}

/** REQ-0126: the served bpskin registry, in the SAME {entries:[...]} envelope
 * content/live/live_bpskins.json has on disk (an absent/unreadable file degrades
 * to {entries: []} server-side, never a 500). */
export interface ApiBpSkinRegistry {
  entries: ApiBpSkinEntry[];
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
  gimics: Record<string, ApiGimicEntry>; // REQ-0211
  gimic_skills: Record<string, ApiSkillName>; // REQ-0211
  unit_skins: Record<string, ApiUnitSkinEntry>; // REQ-0266: cosmetic skin defs, keyed by SKIN id
  /** REQ-0126: the bpskin/1 registry, keyed by nothing -- it is served as the raw
   * {entries:[...]} document the client's loadSkinDefs() consumes. SERVED SINCE
   * REQ-0126 (server/lib/content.cjs) but never DECLARED until REQ-0266, so
   * gameDataFromApiContent dropped it on the floor; the BP skin binding needs it. */
  bpskins: ApiBpSkinRegistry; // REQ-0126, declared by REQ-0266
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


/** GET /api/health -- the public service identity. REQ-0377 item 2 added
 * `build`: the short commit sha of the tree the API process runs from, or
 * the literal 'unknown' when it could not be resolved (never absent, never
 * empty). The main checkout @ master IS live and serves web/app and this API
 * from one tree, so this doubles as the identity of the served client. */
export interface ApiHealth {
  ok: true;
  version: string;
  build: string;
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
  /** REQ-0324/0337: a co-op TROOP seat also records WHO took it. Absent on a
   * solo room's slot (which is `{squadIndex}` and nothing else -- its owner is
   * the room's ownerId by definition). Present on every seat of a
   * `visibility:'public'` Troop, where `squadIndex` indexes THAT owner's own
   * canvas, NOT the reader's -- never resolve it against your own squad names
   * unless `ownerId` is you. */
  ownerId?: string;
  joinedAt?: string;
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
/** REQ-0239 (design B1): a compact wall-clock window for a room's active/last
 * run, attached to each room in the LIST response so the squad status board can
 * draw honest run progress + a return time WITHOUT an N+1 GET .../run per room. */
export interface ApiRoomLastRun {
  runId: string;
  startedAt: string;
  durationSecs: number;
  settled: boolean;
}

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
  /** REQ-0324/0337: 'public' marks a co-operative TROOP. GET /api/schedule/rooms
   * filters by ownerId ONLY (services/rooms.cjs listOwnRooms) -- it does NOT
   * filter on visibility -- so a Troop the caller HOSTS is returned by that list
   * alongside their solo rooms, and every consumer of ApiRoom must tolerate it. */
  visibility: 'self' | 'public';
  formationId: string;
  cancelPolicy: ApiCancelPolicy;
  slots: ApiRoomSlot[];
  /** REQ-0324 keeps a Troop's `status` OFF the solo 'open'/'active' lanes while it
   * recruits, so the lazy run-scheduler + the market Law-of-Possession gate treat
   * it inertly. It rejoins the normal lanes ('active', then 'canceled') once the
   * fourth seat fills and it departs. */
  status: 'open' | 'active' | 'canceled' | 'recruiting';
  /** REQ-0324: the Troop-level lifecycle, present only when visibility is
   * 'public'. Distinct from `status` above (which the run engine owns). */
  state?: 'recruiting' | 'active' | 'canceled';
  /** REQ-0324: the hosting player (== ownerId; kept as an alias). Troops only. */
  hostId?: string;
  cancelRequested: boolean;
  pendingSwap: ApiPendingSwap | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunId: string | null;
  /** REQ-0304: the seed the dungeon was DRAWN with (uniform among
   * levelMin <= attackLv). Always present on a post-REQ-0304 room; only a
   * dev/item_admin caller may have CHOSEN it (see ApiCreateRoomBody.drawSeed). */
  drawSeed?: string;
  /** REQ-0239 (B1): the active/last run's compact window, present on rooms LIST
   * and single-room GET responses when lastRunId is set; null/absent otherwise. */
  lastRun?: ApiRoomLastRun | null;
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
  /** REQ-0304: OPTIONAL now. Absent -> the server RANDOM-DRAWS a dungeon among
   * those whose levelMin <= level (attackLv). Present -> a validated,
   * privileged/test OVERRIDE of the draw (back-compat: legacy rooms, seals,
   * tools); a normal player UI no longer sends it. */
  dungeonId?: string;
  dungeonType?: 'default' | 'test_fixed';
  level?: number;
  genSeed?: string;
  /** REQ-0304: pin WHICH dungeon the random draw selects (reproducible).
   * Server-side GATED to a dev/item_admin caller, EXACTLY like genSeed (403 for
   * anyone else who sends a non-empty drawSeed). */
  drawSeed?: string;
  formationId?: string;
  cancelPolicy?: ApiCancelPolicy;
  /** REQ-0058: join a sealed run. When present, dungeonId/dungeonType/
   * level/genSeed are IGNORED -- the room copies the seal's frozen tuple
   * verbatim. One room per (sealId, caller); a second attempt 409s. */
  sealId?: string;
}

/** POST /api/schedule/sorties body -- REQ-0239 (D1). One atomic call that
 * creates a room, fills all four squad slots, and launches. cancelPolicy
 * defaults to the deferred {immediate:false} (golden g) when omitted. */
export interface ApiSortieBody {
  /** REQ-0304: OPTIONAL -- absent triggers the server's levelMin-gated random
   * draw (the player sets only attackLv = level). Present is a privileged override. */
  dungeonId?: string;
  level?: number;
  formationId?: string;
  cancelPolicy?: ApiCancelPolicy;
  genSeed?: string;
  /** REQ-0304: privileged draw-seed override (gated like genSeed). */
  drawSeed?: string;
  /** the four squad indices, one per troop slot (order = slot 0..3). */
  squadIndices: number[];
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
  /** REQ-0240: presentation time (ms) assigned by the server pacing pass.
   * Present on paced runs (ApiRunView.pacingVersion >= 1); absent on legacy
   * runs (the client then replays on sim `t`). */
  pt?: number;
  /** REQ-0240: on the representative of a coalesced same-target burst -- the
   * feed prints one "xN" line / the stage one summed damage number. */
  pcoalesce?: { hits: number; amount: number };
  /** REQ-0240: a non-representative member of a coalesced burst -- feed/stage
   * skip it (its damage is folded into the representative's pcoalesce). */
  pcoalesceHidden?: boolean;
  /** REQ-0276 A2(ii): on a ray_hit (and on each ray_aoe / ray_hit_all hits[]
   * member), the index into ApiRunRoster.enemies of the struck enemy --
   * resolved server-side from the UNMASKED `dst`. Absent when dst is masked
   * ('?') or is not a roster enemy (e.g. a gimic att id). */
  enemyIdx?: number;
  /** REQ-0276 A2(iii): on att_* events (att_fire/att_reveal/att_disarm/att_open/
   * att_lost), the source gimic content id (e.g. "trap_frost_deadfall") for
   * art/badge binding; the class glyph (from `kind`) is the fallback. */
  gimicId?: string;
  /** REQ-0276 A2(iv): on unit_charge_* events, the squad slot index (0..3) of
   * the charging BP, so dock/stage charge pips can light. REQ-0292: ALSO present
   * on a player CADENCE `ray_fire` (the firing BP's 0..3 squad index) so the HUD
   * places the item-cooldown overlay on the right squad board, paired with the
   * item id already in `src`. Absent on enemy ray_fire (which use `srcInst`). */
  slot?: number;
  /** REQ-0355: on a player-target ray_hit / apply_status / status_tick (and on
   * each ray_aoe / ray_hit_all hits[] member), the struck BP's index within its
   * squad's bps -- with `slot` this joins back to ApiRunRosterSlot.bps[bpIdx],
   * so the dock can drain per-seat HP mid-run (previously full bars until
   * run_end). Absent on enemy-target events and on pre-REQ-0355 runs. */
  bpIdx?: number;
  /** REQ-0355: serve-time stamp (decorateVisible) of the owning ray's target
   * field onto ray_hit / ray_aoe / ray_hit_all copies -- 'player' | 'enemy'.
   * The stored sim log carries `field` only on ray_fire. */
  field?: string;
  /** REQ-0280 / REQ-0264 s9.2: on a `ray_fire`, the skills.json skill-def id of
   * the firing skill. Present ONLY where one honestly exists -- enemy / trap /
   * door skills (threaded through sim compilation). ABSENT on player-item rays
   * (their identity is `src`, the item id) and on charge / synthesized rays.
   * Purely a per-skill VFX ART key (vfx_ray_<skill>); when absent the client
   * falls back to vfx_ray_<src> / vfx_ray_default. Additive: no consumer
   * requires it, and it draws no RNG. */
  skill?: string;
  /** REQ-0292 (cooldown ramp wire): on a CADENCE `ray_fire` (a fire that starts a
   * cooldown), the freshly rolled reset cooldown in TICKS. The client evaluates the
   * item-cooldown overlay / skill-badge sweep as a pure function of the pt clock:
   * frac_remaining(pt) = clamp01(1 - (pt - pt_fire)/(cooldownTicks*TICK_SECS)),
   * pt_fire = THIS event's pt (the fire IS the arm; REQ-0263 s6.4). Sent ONCE per
   * fire -- NO per-tick stream (~300k events avoided). ABSENT on reactive/pulse/
   * charge fires and one-shot trap volleys (they never re-arm); its PRESENCE is the
   * cadence discriminator (draw the cooldown overlay iff cooldownTicks is present). */
  cooldownTicks?: number;
  /** REQ-0292: on an ENEMY/GIMIC cadence `ray_fire`, the firing IBattleInstance id
   * (e.g. "hrimgrimnir#0"). `src` is the DEF id, ambiguous when a pack holds
   * duplicate defs, so a skill badge keys by srcInst+skill. Absent on player fires
   * (they key by slot+src) and on one-shot trap volleys. */
  srcInst?: string;
  /** REQ-0292 (charge ramp wire): on a unit_charge_spend/stack/transform event, the
   * instance charge counter at emit (0 right after a fire_on_full/transform spend;
   * the live counter on a passive_per_stack tick). */
  value?: number;
  /** REQ-0292: on a unit_charge_* event, the per-instance ROLLED capacity (full
   * mark). The client CANNOT derive it from content (per-instance roll -- midpoint
   * today, a true roll under REQ-0190), so it rides the wire; wedge frac = value/capacity. */
  capacity?: number;
  /** REQ-0292: on a unit_charge_* event for an every_secs charge, the fill rate in
   * counts/sec (1/period) the client interpolates the charge wedge against the pt
   * clock (value(pt) = value0 + rate*(pt - pt_emit); frac = value/capacity). OMITTED
   * for event-driven triggers (the counter jumps on combat events, not time -- and
   * no mid-ramp rate modifier exists in the runtime, so no rate-change event is sent). */
  rate?: number;
  [key: string]: unknown;
}

/** REQ-0240 M1: one squad slot's BP pool (exact hpMax) the monitor dock +
 * stage plates read. */
/** REQ-0355: the lean, frozen view of one seat's squad canvas as snapshotted
 * at startRun -- just what the Monitor needs to DRAW the seat (BP cells /
 * colour / unit disc + placed PO icons). Served for EVERY seat so a troop
 * member finally sees all four squads, not only their own. Null on legacy
 * runs stored before REQ-0355 and on empty seats. */
export interface ApiSeatCanvasBp {
  id: string;
  name: string | null;
  color: string | null;
  shape: [number, number][];
  origin: [number, number];
  unit: { id: string; off: [number, number] | null } | null;
}
export interface ApiSeatCanvasPo {
  id: string;
  loc: 'grid';
  cell: [number, number];
  rot: number;
}
export interface ApiSeatCanvas {
  bps: ApiSeatCanvasBp[];
  pos: ApiSeatCanvasPo[];
}
export interface ApiRunRosterSlot {
  slot: string; // 'unit1'..'unit4'
  index: number; // 0..3
  /** REQ-0355: bpIdx = index within this squad's own bps -- the join key
   * slot/bpIdx-attributed events (ray_hit / status_tick / aoe hits) carry. */
  bps: { id: string; hpMax: number; bpIdx?: number }[];
  canvas?: ApiSeatCanvas | null; // REQ-0355
}

/** REQ-0240 M1: one enemy the run will field -- a leak-safe HINT (the client
 * reveals name/HP only on first-seen). hpMax is the def's upper bound, so an
 * hp_after/hpMax tick is honest and never exceeds 100%. */
export interface ApiRunRosterEnemy {
  id: string;
  name: string;
  nameJa: string;
  hpMax: number;
  footprint: number[];
  packId: string | null;
  /** REQ-0276 A2(i): the SIM instance id (`<enemyId>#<index-in-pack-members>`,
   * e.g. "glacier_wisp#2") -- the join key ray_hit/ray_aoe hits carry as their
   * UNMASKED `dst`, and what ApiRunEvent.enemyIdx indexes back to. Optional:
   * absent on runs stored before REQ-0276, and on legacy cursor-fill packs. */
  instanceId?: string;
  /** REQ-0276 A2(i): the A1 top-left anchor this enemy stands on (e.g. "B2"),
   * verbatim from the pack member. null for a legacy cursor-fill layout. */
  at?: string | null;
  /** REQ-0276 A2(i): the absolute [row,col] cells this enemy occupies, DERIVED
   * server-side via the same authority the sim placer uses (content_validate
   * cellsFor) -- so the client draws the enemy formation at encounter_start
   * without re-deriving and without the [fh,fw] transpose hazard (REQ-0261
   * §8.2/§8.5). Empty for a legacy cursor-fill pack. */
  fieldCells?: [number, number][];
  /** REQ-0276 A2(i): true for a masked (trap/hidden) instance -- the client
   * shows a footprint silhouette until discovery. false for monsters. */
  masked?: boolean;
}

/** REQ-0240 M1: ApiRunView.roster -- per-slot player BP pools + enemy hints. */
export interface ApiRunRoster {
  slots: ApiRunRosterSlot[];
  enemies: ApiRunRosterEnemy[];
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
  /** REQ-0240 M2: 1 = server pacing applied (events carry `pt`; durationSecs
   * is the PRESENTATION duration); 0 = legacy run (replay on sim `t`). */
  pacingVersion: number;
  /** REQ-0240 M1: per-slot BP hpMax + enemy hints; null for a legacy run. */
  roster: ApiRunRoster | null;
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

/** REQ-0185: the authored expected composition of a dungeon def -- what the
 * sortie dossier (design D3) renders. Derived by rolling a representative
 * "scout" dive of the def server-side (sim/dungeon_roll.cjs diveSummary). */
export interface ApiDungeonEncounterSummary {
  /** Expected number of BATTLE (pack) encounters at the def's top level. */
  packs: number;
  /** Expected gimic attachments by class. */
  gimics: { trap: number; chest: number; door: number };
  /** The representative (top-weight) boss pack id. */
  bossPackId: string | null;
  /** Up to 5 resolved reward item ids the dive can drop. */
  lootPreview: string[];
}

/** GET /api/schedule/dungeons's per-dungeon/-formation entries. REQ-0185: a
 * dungeon is now an AUTHORED def (dungeon/1), so the entry carries the sortie
 * payload -- theme (design D2 glyph/accent), the recommended level band, and
 * the authored encounter summary (design D3). The fields beyond id/name/i18n
 * are optional so a legacy/minimal payload still typechecks. */
export interface ApiDungeonEntry {
  id: string;
  name: string;
  i18n?: ApiI18nMap;
  /** REQ-0185: short theme key -- 'frost'/'grave'/'wild'/... (design D2). */
  theme?: string;
  /** REQ-0185: recommended level band (advisory display; the server does NOT gate). */
  levelMin?: number;
  levelMax?: number;
  /** REQ-0185: the authored expected composition (design D3 dossier). */
  encounterSummary?: ApiDungeonEncounterSummary;
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
  /** REQ-0185: authored dungeon DEFS (each carrying theme, level band + an
   * encounterSummary). The retired sim/dungen.cjs `types` list is gone -- the
   * client picks a DEF, not a generator type. */
  dungeons: ApiDungeonEntry[];
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

/** REQ-0328: POST /api/market/listings/from-warehouse request body -- the
 * DIRECT warehouse->market sell. Consumes the CLAIMABLE warehouse row named
 * by `warehouseRowId` and creates an active listing WITHOUT routing through
 * the seller's canvas/inventory (the item is escrowed on the listing;
 * withdraw/expiry returns it to the warehouse, settlement delivers it to the
 * buyer). `price.tm` must be a live TM id; qty an integer in [1,999].
 * Optional Idempotency-Key HEADER dedupes retries (replayed:true on replay). */
export interface ApiMarketSellFromWarehouseRequest {
  warehouseRowId: string;
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
  align?: { v?: 'top' | 'middle' | 'bottom'; h?: 'left' | 'center' | 'right' };
  part?: { assembles: string; role: string };
  // kind:'si' only (also reuses `ports` above)
  slot?: string;
  reqTags?: string[];
  // kind:'tm' only
  short?: string;
  stackable?: boolean;
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

// ---- REQ-0327: Notification feed ----
// Wire shapes for GET /api/notifications[?since=<id>] and
// POST /api/notifications/ack (server/routes/notifications.cjs). ONE
// mechanism a human device and a bot program consume identically; one
// kind today ('troop_disbanded').
/** REQ-0368: the notification kinds. The first two are REQ-0327/0357 push
 * TOASTS; the four added by REQ-0368 feed the bell, the nav badges and the
 * login digest. Every one is emitted from a service code path the server
 * already owned -- see server/services/notifications.cjs's kind table. */
export type ApiNotificationKind =
  | 'troop_disbanded'
  | 'room_halted'
  | 'run_settled'
  | 'market_settled'
  | 'warehouse_expiring'
  | 'warehouse_expired';

export interface ApiNotification {
  id: number;
  ts: string;
  /** REQ-0357: 'room_halted' = a solo room's wipe-streak circuit breaker
   * canceled its lane (a troop's breaker rides 'troop_disbanded' with
   * payload.reason 'wipe_streak'). REQ-0368 added the four feed kinds. */
  kind: ApiNotificationKind;
  /** null for a kind with no room behind it (REQ-0368: market/warehouse). */
  roomId: string | null;
  /** REQ-0368: widens append()'s idempotency key beyond (kind, roomId) --
   * a run settles many times per room, so run_settled carries the run id,
   * market_settled the listing id, the warehouse kinds the sweep stamp.
   * null on every REQ-0327/0357 entry (and on every entry written before
   * REQ-0368), which is exactly the original collapse behaviour. */
  dedupeKey?: string | null;
  attackLv: number | null;
  seenAt: string | null;
  payload: {
    // REQ-0327 / REQ-0357
    reason?: string; disbandedAt?: string; streak?: number; haltedAt?: string;
    // REQ-0368 run_settled
    result?: 'victory' | 'wipe' | 'incomplete'; dungeonId?: string | null;
    lootCount?: number; runId?: string;
    // REQ-0368 market_settled
    listingId?: string; itemId?: string; itemName?: string; itemNameJa?: string | null;
    net?: number; burn?: number; tm?: string;
    // REQ-0368 warehouse_expiring / warehouse_expired
    count?: number; itemIds?: string[]; itemNames?: string[]; itemNamesJa?: (string | null)[];
  };
}
export interface ApiNotificationsResponse {
  ok: true;
  notifications: ApiNotification[];
  cursor: number;
}
export interface ApiNotificationAckResponse {
  ok: true;
  acked: number;
}

// ---- REQ-0324/0325/0326/0337: co-operative Troop wire shapes ----
// A Troop is a room with visibility:'public': the HOST opens it seated in slot
// 0, the other three seats stay null (open) until other players -- human or bot,
// indistinguishably -- join. Filling the LAST seat auto-departs it (REQ-0325).
// Server: server/services/troops.cjs + the /api/schedule/troops* routes in
// server/routes/schedule.cjs. These mirror those shapes field-for-field.

/** One SEATED seat of a Troop. `squadIndex` indexes `ownerId`'s OWN canvas --
 * resolving it against your own squad names is only correct when ownerId is
 * you. A FREE seat is `null`, not an object. */
export interface ApiTroopSlot {
  ownerId: string;
  squadIndex: number;
  joinedAt: string;
}

/** REQ-0326: the discrete disband record written onto a Troop when any seated
 * member cancels. `releasedOwners` is the roster REQ-0327 notifies. */
export interface ApiTroopDisbandEvent {
  roomId: string;
  reason: string;
  releasedOwners: string[];
  disbandedAt: string;
}

/** Full Troop state -- the body of every /api/schedule/troops* response's
 * `troop` field. Deliberately NOT declared as an extension of ApiRoom: a
 * Troop's free seats are `null` where a solo room's are `{squadIndex:null}`,
 * so the two slot arrays are not assignable to one another. */
export interface ApiTroop {
  id: string;
  ownerId: string;
  /** == ownerId; kept as an explicit alias by the server, never removed. */
  hostId: string;
  dungeonId: string;
  dungeonType?: 'default' | 'test_fixed';
  level: number;
  genSeed?: string;
  drawSeed?: string;
  visibility: 'public';
  formationId: string;
  cancelPolicy: ApiCancelPolicy;
  /** four entries; `null` = a free seat still open to recruits. */
  slots: (ApiTroopSlot | null)[];
  /** troop-level lifecycle. 'active' == departed (a run is in flight). */
  state: 'recruiting' | 'active' | 'canceled';
  status: 'recruiting' | 'active' | 'canceled';
  cancelRequested: boolean;
  pendingSwap: ApiPendingSwap | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunId: string | null;
  lastRun?: ApiRoomLastRun | null;
  /** REQ-0326: present once disbanded (or once a disband is pending on return). */
  disbandEvent?: ApiTroopDisbandEvent;
  disbandRequested?: boolean;
}

/** POST /api/schedule/troops body -- opens a Troop and seats the host in slot 0.
 * `squadIndex` is REQUIRED (one of the host's own squads); `level` is the
 * troop-level attackLv and is IMMUTABLE for the Troop's whole life (REQ-0325
 * relies on exactly one). `dungeonId` omitted -> the same levelMin-gated random
 * draw the solo path uses (REQ-0304). genSeed/drawSeed are dev-only (403 for a
 * normal caller), identical to the /rooms + /sorties gate. */
export interface ApiHostTroopBody {
  dungeonId?: string;
  level?: number;
  formationId?: string;
  cancelPolicy?: ApiCancelPolicy;
  genSeed?: string;
  drawSeed?: string;
  squadIndex: number;
}

/** One row of GET /api/schedule/troops?state=recruiting -- the compact BROWSE
 * projection (not a full ApiTroop). `seats` is a pre-rendered "k/4" string. */
export interface ApiTroopBrowseRow {
  roomId: string;
  seats: string;
  attackLv: number;
  hostId: string;
  ageSec: number;
}

export interface ApiTroopResponse {
  ok: true;
  troop: ApiTroop;
}
export interface ApiTroopsBrowseResponse {
  ok: true;
  troops: ApiTroopBrowseRow[];
}
