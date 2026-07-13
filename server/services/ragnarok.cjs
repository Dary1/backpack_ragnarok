'use strict';
// server/services/ragnarok.cjs -- REQ-0066: the Hall of Ragnarok service
// (server side; the client screen -- web/redesign/ragnarok.html -- is a
// separate, later squad that consumes the DTOs this module shapes, see
// shared/dto.ts's ApiRagnarok* types). Four concerns live here:
//
//   S1 SEASON REGISTRY -- seasons are CONTENT, not code: the registry
//      lives in content/live/seasons.json (one entry per season:
//      {index, name, nameEn, startAt, phaseDays, phasesPerSeason,
//      ragnarokAt}). The CURRENT season/phase/countdown is derived
//      LAZILY from the wall clock on every read -- no scheduler, same
//      poll-driven posture as services/runs.cjs's settleRoomIfDue. The
//      mock's season strip (第参季「狼の冬」・第九月相 / ラグナロクまで23日 /
//      the 12-wedge wheel) renders straight off these derived fields.
//   S2 THE ETERNAL ORDER (永劫の序列) -- the all-season standings table
//      (mock: 全季通算・消えぬ刻銘). Rebuilt LAZILY once per dawn (mock
//      copy: 「更新は毎暁」): the first order read past a dawn boundary
//      recomputes the standings from the einherjar records and caches
//      the result via storage.cjs's ragnarok order-cache root; every
//      later read that dawn-day serves the cache verbatim.
//   S3 EINHERJAR RECORDS -- one immutable record per completed Devotion
//      rite: who devoted what, when, plus a FROZEN deep-copy snapshot of
//      the devoted squad's resolved canvas + the content item defs it
//      referenced at rite time (same snapshot discipline as run copies:
//      services/runs.cjs's startRun deep-copies squad snapshots at start
//      so later edits never reach the in-flight run).
//   S4 THE DEVOTION RITE (献身の儀) -- the irreversible ceremony. THE
//      COST is the reference-model consequence (see applyDevotionToCanvas
//      below): every physical item the devoted squad references is
//      destroyed ACCOUNT-WIDE, and the squad slot itself is deleted.
//      Mock copy (frozen): 「献身は取り消せない。全ての鞄・物品・型は失われ、
//      名だけが永遠に刻まれる。」-- 鞄=BPs, 物品=POs, 型=SIs.
//
// RULE-5 DIVERGENCE (deliberate, documented): docs/architecture.md rule
// 5 says "the client's auto-save PUT is the ONE profile writer". The
// Devotion rite is the second sanctioned exception, citing the precedent
// services/market.cjs's header established for market settlement
// (REQ-0064): an irreversible, server-authoritative state change (here:
// account-wide item destruction) cannot be trusted to a client-side
// save -- a client that "forgot" to destroy the items after the server
// engraved the record would keep both the squad and the glory. So
// devote() writes the caller's canvas server-side, synchronously,
// inside the rite -- and the canvas only ever LOSES material, never
// gains (the same each-side-only-loses shape market settlement keeps).
// CLIENT GOTCHA (for the ragnarok screen squad): after a successful
// rite, re-GET your profile before the next auto-save PUT -- a stale
// in-flight auto-save can resurrect the destroyed items (the exact bug
// class REQ-0041 documented, same posture as market settlement).
//
// Persistence: exclusively via server/storage.cjs's ragnarok roots
// (ragnarok_einherjar / ragnarok_order_cache; files + pg parity,
// server/migrations/005_ragnarok.sql).
const fs = require('fs');
const storage = require('../storage.cjs');
const players = require('../players.cjs');
const { getScheduleContent, makeEngine, genId } = require('./core.cjs');
const { squadCanvasOf } = require('./squads.cjs');
const { deployedUidSet } = require('./market.cjs');

// REQ-0145a (sc): resolved via the ONE content-file loader
// (lib/content_files.cjs; CONTENT_ROOT env override honored, default
// byte-equivalent to the old os.homedir() anchoring). Captured at module
// load; tests remap homedir / inject CONTENT_ROOT + evict the module
// tree, so this rebinds exactly like before.
const { contentPath } = require('../lib/content_files.cjs');
const SEASONS_PATH = contentPath('live', 'seasons.json');
const SIS_PATH = contentPath('live', 'live_sis.json');

// ---------------------------------------------------------------------
// Tunables ([TUNABLE] -- ragnarok-policy level, same posture as
// services/core.cjs's and services/market.cjs's tunables blocks).
// ---------------------------------------------------------------------
const RAGNAROK_DTO_VERSION = 1; // wire-shape version stamped on every /api/ragnarok response (shared/dto.ts ApiRagnarok*)
const DAY_MS = 24 * 60 * 60 * 1000;

// The dawn boundary for the Eternal Order's lazy daily rebuild (mock:
// 「更新は毎暁」"updated every dawn"). [TUNABLE][ORCH default]: 20:00 UTC
// = 05:00 JST -- the game's copy deck is Japanese, so "dawn" is read in
// JST. Purely a cache-invalidation boundary; nothing gameplay-visible
// depends on the exact hour.
const RAGNAROK_DAWN_UTC_HOUR = 20;

// 戦果 (battle score) fold weights. [TUNABLE][ORCH default, PLACEHOLDER
// awaiting USER review]: f = damage*1.0 + kills*50 + survived*100, per
// battle. THIS IS THE ONE SHARED DEFINITION POINT for REQ-0068 (the
// season-end battle events squad): when REQ-0068 lands, it appends
// perSeason entries ({season, battles:[{damage,kills,survived}, ...]})
// to einherjar records, and battleScoreOf() below is the only formula
// that ever turns a battle into 戦果. No battle events exist yet, so
// every score today folds to 0 -- the degenerate-empty order is a
// first-class, tested state. Bump SCORE_FORMULA_VERSION whenever the
// weights change so stale order caches self-invalidate.
const SCORE_WEIGHTS = { damage: 1.0, kills: 50, survived: 100 };
const SCORE_FORMULA_VERSION = 1;

// Eternal Order tier thresholds (mock chip row: 奴僕 THRALL → 自由民 KARL
// → 族長 JARL → 選定者 EINHERJAR → 神域 VALHALLA). [TUNABLE][ORCH
// defaults]: 0 / 500 / 2000 / 8000. VALHALLA is deliberately NOT a
// score tier the server ever assigns -- its semantics (the mock renders
// it dimmed, beyond the ladder) are a client concern; the server's
// ladder tops out at EINHERJAR.
const ORDER_TIERS = [
  { tier: 'THRALL', min: 0 },
  { tier: 'KARL', min: 500 },
  { tier: 'JARL', min: 2000 },
  { tier: 'EINHERJAR', min: 8000 },
];

// Emblem placeholder (spec S2: "emblem(placeholder ok)") -- every order
// entry carries this single asset key until a real emblem system ships.
// The mock renders assets/emblem_horn3.png for every row today, so the
// placeholder IS the mock's own behavior.
const ORDER_EMBLEM_PLACEHOLDER = 'emblem_horn3';

const ORDER_TOP_DEFAULT = 10; // GET /order default top-N [TUNABLE]
const ORDER_TOP_MAX = 100; // GET /order top-N cap [TUNABLE]
const ORDER_AROUND_SPAN = 2; // around=me window: me +/- 2 rows [TUNABLE]

// A crashed rite's 'applying' lock is honored for this long before lazy
// recovery kicks in (see normalizeRiteRecord). [TUNABLE] -- same
// timeout-then-lazily-recover posture as services/core.cjs's
// WAREHOUSE_CLAIM_TIMEOUT_MS two-phase claim.
const RITE_LOCK_TIMEOUT_MS = 60 * 1000;

// ---------------------------------------------------------------------
// S1 Season registry. content/live/seasons.json, mtime-cached exactly
// like services/market.cjs's getDexNoById(). A missing/corrupt file is
// the documented degenerate case: no seasons -> season null everywhere,
// and the market furnace stays all-time (see routes/market.cjs).
// ---------------------------------------------------------------------
let seasonsCache = null; // { mtime, doc }

function getSeasonsDoc() {
  let mtime = null;
  try { mtime = fs.statSync(SEASONS_PATH).mtimeMs; } catch (e) { mtime = null; }
  if (seasonsCache && seasonsCache.mtime === mtime) return seasonsCache.doc;
  let doc = null;
  if (mtime != null) {
    try { doc = JSON.parse(fs.readFileSync(SEASONS_PATH, 'utf8')); } catch (e) { doc = null; }
  }
  seasonsCache = { mtime, doc };
  return doc;
}

// seasonView: one registry entry, normalized for the wire. ragnarokAt is
// stored in the content (seed convention: startAt + phasesPerSeason *
// phaseDays days) but derived defensively if a hand-edited entry omits
// it; when both exist the STORED value wins (content is truth).
function seasonView(entry) {
  const phaseDays = Number(entry.phaseDays) || 7;
  const phasesPerSeason = Number(entry.phasesPerSeason) || 12;
  const startMs = Date.parse(entry.startAt);
  const ragnarokAt = entry.ragnarokAt || new Date(startMs + phasesPerSeason * phaseDays * DAY_MS).toISOString();
  return {
    index: Number(entry.index) || 0,
    name: entry.name || ('Season ' + entry.index),
    nameEn: entry.nameEn || null,
    startAt: entry.startAt,
    phaseDays,
    phasesPerSeason,
    ragnarokAt,
  };
}

function listSeasons() {
  const doc = getSeasonsDoc();
  if (!doc || !Array.isArray(doc.seasons)) return [];
  return doc.seasons
    .filter((s) => s && typeof s.startAt === 'string' && !isNaN(Date.parse(s.startAt)))
    .map(seasonView)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

// deriveSeasonClock: the pure wall-clock derivation (phase / countdown),
// v1 of the mock's own season strip math. phase is 1-based and clamps
// to [1, phasesPerSeason]; past ragnarokAt the season reads as ended
// (phase pinned at phasesPerSeason, countdown 0) until a successor
// season's startAt arrives in the registry.
function deriveSeasonClock(season, nowMs) {
  const startMs = Date.parse(season.startAt);
  const ragMs = Date.parse(season.ragnarokAt);
  const phaseMs = season.phaseDays * DAY_MS;
  const sinceStart = Math.max(0, nowMs - startMs);
  const rawPhase = Math.floor(sinceStart / phaseMs) + 1;
  const phase = Math.max(1, Math.min(season.phasesPerSeason, rawPhase));
  const phaseDay = Math.max(1, Math.min(season.phaseDays, Math.floor(sinceStart / DAY_MS) % season.phaseDays + 1));
  const msToRagnarok = Math.max(0, ragMs - nowMs);
  return {
    now: new Date(nowMs).toISOString(),
    phase,
    phaseDay,
    daysToRagnarok: Math.ceil(msToRagnarok / DAY_MS),
    msToRagnarok,
    ended: nowMs >= ragMs,
  };
}

// currentSeason(nowMs?): the most recently STARTED season, or null when
// the registry is missing/empty/entirely in the future. An ENDED season
// with no successor stays "current" (derived.ended === true) -- the
// mock's own furnace footer ("this season the furnace burned N") keeps
// pointing at the last season until content ships the next one.
function currentSeason(nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const seasons = listSeasons();
  let current = null;
  for (const s of seasons) {
    if (Date.parse(s.startAt) <= now) current = s; // sorted ascending -- last started wins
  }
  if (!current) return { season: null, derived: null };
  return { season: current, derived: deriveSeasonClock(current, now) };
}

// ---------------------------------------------------------------------
// S2 The 戦果 fold + the Eternal Order's lazy daily-dawn rebuild.
// ---------------------------------------------------------------------

// battleScoreOf: THE per-battle 戦果 formula (see the SCORE_WEIGHTS
// block above -- placeholder awaiting USER, shared definition point for
// REQ-0068). `survived` is a 0/1 flag (booleans coerce via Number()).
function battleScoreOf(battle) {
  if (!battle) return 0;
  return (Number(battle.damage) || 0) * SCORE_WEIGHTS.damage
    + (Number(battle.kills) || 0) * SCORE_WEIGHTS.kills
    + (Number(battle.survived) || 0) * SCORE_WEIGHTS.survived;
}

// scoreOfRecord: folds one einherjar record's whole perSeason history
// ({season, battles:[...]} entries, appended by REQ-0068 later) into a
// total 戦果. Degenerate-empty by construction: no perSeason entries
// (every record today) folds to 0.
function scoreOfRecord(rec) {
  let total = 0;
  for (const ps of (rec && Array.isArray(rec.perSeason) ? rec.perSeason : [])) {
    for (const b of (ps && Array.isArray(ps.battles) ? ps.battles : [])) total += battleScoreOf(b);
  }
  return total;
}

function tierOf(score) {
  let best = ORDER_TIERS[0].tier;
  for (const t of ORDER_TIERS) if (score >= t.min) best = t.tier;
  return best;
}

// lastDawnMs: the most recent RAGNAROK_DAWN_UTC_HOUR:00 UTC at or before
// `nowMs` -- the cache-freshness boundary for the order rebuild.
function lastDawnMs(nowMs) {
  const d = new Date(nowMs);
  let dawn = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RAGNAROK_DAWN_UTC_HOUR, 0, 0, 0);
  if (dawn > nowMs) dawn -= DAY_MS;
  return dawn;
}

function playerNameOf(playerId) {
  const rec = players.readPlayer(playerId);
  return rec ? rec.name : playerId;
}

// cmpOrderEntries: THE deterministic standings comparator. score desc,
// then einherjarCount desc, then name asc, then playerId asc -- ties
// never share a rank (deliberate: the stone tablet is a strict total
// order, deterministic across rebuilds; frozen by the determinism test).
function cmpOrderEntries(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.einherjarCount !== b.einherjarCount) return b.einherjarCount - a.einherjarCount;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

// rebuildOrder: full recompute over every (finalized) einherjar record.
// WHO IS LISTED (documented interpretation): players with at least one
// einherjar record -- the mock's 刻銘 ("engravings") counts those who
// devoted, not every registered account; a player who never devoted
// appears only as the synthetic unranked `me` row (rank null) of their
// own order view. Pending ('applying') records are excluded until their
// rite finalizes (normalizeRiteRecord folds lazy crash recovery into
// this same walk).
function rebuildOrder(nowMs) {
  const byPlayer = new Map();
  for (const raw of storage.listEinherjarRecords()) {
    const rec = normalizeRiteRecord(raw, nowMs);
    if (!rec || (rec.rite && rec.rite.state === 'applying')) continue;
    let agg = byPlayer.get(rec.playerId);
    if (!agg) { agg = { einherjarCount: 0, score: 0 }; byPlayer.set(rec.playerId, agg); }
    agg.einherjarCount += 1;
    agg.score += scoreOfRecord(rec);
  }
  const entries = [];
  for (const [playerId, agg] of byPlayer) {
    entries.push({
      playerId,
      name: playerNameOf(playerId),
      emblem: ORDER_EMBLEM_PLACEHOLDER,
      einherjarCount: agg.einherjarCount,
      score: agg.score,
      rank: 0, // assigned below
      tier: tierOf(agg.score),
    });
  }
  entries.sort(cmpOrderEntries);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return {
    rebuiltAt: new Date(nowMs).toISOString(),
    dawnUtcHour: RAGNAROK_DAWN_UTC_HOUR,
    formulaVersion: SCORE_FORMULA_VERSION,
    entries,
  };
}

// getOrderDoc: the lazy daily-dawn rebuild. Serve the cache while its
// rebuiltAt is at/after the last dawn boundary AND it was built with the
// current formula version; otherwise recompute + persist (the first
// request past dawn pays the rebuild, everyone after reads the cache --
// the same lazy converging-write pattern as normalizeListing /
// normalizeWarehouseStatus, at day granularity). Consequence, per the
// mock's own 「更新は毎暁」: a rite completed at noon appears in the
// order at the NEXT dawn -- the einherjar list (S3) is live, the
// standings are not.
function getOrderDoc(nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const cached = storage.readRagnarokOrderCache();
  if (cached && cached.formulaVersion === SCORE_FORMULA_VERSION
    && cached.rebuiltAt && Date.parse(cached.rebuiltAt) >= lastDawnMs(now)) {
    return { doc: cached, rebuilt: false };
  }
  const doc = rebuildOrder(now);
  storage.writeRagnarokOrderCache(doc);
  return { doc, rebuilt: true };
}

// devForceRebuildOrder (REQ-0066 E2E hook, mirrors services/runs.cjs's
// devBackdateActiveRun / devBackdateClaimedWarehouseItem test-control-seam
// shape exactly): forces an UNCONDITIONAL rebuildOrder() + cache write,
// bypassing getOrderDoc's lastDawnMs gate entirely. Exists because S2's
// own lazy daily-dawn rebuild (「更新は毎暁」) means a rite completed
// *after* today's first order read is invisible to orderView's `q`
// search (and top/around) until the NEXT dawn boundary -- by design (see
// getOrderDoc's doc comment), but that makes "devote, then immediately
// search for myself" impossible to assert in the E2E suite without
// waiting out a real ~24h boundary. Gated to the dev_mode fallback
// caller only by the route handler (routes/ragnarok.cjs), same as
// dev/backdate; never touches any einherjar record, only the order
// cache's own derived standings.
function devForceRebuildOrder(nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const doc = rebuildOrder(now);
  storage.writeRagnarokOrderCache(doc);
  return doc;
}

// unrankedMeEntry: the synthetic row for a caller with no engraving yet
// (rank null -- the client renders "unranked"). Degenerate-empty
// support: an empty order still answers around=me with this row.
function unrankedMeEntry(callerId) {
  return {
    playerId: callerId,
    name: playerNameOf(callerId),
    emblem: ORDER_EMBLEM_PLACEHOLDER,
    einherjarCount: 0,
    score: 0,
    rank: null,
    tier: tierOf(0),
  };
}

// orderView(callerId, {top, around, q}): the GET /api/ragnarok/order
// read model. Server-side pagination: `top` = top-N rows (default 10,
// cap 100); `around=me` additionally returns the caller's rank window
// (me +/- ORDER_AROUND_SPAN rows, empty when unranked); `q` additionally
// returns find-by-name matches (case-insensitive substring, capped at
// the same `top` size). `me` is always present.
function orderView(callerId, opts, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const { doc } = getOrderDoc(now);
  const entries = doc.entries;
  let top = parseInt(String((opts && opts.top) != null ? opts.top : ''), 10);
  if (!Number.isInteger(top) || top < 1) top = ORDER_TOP_DEFAULT;
  if (top > ORDER_TOP_MAX) top = ORDER_TOP_MAX;
  const meIdx = entries.findIndex((e) => e.playerId === callerId);
  const me = meIdx >= 0 ? entries[meIdx] : unrankedMeEntry(callerId);
  /** @type {any} */
  const out = {
    rebuiltAt: doc.rebuiltAt,
    total: entries.length,
    tiers: ORDER_TIERS,
    top: entries.slice(0, top),
    me,
  };
  if (opts && opts.around === 'me') {
    out.around = meIdx >= 0
      ? entries.slice(Math.max(0, meIdx - ORDER_AROUND_SPAN), meIdx + ORDER_AROUND_SPAN + 1)
      : [];
  }
  if (opts && opts.q) {
    const needle = String(opts.q).toLowerCase();
    out.matches = entries.filter((e) => String(e.name).toLowerCase().includes(needle)).slice(0, top);
  }
  return out;
}

// ---------------------------------------------------------------------
// S3 Einherjar records.
//
// Record shape (immutable once rite.state === 'done'; REQ-0068 later
// APPENDS perSeason entries -- the identity/snapshot fields never
// change):
// {
//   id: 'ein_<hex>', playerId, squadName, seasonDevoted: number|null,
//   devotedAt: iso,
//   snapshot: {
//     canvas: { bps, pos, sis },   // DEEP COPY of the devoted squad's
//                                  // resolved canvas at rite time
//                                  // (squadCanvasOf -- engine.js ~1230:
//                                  // the active squad resolves to the
//                                  // top-level st.bps/pos/sis, a stored
//                                  // one to st.presets.store[i])
//     counts: { bps, pos, sis },
//     itemDefs: { pos: {id: def}, sis: {id: def} },
//                                  // content defs referenced at rite
//                                  // time, deep-copied. BP records need
//                                  // no def map: a BP reference already
//                                  // carries its full def inline
//                                  // ({id,name,color,shape,origin,
//                                  // unit}, engine.js ~1204).
//   },
//   blast: { bps, pos, sis, total, affectedSquads }, // preview shape,
//                                  // frozen for idempotent replays
//   bioArchive: null,              // REQ-0060 (squad bios) not built --
//                                  // stored empty, field reserved
//   perSeason: [],                 // 戦果 history; REQ-0068 appends
//                                  // {season, battles:[...]} entries
//   emblems: [],                   // placeholder, same as the order's
//   idemKey: string|null,
//   rite: { state: 'applying'|'done', t: iso, recoveredAt?: iso },
// }
// ---------------------------------------------------------------------

// snapshotUidsStillHomed: crash-recovery ground truth. The rite's
// profile write is ATOMIC (storage.cjs: tmp+rename in files mode, one
// upsert in pg mode), so a player's canvas holds either the full
// pre-rite state (every devoted uid still has its inventory home) or
// the full post-rite state (none do). "Any devoted uid still homed"
// therefore means the cost never landed. (A player who independently
// consumed SOME of the items between crash and recovery also lands
// here -> the pending record is VOIDED and they keep the rest:
// under-deliver-never-duplicate, the same stance services/market.cjs's
// settle ordering documents.)
function snapshotUidsStillHomed(canvas, rec) {
  const snap = rec && rec.snapshot && rec.snapshot.canvas;
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages) || !snap) return false;
  const bpIds = new Set((snap.bps || []).map((b) => b.id));
  const poUids = new Set((snap.pos || []).map((p) => p.uid));
  const siUids = new Set((snap.sis || []).map((a) => a.uid));
  if (bpIds.size + poUids.size + siUids.size === 0) return false; // nothing to destroy -> treat as committed
  for (const pg of canvas.inv.pages) {
    if (!pg) continue;
    for (const b of pg.bps || []) if (bpIds.has(b.id)) return true;
    for (const p of pg.pos || []) if (poUids.has(p.uid)) return true;
    for (const a of pg.sis || []) if (siUids.has(a.uid)) return true;
  }
  return false;
}

// normalizeRiteRecord: lazy crash recovery for the two-write rite (see
// devote()'s commit ordering). A record stuck in rite.state 'applying':
//   - FRESH (younger than RITE_LOCK_TIMEOUT_MS): left alone -- it is
//     (nominally) a rite in flight; devote() 409s mid_rite on it.
//   - STALE: decided by profile ground truth (snapshotUidsStillHomed):
//     cost never landed -> the record is VOIDED (deleted; the player
//                          lost nothing and gained nothing),
//     cost landed       -> ROLLED FORWARD to 'done' (the items are
//                          gone; the engraving they paid for stands).
// Returns the (possibly finalized) record, or null when voided. Same
// timeout-then-lazily-recover posture as the warehouse two-phase
// claim's WAREHOUSE_CLAIM_TIMEOUT_MS revert (services/warehouse.cjs's
// normalizeWarehouseStatus).
function normalizeRiteRecord(rec, nowMs) {
  if (!rec || !rec.rite || rec.rite.state !== 'applying') return rec;
  const now = nowMs != null ? nowMs : Date.now();
  const age = now - Date.parse(rec.rite.t);
  if (isFinite(age) && age < RITE_LOCK_TIMEOUT_MS) return rec; // fresh: honored as a live lock
  let canvas = null;
  try {
    const doc = storage.readProfile(rec.playerId);
    canvas = doc ? doc.canvas : null;
  } catch (e) { /* unknown player id (registry wiped) -> fall through to roll-forward: the record is all that remains */ }
  if (canvas && snapshotUidsStillHomed(canvas, rec)) {
    storage.deleteEinherjarRecord(rec.id); // void: the cost never landed
    return null;
  }
  rec.rite = { state: 'done', t: rec.rite.t, recoveredAt: new Date(now).toISOString() };
  storage.writeEinherjarRecord(rec.id, rec);
  return rec;
}

function einherjarDto(rec) {
  const counts = (rec.snapshot && rec.snapshot.counts) || { bps: 0, pos: 0, sis: 0 };
  return {
    id: rec.id,
    playerId: rec.playerId,
    squadName: rec.squadName,
    seasonDevoted: rec.seasonDevoted != null ? rec.seasonDevoted : null,
    devotedAt: rec.devotedAt,
    counts: { bps: counts.bps || 0, pos: counts.pos || 0, sis: counts.sis || 0 },
    score: scoreOfRecord(rec),
    perSeason: Array.isArray(rec.perSeason) ? rec.perSeason : [],
    emblems: Array.isArray(rec.emblems) ? rec.emblems : [],
    bioArchive: rec.bioArchive != null ? rec.bioArchive : null,
  };
}

// listEinherjar(playerId): every FINALIZED record for one player, newest
// first. Public hall data (the order already names players, and the
// mock's corridor shows devoted squads by name/season/score) -- the DTO
// deliberately does NOT include the frozen snapshot canvas (record
// internals stay server-side until a later squad needs them, e.g. the
// REQ-0068 battle compiler). Records mid-rite ('applying', fresh) are
// hidden until finalized.
function listEinherjar(playerId, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const out = [];
  for (const raw of storage.listEinherjarRecords()) {
    if (raw.playerId !== playerId) continue;
    const rec = normalizeRiteRecord(raw, now);
    if (!rec || (rec.rite && rec.rite.state === 'applying')) continue;
    out.push(rec);
  }
  out.sort((a, b) => (a.devotedAt < b.devotedAt ? 1 : a.devotedAt > b.devotedAt ? -1 : 0));
  return out.map(einherjarDto);
}

// devClearEinherjarRecords (E2E hook, mirrors services/runs.cjs's
// warehouse debris-clear hook shape): permanently deletes EVERY einherjar
// record belonging to `playerId`. Exists because einherjar records are
// immutable/permanent by design once rite.state === 'done' (this
// module's own S3 doc block) -- there is no gameplay path that ever
// clears one, so a dev-player devotion in one E2E run (e.g. FULL RITE)
// otherwise poisons every later run's "fresh player sees the empty hall"
// tests (HALL STRIP, EMPTY/FIRST-SEASON) forever, the same debris-
// accumulation class server/README.md's warehouse-cap writeup already
// describes for warehouse rows. Gated to the dev_mode fallback caller
// only by the route handler (routes/ragnarok.cjs); never touches any
// OTHER player's records (listEinherjarRecords() is filtered by
// playerId here, same as listEinherjar()).
function devClearEinherjarRecords(playerId) {
  let deleted = 0;
  for (const raw of storage.listEinherjarRecords()) {
    if (raw.playerId !== playerId) continue;
    storage.deleteEinherjarRecord(raw.id);
    deleted += 1;
  }
  return deleted;
}

// ---------------------------------------------------------------------
// S4 The Devotion rite.
// ---------------------------------------------------------------------

// squadMetaOr404: resolves squadIndex against the CALLER's own canvas.
// Out-of-range / non-integer / no-squads-at-all are all the SAME plain
// 404 (no-leak convention, mirroring services/market.cjs's
// getOwnListingOr404 -- a squad is only ever addressable through the
// caller's own token, so a "foreign squad" is structurally identical
// to a typo here).
function squadMetaOr404(canvas, squadIndex) {
  if (!canvas || !canvas.presets || !Array.isArray(canvas.presets.store)
    || !Number.isInteger(squadIndex) || squadIndex < 0 || squadIndex >= canvas.presets.store.length) {
    const err = new Error('squad not found'); err.code = 'NOT_FOUND'; throw err;
  }
  const names = Array.isArray(canvas.presets.names) ? canvas.presets.names : [];
  return { index: squadIndex, name: names[squadIndex] != null ? String(names[squadIndex]) : ('Squad ' + (squadIndex + 1)) };
}

// devotionBlastRadius: READ-ONLY itemization of what the rite destroys.
// The uid sets are KIND-SCOPED on purpose: engine.js's checkUidInvariant
// tags homes 'po:'/'bp:'/'si:' precisely because the three uid
// namespaces never cross-check each other -- a BP id colliding with a
// PO uid string is legal, so destruction must never conflate kinds.
// Counts are the devoted squad's own reference counts (engine.js
// ~1215: "a uid may have AT MOST ONE reference per squad", so array
// lengths are already per-uid counts); and since inventory is MASTER
// (engine.js ~1201: every uid has exactly ONE home record living in
// st.inv.pages), each counted uid is also exactly one destroyed
// physical item. affectedSquads itemizes every OTHER squad that
// shares (yellow, REQ-0033) any doomed uid -- indices are PRE-rite
// indices (the rite deletes a slot, shifting later indices left by one
// per engine.js deleteSquad's own straddle rule).
function devotionBlastRadius(canvas, squadIndex) {
  const devoted = squadCanvasOf(canvas, squadIndex) || { bps: [], pos: [], sis: [] };
  const bps = new Set((devoted.bps || []).map((b) => b.id));
  const pos = new Set((devoted.pos || []).map((p) => p.uid));
  const sis = new Set((devoted.sis || []).map((a) => a.uid));
  const affectedSquads = [];
  const store = canvas && canvas.presets ? canvas.presets.store : [];
  const names = canvas && canvas.presets && Array.isArray(canvas.presets.names) ? canvas.presets.names : [];
  for (let i = 0; i < store.length; i++) {
    if (i === squadIndex) continue;
    const c = squadCanvasOf(canvas, i) || { bps: [], pos: [], sis: [] };
    const lostBps = (c.bps || []).filter((b) => bps.has(b.id)).length;
    const lostPos = (c.pos || []).filter((p) => pos.has(p.uid)).length;
    const lostSis = (c.sis || []).filter((a) => sis.has(a.uid)).length;
    if (lostBps + lostPos + lostSis > 0) {
      affectedSquads.push({
        index: i,
        name: names[i] != null ? String(names[i]) : ('Squad ' + (i + 1)),
        lostBps, lostPos, lostSis,
      });
    }
  }
  return {
    uids: { bps, pos, sis },
    counts: { bps: bps.size, pos: pos.size, sis: sis.size, total: bps.size + pos.size + sis.size },
    affectedSquads,
  };
}

function blastDto(blast) {
  return {
    bps: blast.counts.bps,
    pos: blast.counts.pos,
    sis: blast.counts.sis,
    total: blast.counts.total,
    affectedSquads: blast.affectedSquads,
  };
}

// stripDestroyedUids: the ACCOUNT-WIDE destruction pass. The engine has
// no "destroy a physical item" operation at all -- REQ-0033's reference
// model only ever creates/removes REFERENCES (engine.js's createRef/
// removeRef, ~1368+), and deleteSquad explicitly "never touches
// st.inv" (engine.js ~1892: deleting a squad's reference set leaves
// every inventory home and every other squad's references untouched)
// -- so physical destruction is necessarily this server-side pass. It
// applies ONE uniform kind-scoped filter to every container that holds
// item records, all of which share the {bps, pos, sis} array shape
// (engine.js ~1183: "the inv/canvas containers deliberately mirror each
// other"):
//   - canvas.inv.pages[]      -- the HOMES (inventory is MASTER,
//                                REQ-0033): removing these IS the
//                                destruction
//   - canvas.{bps,pos,sis}    -- the ACTIVE squad's references
//   - canvas.presets.store[i] -- every stored squad's references
//                                (yellow-shared squads lose exactly
//                                their doomed pieces, nothing else)
// plus one repair rule: a SURVIVING SI record seated on a DESTROYED PO
// is stowed (host = 'inv', the stowed sentinel -- engine.js ~1078),
// mirroring engine.js unseatOrphans' own missing-host repair (~388-389:
// a host whose PO cannot be found reverts to 'inv') without calling it
// (unseatOrphans assumes the ACTIVE-canvas record shape -- p.loc
// checks -- while this rule must run uniformly across inventory pages
// and stored snapshots too; it touches only devotion-caused danglers).
function stripDestroyedUids(canvas, uids) {
  const strip = (c) => {
    if (!c) return;
    if (Array.isArray(c.bps)) c.bps = c.bps.filter((b) => !uids.bps.has(b.id));
    if (Array.isArray(c.pos)) c.pos = c.pos.filter((p) => !uids.pos.has(p.uid));
    if (Array.isArray(c.sis)) {
      c.sis = c.sis.filter((a) => !uids.sis.has(a.uid));
      for (const a of c.sis) {
        if (a.host && typeof a.host === 'object' && a.host.po && uids.pos.has(a.host.po)) a.host = 'inv';
      }
    }
  };
  strip(canvas); // the active squad's top-level reference arrays
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap); // stored squads (the active slot is null; strip guards)
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg); // THE HOMES -- this is the physical destruction
  }
}

// applyDevotionToCanvas: THE COST, as a pure function over the profile
// state (no storage I/O; engine-style in-place mutator, the same
// mutate-st-and-return contract every engine.js mutator has). Order:
//   1. itemize the blast radius (the devoted squad's kind-scoped uid
//      sets, read before anything moves),
//   2. delete the devoted squad slot via the ENGINE's OWN deleteSquad
//      (engine.js ~1914 -- refs-only removal, names[] splice, active-
//      index bookkeeping incl. the nearest-remaining-tab rule; its
//      last-squad refusal is pre-checked by devote() as a 409 but
//      re-asserted here defensively),
//   3. destroy every doomed uid account-wide (stripDestroyedUids).
// The engine instance only dispatches on `st` for deleteSquad (item
// defs are never dereferenced by it), same "any bound instance works"
// note as services/squads.cjs's isSquadIndependent delegation.
function applyDevotionToCanvas(engine, canvas, squadIndex) {
  const blast = devotionBlastRadius(canvas, squadIndex);
  const del = engine.deleteSquad(canvas, squadIndex);
  if (!del.ok) {
    // Mirrors engine.js deleteSquad's own refusal ("cannot delete the
    // last remaining squad", ~1919) -- reachable here only if devote()'s
    // own pre-check was bypassed (direct service-call misuse).
    const err = new Error('devotion refused: ' + (del.why || 'deleteSquad failed'));
    err.code = 'CONFLICT';
    err.reason = del.why && del.why.indexOf('last') !== -1 ? 'last_squad' : 'not_devotable';
    throw err;
  }
  stripDestroyedUids(canvas, blast.uids);
  return blast;
}

// ---- devoted-snapshot content defs (frozen at rite time) ----
// PO defs come from getScheduleContent().itemDefsById (live + pilot
// overlay -- the same resolution every deploy/claim path uses); SI defs
// from content/live/live_sis.json via this module's own mtime-cached
// loader (getScheduleContent doesn't carry SI defs -- they're not a
// schedule concern -- and the /api/content cache lives in lib/, which
// services never require; same self-contained-loader posture as
// services/market.cjs's dex numbering). An id with no def (content
// removed since the item dropped) is simply absent from the map -- the
// snapshot's own records still carry id + placement.
let sisDefsCache = null; // { mtime, byId }

function getSiDefsById() {
  let mtime = null;
  try { mtime = fs.statSync(SIS_PATH).mtimeMs; } catch (e) { mtime = null; }
  if (sisDefsCache && sisDefsCache.mtime === mtime) return sisDefsCache.byId;
  /** @type {Record<string, any>} */
  const byId = {};
  try {
    const doc = JSON.parse(fs.readFileSync(SIS_PATH, 'utf8'));
    for (const e of doc.entries || []) byId[e.id] = e;
  } catch (e) { /* no live SIs -> empty map */ }
  sisDefsCache = { mtime, byId };
  return byId;
}

function deepCopy(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

// buildFrozenSnapshot: the einherjar record's frozen squad -- a DEEP COPY
// of the devoted squad's resolved canvas plus the content defs its
// records reference, taken NOW, before anything mutates (the same
// copies-at-start discipline services/runs.cjs's startRun documents for
// run squad snapshots: "deep-copied snapshots, taken NOW, at start...
// a squad edited by its owner mid-run never affects the in-flight run").
// BP records carry their defs inline already (engine.js ~1204), so only
// PO/SI ids need def capture.
function buildFrozenSnapshot(canvas, squadIndex) {
  const devoted = squadCanvasOf(canvas, squadIndex) || { bps: [], pos: [], sis: [] };
  const snapCanvas = {
    bps: deepCopy(devoted.bps || []),
    pos: deepCopy(devoted.pos || []),
    sis: deepCopy(devoted.sis || []),
  };
  const { itemDefsById } = getScheduleContent();
  const siDefs = getSiDefsById();
  /** @type {{pos: Record<string, any>, sis: Record<string, any>}} */
  const itemDefs = { pos: {}, sis: {} };
  for (const p of snapCanvas.pos) {
    if (itemDefs.pos[p.id] === undefined && itemDefsById[p.id]) itemDefs.pos[p.id] = deepCopy(itemDefsById[p.id]);
  }
  for (const a of snapCanvas.sis) {
    if (itemDefs.sis[a.id] === undefined && siDefs[a.id]) itemDefs.sis[a.id] = deepCopy(siDefs[a.id]);
  }
  return {
    canvas: snapCanvas,
    counts: { bps: snapCanvas.bps.length, pos: snapCanvas.pos.length, sis: snapCanvas.sis.length },
    itemDefs,
  };
}

// ---- eligibility ----

// riteEligibilityReasons: the shared gate used by preview (as DATA:
// eligible:false + reasons[]) and devote (as 409s, first reason wins).
// Reason vocabulary (STRUCTURED tags, same err.reason convention as
// assignSlot / the market):
//   mid_rite     a fresh 'applying' record exists (a rite is in flight
//                or just crashed; lazily recovered after
//                RITE_LOCK_TIMEOUT_MS -- see normalizeRiteRecord)
//   last_squad  devoting the caller's ONLY squad -- mirrors engine.js
//                deleteSquad's own last-refusal (~1919: "must always
//                keep at least 1") as a 409 [ORCH decision]
//   empty_squad   the squad has no BP -- engine.isSquadDeployable
//                (REQ-0041 feedback 5: zero BP = dead on arrival).
//                Deliberate EXTENSION of the spec'd 409 set: einherjar
//                join the season-end battle line (REQ-0068), and a squad
//                that could never deploy must not be devotable either
//                (also closes free einherjarCount farming via empty
//                squads). Same reason tag assignSlot already uses.
//   deployed     the devoted squad's uid set intersects the caller's
//                CURRENTLY-DEPLOYED uid set (any squad assigned to a
//                slot of any of their own open/active rooms --
//                services/market.cjs's deployedUidSet, the same Law-of-
//                Possession scan the market's listing gate uses).
//                Intersection (not just "this squad index is slotted")
//                on purpose: destroying a uid a DEPLOYED squad shares
//                would gut a standing army mid-campaign. Mock step 1:
//                「遠征中でない一隊のみ。」
// `already_devoted` is deliberately NOT a reason: no squadName-
// uniqueness constraint exists [ORCH decision] -- every rite mints a
// new record, and two records may share an engraving.
function riteEligibilityReasons(callerId, canvas, squadIndex, nowMs) {
  const reasons = [];
  for (const raw of storage.listEinherjarRecords()) {
    if (raw.playerId !== callerId) continue;
    const rec = normalizeRiteRecord(raw, nowMs);
    if (rec && rec.rite && rec.rite.state === 'applying') { reasons.push('mid_rite'); break; }
  }
  if (canvas.presets.store.length <= 1) reasons.push('last_squad');
  const { itemDefsById } = getScheduleContent();
  const engine = makeEngine(itemDefsById);
  if (!engine.isSquadDeployable(canvas, squadIndex)) reasons.push('empty_squad');
  const blast = devotionBlastRadius(canvas, squadIndex);
  const deployed = deployedUidSet(callerId, canvas);
  let hit = false;
  for (const uid of blast.uids.bps) if (deployed.has(uid)) { hit = true; break; }
  if (!hit) for (const uid of blast.uids.pos) if (deployed.has(uid)) { hit = true; break; }
  if (!hit) for (const uid of blast.uids.sis) if (deployed.has(uid)) { hit = true; break; }
  if (hit) reasons.push('deployed');
  return { reasons, blast, engine };
}

const RITE_409_MESSAGES = {
  mid_rite: 'a devotion rite is already in progress for this account',
  last_squad: 'cannot devote your last remaining squad (the engine refuses to delete the last squad)',
  empty_squad: 'empty squad: squad has no Backpack (BP) and cannot join the einherjar',
  deployed: 'squad (or an item it shares) is deployed in an open/active schedule room -- squads standing for war cannot be devoted',
};

// projectDevotionOrder: the preview's order projection [ORCH:
// percentile vs the current order; degenerate-safe when empty]. Scores
// cannot move at rite time (戦果 only accrues from REQ-0068's season-end
// battles), so the honest projection is: einherjarCount+1, re-ranked
// against today's (dawn-cached) order. topPercentile = ceil(rank/total
// *100), read as "you would stand within the top N%" -- an ESTIMATE
// against a snapshot, never a promise (documented for the client squad;
// the mock's own "+2%" chip is this projection's display slot).
// Degenerate-empty: an empty order projects rank 1 of 1, top 100%.
function projectDevotionOrder(callerId, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const { doc } = getOrderDoc(now);
  const others = doc.entries.filter((e) => e.playerId !== callerId);
  const mine = doc.entries.find((e) => e.playerId === callerId) || null;
  const projectedMe = {
    playerId: callerId,
    name: playerNameOf(callerId),
    einherjarCount: (mine ? mine.einherjarCount : 0) + 1,
    score: mine ? mine.score : 0,
  };
  const ranked = others.concat([projectedMe]).sort(cmpOrderEntries);
  const projectedRank = ranked.findIndex((e) => e.playerId === callerId) + 1;
  const totalAfter = ranked.length;
  return {
    currentRank: mine ? mine.rank : null,
    projectedRank,
    totalAfter,
    topPercentile: totalAfter > 0 ? Math.ceil((projectedRank / totalAfter) * 100) : null,
    einherjarCountAfter: projectedMe.einherjarCount,
  };
}

// previewDevotion: GET /api/ragnarok/devotion/preview/:squadIndex --
// the itemized blast radius + eligibility + order projection, all
// READ-ONLY (a preview persists nothing; lazy rite recovery inside the
// eligibility walk is the one converging write it can trigger).
// Ineligibility is DATA here (eligible:false + reasons[]), not an error
// status -- the client renders the ceremony panel with the vow button
// disabled; only an unaddressable squad 404s.
function previewDevotion(callerId, squadIndex, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const doc = storage.readProfile(callerId);
  const canvas = doc ? doc.canvas : null;
  const squad = squadMetaOr404(canvas, squadIndex);
  const { reasons, blast } = riteEligibilityReasons(callerId, canvas, squadIndex, now);
  return {
    squad,
    eligible: reasons.length === 0,
    reasons,
    blast: blastDto(blast),
    projection: projectDevotionOrder(callerId, now),
  };
}

// devote: POST /api/ragnarok/devotion/:squadIndex -- THE rite,
// irreversible. Commit ordering (crash posture documented per step; the
// whole function is synchronous on the single-threaded server --
// pg_sync's querySync blocks too -- so two requests can never
// interleave mid-rite, exactly the serialization argument
// services/market.cjs's buyListing makes):
//   0. Idempotency-Key replay: a FINALIZED record with the same
//      (playerId, key) returns the original outcome, no re-rite.
//   1. Eligibility 409s (mid_rite / last_squad / empty_squad /
//      deployed) + squad 404 (no-leak), all read-only.
//   2. Write the einherjar record with rite.state 'applying' -- the
//      rite LOCK [ORCH: storage-level lock flag during the rite] and
//      the durable frozen snapshot, captured while the squad still
//      exists. CRASH HERE: profile untouched; the stale 'applying'
//      record is lazily VOIDED (normalizeRiteRecord: every devoted uid
//      still homed -> the cost never landed -> delete the record). The
//      player lost nothing and no engraving stands: nothing duplicated.
//   3. COMMIT POINT: ONE atomic profile write carrying the entire cost
//      (squad slot deleted + every referenced uid destroyed account-
//      wide -- applyDevotionToCanvas). This is the rule-5 divergence
//      write; see the module header. CRASH AFTER: cost landed, record
//      still 'applying' -> lazily ROLLED FORWARD to 'done' (the
//      engraving the player paid for stands). Under-deliver-never-
//      duplicate, the market-settle stance: at no point can the items
//      and the void of the record coexist with a completed engraving.
//   4. Finalize: rite.state 'done'. The record is immutable from here
//      (REQ-0068 will only ever APPEND perSeason entries).
function devote(callerId, squadIndex, idemKey, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();

  // (0) Idempotency replay (finalized records only -- an 'applying'
  // record with the same key is a crashed rite, handled by the
  // eligibility normalization below, never replayed as success).
  if (idemKey) {
    for (const raw of storage.listEinherjarRecords()) {
      if (raw.playerId === callerId && raw.idemKey === idemKey
        && (!raw.rite || raw.rite.state === 'done')) {
        return { record: raw, replayed: true };
      }
    }
  }

  // (1) Eligibility.
  const doc = storage.readProfile(callerId);
  const canvas = doc ? doc.canvas : null;
  const squad = squadMetaOr404(canvas, squadIndex);
  const { reasons, engine } = riteEligibilityReasons(callerId, canvas, squadIndex, now);
  if (reasons.length > 0) {
    const reason = reasons[0];
    const err = new Error(RITE_409_MESSAGES[reason] || ('devotion refused: ' + reason));
    err.code = 'CONFLICT'; err.reason = reason; throw err;
  }

  // (2) The record: snapshot frozen BEFORE any destruction, persisted
  // as the rite lock.
  const cs = currentSeason(now);
  const snapshot = buildFrozenSnapshot(canvas, squadIndex);
  const blast = devotionBlastRadius(canvas, squadIndex);
  const tIso = new Date(now).toISOString();
  /** @type {any} */
  const record = {
    id: genId('ein'),
    playerId: callerId,
    // squadName = the squad's own display name (the mock engraves the
    // team's existing name -- 焔手の隊; a player who wants a different
    // engraving renames the squad first, via the normal client rename).
    // No uniqueness constraint [ORCH]: two rites may engrave the same
    // name as two records.
    squadName: squad.name,
    seasonDevoted: cs.season ? cs.season.index : null,
    devotedAt: tIso,
    snapshot,
    blast: blastDto(blast),
    bioArchive: null, // REQ-0060 (squad bios) not built yet -- reserved, stored empty
    perSeason: [], // 戦果 history -- REQ-0068 appends {season, battles:[...]}
    emblems: [],
    idemKey: idemKey || null,
    rite: { state: 'applying', t: tIso },
  };
  storage.writeEinherjarRecord(record.id, record);

  // (3) COMMIT POINT: the cost, in one atomic profile write.
  applyDevotionToCanvas(engine, canvas, squadIndex);
  storage.writeProfile(callerId, canvas);

  // (4) Finalize the record.
  record.rite = { state: 'done', t: tIso };
  storage.writeEinherjarRecord(record.id, record);

  return { record, replayed: false };
}

module.exports = {
  RAGNAROK_DTO_VERSION,
  RAGNAROK_DAWN_UTC_HOUR,
  SCORE_WEIGHTS,
  SCORE_FORMULA_VERSION,
  ORDER_TIERS,
  ORDER_EMBLEM_PLACEHOLDER,
  ORDER_TOP_DEFAULT,
  ORDER_TOP_MAX,
  ORDER_AROUND_SPAN,
  RITE_LOCK_TIMEOUT_MS,
  // S1 seasons
  listSeasons,
  currentSeason,
  deriveSeasonClock,
  // S2 the eternal order
  battleScoreOf,
  scoreOfRecord,
  tierOf,
  lastDawnMs,
  rebuildOrder,
  getOrderDoc,
  orderView,
  devForceRebuildOrder,
  // S3 einherjar records
  listEinherjar,
  einherjarDto,
  normalizeRiteRecord,
  devClearEinherjarRecords,
  // S4 the devotion rite
  devotionBlastRadius,
  stripDestroyedUids,
  applyDevotionToCanvas,
  buildFrozenSnapshot,
  previewDevotion,
  projectDevotionOrder,
  devote,
};
