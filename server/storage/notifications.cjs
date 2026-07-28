// backpack_ragnarok — server/storage/notifications.cjs
// REQ-0327: per-player append-only notification feed persistence. ONE
// JSON doc per player (keyed by playerId) — the same one-doc-per-key
// shape server/storage/bio.cjs uses — carrying { schema_version,
// playerId, seq, entries[] }. storage.cjs stays THE persistence
// chokepoint: this is a sibling storage-subsystem file re-exported
// through the facade (no consumer requires it directly; the feed's
// append/list/ack LOGIC lives in server/services/notifications.cjs, which
// goes through these read/write primitives). Files + pg backends kept
// adjacent, mirroring bio.cjs exactly.
//   files: data/notifications/<playerId>.json  |  pg: notifications(player_id, doc, updated_at)
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, REPO_ROOT, atomicWriteJSON } = require('./lib.cjs');

const NOTIFICATIONS_DIR = path.join(REPO_ROOT, 'data', 'notifications');

function notificationsPath(playerId) { return path.join(NOTIFICATIONS_DIR, playerId + '.json'); }

// ---- files backend ----
function readNotificationsFiles(playerId) {
  const p = notificationsPath(playerId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeNotificationsFiles(playerId, doc) {
  atomicWriteJSON(NOTIFICATIONS_DIR, notificationsPath(playerId), doc);
  return doc;
}

// ---- pg backend ----
function readNotificationsPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM notifications WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeNotificationsPg(playerId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO notifications (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(playerId), JSON.stringify(doc)]
  );
  return doc;
}

// ---- public API (backend-dispatching) ----
function readNotifications(playerId) { return backendMode() === 'pg' ? readNotificationsPg(playerId) : readNotificationsFiles(playerId); }
function writeNotifications(playerId, doc) { return backendMode() === 'pg' ? writeNotificationsPg(playerId, doc) : writeNotificationsFiles(playerId, doc); }

module.exports = { NOTIFICATIONS_DIR, notificationsPath, readNotifications, writeNotifications };
