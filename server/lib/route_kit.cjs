'use strict';
// server/lib/route_kit.cjs -- REQ-0349: THE route request preamble. Every
// route family resolves its caller, guards its method, reads its JSON body and
// maps its domain errors through THIS module and nothing else.
//
// It is the promotion of lib/route_auth.cjs (REQ-0145a se), which extracted the
// caller-resolution preamble but was adopted by only four families (schedule,
// warehouse, workshop, starter). The other ten open-coded the identical
// preamble -- routes/market.cjs and routes/ragnarok.cjs even carried a comment
// saying "resolve the caller EXACTLY like ... lib/route_auth.cjs's
// resolveCallerOr401" directly above their own inline copy. The cost was not
// line count: REQ-0199's JWT-precedence fix (a Bearer-JWT caller silently
// resolving to the dev_mode fallback, i.e. acting as the WRONG player) had to be
// applied four separate times, and REQ-0214 (viaDevFallback) and REQ-0217 (the
// e2e profile redirect) had the same shape. One copy means one place to fix.
//
// MIGRATION DISCIPLINE (REQ-0349): each family moved onto this module in its own
// commit with its CURRENT response wording passed in as data (the `opts` bag on
// withJsonBody), so every migration commit changed zero response bytes and
// server/tests/api/* needed no edit. The wording unification was then a single
// separate commit that deleted those overrides and let the defaults below apply --
// and all 229 api_test cases stayed green through it, confirming that none of the
// nine former body-handling wordings was ever part of an asserted contract.
// See docs/REQ/todo/REQ-0349-route-kit-preamble-unify.md.
const { sendJSON, readBody, getAuthToken, MAX_BODY_BYTES } = require('./http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');

// ---------------------------------------------------------------------------
// caller resolution
// ---------------------------------------------------------------------------
// Moved VERBATIM from lib/route_auth.cjs (REQ-0145a se), which took it verbatim
// from the pre-split routes/schedule.cjs (origin lines 29-123 @ commit 9d4bc89).
// The 401 status and wording are asserted per family by api_test (files+pg).
//
// ---- REQ-0036 P1-B ----
// Every authenticated route resolves the CALLER'S identity from the token
// FIRST -- a room/warehouse/profile id in the URL or body is NEVER trusted as
// identity. All bodies are pure JSON; auth is header-only (no cookies/CSRF
// token needed) -- see server/README.md's "Bot-friendly" note (REQ-0039
// design-first-class requirement).

// resolveCallerContext(req): the full resolution, WITHOUT touching res.
// Returns { ok: true, ...context } or { ok: false, reason }. Families use one of
// the two wrappers below, never this directly.
function resolveCallerContext(req) {
  const token = getAuthToken(req);
  const resolved = admin.resolveAuthFromRequest(req);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const callerId = resolved.player.playerId;
  // REQ-0036 P1-C: true only when this request resolved via the dev_mode
  // NO-TOKEN fallback (never for a real, valid guest token, even one belonging
  // to the dev player's own id by coincidence -- this deliberately mirrors the
  // PROFILE route's own isDefaultAlias check, which also gates on `!token`, not
  // merely "resolved player happens to be the dev player"). Used ONLY to gate
  // dev/test-control seams (schedule's dev/backdate, market's
  // listings/dev/clear-all, ragnarok's order/dev/force-rebuild +
  // einherjar/dev/clear), never a gameplay feature.
  // REQ-0214: keyed off the resolver's own resolution-path annotation
  // (admin.resolveAuthFromRequest sets viaDevFallback), NOT a playerId
  // comparison -- the e2e profile redirect (x-bpk-e2e-profile) swaps the
  // playerId while remaining exactly this no-token dev_mode fallback.
  const callerIsDevFallback = !token && resolved.viaDevFallback === true;
  // REQ-0043: schedule room-create's optional `genSeed` (sim/dungen.cjs's
  // generator seed -- lets a caller reproduce an EXACT dungeon layout) is gated
  // to the SAME two privileged-caller classes this codebase already uses for a
  // dev/test-control knob: the dev_mode no-token fallback, OR a real token whose
  // resolved player carries the item_admin role (the same guard the admin
  // item-edit/grant routes use). A plain guest token (even a perfectly valid
  // one, roles:[]) is REFUSED.
  const callerCanSetGenSeed = callerIsDevFallback || admin.isItemAdminToken(token);
  // `resolved` is exposed so a family can read viaDevFallback / player.roles
  // without a second resolve (routes/profile.cjs and routes/skins.cjs need
  // viaDevFallback for their "default" compat alias).
  return { ok: true, token, callerId, callerIsDevFallback, callerCanSetGenSeed, resolved, player: resolved.player };
}

// The 401-sending wrapper -- the shape almost every family wants. Returns null
// AFTER sending the 401 (exact pre-REQ-0349 wording), so callers MUST bail out
// on null.
function resolveCallerOr401(req, res) {
  const ctx = resolveCallerContext(req);
  if (!ctx.ok) {
    sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + ctx.reason });
    return null;
  }
  return ctx;
}

// The OPPORTUNISTIC wrapper: an unresolvable caller yields null and NOTHING is
// sent. routes/dex.cjs needs exactly this -- a Dex card is public, so a missing
// or invalid token must degrade to "no personal overlay", never a 401.
function resolveCallerOptional(req) {
  const ctx = resolveCallerContext(req);
  return ctx.ok ? ctx : null;
}

// ---------------------------------------------------------------------------
// method guard
// ---------------------------------------------------------------------------
// The 405 wording, in ONE place. Was a bare literal at 49 sites.
// Returns true when the method is allowed; sends the 405 and returns false
// otherwise, so call sites read `if (!methodGuard(req, res, 'POST')) return;`.
const METHOD_NOT_ALLOWED = 'method not allowed';
function methodGuard(req, res, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (list.indexOf(req.method) !== -1) return true;
  sendJSON(res, 405, { ok: false, error: METHOD_NOT_ALLOWED });
  return false;
}

// ---------------------------------------------------------------------------
// domain errors
// ---------------------------------------------------------------------------
// THE code->status table. Before REQ-0349 there were four copies of it
// (lib/route_auth.cjs scheduleErrToStatus, routes/market.cjs errToStatus,
// routes/ragnarok.cjs errToStatus, routes/dismantle.cjs errToStatus) and they
// DISAGREED: only the schedule copy mapped FORBIDDEN, so the other three
// answered 500 for it. Verified at REQ-0349 time that the only FORBIDDEN
// throwers in the server are services/seals.cjs:239,264,268 (REQ-0058 seal
// visibility / participant gate), reached exclusively through the schedule
// family -- i.e. the gap was INERT, no live response changes when the other
// three adopt this table. Its value is that the divergence cannot come back.
//
// The entries are exactly the union of those four tables. Deliberately no
// speculative additions: the complete set of codes thrown anywhere in
// services/ + dismantle.cjs is BAD_REQUEST, CONFLICT, NOT_FOUND, FORBIDDEN,
// plus NO_ADOPTED / BAD_SHAPE which their own route families map locally and
// which therefore keep falling through to 500 here, exactly as today.
const CODE_TO_STATUS = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403, // REQ-0058: seal visibility / participant gate
  NOT_FOUND: 404,
  CONFLICT: 409,
};
function domainErrToStatus(e) {
  return (e && CODE_TO_STATUS[e.code]) || 500;
}

// REQ-0041: thread a STRUCTURED e.reason through as a `reason` field on the
// JSON error body when the thrown error carries one (e.g. schedule.cjs's
// assignSlot sets err.reason='empty_squad' for the empty-BP deploy-gate 409).
// Omitted ENTIRELY (not even `reason: undefined`) when absent, so bodies for
// the many errors that set no reason stay byte-identical. The client's
// ApiError.reason (client/src/api/http.ts) and schedule/errors.ts's
// friendlyScheduleError read this field preferentially before falling back to
// message-substring matching -- which is why e.message is passed through
// UNTOUCHED here and REQ-0349's wording unification never touches domain text.
function sendDomainError(res, e) {
  const body = { ok: false, error: e.message };
  if (typeof e.reason === 'string') body.reason = e.reason;
  sendJSON(res, domainErrToStatus(e), body);
}

// ---------------------------------------------------------------------------
// JSON body
// ---------------------------------------------------------------------------
// Canonical wordings. Before REQ-0349 the 20 body-read sites produced five
// different 413/400-read strings ('request body exceeds N bytes',
// 'request body too large', 'body read failed: <msg>', 'invalid request body',
// 'bad body', plus the raw err.message passthrough) and four bad-JSON strings
// ('invalid JSON body', 'malformed JSON body', 'invalid json'). None of them is
// substring-matched by the client -- client/src/schedule/errors.ts matches only
// DOMAIN text ('active schedule', 'no space in inventory', 'empty squad',
// 'no Backpack') -- so unifying them is safe; see REQ-0349 D1.
const BODY_TOO_LARGE = 'request body exceeds ' + MAX_BODY_BYTES + ' bytes';
const BODY_READ_FAILED = 'invalid request body';
const BODY_BAD_JSON = 'invalid JSON body';

// A message option is either a string or a function(err). Both existed for the
// migration, so a family could carry its pre-REQ-0349 wording as data and change
// zero response bytes while moving onto this module. After the unification commit
// NO family overrides anything, and the hook is kept only because a future
// endpoint with a genuinely different cap (the way routes/skins.cjs has a
// genuinely different maxBytes) should not have to fork withJsonBody.
function pickMessage(override, fallback, e) {
  if (typeof override === 'function') return override(e);
  if (typeof override === 'string') return override;
  return fallback;
}

/** readBody -> size cap -> JSON.parse, with one wording set.
 *
 * opts (all optional; every one exists ONLY to hold a family's pre-REQ-0349
 * wording during migration and is deleted by the unification commit):
 *   tooLarge  string|fn(err) - 413 body when readBody hits MAX_BODY_BYTES
 *   readFail  string|fn(err) - 400 body for any other read error
 *   badJson   string|fn(err) - 400 body when JSON.parse throws
 *   maxBytes  number         - an ADDITIONAL, tighter cap checked after the
 *                              read (routes/skins.cjs's MAX_SKINS_BODY_BYTES);
 *                              its 413 wording follows the same 'exceeds N
 *                              bytes' shape.
 *   allowEmpty false          - treat an EMPTY body as bad JSON instead of {}.
 *                              Reproduces a bare JSON.parse(bodyStr), which is
 *                              what routes/profile.cjs's canvas PUT has always
 *                              done. Default true (an empty body parses to {}).
 * cb(body, bodyStr) runs only on success. An empty body parses to {}, matching
 * every pre-REQ-0349 call site (both the `bodyStr ? JSON.parse(bodyStr) : {}`
 * and the `JSON.parse(bodyStr || '{}')` spellings).
 */
function withJsonBody(req, res, opts, cb) {
  const o = opts || {};
  readBody(req, (err, bodyStr) => {
    if (err) {
      if (err.code === 'TOO_LARGE') {
        sendJSON(res, 413, { ok: false, error: pickMessage(o.tooLarge, BODY_TOO_LARGE, err) });
        return;
      }
      sendJSON(res, 400, { ok: false, error: pickMessage(o.readFail, BODY_READ_FAILED, err) });
      return;
    }
    if (o.maxBytes && Buffer.byteLength(bodyStr || '') > o.maxBytes) {
      sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + o.maxBytes + ' bytes' });
      return;
    }
    let body;
    try {
      // allowEmpty:false reproduces a bare JSON.parse(bodyStr): an EMPTY body
      // throws, i.e. answers the bad-JSON 400 rather than yielding {}. Load-
      // bearing for routes/profile.cjs, where a saved canvas of {} must not be
      // reachable by sending no body at all.
      if (!bodyStr && o.allowEmpty === false) throw new SyntaxError('Unexpected end of JSON input');
      body = bodyStr ? JSON.parse(bodyStr) : {};
    } catch (e) { sendJSON(res, 400, { ok: false, error: pickMessage(o.badJson, BODY_BAD_JSON, e) }); return; }
    cb(body, bodyStr);
  });
}

// ---------------------------------------------------------------------------
// request-shape validators
// ---------------------------------------------------------------------------
// REQ-0349 D3: the shapes behind the inline `typeof x !== 'string'` checks in
// routes/. They THROW a BAD_REQUEST-coded error, so a handler already wrapped in
// try/catch + sendDomainError needs no extra branch -- and that seam is exactly
// the limit of where they apply. Of the 17 inline checks the audit counted, only
// the 3 sitting in handlers that ALREADY had the seam were converted. The rest
// were left alone on purpose:
//   * routes/admin.cjs's two are interleaved with two different 500 wrappers, so
//     hoisting them into a throw would change which failures map to 400 vs 500;
//   * routes/public.cjs's three and routes/schedule.cjs's one are local
//     query-param coercions that return null -- they are not 400 sites at all;
//   * routes/art.cjs's six and routes/content.cjs's three are out of scope (see
//     those files' own REQ-0349 notes).
// A requireInt() was written for this module and then DELETED, because after the
// conversions it had no caller: dead code in a module every family imports is
// worse than a duplicated typeof check.
// Deliberately NOT a schema framework either: declarative per-route request
// schemas are a design decision and do not belong inside a mechanical migration.
function badRequest(message, reason) {
  const e = new Error(message);
  e.code = 'BAD_REQUEST';
  if (reason) e.reason = reason;
  return e;
}
/** Non-empty string, else BAD_REQUEST. `message` overrides the generated text
 *  where a family's existing wording differs from it. */
function requireString(v, name, message) {
  if (typeof v !== 'string' || !v) throw badRequest(message || (name + ' (string) is required'));
  return v;
}
/** One of `allowed`, else BAD_REQUEST. `message` overrides the generated text
 *  where a family's existing wording differs from it. */
function requireEnum(v, name, allowed, message) {
  if (allowed.indexOf(v) === -1) {
    throw badRequest(message || (name + ' must be one of ' + allowed.join('|')));
  }
  return v;
}

// ---------------------------------------------------------------------------
// caller-owned canvas
// ---------------------------------------------------------------------------
// Loads (and lazily migrates, per REQ-0037's legacy-default fallback) the
// caller's own profile canvas -- schedule routes always operate on the CALLER'S
// OWN squads/inventory (P1-B solo scope).
function loadOwnCanvas(callerId) {
  const doc = storage.readProfile(callerId);
  return doc ? doc.canvas : null;
}
function requireOwnCanvas(callerId) {
  const canvas = loadOwnCanvas(callerId);
  if (!canvas) throw badRequest('no saved canvas for this profile yet');
  return canvas;
}

module.exports = {
  resolveCallerContext, resolveCallerOr401, resolveCallerOptional,
  methodGuard, METHOD_NOT_ALLOWED,
  domainErrToStatus, sendDomainError, CODE_TO_STATUS,
  withJsonBody, BODY_TOO_LARGE, BODY_READ_FAILED, BODY_BAD_JSON,
  badRequest, requireString, requireEnum,
  loadOwnCanvas, requireOwnCanvas,
};
