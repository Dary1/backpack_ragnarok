#!/usr/bin/env node
'use strict';
// tools/check_e2e_ports.cjs -- REQ-0323 (supersedes REQ-0172/0251/0321/0322).
//
// WHAT THIS GATE NOW CHECKS, AND WHY IT CHANGED.
//
// It used to verify "is this port DERIVED from its REQ number". Nothing derives
// any more (REQ-0323: ports are leased at run time from a pool), so that check
// is deleted along with the rule it enforced. The job becomes simpler and
// strictly harder to evade:
//
//   R1. NO LITERAL PORT INSIDE THE POOL RANGE, anywhere in the watched files.
//       The check is on the NUMBER, not on the variable name. That is what
//       makes REQ-0322 moot BY CONSTRUCTION: the old pattern was
//       `\b[A-Z_]*PORT[A-Z_]*\s*=\s*(\d+)`, which cannot match
//       `E2E_PROXY_PORT=` (that spelling has a non-`[A-Z_]` boundary problem)
//       -- the exact spelling harnesses actually write. A number has no
//       spelling to get wrong.
//   R2. NO host:port LITERAL AT ALL (127.0.0.1:N / localhost:N), except the
//       permanent shared services PROJECT.md pins. R1 alone would not catch a
//       stale out-of-pool literal like `|| 'http://127.0.0.1:6562'`, which is
//       precisely the rot REQ-0251 found in all three admin configs; keeping R2
//       preserves that coverage.
//   R3. Every declared Playwright config takes its baseURL from
//       PLAYWRIGHT_BASE_URL with NO literal fallback, and fails loudly when it
//       is absent (REQ-0323 sec.3). A leased port cannot be written down ahead
//       of time, so a "default" port is now always a lie.
//   R4. A config that pins a host:port but is not declared here is invisible to
//       R3 -- fail until it is declared. (Kept from REQ-0251: that is how
//       8903/8913/8923 survived REQ-0172.)
//   R5. No call site passes an argument to e2e_ports.sh. Passing a REQ number
//       is a runtime error (exit 64); this catches it a whole CI cycle earlier.
//
// AND IT PROVES THAT IT DETECTS. `--self-test` runs every defect shape above
// through the same scanner and fails if any goes uncaught -- plus a set of
// LEGAL shapes that must NOT be flagged. REQ-0322 existed because a detector
// was never proved to detect; a gate that is not itself tested is a rumour.
//
// The pool bounds are READ FROM tools/e2e_port_lease.py, not copied. REQ-0321's
// failure was a gate and a rule that agreed with each other and with nothing
// else; a copied constant is exactly how that happens.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- pool ------
let POOL;
try {
  POOL = JSON.parse(execFileSync('python3', [path.join(__dirname, 'e2e_port_lease.py'), 'pool'],
    { encoding: 'utf8' }));
} catch (e) {
  console.error('FAIL cannot read the pool constants from tools/e2e_port_lease.py -- ' +
    'this gate refuses to guess them (REQ-0321: a gate that carries its own copy of the ' +
    'rule drifts from it silently).\n       ' + String(e.message || e).split('\n')[0]);
  process.exit(1);
}
const POOL_START = POOL.pool_start;
const POOL_END = POOL.pool_end;

// Ports that are shared + permanent and NOT leased (PROJECT.md): backpack-web,
// backpack-api, the e2e local proxy, and the REQ-0083 fleet's legacy decade.
const SHARED_OK = new Set([8801, 8802, 8803]);
const LEGACY_FLEET_BASE = 8810;
const LEGACY_FLEET_SLOTS = 10;
const sharedOk = (p) => SHARED_OK.has(p) ||
  (p >= LEGACY_FLEET_BASE && p < LEGACY_FLEET_BASE + LEGACY_FLEET_SLOTS);

// ------------------------------------------------------------- watched ------
// Everything that stands up, proxies to, or configures an e2e service. The two
// files that DEFINE the pool are excluded by construction -- they are the one
// place a pool number is allowed to appear.
const CONFIG_DIR = 'client/e2e';
const HARNESSES = [
  'tools/art_inspect_e2e.sh',
  'tools/artadmin_e2e.sh',
  'tools/content_admin_e2e.sh',
  'tools/registry_first_e2e.sh',
];
const CONFIGS = [
  'client/e2e/artinspect.config.ts',
  'client/e2e/artadmin.config.ts',
  'client/e2e/contentadmin.config.ts',
  'client/e2e/registry.config.ts',
];
const EXEMPT = new Set(['tools/e2e_ports.sh', 'tools/e2e_port_lease.py']);

function watchedFiles() {
  const out = [...HARNESSES, 'tools/e2e_harness.sh', 'tools/ci.sh', 'tools/e2e_run.sh',
    'tools/e2e_fleet.cjs', 'client/playwright.config.ts'];
  const dir = path.join(ROOT, CONFIG_DIR);
  if (fs.existsSync(dir)) {
    for (const n of fs.readdirSync(dir)) {
      const rel = `${CONFIG_DIR}/${n}`;
      if (/\.(ts|cjs|mjs|js)$/.test(n) && !EXEMPT.has(rel)) out.push(rel);
    }
  }
  return out.filter((f) => !EXEMPT.has(f));
}

// ------------------------------------------------------------- scanner ------
// Strip comments so PROSE may still cite a number (REQ-0251 allowed that, and
// this REQ's own files have to describe the pool), while CODE may not.
function stripComments(rel, line) {
  if (/\.(sh|py)$/.test(rel)) return line.replace(/(^|\s)#.*$/, '$1');
  // NOT /\/\/.*$/ -- that eats the rest of any line containing a URL scheme
  // ('http://127.0.0.1:9012' -> 'http:'), which silently blinded this gate to
  // the single most likely place a hardcoded endpoint appears. The self-test
  // caught it; that is what the self-test is for. A '//' only starts a comment
  // when it is not the '//' of a scheme.
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/, '$1');
}

// A number token, guarded so it cannot be a fragment of something else:
// rejects 0.9505 (leading '.'), s9012x, 9012.5, and handles TS separators (9_012).
const NUM_TOKEN = /(?<![\w.$])(\d[\d_]*)(?![\w.])/g;
const HOSTPORT = /(?:127\.0\.0\.1|localhost):(\d{2,5})\b/g;

function scanText(rel, src, push) {
  const isConfigLike = /\.config\.ts$/.test(rel);
  let inBlockComment = false;
  src.split('\n').forEach((raw, i) => {
    const ln = i + 1;
    let line = raw;
    // whole-line comment forms
    if (/\.(sh|py)$/.test(rel) ? /^\s*#/.test(line) : /^\s*(\/\/|\*|\/\*)/.test(line)) {
      if (/^\s*\/\*/.test(line) && !/\*\//.test(line)) inBlockComment = true;
      return;
    }
    if (inBlockComment) { if (/\*\//.test(line)) inBlockComment = false; return; }
    line = stripComments(rel, line);
    if (!line.trim()) return;

    // R1 -- any literal in the pool range, whatever it is called.
    for (const m of line.matchAll(NUM_TOKEN)) {
      const n = Number(m[1].replace(/_/g, ''));
      if (!Number.isInteger(n)) continue;
      if (n < POOL_START || n > POOL_END) continue;
      push(`${rel}:${ln}: literal ${n} is inside the e2e port pool ${POOL_START}-${POOL_END}. ` +
        `Ports are LEASED at run time (REQ-0323) -- source tools/e2e_ports.sh and use ` +
        `$APIPORT/$PROXYPORT/$E2E_PORT_BASE. No file outside tools/e2e_port_lease.py may ` +
        `name a pool port.\n       ${raw.trim()}`);
    }
    // R2 -- any host:port literal that is not a permanent shared service.
    for (const m of line.matchAll(HOSTPORT)) {
      const n = Number(m[1]);
      if (sharedOk(n)) continue;
      if (n >= POOL_START && n <= POOL_END) continue; // already reported by R1
      push(`${rel}:${ln}: pins host:port ${n}. Nothing may hardcode an e2e endpoint any ` +
        `more -- it is leased per run. Only the permanent shared services ` +
        `(${[...SHARED_OK].join('/')}, fleet ${LEGACY_FLEET_BASE}-${LEGACY_FLEET_BASE + LEGACY_FLEET_SLOTS - 1}) ` +
        `may be named.\n       ${raw.trim()}`);
    }
    // R5 -- nobody passes an argument to e2e_ports.sh.
    if (/e2e_ports\.sh"?\s+[^\s;|&)]/.test(line) && !/e2e_ports\.sh"?\s+(--|#)/.test(line)) {
      push(`${rel}:${ln}: passes an argument to e2e_ports.sh. It takes NONE since ` +
        `REQ-0323 (a REQ number there is exit 64) -- ports are leased, not derived.\n       ${raw.trim()}`);
    }
    void isConfigLike;
  });
}

// R3 -- a declared config must DERIVE its baseURL and fail loudly without it.
function scanConfigContract(rel, src, push) {
  if (!/process\.env\.PLAYWRIGHT_BASE_URL/.test(src)) {
    push(`${rel}: does not read process.env.PLAYWRIGHT_BASE_URL. A leased port cannot be ` +
      `written down ahead of time, so the harness must hand it in (REQ-0323 sec.3).`);
    return;
  }
  const fallback = src.match(/PLAYWRIGHT_BASE_URL\s*(\|\||\?\?)/);
  if (fallback) {
    push(`${rel}: PLAYWRIGHT_BASE_URL has a '${fallback[1]}' fallback. There is no correct ` +
      `default any more -- the port is leased per run, so a fallback silently sends a ` +
      `hand-run at a dead or FOREIGN port. Throw instead.`);
  }
  if (!/throw new Error\(/.test(src)) {
    push(`${rel}: must throw a clear error when PLAYWRIGHT_BASE_URL is absent, rather than ` +
      `falling back to a literal (REQ-0323 sec.3).`);
  }
}

// ----------------------------------------------------------- self-test ------
// Prove the detector detects. Every entry is run through the SAME scanner the
// real check uses; a shape that slips through fails the build here, one CI
// cycle before it could hide a real port bug.
function selfTest() {
  const mustCatch = [
    ['REQ-0322 blind spot: E2E_PROXY_PORT=', 'tools/x_e2e.sh', 'env E2E_PROXY_PORT=9012 node p.cjs'],
    ['STATICPORT=', 'tools/x_e2e.sh', 'STATICPORT=9010'],
    ['PROXYPORT=', 'tools/x_e2e.sh', 'PROXYPORT=9012'],
    ['APIPORT default seam', 'tools/x_e2e.sh', 'APIPORT="${APIPORT:-9011}"'],
    ['lowercase/odd name', 'tools/x_e2e.sh', 'my_port=9012'],
    ['no PORT in the name at all', 'tools/x_e2e.sh', 'foo=9012'],
    ['arithmetic on a pool base', 'tools/x_e2e.sh', 'B=$((9000 + 4))'],
    ['host:port in the pool', 'client/e2e/x.config.ts', "const u = 'http://127.0.0.1:9012';"],
    ['stale host:port outside the pool', 'client/e2e/x.config.ts', "const u = 'http://127.0.0.1:6562';"],
    ['TS numeric separator', 'client/e2e/x.config.ts', 'const p = 9_012;'],
    ['argument to e2e_ports.sh', 'tools/x_e2e.sh', 'source "$(dirname "$0")/e2e_ports.sh" 0156'],
    ['bare argument to e2e_ports.sh', 'tools/x_e2e.sh', 'source tools/e2e_ports.sh 0323'],
  ];
  const mustPass = [
    ['pool number inside a shell comment', 'tools/x_e2e.sh', '# the pool is 9000-9999'],
    ['pool number inside a // comment', 'client/e2e/x.config.ts', '// pool 9000-9999, blocks of 10'],
    ['permanent shared proxy', 'client/e2e/x.config.ts', "const u = 'http://127.0.0.1:8803';"],
    ['permanent shared api', 'tools/x_e2e.sh', 'curl http://127.0.0.1:8802/api/health'],
    ['legacy fleet base', 'tools/x_e2e.sh', 'B=${E2E_FLEET_BASE_PORT:-8810}'],
    ['a timeout that is not a port', 'client/e2e/x.config.ts', 'expect: { timeout: 10_000 },'],
    ['a float with pool digits', 'client/e2e/x.config.ts', 'const y = 0.9505;'],
    ['an identifier containing pool digits', 'tools/x_e2e.sh', 'f=candidate_s9012x.png'],
    ['a correct source line', 'tools/x_e2e.sh', 'source "$(dirname "$0")/e2e_ports.sh"'],
    ['leased vars, no literals', 'tools/x_e2e.sh', 'env PORT="$APIPORT" node server/api.cjs'],
  ];
  let bad = 0;
  for (const [name, rel, text] of mustCatch) {
    const hits = [];
    scanText(rel, text, (m) => hits.push(m));
    if (!hits.length) { console.error(`FAIL self-test: NOT DETECTED -- ${name}: ${text}`); bad++; }
  }
  for (const [name, rel, text] of mustPass) {
    const hits = [];
    scanText(rel, text, (m) => hits.push(m));
    if (hits.length) { console.error(`FAIL self-test: FALSE POSITIVE -- ${name}: ${text}\n       ${hits[0]}`); bad++; }
  }
  // R3's own negatives.
  const cfgBad = [
    ['literal || fallback', "const B = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:6562';"],
    ['?? fallback', "const B = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:6562';"],
    ['does not read the env at all', "const B = 'http://127.0.0.1:6562';"],
  ];
  for (const [name, text] of cfgBad) {
    const hits = [];
    scanConfigContract('client/e2e/x.config.ts', text, (m) => hits.push(m));
    if (!hits.length) { console.error(`FAIL self-test: NOT DETECTED (config contract) -- ${name}`); bad++; }
  }
  const cfgGood = "const B = process.env.PLAYWRIGHT_BASE_URL;\nif (!B) throw new Error('set it');\n";
  const okHits = [];
  scanConfigContract('client/e2e/x.config.ts', cfgGood, (m) => okHits.push(m));
  if (okHits.length) { console.error(`FAIL self-test: FALSE POSITIVE (config contract): ${okHits[0]}`); bad++; }

  if (bad) { console.error(`\ncheck_e2e_ports --self-test: ${bad} failed`); process.exit(1); }
  console.log(`check_e2e_ports --self-test: ${mustCatch.length} defect shapes all DETECTED, ` +
    `${mustPass.length + 1} legal shapes all passed (pool ${POOL_START}-${POOL_END})`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

// ------------------------------------------------------------- the run ------
let failures = 0;
const fail = (m) => { console.error('FAIL ' + m); failures++; };

const files = watchedFiles();
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`${rel}: listed here but does not exist`); continue; }
  scanText(rel, fs.readFileSync(abs, 'utf8'), fail);
}
for (const rel of HARNESSES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  if (!/e2e_harness_req\s+/.test(src)) {
    fail(`${rel}: must go through tools/e2e_harness.sh (e2e_harness_req), which is what leases ` +
      `its port block and releases it on exit.`);
  }
}
for (const rel of CONFIGS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`${rel}: config is listed here but does not exist`); continue; }
  scanConfigContract(rel, fs.readFileSync(abs, 'utf8'), fail);
}
// R4 -- an undeclared config that pins an endpoint is checked by nothing.
const declared = new Set(CONFIGS);
const cfgDir = path.join(ROOT, CONFIG_DIR);
if (fs.existsSync(cfgDir)) {
  for (const n of fs.readdirSync(cfgDir).filter((f) => f.endsWith('.config.ts'))) {
    const rel = `${CONFIG_DIR}/${n}`;
    if (declared.has(rel)) continue;
    const src = fs.readFileSync(path.join(cfgDir, n), 'utf8');
    const hit = src.split('\n').find((l) => !/^\s*(\/\/|\*)/.test(l) && /(?:127\.0\.0\.1|localhost):\d{2,5}/.test(l));
    if (hit) {
      fail(`${rel}: pins a host:port but is not declared in check_e2e_ports.cjs CONFIGS, so its ` +
        `baseURL contract is checked by nothing. Add it.\n       ${hit.trim()}`);
    }
  }
}

if (failures) {
  console.error(`\ncheck_e2e_ports: ${failures} failed`);
  process.exit(1);
}
console.log(`check_e2e_ports: ${files.length} files + ${CONFIGS.length} configs -- no literal port in ` +
  `the leased pool ${POOL_START}-${POOL_END}, no pinned endpoint, no REQ argument (REQ-0323)`);
