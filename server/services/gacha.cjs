'use strict';
// server/services/gacha.cjs -- REQ-0047 (c): Workshop gacha (REQ-0042):
// LRDST balance read, seeded polyomino/BP rolls, two-phase pending rows +
// finalize, moved VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const { genId, getScheduleContent } = require('./core.cjs');

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
const { GACHA_COMMON_BP_COST } = require('../../shared/constants.json'); // LRDST cost of one common_bp roll -- the DEFAULT for a pack that omits `cost`; the pack def is authoritative (REQ-0170)
const GACHA_PENDING_TIMEOUT_MS = 120 * 1000; // same 120s lazy-revert window as warehouse claim
const GACHA_MIN_CELLS = 6;   // default when a pack omits `cells`
const GACHA_MAX_CELLS = 8;   // default when a pack omits `cells`
const GACHA_HP_PER_CELL = 15; // default when a pack omits `hp_per_cell`; hpMax = hp_per_cell x cellCount
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

// resolvePack(kind): the gacha_pack/1 def for `kind`, from content (REQ-0170).
// A pack is DATA -- WHICH Units it can emit, at what weight, for what cost. The
// old code hard-coded a single `if (kind !== 'common_bp')` branch; a pack is now a
// row in content/live/live_packs.json, which is what lets REQ-0171 put a content-
// admin screen on top of it without touching this file.
function resolvePack(kind) {
  const { packDefsById } = getScheduleContent();
  const pack = packDefsById[kind];
  if (!pack) {
    const err = new Error('unknown gacha pack: ' + kind); err.code = 'BAD_REQUEST'; throw err;
  }
  return pack;
}

// pickWeighted(stream, pool): one weighted draw from a pack's pool. Weights are
// positive numbers; the draw is a single stream.next() against the cumulative
// total, so a given seed reproduces the exact same unit -- the same determinism
// contract the shape roll has always had (see rollPolyomino's comment).
function pickWeighted(stream, pool) {
  let total = 0;
  for (const row of pool) total += Math.max(0, Number(row.weight) || 0);
  if (!(total > 0)) {
    const err = new Error('gacha pack pool has no positive weight'); err.code = 'CONFLICT'; throw err;
  }
  let x = stream.next() * total;
  for (const row of pool) {
    x -= Math.max(0, Number(row.weight) || 0);
    if (x < 0) return row;
  }
  return pool[pool.length - 1]; // float-rounding tail; unreachable in practice
}

// rollPackBp(pack, masterSeed): THE roll (REQ-0170). What comes out is a UNIT --
// a character drawn from the pack's pool -- together with the BP that is its
// inventory. The BP half (random-walk polyomino, a seat chosen uniformly from the
// polyomino's own cells, hpMax = hp_per_cell x cellCount, a freshly minted uid) is
// UNCHANGED from REQ-0042's common_bp roll; what changed is what sits in the seat.
//
// The retired model rolled `linker: {off, dirs}` -- 1-3 random compass directions,
// an anonymous beam emitter with no identity. A Unit's rays are NOT rolled: they
// come from its def's connection_shape (vocab v13). That is the whole point of the
// pivot, and the reason every BP minted before this REQ is unsalvageable: no
// migration can invent an identity that was never rolled.
//
// The BP stores ONLY {id, off} -- the identity and the seat. Everything else about
// the Unit (art, rarity, shape, name) is looked up in the def at read time, so a
// content-side change reaches every BP already saved in every profile.
// rollPackBonuses(rng, pack): REQ-0062. Rolls the pack's bonus slots (0..2) -- the
// "synergy bundle" that rides atop the guaranteed BP. Each slot draws ONE weighted
// entry from its own table via a DEDICATED per-slot RNG sub-stream
// ('gacha/<pack>/bonus/<i>'), so the labels keep the guaranteed-BP streams
// (shape/unit) and every bonus slot statistically independent yet fully reproducible
// from the stored master seed (house RNG discipline). A drawn row yields a freshly
// minted uid + a read-only def echo for the result modal (name/icon/rarity/i18n) --
// the same "echo the def, persist only the id" contract rollPackBp uses for the Unit.
// Rows whose id has no live content def are filtered out (never advertise what cannot
// drop); a slot left empty after filtering is skipped. The two-phase finalize is
// UNCHANGED: bonuses ride the same client-authored save as the guaranteed BP, whose
// uid + the balance-delta remain the only finalize gate (see finalizeGachaForCanvas).
function rollPackBonuses(rng, pack) {
  const slots = Array.isArray(pack.bonus) ? pack.bonus : [];
  if (!slots.length) return [];
  const { itemDefsById, siDefsById, tmDefsById } = getScheduleContent();
  const defMapFor = (pool) => pool === 'po' ? itemDefsById : pool === 'si' ? siDefsById : pool === 'tm' ? tmDefsById : null;
  const out = [];
  slots.forEach((slot, i) => {
    const defs = defMapFor(slot.pool);
    if (!defs) return;
    const rows = (slot.table || []).filter((row) => row && defs[row.id]).map((row) => ({ weight: row.weight, ref: row }));
    if (!rows.length) return;
    const stream = rng.stream('gacha/' + pack.id + '/bonus/' + i);
    const chosen = pickWeighted(stream, rows).ref;
    const def = defs[chosen.id];
    const uidPrefix = slot.pool === 'po' ? 'po' : slot.pool === 'si' ? 'si' : 'tm';
    out.push({
      slot: i,
      pool: slot.pool,
      id: chosen.id,
      uid: genId(uidPrefix),
      qty: Number.isInteger(chosen.qty) && chosen.qty > 0 ? chosen.qty : 1,
      def: { id: chosen.id, name: def.name, icon: def.icon, rarity: def.rarity, i18n: def.i18n || {} },
    });
  });
  return out;
}

function rollPackBp(pack, masterSeed) {
  const { unitDefsById } = getScheduleContent();
  const cells = Array.isArray(pack.cells) ? pack.cells : [GACHA_MIN_CELLS, GACHA_MAX_CELLS];
  const hpPerCell = Number(pack.hp_per_cell) || GACHA_HP_PER_CELL;
  const pool = (pack.pool || []).filter((row) => row && unitDefsById[row.unit]);
  if (!pool.length) {
    const err = new Error('gacha pack "' + pack.id + '" has no pool entry backed by a live unit def'); err.code = 'CONFLICT'; throw err;
  }

  const rng = combat.makeRng(masterSeed);
  const shapeStream = rng.stream('gacha/' + pack.id + '/shape');
  const unitStream = rng.stream('gacha/' + pack.id + '/unit');

  const shape = rollPolyomino(shapeStream, cells[0], cells[1]);
  const seatIdx = Math.floor(unitStream.next() * shape.length);
  const seat = shape[seatIdx];
  const picked = pickWeighted(unitStream, pool);
  const def = unitDefsById[picked.unit];

  const hpMax = hpPerCell * shape.length;
  const uid = genId('bp');
  // REQ-0062: the pack's bonus slots, rolled from dedicated per-slot sub-streams of
  // the SAME master seed (see rollPackBonuses). Empty array for a pack with no bonus.
  const bonuses = rollPackBonuses(rng, pack);
  return {
    uid,
    shape,
    unit: { id: picked.unit, off: seat },
    hpMax,
    cellCount: shape.length,
    bonuses,
    // Echoed to the client for the result modal ONLY -- never persisted on the BP.
    // The def is the source of truth and is re-read from /api/content on every boot.
    unitDef: {
      id: picked.unit,
      name: def.name,
      icon: def.icon,
      rarity: def.rarity,
      connection_shape: def.connection_shape,
      i18n: def.i18n || {},
    },
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
  const pack = resolvePack(kind);
  const cost = Number.isFinite(Number(pack.cost)) ? Number(pack.cost) : GACHA_COMMON_BP_COST;
  const balance = readLrdstBalance(profileCanvas);
  if (balance < cost) {
    const err = new Error('insufficient LRDST balance: have ' + balance + ', need ' + cost); err.code = 'CONFLICT'; throw err;
  }
  const seed = crypto.randomBytes(16).toString('hex');
  const rolled = rollPackBp(pack, seed);
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
      // REQ-0060: the rolled BP is now real in the player's canvas -- stamp
      // its birth (origin: gacha) so the biography ledger has a born date.
      try {
        const nm = item.rolled && item.rolled.unitDef ? item.rolled.unitDef.name : undefined;
        require('./bio.cjs').ensureBio(item.rollUid, 'gacha', nm);
      } catch (e) { /* bio is non-critical */ }
    }
  }
}


module.exports = {
  GACHA_COMMON_BP_COST,
  GACHA_PENDING_TIMEOUT_MS,
  GACHA_MIN_CELLS,
  GACHA_MAX_CELLS,
  GACHA_HP_PER_CELL,
  GACHA_WALK_RETRY_CAP,
  readLrdstBalance,
  rollPolyomino,
  resolvePack,
  pickWeighted,
  rollPackBp,
  rollPackBonuses,
  startGachaRoll,
  normalizeGachaPendingStatus,
  purgeExpiredGachaPending,
  finalizeGachaForCanvas,
};
