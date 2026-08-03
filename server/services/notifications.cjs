'use strict';
// server/services/notifications.cjs -- REQ-0327: the per-player
// notification FEED logic (append / list-since / ack / bound), layered
// over storage.cjs's readNotifications/writeNotifications persistence
// primitives (storage.cjs stays THE chokepoint; this service owns no
// store of its own). ONE notification kind today: 'troop_disbanded',
// emitted from server/services/runs.cjs's disbandTroopRoom for each
// released owner (REQ-0326's disbandEvent roster). A human device and a
// bot program consume this feed IDENTICALLY through GET /api/notifications
// (auth = the standard X-Auth-Token), so owner spec item 7 ("same
// mechanism for the bot") falls out for free.
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

// append(playerId, { kind, roomId, attackLv, ts, payload }) -> the stored
// entry. Idempotent per (kind, roomId): a second append for the same
// event on the same player's feed is a no-op returning the existing entry
// (so a re-fired disband hook never double-notifies -- the golden
// "exactly one entry per owner").
function append(playerId, fields) {
  const doc = loadDoc(playerId);
  const existing = doc.entries.find((e) => e.kind === fields.kind && e.roomId === fields.roomId);
  if (existing) return existing;
  doc.seq += 1;
  const entry = {
    id: doc.seq,
    ts: fields.ts || new Date().toISOString(),
    kind: fields.kind,
    roomId: fields.roomId,
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

module.exports = { MAX_ENTRIES, append, list, ack, emitTroopDisbanded, emitRoomHalted };
