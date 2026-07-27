#!/usr/bin/env node
'use strict';
// tools/check_e2e_ports.cjs -- REQ-0172. Machine-enforce the port rule.
//
// PROJECT.md: a harness's ports are DERIVED from its REQ number
// (PORT = 5000 + REQ * 10 + index; 0 = static, 1 = api, 2 = proxy). A rule that
// lives only in prose rots -- artadmin_e2e.sh and content_admin_e2e.sh both
// drifted onto 8921/8922/8923 by hand, which was invisible until tools/ci.sh ran
// them back-to-back and the second one's proxy never came up (REQ-0159).
//
// So: this gate fails the build if a harness declares a port OUTSIDE its own
// REQ's decade. It is deliberately cheap and runs EARLY in ci.sh -- a port
// collision should cost one line, not a whole e2e cycle.
//
// REQ-0251: it now also reads client/e2e/*.config.ts. It used to check only the
// tools/*_e2e.sh side, and the rule rotted in the half it could not see: all
// three admin configs still carried their PRE-REQ-0172 hand-picked baseURL
// defaults (8903/8913/8923 -- the very 89xx block REQ-0172 was written to
// abolish) years after the harnesses moved. Harmless only because the harness
// always passes PLAYWRIGHT_BASE_URL; a hand-run `playwright test --config=...`
// went straight at a stale port. A gate that watches one half of a rule watches
// none of it. Any config with a host:port literal must be declared here.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Every harness that stands up its own services, with the REQ that owns it.
const HARNESSES = [
  { file: 'tools/art_inspect_e2e.sh', req: 152 },
  { file: 'tools/artadmin_e2e.sh', req: 156 },
  { file: 'tools/content_admin_e2e.sh', req: 157 },
  { file: 'tools/registry_first_e2e.sh', req: 221 }, // REQ-0221 registry-first serving harness
];
// The Playwright config each harness drives, and the REQ that owns it. Its
// baseURL DEFAULT must be that REQ's proxy port (index 2) -- derived, not typed.
const CONFIG_DIR = 'client/e2e';
const CONFIGS = [
  { file: 'client/e2e/artinspect.config.ts', req: 152 },
  { file: 'client/e2e/artadmin.config.ts', req: 156 },
  { file: 'client/e2e/contentadmin.config.ts', req: 157 },
  { file: 'client/e2e/registry.config.ts', req: 221 },
];
const PORT_BASE = 5000;                 // REQ-0251, must match tools/e2e_ports.sh
const decadeLo = (req) => PORT_BASE + req * 10;
const req4 = (req) => String(req).padStart(4, '0');
// Ports that are shared + permanent, NOT REQ-scoped (PROJECT.md says so):
// backpack-web, backpack-api, the e2e local proxy, and the REQ-0083 fleet.
const SHARED_OK = new Set([8801, 8802, 8803]);
// REQ-0251: the fleet exemption used to be `>= 8810 && < 8910` -- a 100-port
// window for a fleet that is 8810 plus AT MOST 6 workers (global-setup caps
// E2E_PARALLEL at the 6 slots a decade holds). That slack was not free: it
// silently waived 8810-8909, which is precisely where artadmin's stale 8903
// sat, so this gate would have green-lit the hand-picked port it exists to
// forbid. An exemption must be the size of the thing it exempts.
const FLEET_BASE = 8810;
const FLEET_SLOTS = 10; // the 8810 decade -- matches the REQ-0381 poisoned decade in e2e_ports.sh

let failures = 0;
const fail = (msg) => { console.error('FAIL ' + msg); failures++; };

for (const { file, req } of HARNESSES) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) { fail(`${file}: harness is listed here but does not exist`); continue; }
  const src = fs.readFileSync(abs, 'utf8');

  // 1. It must derive its ports from its OWN req number -- either straight from
  //    the helper, or (REQ-0251) via e2e_harness.sh, which sources the helper
  //    for it. Both routes end in e2e_ports.sh; neither lets a port be typed.
  const sourced = new RegExp(`source\\s+"\\$\\(dirname "\\$0"\\)/e2e_ports\\.sh"\\s+0*${req}\\b`).test(src)
    || new RegExp(`e2e_harness_req\\s+0*${req}\\b`).test(src);
  if (!sourced) {
    fail(`${file}: must derive its ports, via 'e2e_harness_req ${req4(req)} <name>' (REQ-0251) or ` +
         `'source "$(dirname "$0")/e2e_ports.sh" ${req4(req)}' ` +
         `(PROJECT.md: ports are derived from the REQ number, never hand-picked)`);
  }

  // 2. No port literal outside this REQ's own decade may appear anywhere in it.
  const lo = decadeLo(req), hi = lo + 9;
  // Only look at places that are ACTUALLY ports -- a bare 4-digit number is
  // usually something else (ART_MOCK_DELAY_MS=1500 is a delay, not a port), and
  // a lint that cries wolf gets disabled. Two precise port sites:
  //   * a *PORT* variable's default:  FOOPORT="${FOOPORT:-1560}"
  //   * a literal host:port endpoint: 127.0.0.1:1560 / localhost:1560
  const PORT_SITES = [
    /\b[A-Z_]*PORT[A-Z_]*\s*=\s*"?\$\{[A-Z_]*:-(\d{4,5})\}/g,
    /\b[A-Z_]*PORT[A-Z_]*\s*=\s*"?(\d{4,5})\b/g,
    /(?:127\.0\.0\.1|localhost):(\d{4,5})\b/g,
  ];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // comments may cite history (e.g. "used to be 8921")
    for (const re of PORT_SITES) {
      for (const m of line.matchAll(re)) {
        const port = Number(m[1]);
        if (port < 1024 || port > 65535) continue; // not a plausible port
        if (port >= lo && port <= hi) continue;    // its own decade -- fine
        if (SHARED_OK.has(port)) continue;         // shared permanent services
        if (port >= FLEET_BASE && port < FLEET_BASE + FLEET_SLOTS) continue; // REQ-0083 fleet
        fail(`${file}:${i + 1}: port ${port} is outside REQ-${req4(req)}'s decade ` +
             `(${lo}-${hi}). Derive it from the REQ number -- see PROJECT.md and tools/e2e_ports.sh.\n` +
             `       ${line.trim()}`);
      }
    }
  });
}

// 2b. REQ-0251: the config side of the same rule. A config's baseURL default is
//     a DEFAULT, not a hardcode -- it must name its own REQ's proxy port, so
//     that a hand-run `playwright test --config=...` with no PLAYWRIGHT_BASE_URL
//     hits this REQ's harness rather than whatever used to live on 89xx.
const BASEURL_DEFAULT = /PLAYWRIGHT_BASE_URL\s*\|\|\s*'http:\/\/(?:127\.0\.0\.1|localhost):(\d{4,5})'/;
for (const { file, req } of CONFIGS) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) { fail(`${file}: config is listed here but does not exist`); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const want = decadeLo(req) + 2; // index 2 = proxy
  const m = src.match(BASEURL_DEFAULT);
  if (!m) {
    fail(`${file}: no 'process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:<port>"' default found -- ` +
         `this gate cannot verify it. Keep the override seam in the shape the rule can read.`);
  } else if (Number(m[1]) !== want) {
    fail(`${file}: baseURL default is ${m[1]}, but REQ-${req4(req)} owns ${decadeLo(req)}-${decadeLo(req) + 9} ` +
         `-> proxy is ${want}. The default must be DERIVED (PROJECT.md), not carried over from an older port.`);
  }
}

// 2c. And nothing may quietly opt out: a NEW config that pins a host:port but is
//     not declared above would be invisible to 2b -- which is exactly how
//     8903/8913/8923 survived REQ-0172. Fail until it is declared.
const declared = new Set(CONFIGS.map((c) => c.file));
const cfgDir = path.join(ROOT, CONFIG_DIR);
if (fs.existsSync(cfgDir)) {
  for (const name of fs.readdirSync(cfgDir).filter((f) => f.endsWith('.config.ts'))) {
    const rel = `${CONFIG_DIR}/${name}`;
    if (declared.has(rel)) continue;
    const src = fs.readFileSync(path.join(cfgDir, name), 'utf8');
    const hit = src.split('\n').find((l) => !/^\s*(\/\/|\*)/.test(l) && /(?:127\.0\.0\.1|localhost):\d{4,5}/.test(l));
    if (hit) {
      fail(`${rel}: pins a host:port but is not declared in check_e2e_ports.cjs CONFIGS, so its port ` +
           `is checked by nothing. Add it with the REQ that owns it.\n       ${hit.trim()}`);
    }
  }
}

// 3. Two harnesses must never share a decade (they cannot, if each uses its own
//    REQ -- but assert it rather than trust it: this is the whole point).
const seen = new Map();
for (const { file, req } of HARNESSES) {
  if (seen.has(req)) fail(`REQ-${req} claimed by BOTH ${seen.get(req)} and ${file} -- decades must be unique`);
  seen.set(req, file);
}

if (failures) {
  console.error(`\ncheck_e2e_ports: ${failures} failed`);
  process.exit(1);
}
console.log(`check_e2e_ports: ${HARNESSES.length} harnesses + ${CONFIGS.length} configs, all ports derived from their REQ number (base ${PORT_BASE}), no collisions`);
