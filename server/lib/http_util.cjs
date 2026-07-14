'use strict';
// server/lib/http_util.cjs -- REQ-0047 (c): HTTP plumbing shared by every
// route module (JSON/text senders, capped body reader, auth-token header
// accessor). Moved VERBATIM from server/api.cjs.
const storage = require('../storage.cjs');
const MAX_BODY_BYTES = storage.MAX_BODY_BYTES;

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// REQ-0045 (g): plain-text response helper, same header discipline as
// sendJSON above (Content-Length + CORS) but text/plain instead of
// application/json -- used only by GET .../run?format=text below.
function sendText(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// REQ-0045 (g): server-side mirror of client/src/schedule/Monitor.tsx's
// humanizeEvent() -- same one-line-per-event vocabulary (t, type, actor,
// cells, dmg, status per the task brief), kept as an intentional CJS
// port rather than a shared module (the client copy is TypeScript/React-
// facing and reads run.events straight off already-fetched state; this
// one is a plain string formatter over the same ApiRunEvent wire shape,
// with no other shared dependency worth introducing a cross-runtime
// module boundary for). Falls back to a generic line for any event
// shape not explicitly covered, matching the client copy's own
// graceful-degradation behavior.

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


// REQ-0118c: resolves a Supabase access token from the Authorization
// header (`Authorization: Bearer <jwt>`). Scheme match is case-insensitive;
// node:http lowercases the header name. Returns undefined when absent or
// malformed.
function getBearerToken(req) {
  const raw = req.headers['authorization'];
  if (typeof raw !== 'string') return undefined;
  const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(raw);
  return m ? m[1] : undefined;
}

module.exports = { sendJSON, sendText, readBody, getAuthToken, getBearerToken, MAX_BODY_BYTES };
