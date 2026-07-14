> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0100 — Expedition spoils rail (right column preview)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-08). Part of the
  Expedition 大改修 series (see REQ-0097 §Series). Mock element: the right column
  `ᚷ 戦利品 SPOILS ・ 待機 4件`, capacity `倉庫 187/200`, item cards, and
  `一括回収`. Depends on REQ-0097's 3-column shell.
- **Origin**: REQ-0071 omitted the right column because "the warehouse lives in
  this page's Warehouse TAB (REQ-0072 owns its restyle); duplicating claim flows on
  the rooms view would fork that squad." This REQ adds a **READ-ONLY preview** (no
  claim fork), so the mock's 3-column frame is honest and complete.

## Design

- **Data**: reuse the warehouse rows `SchedulePage` already polls for the Warehouse
  tab (REQ-0072) — **no new endpoint, no new poll**. The rail is a compact,
  read-only preview:
  - header: `待機 {pending count}` + a capacity meter `{n}/200` (reuse REQ-0072
    `.bar` + staged `calm/warning/full` classes; distinct testid).
  - the soonest-to-expire N rows as small item cards (iconDataUrl thumb +
    rarity-tinted name + expiry chip), same ordering the tab uses.
  - `回収` / `一括回収` → **deep-link** to the Warehouse tab (switch tab + focus the
    row), NOT an inline claim — this avoids forking the REQ-0041 two-phase claim.
  - the mock's `収蔵は7日で朽ちる` lore line = the real 7-day TTL (honest).
- **No fork rule**: default = preview + deep-link. If [USER] chooses inline claim
  instead, it MUST call the SAME claim path as `WarehouseTab` (REQ-0041/0072) — one
  code path, never a parallel one.

## Explicitly omitted

- The **NIGHT TALLY** slab (踏破/討伐/被弾/献身) beneath the spoils in the mock —
  no aggregate data (see REQ-0097 §Omitted). The rail ends at the spoils preview.

## i18n

`schedule.spoils.title` / `.pending` / `.capacity` / `.claimHint` / `.lore`
(EN natural / ja mock copy).

## Selector contract

New: `schedule-spoils-rail`, `schedule-spoils-count`, `schedule-spoils-cap`,
`schedule-spoils-row`, `schedule-spoils-claim-jump` (deep-link) — or reuse the tab
claim testids if inline claim is chosen. Warehouse tab selectors unchanged.

## [USER] decision list

1. `回収` behavior: deep-link to the Warehouse tab (recommended, no fork) vs inline
   claim (reusing the exact tab path).
2. Preview row count (mock shows ~3–4).
3. Include currency (TM) rows in the preview, or spoils items only.

## Dependencies

- REQ-0097 (the right column exists in the shell). REQ-0072 (warehouse data + claim
  path — reused, untouched).

## Test plan (gates before DONE)

- client E2E: pending rewards appear in the rail (count + soonest-expiry order +
  capacity meter); `回収` deep-links to the Warehouse tab (or, if inline, claims via
  the same path and the row leaves BOTH rail and tab); assert no second claim path
  exists.
- `tsc -b` clean; fresh dist committed. No server change (default deep-link path).

## Ratification — 2026-07-14 (user decision via orchestrator session)

Scope approved by the user as part of the schedule UX batch (REQ-0168/0169).
Decision list resolved:

1. **回収 behavior**: deep-link (recommended option) — but to the **#/warehouse
   ROUTE**, not a tab: REQ-0086 promoted the Warehouse out of this page after this
   draft was written, so every "tab" reference above now reads "the #/warehouse
   page". No inline claim; no claim-path fork.
2. **Preview row count**: 4 (soonest-to-expire first, same ordering the warehouse
   page uses).
3. **TM/currency rows**: INCLUDED in the preview (they are warehouse rows with the
   same TTL; hiding them would under-report the pending count).

Data-source deviation from the draft body: "reuse the warehouse rows SchedulePage
already polls" is stale for the same REQ-0086 reason — SchedulePage no longer
fetches warehouse data at all. The rail therefore owns ONE light fetch of
GET /api/warehouse on mount + a slow refresh (~15s) + an immediate refresh when
the expanded room's run settles (Monitor already detects settle). Capacity meter
+ pending count + 4 rows + deep-link button, testids per the Selector contract
above. Implemented on branch req-0168-schedule-ux-pass.

## Record
- **Status**: built (gates green) 2026-07-14. Branch req-0168-schedule-ux-pass.
- **Commits**: 736cd7d (spoils i18n keys), d2bd6b4 (SpoilsRail.tsx + SchedulePage
  wiring + Monitor onRunSettled + schedule.css), 2730fc0 (dist).
- Implemented per the 2026-07-14 ratification: new `client/src/schedule/
  SpoilsRail.tsx` renders in the existing right spoils column. It owns ONE light
  GET /api/warehouse on mount + a slow 15s refresh + an immediate refresh when the
  watched room's run settles (Monitor.tsx gained an `onRunSettled` callback that
  SchedulePage turns into a `refreshSignal` bump). Shows the pending count, a
  staged capacity meter `{n}/200` (WAREHOUSE_CAP; calm/warning/full states), the 4
  soonest-to-expire rows (TM rows INCLUDED, icon thumb + rarity-tinted name +
  expiry chip), a deep-link button to the **#/warehouse ROUTE** (not a tab, per
  REQ-0086), and the 7-day-TTL lore line. No inline claim; no REQ-0041 claim-path
  fork; warehouse-page selectors untouched.
- **Selector contract**: schedule-spoils-rail / -count / -cap / -row /
  -claim-jump implemented (+ schedule-spoils-empty for the zero-rows state).
- **Data-source deviation** (already noted in the ratification): the draft's
  "reuse the warehouse rows SchedulePage already polls" is stale post-REQ-0086 --
  the rail owns its own fetch, as above.
- **Gates**: tsc PASS, oxlint 0 errors, build PASS (dist committed), no server
  change (default deep-link path). e2e: the schedule specs (which now render the
  rail on the detail page) pass in the full-suite + GPU reruns. Manual browser
  pass deferred to orchestrator browser QA.

- **Post-merge gate re-run (2026-07-14)**: `master` was merged INTO
  req-0168-schedule-ux-pass (merge commit 560699b). The ONLY conflicts were the
  web/app dist bundles + index.html (rename/rename + content); every source,
  doc and tool file auto-merged cleanly. Dist conflicts were resolved by
  REBUILDING the client (pnpm run build, emptyOutDir) rather than hand-merging
  bundles. Full re-gate on the merged head 560699b, all green:
  - `pnpm exec tsc --noEmit` (client): PASS.
  - `pnpm run lint` (oxlint, canonical): 0 errors, 34 pre-existing warnings.
  - `pnpm run build`: PASS; dist deterministic (a second build left git clean),
    committed with the merge at 560699b.
  - server `node server/tests/api_test.cjs`: 157 passed / 0 failed (1215 assertions).
  - e2e `pnpm run e2e` (worktree recipe: python http.server :8901 serving this
    worktree web/, local-proxy :8903, E2E_PARALLEL=4 fleet :8910-8913 = this
    worktree server, PLAYWRIGHT_BASE_URL=http://127.0.0.1:8903, E2E_GPU=1):
    159 passed / 0 failed (2.9m) in a SINGLE run -- no CPU-drag flake surfaced
    under GPU, so no targeted E2E_GPU=1 rerun was needed. Box lock acquired with
    no queue; the orchestrator QA instance (HOME=/tmp/bp_qa, :8899/:8902) was
    left untouched.
