'use strict';
// server/services/gacha.cjs -- REQ-0047 (c): Workshop gacha (REQ-0042):
// LRDST balance read, seeded polyomino/BP rolls, two-phase pending rows +
// finalize, moved VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const { genId } = require('./core.cjs');

// ---------------------------------------------------------------------
// REQ-0042: Workshop gacha (Common BP roll). Two-phase, MIRRORS the
// warehouse claim pattern (see claimWarehouseItem/finalizeClaimingItems
// ForCanvas/normalizeWarehouseStatus above) but against its OWN store
// (storage.cjs's gacha_pending, server/migrations/003_gacha.sql) since
// the finalize condition is STRICTER than a claim's: a claim finalizes
// on uid-presence alone (no currency changes hands), whereas a gacha
// roll must finalize on BOTH the minted BP uid being present in the
// saved canvas AND the player's LRDST balance having actually dropped by
// the roll's cost -- see finalizeGachaForCanvas() below.
// ---------------------------------------------------------------------
const GACHA_COMMON_BP_COST = 10; // LRDST cost of one common_bp roll (REQ doc: "costs 10x LRDST")
const GACHA_PENDING_TIMEOUT_MS = 120 * 1000; // same 120s lazy-revert window as warehouse claim
const GACHA_MIN_CELLS = 6;
const GACHA_MAX_CELLS = 8;
const GACHA_HP_PER_CELL = 15; // hpMax = 15 x cellCount
const GACHA_MIN_UNIT_DIRS = 1;
const GACHA_MAX_UNIT_DIRS = 3;
const GACHA_WALK_RETRY_CAP = 2000; // generous cap -- see rollPolyomino()'s own comment for why this can never realistically be hit for 6-8 cells

// Reads a player's CURRENT LRDST balance from their LAST-SAVED profile
// canvas (the gacha roll itself never mutates the profile -- balance is
// derived read-only, same "read the saved canvas" pattern
// finalizeClaimingItemsForCanvas uses, just summing tms[] qty for id
// 'lrdst' across every inventory page instead of scanning for a uid).
// A player with no saved profile yet (brand new, never PUT once) reads
// as balance 0 -- they cannot roll until their first save has landed
// (matches how a claim/finalize also requires a real saved canvas to
// exist; there is nothing to finalize against otherwise).
function readLrdstBalance(profileCanvas) {
  if (!profileCanvas || !profileCanvas.inv || !Array.isArray(profileCanvas.inv.pages)) return 0;
  let total = 0;
  for (const pg of profileCanvas.inv.pages) {
    for (const tm of (pg.tms || [])) {
      if (tm.id === 'lrdst') total += (Number(tm.qty) || 0);
    }
  }
  return total;
}

// rollPolyomino(rngStream, minCells, maxCells): random walk starting at
// [0,0] -- repeatedly picks a uniformly-random cell ALREADY in the
// current shape, then a uniformly-random ORTHOGONAL neighbor of that
// cell not yet in the shape, and adds it, until `cellCount` (itself
// randomly chosen in [minCells,maxCells]) cells have been placed.
// Connectivity is guaranteed BY CONSTRUCTION (every newly-added cell is
// orthogonally adjacent to a cell already in the shape -- there is no
// code path that can ever produce a disconnected shape, since a cell is
// only ever added as literally a neighbor-of-an-existing-cell). Retries
// (re-picking a different existing cell + neighbor) only happen when the
// randomly chosen existing cell happens to have ALL 4 orthogonal
// neighbors already occupied -- capped at GACHA_WALK_RETRY_CAP total
// attempts across the whole walk to make a hang structurally impossible;
// in practice this cap can never bind for cellCount in [6,8] (a shape
// that small can have at most a handful of fully-surrounded interior
// cells, and the walk only needs `cellCount-1` successful growth steps
// total), so hitting the cap would indicate a real bug, not a plausible
// runtime event -- if it IS ever hit, the function throws rather than
// silently returning a too-small shape.
function rollPolyomino(rngStream, minCells, maxCells) {
  const cellCount = minCells + Math.floor(rngStream.next() * (maxCells - minCells + 1));
  const cells = [[0, 0]];
  const inShape = new Set(['0,0']);
  /** @type {(rc: number[]) => number[][]} -- REQ-0047 (c): JSDoc only, no logic change */
  const neighborsOf = ([r, c]) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  let attempts = 0;
  while (cells.length < cellCount) {
    attempts++;
    if (attempts > GACHA_WALK_RETRY_CAP) {
      throw new Error('rollPolyomino: exceeded retry cap (' + GACHA_WALK_RETRY_CAP + ') growing a ' + cellCount + '-cell shape -- this should be structurally unreachable, see the function comment');
    }
    const fromIdx = Math.floor(rngStream.next() * cells.length);
    const from = cells[fromIdx];
    const candidates = neighborsOf(from).filter(([r, c]) => !inShape.has(r + ',' + c));
    if (candidates.length === 0) continue; // this cell is fully surrounded -- retry with a (possibly different) random existing cell
    const pick = candidates[Math.floor(rngStream.next() * candidates.length)];
    cells.push(pick);
    inShape.add(pick[0] + ',' + pick[1]);
  }
  // Normalize so min row/col = 0 -- same convention engine.js's rotOffsets
  // uses for every shape it produces (shape offsets are always
  // top-left-normalized, never negative).
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

// rollCommonBp(masterSeed): the full common_bp roll -- polyomino shape,
// unit cell (uniformly chosen FROM the polyomino's own cells, per the
// REQ doc), 1-3 random distinct unit directions (0-7, matching
// engine.js's DIRS numeric convention), hpMax = 15 x cellCount, and a
// freshly minted uid for the BP instance. Uses sim/combat.cjs's existing
// makeRng() seeded-RNG helper (already required at the top of this file
// as `combat`) rather than Math.random(), so a given masterSeed always
// reproduces the exact same roll -- same reproducibility property every
// other seeded roll in this codebase (dungeon runs, reward distribution)
// already has, and the same reason: deterministic, testable, auditable.
function rollCommonBp(masterSeed) {
  const rng = combat.makeRng(masterSeed);
  const shapeStream = rng.stream('gacha/common_bp/shape');
  const unitStream = rng.stream('gacha/common_bp/unit');
  const shape = rollPolyomino(shapeStream, GACHA_MIN_CELLS, GACHA_MAX_CELLS);
  const unitIdx = Math.floor(unitStream.next() * shape.length);
  const unitOff = shape[unitIdx];
  const dirCount = GACHA_MIN_UNIT_DIRS + Math.floor(unitStream.next() * (GACHA_MAX_UNIT_DIRS - GACHA_MIN_UNIT_DIRS + 1));
  const availableDirs = [0, 1, 2, 3, 4, 5, 6, 7];
  const dirs = [];
  for (let i = 0; i < dirCount; i++) {
    const idx = Math.floor(unitStream.next() * availableDirs.length);
    dirs.push(availableDirs.splice(idx, 1)[0]);
  }
  const hpMax = GACHA_HP_PER_CELL * shape.length;
  const uid = genId('bp');
  return {
    uid,
    shape,
    linker: { off: unitOff, dirs },
    hpMax,
    cellCount: shape.length,
  };
}

// startGachaRoll(playerId, kind, profileCanvas): verifies balance >=
// GACHA_COMMON_BP_COST against the LAST-SAVED profile (read-only -- see
// readLrdstBalance above), rolls a fresh BP instance with a
// crypto-random master seed (stored verbatim on the pending doc, same
// "store the seed, never re-roll" convention startRun() already uses),
// records a PENDING roll in the gacha_pending store keyed by the
// MINTED BP UID (reusing that uid as the pending row's own key --
// exactly the same "reuse the content uid as the row key" interpretation
// claimWarehouseItem made for warehouse claims, so finalization is an
// unambiguous uid-membership check here too), and returns the rolled BP
// definition to the caller WITHOUT deducting anything server-side yet.
function startGachaRoll(playerId, kind, profileCanvas) {
  if (kind !== 'common_bp') {
    const err = new Error('unknown gacha kind: ' + kind); err.code = 'BAD_REQUEST'; throw err;
  }
  const cost = GACHA_COMMON_BP_COST;
  const balance = readLrdstBalance(profileCanvas);
  if (balance < cost) {
    const err = new Error('insufficient LRDST balance: have ' + balance + ', need ' + cost); err.code = 'CONFLICT'; throw err;
  }
  const seed = crypto.randomBytes(16).toString('hex');
  const rolled = rollCommonBp(seed);
  const now = new Date().toISOString();
  const doc = {
    rollUid: rolled.uid,
    playerId,
    kind,
    cost,
    seed,
    rolled,
    balanceBeforeRoll: balance,
    status: 'pending',
    rolledAt: now,
  };
  storage.writeGachaPending(playerId, rolled.uid, doc);
  return { cost, rolled };
}

// normalizeGachaPendingStatus / purgeExpiredGachaPending: lazy-revert
// mechanism for abandoned rolls, BYTE-FOR-BYTE mirroring
// normalizeWarehouseStatus/purgeExpiredWarehouseItems's own lazy-check-
// on-every-read pattern (no setInterval/cron -- reverting an abandoned
// roll just means DELETING the pending doc, since a gacha roll -- unlike
// a warehouse row -- has no "goes back to being claimable" state; an
// abandoned roll's BP definition is simply discarded, the player can
// roll again).
function normalizeGachaPendingStatus(playerId, item, nowMs) {
  const rolledAtMs = item.rolledAt ? Date.parse(item.rolledAt) : 0;
  if (!rolledAtMs || (nowMs - rolledAtMs) >= GACHA_PENDING_TIMEOUT_MS) {
    storage.deleteGachaPending(playerId, item.rollUid);
    return null; // reverted/expired -- caller must drop it from any in-progress list
  }
  return item;
}
function purgeExpiredGachaPending(playerId) {
  const now = Date.now();
  const items = storage.listGachaPending(playerId);
  const survivors = [];
  for (const item of items) {
    const kept = normalizeGachaPendingStatus(playerId, item, now);
    if (kept) survivors.push(kept);
  }
  return survivors;
}

// finalizeGachaForCanvas (REQ-0042): called by server/api.cjs's profile
// PUT handler, alongside (not instead of) finalizeClaimingItemsForCanvas
// -- AFTER a successful storage.writeProfile(). A pending roll finalizes
// (its gacha_pending doc is deleted) iff BOTH:
//   (1) the minted BP uid (rollUid) now appears in the just-saved canvas
//       (bps[].id, scanned the SAME way finalizeClaimingItemsForCanvas
//       scans -- active squad + every inactive squad snapshot + every
//       inventory page), AND
//   (2) the player's LRDST balance in the just-saved canvas is <= the
//       pre-roll balance MINUS the roll's cost (strictly, the client is
//       expected to deduct EXACTLY `cost`, but "<=" tolerates the client
//       having ALSO spent LRDST on something else in the same save
//       without falsely blocking finalization -- the important
//       invariant is "at least `cost` left this player's balance since
//       the roll", not "balance decreased by EXACTLY cost and nothing
//       else happened in the interim").
// This is deliberately STRICTER than claimWarehouseItem's uid-only check
// (see the module comment above) because a gacha roll, unlike a
// warehouse claim, involves a real currency deduction that must not be
// forgeable by placing the BP without ever paying for it.
function finalizeGachaForCanvas(playerId, canvas) {
  if (!canvas) return;
  const pending = purgeExpiredGachaPending(playerId).filter((i) => i.status === 'pending');
  if (!pending.length) return;

  const presentBpUids = new Set();
  const collectBps = (container) => {
    if (!container) return;
    for (const b of container.bps || []) presentBpUids.add(b.id);
  };
  collectBps(canvas);
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) collectBps(snap);
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) collectBps(pg);
  }
  const balanceNow = readLrdstBalance(canvas);

  for (const item of pending) {
    const uidPresent = presentBpUids.has(item.rollUid);
    const balanceDropped = balanceNow <= (item.balanceBeforeRoll - item.cost);
    if (uidPresent && balanceDropped) {
      storage.deleteGachaPending(playerId, item.rollUid);
    }
  }
}


module.exports = {
  GACHA_COMMON_BP_COST,
  GACHA_PENDING_TIMEOUT_MS,
  GACHA_MIN_CELLS,
  GACHA_MAX_CELLS,
  GACHA_HP_PER_CELL,
  GACHA_MIN_UNIT_DIRS,
  GACHA_MAX_UNIT_DIRS,
  GACHA_WALK_RETRY_CAP,
  readLrdstBalance,
  rollPolyomino,
  rollCommonBp,
  startGachaRoll,
  normalizeGachaPendingStatus,
  purgeExpiredGachaPending,
  finalizeGachaForCanvas,
};
