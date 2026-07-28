# E2E harness (hermetic) — usage since REQ-0214 / REQ-0217

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

    _src() { source tools/e2e_ports.sh; }; _src   # NO argument -- see below
    E2E_FLEET_ROOT=/tmp/bp_e2e_workers_p$E2E_PORT_BASE \
    E2E_PROXY_PORT=$PROXYPORT E2E_FLEET_BASE_PORT=$E2E_FLEET_PORT_BASE \
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PROXYPORT \
    E2E_PARALLEL=4 pnpm exec playwright test        # from client/
    e2e_ports_release                               # when you are done

Ports are LEASED AT RUN TIME (REQ-0323, supersedes the REQ-decade rule of
REQ-0172/0251/0321). tools/e2e_ports.sh takes NO ARGUMENTS: it asks the OS which
ports are bindable, takes the lowest free 10-port block out of 9000-9999, writes
an O_EXCL lease under ~/backpack_ragnarok_state/e2e_ports/, and exports
E2E_PORT_BASE / STATICPORT / APIPORT / PROXYPORT / E2E_FLEET_PORT_BASE. Index 1 =
api, 2 = proxy, 4..9 = fleet workers, so E2E_PARALLEL<=6 still fits a block.
Passing a REQ number is now an ERROR (exit 64) -- there is no base, no ceiling,
no poisoned decade and no REQ-2775 wall left to get wrong.

Wrap the `source` in a zero-argument function, as above: bash lets a sourced
file see the CALLER's "$@", so sourcing it from inside a function that took
arguments looks exactly like passing it a REQ number.

    tools/e2e_ports.sh --who    # live leases: block, caller, pid, age, BOUND NOW
    tools/e2e_ports.sh --gc     # reclaim stale leases now (a convenience only)

A lease can never hold an idle block: it is invalidated by a boot_id mismatch, a
dead pid, or by having nothing bound in its block for longer than the 60s grace
window -- whichever comes first. Reclamation happens as a side effect of the
next allocation, so the pool self-heals by being used; there is no cron, daemon
or sweeper. THE LEDGER IS A HINT, WHETHER A PORT IS BINDABLE IS THE AUTHORITY.

Legacy — `pnpm run e2e` (tools/e2e_run.sh): shared proxy 8803 + fleet
8810+, serialized by the box lock. Works, but queues against every other
session; prefer scoped runs.

From a `req-NNNN-*` worktree, `tools/ci.sh` runs its [7/7] e2e stage SCOPED
AUTOMATICALLY (decade derived from the branch name; REQ-0234). An explicit
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

## The freeze (temporary)
The pre-REQ-0217 harness backed up/cleared/restored LIVE state and wrote
the LIVE dev profile every run (2026-07-17 incident). Until every worktree
is rebased onto the merged harness, a daemon holds the e2e box lock so old
runs cannot start: see ~/.cache/backpack/E2E_FREEZE_README.txt. Scoped
hermetic runs are unaffected. Lift the freeze by killing the flock/sleep
pair once old worktrees are gone.

Since REQ-0234 the freeze pins ONLY the legacy shared-port path: ci.sh's
[7/7] auto-scopes from a req- worktree, and the admin + registry harnesses
take per-REQ locks (~/.cache/backpack/e2e.<req>.lock) instead of the box
lock — rebased trees run the full gate chain without ever touching the
frozen lock. tools/e2e_run.sh also names the lock holder (and points at the
freeze README) IMMEDIATELY instead of stalling silently for E2E_LOCK_WAIT.

## Rules that stay
- Box lock (REQ-0117) still guards the LEGACY shared-port path.
- Port LEASES (REQ-0323) replaced the REQ-derived decades of REQ-0172/0321: a
  scoped run leases a block from 9000-9999 for its lifetime and gives it back.
  tools/check_e2e_ports.cjs (ci [0/8]) now forbids any literal pool port or
  pinned endpoint anywhere in the harness/config set, and self-tests that it
  detects each defect shape; ci [0.5/8] tests the lease mechanics themselves.
- Admin harnesses (artadmin/artinspect/contentadmin) keep their own
  isolated HOME-remap rigs (REQ-0159); since REQ-0234 they drive the
  post-0217 proxy via E2E_FLEET_BASE_PORT=<their api port> (the proxy's old
  E2E_STATIC_PORT/E2E_API_PORT knobs died with REQ-0217) and hold per-REQ
  locks rather than the frozen box lock.
- Registry-first (pg-only) serving is covered by tools/registry_first_e2e.sh
  (ci.sh stage [6.6/8], REQ-0221): an isolated pg api seeded with one
  adopted def runs the registry-guard specs and FAILS if any of them skips.
