'use strict';
// server/routes/schedule.cjs -- REQ-0047 (c): the token-gated Dungeon
// Schedule / Warehouse / Workshop HTTP surface (rooms CRUD, slots, swap,
// run view incl. ?format=text, dev backdate seams, warehouse list/claim,
// gacha). One module because every route here shares the same resolved-
// caller preamble + helper closures (loadOwnCanvas, sendScheduleError,
// loadAndSettleRoom). Bodies moved VERBATIM from server/api.cjs handle().
// Returns false when not matched (router then 404s).
const { sendJSON, sendText, readBody, getAuthToken, MAX_BODY_BYTES } = require('../lib/http_util.cjs');
const { humanizeEventText } = require('../lib/humanize.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const schedule = require('../schedule.cjs');

const SCHEDULE_ROOMS_RE = /^\/api\/schedule\/rooms$/;
const SCHEDULE_ROOM_RE = /^\/api\/schedule\/rooms\/([^/]+)$/;
const SCHEDULE_ROOM_SLOT_RE = /^\/api\/schedule\/rooms\/([^/]+)\/slots\/([0-9]+)$/;
const SCHEDULE_ROOM_SWAP_RE = /^\/api\/schedule\/rooms\/([^/]+)\/swap$/;
const SCHEDULE_ROOM_RUN_RE = /^\/api\/schedule\/rooms\/([^/]+)\/run$/;
const SCHEDULE_ROOM_DEV_BACKDATE_RE = /^\/api\/schedule\/rooms\/([^/]+)\/dev\/backdate$/; // REQ-0036 P1-C: dev-only E2E time-control hook
const WAREHOUSE_RE = /^\/api\/warehouse$/;
const WAREHOUSE_CLAIM_RE = /^\/api\/warehouse\/claim$/;
const WAREHOUSE_DEV_BACKDATE_CLAIM_RE = /^\/api\/warehouse\/dev\/backdate-claim$/; // REQ-0041 E2E hook, dev-only
const WAREHOUSE_DEV_CLEAR_DEBRIS_RE = /^\/api\/warehouse\/dev\/clear-debris$/; // fix: e2e pg teardown -- E2E debris-cleanup hook, dev-only
const SCHEDULE_ROOMS_DEV_CLEAR_RE = /^\/api\/schedule\/rooms\/dev\/clear$/; // REQ-0082: dev-only E2E room-cleanup hook
const WORKSHOP_GACHA_RE = /^\/api\/workshop\/gacha$/; // REQ-0042

function tryScheduleRoutes(req, res, url, p) {
  // ---- REQ-0036 P1-B: Dungeon Schedule + Warehouse routes ----
  // Every route below resolves the CALLER'S identity from the token
  // FIRST (same admin.resolveAuth() every other authenticated route
  // uses, including the dev_mode fallback) -- a room/warehouse id is
  // NEVER trusted as identity, matching the profile routes' own
  // convention. All bodies are pure JSON; auth is header-only (no
  // cookies/CSRF token needed) -- see server/README.md's "Bot-friendly"
  // note (REQ-0039 design-first-class requirement).
  const scheduleMatch = p.match(SCHEDULE_ROOMS_RE) || p.match(SCHEDULE_ROOM_RE) ||
    p.match(SCHEDULE_ROOM_SLOT_RE) || p.match(SCHEDULE_ROOM_SWAP_RE) || p.match(SCHEDULE_ROOM_RUN_RE) ||
    p.match(SCHEDULE_ROOM_DEV_BACKDATE_RE) ||
    p.match(WAREHOUSE_RE) || p.match(WAREHOUSE_CLAIM_RE) || p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE) ||
    p.match(WAREHOUSE_DEV_CLEAR_DEBRIS_RE) ||
    p.match(SCHEDULE_ROOMS_DEV_CLEAR_RE) ||
    p.match(WORKSHOP_GACHA_RE);
  if (scheduleMatch) {
    const token = getAuthToken(req);
    const resolved = admin.resolveAuth(token);
    if (!resolved.ok) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
      return;
    }
    const callerId = resolved.player.playerId;
    // REQ-0036 P1-C: true only when this request resolved via the
    // dev_mode NO-TOKEN fallback (never for a real, valid guest token,
    // even one belonging to the dev player's own id by coincidence --
    // this deliberately mirrors the PROFILE route's own
    // isDefaultAlias check above, which also gates on `!token`, not
    // merely "resolved player happens to be the dev player"). Used ONLY
    // to gate the dev/backdate route below (a test-control seam, not a
    // gameplay feature) -- see schedule.cjs's devBackdateActiveRun() doc
    // comment and server/README.md's "E2E time-control" section.
    const devUserForGate = admin.readDevUser();
    const callerIsDevFallback = !token && devUserForGate.dev_mode === true && callerId === devUserForGate.playerId;
    // REQ-0043: room-create's optional `genSeed` (sim/dungen.cjs's
    // generator seed -- lets a caller reproduce an EXACT dungeon layout)
    // is gated to the SAME two privileged-caller classes the rest of
    // this codebase already uses for a dev/test-control knob: the
    // dev_mode no-token fallback (callerIsDevFallback, computed above,
    // same as dev/backdate) OR a real token whose resolved player carries
    // the item_admin role (admin.isItemAdminToken(), same guard the
    // admin item-edit/grant routes already use). A plain guest token
    // (even a perfectly valid one, roles:[]) is REFUSED -- see the
    // createRoom handler below, which 403s BEFORE calling
    // schedule.createRoom() at all when body.genSeed is present and this
    // is false, so an ungated caller can never even attempt to bias a
    // generated dungeon's layout.
    const callerCanSetGenSeed = callerIsDevFallback || admin.isItemAdminToken(token);

    // Loads (and lazily migrates, per REQ-0037's legacy-default fallback)
    // the caller's own profile canvas -- schedule routes always operate
    // on the CALLER'S OWN presets/inventory (P1-B solo scope: golden b's
    // "any number of players" collapses to "1 player, 4 units" here).
    function loadOwnCanvas() {
      const doc = storage.readProfile(callerId);
      return doc ? doc.canvas : null;
    }
    function requireOwnCanvas() {
      const canvas = loadOwnCanvas();
      if (!canvas) {
        const err = new Error('no saved canvas for this profile yet'); err.code = 'BAD_REQUEST'; throw err;
      }
      return canvas;
    }
    function scheduleErrToStatus(e) {
      if (e.code === 'NOT_FOUND') return 404;
      if (e.code === 'CONFLICT') return 409;
      if (e.code === 'BAD_REQUEST') return 400;
      return 500;
    }
    function sendScheduleError(e) {
      // REQ-0041: thread a STRUCTURED e.reason through as a `reason`
      // field on the JSON error body, when the thrown error carries one
      // (e.g. schedule.cjs's assignSlot sets err.reason='empty_unit' for
      // the empty-BP deploy-gate 409) -- omitted entirely (not even
      // `reason: undefined`) for every OTHER schedule error this route
      // surface throws today, none of which set e.reason, so existing
      // response bodies for those are byte-identical to before this
      // change (strict additive). The client's ApiError.reason /
      // schedule/errors.ts's friendlyScheduleError read this field
      // preferentially before falling back to message-substring matching.
      const body = { ok: false, error: e.message };
      if (typeof e.reason === 'string') body.reason = e.reason;
      sendJSON(res, scheduleErrToStatus(e), body);
    }
    // settleRoomIfDue() is called by every room-touching handler before
    // anything else -- this is the lazy, poll-driven "scheduler" (see
    // schedule.cjs's own header comment on the run-clock design): the
    // next auto-run only actually starts the moment SOME request happens
    // to look at this room after its cooldown has elapsed.
    function loadAndSettleRoom(roomId) {
      const room = schedule.getOwnRoomOr404(roomId, callerId);
      const { itemDefsById } = schedule.getScheduleContent();
      return schedule.settleRoomIfDue(room, loadOwnCanvas(), itemDefsById);
    }

    // ---- POST/GET /api/schedule/rooms ----
    if (p.match(SCHEDULE_ROOMS_RE)) {
      if (req.method === 'GET') {
        try {
          sendJSON(res, 200, { ok: true, rooms: schedule.listOwnRooms(callerId) });
        } catch (e) { sendScheduleError(e); }
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
          } catch (e) { sendScheduleError(e); }
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
        } catch (e) { sendScheduleError(e); }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const room = loadAndSettleRoom(roomId);
          const canceled = schedule.cancelRoom(room);
          sendJSON(res, 200, { ok: true, room: canceled });
        } catch (e) { sendScheduleError(e); }
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
          const canvas = requireOwnCanvas();
          const updated = schedule.assignSlot(room, callerId, slotIndex, body.presetIndex, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, room: updated });
        } catch (e) { sendScheduleError(e); }
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
          const canvas = requireOwnCanvas();
          const result = schedule.swapUnit(room, body.slot, body.presetIndex, canvas, itemDefsById);
          sendJSON(res, 200, { ok: true, room: result.room, applied: result.applied });
        } catch (e) { sendScheduleError(e); }
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
      } catch (e) { sendScheduleError(e); }
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
        } catch (e) { sendScheduleError(e); }
      });
      return;
    }

    // ---- POST /api/warehouse/dev/backdate-claim (REQ-0041 E2E hook,
    // dev-only) ----
    // Body: {itemUid, extraSecsIntoPast?}. Rewrites a 'claiming'
    // warehouse row's claimedAt further into the past so it reads as an
    // ABANDONED claim (older than WAREHOUSE_CLAIM_TIMEOUT_MS) on the very
    // next read, exactly mirroring the existing dev/backdate room route's
    // own test-control-seam shape/gating (schedule.cjs's
    // devBackdateClaimedWarehouseItem() doc) -- lets E2E cover the
    // "abandoned claim lazily reverts to claimable" path without waiting
    // out the real 120s timeout. GATED to the dev_mode fallback caller
    // ONLY, same as dev/backdate.
    if (p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/backdate-claim is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        }
        if (!body.itemUid) { sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return; }
        try {
          const item = schedule.devBackdateClaimedWarehouseItem(callerId, body.itemUid, body.extraSecsIntoPast);
          sendJSON(res, 200, { ok: true, itemUid: item.itemUid, claimedAt: item.claimedAt });
        } catch (e) { sendScheduleError(e); }
      });
      return;
    }

    // ---- POST /api/warehouse/dev/clear-debris (fix: e2e pg teardown --
    // E2E debris-cleanup hook, dev-only) ----
    // No body. Bulk-deletes EVERY warehouse row belonging to the CALLER
    // -- necessarily the dev_mode fallback player, the only caller that
    // can reach this -- and returns {ok:true, deleted:n}. Exists because
    // the Playwright suite's global setup/teardown safety net
    // (client/e2e/global-setup.ts) backs up + restores FILES only: with
    // the live API in STORAGE_BACKEND=pg mode, the rows the suite
    // grants/claims for the dev player survived every run (~55-60 each)
    // until the 200-row cap turned POST /api/admin/warehouse/grant into
    // 409 warehouse-full cascades. Goes through schedule.devClearWarehouse
    // -> storage.clearWarehouseForPlayer (the files/pg chokepoint), so
    // both backends clean identically. GATED to the dev_mode no-token
    // fallback caller ONLY (callerIsDevFallback), exactly like
    // dev/backdate and dev/backdate-claim above -- a real guest token,
    // even a valid one, gets 403; and the target is always the RESOLVED
    // caller's own warehouse (this route's shape carries no client-
    // supplied playerId at all), so no real player's rows are reachable
    // through it.
    if (p.match(WAREHOUSE_DEV_CLEAR_DEBRIS_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      if (!callerIsDevFallback) {
        sendJSON(res, 403, { ok: false, error: 'forbidden: dev/clear-debris is only available to the dev_mode fallback caller (test-control seam, not a real player action)' });
        return;
      }
      try {
        const deleted = schedule.devClearWarehouse(callerId);
        sendJSON(res, 200, { ok: true, deleted });
      } catch (e) { sendScheduleError(e); }
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
      } catch (e) { sendScheduleError(e); }
      return;
    }

    // ---- GET /api/warehouse (golden e/f) ----
    if (p.match(WAREHOUSE_RE)) {
      if (req.method !== 'GET') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      try {
        sendJSON(res, 200, { ok: true, items: schedule.listWarehouse(callerId) });
      } catch (e) { sendScheduleError(e); }
      return;
    }

    // ---- POST /api/warehouse/claim {itemUid} (golden f) ----
    if (p.match(WAREHOUSE_CLAIM_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body;
        try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        if (typeof body.itemUid !== 'string' || !body.itemUid) {
          sendJSON(res, 400, { ok: false, error: 'itemUid is required' }); return;
        }
        try {
          // REQ-0041 two-phase claim: this route no longer touches
          // profileCanvas or calls storage.writeProfile AT ALL (see
          // schedule.cjs's claimWarehouseItem doc for the full BUG #3
          // root-cause writeup) -- it only flips the warehouse row to
          // 'claiming' and hands back the content itemId (+ the row's own
          // itemUid, which the client reuses as the new inventory
          // PO/SI's own uid) so the CLIENT can place it via the engine
          // itself, through the app's one auto-save choke point.
          const { itemDefsById, tmDefsById } = schedule.getScheduleContent();
          const result = schedule.claimWarehouseItem(callerId, body.itemUid, itemDefsById, tmDefsById);
          // REQ-0042: echo kind/qty too (undefined for a plain PO/SI row,
          // 'tm'/a number for a TM-kind row) so the client can dispatch
          // to the correct placement path (engine PO/SI first-fit vs.
          // TM place-or-merge).
          sendJSON(res, 200, { ok: true, itemUid: result.itemUid, itemId: result.itemId, kind: result.kind, qty: result.qty });
        } catch (e) { sendScheduleError(e); }
      });
      return;
    }

    // ---- POST /api/workshop/gacha {kind:'common_bp'} (REQ-0042) ----
    // Two-phase, mirrors POST /api/warehouse/claim immediately above:
    // this route NEVER writes the caller's profile -- it only reads the
    // LAST-SAVED canvas (loadOwnCanvas()) to check the LRDST balance,
    // rolls a fresh BP instance server-side (seeded RNG, see
    // schedule.cjs's rollCommonBp), records a pending row, and returns
    // the rolled definition. The CLIENT deducts the cost from its own
    // LRDST stack, first-fit-places the BP, and auto-saves -- THAT PUT
    // is what finalizes the roll (see finalizeGachaForCanvas, wired into
    // the profile PUT handler above alongside
    // finalizeClaimingItemsForCanvas).
    if (p.match(WORKSHOP_GACHA_RE)) {
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return; }
      readBody(req, (err, bodyStr) => {
        if (err) { sendJSON(res, err.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: err.message }); return; }
        let body = {};
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
        }
        const kind = typeof body.kind === 'string' ? body.kind : 'common_bp';
        try {
          const canvas = loadOwnCanvas();
          const result = schedule.startGachaRoll(callerId, kind, canvas);
          sendJSON(res, 200, { ok: true, cost: result.cost, rolled: result.rolled });
        } catch (e) { sendScheduleError(e); }
      });
      return;
    }
  }


  return false;
}
module.exports = { tryScheduleRoutes };
