'use strict';
// server/services/dismantle.cjs -- REQ-0063: the Dismantle system.
//
// Two halves, per the REQ's own split:
//   1. THE LEDGER (§1): a per-player, per-Dex-entry (PO or SI content id)
//      permanent counter (分解値), engraved forever, never reset. Backed
//      by storage.cjs's readDismantleLedger/writeDismantleLedger (one
//      whole-doc-per-player blob, see that file's own section comment).
//   2. THE QUALITY ROLL (the corrected §2 -- see the note below): NOT a
//      drop-table weight adjustment (an earlier, INCORRECT reading of
//      this REQ's spec text assumed that; there is no weighted drop
//      table anywhere in this codebase to adjust -- see
//      services/core.cjs's REWARD_ROLL_TO_ITEM_ID, a fixed 1:1 map).
//      The REAL mechanic, per the user's direct correction: at the
//      moment a PO/SI INSTANCE is minted, it receives a random quality
//      roll `q` in [0,1) whose FLOOR rises with that item id's own 分解
//      値 (asymptotically toward, never reaching, a 50% cap -- see
//      SUPPRESSION_CAP below). `q` rides on the instance itself (see
//      mock-src/engine.js's q-carrying edits) and is consumed at combat-
//      compile time by sim/lib/compile.cjs's applyQualityToEffects,
//      which narrows a strike/multi_strike verb's [lo,hi] range to
//      [lo+q*(hi-lo), hi] -- i.e. "the minimum approaches the maximum,
//      capped at the midpoint, asymptotically".
//
// Yield (§3): [USER pick] flat 1 lrdst (Weathervane) per dismantle, for
// now -- rarity-tiered tuning is deliberately deferred to REQ-0086 (see
// that REQ's own draft). Lands via the SAME house grant pattern as every
// other credit in this app (warehouse.cjs's grantTmQty) -- see the
// RULE-5 note on dismantleItem() below for why the ITEM REMOVAL half is
// allowed to write the canvas directly while the YIELD half is not.
const storage = require('../storage.cjs');
const { grantTmQty } = require('./warehouse.cjs');
const { deployedUidSet } = require('./market.cjs');

// ---------------------------------------------------------------------
// §1 The ledger
// ---------------------------------------------------------------------

function readCounts(playerId) {
  const doc = storage.readDismantleLedger(playerId);
  return (doc && doc.counts) || {};
}

function dismantleCountFor(playerId, itemId) {
  return readCounts(playerId)[itemId] || 0;
}

// engrave: +1, forever. Returns the NEW count. Never decreases, never
// resets (record/power split, same law as REQ-0060's bio_luck -- see
// this REQ's §5).
function engrave(playerId, itemId) {
  const counts = readCounts(playerId);
  counts[itemId] = (counts[itemId] || 0) + 1;
  storage.writeDismantleLedger(playerId, { playerId, updated_at: new Date().toISOString(), counts });
  return counts[itemId];
}

// ---------------------------------------------------------------------
// The suppression curve (shared by the ledger's Dex display AND the
// quality-roll floor -- ONE formula, per the REQ's own "loot shaping
// must be visible" requirement: whatever floor the player is actually
// getting is the SAME number the Dex shows them).
//
// s(n) = CAP * (1 - DECAY^n): asymptotic, hard floor at 0, hard cap at
// CAP (never reached -- DECAY^n > 0 for every finite n), strong-early/
// diminishing-later marginal effect per the user's own confirmed spec
// ("最初のうちは...強く、徐々に...減っていく"). CAP=0.5 is LOCKED (the
// user's explicit "最大50%"). DECAY=0.85 is [TUNABLE] -- not confirmed
// by the user as an exact numeric constant, only the qualitative shape
// was; documented here as a flagged implementer judgment call per this
// project's own culture (see REQ-0063's [TUNABLE] markers elsewhere in
// the same doc). At DECAY=0.85: n=1 -> 7.5%, n=5 -> 27.8%, n=10 -> 40.1%,
// n=20 -> 48.1%, approaching but never reaching 50%.
// ---------------------------------------------------------------------
const SUPPRESSION_CAP = 0.5; // [USER] locked: "最大50%"
const SUPPRESSION_DECAY = 0.85; // [TUNABLE]

function suppressionFloor(n) {
  return SUPPRESSION_CAP * (1 - Math.pow(SUPPRESSION_DECAY, n));
}

function currentSuppression(playerId, itemId) {
  return suppressionFloor(dismantleCountFor(playerId, itemId));
}

// rollQuality: mint-time quality roll for a NEW PO/SI instance of
// `itemId` about to enter `playerId`'s possession (dungeon reward,
// market delivery -- actually NO: market delivery COPIES the existing
// instance's own q rather than re-rolling, see server/services/
// market.cjs's buyListing -- admin grant, or warehouse TTL
// auto-dismantle's own replacement roll). Uses plain Math.random(), NOT
// the seeded sim RNG: this is a one-time mint decision with no replay/
// determinism contract (unlike combat, which MUST be seed-reproducible
// -- see sim/lib/rng.cjs's module contract), so there is nothing to gain
// from threading a stored seed through it, and doing so would add
// ceremony with no payoff.
function rollQuality(playerId, itemId) {
  const qFloor = currentSuppression(playerId, itemId);
  return qFloor + Math.random() * (1 - qFloor);
}

// ---------------------------------------------------------------------
// §4 Dismantle action -- canvas item removal + engraving + yield.
//
// RULE-5 divergence (same sanctioned exception market.cjs's buyListing
// already documents, and the SAME shape): docs/architecture.md rule 5
// says the client's auto-save PUT is the one profile writer, and
// ADDITIONS go through the two-phase warehouse-grant pattern. Removing
// an item from the CALLER'S OWN canvas, atomically, in response to the
// caller's own explicit action (unlike market settlement's two-party
// case, there is only one party here) is safe to do server-side for the
// SAME reason market's seller-side removal is: the write only REMOVES
// something, never adds -- the yield (an addition) is deliberately
// NOT written directly onto this canvas; it goes through
// warehouse.cjs's grantTmQty, the normal claimable-row/two-phase-claim
// path, exactly like market's seller-proceeds row. Neither this
// function nor any dismantle caller ever calls storage.writeProfile()
// to ADD something -- only to remove.
// ---------------------------------------------------------------------

const YIELD_TM_ID = 'lrdst';
const YIELD_QTY = 1; // [USER] "一旦 weathervane1個で進めてください" -- rarity tuning deferred, see REQ-0086 draft

// findInventoryItem: locates itemUid among the player's INVENTORY pages'
// pos[] (kind 'po') or sis[] (kind 'si') entries -- the generalized,
// both-kinds sibling of market.cjs's findInventoryPO (that function is
// deliberately PO-only per its own doc; dismantle needs both, per the
// user's explicit "通常アイテム(PO/SI)" scope).
function findInventoryItem(canvas, itemUid, kind) {
  if (!canvas || !canvas.inv || !Array.isArray(canvas.inv.pages)) return null;
  const key = kind === 'si' ? 'sis' : 'pos';
  for (const pg of canvas.inv.pages) {
    for (const rec of (pg && pg[key]) || []) {
      if (rec.uid === itemUid) return rec;
    }
  }
  return null;
}

// stripItemFromCanvas: removes every pos[]/sis[] entry with `uid` from
// the canvas -- inventory pages, the active preset's top-level arrays,
// and every stored preset snapshot. Generalized sibling of market.cjs's
// stripPoFromCanvas (not exported from that module, and PO-only there);
// same container walk, same reasoning (a stale un-deployed reference
// must not survive as a ghost after its home record is destroyed).
function stripItemFromCanvas(canvas, uid, kind) {
  const key = kind === 'si' ? 'sis' : 'pos';
  const idField = kind === 'si' ? 'uid' : 'uid';
  const strip = (container) => {
    if (container && Array.isArray(container[key])) {
      container[key] = container[key].filter((rec) => rec[idField] !== uid);
    }
  };
  strip(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg);
  }
  // An SI dismantled while seated leaves its host PO's socket empty --
  // no separate unseat step needed: the SI record itself (wherever it
  // is, home or seated-reference) is simply gone; hostOk/seatSI's own
  // existence checks already treat a missing siUid as unseated.
}

// dismantleItem: the atomic action, self-contained like
// market.cjs's buyListing (reads the caller's OWN last-saved canvas
// itself -- the route handler passes only identity + the request body).
// Returns {ok:true, itemId, dismantleCount, suppression, yield:{tmId,
// qty}} or throws {code} for the route handler to translate (NOT_FOUND /
// CONFLICT).
function dismantleItem(playerId, itemUid, kind) {
  const doc = storage.readProfile(playerId);
  const canvas = doc ? doc.canvas : null;
  const rec = canvas ? findInventoryItem(canvas, itemUid, kind) : null;
  if (!rec) {
    const err = new Error('item not found in your inventory'); err.code = 'NOT_FOUND'; throw err;
  }
  // Deployed gate (§4): reuses market.cjs's own Law-of-Possession set --
  // an item standing ready in an open/active schedule room cannot be
  // dismantled out from under it, same rule market already enforces for
  // selling.
  if (deployedUidSet(playerId, canvas).has(itemUid)) {
    const err = new Error('cannot dismantle: this item is currently deployed'); err.code = 'CONFLICT'; err.reason = 'deployed'; throw err;
  }
  // Fixed-starter-job gate (§4, spec text): NO "fixed starter PO" concept
  // exists anywhere in this codebase today (confirmed: market.cjs's own
  // findInventoryPO doc notes the identical absence for selling) -- so
  // this gate is a documented, honest no-op rather than a check against
  // a flag that cannot exist yet. Revisit together if/when REQ-0051
  // (starter jobs) ships that concept.
  const itemId = rec.id;
  stripItemFromCanvas(canvas, itemUid, kind);
  storage.writeProfile(playerId, canvas); // removal-only write -- see the RULE-5 note above
  const dismantleCount = engrave(playerId, itemId);
  grantTmQty(playerId, YIELD_TM_ID, YIELD_QTY); // addition -- goes through the house grant/claim path, never straight onto the canvas
  return {
    ok: true,
    itemId,
    dismantleCount,
    suppression: suppressionFloor(dismantleCount),
    yield: { tmId: YIELD_TM_ID, qty: YIELD_QTY },
  };
}

module.exports = {
  SUPPRESSION_CAP,
  SUPPRESSION_DECAY,
  suppressionFloor,
  dismantleCountFor,
  currentSuppression,
  rollQuality,
  engrave,
  findInventoryItem,
  stripItemFromCanvas,
  dismantleItem,
  YIELD_TM_ID,
  YIELD_QTY,
};
