#!/usr/bin/env node
// backpack_ragnarok — server/api.cjs
// REQ-0024: Node API service, node:http only (no framework deps).
// Listens on 127.0.0.1:8802. Endpoints:
//   GET  /api/health
//   GET  /api/content
//   GET  /api/profile/default/canvas
//   PUT  /api/profile/default/canvas
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('./storage.cjs');
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

// Builds the /api/content payload fresh from content/live + vocab.
// Shape mirrors mock-src/data.js (GameData): { items, sis, trees, scenario }.
// This is intentionally a straight, un-cached-at-source read of content/live —
// content/live is the single source of truth (per REQ-0024 architecture note).
function buildContentPayload() {
  const vocab = loadJSON(VOCAB_PATH);
  const items = loadJSON(ITEMS_PATH);
  const sis = loadJSON(SIS_PATH);
  const scenario = loadJSON(SCENARIO_PATH);

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];

  const ITEMS = {};
  for (const e of itemEntries) {
    ITEMS[e.id] = Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    });
  }
  const SIS = {};
  for (const e of siEntries) {
    SIS[e.id] = Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    });
  }
  const trees = { po: vocab.po_tags || {}, socket: vocab.socket_tags || {} };

  return {
    items: ITEMS,
    sis: SIS,
    trees: trees,
    scenario: scenario,
    layout: scenario.layout || null,
  };
}

function getContent() {
  const mtimes = {
    vocab: statMtimeMs(VOCAB_PATH),
    items: statMtimeMs(ITEMS_PATH),
    sis: statMtimeMs(SIS_PATH),
    scenario: statMtimeMs(SCENARIO_PATH),
  };
  const stale = !contentCache ||
    mtimes.vocab !== contentCache.mtimes.vocab ||
    mtimes.items !== contentCache.mtimes.items ||
    mtimes.sis !== contentCache.mtimes.sis ||
    mtimes.scenario !== contentCache.mtimes.scenario;
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

// ---- routing ----
const PROFILE_CANVAS_RE = /^\/api\/profile\/([^/]+)\/canvas$/;

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

  const m = PROFILE_CANVAS_RE.exec(p);
  if (m) {
    const profileId = m[1];
    if (!storage.isAllowedProfileId(profileId)) {
      sendJSON(res, 404, { ok: false, error: 'unknown profile id' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const doc = storage.readProfile(profileId);
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
          const doc = storage.writeProfile(profileId, canvas);
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
