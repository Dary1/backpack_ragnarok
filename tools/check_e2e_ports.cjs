#!/usr/bin/env node
'use strict';
// tools/check_e2e_ports.cjs -- REQ-0172. Machine-enforce the port rule.
//
// PROJECT.md: a harness's ports are DERIVED from its REQ number
// (PORT = REQ * 10 + index, 0 = static, 1 = api, 2 = proxy). A rule that lives
// only in prose rots -- artadmin_e2e.sh and content_admin_e2e.sh both drifted
// onto 8921/8922/8923 by hand, which was invisible until tools/ci.sh ran them
// back-to-back and the second one's proxy never came up (REQ-0159).
//
// So: this gate fails the build if a harness declares a port OUTSIDE its own
// REQ's decade. It is deliberately cheap and runs EARLY in ci.sh -- a port
// collision should cost one line, not a whole e2e cycle.
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
// Ports that are shared + permanent, NOT REQ-scoped (PROJECT.md says so):
// backpack-web, backpack-api, the e2e local proxy, and the REQ-0083 fleet.
const SHARED_OK = new Set([8801, 8802, 8803]);
const FLEET_BASE = 8810;

let failures = 0;
const fail = (msg) => { console.error('FAIL ' + msg); failures++; };

for (const { file, req } of HARNESSES) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) { fail(`${file}: harness is listed here but does not exist`); continue; }
  const src = fs.readFileSync(abs, 'utf8');

  // 1. It must source the derivation helper with its OWN req number.
  const sourced = new RegExp(`source\\s+"\\$\\(dirname "\\$0"\\)/e2e_ports\\.sh"\\s+0*${req}\\b`).test(src);
  if (!sourced) {
    fail(`${file}: must derive its ports via 'source "$(dirname "$0")/e2e_ports.sh" ${String(req).padStart(4, '0')}' ` +
         `(PROJECT.md: ports are derived from the REQ number, never hand-picked)`);
  }

  // 2. No port literal outside this REQ's own decade may appear anywhere in it.
  const lo = req * 10, hi = lo + 9;
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
        if (port >= FLEET_BASE && port < FLEET_BASE + 100) continue; // REQ-0083 fleet
        fail(`${file}:${i + 1}: port ${port} is outside REQ-${String(req).padStart(4, '0')}'s decade ` +
             `(${lo}-${hi}). Derive it from the REQ number -- see PROJECT.md and tools/e2e_ports.sh.\n` +
             `       ${line.trim()}`);
      }
    }
  });
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
console.log(`check_e2e_ports: ${HARNESSES.length} harnesses, all ports derived from their REQ number, no collisions`);
