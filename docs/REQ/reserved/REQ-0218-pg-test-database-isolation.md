# REQ-0218 — A real test database: pg isolation for api_test (and for migrations)

## Status
draft — the DESIGN below is not ratified. Raised by the user (2026-07-17, chat:
「テスト用のDBのクローンも必要なのではないですか？(Postgres)」) after REQ-0215's
gate run exposed the problem. Needs an owner decision before work starts (§5).

## 1. The user is right, and here are the numbers

Every `STORAGE_BACKEND=pg` test run — `server/tests/api_test.cjs`'s pg pass, which
`tools/ci.sh` step [3/8] runs on EVERY full CI — points at the LIVE Postgres, because
`DATABASE_URL` has exactly one value on this box. Measured against it on 2026-07-17:

| table | live-namespace rows | test-debris rows |
|---|---|---|
| `profiles` | 626 | **2 870** (across **277** distinct test namespaces) |
| `warehouse_items` | 32 | **8 700** (99.6% debris) |

Database size: **544 MB**, overwhelmingly test debris. Each api_test epoch leaks ~28
profile rows plus its warehouse/room/run rows, permanently — nothing ever deletes them.

## 2. Why row-namespacing is not the answer people think it is

`server/storage/lib.cjs`: `NAMESPACE = sha256(REPO_ROOT)[:16]`, and every id is stored
as `<ns>:<id>`. Tests get a distinct namespace because the harness fakes `os.homedir()`
to a tmpdir (`harness.cjs`'s tmpHome epoch), so `REPO_ROOT` — which is
`path.join(os.homedir(), 'backpack_ragnarok')`, hardcoded, NOT the worktree path —
moves with it.

That works, for what it does. But it buys row isolation and NOTHING else:

1. **No cleanup.** A namespace is invented per run and abandoned. Hence the table above.
   This is not hypothetical debt: `services/warehouse.cjs`'s `devClearWarehouse` doc
   records that accumulated pg rows already broke e2e once by pushing the dev player
   into the 200-row `WAREHOUSE_CAP`. That route exists to paper over THIS.
2. **No schema isolation — and this is the sharp edge.** DDL has no namespace. REQ-0215
   adds `server/migrations/020_drop_gacha_pending.sql`; a `DROP TABLE` cannot be scoped
   to a namespace, so it cannot be tested at all, and applying it is a live-schema event.
   That is exactly why 020 shipped UNAPPLIED with a "coordinate with the owner" note.
3. **Migrations are untested, full stop.** There is no runner in-repo and no test DB to
   run one against, so `server/migrations/*.sql` — 20 files — are hand-applied prose. A
   migration that is wrong is discovered in production.

Rule 4 says "both backends must pass the same api_test suite". Today that gate is paid
for by writing test rows into the production database on every CI run.

## 3. Not covered by REQ-0217

REQ-0217 (hermetic e2e, in flight) retires the live-services e2e model and gives each
worker a fresh HOME — hence a fresh namespace. That closes e2e's *row* exposure and is
strictly good. It does not touch this REQ:
- its scope is **e2e**; `api_test`'s pg pass is not e2e and is not mentioned;
- a fresh namespace is not a fresh **database** — the debris and the DDL problem both
  survive it unchanged;
- its "Out of scope" list does not mention the DB.

The two are complementary: 0217 stops e2e writing operational state; 0218 stops the
whole test estate living inside the operational database.

## 4. Proposed design (NOT ratified)

A dedicated test database on the same self-hosted Postgres, built from the migrations and
thrown away:

1. `TEST_DATABASE_URL` (new; `server/.env.example` documents it). When set, the pg test
   pass uses it and NEVER `DATABASE_URL`. When unset, the pg pass SKIPS with a loud
   message rather than silently falling back to live — the current failure mode is that
   a missing var means "use production", which is exactly backwards.
2. `tools/pg_test_db.sh` (new): `create` drops + recreates `backpack_test`, then applies
   `server/migrations/*.sql` in lexical order; `drop` removes it. Wire `create` into
   `tools/ci.sh` before step [3/8] and `drop` after.
3. **This makes migrations a tested artifact for the first time** — a broken migration
   now fails CI instead of production, and REQ-0215's 020 gets a real verdict.
4. A guard in the harness: refuse to run in pg mode if the target DB's namespace set
   contains the live namespace (`88d662ca20e5289b`). Cheap, and it makes "tests hit
   production" structurally loud rather than silent.
5. Separately (own commit, reversible): a one-shot sweep of the 277 orphan namespaces.
   ~11 500 rows across profiles/warehouse_items/rooms/runs. Deletion is by namespace
   prefix and the live namespace is a literal allow-list of one.

Alternative considered — per-run SCHEMA (`search_path`) instead of per-run database:
lighter and faster, but it keeps tests inside the production database, so a `DROP`/`ALTER`
mistake still lands there. Rejected for the same reason a namespace is not enough.

## 5. Decisions needed from the owner

1. **Create `backpack_test` on the live Postgres instance?** Same server, separate
   database. Cheap, but it IS a change to live infrastructure (PROJECT.md:
   coordinate-first), so it is the owner's call, not an LLM's.
2. **Sweep the 277 orphan namespaces (~11 500 rows)?** Reclaims the bulk of 544 MB. The
   live namespace is untouched by construction. Yes / no / dry-run-first.
3. **Priority vs REQ-0217.** They do not conflict (different files, complementary
   scopes), but both touch the test estate; sequencing is worth a word.

## 6. Incident that surfaced this (recorded, not litigated)

Reaching for REQ-0215's e2e verdict, I started the suite from the REQ-0215 worktree. The
suite is not hermetic (REQ-0217's whole subject): its baseURL is the public tunnel, so it
drove the LIVE services, which run `STORAGE_BACKEND=pg`. I killed it within ~40s, then
checked `data/profiles/default.json` by sha256, found it byte-identical to the run's
backup, and reported "no damage" in REQ-0215 §6.

**That check was wrong and the claim was false.** `default.json` is the FILES-backend
copy; the live service reads pg. The live `88d662ca20e5289b:dev` profile shows
`updated_at 2026-07-17T05:28:56Z` — inside my run's window. I wrote the live dev profile.
The e2e backup/restore net is files-era and does not cover pg — precisely REQ-0217's own
incident driver, which I had not yet read when I started the run.

Mitigating, but not exculpating: REQ-0217 records that the SAME profile was already
overwritten earlier the same day by the full-CI incident, and lists restoring it as a
separate owner decision — so my write landed on an already-lost profile rather than
destroying a good one. No pg backup exists to restore from either way (the `/tmp/*.json`
backups are all files-backend).

REQ-0215 §6 has been corrected to say this. Lesson, and the reason this REQ exists: on
this box "a test" and "production" are the same Postgres, so there is no safe way to be
casually wrong.
