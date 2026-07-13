// backpack_ragnarok -- server/services/ragnarok/einherjar.cjs
// REQ-0145a (sd): S3 einherjar records + the per-record score fold
// extracted verbatim from the pre-split services/ragnarok.cjs (origin
// lines 217-237, 401-553 @ commit 7105d23). The score fold lives HERE
// (not in order.cjs) because both the order rebuild and the record DTO
// consume it and einherjar must not depend on order (DAG).
'use strict';
const storage = require('../../storage.cjs');
const { SCORE_WEIGHTS, RITE_LOCK_TIMEOUT_MS } = require('./lib.cjs');

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

module.exports = {
  battleScoreOf,
  scoreOfRecord,
  snapshotUidsStillHomed,
  normalizeRiteRecord,
  einherjarDto,
  listEinherjar,
  devClearEinherjarRecords,
};
