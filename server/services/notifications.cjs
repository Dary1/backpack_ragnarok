'use strict';
// server/services/notifications.cjs -- REQ-0327: the per-player
// notification FEED logic (append / list-since / ack / bound), layered
// over storage.cjs's readNotifications/writeNotifications persistence
// primitives (storage.cjs stays THE chokepoint; this service owns no
// store of its own).
//
// KINDS (each emitted from an EXISTING service code path -- this REQ added
// no subsystem, only emission calls at moments the server already owns):
//   troop_disbanded    REQ-0327  runs.cjs disbandTroopRoom, per released owner
//   room_halted        REQ-0357  runs.cjs maybeAutoStartNextRun (wipe-streak)
//   run_settled        REQ-0368  runs.cjs settleRun, per participant
//   market_settled     REQ-0368  market/trade.cjs buyListing, to the SELLER
//   warehouse_expiring REQ-0368  warehouse.cjs purge sweep (<24h window)
//   warehouse_expired  REQ-0368  warehouse.cjs purge sweep (the silent-loss fix)
//
// A human device and a bot program consume this feed IDENTICALLY through
// GET /api/notifications (auth = the standard X-Auth-Token), so owner spec
// item 7 ("same mechanism for the bot") falls out for free.
const storage = require('../storage.cjs');

// Bound the per-player feed so an append-only list never grows without
// limit -- the newest MAX_ENTRIES are kept (oldest, invariably long-since
// seen, drop off). A device/bot that polls + acks keeps its own working
// set far below this.
const MAX_ENTRIES = 200;

function emptyDoc(playerId) {
  return { schema_version: 1, playerId, seq: 0, entries: [] };
}
function loadDoc(playerId) {
  const doc = storage.readNotifications(playerId);
  if (!doc) return emptyDoc(playerId);
  if (!Array.isArray(doc.entries)) doc.entries = [];
  if (typeof doc.seq !== 'number') doc.seq = doc.entries.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
  return doc;
}
function trim(doc) {
  if (doc.entries.length > MAX_ENTRIES) doc.entries = doc.entries.slice(doc.entries.length - MAX_ENTRIES);
  return doc;
}

// append(playerId, { kind, roomId, dedupeKey, attackLv, ts, payload }) ->
// the stored entry. Idempotent per (kind, roomId, dedupeKey): a second
// append for the same event on the same player's feed is a no-op returning
// the existing entry (so a re-fired disband hook never double-notifies --
// the golden "exactly one entry per owner").
//
// REQ-0368 widened the key with `dedupeKey`. REQ-0327's two kinds are
// once-per-room events, so (kind, roomId) alone identified them; the kinds
// added here are NOT -- one room settles a run every few minutes, and every
// one of those must notify. dedupeKey defaults to null, which is exactly
// what an entry written before this REQ carries, so the REQ-0327/0357
// emitters (which pass none) keep their original collapse behaviour
// byte-for-byte against feeds already on disk.
function append(playerId, fields) {
  const doc = loadDoc(playerId);
  const dedupeKey = fields.dedupeKey != null ? String(fields.dedupeKey) : null;
  const existing = doc.entries.find((e) => e.kind === fields.kind && e.roomId === fields.roomId
    && (e.dedupeKey != null ? e.dedupeKey : null) === dedupeKey);
  if (existing) return existing;
  doc.seq += 1;
  const entry = {
    id: doc.seq,
    ts: fields.ts || new Date().toISOString(),
    kind: fields.kind,
    roomId: fields.roomId != null ? fields.roomId : null,
    dedupeKey,
    attackLv: fields.attackLv != null ? fields.attackLv : null,
    seenAt: null,
    payload: fields.payload || {},
  };
  doc.entries.push(entry);
  trim(doc);
  storage.writeNotifications(playerId, doc);
  return entry;
}

// list(playerId, sinceId) -> { notifications, cursor }. Returns the
// caller's UNSEEN entries with id > sinceId (sinceId null/NaN => from the
// start), ascending by id. `cursor` is the feed's high-water id (max id of
// any entry, seen or not) -- a forward poller (REQ-0330's fleet) passes it
// back as ?since= to fetch only strictly-newer entries; ack is the durable
// "processed" marker.
function list(playerId, sinceId) {
  const doc = loadDoc(playerId);
  const since = Number.isFinite(sinceId) ? sinceId : 0;
  const notifications = doc.entries
    .filter((e) => e.seenAt == null && (Number(e.id) || 0) > since)
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const cursor = doc.entries.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
  return { notifications, cursor };
}

// ack(playerId, ids) -> count newly marked seen. Bounds the list on the
// way out.
function ack(playerId, ids) {
  const doc = loadDoc(playerId);
  const wanted = new Set((ids || []).map((n) => Number(n)));
  const now = new Date().toISOString();
  let acked = 0;
  for (const e of doc.entries) {
    if (wanted.has(Number(e.id)) && e.seenAt == null) { e.seenAt = now; acked += 1; }
  }
  trim(doc);
  storage.writeNotifications(playerId, doc);
  return acked;
}

// emitTroopDisbanded(room) -- REQ-0327 emission hook. Reads REQ-0326's
// discrete room.disbandEvent ({ roomId, reason, releasedOwners[],
// disbandedAt }) and appends ONE 'troop_disbanded' notification to EACH
// released owner's feed (humans and bots alike). Deliberately kept OUT of
// the run engine's core math: it runs AFTER disbandTroopRoom has already
// committed the seat-return / state:'canceled' teardown, and a feed write
// that throws for one owner never aborts the disband (best-effort,
// per-owner try/catch). Returns the entries it created.
function emitTroopDisbanded(room) {
  const ev = room && room.disbandEvent;
  if (!ev || !Array.isArray(ev.releasedOwners)) return [];
  const out = [];
  for (const ownerId of ev.releasedOwners) {
    if (ownerId == null) continue;
    try {
      out.push(append(ownerId, {
        kind: 'troop_disbanded',
        roomId: ev.roomId,
        attackLv: room.level != null ? room.level : null,
        ts: ev.disbandedAt,
        payload: { reason: ev.reason || 'member_cancel', disbandedAt: ev.disbandedAt },
      }));
    } catch (e) { /* one owner's feed write must not abort the disband */ }
  }
  return out;
}

// emitRoomHalted(room) -- REQ-0357. Reads the discrete room.haltEvent
// ({ roomId, reason, streak, haltedAt }) a solo room records when the
// wipe-streak circuit breaker cancels its lane, and appends ONE
// 'room_halted' notification to the OWNER's feed. Same best-effort
// discipline as emitTroopDisbanded: a feed write must never abort the halt.
function emitRoomHalted(room) {
  const ev = room && room.haltEvent;
  if (!ev || room.ownerId == null) return [];
  try {
    return [append(room.ownerId, {
      kind: 'room_halted',
      roomId: ev.roomId,
      attackLv: room.level != null ? room.level : null,
      ts: ev.haltedAt,
      payload: { reason: ev.reason || 'wipe_streak', streak: ev.streak, haltedAt: ev.haltedAt },
    })];
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------
// REQ-0368 emitters. Same best-effort discipline the two REQ-0327/0357
// hooks above already established and for the same reason: every one of
// these runs INSIDE a settlement/sweep that has already committed real
// value (warehouse rows, TM proceeds, a deleted expired row). A feed write
// that throws must never unwind that -- so each is wrapped, per recipient,
// and returns whatever entries it managed to create.
// ---------------------------------------------------------------------

// emitRunSettled(room, run, attackLv) -- REQ-0368 spec item 1. Called from
// runs.cjs settleRun AFTER run.settled flips and the run/room docs are
// written, so the notification can never describe a settlement that did not
// commit. ONE entry per PARTICIPANT (REQ-0325: a Troop fans rewards across
// every seated owner; a solo run's participants is [ownerId]), carrying that
// participant's OWN loot count -- the run's reward assignments are per-owner,
// so a co-op member must not be told the whole party's haul.
// dedupeKey = run.id: a room settles many runs, and each one is its own
// notification (see append's note on why (kind, roomId) alone is not enough).
function emitRunSettled(room, run, attackLv) {
  if (!room || !run) return [];
  const participants = (Array.isArray(run.participants) && run.participants.length)
    ? run.participants
    : (room.ownerId != null ? [room.ownerId] : []);
  // Per-owner loot tally from the run's OWN reward assignments
  // (distributeRewardsUniform's { item, owner, destination } shape -- the
  // same `owner` field settleRun banks each row against).
  const lootByOwner = new Map();
  for (const a of (Array.isArray(run.rewards) ? run.rewards : [])) {
    if (!a || a.owner == null) continue;
    lootByOwner.set(a.owner, (lootByOwner.get(a.owner) || 0) + 1);
  }
  const out = [];
  for (const ownerId of participants) {
    if (ownerId == null) continue;
    try {
      out.push(append(ownerId, {
        kind: 'run_settled',
        roomId: room.id,
        dedupeKey: run.id,
        attackLv: attackLv != null ? attackLv : null,
        payload: {
          result: run.result,               // 'victory' | 'wipe' | 'incomplete'
          dungeonId: room.dungeonId != null ? room.dungeonId : null,
          lootCount: lootByOwner.get(ownerId) || 0,
          runId: run.id,
        },
      }));
    } catch (e) { /* one participant's feed write must not abort settlement */ }
  }
  return out;
}

// emitMarketSettled(sellerId, fields) -- REQ-0368 spec item 1. Called from
// market/trade.cjs buyListing at the very END of the 7-step settle, so the
// proceeds row and the furnace entry are already durable. Notifies the
// SELLER only: the BUYER performed the action synchronously and already has
// the receipt in the response, while the seller is the absent party the
// whole notification centre exists for (today they must open My Listings to
// discover a sale -- market.mine.settledChip is the entire signal).
// roomId is null (a trade has no room); dedupeKey = the listing id, which a
// listing settles exactly once.
function emitMarketSettled(sellerId, fields) {
  if (sellerId == null) return [];
  try {
    return [append(sellerId, {
      kind: 'market_settled',
      roomId: null,
      dedupeKey: fields.listingId,
      ts: fields.t,
      payload: {
        listingId: fields.listingId,
        itemId: fields.itemId,
        itemName: fields.itemName != null ? fields.itemName : fields.itemId,
        itemNameJa: fields.itemNameJa != null ? fields.itemNameJa : null,
        net: fields.net,     // sellerReceives -- what actually landed in the warehouse
        burn: fields.burn,   // what the furnace took
        tm: fields.tm,
      },
    })];
  } catch (e) { return []; }
}

// emitWarehouseExpiring(playerId, count, sweepKey) -- REQ-0368 spec item 1.
// BATCH-COLLAPSED per sweep: the caller (warehouse.cjs) marks each row the
// first time it is seen inside the <24h window and passes only the count of
// rows newly marked by THIS sweep, so a player polling every few seconds
// gets one entry per batch of items entering the window rather than one per
// poll. sweepKey makes each batch its own entry.
function emitWarehouseExpiring(playerId, count, sweepKey) {
  if (playerId == null || !(count > 0)) return [];
  try {
    return [append(playerId, {
      kind: 'warehouse_expiring',
      roomId: null,
      dedupeKey: sweepKey,
      payload: { count },
    })];
  } catch (e) { return []; }
}

// emitWarehouseExpired(playerId, items, sweepKey) -- REQ-0368 spec item 1,
// THE silent-loss fix: until this REQ an expired warehouse row was deleted
// with no player-visible trace anywhere in the product. `items` is
// [{ itemId, itemName, itemNameJa }] for the rows this sweep deleted.
function emitWarehouseExpired(playerId, items, sweepKey) {
  if (playerId == null || !Array.isArray(items) || items.length === 0) return [];
  try {
    return [append(playerId, {
      kind: 'warehouse_expired',
      roomId: null,
      dedupeKey: sweepKey,
      payload: {
        count: items.length,
        itemIds: items.map((i) => i.itemId),
        itemNames: items.map((i) => (i.itemName != null ? i.itemName : i.itemId)),
        itemNamesJa: items.map((i) => (i.itemNameJa != null ? i.itemNameJa : null)),
      },
    })];
  } catch (e) { return []; }
}

module.exports = {
  MAX_ENTRIES, append, list, ack,
  emitTroopDisbanded, emitRoomHalted,
  emitRunSettled, emitMarketSettled, emitWarehouseExpiring, emitWarehouseExpired,
};
