// backpack_ragnarok — server/storage/rooms.cjs
// REQ-0145a (sb): schedule-room persistence extracted verbatim from the
// pre-split server/storage.cjs (origin lines 280, 296-362, 608-619 @
// commit fda9ffb). REQ-0036 P1-B root: data/schedule/rooms/<roomId>.json
// | pg: schedule_rooms.
'use strict';
const fs = require('fs');
const path = require('path');
const { NAMESPACE, backendMode, namespacedId, ROOMS_DIR, ensureScheduleDirs, atomicWriteJSON } = require('./lib.cjs');

function roomPath(id) { return path.join(ROOMS_DIR, id + '.json'); }

// ---- rooms: files backend ----

function readRoomFiles(id) {
  const p = roomPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeRoomFiles(id, doc) {
  atomicWriteJSON(ROOMS_DIR, roomPath(id), doc);
  return doc;
}
function deleteRoomFiles(id) {
  const p = roomPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function listRoomsFiles() {
  ensureScheduleDirs();
  const files = fs.readdirSync(ROOMS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8'))); }
    catch (e) { /* skip unreadable/corrupt */ }
  }
  return out;
}

// ---- rooms: pg backend ----

function readRoomPg(id) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM schedule_rooms WHERE room_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeRoomPg(id, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO schedule_rooms (room_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (room_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), JSON.stringify(doc)]
  );
  return doc;
}
function deleteRoomPg(id) {
  const { querySync } = require('../pg_sync.cjs');
  querySync('DELETE FROM schedule_rooms WHERE room_id = $1', [namespacedId(id)]);
}
function listRoomsPg() {
  const { querySync } = require('../pg_sync.cjs');
  const prefix = NAMESPACE + ':';
  const res = querySync('SELECT doc FROM schedule_rooms WHERE room_id LIKE $1', [prefix + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- rooms: public API ----

function readRoom(id) {
  return backendMode() === 'pg' ? readRoomPg(id) : readRoomFiles(id);
}
function writeRoom(id, doc) {
  return backendMode() === 'pg' ? writeRoomPg(id, doc) : writeRoomFiles(id, doc);
}
function deleteRoom(id) {
  return backendMode() === 'pg' ? deleteRoomPg(id) : deleteRoomFiles(id);
}
function listRooms() {
  return backendMode() === 'pg' ? listRoomsPg() : listRoomsFiles();
}

// clearRoomsForOwner (REQ-0082): bulk-deletes EVERY room owned by `ownerId`
// through the same listRooms/deleteRoom chokepoints a single-room DELETE uses,
// so files and pg behave identically. Backs the dev-only POST /api/schedule/
// rooms/dev/clear hook -- the E2E dev fallback player accumulated canceled
// rooms across runs (nothing cleared them; 154 seen in REQ-0082), which
// collapsed the schedule create panel's zero-rooms auto-open. Caller-scoped:
// no client-suppliable playerId, so no real player's rooms are reachable.
function clearRoomsForOwner(ownerId) {
  const ids = listRooms().filter((r) => r && r.ownerId === ownerId).map((r) => r.id);
  for (const id of ids) deleteRoom(id);
  return ids.length;
}

module.exports = {
  roomPath,
  readRoom,
  writeRoom,
  deleteRoom,
  listRooms,
  clearRoomsForOwner,
};
