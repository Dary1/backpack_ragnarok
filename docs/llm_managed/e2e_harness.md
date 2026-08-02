# E2E harness (hermetic) — usage since REQ-0214 / REQ-0217

Premise: the post-REQ-0217 hermetic harness is current.
Expires-when: superseded by a harness rewrite.

2026-07-17. Supersedes every older description of the e2e rig.

## Principles
- An e2e run is HERMETIC: it never reads or writes the live services
  (8801/8802), the pg main namespace, the repo's content/live or data/
  trees, or the players registry. Everything comes from THIS worktree's
  code/content plus committed fixtures (client/e2e/fixtures/), inside
  per-run throwaway worker HOMEs.
- The dev player is NOT a test identity. Unauthenticated e2e traffic
  carries `x-bpk-e2e-profile: ci` (playwright.config extraHTTPHeaders) and
  the api's dev_mode fallback resolves it to `e2e_ci` (REQ-0214). Specs
  address the caller's profile via the `default` alias, never a hardcoded
  playerId.

## Running it
Preferred — SCOPED run (shares nothing box-global; safe to run while other
sessions work; skips the box lock):

    source tools/e2e_ports.sh          # -> PROXYPORT, E2E_PORT_BASE, ... (a free decade)
    E2E_FLEET_ROOT=/tmp/bp_e2e_workers_req0NNN \
    E2E_PROXY_PORT=$PROXYPORT E2E_FLEET_BASE_PORT=$((E2E_PORT_BASE + 4)) \
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PROXYPORT \
    E2E_PARALLEL=4 pnpm exec playwright test        # from client/

Ports come from the rental port desk (tools/port_desk.sh) via tools/e2e_ports.sh
(REQ-0323): sourcing the helper leases a free block of 10 consecutive ports, so
index 2 = proxy and indexes 4..(4+workers-1) = fleet apis, and E2E_PARALLEL<=6
fits the block. Get them by sourcing the helper -- never hand-type a port.

Legacy — `pnpm run e2e` (tools/e2e_run.sh): shared proxy 8803 + fleet
8810+, serialized by the box lock. Works, but queues against every other
session; prefer scoped runs.

From a `req-NNNN-*` worktree, `tools/ci.sh` runs its [7/7] e2e stage SCOPED
AUTOMATICALLY (ports leased from the desk; REQ-0234/REQ-0323). An explicit
PLAYWRIGHT_BASE_URL, or the main checkout, keeps the legacy path.

Provisioning (REQ-0234): a fresh worktree needs `pnpm install
--frozen-lockfile` in THREE dirs — the repo root, client/, AND server/ (the
fleet workers are this worktree's own api; without server/node_modules the
fleet now fails fast naming the missing module instead of a bare health
timeout).

## What a run does
1. global-setup boots N isolated backpack-api workers (tools/e2e_fleet.cjs):
   HOME=<fleet root>/w<i>/home, STORAGE_BACKEND=files, DATABASE_URL unset;
   content symlinked/copied from the worktree; data/config + data/profiles
   seeded from client/e2e/fixtures/ (incl. the e2e_ci profile).
2. client/e2e/local-proxy.cjs serves /app/* and /preview/* from the
   worktree's web/ and routes /api by X-E2E-Worker to the worker's own api
   (headerless -> worker 0; NEVER the live api). Anything else is 404.
   reuseExistingServer=false: a run refuses to adopt a foreign proxy.
3. Teardown sweeps the guest-auth ledger (kept INSIDE the fleet root since
   REQ-0234, so concurrent scoped runs cannot clobber each other's) and
   stops the fleet (worker api logs are archived to <fleet root>_logs_last
   for crash forensics — the default root archives to
   /tmp/bp_e2e_workers_logs_last).

## The freeze -- LIFTED (REQ-0236; doc truth-up 2026-08-02, REQ-0359)

The 2026-07-17 freeze (reboot-persistent `backpack-e2e-freeze` user unit holding
the e2e box lock so pre-REQ-0217 harnesses could not run) was lifted under
REQ-0236 after the worktree sweep (104 pre-harness trees removed, 2026-07-27).
Verified 2026-08-02: unit inactive AND disabled; all 12 `req-*` worktrees contain
the merged hermetic harness (ancestor check vs `35a8edce`);
`~/.cache/backpack/e2e.box.lock` remains as an inert 0-byte file (advisory lock,
no holder). Accepted residual: `monsters-002-style-bakeoff` (HANDS-OFF art WIP)
predates the harness and is never used for e2e.

## Rules that stay
- Box lock (REQ-0117) still guards the LEGACY shared-port path.
- Port decades (REQ-0172), rebased onto the 5000 base by REQ-0321 to match
  PROJECT.md; scoped runs live inside their REQ's own decade.
- Admin harnesses (artadmin/artinspect/contentadmin) keep their own
  isolated HOME-remap rigs (REQ-0159); since REQ-0234 they drive the
  post-0217 proxy via E2E_FLEET_BASE_PORT=<their api port> (the proxy's old
  E2E_STATIC_PORT/E2E_API_PORT knobs died with REQ-0217) and hold per-REQ
  locks rather than the frozen box lock.
- Registry-first (pg-only) serving is covered by tools/registry_first_e2e.sh
  (ci.sh stage [6.6/8], REQ-0221): an isolated pg api seeded with one
  adopted def runs the registry-guard specs and FAILS if any of them skips.
