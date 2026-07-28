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
const SCHEDULE_SORTIES_RE = /^\/api\/schedule\/sorties$/; // REQ-0239 (D1): atomic create-room + assign-4-slots
// REQ-0058: Sealed Seed Share routes. /seal (mint) is distinct from
// /seals/<id> (metadata); the deeper /comparison + /runs/<playerId>
// paths are anchored so they never collide with the generic seals/<id>.
const SCHEDULE_SEAL_MINT_RE = /^\/api\/schedule\/seal$/;
const SCHEDULE_SEAL_GET_RE = /^\/api\/schedule\/seals\/([^/]+)$/;
const SCHEDULE_SEAL_COMPARE_RE = /^\/api\/schedule\/seals\/([^/]+)\/comparison$/;
const SCHEDULE_SEAL_REPLAY_RE = /^\/api\/schedule\/seals\/([^/]+)\/runs\/([^/]+)$/;
// REQ-0324: co-operative Troop routes. /api/schedule/troops* collides with
// nothing in this family (the /rooms* + /seals* + /sorties regexes above never
// match a /troops path), so it is appended here in the order-safe tail slot the
// router documents. join/leave are anchored (.../join$, .../leave$) so the
// generic /troops/:id item regex can never shadow them.
const SCHEDULE_TROOPS_RE = /^\/api\/schedule\/troops$/;
const SCHEDULE_TROOP_JOIN_RE = /^\/api\/schedule\/troops\/([^/]+)\/join$/;
const SCHEDULE_TROOP_LEAVE_RE = /^\/api\/schedule\/troops\/([^/]+)\/leave$/;
const SCHEDULE_TROOP_CANCEL_RE = /^\/api\/schedule\/troops\/([^/]+)\/cancel$/; // REQ-0326: seated-member cancel -> disband
const SCHEDULE_TROOP_RE = /^\/api\/schedule\/troops\/([^/]+)$/;

function tryScheduleRoutes(req, res, url, p) {
  const scheduleMatch = p.match(SCHEDULE_ROOMS_RE) || p.match(SCHEDULE_ROOM_RE) ||
    p.match(SCHEDULE_ROOM_SLOT_RE) || p.match(SCHEDULE_ROOM_SWAP_RE) || p.match(SCHEDULE_ROOM_RUN_RE) ||
    p.match(SCHEDULE_ROOM_DEV_BACKDATE_RE) ||
    p.match(SCHEDULE_ROOMS_DEV_CLEAR_RE) || p.match(SCHEDULE_SORTIES_RE) ||
    p.match(SCHEDULE_SEAL_MINT_RE) || p.match(SCHEDULE_SEAL_GET_RE) ||
    p.match(SCHEDULE_SEAL_COMPARE_RE) || p.match(SCHEDULE_SEAL_REPLAY_RE) ||
    p.match(SCHEDULE_TROOPS_RE) || p.match(SCHEDULE_TROOP_JOIN_RE) ||
    p.match(SCHEDULE_TROOP_LEAVE_RE) || p.match(SCHEDULE_TROOP_CANCEL_RE) || p.match(SCHEDULE_TROOP_RE);
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
    // REQ-0239 (design B1): attach a compact `lastRun` window to a room in
    // its response so the squad status board can render honest run progress +
    // a return time without an N+1 GET .../run per room. Response-only (the
    // stored room doc is never mutated); a room with no run yields lastRun:null.
    function withLastRun(room) {
      return Object.assign({}, room, { lastRun: schedule.lastRunSummary(room) });
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
          sendJSON(res, 200, { ok: true, rooms: rooms.map(withLastRun) });
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
          // REQ-0304: drawSeed (the dungeon-DRAW seed) is privileged-only, gated
          // EXACTLY like genSeed above. A present drawSeed pins WHICH dungeon the
          // random draw selects (test/dev reproducibility), so an ungated player can
          // never force or replay the draw. Absent drawSeed is fine for anyone -- the
          // room gets a crypto-random one (schedule.createRoom's own default).
          if (body && body.drawSeed !== undefined && body.drawSeed !== null && !callerCanSetGenSeed) {
            sendJSON(res, 403, { ok: false, error: 'forbidden: drawSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
            return;
          }
          try {
            // REQ-0058: a body carrying a sealId joins a sealed run --
            // the room copies the frozen tuple (dungeonType/level/genSeed/
            // affixes) verbatim from the seal, and one room per (sealId,
            // caller) is enforced (409 on a second attempt). A plain room
            // create (no sealId) is unchanged.
            const room = (body && typeof body.sealId === 'string' && body.sealId)
              ? schedule.createSealRoom(callerId, body.sealId, body)
              : schedule.createRoom(callerId, body);
            sendJSON(res, 200, { ok: true, room });
          } catch (e) { sendScheduleError(res, e); }
        });
        return;
      }
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    // ---- POST /api/schedule/sorties (REQ-0239 D1: atomic create + assign) ----
    if (p.match(SCHEDULE_SORTIES_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        // REQ-0043 parity: genSeed is privileged-only, gated BEFORE any room is
        // created (same check the POST /rooms path applies).
        if (body && body.genSeed !== undefined && body.genSeed !== null && !callerCanSetGenSeed) {
          sendJSON(res, 403, { ok: false, error: 'forbidden: genSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
          return;
        }
        // REQ-0304 parity: drawSeed is privileged-only, gated BEFORE any room is
        // created (same check the POST /rooms path applies).
        if (body && body.drawSeed !== undefined && body.drawSeed !== null && !callerCanSetGenSeed) {
          sendJSON(res, 403, { ok: false, error: 'forbidden: drawSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
          return;
        }
        try {
          const { itemDefsById } = schedule.getScheduleContent();
          const canvas = requireOwnCanvas(callerId);
          // Atomic create-room + assign 4 slots under the deploy gate; a 409
          // (shared-unit collision) rolls the room back and propagates the reason.
          const room = schedule.createSortie(callerId, body, canvas, itemDefsById);
          // The sortie IS the launch: settle now so a fully-filled room auto-starts
          // its run immediately, landing the client on a live expedition.
          const launched = schedule.settleRoomIfDue(room, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, room: withLastRun(launched) });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- GET/DELETE /api/schedule/rooms/:id ----
    const roomMatch = p.match(SCHEDULE_ROOM_RE);
    if (roomMatch) {
      const roomId = decodeURIComponent(roomMatch[1]);
      if (req.method === 'GET') {
        try {
          const room = loadAndSettleRoom(roomId);
          sendJSON(res, 200, { ok: true, room: withLastRun(room) });
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
          durationSecs: run.durationSecs, // REQ-0240: PRESENTATION duration (pt-based for paced runs)
          pacingVersion: run.pacingVersion || 0, // REQ-0240 M2: 0 = legacy run (events carry no pt; client replays on t)
          roster: run.roster || null, // REQ-0240 M1: per-slot BP hpMax + enemy id/name/hpMax/footprint hints (client reveals enemies on first-seen)
          clock: { elapsedSecs: clock.elapsedSecs, isSettled: clock.isSettled, pct: clock.pct },
          events: visible, // REQ-0240: each event carries `pt` (ms) for paced runs; `t` (sim secs) always present
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

    // ---- POST /api/schedule/seal (REQ-0058: mint a sealed schedule) ----
    // Body: {dungeonId?, dungeonType?, level?, affixes?}. The genSeed is
    // ALWAYS server-minted fresh here -- any caller-supplied seed is
    // ignored, so REQ-0043's admin-only custom-seed gate is neither
    // invoked nor bypassed (sealing never accepts a seed). Returns the
    // public seal meta (genSeed withheld) + the shareToken (== sealId).
    if (p.match(SCHEDULE_SEAL_MINT_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) { try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; } }
        try {
          const seal = schedule.mintSeal(callerId, body);
          sendJSON(res, 200, { ok: true, seal: schedule.publicSealMeta(seal), shareToken: seal.sealId });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- GET /api/schedule/seals/:sealId/comparison (REQ-0058) ----
    // The anti-spoiler-gated comparison view. Caller must be a participant
    // (403 otherwise); OTHER participants stay hidden until the caller's
    // OWN run of this sealId settles (then unlocked:true reveals all).
    const sealCompareMatch = p.match(SCHEDULE_SEAL_COMPARE_RE);
    if (sealCompareMatch) {
      const sealId = decodeURIComponent(sealCompareMatch[1]);
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const comparison = schedule.buildSealComparison(sealId, callerId);
        sendJSON(res, 200, Object.assign({ ok: true }, comparison));
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- GET /api/schedule/seals/:sealId/runs/:playerId (REQ-0058) ----
    // Seal-scoped replay read (the comparison view's "into replays" link).
    // Own replay always readable; another participant's replay is gated on
    // the caller's own run having settled (same anti-spoiler gate).
    const sealReplayMatch = p.match(SCHEDULE_SEAL_REPLAY_RE);
    if (sealReplayMatch) {
      const sealId = decodeURIComponent(sealReplayMatch[1]);
      const targetPlayerId = decodeURIComponent(sealReplayMatch[2]);
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const replay = schedule.buildSealReplay(sealId, callerId, targetPlayerId);
        sendJSON(res, 200, Object.assign({ ok: true }, replay));
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- GET /api/schedule/seals/:sealId (REQ-0058: seal metadata) ----
    // Any authenticated caller who holds the share token may preview the
    // frozen tuple (genSeed withheld) + whether they have joined already.
    const sealGetMatch = p.match(SCHEDULE_SEAL_GET_RE);
    if (sealGetMatch) {
      const sealId = decodeURIComponent(sealGetMatch[1]);
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const seal = schedule.getSeal(sealId);
        const yourEntry = storage.readSealRun(sealId, callerId);
        const participants = storage.listSealRuns(sealId);
        sendJSON(res, 200, {
          ok: true,
          seal: schedule.publicSealMeta(seal),
          participantCount: participants.length,
          youAreParticipant: !!yourEntry,
          yourRoomId: yourEntry ? yourEntry.roomId : null,
        });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ===================================================================
    // REQ-0324: co-operative Troop routes (tail-appended, order-safe). A
    // Troop is a visibility:'public' room; these routes are the CROSS-PLAYER
    // browse/host/join/leave surface (distinct from the owner-guarded /rooms*
    // surface above). Auth is the standard X-Auth-Token resolved once at the
    // top of this function -- a bot account browses/joins EXACTLY like a human.
    // ===================================================================

    // ---- GET/POST /api/schedule/troops ----
    if (p.match(SCHEDULE_TROOPS_RE)) {
      if (req.method === 'GET') {
        // Browse PUBLIC recruiting troops with a free seat -- the signal the
        // reactive fleet polls. ?state=recruiting (default) [&attackLv=<n>].
        try {
          const state = url.searchParams.get('state') || 'recruiting';
          const attackLvRaw = url.searchParams.get('attackLv');
          const attackLv = (attackLvRaw !== null && attackLvRaw !== '' && Number.isFinite(Number(attackLvRaw)))
            ? parseInt(attackLvRaw, 10) : null;
          const troops = schedule.listRecruitingTroops({ state, attackLv });
          sendJSON(res, 200, { ok: true, troops });
        } catch (e) { sendScheduleError(res, e); }
        return;
      }
      if (req.method === 'POST') {
        // Host a Troop: {dungeonId, level, formationId?, squadIndex}. Only the
        // host may open a Troop; they are seated in slot 0 here.
        readBody(req, (err, bodyStr) => {
          if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
          let body;
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
          // REQ-0043/0304 parity: genSeed/drawSeed are privileged-only test-
          // control seams, gated BEFORE any room is created (same guard the
          // POST /rooms + /sorties paths apply).
          if (body && body.genSeed !== undefined && body.genSeed !== null && !callerCanSetGenSeed) {
            sendJSON(res, 403, { ok: false, error: 'forbidden: genSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
            return;
          }
          if (body && body.drawSeed !== undefined && body.drawSeed !== null && !callerCanSetGenSeed) {
            sendJSON(res, 403, { ok: false, error: 'forbidden: drawSeed may only be specified by a dev/item_admin caller (test-control seam, not a real player action)' });
            return;
          }
          try {
            const { itemDefsById } = schedule.getScheduleContent();
            const canvas = requireOwnCanvas(callerId);
            const troop = schedule.createTroop(callerId, body, canvas, itemDefsById);
            sendJSON(res, 200, { ok: true, troop });
          } catch (e) { sendScheduleError(res, e); }
        });
        return;
      }
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    // ---- POST /api/schedule/troops/:id/join {squadIndex} ----
    const troopJoinMatch = p.match(SCHEDULE_TROOP_JOIN_RE);
    if (troopJoinMatch) {
      const roomId = decodeURIComponent(troopJoinMatch[1]);
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        try {
          const { itemDefsById } = schedule.getScheduleContent();
          const canvas = requireOwnCanvas(callerId);
          const troop = schedule.joinTroop(roomId, callerId, body.squadIndex, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, troop });
        } catch (e) { sendScheduleError(res, e); }
      });
      return;
    }

    // ---- POST /api/schedule/troops/:id/leave ----
    const troopLeaveMatch = p.match(SCHEDULE_TROOP_LEAVE_RE);
    if (troopLeaveMatch) {
      const roomId = decodeURIComponent(troopLeaveMatch[1]);
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const troop = schedule.leaveTroop(roomId, callerId);
        sendJSON(res, 200, { ok: true, troop });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- POST /api/schedule/troops/:id/cancel (REQ-0326) ----
    // ANY seated member cancels the co-op Troop -> the WHOLE troop disbands
    // (all-or-nothing). No run in flight (recruiting, or between runs cooling
    // down) -> disband NOW; a dive in flight -> flag it and disband ON RETURN
    // after the current run settles its rewards (REQ-0325). Every seat is
    // returned; the response carries a discrete disbandEvent (REQ-0327's roster).
    const troopCancelMatch = p.match(SCHEDULE_TROOP_CANCEL_RE);
    if (troopCancelMatch) {
      const roomId = decodeURIComponent(troopCancelMatch[1]);
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        const { itemDefsById } = schedule.getScheduleContent();
        const troop = schedule.cancelTroop(roomId, callerId, itemDefsById);
        sendJSON(res, 200, { ok: true, troop });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }

    // ---- GET /api/schedule/troops/:id (full troop state) ----
    const troopMatch = p.match(SCHEDULE_TROOP_RE);
    if (troopMatch) {
      const roomId = decodeURIComponent(troopMatch[1]);
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        // REQ-0325: settle + lazily auto-restart a DEPARTED troop on read
        // (poll-driven, like the solo /rooms scheduler). Per-owner canvases are
        // re-read inside the run engine, so no caller canvas is threaded here; a
        // still-recruiting troop settles to a no-op and returns its current view.
        const { itemDefsById } = schedule.getScheduleContent();
        const troop = schedule.settleTroopIfDue(roomId, itemDefsById);
        sendJSON(res, 200, { ok: true, troop });
      } catch (e) { sendScheduleError(res, e); }
      return;
    }
  }

  return false;
}
module.exports = { tryScheduleRoutes };
