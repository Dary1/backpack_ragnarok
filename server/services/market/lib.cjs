// backpack_ragnarok -- server/services/market/lib.cjs
// REQ-0145a (sd): shared market plumbing extracted verbatim from the
// pre-split services/market.cjs (origin lines 75-169 @ commit 6eafed8):
// the [TUNABLE] block + burnOf (law 2), dex numbering, and the read-only
// canvas helpers (findInventoryPO / readTmBalance). Consumers outside
// services/market/ must keep requiring the services/market.cjs facade
// (design rule 3), never this file.
'use strict';
const fs = require('fs');

// REQ-0145a (sc): resolved via the ONE content-file loader
// (lib/content_files.cjs; CONTENT_ROOT env override honored, default
// byte-equivalent to the old os.homedir() anchoring). Captured at module
// load; tests remap homedir / inject CONTENT_ROOT + evict the module
// tree, so this rebinds exactly like before.
const { contentPath } = require('../../lib/content_files.cjs');
const ITEMS_PATH = contentPath('live', 'live_items.json');

// ---------------------------------------------------------------------
// Tunables ([TUNABLE] -- market-policy level, same posture as
// services/core.cjs's own tunables block).
// ---------------------------------------------------------------------
// The ONE trade TM (law 1). Engine/content id `lrdst` -- cited from
// content/live/live_tms.json (sole entry) and services/gacha.cjs's
// readLrdstBalance(). If a dedicated trade TM ships later, this constant
// (and the content) is the only place to touch.
const MARKET_TM_ID = 'lrdst';
const MARKET_BURN_RATE = 0.08; // law 2 -- the furnace tithe
const MARKET_PRICE_MIN = 1; // mock stepper: integer, min 1
const MARKET_PRICE_MAX = 999; // mock stepper: cap 999
const MARKET_LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // [TUNABLE] 7d shelf life, lazy expiry (mock: "counted out its seven days")
const DEX_PRICE_HISTORY_MAX = 5; // rolling last-5 settled prices per itemId (storage side; full REQ-0052 dex-card integration deferred)
const MARKET_DTO_VERSION = 1; // wire-shape version stamped on every /api/market response (shared/dto.ts ApiMarket*)

// burnOf: THE burn function (law 2). Byte-identical math to the mock's
// own burnOf (web/redesign/market.html ~line 930). Settlement-only --
// no other code path may ever burn.
function burnOf(qty) {
  return Math.max(1, Math.ceil(qty * MARKET_BURN_RATE));
}

// ---------------------------------------------------------------------
// Dex numbering (mock: "No.061" chips; q= search accepts a Dex No.).
// No dex-number registry exists in content yet (REQ-0052's dex cards
// are a later squad) -- v1 interpretation: dexNo = 1-based position of
// the item's entry in content/live/live_items.json's entries array (the
// exact order /api/content serves). Pilot-batch overlay items absent
// from live_items.json get dexNo null ("not in the dex yet").
// mtime-cached, mirroring services/core.cjs's getScheduleContent().
// ---------------------------------------------------------------------
let dexNoCache = null; // { mtime, byId }

function getDexNoById() {
  let mtime = null;
  try { mtime = fs.statSync(ITEMS_PATH).mtimeMs; } catch (e) { mtime = null; }
  if (dexNoCache && dexNoCache.mtime === mtime) return dexNoCache.byId;
  /** @type {Record<string, number>} */
  const byId = {};
  try {
    const doc = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
    (doc.entries || []).forEach((e, i) => { byId[e.id] = i + 1; });
  } catch (e) { /* no live items -> empty map; listings then carry dexNo null */ }
  dexNoCache = { mtime, byId };
  return byId;
}

// ---------------------------------------------------------------------
// Canvas helpers (read-only unless explicitly part of a settle write).
// ---------------------------------------------------------------------

// findInventoryPO: locates itemUid among the seller's INVENTORY pages'
// pos[] entries. v1 sells POs only: every listing card in the mock is a
// PO, and the buyer-side delivery is a plain warehouse row claimed via
// services/warehouse.cjs claimWarehouseItem. NOTE (REQ-0115): that claim
// path now also accepts SI ids (itemDefsById OR siDefsById), so an SI row
// IS claimable -- market still lists POs only as a v1 scope choice, not a
// claim-path limitation. BP listings remain a later squad.
// No "fixed starter PO" concept exists in the codebase today (grep for
// 'starter' across mock-src/engine.js, shared/engine.d.ts and
// server/services/ comes back empty), so there is no starter-item
// exclusion to enforce yet -- revisit when that concept ships.
function findInventoryPO(canvas, itemUid) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) return null;
  for (const pg of canvas.inv.pages) {
    for (const p of (pg && pg.pos) || []) {
      if (p.uid === itemUid) return p;
    }
  }
  return null;
}

// readTmBalance: sums qty across every same-id TM stack in the canvas's
// inventory pages. Generalized (tmId parameter) from services/
// gacha.cjs's readLrdstBalance() -- same "read the last-saved canvas"
// posture: no profile is ever mutated by a balance READ.
function readTmBalance(canvas, tmId) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) return 0;
  let total = 0;
  for (const pg of canvas.inv.pages) {
    for (const tm of (pg && pg.tms) || []) {
      if (tm.id === tmId) total += (Number(tm.qty) || 0);
    }
  }
  return total;
}

module.exports = {
  MARKET_TM_ID,
  MARKET_BURN_RATE,
  MARKET_PRICE_MIN,
  MARKET_PRICE_MAX,
  MARKET_LISTING_TTL_MS,
  DEX_PRICE_HISTORY_MAX,
  MARKET_DTO_VERSION,
  burnOf,
  getDexNoById,
  findInventoryPO,
  readTmBalance,
};
