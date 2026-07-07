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

const PORT   = Number(process.env.E2E_PROXY_PORT  || 8803);
const STATIC = Number(process.env.E2E_STATIC_PORT || 8801);
const API    = Number(process.env.E2E_API_PORT    || 8802);
const HOST   = '127.0.0.1';

const server = http.createServer((creq, cres) => {
  const port = creq.url.startsWith('/api/') || creq.url === '/api' ? API : STATIC;
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
