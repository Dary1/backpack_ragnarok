'use strict';
// server/lib/meta.cjs -- REQ-0047 (c): service identity constants.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8802; // REQ-0083: env-overridable for the per-worker e2e API fleet
const VERSION = '0.1.0';

// REQ-0377 item 2: the BUILD identity a bug report can name.
//
// SERVED, NOT BUILT IN. The REQ brief asked for a Vite `define` baking the
// short sha into the client bundle; that is precisely the coupling REQ-0341
// exists to remove (web/app is a TRACKED artifact -- letting its bytes vary
// with an untracked input shipped dead sign-in TWICE, REQ-0266/REQ-0337) and
// that REQ-0344 restates as a standing rule in routes/public.cjs. It would
// also falsify tools/release.sh's receipt re-issue premise, which is written
// down as "since REQ-0341 the bundle is a pure function of client/src".
// So the sha is resolved HERE, in the process, and handed out by /api/health.
// The main checkout @ master IS live (it serves both web/app and this API
// from one tree), so this process's HEAD is the identity of what is served.
//
// Resolved ONCE at load, never on a request, and it can never throw: any
// failure (no git on PATH, a tarball deploy, a detached/empty repo) degrades
// to 'unknown', which is still a truthful answer to "which build?".
function resolveBuildSha() {
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: require('node:path').join(__dirname, '..', '..'),
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = String(out).trim();
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : 'unknown';
  } catch (e) {
    return 'unknown';
  }
}
const BUILD_SHA = resolveBuildSha();

module.exports = { HOST, PORT, VERSION, BUILD_SHA };
