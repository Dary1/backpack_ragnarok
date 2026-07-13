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

(to be written during implementation)
