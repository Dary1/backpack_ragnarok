'use strict';
// server/routes/schedule.cjs -- REQ-0047 (c): the token-gated Dungeon
// Schedule HTTP surface (rooms CRUD, slots, swap, run view incl.
// ?format=text, dev backdate/clear seams). REQ-0145a (se): the combined
// schedule/warehouse/workshop module split into three route files
// (origin lines 125-341, 407-430 @ commit 9d4bc89, bodies verbatim);
// the shared caller-resolution preamble + error/canvas helpers live in
// lib/route_auth.cjs and are used by all three. Returns false when not
// matched (router then tries warehouse -> workshop in the same slot the
// combined module occupied).
const { sendJSON, sendText, readBody } = require('../lib/http_util.cjs');
const { humanizeEventText } = require('../lib/humanize.cjs');
const { resolveCallerOr401, loadOwnCanvas, requireOwnCanvas, sendScheduleError } = require('../lib/route_auth.cjs');
const storage = require('../storage.cjs');
const schedule = require('../schedule.cjs');

const SCHEDULE_ROOMS_RE = /^\/api\/schedule\/rooms$/;
const SCHEDULE_ROOM_RE = /^\/api\/schedule\/rooms\/([^/]+)$/;
const SCHEDULE_ROOM_SLOT_RE = /^\/api\/schedule\/rooms\/([^/]+)\/slots\/([0-9]+)$/;
const SCHEDULE_ROOM_SWAP_RE = /^\/api\/schedule\/rooms\/([^/]+)\/swap$/;
const SCHEDULE_ROOM_RUN_RE = /^\/api\/schedule\/rooms\/([^/]+)\/run$/;
const SCHEDULE_ROOM_DEV_BACKDATE_RE = /^\/api\/schedule\/rooms\/([^/]+)\/dev\/backdate$/; // REQ-0036 P1-C: dev-only E2E time-control hook
const SCHEDULE_ROOMS_DEV_CLEAR_RE = /^\/api\/schedule\/rooms\/dev\/clear$/; // REQ-0082: dev-only E2E room-cleanup hook

function tryScheduleRoutes(req, res, url, p) {
  const scheduleMatch = p.match(SCHEDULE_ROOMS_RE) || p.match(SCHEDULE_ROOM_RE) ||
    p.match(SCHEDULE_ROOM_SLOT_RE) || p.match(SCHEDULE_ROOM_SWAP_RE) || p.match(SCHEDULE_ROOM_RUN_RE) ||
    p.match(SCHEDULE_ROOM_DEV_BACKDATE_RE) ||
    p.match(SCHEDULE_ROOMS_DEV_CLEAR_RE);
  if (scheduleMatch) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const { callerId, callerIsDevFallback, callerCanSetGenSeed } = ctx;
    // settleRoomIfDue() is called by every room-touching handler before
    // anything else -- this is the lazy, poll-driven "scheduler" (see
    // schedule.cjs's own header comment on the run-clock design): the
    // next auto-run only actually starts the moment SOME request happens
    // to look at this room after its cooldown has elapsed.
    function loadAndSettleRoom(roomId) {
      const room = schedule.getOwnRoomOr404(roomId, callerId);
      const { itemDefsById } = schedule.getScheduleContent();
      return schedule.settleRoomIfDue(room, loadOwnCanvas(callerId), itemDefsById);
    }

    // ---- POST/GET /api/schedule/rooms ----
    if (p.match(SCHEDULE_ROOMS_RE)) {
      if (req.method === 'GET') {
        try {
          // REQ-0087: settle each room the same way loadAndSettleRoom()
          // already does for every OTHER room-touching route below. Without
          // this, a room whose 4th (last) slot assignment just completed --
          // or whose cooldown just cleared -- never auto-starts its next
          // run: this list endpoint is the ONLY one the live client's Rooms
          // view ever polls (SchedulePage.tsx's ROOMS_POLL_MS loop calls
          // fetchRooms() exclusively, never fetchRoom(id)), so a fully and
          // validly filled room could sit at status 'open' forever with
          // zero error surfaced anywhere (every assignSlot PUT genuinely
          // returned 200) -- see docs/REQ/.../REQ-0087 for the live repro.
          // settleRoomIfDue() is a no-op passthrough for any room that
          // isn't due (canceled / mid-run / still-cooling-down / not yet
          // fully filled), so this stays cheap on every poll.
          const { itemDefsById } = schedule.getScheduleContent();
          const canvas = loadOwnCanvas(callerId);
          // REQ-0087 follow-up: settleRoomIfDue() can THROW for a single
          // room (e.g. startRun()'s buildSquadSnapshots() 400s with "squad
          // snapshot not found" if a slot's squadIndex was assigned
          // legitimately at the time but the referenced squad was later
          // deleted/shrunk out from under it -- discovered live: the shared
          // dev account's squad count changed after a room's slots were
          // already filled, and the FIRST version of this fix let that one
          // room's settle exception bubble out of the whole .map(), 400ing
          // the ENTIRE rooms list for the player instead of just that one
          // room. Every other lazy-settlement caller in this codebase
          // already treats settle failures as best-effort/non-fatal
          // (applyPendingSwapIfAny's own try/catch is the precedent) --
          // matching that: a room that fails to settle is returned AS-IS
          // (unsettled) rather than taking every other room down with it.
          const rooms = schedule.listOwnRooms(callerId).map((room) => {
            try {
              return schedule.settleRoomIfDue(room, canvas, itemDefsById);
            } catch (e) {
              return room;
            }
          });
          sendJSON(res, 200, { ok: true, rooms });
        } catch (e) { sendScheduleError(res, e); }
        return;
      }
      if (req.method === 'POST') {
        readBody(req, (err, bodyStr) => {
          if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
          let body;
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
          // REQ-0043: genSeed is a privileged-only field (see
          // callerCanSetGenSeed above) -- checked HERE, before
          // schedule.createRoom() is ever called, so an ungated caller's
          // genSeed can never influence room creation even transiently.
          // `genSeed: undefined`/absent is always fine for anyone (the
          // room just gets a random seed, schedule.createRoom()'s own
          // default); only a PRESENT genSeed value from a non-privileged
          // caller is refused.
          if (body && body.genSeed !== undefined && body.genSeed !== null && !callerCanSetGenSeed) {
            sendJSON(res, 403, { ok: false, error: 'forbidden: genSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
            return;
          }
          try {
            const room = schedule.createRoom(callerId, body);
            sendJSON(res, 200, { ok: true, room });
          } catch (e) { sendScheduleError(res, e); }
        });
        return;
      }
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    // ---- GET/DELETE /api/schedule/rooms/:id ----
    const roomMatch = p.match(SCHEDULE_ROOM_RE);
    if (roomMatch) {
      const roomId = decodeURIComponent(roomMatch[1]);
      if (req.method === 'GET') {
        try {
          const room = loadAndSettleRoom(roomId);
          sendJSON(res, 200, { ok: true, room });
        } catch (e) { sendScheduleError(res, e); }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const room = loadAndSettleRoom(roomId);
          const canceled = schedule.cancelRoom(room);
          sendJSON(res, 200, { ok: true, room: canceled });
        } catch (e) { sendScheduleError(res, e); }
        return;
      }
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    // ---- PUT /api/schedule/rooms/:id/slots/:slotIndex (golden b/d) ----
    const slotMatch = p.match(SCHEDULE_ROOM_SLOT_RE);
    if (slotMatch) {
      const roomId = decodeURIComponent(slotMatch[1]);
      const slotIndex = parseInt(slotMatch[2], 10);
      if (req.method !== 'PUT') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        try {
          const room = loadAndSettleRoom(roomId);
          const { itemDefsById } = schedule.getScheduleContent();
          const canvas = requireOwnCanvas(callerId);
          const updated = schedule.assignSlot(room, callerId, slotIndex, body.squadIndex, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, room: updated });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- PUT /api/schedule/rooms/:id/swap (golden j) ----
    const swapMatch = p.match(SCHEDULE_ROOM_SWAP_RE);
    if (swapMatch) {
      const roomId = decodeURIComponent(swapMatch[1]);
      if (req.method !== 'PUT') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        try {
          const room = loadAndSettleRoom(roomId);
          const { itemDefsById } = schedule.getScheduleContent();
          const canvas = requireOwnCanvas(callerId);
          const result = schedule.swapSquad(room, body.slot, body.squadIndex, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, room: result.room, applied: result.applied });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- GET /api/schedule/rooms/:id/run (run-clock-paced replay view) ----
    const runMatch = p.match(SCHEDULE_ROOM_RUN_RE);
    if (runMatch) {
      const roomId = decodeURIComponent(runMatch[1]);
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const room = loadAndSettleRoom(roomId);
        if (!room.lastRunId) { sendJSON(res, 404, { ok: false, error: 'this room has no run yet' }); return; }
        const run = storage.readRun(room.lastRunId);
        if (!run) { sendJSON(res, 404, { ok: false, error: 'run record not found' }); return; }
        const visible = schedule.visibleEvents(run);
        // REQ-0045 (g): GET .../run?format=text -- optional, nice-to-
        // have plain-text mirror of the same time-gated visibleEvents()
        // this route already sends as JSON, one humanized line per
        // event (see humanizeEventText's own doc), for a quick curl/
        // browser-tab inspection without needing the client UI at all.
        // Any value OTHER than exactly 'text' (including absent) falls
        // through to the existing JSON response, unchanged.
        if (url.searchParams.get('format') === 'text') {
          const lines = visible.map((ev, idx) => idx + ': ' + humanizeEventText(ev));
          const body = lines.length > 0 ? lines.join('\n') + '\n' : '(no events yet)\n';
          sendText(res, 200, body);
          return;
        }
        const clock = schedule.runClock(run);
        sendJSON(res, 200, {
          ok: true,
          runId: run.id,
          roomId: run.roomId,
          startedAt: run.startedAt,
          durationSecs: run.durationSecs,
          clock: { elapsedSecs: clock.elapsedSecs, isSettled: clock.isSettled, pct: clock.pct },
          events: visible,
          // Summary fields are always present (computed instantly at run
          // start) but represent the FINAL outcome even before the
          // clock finishes -- a spectator-safe client should treat
          // `result`/`rewards` as "the eventual outcome", only fully
          // authoritative once clock.isSettled is true (matching how
          // visibleEvents() itself withholds not-yet-reached events).
          result: run.result, finalProgressPct: run.finalProgressPct,
          cooldownSecs: run.cooldownSecs, levelAfter: run.levelAfter, H: run.H,
          settled: run.settled,
        });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- POST /api/schedule/rooms/:id/dev/backdate (REQ-0036 P1-C: dev-
    // only E2E time-control hook) ----
    // Body: {extraSecsIntoPast?: number} (default 5). Rewrites the
    // room's CURRENT/LAST run's startedAt further into the past so its
    // run-clock reads as already elapsed on the next read -- see
    // schedule.cjs's devBackdateActiveRun() doc comment for the full
    // rationale and server/README.md's "E2E time-control" section.
    // GATED to the dev_mode no-token fallback caller ONLY
    // (callerIsDevFallback, computed above) -- a real guest token,
    // even a perfectly valid one, gets 403 here, never 200. This is a
    // test-control seam, not a gameplay feature: it never touches the
    // run's seed (reward RNG is untouched), it only moves a timestamp.
    const devBackdateMatch = p.match(SCHEDULE_ROOM_DEV_BACKDATE_RE);
    if (devBackdateMatch) {
      const roomId = decodeURIComponent(devBackdateMatch[1]);
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/backdate is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        }
        try {
          const room = schedule.getOwnRoomOr404(roomId, callerId);
          const run = schedule.devBackdateActiveRun(room, body.extraSecsIntoPast);
          sendJSON(res, 200, { ok: true, runId: run.id, startedAt: run.startedAt, durationSecs: run.durationSecs });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- POST /api/schedule/rooms/dev/clear (REQ-0082: dev-only E2E
    // room-cleanup hook) ----
    // No body. Bulk-deletes EVERY room belonging to the CALLER -- always the
    // dev_mode no-token fallback player, the only caller that can reach this --
    // and returns {ok:true, deleted:n}. Sibling of warehouse dev/clear-debris:
    // the Playwright suite's file backup/restore safety net never covered
    // schedule rooms, so the dev player's canceled rooms accumulated every run
    // (154 seen in REQ-0082) and collapsed the create panel's zero-rooms
    // auto-open. Goes through schedule.devClearRooms -> storage.clearRoomsForOwner
    // so files and pg clean identically. GATED to callerIsDevFallback ONLY (a
    // real guest token, even valid, gets 403) and always targets the RESOLVED
    // caller's own rooms (no client-supplied playerId in this route's shape).
    if (p.match(SCHEDULE_ROOMS_DEV_CLEAR_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: rooms/dev/clear is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      try {
        const deleted = schedule.devClearRooms(callerId);
        sendJSON(res, 200, { ok: true, deleted });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }
  }

  return false;
}
module.exports = { tryScheduleRoutes };
