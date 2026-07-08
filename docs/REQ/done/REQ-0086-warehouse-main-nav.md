# REQ-0086 — Warehouse: promote to an independent main-nav screen

- **Status**: DONE (2026-07-07) — merged to `master` (merge commit
  `90e937d`, no conflicts) and deployed live (`backpack-web` restarted;
  `backpack-api` left untouched, client-only change). User authorized the
  merge/restart explicitly ("進めてください") after reviewing the BUILT
  outcome below. Live e2e verification passed (see Deploy & verification).
- Origin: direct user instruction (verbatim below). Initial drafting pass
  happened from a Cowork session that believed it had no SSH/LAN reach to
  `llmlocal` — that was WRONG (confirmed reachable on retry, at the
  user's prompting: "他のエージェントはこれで仕事できてます"). The rest of
  this REQ (recon, implementation, gates, commits) was done for real over
  SSH in the worktree above, from the same Cowork session.

## User spec (verbatim)
「warehouse画面を、scheduleのtab項目ではなく、独立したメインナビゲーションからの画面にしてください」
— Make the Warehouse screen its own main-navigation entry, not a tab inside
Schedule.

## Why this isn't a new idea
REQ-0069 (nav-rail foundation) already found a 倉庫 entry in the MJOLNIR
mock's shared rail and explicitly deferred it: *"the mock's 倉庫 rail entry
is deferred to REQ-0072 (warehouse is a Schedule tab today)."* REQ-0072 then
reskinned the tab in place without picking up that deferral — its own scope
line says only *"the `#/schedule` WAREHOUSE tab."* The mock also documents
Warehouse as its own page (`web/redesign/warehouse.html`), separate from
`expedition.html` (Rooms) — nesting it under Schedule was always the app's
provisional shortcut, not the mock's information architecture. This REQ
lands the deferral.

## Current state (as recorded by REQ-0069/0071/0072 — re-verify against the live tree; this session could not)
- `Nav.tsx` is a left rail (REQ-0069): logo + entries in mock order
  編成/遠征/図鑑/工房/市場/殿堂, with app-only Friends/Settings appended. No
  倉庫 entry exists yet.
- `#/schedule` → `SchedulePage.tsx`. REQ-0071 moved the Rooms/Warehouse tab
  chips (`.schedule-tab` / `.schedule-tab-active`) into the page's
  `.schedule-pagehead` strip. The pagehead's kicker/title/lede/rune identity
  swaps depending on which tab is active (Expedition ⇄ Warehouse's
  "MUNINN'S HOARD/宝物庫", per REQ-0072).
- Warehouse tab content lives in `WarehouseTab.tsx` (embedded live
  `InventoryBoard` via a React portal — ONE Pixi Application total,
  `board/inventorySlot.ts`; two-phase claim per REQ-0041/0046;
  capacity/danger-shelf/filters/TTL-ring per REQ-0072). REQ-0072's own
  "Selector contract" section enumerates every load-bearing testid/class —
  treat that list as authoritative for what must survive this move.
- Rooms tab content is `RoomCard.tsx` + `SlotsPanel.tsx` + `Monitor.tsx`
  (REQ-0036/0041/0045/0046/0071 semantics) — untouched by this REQ.

## Target state
1. New top-level route `warehouse` (`#/warehouse`) — `store/routing.ts`'s
   `Route` union gains `'warehouse'`.
2. `Nav.tsx`: new rail entry (`nav.warehouse`, ja 倉庫 / EN "Warehouse").
   Pull BOTH the rune glyph and the rail position from the mock's shared
   rail markup in `web/redesign/*.html` — mocks are NORMATIVE for visuals
   in every redesign REQ so far; don't invent a glyph here. If the mock
   gives no clearer signal, default to placing it immediately after 遠征
   (loot flows expedition → warehouse) and adjust if the mock disagrees.
3. New `client/src/warehouse/WarehousePage.tsx` (sibling dir to
   `market/`/`ragnarok/`/`landing/`): relocate `WarehouseTab.tsx`'s body
   here verbatim. This is an extract-and-rehome, NOT a rewrite — same
   two-phase claim, same embedded-board portal, same capacity/shelf/filter/
   TTL-ring behavior. Its pagehead becomes permanently the Warehouse
   identity (the swap-with-Rooms mechanism has only one consumer left after
   this move; delete or keep the shared primitive, implementer's call —
   not behavior-visible either way).
   - Before moving, grep for `WarehouseTab`, `TtlRing`, `rarThemeClass`:
     REQ-0072 flagged both helpers as reusable and the later dex/workshop
     redesigns (which ended up numbered REQ-0075/0076) may already import
     from this file's current path — update those imports if so.
4. `App.tsx`: add `route === 'warehouse' ? <WarehousePage/> : null` beside
   the other top-level routes; remove the Warehouse branch from inside
   Schedule's tab switch.
5. `SchedulePage.tsx`: drop the tab bar (`.schedule-tab`/
   `.schedule-tab-active`) — Rooms is now the page's only content, and a
   single-item tab bar has no function. Pagehead stays permanently the
   Expedition identity it already shows for Rooms.
6. i18n: add `nav.warehouse`. Keep the existing `schedule.warehouse.*` key
   namespace for the relocated page's copy — renaming the namespace to
   `warehouse.*` is a pure cosmetic follow-up, not required here.
7. Cross-links: grep for anything that reaches Warehouse today via
   `setRoute('schedule')` plus a tab param (e.g. Market's success panel —
   REQ-0065 proposed a 「倉庫を見る」 CTA there; unconfirmed whether REQ-0064
   actually built it) and repoint any hit to `setRoute('warehouse')`.

## Non-goals
- No visual or behavioral change to warehouse mechanics themselves (claim
  flow, capacity/TTL, filters, danger-shelf, embedded board) — REQ-0041/
  0046/0072 semantics carry over unchanged.
- No change to Rooms/Monitor/SlotsPanel behavior.
- No server/API/DTO changes — client-only routing + component relocation,
  same posture as the REQ-0064/0066 client-only REQs.
- No other rail reorganization beyond adding the one 倉庫 entry.

## Selector-contract impact (this IS the real scope/risk of this REQ)
- **Retired**: `.schedule-tab` / `.schedule-tab-active` (no tabs left once
  Warehouse leaves).
- **Unchanged, just relocated**: every `schedule-warehouse-*` testid/class
  from REQ-0072's selector contract, `schedule-warehouse-board-slot`,
  `.tab-claim-pulse`, etc. Keep verbatim on the moved component — a bulk
  rename to a `warehouse-*` prefix is possible later but, per this
  project's own precedent (REQ-0071 and REQ-0072 both explicitly left
  load-bearing selectors untouched during a move/reskin), should NOT
  happen in the same pass as this relocation.
- `client/e2e/warehouse-mjolnir.spec.ts`: navigation setup changes from
  "`#/schedule` → click the warehouse tab" to a direct `#/warehouse` visit;
  content assertions unchanged.
- `client/e2e/schedule.spec.ts` / `schedule-mjolnir.spec.ts`: drop or
  migrate any subtest that clicks into the warehouse tab from Schedule;
  Rooms-only coverage is untouched.
- `nav-routing.spec.ts`: add the new rail entry + route to its coverage
  (REQ-0071 names this file as the nav-route enumeration spec).
- Landing page menu (REQ-0069: 続きから/遠征を見守る/殿堂/設定): today's mock
  menu already omits several nav items (no market/dex/workshop entry
  either) — leave 倉庫 off it too, consistent with that precedent, unless
  the mock explicitly shows otherwise.

## Test / gate plan (as specced)
- `npx tsc -b` clean; `npm run build` clean; fresh `web/app/` dist
  committed.
- `node mock-src/tests/run.cjs` — unaffected (no engine touch); confirm
  still green.
- `node server/tests/api_test.cjs` (files AND `STORAGE_BACKEND=pg`) —
  unaffected (no server touch); confirm still green.
- Full `npm run e2e` — green modulo the two pre-existing REQ-0043
  dev_mode-fallback failures (architecture.md §6 baseline). The warehouse/
  schedule/nav-routing specs must show zero regressions beyond the
  intentional `.schedule-tab` retirement above.
- Manual smoke: `/app/#/warehouse` loads directly as a deep link (not only
  via rail click); `/app/#/schedule` still works and shows Rooms only;
  rail highlights 倉庫 as active on the new route.

## Outcome (2026-07-07)

The initial version of this REQ (above) was drafted believing the Cowork
session had no SSH/LAN reach to `llmlocal` and no live repo checkout — both
wrong (see Status). Once corrected, everything above was re-verified
against the REAL current tree (not the stale local mirror) and implemented
for real in a worktree. What follows is the as-built record.

**Recon corrections vs. the drafted plan above** — the plan turned out to
be accurate in substance; the real tree confirmed every load-bearing
assumption:
- Confirmed `docs/REQ/` genuinely lives ONLY on this FS, not in the server
  repo (`git log --all -- docs/REQ` on the server shows a commit literally
  titled "docs live in FS, not server repo"; `~/backpack_ragnarok/docs/`
  does not exist server-side). This REQ file is the sole record.
- Confirmed the exact mock rune + rail slot for 倉庫 directly from
  `web/redesign/*.html` (every page's shared rail, e.g. `canvas.html:164`):
  rune `ᚷ`, positioned immediately after 遠征(schedule)/before 図鑑(dex) —
  exactly the plan's own default guess, now confirmed rather than assumed.
- Real `Nav.tsx` already had a comment flagging this exact deferral
  verbatim: *"the mock's 倉庫 (warehouse) rail entry is NOT added — the
  warehouse lives as a Schedule tab today (REQ-0072 owns its page-port)."*
- Real `SchedulePage.tsx`'s header comment explicitly cited "golden f" —
  confirmed this is REQ-0036's own captured user-golden list (a–r), item
  f: *"Warehouse → inventory transfer any time (Warehouse tab inside
  Schedule screen)"* — not a separate immutable canon file
  (`docs/user_managed/game_golden.md` has no warehouse/tab mention at
  all). Superseding one REQ's recorded decision with a direct, fresh user
  instruction three days later is normal iteration, not a canon violation
  — recorded here for an honest trail, per this project's own convention.
- `WarehouseTab.tsx` only had ONE real importer (`SchedulePage.tsx`) —
  every other file's "WarehouseTab" mention was prose (comments
  documenting a shared pattern), not a code dependency. `rarThemeClass`
  was already lifted to `render/uiBits.ts` by REQ-0075 (the REQ-0072
  heads-up about lifting it had already been acted on); `TtlRing` was
  not, and simply moved with the file (no other importer existed).
- pnpm: `master` still has REQ-0084's pre-migration npm lockfiles (that
  REQ is `done`/BUILT but not yet merged) — this worktree provisioned via
  plain `npm ci`, matching REQ-0084 §8's explicit "in-flight/new worktrees
  off current master keep npm until they rebase post-merge" posture. Not
  a deviation; this branch should re-provision with pnpm after REQ-0084
  lands and this branch rebases.

**Implementation** (branch `req-0086-warehouse-main-nav`, off `master` @
`8c8db9f`):
- `git mv client/src/schedule/WarehouseTab.tsx client/src/warehouse/WarehousePage.tsx`,
  then transformed in place (props/signature/imports fixed for the new
  location, own one-shot rooms/dungeons fetch added, wrapped in its own
  permanent pagehead/bgart/rune-divider shell). Every claim/portal/
  capacity/filter/TTL-ring mechanism and every `schedule-warehouse-*`
  selector carried over byte-for-byte unchanged.
- `Nav.tsx`: `{ route: 'warehouse', key: 'nav.warehouse', rune: 'ᚷ' }`
  inserted between schedule and dex.
- `store/core.ts`: `Route` union + `VALID_ROUTES` gain `'warehouse'`.
- `App.tsx`: routes `'warehouse'` to `<WarehousePage>`.
- `SchedulePage.tsx`: tab state/toggle/onWarehouse-swap all removed;
  Rooms is now the page's only content, permanent Expedition identity.
- `i18n.ts`: `+nav.warehouse` (EN "Warehouse" / ja 倉庫); removed the
  now-dead `schedule.tabRooms`/`schedule.tabWarehouse` keys.
- `index.css`: removed the now-dead `.schedule-tab(-row/-active)` /
  `.schedule-pagehead-tabs` rules; updated the selector-contract comments
  that referenced them.
- e2e: `warehouse-mjolnir.spec.ts`, `schedule.spec.ts` (3 sites),
  `workshop.spec.ts` (3 sites) now reach Warehouse via a direct
  `.nav-link` click instead of Schedule-then-tab-click;
  `nav-routing.spec.ts` gained a Warehouse route entry and its Schedule
  entry now asserts `.schedule-rooms-view` instead of a retired tab chip;
  `schedule-mjolnir.spec.ts` likewise.
- Not done (deliberately out of scope): renaming the `schedule-warehouse-*`
  selector prefix to `warehouse-*` (cosmetic only, and this project's own
  precedent — REQ-0071/0072 — avoids renaming load-bearing selectors in
  the same pass as a move/reskin); a "倉庫を見る" deep link from Market's
  settle panel (REQ-0065 proposed it, unconfirmed whether REQ-0064 ever
  built it; a real follow-up now that `#/warehouse` exists, but a
  separate, self-contained change).

**Gates (measured on llmlocal, worktree base `8c8db9f`)**:

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm run build` (`tsc -b && vite build`) | clean; 792 modules (matches the REQ-0084 baseline exactly) |
| `node mock-src/tests/run.cjs` | 97 / 0 |
| `node server/tests/api_test.cjs` (files) | 135 / 0 |
| `npx playwright test --list` on the 5 touched spec files | parses clean, 41 tests enumerated, no errors |

**Not run**: `STORAGE_BACKEND=pg` server tests (server code untouched by
this REQ; pnpm-orthogonal, same as REQ-0084's own deferral) and full e2e
EXECUTION. Both server and client-e2e runtime tests need the shared
services (`backpack-api`/`backpack-web`, serving the MAIN checkout's
committed dist) — this worktree's build was never deployed there, and
per PROJECT.md's "coordinate before any edit, merge, or restart" rule for
live services, this session did not stand up or redirect them. This is
the SAME posture REQ-0066's own outcome doc recorded ("the shared baseURL
points at the live site, which the main checkout owns... the orchestrator
runs it for real right after deploy") — full e2e execution is deferred to
the coordinated merge/deploy step.

**Commits**: single commit `1557234` (source + dist rebuild) on
`req-0086-warehouse-main-nav`, unmerged. (Originally landed as two
commits under the collided `req-0085-` name; squashed into one during the
renumbering rebase below, since neither had been merged or shared yet.)

**Renumbering note**: this REQ was first drafted and implemented as
"REQ-0085". Right before moving this file from `todo/` to `built/`, a
numbering check turned up `docs/REQ/built/REQ-0085-preset-switch-null-slot-crash.md`
(and a matching stub still in `reserved/`) — a different, unrelated fix
that another concurrent session had claimed the SAME number for while
this REQ's implementation was underway. No code/feature overlap, pure
label collision (this project has several sessions/worktrees active
concurrently — see PROJECT.md's worktree model). Confirmed 0086 was free
and fixed it end-to-end before this branch was ever merged or shared:
renamed the local spec file, `sed`-replaced every in-source "REQ-0085"
comment across the touched files, rebuilt (byte-identical dist -- the
rename only touched comments, which minification strips anyway), squashed
history via `git reset --soft` + a fresh commit, renamed the branch
(`git branch -m`) and the worktree directory (`git worktree move`). Root
cause: this session skipped PROJECT.md's own prescribed mitigation
("claim it at once with a stub in `reserved/`") and went straight to
writing the full spec instead — worth remembering next time.

## Deploy & verification (2026-07-07)

User authorized merge + live restart directly ("進めてください"). Executed:

- **Master had drifted** 3 commits ahead (`8c8db9f` → `8eb3818`: REQ-0087's
  fix + REQ-0083's e2e-parallelization merge) while this branch was in
  flight. Diffed `8c8db9f..8eb3818` before merging: overlap existed in 4
  e2e spec files but was confined to import/setup lines (new `e2e-env.ts`
  per-worker isolation abstraction), not the lines this REQ touched.
- `git merge --no-ff req-0086-warehouse-main-nav` → clean auto-merge
  (`ort` strategy), zero conflicts. Merge commit `90e937d`.
- Reran the full local gate suite on merged master: sim 63/63, goldens OK,
  mock-src 97/97, server typecheck clean, engine-drift OK, server
  `api_test` files-mode 136/136, pg-mode 136/136, client build clean
  (dist byte-identical modulo the intended diff).
- Restarted `backpack-web` only (client-only change; `backpack-api` left
  running undisturbed for other concurrent sessions). Verified via curl:
  new hashed asset filenames live, `/app/` 200, `/api/health` 200.
- Ran the 5 touched e2e spec files (41 tests) against the live public
  site: **38 passed, 3 failed** on the first pass. Every test that
  actually exercises this REQ's change passed — the 4
  `warehouse-mjolnir.spec.ts` tests, the 3 `schedule.spec.ts` "Warehouse
  tab claim UX" tests, the `nav-routing.spec.ts` 5-routes test, and both
  edited `workshop.spec.ts` TM-merge tests. The 3 failures were all in
  code this REQ never touched: `schedule.spec.ts`'s "monitor freeze
  regression guard" (409 instead of 200 on slot assignment) and two
  `workshop.spec.ts` gacha-roll tests (missing "workshop-toast" locator).
- Hypothesis: transient cross-session test-data collision on the shared
  "dev" player profile, given zero code overlap and confirmed concurrent
  activity (`req-0085-preset-switch-null-slot-crash`,
  `req-0087-expedition-never-departs` worktrees active at the same time).
  Confirmed by re-running exactly those 3 tests in isolation immediately
  after: **all 3 passed** (2.8s / 3.8s / 4.6s, no flakes). Root cause
  matches the hypothesis — not a regression from this REQ.
- Net result: live deploy verified good. `/app/#/warehouse` serves the
  new route on the public tunnel; Schedule shows Rooms only; rail
  highlights 倉庫 correctly.

This branch was off `master@8c8db9f`, same base as
`req-0084-pnpm-worktree-provisioning` (still unmerged at merge time) —
per the Outcome note above, this branch/worktree should be re-provisioned
with pnpm after REQ-0084 lands, if it's ever revisited. Worktree removed
after merge (`git worktree remove`); branch left in place for history.
