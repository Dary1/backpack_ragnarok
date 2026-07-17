'use strict';
// server/services/gacha.cjs -- REQ-0047 (c): Workshop gacha (REQ-0042):
// LRDST balance read, seeded polyomino/BP rolls, two-phase pending rows +
// finalize, moved VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const { genId, getScheduleContent, debitTmFromCanvas, WAREHOUSE_CAP, WAREHOUSE_TTL_MS } = require('./core.cjs');
const { purgeExpiredWarehouseItems, addToWarehouse } = require('./warehouse.cjs'); // REQ-0215: delivery goes through the ONE warehouse insert chokepoint

// ---------------------------------------------------------------------
// REQ-0215: the Workshop gacha is a PURCHASE, not a two-phase placement.
//
// WHAT CHANGED AND WHY (REQ-0042/0170 -> REQ-0215). The roll used to hand the
// rolled BP back to the client, which deducted the LRDST, first-fit-placed the
// BP onto its own canvas and auto-saved; that PUT finalized a `gacha_pending`
// row iff BOTH (a) the minted BP uid appeared in the saved canvas AND (b) the
// balance had dropped by the cost. The user's REQ-0215 spec moved delivery to
// the WAREHOUSE -- so the BP never enters the canvas on roll, and gate (a) is
// structurally impossible. Gate (b) ALONE is not a substitute: spending >= cost
// LRDST on anything else inside the pending window (a market buy debits the
// canvas server-side, so it qualifies) would finalize the roll for free. That
// hole is why the pending machinery is GONE rather than re-gated.
//
// After the spec change a roll and a market buy are the same transaction: pay a
// TM, the goods land in the buyer's warehouse as a claimable row. So this
// module now follows services/market/trade.cjs's buyListing step-order exactly
// -- validate balance + warehouse cap BEFORE the commit point (no partial
// settle), then debit the canvas server-side and deliver -- and inherits its
// SANCTIONED rule-5 divergence (docs/llm_managed/architecture.md rule 5; the
// writeup lives at the head of services/market.cjs). A roll can no longer be
// abandoned: it either fully happened or it did not, so there is nothing left
// for a lazy-revert timeout to revert.
//
// CLIENT GOTCHA (same as buyListing's, tightened): the server writes the
// player's canvas here, so a stale in-flight auto-save can resurrect the
// pre-roll canvas -- handing the LRDST back while the Unit sits in the
// warehouse. Unlike a market settle (where the seller may be offline), a roll
// is ALWAYS initiated by the client that owns the canvas, so both windows are
// closable and the client is required to close them: flushAutoSave() before the
// roll POST, re-GET the profile after it (see client/src/schedule/WorkshopPage.tsx).
// ---------------------------------------------------------------------
const { GACHA_COMMON_BP_COST } = require('../../shared/constants.json'); // LRDST cost of one common_bp roll -- the DEFAULT for a pack that omits `cost`; the pack def is authoritative (REQ-0170)
const GACHA_TM_ID = 'lrdst'; // REQ-0215: the currency a roll is priced in -- the same id readLrdstBalance sums and market's MARKET_TM_ID
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

// startGachaRoll(playerId, kind, profileCanvas) -- REQ-0215. ONE synchronous
// transaction, built on buyListing's step order (see the module header for why
// the two-phase pending roll is gone):
//
//   1-2. validate: pack, LRDST balance, warehouse capacity -- all BEFORE the
//        commit point, so a refusal costs the player nothing (no debit, no row).
//   3.   roll: rollPackBp() with a crypto-random master seed. Deliberately runs
//        BEFORE the cap check reads its result, and that is safe because the
//        roll is PURE -- it mints uids and computes a shape, but persists
//        nothing. We need its bonus count to know how many rows to reserve.
//   4.   COMMIT: debit the cost server-side, write the profile.
//   5.   deliver: the Unit as a kind:'bp' row (the REQ-0195d market-bought-unit
//        row shape, byte-for-byte -- the warehouse list, the claim validator and
//        the client's firstFitPlaceBp path all already handle it; this REQ adds
//        no new row kind), each pack bonus as its own ordinary row.
//   6.   ensureBio(origin:'gacha') -- the Unit is born the moment it is rolled
//        and delivered, which is now a single atomic instant. Strictly better
//        than the old finalize-time stamp, which never fired at all for a roll
//        the client could not place.
//
// Returns {cost, rolled} -- the SAME shape the route and the client's result
// modal already consume. `rolled` is now a receipt of what was delivered to the
// warehouse, not a thing the client is expected to place.
function startGachaRoll(playerId, kind, profileCanvas) {
  const pack = resolvePack(kind);
  const cost = Number.isFinite(Number(pack.cost)) ? Number(pack.cost) : GACHA_COMMON_BP_COST;
  const balance = readLrdstBalance(profileCanvas);
  if (balance < cost) {
    const err = new Error('insufficient LRDST balance: have ' + balance + ', need ' + cost);
    err.code = 'CONFLICT'; err.reason = 'insufficient_balance'; throw err;
  }

  const seed = crypto.randomBytes(16).toString('hex');
  const rolled = rollPackBp(pack, seed);
  const bonuses = rolled.bonuses || [];

  // Capacity for EVERY row this roll will insert (the Unit + one per bonus),
  // checked as a whole: a roll that could deliver the Unit but not its bonuses
  // must not half-settle. buyListing's "no partial settle" posture.
  // NOTE this DIVERGES from addToWarehouse's documented drop-on-overflow
  // posture, deliberately and for the same reason buyListing diverged: a
  // silently-dropped dungeon reward is re-earnable, a silently-dropped roll was
  // PAID FOR.
  const rowsNeeded = 1 + bonuses.length;
  const survivors = purgeExpiredWarehouseItems(playerId);
  if (survivors.length + rowsNeeded > WAREHOUSE_CAP) {
    const err = new Error('your warehouse has no room for this roll (' + survivors.length + '/' + WAREHOUSE_CAP +
      ' used, this roll needs ' + rowsNeeded + '); claim or clear some rows first -- nothing was charged');
    err.code = 'CONFLICT'; err.reason = 'warehouse_full'; throw err;
  }

  // ---- COMMIT POINT (1/3): value leaves the economy first, exactly like
  // buyListing's debit-before-deliver order. Everything above this line can
  // throw for free; nothing below it may.
  debitTmFromCanvas(profileCanvas, GACHA_TM_ID, cost);
  storage.writeProfile(playerId, profileCanvas);

  const now = Date.now();
  const tIso = new Date(now).toISOString();
  const expiresAt = new Date(now + WAREHOUSE_TTL_MS).toISOString();

  // (2/3) the Unit. The row's itemUid IS the minted BP uid -- the house "reuse
  // the row uid as the on-canvas uid" convention (see claimWarehouseItem's doc)
  // that makes the claim's finalize an exact uid-membership check. `bp` is a
  // canvas BP INSTANCE (ApiWarehouseBp, shared/dto.ts), so the claim path can
  // place it verbatim without re-rolling anything; name/color match what
  // WorkshopPage's own firstFitPlaceBp used to stamp, so a claimed roll lands
  // byte-identical to a pre-REQ-0215 placed roll.
  const bpRow = {
    itemUid: rolled.uid, playerId, itemId: rolled.unit.id,
    kind: 'bp',
    bp: {
      id: rolled.uid,
      name: (rolled.unitDef && rolled.unitDef.name) || 'BP',
      color: '#8a8a8a',
      shape: rolled.shape,
      unit: rolled.unit,
      hpMax: rolled.hpMax,
      cellCount: rolled.cellCount,
    },
    harvestedAt: tIso, expiresAt,
    sourceRoomId: null, sourceRunId: null,
    sourcePackId: pack.id, // provenance: which pack minted it (the gacha's analogue of sourceListingId)
    status: 'claimable',
  };
  const deliveredBp = addToWarehouse(playerId, bpRow);
  if (!deliveredBp.ok) throw new Error('gacha: warehouse refused the Unit after the pre-check (' + deliveredBp.reason + ') -- this is a bug');

  // (3/3) the pack's bonus slots. Each becomes an ORDINARY warehouse row of its
  // own -- a TM bonus in grantTmQty's shape (merged into a matching stack on
  // claim), a PO/SI bonus in grantWarehouseItem's shape. Reusing each bonus's
  // already-minted uid as its row uid, same convention as the Unit above.
  //
  // INTERPRETATION (REQ-0215): a PO/SI bonus now carries a rollQuality() `q`,
  // which the old client-side placement never gave it. Every OTHER warehouse
  // PO/SI row has one (grantWarehouseItem, market delivery) and the Dex/
  // dismantle paths read it -- a q-less bonus was the odd one out, not a
  // feature.
  const { rollQuality } = require('./dismantle.cjs');
  for (const b of bonuses) {
    const row = b.pool === 'tm'
      ? {
          itemUid: b.uid, playerId, itemId: b.id, qty: b.qty,
          kind: 'tm',
          harvestedAt: tIso, expiresAt,
          sourceRoomId: null, sourceRunId: null, sourcePackId: pack.id,
          status: 'claimable',
        }
      : {
          itemUid: b.uid, playerId, itemId: b.id,
          q: rollQuality(playerId, b.id),
          harvestedAt: tIso, expiresAt,
          sourceRoomId: null, sourceRunId: null, sourcePackId: pack.id,
          status: 'claimable',
        };
    const deliveredBonus = addToWarehouse(playerId, row);
    if (!deliveredBonus.ok) throw new Error('gacha: warehouse refused a bonus after the pre-check (' + deliveredBonus.reason + ') -- this is a bug');
  }

  // The Unit exists now -- stamp its birth. Non-critical, same as the old
  // finalize-time call site.
  try {
    require('./bio.cjs').ensureBio(rolled.uid, 'gacha', rolled.unitDef ? rolled.unitDef.name : undefined);
  } catch (e) { /* bio is non-critical */ }

  return { cost, rolled };
}


module.exports = {
  GACHA_COMMON_BP_COST,
  GACHA_TM_ID, // REQ-0215
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
  // REQ-0215: GACHA_PENDING_TIMEOUT_MS / normalizeGachaPendingStatus /
  // purgeExpiredGachaPending / finalizeGachaForCanvas are GONE -- the roll is a
  // single atomic purchase now, so there is no pending state to revert or
  // finalize. See the module header.
};
