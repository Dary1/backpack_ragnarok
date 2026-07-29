// client/e2e/local-proxy.cjs -- REQ-0080.
//
// Dependency-free reverse proxy that reproduces the Cloudflare tunnel's
// ingress split LOCALLY so the E2E run can load the app from localhost
// instead of the public tunnel (~42ms -> ~1ms per request; see REQ-0080 §1).
//
// Ingress rule mirrored (server/README.md "Cloudflare tunnel ingress"):
//   /api/*  -> per-worker fleet api (X-E2E-Worker header; no header -> w0)
//   /app/*  -> THIS worktree's built client (web/app)
//   others  -> 404 (REQ-0217 hermetic: nothing falls through to live services)
//
// The app's client/src/api.ts does RELATIVE fetches (fetch('/api/content')),
// which only resolve when the page's own origin applies that same split --
// exactly what this proxy provides. Specs navigate with relative paths only
// (.goto('/app/...')), so nothing spec-side changes.
'use strict';
const http = require('node:http');
const fs = require("node:fs");
const path = require("node:path");
// REQ-0051: serve THIS worktree client build for /app (the e2e static
// service otherwise serves the DEPLOYED master bundle, which lacks any
// worktree client change -- e.g. the starter-unit fresh-profile seed).
const WEB_APP = path.join(__dirname, "..", "..", "web", "app");
// REQ-0217: /preview/* (static dungeon previews, web/preview) is also served
// from THIS worktree -- schedule.spec.ts asserts the batch-002 preview page.
const WEB_PREVIEW = path.join(__dirname, "..", "..", "web", "preview");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
function servePreviewStatic(creq, cres) {
  let rel = creq.url.replace(/^\/preview/, "").split("?")[0];
  if (rel === "" || rel === "/") rel = "/index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = path.join(WEB_PREVIEW, decodeURIComponent(rel));
  if (!filePath.startsWith(WEB_PREVIEW)) { cres.writeHead(403); cres.end("forbidden"); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { cres.writeHead(404); cres.end("not found"); return; }
    const ct = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    cres.writeHead(200, { "content-type": ct }); cres.end(buf);
  });
}

// REQ-0281: e2e is HERMETIC and must never depend on an external subresource.
// The SPA index.html <head> pulls Google Fonts from fonts.googleapis.com /
// fonts.gstatic.com via a <link rel="stylesheet"> whose fetch the page LOAD
// event waits on. On the hermetic box that fetch is outside the harness control:
// when it is slow or unreachable, `load` stalls past navigationTimeout while the
// page itself is fully rendered (the font stacks degrade to system fonts) -- the
// goto-under-load flake that red-flagged REQ-0266/0273/0278/0279 (artadmin.spec
// :124/:273, "page.goto: Timeout ... waiting until load"). This static server is
// the single chokepoint serving /app for EVERY e2e path (fleet + admin
// harnesses), so it strips the external font <link>s from index.html here: no
// external request is ever made, `load` fires on same-origin resources only, and
// production (served through the real ingress, not this proxy) is untouched.
const EXTERNAL_FONT_LINK_RE = /[ \t]*<link\b[^>]*fonts\.g(?:oogleapis|static)\.com[^>]*>\s*/gi;
function neutralizeExternalFonts(buf) {
  return Buffer.from(String(buf).replace(EXTERNAL_FONT_LINK_RE, ""), "utf8");
}
function serveAppStatic(creq, cres) {
  let rel = creq.url.replace(/^\/app/, "").split("?")[0];
  if (rel === "" || rel === "/") rel = "/index.html";
  const filePath = path.join(WEB_APP, decodeURIComponent(rel));
  if (!filePath.startsWith(WEB_APP)) { cres.writeHead(403); cres.end("forbidden"); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      if (!path.extname(rel)) {
        fs.readFile(path.join(WEB_APP, "index.html"), (e2, html) => {
          if (e2) { cres.writeHead(404); cres.end("not found"); return; }
          cres.writeHead(200, { "content-type": "text/html; charset=utf-8" }); cres.end(neutralizeExternalFonts(html));
        });
        return;
      }
      cres.writeHead(404); cres.end("not found"); return;
    }
    const ct = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const body = ct.startsWith("text/html") ? neutralizeExternalFonts(buf) : buf;
    cres.writeHead(200, { "content-type": ct }); cres.end(body);
  });
}

const PORT   = Number(process.env.E2E_PROXY_PORT  || 8803);
const FLEET_BASE = Number(process.env.E2E_FLEET_BASE_PORT || 8810);
const HOST   = '127.0.0.1';

// REQ-0083: in parallel mode each Playwright worker tags its requests with
// X-E2E-Worker:<index>; route that /api traffic to the worker's own isolated
// API instance (FLEET_BASE+index). No header -> fleet worker 0 (REQ-0217
// hermetic: the live api on :8802 is NEVER a route).
function apiPortFor(headers) {
  const w = headers['x-e2e-worker'];
  if (w !== undefined && w !== '') {
    const i = Number(w);
    if (Number.isInteger(i) && i >= 0) return FLEET_BASE + i;
  }
  return FLEET_BASE; // REQ-0217: headerless /api -> worker 0, never :8802
}

// --------------------------------------------------------------------------
// REQ-0347: socket-hang-up forensics.
//
// tools/release.sh on master (2026-07-29) died at schedule.spec.ts:1206 with
// `apiRequestContext.delete: socket hang up` on
// DELETE /api/schedule/rooms/... (X-E2E-Worker: 1), test #174 of 209 -- not at
// teardown, and GREEN on an immediate re-run of the identical tree. The api
// worker logs held only their startup lines, there was no OOM and 12 G free,
// so nothing in the archive said WHO closed that socket. This block exists so
// the SECOND occurrence answers that question instead of starting over. It is
// pure observation: no routing, timing or lifecycle behaviour changes.
//
// What a hang-up can be, and which line below names it:
//   - the worker api closed/reset the upstream socket   -> UPSTREAM-ERROR
//     (this was already handled, but the message went into the 502 body only
//     and never to a log -- and a 502 body is not what Playwright reported,
//     which is itself evidence this path did NOT fire)
//   - the api accepted then dropped mid-response        -> UPSTREAM-ABORTED
//   - THIS proxy destroyed the client socket            -> CLIENT-ERROR
//     (server.on('clientError') used to sock.destroy() in total silence --
//     the single most likely way to produce a bare hang-up with no trace)
//   - the client socket died before we answered         -> DOWNSTREAM-CLOSED
//   - a pooled keep-alive socket died between requests  -> SOCKET-ERROR-CLOSE,
//     with the number of requests it had already served and its age. This was
//     the first hypothesis (node's server closes an idle keep-alive connection
//     at the instant the client reuses it) and REQ-0347b RULED IT OUT by
//     experiment -- 836 trials straddling the boundary, including 600 under
//     4-way parallelism on a loaded box, zero hang-ups. The line stays because
//     the mechanism is still the one that would produce this symptom silently;
//     it is now evidence AGAINST that reading rather than for it.
//
// And if a future hang-up leaves NO line here at all, that is a finding too:
// the socket then died between Playwright and this proxy without ever
// reaching a request parse, which narrows it to the box/loopback rather than
// to either service.
//
// Every anomaly goes to stderr AND to a per-run file beside the fleet's own
// archived worker logs (tools/e2e_fleet.cjs writes ROOT_logs_last/), so it
// survives teardown the same way and is scoped to one run -- REQ-0234 (F4)'s
// lesson that a global log path lets run B eat run A's forensics. The stderr
// copy is not redundant: under tools/e2e_harness.sh this whole process is
// already redirected into that harness's own <log>_proxy.log (a DIFFERENT
// file -- hence the distinct name below), and under playwright's webServer it
// is piped into the run report right next to the failing test.
const ANOMALY_LOG = (process.env.E2E_FLEET_ROOT || '/tmp/bp_e2e_workers') + '_proxy_anomalies.log';
/** In-flight /api requests, so an anomaly can report what else the box was
 * doing at that moment -- the REQ's second explicit ask. */
const inflight = new Map();
let seq = 0;

function note(what, detail, fileOnly = false) {
  const others = [...inflight.values()]
    .map((r) => `${r.method} ${r.url} w${r.worker} ${Date.now() - r.startedAt}ms`)
    .join(' | ');
  const line = `[e2e local-proxy][REQ-0347] ${new Date().toISOString()} ${what} ${detail}`
    + ` inflight=${inflight.size}${others ? ' [' + others + ']' : ''}`;
  // REQ-0347b: anomalies go to BOTH -- stderr puts them in the run report next
  // to the failing test. The routine connection census goes to the file ONLY
  // (~1200 lines a run), so it can be on by default without drowning the report
  // that the anomalies are meant to stand out in. E2E_PROXY_TRACE=1 also
  // mirrors the census to stderr for an interactive investigation.
  if (!fileOnly || process.env.E2E_PROXY_TRACE) console.error(line);
  try { fs.appendFileSync(ANOMALY_LOG, line + '\n'); } catch { /* forensics are best-effort */ }
}

// REQ-0347b: hop-by-hop headers must NOT cross a proxy (RFC 9110 s7.6.1 /
// RFC 7230 s6.1). This proxy copied BOTH directions verbatim -- `{...creq.headers}`
// upstream, and `pres.headers` straight into cres.writeHead() -- so the worker
// api's own connection terms were handed to playwright as if they were this
// proxy's. Measured, and the CAPITALISATION is the tell:
//
//   before -> connection: keep-alive   keep-alive: timeout=5
//             (lowercase: node lowercases parsed headers, so those are the
//              upstream api's own bytes, copied straight through)
//   after  -> Connection: keep-alive   Keep-Alive: timeout=5
//             (node's own emission, describing THIS hop -- which is what a
//              client is entitled to be told)
//
// HONEST SCOPE, so the record stays true:
//  * a conformance defect found while investigating REQ-0347b. NOT claimed as
//    the cause of that hang-up.
//  * it does NOT remove the "both ends expire at 5000ms" coincidence. After
//    the fix the client is still told timeout=5 -- but now truthfully, by the
//    proxy about the proxy, because node advertises exactly the
//    keepAliveTimeout it enforces with no safety offset. That is node's
//    behaviour everywhere, not something this file invented.
//  * and node's http CLIENT never parses `Keep-Alive: timeout=` at all (its
//    free-socket budget comes from its agent's own options), so for playwright
//    specifically this almost certainly changed no behaviour whatsoever.
// It is fixed because forwarding another hop's connection terms is wrong.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/** A copy of `headers` with every hop-by-hop field removed -- the fixed set
 * above plus whatever the sender listed in its own `Connection` header, which
 * is the extension mechanism the RFC defines. Framing is deliberately included:
 * node's parser has already decoded the body by the time it reaches us, so the
 * outgoing hop must re-frame it (which node does on its own) rather than
 * inherit the incoming hop's `transfer-encoding`. */
function stripHopByHop(headers) {
  const drop = new Set(HOP_BY_HOP);
  const conn = headers.connection || headers.Connection;
  if (typeof conn === 'string') for (const t of conn.split(',')) drop.add(t.trim().toLowerCase());
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (!drop.has(k.toLowerCase())) out[k] = v;
  return out;
}

const server = http.createServer((creq, cres) => {
  const isApi = creq.url.startsWith('/api/') || creq.url === '/api';
  if (!isApi && (creq.url === "/app" || creq.url.startsWith("/app/"))) { serveAppStatic(creq, cres); return; } // REQ-0051
  if (!isApi && (creq.url === "/preview" || creq.url.startsWith("/preview/"))) { servePreviewStatic(creq, cres); return; } // REQ-0217
  // REQ-0217 hermetic e2e: nothing may fall through to the live services.
  if (!isApi) { cres.writeHead(404, { "content-type": "text/plain" }); cres.end("[e2e local-proxy] hermetic run: only /app/* (worktree static) and /api/* (fleet) exist"); return; }
  const port = apiPortFor(creq.headers);
  // REQ-0347: this request's identity, for every anomaly line below.
  const id = ++seq;
  const rec = { method: creq.method, url: creq.url, worker: creq.headers['x-e2e-worker'] ?? '-', port, startedAt: Date.now() };
  inflight.set(id, rec);
  if (creq.socket) creq.socket[REQ_COUNT] = (creq.socket[REQ_COUNT] || 0) + 1;
  const where = () => `${rec.method} ${rec.url} w${rec.worker} -> :${port} after ${Date.now() - rec.startedAt}ms`;
  let settled = false;
  let upstreamAnswered = false;
  const settle = () => { if (!settled) { settled = true; inflight.delete(id); } };
  cres.on('finish', settle);
  cres.on('close', () => {
    // 'close' without 'finish' = the response never completed. If the upstream
    // never answered either, THIS is the shape Playwright reports as a socket
    // hang up.
    if (!settled) { note('DOWNSTREAM-CLOSED', `${where()} upstreamAnswered=${upstreamAnswered} headersSent=${cres.headersSent}`); settle(); }
  });
  const preq = http.request(
    { host: HOST, port, method: creq.method, path: creq.url,
      // REQ-0347b: the client's connection terms are for the client's hop only.
      headers: { ...stripHopByHop(creq.headers), host: `${HOST}:${port}` } },
    (pres) => {
      upstreamAnswered = true;
      cres.writeHead(pres.statusCode || 502, stripHopByHop(pres.headers)); // REQ-0347b
      pres.pipe(cres);
      // REQ-0347: the api answered and then dropped the body mid-flight.
      pres.on('aborted', () => note('UPSTREAM-ABORTED', `${where()} status=${pres.statusCode}`));
    },
  );
  preq.on('error', (e) => {
    // REQ-0347: this path always DID answer (502 + message), so a run that
    // reported a bare hang-up did not come through here -- but until now that
    // was unprovable, because the message went to the client and nowhere else.
    note('UPSTREAM-ERROR', `${where()} ${e.code || ''} ${e.message}`);
    if (!cres.headersSent) cres.writeHead(502, { 'content-type': 'text/plain' });
    cres.end(`[e2e local-proxy] upstream error on :${port} -> ${e.message}`);
  });
  creq.pipe(preq);
});

// REQ-0347: per-socket bookkeeping. A keep-alive socket that dies between
// requests is the classic one-off hang-up, and the tell is how many requests
// it had already served and how old it was -- so both are carried on the
// socket itself and reported when it closes with an error.
const REQ_COUNT = Symbol('req0347.requests');
const OPENED_AT = Symbol('req0347.openedAt');
const PORTS = Symbol('req0347.ports');
server.on('connection', (sock) => {
  sock[OPENED_AT] = Date.now();
  sock[REQ_COUNT] = 0;
  // REQ-0347b: read the ports NOW. By the time 'close' fires the socket has
  // released them and both report `undefined` -- observed across 150 traced
  // runs of the failing spec, which is exactly the field an incident would
  // need to line this socket up against anything else on the box.
  sock[PORTS] = `local=${sock.localPort} remote=${sock.remotePort}`;
  sock.on('close', (hadError) => {
    // REQ-0347b: the census is written for EVERY connection, always -- how many
    // requests it served, how long it lived, which ports. At ~1200 lines a run
    // (file only, see note()) that is free, and it is the difference between
    // the next occurrence being diagnosable from the artifacts it already left
    // and being a reproduction problem. §7 of the REQ puts the natural rate at
    // ~1 per 100 full gates: nobody is going to have remembered to set a flag.
    // An ERRORED close is an anomaly and is named as one, so it still reaches
    // stderr and the run report.
    note(hadError ? 'SOCKET-ERROR-CLOSE' : 'SOCKET-CLOSE',
      `served=${sock[REQ_COUNT]} age=${Date.now() - sock[OPENED_AT]}ms ${sock[PORTS]}`,
      !hadError);
  });
});

server.on('clientError', (e, sock) => {
  // REQ-0347: this used to destroy the socket in complete silence, which is
  // indistinguishable from the reported failure. Name it before destroying.
  note('CLIENT-ERROR', `${e.code || ''} ${e.message} served=${sock[REQ_COUNT] || 0} bytesRead=${sock.bytesRead} ${sock[PORTS] || 'local=? remote=?'}`);
  try { sock.destroy(); } catch {}
});

// REQ-0347b: an experiment knob, unset in every real run (node's 5000ms
// default then stands, unchanged). Setting it shrinks the keep-alive boundary
// so the "server closes an idle pooled socket at the instant the client reuses
// it" race is crossed hundreds of times a minute instead of once per idle gap
// -- which is how that hypothesis was tested and RULED OUT (836 straddling
// trials, 0 hang-ups; see docs/REQ/.../REQ-0347b). Kept because the next
// investigator should be able to re-run that experiment in one command rather
// than re-deriving it, and because a knob that is read only when explicitly
// set cannot change a normal run.
if (process.env.E2E_PROXY_KEEPALIVE_MS) {
  server.keepAliveTimeout = Number(process.env.E2E_PROXY_KEEPALIVE_MS);
  // node requires headersTimeout > keepAliveTimeout to stay meaningful.
  server.headersTimeout = server.keepAliveTimeout + 60000;
}
server.listen(PORT, HOST, () => {
  // REQ-0347: the timeouts are in the banner because the keep-alive race
  // hypothesis is only testable against the values that were actually in
  // force, and node has changed these defaults between majors.
  const banner = `[e2e local-proxy] http://${HOST}:${PORT}  (/api -> fleet :${FLEET_BASE}+w, /app -> worktree static, else 404)`
    + ` [REQ-0347 keepAliveTimeout=${server.keepAliveTimeout}ms headersTimeout=${server.headersTimeout}ms`
    + ` requestTimeout=${server.requestTimeout}ms upstreamKeepAlive=${http.globalAgent.keepAlive} node=${process.version}`
    + ` log=${ANOMALY_LOG}]`;
  console.log(banner);
  // Truncate per run, then record the configuration this run ran under: an
  // empty-but-for-the-banner file is the positive statement "this proxy saw
  // nothing abnormal", which is exactly what the first occurrence lacked.
  try { fs.writeFileSync(ANOMALY_LOG, banner + '\n'); } catch { /* best-effort */ }
});
