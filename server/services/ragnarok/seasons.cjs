// backpack_ragnarok -- server/services/ragnarok/seasons.cjs
// REQ-0145a (sd): S1 season registry extracted verbatim from the
// pre-split services/ragnarok.cjs (origin lines 124-211 @ commit
// 7105d23).
'use strict';
const fs = require('fs');
const { SEASONS_PATH, DAY_MS } = require('./lib.cjs');

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

module.exports = {
  listSeasons,
  currentSeason,
  deriveSeasonClock,
};
