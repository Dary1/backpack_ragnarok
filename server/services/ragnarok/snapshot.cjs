// backpack_ragnarok -- server/services/ragnarok/snapshot.cjs
// REQ-0145a (sd): the devoted-squad frozen snapshot (content defs frozen
// at rite time) extracted verbatim from the pre-split
// services/ragnarok.cjs (origin lines 703-727, 733-763 @ commit
// 7105d23).
'use strict';
const fs = require('fs');
const { getScheduleContent } = require('../core.cjs');
const { squadCanvasOf } = require('../squads.cjs');
const { SIS_PATH, deepCopy } = require('./lib.cjs');

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

module.exports = {
  getSiDefsById,
  buildFrozenSnapshot,
};
