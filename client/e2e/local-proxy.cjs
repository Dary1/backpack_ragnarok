// client/e2e/local-proxy.cjs -- REQ-0080.
//
// Dependency-free reverse proxy that reproduces the Cloudflare tunnel's
// ingress split LOCALLY so the E2E run can load the app from localhost
// instead of the public tunnel (~42ms -> ~1ms per request; see REQ-0080 §1).
//
// Ingress rule mirrored (server/README.md "Cloudflare tunnel ingress"):
//   /api/*  -> backpack-api.service  (127.0.0.1:8802)
//   *       -> backpack-web.service  (127.0.0.1:8801, static /app)
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
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
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
          cres.writeHead(200, { "content-type": "text/html; charset=utf-8" }); cres.end(html);
        });
        return;
      }
      cres.writeHead(404); cres.end("not found"); return;
    }
    const ct = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    cres.writeHead(200, { "content-type": ct }); cres.end(buf);
  });
}

const PORT   = Number(process.env.E2E_PROXY_PORT  || 8803);
const STATIC = Number(process.env.E2E_STATIC_PORT || 8801);
const API    = Number(process.env.E2E_API_PORT    || 8802);
const FLEET_BASE = Number(process.env.E2E_FLEET_BASE_PORT || 8810);
const HOST   = '127.0.0.1';

// REQ-0083: in parallel mode each Playwright worker tags its requests with
// X-E2E-Worker:<index>; route that /api traffic to the worker's own isolated
// API instance (FLEET_BASE+index). No header -> the default single API (:8802),
// preserving REQ-0080 single-worker behavior.
function apiPortFor(headers) {
  const w = headers['x-e2e-worker'];
  if (w !== undefined && w !== '') {
    const i = Number(w);
    if (Number.isInteger(i) && i >= 0) return FLEET_BASE + i;
  }
  return API;
}

const server = http.createServer((creq, cres) => {
  const isApi = creq.url.startsWith('/api/') || creq.url === '/api';
  if (!isApi && (creq.url === "/app" || creq.url.startsWith("/app/"))) { serveAppStatic(creq, cres); return; } // REQ-0051
  const port = isApi ? apiPortFor(creq.headers) : STATIC;
  const preq = http.request(
    { host: HOST, port, method: creq.method, path: creq.url,
      headers: { ...creq.headers, host: `${HOST}:${port}` } },
    (pres) => { cres.writeHead(pres.statusCode || 502, pres.headers); pres.pipe(cres); },
  );
  preq.on('error', (e) => {
    if (!cres.headersSent) cres.writeHead(502, { 'content-type': 'text/plain' });
    cres.end(`[e2e local-proxy] upstream error on :${port} -> ${e.message}`);
  });
  creq.pipe(preq);
});

server.on('clientError', (_e, sock) => { try { sock.destroy(); } catch {} });
server.listen(PORT, HOST, () =>
  console.log(`[e2e local-proxy] http://${HOST}:${PORT}  (/api -> :${API}, * -> :${STATIC})`));
