'use strict';
// bot/lib/watcher.cjs -- REQ-0330 WATCHER. Poll GET /api/schedule/troops?state=
// recruiting; when a recruiting PUBLIC troop with a free seat appears, that troop
// is the fleet's join target. pickTarget is a pure selection over the browse
// rows so it is unit-testable; the polling itself lives in the daemon (fleet.cjs).

// pickTarget(troops, opts?) -> the chosen row, or null. The browse endpoint
// already returns only public recruiting troops WITH a free seat, so any row is
// eligible. Deterministic choice: the OLDEST such recruitment (max ageSec), ties
// broken by roomId ascending -- the fleet backs the recruitment that has waited
// longest for players. opts.excludeRoomIds skips troops already handled.
function pickTarget(troops, opts) {
  const exclude = (opts && opts.excludeRoomIds) ? new Set(opts.excludeRoomIds) : new Set();
  const eligible = (troops || []).filter((t) => t && t.roomId && !exclude.has(t.roomId) && hasFreeSeat(t));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const da = Number(a.ageSec) || 0;
    const db = Number(b.ageSec) || 0;
    if (db !== da) return db - da;                 // oldest first
    return String(a.roomId).localeCompare(String(b.roomId));
  });
  return eligible[0];
}

// hasFreeSeat(row) -> true if the "k/4" seats string still has a gap. Defensive:
// the browse contract already guarantees a free seat, but a stale row is skipped.
function hasFreeSeat(row) {
  if (!row || typeof row.seats !== 'string') return true;
  const m = row.seats.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return true;
  return Number(m[1]) < Number(m[2]);
}

module.exports = { pickTarget, hasFreeSeat };
