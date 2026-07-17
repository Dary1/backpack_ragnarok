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
2. ~~**Sweep the 277 orphan namespaces?**~~ **DONE** — owner go-ahead 2026-07-17. See §7.
   The estimate in §1 was low: it counted only `profiles` + `warehouse_items`. The real
   figure was **46 984 rows across 16 tables** (`schedule_rooms` alone held 12 970).
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


## 7. The sweep (done, 2026-07-17, on the owner's go-ahead)

**Result: 46 984 orphan rows deleted across 16 tables. The live namespace is provably
untouched. Profile namespaces went 278 -> 1.**

### Method

Columns were found by SCANNING the database (every text column whose values match
`^[0-9a-f]{16}:`), not by reading the storage code — code-reading misses a table, a scan
cannot. That found **21 namespaced columns across 16 tables**, several of which
(`schedule_rooms` at 14 471 rows, `market_furnace`, `sealed_seeds`, `bp_bio`) the §1
estimate had never counted.

Backup first: `pg_dump --schema=public -Fc` -> 310 MB at
`~/backpack_ragnarok_state/pg_backups/pre_ns_sweep_20260717_073815.dump`, verified
readable with `pg_restore -l` before a single row was touched. (`--schema=public` because
the `backpack` role cannot read supabase's `auth` schema — a full-cluster dump just errors.)

Three guards, all of which had to pass:
1. **Live-namespace sanity.** Refuse to run unless `88d662ca20e5289b` is still the LARGEST
   namespace in `profiles`. The constant is derived from a hardcoded path
   (`sha256(os.homedir() + '/backpack_ragnarok')[:16]`); if this box is ever re-pathed it
   goes stale and a sweep keyed on it would delete real data. Don't trust the constant —
   check it.
2. **In-flight protection.** Skip any namespace written in the last 15 minutes, so a
   concurrent pg api_test run cannot have its rows deleted mid-assertion.
3. **The one that matters: delete inside a TRANSACTION, re-count the live namespace in all
   16 tables, and ROLLBACK on a single row of drift.** Guard 3 passed; the commit followed.

Cross-column check first: for the five tables with two namespaced columns
(`market_listings.listing_id`/`seller_id`, `warehouse_items.item_uid`/`player_id`, …),
**0 rows disagreed** on their namespace — so keying deletion on one column cannot orphan
the other.

Was any non-live namespace real data? No. `profiles` split as 626 rows x 1 namespace
(live) then 28 x 32, 26 x 25, 16 x 83, 1 x 148 — uniform small epochs, the signature of
test runs. Nothing else looked operational.

### Verified after

Every live count identical to the pre-sweep figures (artworks 233, profiles 626,
schedule_rooms 1501, schedule_runs 1266, warehouse_items 32, … total **4 403**);
**remaining orphan rows: 0**; distinct profile namespaces **1**; `/api/content`,
`/api/profile/dev/canvas` 200; `backpack-web`/`backpack-api` healthy.

### What did NOT get reclaimed, and why it matters here

`VACUUM FULL` was **denied**: the tables are owned by `postgres`, not `backpack`. So the
files did not shrink — `schedule_runs` still occupies 301 MB for 1 286 live rows. Plain
`VACUUM` did run, so that space is now free for reuse and the debris cannot keep growing
the database; but reclaiming the physical ~300 MB needs the table owner (superuser) and an
ACCESS EXCLUSIVE lock on a live table. **Left for the owner to decide** — it is not
urgent (24% disk used, space is reusable).

This is itself an argument for §4: with a dedicated `backpack_test` database you `DROP
DATABASE` and the space is simply gone — no sweep script, no guards, no superuser, no
lock on a live table. **The sweep is a mitigation, not the fix.** It buys back what has
accumulated once; the leak keeps running until the pg test pass stops pointing at
production.
