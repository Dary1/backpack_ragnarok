# REQ-0145b — Client refactor round 2 (dedupe + module splits, UI-REQ-safe)

**Reserved:** 2026-07-12 · **Slug:** client-refactor-r2 · **Branch:** `req-0145-server-client-refactor-r2`
**Origin:** user directive 2026-07-12 ("design refactoring for both server and client, file as REQ").
**Sibling:** REQ-0145a (server). Fully independent — either side may be implemented,
gated, and merged alone.
**Scope class:** internal-only. Zero visual/behavioral change (§3).
**User-ratified scope decisions (2026-07-12):** aggressive scope (shared hooks,
content cache, i18n/CSS splits, dead-CSS audit included) BUT files owned by in-flight
UI REQs are excluded (§2); REQ filed directly to `todo/`.
**Evidence measured 2026-07-14 @ master c83e5a3.**

## 日本語サマリ

クライアントは REQ-0047(f2) 以降も機能REQの積み上げで再肥大: `api.ts` 822行(全ドメイン
のエンドポイント関数がフラットに同居)、`i18n.ts` 1413行、`index.css` 5497行、
`WarehousePage.tsx` 974行。さらにページ間でヘルパーが重複実装
(localizedItemName ×2、first-fit配置 ×2、pulseTab ×2、時刻整形、POLL_MSパターン、
サーバー定数のクライアント側ハードコード)。本REQは見た目・挙動を一切変えずに、
バレル維持の api/ 分割、共有 lib/ 抽出、ポーリングhook・contentキャッシュ導入、
i18n/CSS のドメイン分割+死にCSS監査を行う。進行中UI REQ (0099 replay, 0125b/0126/
0140/0143 board系, 0156 artadmin) が所有するファイルは触らない。オラクルは
tsc + oxlint + e2e(既知失敗セット同一)+スクリーンショット。

## 1. Current state (evidence)

| File | LOC | Problem |
|---|---|---|
| `client/src/api.ts` | 822 | One flat module: fetch core + auth/token + ~45 endpoint fns for every domain (content, profile, schedule, warehouse, workshop, market, ragnarok, dex, dismantle, admin/registry) + bulk type re-exports. Grew 691 → 822 in two days (REQ-0151/0155 admin APIs). |
| `client/src/i18n.ts` | 1413 | Single flat dict (~1300 keys, en+ja) for every feature area. Every UI REQ appends here → permanent merge hotspot. |
| `client/src/index.css` | 5497 | Single global stylesheet, append-only since T0. Same merge-hotspot dynamic; suspected dead selectors. |
| `client/src/warehouse/WarehousePage.tsx` | 974 | Page shell + `TtlRing` component + first-fit placement algorithms + poll loop + claim flows in one file. |
| duplicated helpers | — | `localizedItemName` (Monitor.tsx, WarehousePage.tsx), `pulseTab` (WorkshopPage, WarehousePage), `firstFitPlace` vs `firstFitPlaceBp` (WarehousePage, WorkshopPage), `contentEntryFor`/`rewardVisual`, `formatClock`/`formatWarehouseCountdown`, hand-rolled `POLL_MS` + `useState`×N + `useEffect` poll pattern per page. |
| duplicated constants | — | `GRID_MIN`/`GRID_MAX`/`TAB_PULSE_MS` ×2; server values hardcoded client-side as display mirrors: `WAREHOUSE_CAP` (mirrors services/core), `GACHA_COMMON_BP_COST_DISPLAY` (mirrors services/gacha) — silent-drift risk. |
| redundant fetching | — | `fetchContent()` re-fetched per page (DexRoot, WarehousePage, Monitor), no client-side cache. |
| healthy already | — | store/ (5 slices, barrel), board/ partially split (0047 f2-3), engine adapter 39 LOC, shared/dto re-exports. |

## 2. Exclusions — files owned by in-flight REQs (DO NOT touch here)

| Files | Owner (state as of 2026-07-14) |
|---|---|
| `schedule/Monitor.tsx`, `schedule/MonitorRenderer.ts` | REQ-0099 settled-run replay (todo) — will restructure playback. (REQ-0097 master/detail is done/merged; 0099 is the remaining owner.) |
| `schedule/SchedulePage.tsx`, `schedule/RoomCard.tsx`, `schedule/CreateRoomForm.tsx` | Room-UI pipeline: REQ-0098 cooldown ring, REQ-0100 spoils rail (draft). Conservative exclusion. |
| `board/BoardRenderer.ts` (now 1627 LOC after REQ-0125a) + board render internals | REQ-0125b (draft), 0126 skin system, 0140 side-panel parity, 0143 overlay accessibility (todo). The known-debt `render()` stage split stays deferred to that rework. |
| `dex/Dex.tsx`, `dex/DexDetail.tsx` | REQ-0120 (built — merged, awaiting user acceptance). Code is on master but acceptance pending; leave untouched this round. |
| `artadmin/`, `contentadmin/` | REQ-0156 artadmin-ux-overhaul (todo, **concurrently in implementation** on its own branch, per user note 2026-07-14). Admin-surface additions to `api.ts`/`i18n.ts`/`index.css` are also expected from 0156 → see §5 sequencing. |

`WorkshopPage.tsx`, `DismantlePanel.tsx`, `warehouse/`, `market/`, `ragnarok/`,
`dex/DexAdmin.tsx` (verify 0156 diff does not touch it at implementation start) are
in scope.

## 3. Frozen contract (MUST NOT change)

1. Zero visual & behavioral change. Full e2e green with a failure set identical to
   the baseline recorded at implementation start (known pre-existing failures live
   in the docs; re-record, don't assume).
2. Engine consumed AS-IS via the adapter; store hook surface unchanged.
3. Import surfaces preserved via barrels: `api.ts`, `i18n.ts`, `store.ts` — no
   consumer import-path edits required anywhere (the 0047-f2 pattern).
4. Committed `web/app/` rebuilt only at merge via `tools/release.sh` (single dist
   commit); e2e via `pnpm run e2e` only (box-lock discipline).
5. `t()` lookup semantics, `TranslationKey` type surface, CSS cascade order —
   byte-preserved (gates in §4).

## 4. Design & phases

Each phase = its own commit series; move-only commits strictly separated from logic
edits; `tsc -b` + `oxlint` + affected e2e specs green per phase; full gate at merge.

**(ca) api client split** — `src/api/` :
`http.ts` (fetch core, `ApiError`, auth headers, token storage), `content.ts`,
`profile.ts`, `schedule.ts`, `warehouse.ts`, `workshop.ts`, `market.ts`,
`ragnarok.ts`, `dex.ts`, `dismantle.ts`, `admin.ts` (registry/artadmin/contentadmin
endpoints). `src/api.ts` becomes a barrel re-exporting today's exact value AND type
surface (incl. the `export type {...}` shared/dto re-export block). Pure move;
consumers untouched. **Sequenced after REQ-0156 merges** (0156 is appending admin
endpoints to `api.ts` right now).

**(cb) shared page-lib extraction** — `src/lib/` :
- `itemContent.ts`: `localizedItemName`, `contentEntryFor`, reward-visual resolution.
  Canonical impl here; WarehousePage/WorkshopPage adopt now. Monitor's local copies
  stay (excluded file) — leave a pointer comment for REQ-0099 to adopt on rewrite.
- `time.ts`: `formatClock`, `formatWarehouseCountdown`.
- `tabPulse.ts`: `pulseTab` + `TAB_PULSE_MS`.
- `placement.ts`: `firstFitPlace`, `firstFitPlaceBp`, `firstFitOrMergeTM` +
  `GRID_MIN`/`GRID_MAX`. **Gather-then-unify**: step 1 co-locates both impls
  verbatim; step 2 merges ONLY if a reviewed diff proves identical semantics,
  else both stay as documented named variants. Warehouse/workshop e2e specs cover
  both call sites.
- `shared/constants.cjs` (NEW, in `shared/`; + `shared/constants.d.ts`):
  `WAREHOUSE_CAP`, `GACHA_COMMON_BP_COST`. Server `services/core.cjs` and
  `services/gacha.cjs` switch their literals to this require (two one-line edits —
  deliberate small cross-package touch, gated by api_test both backends); client
  display mirrors import it. Kills the silent-drift risk. Dependencies point INTO
  shared/ — consistent with design rule.

**(cc) fetch/poll consolidation** — `src/lib/` :
- `usePolledResource.ts`: one hook for load + interval poll + error + manual reload,
  parameterized to reproduce each page's current interval and mount behavior
  exactly. Adopt in WarehousePage, WorkshopPage, MarketPage/BuyPane/SellPane,
  RagnarokPage/DevotionSection, DexRoot. NOT Monitor (excluded).
- `contentCache.ts`: `cachedFetchContent()` memoizing the `ApiContentPayload`
  promise + explicit `invalidateContentCache()`; DexAdmin's save path (and any
  admin content mutation) invalidates. Adopted by in-scope call sites only;
  `api.ts#fetchContent` itself stays uncached (Monitor keeps its direct call).

**(cd) page splits (in-scope pages only):**
- `WarehousePage.tsx` 974 → `warehouse/TtlRing.tsx`, `warehouse/useWarehouseData.ts`
  (poll + claim/claim-all state machine), placement/itemContent/tabPulse imports
  from `lib/`; page shell target < ~450 LOC.
- `dex/DexAdmin.tsx` 562 → extract `dex/adminForm.ts` (`effectToRow`, `rowToEffect`,
  `defaultEffectRow`, `numToStr`, form types); component keeps the UI.
- `WorkshopPage.tsx` 493 → adopts lib/ (placement, tabPulse, constants); further
  split only if trivially separable.

**(ce) i18n split** — `src/i18n/` per-domain modules
(`nav`, `canvas`, `dex`, `schedule`, `warehouse`, `workshop`, `market`, `ragnarok`,
`settings`, `admin`, `common`), each contributing `en`/`ja` key groups; `i18n.ts`
becomes the barrel merging modules (spread, `as const`) with `TranslationKey` = the
union — type-identical to today. `t()` untouched. **Gate:** a key-parity script
(old vs new: identical key sets AND identical values, en+ja both directions), run at
the split commit, result recorded here. A trailing note in `i18n.ts` tells future
REQs which module to extend. **Sequenced after REQ-0156 merges** (0156 adds admin
keys).

**(cf) index.css split + dead-CSS audit — LAST phase:**
- Split along existing section comments into `src/styles/{tokens,base,chrome,board,
  itempanel,dex,schedule,warehouse,workshop,market,ragnarok,overlays,admin,mjolnir}.css`;
  `index.css` becomes ordered imports ONLY. **Gate:** concatenation of the split
  files in import order == previous `index.css` body byte-for-byte (zero selector
  edits in the split commit); result recorded here. Landing-zone note at the tail
  tells future REQs which file to extend.
- Dead-CSS audit (separate follow-up commit): for each class selector, grep
  `client/src` for the literal + a dynamic-prefix allowlist (template-literal
  classnames); delete ONLY zero-reference selectors; every deleted selector listed
  in this file's execution log; e2e + screenshot pass afterward. Conservative by
  design.
- **Precondition:** no unmerged branch (incl. REQ-0156) with `index.css` edits at
  landing time — run `git branch --no-merged master` + per-branch
  `git diff --name-only` audit first.

**(cg) Docs.** `client/README.md` + `docs/llm_managed/architecture.md` (client map,
known-debt list) updated in the same commits as the changes they describe.

## 5. Sequencing

1. **(cb)(cc)(cd) may start immediately** — they touch no in-flight file.
2. **(ca) and (ce) after REQ-0156 merges** (it is appending to `api.ts`/`i18n.ts`
   now). Re-audit at that point.
3. **(cf) last**, behind the no-unmerged-`index.css`-branch precondition.
4. Adoption notes for the excluded files' owners: REQ-0099 (Monitor → lib/ helpers,
   usePolledResource), REQ-0125b/0126/0140/0143 (board), post-acceptance Dex —
   consume `src/lib/` + `src/api/` instead of local copies when they rewrite.
5. Each phase = own commit series; single dist rebuild at merge via `release.sh`.

## 6. Risk register

| Risk | Mitigation |
|---|---|
| firstFit unification drifts placement behavior | Gather-then-unify; merge only on proven-identical semantics; warehouse/workshop e2e cover both flows. |
| Poll-hook adoption changes timing/mount behavior | Hook parameterized per page to reproduce current intervals exactly; e2e asserts flows. |
| contentCache changes freshness semantics | Opt-in call sites only; explicit invalidation on admin mutations; `fetchContent` itself unchanged. |
| i18n merge breaks `TranslationKey` | Key-parity script both directions + tsc; barrel keeps the exported type name/shape. |
| CSS split reorders cascade | Import-order concat-equality gate; zero selector edits in the split commit. |
| Dead-CSS false positives (dynamic classnames) | Prefix-aware grep + conservative delete-list recorded + screenshot/e2e pass. |
| Conflict with REQ-0156 / future UI branches | §5 sequencing + pre-landing branch audits; excluded-file table §2. |
| `shared/constants.cjs` server touch regresses api | Two one-line requires, gated by api_test files+pg (run even though this is the client REQ). |

## 7. Acceptance criteria

- `pnpm run build` (tsc -b) + `oxlint` + full e2e green with baseline-identical
  failure set; screenshot fixtures unchanged.
- Grep gates (outside excluded files): zero duplicate impls of localizedItemName /
  pulseTab / first-fit / clock-countdown formatting; zero local
  `GRID_MIN|GRID_MAX|TAB_PULSE_MS|WAREHOUSE_CAP|GACHA_COMMON_BP_COST` literals.
- `api.ts` / `i18n.ts` / `index.css` are barrels/import-lists; largest non-excluded
  hand-written module < ~600 LOC.
- Key-parity and concat-equality gate outputs recorded in the execution log.
- README/architecture.md match the new layout; adoption notes delivered to the
  excluded files' owning REQs.

## Execution log & amendments

### 2026-07-14 — (cb)(cc)(cd) + docs implemented; (ca)(ce)(cf) blocked per §5

Branch `req-0145-server-client-refactor-r2`, base = master c83e5a3 (== the
spec evidence commit; worktree was already synced).

**Precondition audit (implementation start)**
- REQ-0156 NOT merged (`git branch --no-merged master`); its branch showed
  no api.ts/i18n.ts/index.css commits yet at audit time, but the §5
  sequencing stands → (ca)(ce) not started this round; re-audit at 0156
  merge.
- (cf) precondition FAILS independently of 0156: unmerged branch
  `req-0057-forecast-overlay` carries edits to ALL THREE hotspot files
  (api.ts / i18n.ts / index.css). (cf) must not land until that branch
  merges or is retired — needs an owner/user decision.
- Baseline full-e2e failure sets recorded vs the LIVE master build:
  - tunnel/serial (`pnpm run e2e`): 5 failed / 149 passed — artadmin:18,
    artinspect:21, dex-card:65, nav-routing:26, schedule:1065.
  - CI mode (local proxy :8803, E2E_PARALLEL=4, E2E_GPU=1 — the
    tools/ci.sh mode, used as THE comparison baseline): 7 failed /
    147 passed — the 5 above + contentadmin:37 + warehouse-mjolnir:203.

**Commits (each phase gated: tsc -b clean + oxlint 34 warnings 0 errors ==
pre-change master count, zero in new/touched files)**
- 40a858c (cb-1) move-only co-location: client/src/lib/{itemContent,time,
  tabPulse,placement}.ts + shared/constants.json; no consumers switched.
- 1aa5758 (cb-2) adoption: WarehousePage/WorkshopPage import lib/ + shared
  constants; server services/core.cjs + services/gacha.cjs switch their
  literals to the shared require (the ratified one-line edits);
  tsconfig.app.json gains resolveJsonModule. server api_test after this
  commit: 155/155 files backend, 155/155 pg backend.
- d3a20e1 (cc-1) lib/usePolledResource.ts + lib/contentCache.ts added, no
  consumers.
- 07185b1 (cc-2) adoption: WarehousePage (rows 5s poll + content/rooms/
  dungeons one-shots), MarketPage + RagnarokPage (composite initial loads,
  trackLoading mode), DexRoot (content+me); DexAdmin.save() invalidates
  the content cache before onSaved().
- d067f93 (cd) WarehousePage 733→476 LOC (useWarehouseData.ts data+claim
  machine + TtlRing.tsx, verbatim extractions); DexAdmin 562→496 LOC
  (dex/adminForm.ts: EffectRow/effectToRow/rowToEffect/defaultEffectRow/
  numToStr); WorkshopPage (435 LOC after cb): NO further split — nothing
  left is trivially separable (the roll flow is one coherent two-phase
  transaction). Spec allowed exactly this call.
- (this commit) (cg partial) client/README.md src/lib+constants section;
  docs/llm_managed/architecture.md client row; this log.

**Full e2e vs the WORKTREE build** (worktree `web/` served on :8901 per
the REQ-0142 recipe, E2E_STATIC_PORT=8901, CI mode): **6 failed / 148
passed** — artadmin:18, artinspect:21, contentadmin:37, dex-card:65,
nav-routing:26, schedule:1065. Strict SUBSET of the CI-mode baseline
(the 6 shared failures are spec-and-line identical to baseline = all
pre-existing). The baseline-only 7th failure (warehouse-mjolnir:203, the
REQ-0091 claim-flash timing test — exactly the refactored area) was
re-run serially against the worktree build: 5/5 passed, twice → parallel-
mode flake in the baseline run, not a regression. Failure-set-identical
gate: GREEN for the landed phases. Dist restored after the run (web/app
NOT committed — rebuild happens only at merge via release.sh, per §3.4).

**Grep gates (§7, landed phases)**: zero duplicate impls of
localizedItemName / pulseTab / first-fit / clock-countdown formatting
outside excluded files (only schedule/Monitor.tsx keeps its excluded-file
copies, with adoption notes for REQ-0099 in lib/time.ts +
lib/itemContent.ts); zero local GRID_MIN|GRID_MAX|TAB_PULSE_MS|
WAREHOUSE_CAP|GACHA_COMMON_BP_COST literals anywhere in client/src.

**Amendments (spec → as-built, with reasons)**
1. shared/constants.cjs + .d.ts → **shared/constants.json**. A CJS source
   file cannot be imported by Vite dev/build source pipelines (only
   node_modules CJS is converted); JSON is natively importable by BOTH
   node require() and Vite. Same single-source, kills the same drift.
2. (cc) adoption list pruned to measured reality @ c83e5a3: WorkshopPage
   fetches no mount resource (store-only reads); BuyPane/SellPane fetches
   are lifted into MarketPage; DevotionSection's preview fetch lives in
   RagnarokPage and is selection-driven, not a mount resource.
   DismantlePanel's modal-local ledger fetch left as-is (not in the spec
   list). No behavior to preserve was skipped; there was simply nothing
   to adopt at those sites.
3. Placement gather-then-unify verdict: **NOT unified** — the three
   first-fit variants drive different engine APIs against different
   record shapes (PO/SI push-check-rollback vs BP placeholder vs TM
   merge-fast-path). Kept as documented named variants in
   lib/placement.ts; verdict recorded in its module doc per spec.
4. contentCache invalidation wired into DexAdmin.save() (the only
   in-scope admin content mutation). artadmin/contentadmin (0156-owned,
   excluded) do not consume the cache today; adoption note for the 0156
   owner lives in contentCache.ts.
5. Excluded files untouched, as demanded: the REQ-0099/0098/0100 pointer
   comments live in lib/time.ts + lib/itemContent.ts instead of inside
   Monitor.tsx/RoomCard.tsx.

**Status / what remains for todo→built**
- DONE: (cb) (cc) (cd) (cg for the landed scope) + §7 grep gates + e2e
  failure-set gate for the landed scope.
- BLOCKED (ca)(ce): REQ-0156 must merge first (§5.2) — re-audit api.ts/
  i18n.ts ownership then.
- BLOCKED (cf): no-unmerged-index.css-branch precondition currently
  violated by req-0057-forecast-overlay (and 0156 until it lands).
  Decision needed from the owner/user on req-0057 (merge or retire).
- REQ stays in todo/ until (ca)(ce)(cf) land; this log is the resume
  point (re-run the precondition audit first).
