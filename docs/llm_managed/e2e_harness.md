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

    E2E_FLEET_ROOT=/tmp/bp_e2e_workers_<reqNNNN> \
    E2E_PROXY_PORT=<NNNN>2 E2E_FLEET_BASE_PORT=<NNNN>4 \
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:<NNNN>2 \
    E2E_PARALLEL=4 pnpm exec playwright test        # from client/

Ports follow the REQ-decade rule (tools/e2e_ports.sh): index 2 = proxy,
indexes 4..(4+workers-1) = fleet apis, so E2E_PARALLEL<=6 fits a decade.

Legacy — `pnpm run e2e` (tools/e2e_run.sh): shared proxy 8803 + fleet
8810+, serialized by the box lock. Works, but queues against every other
session; prefer scoped runs.

## What a run does
1. global-setup boots N isolated backpack-api workers (tools/e2e_fleet.cjs):
   HOME=<fleet root>/w<i>/home, STORAGE_BACKEND=files, DATABASE_URL unset;
   content symlinked/copied from the worktree; data/config + data/profiles
   seeded from client/e2e/fixtures/ (incl. the e2e_ci profile).
2. client/e2e/local-proxy.cjs serves /app/* and /preview/* from the
   worktree's web/ and routes /api by X-E2E-Worker to the worker's own api
   (headerless -> worker 0; NEVER the live api). Anything else is 404.
   reuseExistingServer=false: a run refuses to adopt a foreign proxy.
3. Teardown sweeps the guest-auth ledger and stops the fleet (worker api
   logs are archived to /tmp/bp_e2e_logs_last for crash forensics).

## The freeze (temporary)
The pre-REQ-0217 harness backed up/cleared/restored LIVE state and wrote
the LIVE dev profile every run (2026-07-17 incident). Until every worktree
is rebased onto the merged harness, a daemon holds the e2e box lock so old
runs cannot start: see ~/.cache/backpack/E2E_FREEZE_README.txt. Scoped
hermetic runs are unaffected. Lift the freeze by killing the flock/sleep
pair once old worktrees are gone.

## Rules that stay
- Box lock (REQ-0117) still guards the LEGACY shared-port path.
- Port decades (REQ-0172) unchanged; scoped runs live inside their REQ's
  own decade.
- Admin harnesses (artadmin/artinspect/contentadmin) keep their own
  isolated HOME-remap rigs (REQ-0159) — unchanged by REQ-0217.
