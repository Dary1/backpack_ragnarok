'use strict';
// server/lib/route_auth.cjs -- REQ-0145a (se): the shared caller-
// resolution preamble + schedule-error/canvas helpers that the
// schedule / warehouse / workshop route families shared as closures
// inside the pre-split routes/schedule.cjs (origin lines 29-123 @
// commit 9d4bc89; bodies verbatim, de-closured onto explicit callerId/
// res parameters). The 401 status and wording are asserted per family
// by api_test (files+pg).
//
// ---- REQ-0036 P1-B: Dungeon Schedule + Warehouse routes ----
// Every route below resolves the CALLER'S identity from the token
// FIRST (same admin.resolveAuth() every other authenticated route
// uses, including the dev_mode fallback) -- a room/warehouse id is
// NEVER trusted as identity, matching the profile routes' own
// convention. All bodies are pure JSON; auth is header-only (no
// cookies/CSRF token needed) -- see server/README.md's "Bot-friendly"
// note (REQ-0039 design-first-class requirement).
const { sendJSON, getAuthToken } = require('./http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');

// resolveCallerOr401(req, res): token -> admin.resolveAuth -> 401 (exact
// wording preserved) or the resolved caller context. Returns null after
// sending the 401; callers must bail out on null.
function resolveCallerOr401(req, res) {
  const token = getAuthToken(req);
  const resolved = admin.resolveAuth(token);
  if (!resolved.ok) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
    return null;
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
  return { token, callerId, callerIsDevFallback, callerCanSetGenSeed };
}

// Loads (and lazily migrates, per REQ-0037's legacy-default fallback)
// the caller's own profile canvas -- schedule routes always operate
// on the CALLER'S OWN squads/inventory (P1-B solo scope: golden b's
// "any number of players" collapses to "1 player, 4 squads" here).
function loadOwnCanvas(callerId) {
  const doc = storage.readProfile(callerId);
  return doc ? doc.canvas : null;
}
function requireOwnCanvas(callerId) {
  const canvas = loadOwnCanvas(callerId);
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
function sendScheduleError(res, e) {
  // REQ-0041: thread a STRUCTURED e.reason through as a `reason`
  // field on the JSON error body, when the thrown error carries one
  // (e.g. schedule.cjs's assignSlot sets err.reason='empty_squad' for
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

module.exports = { resolveCallerOr401, loadOwnCanvas, requireOwnCanvas, scheduleErrToStatus, sendScheduleError };
