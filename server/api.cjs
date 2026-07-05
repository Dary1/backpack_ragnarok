#!/usr/bin/env node
// backpack_ragnarok — server/api.cjs
// REQ-0024: Node API service, node:http only (no framework deps).
// Listens on 127.0.0.1:8802. Endpoints:
//   GET  /api/health
//   GET  /api/content (items+sis+tms, REQ-0042)
//   GET  /api/me
//   PUT  /api/admin/item/:id
//   POST /api/admin/warehouse/grant                      (REQ-0041 feedback 1, dev grant)
//   GET  /api/profile/:playerId/canvas
//   PUT  /api/profile/:playerId/canvas
//   POST   /api/schedule/rooms                          (REQ-0036 P1-B)
//   GET    /api/schedule/rooms
//   GET    /api/schedule/rooms/:id
//   DELETE /api/schedule/rooms/:id
//   PUT    /api/schedule/rooms/:id/slots/:slotIndex
//   PUT    /api/schedule/rooms/:id/swap
//   GET    /api/schedule/rooms/:id/run
//   GET    /api/schedule/dungeons                        (REQ-0036 P1-C, no auth)
//   POST   /api/schedule/rooms/:id/dev/backdate           (REQ-0036 P1-C, dev-only)
//   GET    /api/warehouse
//   POST   /api/warehouse/claim
//
// REQ-0037: auth is now token-based (X-Auth-Token header), resolved via
// admin.cjs's resolveAuth()/isItemAdminToken(). See
// docs/REQ/REQ-0037-guest-auth.md for the full design:
//   - /api/me: 200 {playerId,name,roles} for the resolved player (valid
//     token, or no-token+dev_mode fallback to the dev player); 401 if a
//     token is present but unknown, or absent with dev_mode:false.
//   - /api/profile/:playerId/canvas: the URL's :playerId is NEVER trusted
//     as auth -- the ACTUAL player is resolved from the token, and the
//     request is rejected (403) if that player's own id doesn't match
//     the URL. The literal id "default" is a dev_mode-only compat alias
//     for the dev player (old E2E specs / hardcoded call sites).
//   - PUT /api/admin/item/:id: same token resolution, then an
//     item_admin role check -- unchanged 403 status convention from
//     REQ-0035, mechanism replaced.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('./storage.cjs');
const admin = require('./admin.cjs');
const schedule = require('./schedule.cjs'); // REQ-0036 P1-B: Dungeon Schedule service
// REQ-0024 gap fix: render effect AST -> EN/JA display text server-side,
// using the SAME renderer tool_gen_data.cjs uses to bake mock-src/data.js,
// so live-mode tooltips are byte-identical to baked-mode tooltips.
const { render } = require('../tools/eff_render.cjs');

const HOST = '127.0.0.1';
const PORT = 8802;
const VERSION = '0.1.0';
const MAX_BODY_BYTES = storage.MAX_BODY_BYTES;

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const LIVE_DIR = path.join(CONTENT_DIR, 'live');
const VOCAB_PATH = path.join(CONTENT_DIR, 'vocab.json');
const ITEMS_PATH = path.join(LIVE_DIR, 'live_items.json');
const SIS_PATH = path.join(LIVE_DIR, 'live_sis.json');
const TMS_PATH = path.join(LIVE_DIR, 'live_tms.json'); // REQ-0042: Transmutator content defs
const SCENARIO_PATH = path.join(LIVE_DIR, 'scenario.json');
const REGISTRY_PATH = path.join(CONTENT_DIR, 'registry.json');

// ---- content cache (mtime-checked; re-read only when a source file changes) ----
let contentCache = null; // { mtimes: {vocab,items,sis,scenario}, payload }

function statMtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return null; }
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Joins all effect renderings (in the given locale) with a single space.
// Mirrors tools/tool_gen_data.cjs's renderEffJoined exactly, so live-served
// eff_en/eff_ja match the baked mock-src/data.js strings byte-for-byte.
function renderEffJoined(effects, locale) {
  return (effects || []).map(function (e) { return render(e, locale); }).join(' ');
}

// REQ-0038: formal i18n content shape. content/live/*.json entries now
// carry an `i18n` map (e.g. i18n.ja.{name,flavor}) instead of flat
// name_ja/flavor_ja fields (see tools/migrate_i18n.cjs). Chosen served
// shape (per the REQ-0038 design decision -- "pick ONE approach and apply
// it consistently"): serve the new `i18n` map AS WELL AS computed back-
// compat top-level name_ja/flavor_ja fields, mirrored from
// i18n.ja.name/i18n.ja.flavor. This keeps every EXISTING consumer of the
// wire shape working unchanged (client/src/api.ts's ApiItemEntry/
// ApiSIEntry, client/src/ItemPanel.tsx's localized(), mock-src/ui.js's
// gameDataFromApiContent(), tools/tool_gen_data.cjs's baked data.js)
// while the Dex v2 UI (client/src/dex/*) and the admin edit form read the
// formal i18n map directly. Only the SERVER'S OWN computation is new;
// the on-disk file no longer has the flat fields at all post-migration.
function withBackCompatI18n(entry) {
  const ja = entry.i18n && entry.i18n.ja;
  if (!ja) return entry;
  const out = Object.assign({}, entry);
  if (out.name_ja === undefined && typeof ja.name === 'string') out.name_ja = ja.name;
  if (out.flavor_ja === undefined && typeof ja.flavor === 'string') out.flavor_ja = ja.flavor;
  return out;
}

// Builds the /api/content payload fresh from content/live + vocab.
// Shape mirrors mock-src/data.js (GameData): { items, sis, trees, scenario }.
// This is intentionally a straight, un-cached-at-source read of content/live —
// content/live is the single source of truth (per REQ-0024 architecture note).
function buildContentPayload() {
  const vocab = loadJSON(VOCAB_PATH);
  const items = loadJSON(ITEMS_PATH);
  const sis = loadJSON(SIS_PATH);
  const tms = loadJSON(TMS_PATH); // REQ-0042
  const scenario = loadJSON(SCENARIO_PATH);
  // REQ-0035: batch-level provenance for the Dex's "provenance" section.
  // Optional -- an absent/unreadable registry.json degrades to `null`,
  // never a 500 (this file is metadata, not required for the board to
  // function).
  let registry = null;
  try { registry = loadJSON(REGISTRY_PATH); } catch (e) { registry = null; }

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];
  const tmEntries = tms.entries || []; // REQ-0042

  const ITEMS = {};
  for (const e of itemEntries) {
    ITEMS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    }));
  }
  const SIS = {};
  for (const e of siEntries) {
    SIS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    }));
  }
  // REQ-0042: TM (Transmutator) defs -- no  field today (no
  // use-effect v1, per the REQ doc), so no eff_en/eff_ja rendering is
  // needed, but withBackCompatI18n is still applied for i18n consistency
  // with items/sis (name_ja/flavor_ja compat fields derived from i18n.ja).
  const TMS = {};
  for (const e of tmEntries) {
    TMS[e.id] = withBackCompatI18n(Object.assign({}, e));
  }
  const trees = { po: vocab.po_tags || {}, socket: vocab.socket_tags || {} };
  // REQ-0035: closed-vocabulary lists for the Dex admin edit form's
  // dropdowns (trigger types, verb types, statuses, rarities). Server-side
  // validation (admin.cjs) is the actual source of truth/enforcement --
  // this is purely so the client can render matching dropdown options
  // without duplicating vocab.json's lists by hand.
  const vocabLists = {
    triggers: vocab.triggers || [],
    verbs: vocab.verbs || [],
    statuses: vocab.statuses || [],
    rarities: vocab.rarities || [],
  };

  return {
    items: ITEMS,
    sis: SIS,
    tms: TMS, // REQ-0042
    trees: trees,
    scenario: scenario,
    layout: scenario.layout || null,
    registry: registry,
    vocab: vocabLists,
  };
}

function getContent() {
  const mtimes = {
    vocab: statMtimeMs(VOCAB_PATH),
    items: statMtimeMs(ITEMS_PATH),
    sis: statMtimeMs(SIS_PATH),
    tms: statMtimeMs(TMS_PATH), // REQ-0042
    scenario: statMtimeMs(SCENARIO_PATH),
    registry: statMtimeMs(REGISTRY_PATH),
  };
  const stale = !contentCache ||
    mtimes.vocab !== contentCache.mtimes.vocab ||
    mtimes.items !== contentCache.mtimes.items ||
    mtimes.sis !== contentCache.mtimes.sis ||
    mtimes.tms !== contentCache.mtimes.tms || // REQ-0042
    mtimes.scenario !== contentCache.mtimes.scenario ||
    mtimes.registry !== contentCache.mtimes.registry;
  if (stale) {
    contentCache = { mtimes: mtimes, payload: buildContentPayload() };
  }
  return contentCache.payload;
}

// ---- HTTP helpers ----
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req, cb) {
  let chunks = [];
  let total = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      aborted = true;
      cb(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    cb(null, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', (err) => {
    if (aborted) return;
    cb(err);
  });
}

// REQ-0037: resolves the auth token from the X-Auth-Token header (case-
// insensitive per node:http's own header lowercasing).
function getAuthToken(req) {
  const raw = req.headers['x-auth-token'];
  return typeof raw === 'string' && raw ? raw : undefined;
}

// ---- routing ----
const PROFILE_CANVAS_RE = /^\/api\/profile\/([^/]+)\/canvas$/;
const ADMIN_ITEM_RE = /^\/api\/admin\/item\/([^/]+)$/;
const ADMIN_WAREHOUSE_GRANT_RE = /^\/api\/admin\/warehouse\/grant$/; // REQ-0041 feedback 1: dev grant

// REQ-0036 P1-B: Dungeon Schedule service routes.
const SCHEDULE_ROOMS_RE = /^\/api\/schedule\/rooms$/;
const SCHEDULE_ROOM_RE = /^\/api\/schedule\/rooms\/([^/]+)$/;
const SCHEDULE_ROOM_SLOT_RE = /^\/api\/schedule\/rooms\/([^/]+)\/slots\/([0-9]+)$/;
const SCHEDULE_ROOM_SWAP_RE = /^\/api\/schedule\/rooms\/([^/]+)\/swap$/;
const SCHEDULE_ROOM_RUN_RE = /^\/api\/schedule\/rooms\/([^/]+)\/run$/;
const SCHEDULE_ROOM_DEV_BACKDATE_RE = /^\/api\/schedule\/rooms\/([^/]+)\/dev\/backdate$/; // REQ-0036 P1-C: dev-only E2E time-control hook
const WAREHOUSE_RE = /^\/api\/warehouse$/;
const WAREHOUSE_CLAIM_RE = /^\/api\/warehouse\/claim$/;
const WAREHOUSE_DEV_BACKDATE_CLAIM_RE = /^\/api\/warehouse\/dev\/backdate-claim$/; // REQ-0041 E2E hook, dev-only

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, version: VERSION });
    return;
  }

  if (p === '/api/content' && req.method === 'GET') {
    try {
      const payload = getContent();
      sendJSON(res, 200, payload);
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'content read failed: ' + e.message });
    }
    return;
  }

  // REQ-0036 P1-C: GET /api/schedule/dungeons -- public read data (the
  // pilot batch's one dungeon def + its 4 formation defs), matching
  // /api/content's own no-auth convention. Deliberately special-cased
  // HERE, BEFORE the schedule auth gate further down (scheduleMatch's
  // resolveAuth() call) -- this route needs no caller identity at all
  // (unlike every other /api/schedule/* route, which always operates on
  // "the caller's own rooms/warehouse"), so forcing it through
  // resolveAuth() would require a token (or a dev_mode fallback) for no
  // reason. Read-only, no body.
  if (p === '/api/schedule/dungeons' && req.method === 'GET') {
    try {
      const payload = schedule.listDungeonsAndFormations();
      sendJSON(res, 200, { ok: true, dungeons: payload.dungeons, formations: payload.formations });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'dungeons read failed: ' + e.message });
    }
    return;
  }

  // REQ-0037: /api/me now resolves the caller via the X-Auth-Token
  // header (falling back to the dev player when dev_mode is true and no
  // token was sent at all). 401 for a present-but-unknown token, or an
  // absent token with dev_mode:false.
  if (p === '/api/me' && req.method === 'GET') {
    try {
      const resolved = admin.resolveAuth(getAuthToken(req));
      if (!resolved.ok) {
        sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
        return;
      }
      const player = resolved.player;
      sendJSON(res, 200, { playerId: player.playerId, name: player.name, roles: player.roles });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'me read failed: ' + e.message });
    }
    return;
  }

  const adminItemMatch = ADMIN_ITEM_RE.exec(p);
  if (adminItemMatch && req.method === 'PUT') {
    const itemId = decodeURIComponent(adminItemMatch[1]);
    const token = getAuthToken(req);
    if (!admin.isItemAdminToken(token)) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
      return;
    }
    readBody(req, (err, bodyStr) => {
      if (err) {
        if (err.code === 'TOO_LARGE') {
          sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
        } else {
          sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
        }
        return;
      }
      let body;
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      try {
        const merged = admin.applyAdminEdit(itemId, body);
        contentCache = null; // force a fresh read on the next /api/content (mtime already changed too)
        sendJSON(res, 200, { ok: true, id: itemId, item: merged });
      } catch (e) {
        const code = e.code === 'NOT_FOUND' ? 404 : 400;
        sendJSON(res, code, { ok: false, error: e.message });
      }
    });
    return;
  }
  if (adminItemMatch) {
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  // REQ-0041 feedback 1: POST /api/admin/warehouse/grant {itemId} -- dev
  // grant, gated EXACTLY like PUT /api/admin/item/:id above (same
  // admin.isItemAdminToken(token) guard, same 403 body shape/wording) --
  // mirrors that route's auth-gate style deliberately (per the task: "the
  // existing PUT /api/admin/item/:id route is presumably the sibling
  // pattern... find it and mirror its auth-gate style exactly"). Inserts
  // a warehouse row for the CALLER (the resolved item_admin themselves --
  // there is no "grant to a different player" concept here, matching
  // every other schedule/warehouse route's "always operates on the
  // caller's own data" convention), subject to the SAME cap/TTL rules
  // every other warehouse insertion goes through (schedule.cjs's
  // addToWarehouse, via grantWarehouseItem). Validates itemId against the
  // COMBINED item defs (schedule.getScheduleContent().itemDefsById, the
  // same map claimWarehouseItem/settleRun already trust) before inserting
  // -- 400 for an unknown id, never a silent insert of a dangling
  // reference.
  const adminWarehouseGrantMatch = ADMIN_WAREHOUSE_GRANT_RE.exec(p);
  if (adminWarehouseGrantMatch && req.method === 'POST') {
    const token = getAuthToken(req);
    if (!admin.isItemAdminToken(token)) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
      return;
    }
    readBody(req, (err, bodyStr) => {
      if (err) {
        if (err.code === 'TOO_LARGE') {
          sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
        } else {
          sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
        }
        return;
      }
      let body;
      try {
        body = JSON.parse(bodyStr);
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      if (typeof body.itemId !== 'string' || !body.itemId) {
        sendJSON(res, 400, { ok: false, error: 'itemId is required' });
        return;
      }
      try {
        const { itemDefsById } = schedule.getScheduleContent();
        if (!itemDefsById[body.itemId]) {
          sendJSON(res, 400, { ok: false, error: 'unknown item id "' + body.itemId + '"' });
          return;
        }
        // The caller's OWN playerId (resolved from the token, same as
        // every other authenticated route -- never trusts a client-
        // supplied id) is who the grant lands in the warehouse for.
        const resolved = admin.resolveAuth(token);
        const targetPlayerId = resolved.ok ? resolved.player.playerId : admin.readDevUser().playerId;
        const result = schedule.grantWarehouseItem(targetPlayerId, body.itemId);
        if (!result.ok) {
          sendJSON(res, 409, { ok: false, error: 'warehouse full' });
          return;
        }
        sendJSON(res, 200, { ok: true, item: result.item });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'grant failed: ' + e.message });
      }
    });
    return;
  }
  if (adminWarehouseGrantMatch) {
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  const m = PROFILE_CANVAS_RE.exec(p);
  if (m) {
    const urlPlayerId = m[1];
    const token = getAuthToken(req);
    const resolved = admin.resolveAuth(token);
    if (!resolved.ok) {
      sendJSON(res, 401, { ok: false, error: 'unauthorized: ' + resolved.reason });
      return;
    }
    const actualPlayer = resolved.player;
    // REQ-0037 compat alias: the literal URL segment "default" maps to
    // the dev player's OWN profile, but ONLY while dev_mode is true (see
    // docs/REQ/REQ-0037-guest-auth.md's "Compat alias" note). Outside of
    // that window "default" is just an unknown/mismatched id like any
    // other and falls through to the normal ownership check below.
    const devUser = admin.readDevUser();
    const isDefaultAlias = urlPlayerId === 'default' && devUser.dev_mode === true && actualPlayer.playerId === devUser.playerId;
    const effectivePlayerId = isDefaultAlias ? actualPlayer.playerId : urlPlayerId;

    if (!isDefaultAlias && effectivePlayerId !== actualPlayer.playerId) {
      sendJSON(res, 403, { ok: false, error: 'forbidden: token does not authorize profile "' + urlPlayerId + '"' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const doc = storage.readProfile(effectivePlayerId);
        if (!doc) {
          sendJSON(res, 404, { ok: false, error: 'no saved canvas for this profile' });
          return;
        }
        sendJSON(res, 200, doc);
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: 'read failed: ' + e.message });
      }
      return;
    }

    if (req.method === 'PUT') {
      readBody(req, (err, bodyStr) => {
        if (err) {
          if (err.code === 'TOO_LARGE') {
            sendJSON(res, 413, { ok: false, error: 'request body exceeds ' + MAX_BODY_BYTES + ' bytes' });
          } else {
            sendJSON(res, 400, { ok: false, error: 'body read failed: ' + err.message });
          }
          return;
        }
        let canvas;
        try {
          canvas = JSON.parse(bodyStr);
        } catch (e) {
          sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
          return;
        }
        try {
          const doc = storage.writeProfile(effectivePlayerId, canvas);
          // REQ-0041 two-phase claim: this is THE single writer for a
          // player's own profile again (see schedule.cjs's
          // claimWarehouseItem doc for bug #3's root cause) -- so THIS is
          // also the correct, single place to finalize any of the
          // caller's 'claiming' warehouse rows whose minted uid (reused
          // from the warehouse row's own itemUid, see that same doc)
          // just landed in the saved canvas. Best-effort: a failure here
          // must never fail the profile save itself (the save already
          // succeeded by this point) -- worst case a stale 'claiming' row
          // sits until its own lazy timeout reverts it, never a lost
          // profile write.
          try { schedule.finalizeClaimingItemsForCanvas(effectivePlayerId, canvas); } catch (e2) { /* best-effort, see comment above */ }
          sendJSON(res, 200, doc);
        } catch (e) {
          if (e.code === 'TOO_LARGE') {
            sendJSON(res, 413, { ok: false, error: e.message });
          } else {
            sendJSON(res, 500, { ok: false, error: 'write failed: ' + e.message });
          }
        }
      });
      return;
    }

    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

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
    p.match(WAREHOUSE_RE) || p.match(WAREHOUSE_CLAIM_RE) || p.match(WAREHOUSE_DEV_BACKDATE_CLAIM_RE);
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
        const clock = schedule.runClock(run);
        sendJSON(res, 200, {
          ok: true,
          runId: run.id,
          roomId: run.roomId,
          startedAt: run.startedAt,
          durationSecs: run.durationSecs,
          clock: { elapsedSecs: clock.elapsedSecs, isSettled: clock.isSettled, pct: clock.pct },
          events: schedule.visibleEvents(run),
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
          const { itemDefsById } = schedule.getScheduleContent();
          const result = schedule.claimWarehouseItem(callerId, body.itemUid, itemDefsById);
          sendJSON(res, 200, { ok: true, itemUid: result.itemUid, itemId: result.itemId });
        } catch (e) { sendScheduleError(e); }
      });
      return;
    }
  }

  sendJSON(res, 404, { ok: false, error: 'not found' });
}

// REQ-0036 P1-B: periodic warehouse TTL sweep (golden e: "expired items
// purge lazily on read + scheduled sweep"). Every warehouse read already
// purges lazily (schedule.cjs's purgeExpiredWarehouseItems, called by
// listWarehouse/claimWarehouseItem/addToWarehouse) -- this interval is
// the belt-and-suspenders half for players who simply never poll their
// warehouse (so expired rows don't sit on disk/in pg forever). Runs
// against every player currently registered (small-scale registry, same
// assumption server/players.cjs's own listPlayers() already makes).
// .unref() so this timer never keeps the process alive on its own (same
// convention as pg_sync.cjs's worker.unref()).
const WAREHOUSE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
function sweepAllWarehouses() {
  const players = require('./players.cjs');
  for (const player of players.listPlayers()) {
    try { schedule.purgeExpiredWarehouseItems(player.playerId); } catch (e) { /* best-effort */ }
  }
}

function main() {
  admin.ensureDevUser(); // REQ-0035: create data/config/dev_user.json with defaults if missing
  admin.ensureDevPlayer(); // REQ-0037: create/refresh data/players/dev.json, log the token once on first creation
  const sweepTimer = setInterval(sweepAllWarehouses, WAREHOUSE_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'internal error: ' + e.message });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log('backpack-api listening on http://' + HOST + ':' + PORT + ' (v' + VERSION + ')');
  });
}

if (require.main === module) {
  main();
}

module.exports = { handle, buildContentPayload, getContent, VERSION };
