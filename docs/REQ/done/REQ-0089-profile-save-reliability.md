# REQ-0089 — profile save reliability (pg_sync worker recovery + client auto-save hardening)

State: done (merged 64e2cb6, deployed + verified live 2026-07-07).
Owner action that cleared this: user directive 2026-07-07 "project.md に従って修正して"
(large change authorised; no pre-merge review required).

## Symptom
"User profile save data is unstable" (ユーザー profile の save データが安定しない):
saved board state intermittently fails to persist, silently reverts, or the
last edit before a reload is lost.

## Root cause (three independent gaps in the save pipeline)
Persistence moved to a Postgres backend in REQ-0040 (STORAGE_BACKEND=pg, a
self-hosted Supabase reached through the Supavisor pooler on 127.0.0.1:6543).
The write itself (storage.writeProfile -> pg upsert) is atomic and correct;
the instability lives around it.

1. SERVER — fragile synchronous pg bridge (highest severity).
   server/pg_sync.cjs bridges storage.cjs's synchronous API to async pg via a
   Worker thread + Atomics.wait. The worker's pg.Pool had NO 'error' handler,
   so an error emitted by an IDLE pooled client (the pooler/Postgres dropping
   an idle connection — routine with Supabase/Supavisor) was an *uncaught*
   exception that killed the worker thread. pg_sync.cjs had no 'error'/'exit'
   handler and never cleared the dead worker reference, so EVERY subsequent
   profile read/write posted into a dead thread that never replied — blocking
   the caller (and the whole event loop) for the full 15s Atomics.wait timeout,
   on every request, until the process was manually restarted. (Consistent with
   the many manual backpack-api restarts in the journal.)

2. CLIENT — auto-save races / no retry / no exit-flush.
   client/src/store/autosave.ts debounced a background PUT after every mutation
   but: (a) its token guarded only the STATUS text, not write ORDER, so a save
   slower than the 800ms debounce plus a new mutation put TWO PUTs in flight and
   the server (last-writer-wins) could persist the OLDER one — the "stale
   in-flight auto-save resurrects pre-trade/destroyed state" race already called
   out verbatim in api.ts's market/ragnarok DTO docs; (b) a failed PUT went to
   'offline' and waited for the next mutation — if the user stopped, the edit
   was never persisted; (c) nothing flushed on page hide, so an edit inside the
   debounce window was lost on reload/close. Plus resolveProfileId() fell back
   to the 'default' alias whenever /api/me was momentarily unresolved, which the
   server 403s for a real guest — a silent dropped save.

3. HYGIENE — shared test/prod database.
   Every pg-mode test run (server test:pg, and pg-mode api boots from throwaway
   HOMEs) writes into the SAME profiles table, namespaced by sha256(REPO_ROOT).
   ~814 rows across ~180 non-live namespaces had accreted and were never cleaned
   (adds pooler/connection pressure that can trigger gap #1).

## Changes
(a) server/pg_sync_worker.cjs + server/pg_sync.cjs — commit ffde7c0
    - add the pg Pool 'error' handler (log+swallow; pool self-heals);
    - respawn the worker on 'error'/'exit' (drop the stale ref) and
      terminate+respawn a timed-out worker, so a DB blip self-heals instead
      of needing a restart; make the worker's reply path total.
(b) client/src/store/autosave.ts, api.ts, store/boot.ts, main.tsx — commit 493a1fc
    - single-flight pump() + coalesced trailing save (never two concurrent PUTs);
    - exponential-backoff retry (1s..30s) on failure;
    - initAutoSaveLifecycle(): keepalive PUT on pagehide / visibilitychange->
      hidden (saveCanvasBeacon);
    - resolveSaveProfileId()/refreshMe()/fetchMeWithRetry(): defer + re-resolve
      identity instead of PUTting a guest's canvas to 'default'.
(c) server/tool_prune_pg_profiles.cjs — commit 151b697
    - dry-run-by-default maintenance tool; deletes only NON-live-namespace
      profiles rows. Ran once (--apply): deleted 814 rows, profiles 1099 -> 285,
      live namespace (285) unchanged.

## Gates (all green)
- server unit tests (files backend): 153 passed / 0 failed.
- server unit tests (pg backend, STORAGE_BACKEND=pg): 153 passed / 0 failed.
- client typecheck (tsc -b): clean (exit 0).
- client lint (oxlint): 0 errors (pre-existing warnings only; none added by
  the changed files).
- DB prune verified: live namespace row count unchanged (285 -> 285).

## Deploy & verification (2026-07-07)
- Merged to master as 64e2cb6 (--no-ff). Art-session WIP in the working tree
  (content/vocab.json, tools/build_dungeon_preview.py, untracked proposals)
  left untouched -- no path overlap.
- backpack-api restarted (systemd --user): health {"ok":true}; no pg_sync/
  worker/timeout errors in the journal since restart.
- client rebuilt (pnpm build -> web/app): served /app/ HTML now references
  assets/index-DUwEg2eh.js.
- pg persistence round-trip through the DEPLOYED storage.cjs (STORAGE_BACKEND=pg):
  readProfile('dev') -> writeProfile('dev') -> readProfile('dev') all succeeded
  (schema_version=1, updated_at refreshed) -- the fixed synchronous worker path
  is healthy end-to-end.

## Follow-ups (not in this REQ)
- Retire the synchronous Atomics.wait bridge by making storage.writeProfile/
  readProfile async end-to-end (removes the event-loop-blocking per save).
- Point pg-mode tests at a dedicated throwaway database/schema so the prune
  tool becomes unnecessary (api_test.cjs is frozen; out of scope here).
