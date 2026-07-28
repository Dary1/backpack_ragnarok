'use strict';
// bot/lib/client.cjs -- REQ-0330 the fleet's ONLY egress. A framework-free
// node:http/https JSON client that, for EVERY request:
//   1. passes the (method, path) through the compiled-in allowlist (lib/
//      allowlist.cjs) and THROWS before any socket opens if it is not allowed --
//      so the fleet physically cannot host, cancel, buy, or touch /api/admin or
//      /dev/; and
//   2. is paced by a shared rate limiter: >=400ms between any two outbound
//      requests, plus random jitter (spec: rate>=400ms, jittered).
// The X-Auth-Token is attached from the account's vault entry and is NEVER
// logged (only the method+path ever appear in a log line).
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { assertAllowed } = require('./allowlist.cjs');
const { config } = require('./config.cjs');

// A single process-wide gate: the WHOLE fleet (every account's client) respects
// the >=400ms floor between outbound requests, so the aggregate never hammers
// the API regardless of how many accounts are active. Serialized via a chained
// promise; the delay is rateMinMs + U[0, rateJitterMs].
function makeLimiter(minMs, jitterMs) {
  let chain = Promise.resolve();
  let lastAt = 0;
  return function gate() {
    chain = chain.then(async () => {
      const now = Date.now();
      const wait = minMs + Math.floor(Math.random() * (jitterMs + 1));
      const earliest = lastAt + wait;
      if (now < earliest) await new Promise((r) => setTimeout(r, earliest - now));
      lastAt = Date.now();
    });
    return chain;
  };
}
const sharedLimiter = makeLimiter(config.rateMinMs, config.rateJitterMs);

// httpJson: the raw node:http round-trip. An Idempotency-Key rides as a header
// (never in the JSON body). Resolves { status, body }.
function httpJson(apiBase, method, path, token, bodyObj, idemKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiBase);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const headers = { 'Accept': 'application/json' };
    if (token) headers['X-Auth-Token'] = token; // NEVER logged
    if (idemKey) headers['Idempotency-Key'] = idemKey;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = mod.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = { raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout ' + method + ' ' + url.pathname)); });
    if (payload) req.write(payload);
    req.end();
  });
}

// makeClient({ apiBase, token, name, playerId, limiter }) -> a per-account
// client. request() enforces the allowlist + rate gate; get/post are sugar.
function makeClient(opts) {
  const apiBase = opts.apiBase || config.apiBase;
  const token = opts.token;
  const limiter = opts.limiter || sharedLimiter;
  const timeoutMs = opts.requestTimeoutMs || config.requestTimeoutMs;

  async function request(method, path, bodyObj, idemKey) {
    assertAllowed(method, path); // THROWS (never opens a socket) if not allowed
    await limiter();
    return httpJson(apiBase, method, path, token, bodyObj, idemKey, timeoutMs);
  }
  return {
    playerId: opts.playerId || null,
    name: opts.name || null,
    request,
    get: (path) => request('GET', path, null, null),
    post: (path, body, idemKey) => request('POST', path, body, idemKey),
  };
}

module.exports = { makeClient, makeLimiter, sharedLimiter, httpJson };
