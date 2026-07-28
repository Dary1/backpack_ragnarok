'use strict';
// bot/lib/allowlist.cjs -- REQ-0330 safety: a compiled-in endpoint ALLOWLIST.
// The fleet is a SELL-ONLY reactive joiner. Every HTTP request the client makes
// is checked here first and REFUSED (thrown) unless it matches an allow rule.
// This is default-DENY: anything not explicitly listed -- most importantly
// hosting a troop (POST /api/schedule/troops with no id), cancelling a troop,
// BUYING a listing, and everything under /api/admin or /dev/ -- cannot be sent,
// even by a future bug. The bot NEVER hosts, NEVER cancels, NEVER buys.
//
// A rule is { method, re } where re matches the URL PATH ONLY (query string is
// stripped before the check). Order does not matter; a request is allowed iff
// SOME rule matches.
const ALLOW = [
  // Identity / content / own profile (read-only).
  { method: 'GET', re: /^\/api\/me$/ },
  { method: 'GET', re: /^\/api\/content$/ },
  { method: 'GET', re: /^\/api\/profile\/[^/]+\/canvas$/ },

  // Troops: BROWSE recruiting, JOIN a seat, LEAVE a seat. NOTE the absence of
  // `POST /api/schedule/troops` (host) and `.../cancel` -- deliberately denied.
  { method: 'GET', re: /^\/api\/schedule\/troops$/ },
  { method: 'POST', re: /^\/api\/schedule\/troops\/[^/]+\/join$/ },
  { method: 'POST', re: /^\/api\/schedule\/troops\/[^/]+\/leave$/ },
  // Read a specific troop's state (poll for full/disbanded).
  { method: 'GET', re: /^\/api\/schedule\/troops\/[^/]+$/ },

  // Notification feed: read + ack (the auto-seller trigger).
  { method: 'GET', re: /^\/api\/notifications$/ },
  { method: 'POST', re: /^\/api\/notifications\/ack$/ },

  // Warehouse inbox (read the caller's own drops).
  { method: 'GET', re: /^\/api\/warehouse$/ },

  // The ONLY market write the fleet may perform: direct warehouse->market sell.
  // Market BUY, canvas-sourced create, withdraw, TM-listing are all denied.
  { method: 'POST', re: /^\/api\/market\/listings\/from-warehouse$/ },
];

// Hard denials -- matched BEFORE the allowlist so a mistaken allow-rule can
// never expose them, and so the refusal names the specific hazard.
const HARD_DENY = [
  { re: /^\/api\/admin(\/|$)/, why: 'admin surface is off-limits to the fleet' },
  { re: /\/dev\//, why: 'dev/test-control seams are off-limits to the fleet' },
  { re: /^\/api\/market\/listings\/[^/]+\/buy$/, why: 'the fleet is SELL-ONLY -- buying is refused to prevent self-dealing' },
  { re: /^\/api\/schedule\/troops$/, denyMethods: ['POST'], why: 'the fleet NEVER hosts -- it only reacts to a recruitment a player started' },
  { re: /^\/api\/schedule\/troops\/[^/]+\/cancel$/, why: 'the fleet NEVER cancels a troop' },
];

function normalizePath(pathOrUrl) {
  // Accept a bare path ("/api/me"), a path+query ("/api/schedule/troops?x=1"),
  // or an absolute URL; return the path with the query string removed.
  let p = String(pathOrUrl || '');
  const scheme = p.indexOf('://');
  if (scheme >= 0) {
    const rest = p.slice(scheme + 3);
    const slash = rest.indexOf('/');
    p = slash >= 0 ? rest.slice(slash) : '/';
  }
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  return p;
}

function isAllowed(method, pathOrUrl) {
  const m = String(method || '').toUpperCase();
  const p = normalizePath(pathOrUrl);
  for (const d of HARD_DENY) {
    if (d.re.test(p) && (!d.denyMethods || d.denyMethods.includes(m))) return false;
  }
  return ALLOW.some((r) => r.method === m && r.re.test(p));
}

// assertAllowed(method, path): throw a labelled Error if the request is not on
// the allowlist. The client calls this for EVERY request before it goes out.
function assertAllowed(method, pathOrUrl) {
  const m = String(method || '').toUpperCase();
  const p = normalizePath(pathOrUrl);
  for (const d of HARD_DENY) {
    if (d.re.test(p) && (!d.denyMethods || d.denyMethods.includes(m))) {
      const err = new Error('fleet allowlist REFUSED ' + m + ' ' + p + ' -- ' + d.why);
      err.code = 'ALLOWLIST_DENY';
      throw err;
    }
  }
  if (!isAllowed(m, p)) {
    const err = new Error('fleet allowlist REFUSED ' + m + ' ' + p + ' -- not an allowed fleet endpoint');
    err.code = 'ALLOWLIST_DENY';
    throw err;
  }
  return true;
}

module.exports = { ALLOW, HARD_DENY, isAllowed, assertAllowed, normalizePath };
