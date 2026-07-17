# REQ-0217 — Hermetic E2E: test runs never touch operational state

## Status
todo (ratified by user directive, 2026-07-17, chat: "普通に考えて、あるべき形に
再設計して、あなたが実装してください").

## Principle (binding)
An e2e run must never read or write ANY operational state: not the live
services (8801/8802), not the pg main namespace, not the repo's own
content/live or data/ trees, not the players registry. Everything a run
touches is a per-run throwaway built from the WORKTREE's code and COMMITTED
fixtures. E2E is virtual-data-only; the old "dev player == test player against
the real API, with backup/restore around the run" model (LLM-authored,
never a user decision) is retired.

## Incident driver
2026-07-17: full-CI e2e overwrote the live dev profile (pg) with fixtures.
Root causes, each closed here:
- proxy no-header /api fallback -> live 8802
- serial mode (E2E_PARALLEL unset) ran the whole suite against live
- global-setup/teardown hit live 8802 directly (clearDev* hooks) and
  backed-up/restored the live profile + content/live/live_{items,sis}.json
  (a files-era net that stopped covering pg)
- 2026-07-13 prior incident (dev/clear-all wiped the live registry) shows
  the same class recurring.

## Design
1. Fleet ALWAYS (tools/e2e_fleet.cjs): workers = max(1, E2E_PARALLEL).
   Serial mode = fleet of 1. Every worker request carries X-E2E-Worker.
2. local-proxy.cjs: /api with no worker header -> FLEET_BASE+0, NEVER 8802.
   Non-/app non-/api paths -> 404 (nothing may fall through to live web).
   /app stays served from the worktree build (REQ-0051 behavior).
3. global-setup: fleet boot + box-lock probe + guest ledger reset ONLY.
   Delete: profile/content backups, orphan-drift recovery, all four
   clearDev* live hooks (fresh homes make them meaningless), API_ORIGIN.
   global-teardown: fleet stop + ledger sweep ONLY (no restores).
4. e2e_fleet.cjs buildHome sources everything test-owned:
   - content: symlink/copy from THE WORKTREE (code under test), deleting
     the per-file "not yet on master" overlay hacks
   - data/config + data/profiles: from committed fixtures under
     client/e2e/fixtures/ (snapshot of the legacy files-backend seeds the
     suite already ran against), never from the live checkout
5. e2e-env.ts: E2E_CODE_ROOT = the worktree (not ~/backpack_ragnarok);
   data root always the worker home.
6. playwright.config.ts: default baseURL = http://127.0.0.1:8803 (local
   hermetic proxy); the public tunnel only via explicit PLAYWRIGHT_BASE_URL.
7. Defense in depth stays: REQ-0214's x-bpk-e2e-profile redirect remains on
   every context, so even a regression that reaches a live api lands on
   e2e_ci, never dev. Box lock (REQ-0117) stays (shared ports).

## Out of scope
- Admin e2e harnesses (artadmin/artinspect/contentadmin): already isolated
  (own HOME remap + REQ-scoped ports).
- Restoring the overwritten dev profile (separate user decision).
- The unexplained backpack-api restart at 04:08:34 during the incident run.

## Gates
- Full main e2e suite green under the hermetic harness (fleet-only).
- Invariant proof around the run: pg main-namespace row set (count + max
  updated_at + dev row updated_at) and mtimes of ~/backpack_ragnarok/data +
  content/live are IDENTICAL before/after.
- ci.sh mid-gates + client build.

## Log
- 2026-07-17 reserved as REQ-0217 (baace00) on branch req-0217-hermetic-e2e
  (stacked on req-0214-e2e-profile-isolation), ratified straight to todo.
