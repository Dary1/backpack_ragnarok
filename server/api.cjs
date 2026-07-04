#!/usr/bin/env node
// backpack_ragnarok — server/api.cjs
// REQ-0024: Node API service, node:http only (no framework deps).
// Listens on 127.0.0.1:8802. Endpoints:
//   GET  /api/health
//   GET  /api/content
//   GET  /api/me
//   PUT  /api/admin/item/:id
//   GET  /api/profile/:playerId/canvas
//   PUT  /api/profile/:playerId/canvas
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
  const scenario = loadJSON(SCENARIO_PATH);
  // REQ-0035: batch-level provenance for the Dex's "provenance" section.
  // Optional -- an absent/unreadable registry.json degrades to `null`,
  // never a 500 (this file is metadata, not required for the board to
  // function).
  let registry = null;
  try { registry = loadJSON(REGISTRY_PATH); } catch (e) { registry = null; }

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];

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
    scenario: statMtimeMs(SCENARIO_PATH),
    registry: statMtimeMs(REGISTRY_PATH),
  };
  const stale = !contentCache ||
    mtimes.vocab !== contentCache.mtimes.vocab ||
    mtimes.items !== contentCache.mtimes.items ||
    mtimes.sis !== contentCache.mtimes.sis ||
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

  sendJSON(res, 404, { ok: false, error: 'not found' });
}

function main() {
  admin.ensureDevUser(); // REQ-0035: create data/config/dev_user.json with defaults if missing
  admin.ensureDevPlayer(); // REQ-0037: create/refresh data/players/dev.json, log the token once on first creation
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
