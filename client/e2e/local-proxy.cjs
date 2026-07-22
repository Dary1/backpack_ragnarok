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

const server = http.createServer((creq, cres) => {
  const isApi = creq.url.startsWith('/api/') || creq.url === '/api';
  if (!isApi && (creq.url === "/app" || creq.url.startsWith("/app/"))) { serveAppStatic(creq, cres); return; } // REQ-0051
  if (!isApi && (creq.url === "/preview" || creq.url.startsWith("/preview/"))) { servePreviewStatic(creq, cres); return; } // REQ-0217
  // REQ-0217 hermetic e2e: nothing may fall through to the live services.
  if (!isApi) { cres.writeHead(404, { "content-type": "text/plain" }); cres.end("[e2e local-proxy] hermetic run: only /app/* (worktree static) and /api/* (fleet) exist"); return; }
  const port = apiPortFor(creq.headers);
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
  console.log(`[e2e local-proxy] http://${HOST}:${PORT}  (/api -> fleet :${FLEET_BASE}+w, /app -> worktree static, else 404)`));
