// backpack_ragnarok -- server/services/ragnarok/order.cjs
// REQ-0145a (sd): S2 the Eternal Order (lazy daily-dawn rebuild, views)
// extracted verbatim from the pre-split services/ragnarok.cjs (origin
// lines 213-215, 239-252, 259-399 @ commit 7105d23).
'use strict';
const storage = require('../../storage.cjs');
const {
  DAY_MS, RAGNAROK_DAWN_UTC_HOUR, SCORE_FORMULA_VERSION, ORDER_TIERS,
  ORDER_EMBLEM_PLACEHOLDER, ORDER_TOP_DEFAULT, ORDER_TOP_MAX,
  ORDER_AROUND_SPAN, playerNameOf,
} = require('./lib.cjs');
const { normalizeRiteRecord, scoreOfRecord } = require('./einherjar.cjs');

// ---------------------------------------------------------------------
// S2 The 戦果 fold + the Eternal Order's lazy daily-dawn rebuild.
// ---------------------------------------------------------------------

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

module.exports = {
  tierOf,
  lastDawnMs,
  cmpOrderEntries,
  rebuildOrder,
  getOrderDoc,
  devForceRebuildOrder,
  orderView,
};
