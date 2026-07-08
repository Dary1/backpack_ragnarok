# REQ-0094 — server typecheck green (pg_sync worker 'error' handler) + pg_sync recovery unit coverage

Opened 2026-07-07. Found during a UnitTest Analysis pass (user directive
"UnitTest Analysis … project.md からどうぞ"), running every unit suite on llmlocal.

## Problem
`tools/ci.sh` step **[3.5/7] typecheck (server modules + shared, checkJs)** —
`node_modules/.bin/tsc -p tsconfig.server.json` — failed on master (HEAD 64e2cb6),
exit 2, two errors:

```
server/pg_sync.cjs(59,86): error TS2339: Property 'message' does not exist on type 'unknown'.
server/pg_sync.cjs(59,100): error TS2339: Property 'message' does not exist on type 'unknown'.
```

Offending line (worker crash-recovery handler in `spawnWorker()`):

```js
console.error('[pg_sync] worker error (will respawn on next query):', err && err.message ? err.message : err);
```

The `worker_threads` `Worker` `'error'` listener arg types as `unknown` under
checkJs (@types/node 26.1.0); `err.message` is dereferenced twice with no
`Error` guard. `pg_sync.cjs` is not in `tsconfig.server.json`'s `include` list,
but it is pulled into the program transitively — every `server/routes/*.cjs` and
`server/services/*.cjs` root `require('../storage.cjs')`, and `storage.cjs`
`require('./pg_sync.cjs')` — and it is not in `exclude`, so tsc checks it.

This step is gated by **no** `SKIP_*` flag: it runs on every `npm test` and every
`npm run test:quick`. So master's quality gate (`tools/ci.sh`, "Everything must be
green") was RED.

## Root cause / how it shipped
Introduced by **REQ-0089 (a), commit ffde7c0** ("pg_sync worker crash-recovery +
pool 'error' handler"), which added the `spawnWorker()` `'error'`/`'exit'` block.
Pre-0089 `pg_sync.cjs` (87 lines) had no such handler; current is 127 lines.

REQ-0089's "Gates (all green)" listed **client** typecheck (`tsc -b`, exit 0) but
not the **server** gate (`tsc -p tsconfig.server.json`, ci.sh 3.5/7). The server
typecheck was never run pre-merge, so the regression reached master.

## Current state (as of 2026-07-07, working tree at e43e0bc)
The type error is **already hotfixed in the main checkout's working tree, but
UNCOMMITTED and unrecorded** — `git diff HEAD -- server/pg_sync.cjs`:

```diff
-    console.error('[pg_sync] worker error (will respawn on next query):', err && err.message ? err.message : err);
+    console.error('[pg_sync] worker error (will respawn on next query):', err instanceof Error ? err.message : err);
```

`tsc -p tsconfig.server.json` now exits 0. Origin of the edit is a concurrent
main-checkout worktree change (unattributed; the tree also carries art-session
WIP). This REQ therefore: (a) ensures that fix is committed with a record rather
than living as loose working-tree state, and (b) closes the coverage gap that let
the regression ship in the first place.

## Scope
**(a) Server typecheck green — commit + record the guard.**
- Land `err instanceof Error ? err.message : err` (already in-tree) on a proper
  branch/commit. Runtime behaviour is identical; only the unknown-narrowing changes.
- Verify `node_modules/.bin/tsc -p tsconfig.server.json` exits 0 and
  `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` reaches `CI GREEN`.

**(b) Direct unit coverage for the pg_sync worker-recovery logic (the real gap).**
- `server/pg_sync.cjs` has **zero** direct unit tests. The crash-recovery/respawn
  behaviour REQ-0089 added (drop stale worker ref on `'error'`/`'exit'`, respawn on
  next `querySync()`, terminate + respawn a timed-out worker, keep the reply path
  total) is exercised ONLY by the pg-backend `api_test.cjs` pass — which is
  `SKIP_PG`-gated (needs a live Postgres) and thus does not run in `test:quick` or
  in DB-less environments. Net: the new recovery code has no coverage in default runs.
- Add a suite that drives `spawnWorker()`/`ensureWorker()` respawn-on-`exit`,
  respawn-on-`error`, and the timeout terminate+respawn path **without** a live
  Postgres (stub the worker / point it at a no-DB script), and wire it into
  `tools/ci.sh` so it is NOT behind `SKIP_PG`.

## Done-when
- `tools/ci.sh` (with `SKIP_PG/SKIP_CLIENT/SKIP_E2E=1`) prints `CI GREEN`; the
  pg_sync guard is committed (not a loose working-tree edit).
- A new pg_sync recovery unit suite runs DB-free, is on the default (non-SKIP_PG)
  path, and fails if the `'error'`/`'exit'` respawn bookkeeping regresses.

## Open questions
- Cleanest seam to unit-test the worker without pg — inject the worker script path
  / a fake Worker, vs. a tiny no-DB worker fixture that emits `'error'`/`'exit'` on cue?
- Should ci.sh add a lint that forbids `.message` on an unguarded `unknown` so this
  class of error is caught at author time, not only by the full typecheck?
- Should the pg-backend api pass (ci.sh 5/7) be un-gated in CI via a throwaway
  Postgres, so the pg path stops being untested locally? (Overlaps REQ-0089
  follow-up "dedicated throwaway database/schema".)

## Verification evidence (this analysis, llmlocal)
All other unit suites GREEN at the time of analysis:
sim/tests/run.cjs 63/0 · sim/tests/goldens.cjs 12/12 (determinism intact) ·
mock-src/tests/run.cjs 100/0 · tools/check_engine_types.cjs OK (49 members) ·
server/tests/api_test.cjs (files) 153/0 · tools/tests/test_fit_parity.py 23/0.
Only the server typecheck gate was red (2 errors, above); green again after the
in-tree guard. pg-backend (5/7), client build (6/7) and e2e (7/7) were not run
(live DB / services / browsers; and main checkout is hands-off).

## Related
- REQ-0089 — profile-save-reliability (root; introduced the handler; done, master).
- REQ-0040 — synchronous Postgres bridge (`pg_sync.cjs` origin).
- REQ-0047 (a) — `tools/ci.sh`, THE quality gate.
- REQ-0081 — precedent: a post-merge "gate-green" REQ opened from merge-verification.

## Outcome (2026-07-09)

**Phase (a) — server typecheck green: already on master.**
Commit **f1e1ec1** (REQ-0090) replaced the unguarded `err && err.message` with
`err instanceof Error ? err.message : err` in server/pg_sync.cjs; `tsc -p
tsconfig.server.json` is exit 0 on master. No code change was needed here — the
fix shipped as a drive-by inside an unrelated REQ with no record of its own; this
REQ is that record.

**Phase (b) — DB-free pg_sync recovery coverage: BUILT (unmerged).**
Branch `req-0094-pg-sync-typecheck-green`, commit **b2bd2af** (off master 10622cc):
- server/pg_sync.cjs — two test-only seams, `PG_SYNC_WORKER_PATH` (swap the worker
  script) and `PG_SYNC_WAIT_MS` (shorten the Atomics.wait window), both read at
  call time; production defaults unchanged.
- server/tests/pg_sync_test.cjs + server/tests/fixtures/pg_sync_fake_worker.cjs —
  a pg-free fake worker (identical SharedArrayBuffer reply protocol) drives four
  cases: normal round-trip, respawn after worker `exit(0)`, respawn after an
  uncaught worker `'error'`, and wedged-worker `timeout → terminate → respawn`.
- tools/ci.sh — new step **[4.5/7]** "pg_sync worker crash-recovery (DB-free)", on
  the default path (NOT behind SKIP_PG), so the recovery logic now has coverage in
  test:quick / DB-less runs.

Gates (green): `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` → `CI GREEN`
— sim 63/0, goldens 12, mock-src 100/0, typecheck clean, engine-types 49,
server files api 153/0, **pg_sync recovery 4/0**. pg-backend (5/7) / client build
(6/7) / e2e (7/7) not run (live DB / services / browsers).

## Merged & deployed (2026-07-09)
State: **done** — merged to master and deployed live (explicit user go-ahead 2026-07-09).
- Merge commit **bcf4824** (`git merge --no-ff req-0094-pg-sync-typecheck-green`);
  master then advanced to 2db0a50 (REQ-0107 merged on top). `git merge-tree` preview
  showed zero conflicts; post-merge `SKIP_PG/CLIENT/E2E bash tools/ci.sh` → CI GREEN
  on master.
- Deployed: backpack-api restarted (systemd --user) — clean boot ("listening on
  http://127.0.0.1:8802"), no pg_sync/worker/timeout errors in the journal;
  `GET /api/health` → `{"ok":true,"version":"0.1.0"}` (200) locally and via the
  public tunnel. Runtime behaviour is unchanged (the phase-(a) fix was already live;
  phase-(b) is tests + inert env seams).
