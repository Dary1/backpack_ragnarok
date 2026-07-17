// client/e2e/static-server.cjs -- REQ-0222: harness static-docroot server.
//
// Replaces `python3 -m http.server` in the admin e2e harnesses
// (tools/artadmin_e2e.sh, tools/art_inspect_e2e.sh, tools/content_admin_e2e.sh).
// Node event-loop server (same dependency-free pattern as e2e/local-proxy.cjs,
// REQ-0080/0051) with HTTP keep-alive: no per-request thread scheduling to
// starve when the box runs the owner's GPU/art workload beside CI (the
// REQ-0191 measured goto-under-load family). Serves files only -- no
// directory listings, no CGI, 127.0.0.1 only.
//
//   E2E_STATIC_PORT=<port> E2E_STATIC_ROOT=<docroot> node e2e/static-server.cjs
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.E2E_STATIC_PORT || process.argv[2]);
const ROOT = path.resolve(
  process.env.E2E_STATIC_ROOT || process.argv[3] || path.join(__dirname, '..', '..', 'web'));
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error('[e2e static] E2E_STATIC_PORT (or argv[2]) required');
  process.exit(64);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); res.end('bad request'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) {
      res.writeHead(301, { location: rel + '/' }); res.end(); return;
    }
    fs.readFile(filePath, (err2, buf) => {
      if (err2) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      res.end(buf);
    });
  });
});
server.on('clientError', (_e, sock) => { try { sock.destroy(); } catch {} });
server.listen(PORT, '127.0.0.1', () =>
  console.log(`[e2e static] http://127.0.0.1:${PORT} -> ${ROOT}`));
