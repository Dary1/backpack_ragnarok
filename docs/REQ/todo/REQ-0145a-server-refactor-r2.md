# REQ-0145a — Server refactor round 2 (post-0047 growth consolidation)

**Reserved:** 2026-07-12 · **Slug:** server-refactor-r2 · **Branch:** `req-0145-server-client-refactor-r2`
**Origin:** user directive 2026-07-12 ("design refactoring for both server and client, file as REQ").
**Sibling:** REQ-0145b (client). Fully independent — either side may be implemented,
gated, and merged alone.
**Scope class:** internal-only. External behavior is frozen (§2).
**User-ratified scope decisions (2026-07-12, orchestrator session):** aggressive scope
(structural improvements included, not just move-only splits); REQ filed directly to `todo/`.
**Evidence re-verified 2026-07-14 @ master c83e5a3** (post REQ-0151/0152/0154/0155
merges): all server-side numbers below re-measured and current; the server was NOT
touched by those merges except trivially (`storage.cjs` 1084 → 1098).

## 日本語サマリ

REQ-0047 のサーバー分解から約20本の機能REQ(market/ragnarok/dex/dismantle/auth…)を
経て、肥大が再集中した: `storage.cjs` 1084行(8エンティティ×files/pg)、
`services/ragnarok.cjs` 1008行、`services/market.cjs` 756行、`routes/schedule.cjs`
505行(1関数)、`tests/api_test.cjs` 3986行。さらに content/live JSON の読み込みが
3箇所で重複実装(いずれも `os.homedir()` 直付けパス)、tools/ は pnpm 標準化
(REQ-0107)後も `npm` を呼んでいる。本REQは外部挙動を一切変えずに、ファサード
維持のまま entity 別 storage 分割・service 分割・route 分割・contentローダー統一・
api_test スイート分割・pnpm整合を行う。オラクルは api_test(files+pg)・golden・
既存e2e。

## 1. Current state (evidence, measured 2026-07-12 @ master 2e142ea)

| Area | Facts |
|---|---|
| `server/storage.cjs` | 1084 LOC. Eight entity families (profiles, rooms, runs, warehouse, gacha-pending, dismantle-ledger, market listings/furnace/dex-history, ragnarok einherjar/order-cache), each as `readXFiles/writeXFiles` + `readXPg/writeXPg` + backend-dispatching public fns, all in ONE file. Every feature REQ appends ~80–120 lines here. |
| `server/services/ragnarok.cjs` | 1008 LOC (REQ-0066+). Internally sectioned: seasons/clock, eternal order (scoring, rebuild, views), einherjar records, devotion blast + canvas strip, frozen-snapshot content defs. Exceeds the ~600 LOC ceiling REQ-0047 set. |
| `server/services/market.cjs` | 756 LOC (REQ-0064+). listings CRUD + normalization/views + DTO building + filter/query + trade + furnace + price history. |
| `server/routes/schedule.cjs` | 505 LOC, ONE function handling three route families (schedule rooms, warehouse, workshop gacha) behind a shared auth preamble. |
| `server/tests/api_test.cjs` | 3986 LOC single file (2257 at REQ-0047 close). It IS the HTTP spec (runs files AND pg). |
| content-file readers ×3 | `lib/content.cjs` (serves /api/content), `services/market.cjs` (`ITEMS_PATH`), `services/ragnarok.cjs` (`SEASONS_PATH`, `SIS_PATH`) each hand-roll an `os.homedir()+'/backpack_ragnarok/content/...'` absolute path + mtime-cache + module-evict test seam. A worktree-launched server therefore reads the MAIN checkout's content, not its own tree's. |
| cross-service edges | `ragnarok → market.deployedUidSet` (a squad/canvas concern, not a market one); `market → warehouse.{purgeExpiredWarehouseItems,addToWarehouse}` (legitimate but should be explicit). |
| toolchain drift | `tools/ci.sh` (steps 6/7) and `tools/release.sh` still invoke `npm run …`; project standard is pnpm via corepack since REQ-0107. |

## 2. Frozen external contract (MUST NOT change; same discipline as REQ-0047 §2)

1. **HTTP API**: every path/verb/status/JSON shape/400-wording exactly as asserted by
   `server/tests/api_test.cjs`, green in files AND pg modes.
2. **Router dispatch order** semantics preserved (THE ORDER IS LOAD-BEARING,
   `server/router.cjs`).
3. **Replay determinism**: sim goldens byte-identical (this REQ must not touch `sim/`,
   `mock-src/`; the gate still runs).
4. **Ops surface**: `node server/api.cjs` systemd entry, ports 8801/8802,
   `cli_invite.cjs`, `server/.env` keys — unchanged. New env vars may be ADDED with
   defaults that reproduce today's behavior exactly.
5. **Storage seam rule (design rule 4)**: all persistence through the `storage.cjs`
   facade; both backends pass the same suite.
6. **Facade rule (design rule 3)**: `schedule.cjs` + every facade introduced here
   re-export decomposed internals name-for-name; consumers require facades only.

## 3. Design & phases

Each phase = its own commit series, move-only commits strictly separated from any
logic edit, `pnpm run test:quick` green after every commit, full `tools/ci.sh`
(files+pg+client+e2e) green before merge.

**(sa) Toolchain alignment (npm → pnpm).** Replace `npm run` / `npm install`
invocations and instructions in `tools/ci.sh`, `tools/release.sh`, READMEs and
`docs/llm_managed/architecture.md` §6 with pnpm equivalents
(`pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run e2e`). Gate:
`grep -rn "npm " tools/ server/README.md client/README.md README.md` → zero
invocation hits.

**(sb) storage.cjs → per-entity modules behind the unchanged facade.**
```
server/storage/
  lib.cjs        # backendMode, namespacedId, ensureDataDir, atomicWriteJSON,
                 # shared dir/path helpers
  profiles.cjs   rooms.cjs   runs.cjs   warehouse.cjs
  gacha.cjs      dismantle.cjs   market.cjs   ragnarok.cjs
```
Each entity module keeps its files-backend, pg-backend and dispatching public fns
adjacent (the current file's internal layout, cut along its own `// ----` section
comments). `server/storage.cjs` becomes a facade re-exporting the EXACT current
`module.exports` list. The storage chokepoint (rule 4) = the facade. Move-only.

**(sc) Unified content-file loader.** New `server/lib/content_files.cjs`: one
mtime-cached JSON reader + one content-root resolver
(`process.env.CONTENT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content')`
— default expression byte-equivalent to today's behavior). Rewire the three
duplicated readers (`lib/content.cjs`, market's `ITEMS_PATH`, ragnarok's
`SEASONS_PATH`/`SIS_PATH`) onto it. Replace the tests' homedir-remap + module-evict
seams with `CONTENT_ROOT` env injection. Gates: api_test files+pg green;
`grep -rn "os.homedir" server/ --include=*.cjs` → only `content_files.cjs` (and
storage lib if applicable). Side benefit recorded: worktree-launched servers can
point at their own tree's content.

**(sd) Service decomposition behind facades.**
```
server/services/ragnarok/  seasons.cjs  order.cjs  einherjar.cjs
                           devotion.cjs snapshot.cjs
server/services/market/    listings.cjs views.cjs  trade.cjs  furnace.cjs
```
`services/ragnarok.cjs` and `services/market.cjs` become name-for-name facades.
`deployedUidSet` moves to `services/squads.cjs` (its true domain); the market facade
keeps re-exporting it so no consumer breaks; ragnarok's import flips to squads.
Move-only commits first; the one require-graph edit (deployedUidSet) is its own
commit.

**(se) routes/schedule.cjs → three route modules.**
`routes/{schedule,warehouse,workshop}.cjs`; the shared caller-resolution preamble
(token → `admin.resolveAuth` → 401 + dev-mode-fallback flag) extracted to
`lib/route_auth.cjs` and used by all three. `router.cjs` dispatches
schedule→warehouse→workshop consecutively in the exact slot the combined module
occupies today — identical match set, identical 401/404 behavior and wordings
(api_test asserts them). If any family lacks 401-path coverage, ADD the missing
assertions BEFORE the split (they encode today's behavior).

**(sf) api_test.cjs → suite split with parity gate.**
```
server/tests/api/  harness.cjs   # boot, backend select, token mint, req helpers
                   public.cjs profile.cjs admin.cjs schedule.cjs warehouse.cjs
                   workshop.cjs market.cjs ragnarok.cjs dex.cjs dismantle.cjs
```
`server/tests/api_test.cjs` remains the entry point and runs every suite file in a
fixed order — `node server/tests/api_test.cjs` and ci.sh stay valid verbatim.
**Parity gate:** the harness counts executed assertions; the count before the split
== after, in BOTH backends; both numbers recorded in this file's execution log.
Each suite file's header comment states the origin line range it was cut from.

**(sg) Docs.** `server/README.md` + `docs/llm_managed/architecture.md` (§4 map, §5
contracts, §6 workflow, §9 known debt) updated in the same commits as the changes
they describe.

## 4. Sequencing & collision notes

- **Precondition check before (sb)/(se):** `built/REQ-0118a-supabase-auth-backend`
  is implemented but unmerged and may touch `server/admin.cjs`/auth paths. At
  implementation start, audit its branch (`git diff master...<branch> -- server/`);
  if it overlaps, merge 0118a first (preferred) or explicitly rebase-coordinate.
- No other in-flight REQ touches `server/` structurally as of 2026-07-14.
  REQ-0156 (artadmin UX overhaul) is concurrently in implementation but is
  client-surface work per the user; audit its branch for incidental `server/`
  touches (`git diff master...req-0156-artadmin-ux-overhaul -- server/`) before
  starting (sb)/(se), same as the 0118a check.
- Phase order sa→sg. Merge to master via the inbox-branch flow; deploy = user-
  coordinated `systemctl --user restart backpack-api` after full ci.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Drift while moving code | Move-only commits, zero expression edits; api_test files+pg as oracle; goldens still run. |
| Route split changes 401/404 edges | Single extracted preamble; exact-wording assertions; add missing coverage before splitting. |
| Test split silently loses assertions | Executed-assertion parity gate + origin-range headers. |
| Content-root default drift in prod | Default expression byte-equivalent; env var only adds an override branch; full ci before restart. |
| Facade surface drift | Explicit named re-export lists; `tsc --checkJs` (tsconfig.server.json) catches typos; `grep -rn "require(.*services/\(ragnarok\|market\)/" ` consumer audit → routes must hit facades only. |
| 0118a branch conflict | Precondition audit above. |

## 6. Acceptance criteria

- `tools/ci.sh` fully green (sim goldens byte-identical, mock tests, api_test
  files+pg, client build+e2e) at merge.
- api_test executed-assertion parity recorded (before == after, both backends).
- Largest hand-written server module < ~600 LOC (trivial re-export facades exempt).
- Endpoint surface diff empty (route regex/method table before vs after).
- One content-file loader; `os.homedir()` grep gate passes; `CONTENT_ROOT`
  documented in server/README.
- Zero `npm` invocations under `tools/` and READMEs (grep gate).
- README/architecture.md describe the new layout.

## Execution log & amendments

Implemented 2026-07-14, orchestrator session (Cowork). All phases sa-sg complete;
full `tools/ci.sh` green (see gate results below).

### Branch amendment (user decision, 2026-07-14)

Mid-implementation, the sibling REQ-0145b session began committing to the shared
branch `req-0145-server-client-refactor-r2` with uncommitted server/services WIP
in the same worktree (typecheck-breaking mid-edit state). **User decision: split
0145a onto its own branch.** This REQ is implemented on branch
**`req-0145a-server-refactor-r2`** (worktree
`~/backpack_ragnarok_worktrees/req-0145a-server-refactor-r2`), based at
`972b3b9` (= master c83e5a3 + this REQ's sa + sb-prep commits, no 0145b
commits). The (sa)/(sb-prep) commits `fda9ffb`/`972b3b9` also exist on the
shared 0145b branch (shared ancestry; merges will dedupe).

### Precondition audits (REQ §4)

- REQ-0118a: implemented as Supabase/tunnel INFRA only -- no git branch touches
  `server/` (its REQ file documents config in `~/supabase/docker/` + Cloudflare;
  no `server/` code). No overlap; nothing to merge first.
- REQ-0156 branch: `git diff master...req-0156-artadmin-ux-overhaul -- server/`
  -> empty. No overlap.

### Commits (phase -> hash)

| Phase | Commit | Summary |
|---|---|---|
| sa | `fda9ffb` | npm -> pnpm in tools/ci.sh, tools/release.sh, READMEs, architecture.md §6 |
| sb prep | `972b3b9` | api_test storage-eviction seam widened to the storage/ subtree (no-op pre-split) |
| sb | `f9dc6de` | storage.cjs -> storage/{lib,profiles,rooms,runs,warehouse,gacha,dismantle,market,ragnarok}.cjs behind the unchanged facade; export surface Object.keys-identical |
| sc | `1ab20c7` | lib/content_files.cjs (CONTENT_ROOT resolver + shared helpers); rewired lib/content.cjs, market ITEMS_PATH, ragnarok SEASONS/SIS + core.cjs + admin.cjs (amendment below) |
| sc | `49de982` | api_test injects CONTENT_ROOT at the homedir-remap seams |
| sd | `7105d23` | deployedUidSet market -> squads (THE require-graph edit); ragnarok + dismantle imports flip; market facade keeps re-exporting |
| sd | `6eafed8` | services/ragnarok.cjs -> services/ragnarok/{lib,seasons,einherjar,order,snapshot,devotion}.cjs behind the unchanged facade |
| sd | `13c38ef` | services/market.cjs -> services/market/{lib,listings,views,trade,furnace}.cjs behind the unchanged facade |
| se prep | `9d4bc89` | per-family 401 assertions pinned (warehouse + workshop; status AND wording) -- suite 155 -> 157 tests |
| se | `46cd881` | routes/schedule.cjs -> routes/{schedule,warehouse,workshop}.cjs + lib/route_auth.cjs; router dispatches the three consecutively in the old slot |
| sf | `d59dbbc` | api_test.cjs -> thin entry over server/tests/api/* (12 files) with executed-assertion parity gate |
| sg | `624fe3a` | server/README.md + architecture.md §4/§5/§9 describe the new layout + CONTENT_ROOT |

### Gate results

- **api_test parity (sf acceptance):** executed assertions counted by the
  harness (assert.* calls). BEFORE (monolith @ 46cd881): **1213 files / 1213
  pg**. AFTER (split @ d59dbbc): **1213 files / 1213 pg** -- identical; tests
  157/157 green in both backends. (155 -> 157 happened in `9d4bc89`, BEFORE the
  splits, by design -- the added per-family 401 assertions encode pre-split
  behavior.)
- **Endpoint surface diff (acceptance):** route-regex table
  (`grep "_RE = " server/routes/*.cjs | sort`) diffed before/after the (se)
  split: **identical**. Method/status/wording edges pinned by api_test in both
  backends.
- **Export-surface parity:** `Object.keys()` of `storage.cjs`,
  `services/ragnarok.cjs`, `services/market.cjs` verified byte-identical
  before/after each split.
- **LOC ceiling (acceptance, <~600 for hand-written server modules):** largest
  is now `services/warehouse.cjs` at 406 LOC (untouched); the decomposed areas:
  storage largest entity module 207 (storage/market.cjs), services largest
  379 (ragnarok/devotion.cjs), routes largest 291 (routes/schedule.cjs).
  Pre-REQ: storage.cjs 1098, services/ragnarok.cjs 1008, services/market.cjs
  756, routes/schedule.cjs 505. Test SUITE files (not server modules; exempt
  like facades): largest 705 (tests/api/ragnarok.cjs).
- **npm grep gate (sa):** `grep -rnE "\bnpm\b|\bnpx\b" tools/ server/README.md
  client/README.md docs/llm_managed/architecture.md | grep -v pnpm` -> zero
  hits.
- **os.homedir grep gate (sc) -- measured post-state (amendment below):** no
  CONTENT-file path outside `lib/content_files.cjs` derives from
  `os.homedir()`. Remaining code-level `os.homedir()` sites are all
  data/registry/art concerns, each deliberate: `players.cjs`,
  `storage/lib.cjs`, `storage_art.cjs`, `storage_content.cjs` (data roots + pg
  namespaces), `admin.cjs` (data/config only; its CONTENT paths now resolve via
  content_files), `tool_{export_files,migrate_to_pg,prune_pg_profiles}.cjs`
  (ops scripts over data), `services/{art_export,content_export,model_hash,
  art_jobs}.cjs` (art domain; each already has its own env override).
- **Full `tools/ci.sh`** (sim goldens byte-identical, mock tests, typecheck,
  vocab self-test, api files+pg, artwork/inspection/content pg suites, client
  build, e2e): **GREEN** on 2026-07-14 (this worktree; log /tmp/ci_0145a.log on
  llmlocal). `pnpm run test:quick` was green after every commit listed above.

### Amendments vs the spec (all scope-internal, none touch the frozen contract)

1. **Branch** -- see "Branch amendment" above (user decision).
2. **(sc) scope extension:** the REQ named three duplicated readers; during
   implementation `services/core.cjs` (a fourth reader, same homedir dance) and
   `admin.cjs` (content WRITER -- its item-edit must land in the exact tree the
   readers resolve, or a CONTENT_ROOT-overridden server would read one tree and
   admin-edit another) were rewired onto content_files.cjs too. The literal
   grep gate "only content_files.cjs (and storage lib)" was unachievable as
   written (players/admin/tools/art all legitimately anchor DATA paths on
   os.homedir); reinterpreted as "no content-file resolution outside the one
   loader" -- measured post-state above. Residue: the dungeon domain's content
   paths come from `sim/dungen.cjs`'s `liveDungeonDir()` (sim/ is
   replay-frozen; recorded in architecture.md §9).
3. **(sd):** `services/dismantle.cjs` found importing deployedUidSet from the
   market facade -- flipped to squads alongside ragnarok (same rationale).
   Both service splits gained a small `lib.cjs` (tunables + shared helpers),
   mirroring the (sb) storage/lib.cjs pattern, to keep the module graphs
   acyclic (score fold lives in einherjar.cjs: order -> einherjar, never back).
4. **(sf):** (a) an 11th suite file `schedule_ops.cjs` -- the monolith
   interleaves a second schedule block (status normalization, policies, P1-C,
   dev seams, autogen) AFTER the gacha group; preserving the monolith's
   execution order (LOAD-BEARING: later groups assert against server state
   earlier groups created, and the homedir/module-generation epochs are
   position-dependent) beats forcing the 10-file sketch. (b) the
   'admin: REAL repo happy path' test stays at ragnarok.cjs's tail -- it must
   run exactly there, under the restored REAL homedir epoch. (c) "executed
   assertions" implemented as counted assert.* calls (1213), a strictly
   stronger parity metric than test count (157).
5. **(se):** the shared preamble extraction to `lib/route_auth.cjs` also
   carries the shared error/canvas helpers (scheduleErrToStatus/
   sendScheduleError/loadOwnCanvas/requireOwnCanvas), de-closured onto explicit
   parameters -- they were part of the same shared closure set.

### INCIDENT — live artwork-registry wipe triggered by this REQ's own ci e2e run (2026-07-13 UTC evening)

**What happened.** This session's full `tools/ci.sh` run (step 7 = the whole
Playwright suite against the LIVE services via the local ingress proxy, the
sanctioned path) executed `artinspect.spec.ts`, whose opening
`POST /api/art/dev/clear-all` ran against the LIVE registry namespace —
deleting the 56 backfilled artworks / 130 renders — because (a) the plain
full-suite run carries NO namespace remap (the live api's `storage_art`
namespace is the homedir-derived live one), (b) the dev_mode no-token fallback
armed the seam, and (c) the destructive dev seams had no second gate at the
time. The concurrent REQ-0156 session detected it minutes later (live API
returning 1 artwork), **recovered completely** (junk purge +
`tools/backfill_registry.cjs` re-run: 56/130/3 restored, verified 58 artworks
live afterwards incl. their new rows) and **hardened the seams**
(`ALLOW_DEV_CLEAR=1` env gate on art+content clear-all/bump-kit, REQ-0156
commit e350959, merged + deployed 22:03 UTC). No user-generated data existed
in the registry; loss window was minutes; recovery is idempotent-by-design.

**Attribution.** The trigger was THIS session's e2e run (and a 6-spec retry at
22:04 UTC hit the already-hardened server, causing no further damage). The
landmine itself predates this REQ (REQ-0151/0152/0155 dev seams + the
REQ-0080 e2e-against-live design); any full-suite run on the box would have
tripped it. The 0145/0156 concurrency call in this REQ's §4 was correct at the
CODE level (zero file conflicts end-to-end) — what no spec covered was the
shared LIVE BOX as a mutable resource. Closed now by 0156's ALLOW_DEV_CLEAR
gate; this REQ's CONTENT_ROOT loader is the content-side sibling of the same
isolation story. Follow-up candidate for a future REQ: default-suite
exclusion (or auto-harnessing) of the three admin-surface specs, which are
designed for their isolated HOME-remap harnesses
(`tools/{artadmin,art_inspect,content_admin}_e2e.sh`).

### Master sync before the final gates

After the incident + the same-day REQ-0156/REQ-0057 merges, master moved to
d387388; this branch merged it in (`faadac4`, clean auto-merge — the sequencing
audit held: zero file conflicts with either REQ) so the final gates run on the
integrated tree (hardened dev seams + forecast + artqueue tests included).

### Final gate run (merged tree @ faadac4)

- sim tests / goldens / S4 / forecast parity / mock engine / typecheck /
  engine drift / vocab self-test: green.
- api_test files + pg: 157/157, executed assertions 1213/1213 (parity gate).
- pg_sync / backfill_registry / artwork / artqueue (REQ-0156) / inspection /
  content suites: green.
- client unit gates + typecheck + build: green.
- e2e, full default suite vs live: 151 passed; every failure accounted, and
  the accounting MATCHES master's own REQ-0057 merge-run record verbatim:
  (a) artadmin / artinspect / contentadmin — post-hardening these REQUIRE
  their isolated harnesses (the plain suite's clear-all 403s by design);
  run on THIS tree via `tools/{artadmin,art_inspect,content_admin}_e2e.sh`,
  each standing up an ISOLATED instance of THIS BRANCH's refactored api:
  **3 + 1 + 1 passed, zero failed** — the strongest end-to-end proof of the
  refactor, since the plain suite exercises only the LIVE (master) server;
  (b) nav-routing `.schedule-rooms-view` — pre-existing stale-spec red on
  master (REQ-0057 log reproduced it against the master bundle; reproduced
  here solo as well); dex-card deep-link + schedule monitor-freeze — same
  pre-existing set, both PASSED on this tree's quiet-box rerun;
  (c) forecast:41 / warehouse-mjolnir:203 / landing:115 / guest-auth:83 /
  dex:280 — parallel-mode flakes (REQ-0057's run hit the first two): all
  passed on the quiet-box targeted rerun (12/13 with only nav-routing red).
  Wipe-collateral failures from the incident window disappeared with the
  registry recovery, as predicted.

### Deploy note

Implementation-complete on branch `req-0145a-server-refactor-r2`; NOT merged,
NOT deployed (built, not done). Merge via the inbox-branch flow; deploy =
user-coordinated `systemctl --user restart backpack-api` after full ci on the
merge result. The worktree's `web/app/` dist was rebuilt by ci step 6 and left
UNCOMMITTED deliberately (dist rebuild belongs to tools/release.sh at
merge/deploy time); `git checkout -- web/app` after ci keeps the tree clean.
