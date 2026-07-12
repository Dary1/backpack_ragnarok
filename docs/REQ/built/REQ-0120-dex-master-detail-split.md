# REQ-0120 — Dex master/detail split (orientation-aware; index=0 preselected)

- **Status**: DONE (2026-07-09) — implemented, all gates green, **merged to `master`
  and deployed LIVE** on the owner's "merge and deploy" go-ahead. Feature commit
  **29d7bbd** (rebased onto latest master @ 9df7cc2, which had picked up REQ-0119);
  merged `--no-ff` → master @ **c5066fc**. `backpack-web` serves `~/backpack_ragnarok/web`
  statically, so the merge is live with no restart. Verified end-to-end via the public
  tunnel (see Outcome). Original pre-rebase branch commit was 9cae904. Number reserved
  manually (tools/touch_next_req_reserved.py is broken — see "Tooling note"). NOTE: this
  file still physically sits in `docs/REQ/built/` — the built→done `git mv` was not
  performed here (FS file deletion is disabled in this environment, and the docs board
  is a live shared repo with concurrent git activity); left for the board's normal flow.
- **Origin**: owner directive (2026-07-09) — on `#/dex`, change what happens when a
  catalog item is clicked. It currently behaves like an in-place **Expand** (the
  REQ-0108 inline drawer under the clicked card). Instead:
  - **Landscape (横長)**: split the screen left/right — **left = list, right = detail**.
  - **Portrait (縦)**: split top/bottom — **top = detail, bottom = list**.
  - **Both**: **index=0 is preselected** from the start (a detail always shows).

## Decisions (owner, 2026-07-09, via clarifying questions)

1. Landscape detail behavior = **detail is fixed (sticky) and each pane scrolls
   independently** (fits within the viewport height) — not "whole page scrolls".
2. The existing "一覧に戻る / back to list" control (`dex.backToList`) = **removed**
   (a detail is always shown, so there is nothing to collapse back to).
3. Landscape width split = **50 / 50**.
4. (Implied) portrait: detail on top is height-capped (50vh, own scroll) so the list
   stays reachable in one screenful; single column.
5. Orientation trigger = CSS `@media (orientation: landscape|portrait)` — the literal
   reading of 横長 / 縦.

## What changed (client-only; no engine/server/GameState change)

- **client/src/dex/Dex.tsx** — replaced the REQ-0108 inline-drawer flow with a
  master/detail SPLIT. New `.dex-md` container holds `.dex-md-list` (the master:
  colhead + search/rarity/tag controls + `.dex-grid` + TM strip) and
  `.dex-md-detail` (`data-testid="dex-detail-pane"`, holds `<DexDetail>`). Selection:
  `selectedId` is lazily seeded with `combineEntries(payload)[0]?.id` (index=0
  preselected, no empty first paint); a `[filtered]` effect keeps the selection valid
  and re-defaults to `filtered[0]` when the filter changes (functional updater so the
  REQ-0052 `dexFocusId` deep-link still wins). Card click now just
  `setSelectedId(e.id)` (retarget; no toggle-off), `aria-pressed`, `.dex-card-selected`
  ring kept. The `Fragment`/drawer branch and its `Fragment` import are gone. The "i"
  preview subwindow (REQ-0052) is unchanged.
- **client/src/dex/DexDetail.tsx** — dropped the `onBack` prop and the
  `.dex-detail-back-btn` button (decision 2). Composition otherwise identical:
  `.dex-detail-drawer-panes` → `.dex-detail-col-diagram` (DexDiagram) +
  `.dex-detail-col-info` (ItemDetailCard). No new Pixi app; same fit math.
- **client/src/index.css** — appended a REQ-0120 block. `.dex-md` is a grid;
  `@media (orientation: landscape)` → `grid-template-columns: 1fr 1fr`, detail
  `position: sticky; top: 58px` (clears the measured 50px sticky `.app-header`),
  `max-height: calc(100vh - 70px); overflow-y: auto` (independent scroll).
  `@media (orientation: portrait)` → single column, detail `order: 0` (top) capped at
  `max-height: 50vh; overflow-y: auto`, list `order: 1` (bottom). Inside
  `.dex-md-detail` the two panes are forced to stack (diagram over info) and lose their
  own 80vh/scroll (the column is the single scroll container — no nested scrollbars).
  Added `.dex-detail-empty` (shown only when the filter yields no matches). The dead
  REQ-0108 `.dex-detail-drawer*` rules are left in place (nothing references them).
- **client/src/i18n.ts** — added `dex.detailEmpty` (EN "Select an item to see its
  details." / JA "アイテムを選択すると詳細が表示されます。"). `dex.backToList` left in
  the dictionary (now unused; harmless).
- **client/e2e/dex.spec.ts** — replaced the two REQ-0108 tests (inline drawer + narrow
  stack) with two REQ-0120 tests: (1) landscape master/detail — grid + detail pane both
  mounted, no drawer / no `.dex-detail-col-list`, index=0 ringed with its id in the
  info column, detail sticky and to the RIGHT of the list, selecting another card
  retargets the same pane (id + eff_en shown); (2) portrait — detail stacked ABOVE the
  list, both ~full width, index=0 ringed. The R2 diagram test no longer clicks the
  removed back button between items (searching + clicking the next card retargets).
- **web/app/** — fresh vite dist committed.

## Selector / E2E contract

- **Kept verbatim**: `.dex-root`, `.dex-view`, `.dex-count`, `.dex-grid`, `.dex-card`,
  `.dex-card-summary`, `.dex-card-shape .shape-grid` (+ overlay/footprint), `.dex-search`,
  `.dex-empty`, the `.dex-diagram*` family, `.dex-detail-col-diagram` /
  `.dex-detail-col-info` / `.dex-detail-phead`, all `.dex-tm-*` / `.dex-admin-*`.
- **Added**: `.dex-md`, `.dex-md-list`, `.dex-md-detail` (+ `data-testid="dex-detail-pane"`),
  `.dex-detail-empty`, `.dex-view.dex-md-view`.
- **Removed from the DOM**: `.dex-detail-drawer` (`data-testid="dex-detail-drawer"`),
  `.dex-detail-back-btn`. (`.dex-detail-col-list` / `.dex-detail-item-list-row` were
  already gone in REQ-0108.)
- `dex-admin.spec.ts` untouched (DexAdmin is a separate view, unchanged).

## Gates (worktree, 2026-07-09) — all green

- `pnpm build` (`tsc -b && vite build`) → success; only the pre-existing >500 kB chunk
  advisory. Fresh `web/app` dist rebuilt + committed.
- `oxlint` on the changed files (Dex.tsx, DexDetail.tsx, i18n.ts) → 0 warnings /
  0 errors. (Repo-wide oxlint = 34 pre-existing warnings in untouched files, 0 errors.)
- `check:sprites` → 22/22 non-blank (fresh worktree lacked `.venv`; borrowed the main
  checkout's `.venv` for the rasterize step, symlink removed after — same posture as
  REQ-0108/0052).
- engine `node mock-src/tests/run.cjs` → 101 passed, 0 failed; `node sim/tests/run.cjs`
  → 74 passed, 0 failed (client-only; engine/sim untouched).
- **client E2E — actually run** (not just `--list`, exceeding REQ-0108's bar): served
  the worktree's `web/app` build via a static server + the REQ-0080 `local-proxy.cjs`
  (`E2E_STATIC_PORT` → my build, `/api` → the live API :8802) and ran
  `dex.spec.ts` headless → **7/7 passed** (incl. the 2 new REQ-0120 tests and the
  edited R2 diagram test). `dex-admin.spec.ts` not run (unaffected).
- **Visual check** (same local build, Playwright screenshots at 1440×900 landscape and
  430×900 portrait): landscape = 50/50 grid, detail `position: sticky` to the right,
  No.001 (blade) preselected; portrait = single column, detail on top (capped),
  list below; clicking a filtered card (dagger) retargets the detail. Confirmed.

## Interplay with shipped features

- REQ-0052 `#/dex/<id>` deep link: the `dexFocusId` effect still sets `selectedId`
  (now just retargets the persistent pane); preserved by the functional-updater
  validity effect. The "i" preview subwindow is kept.
- REQ-0108 (inline drawer): superseded by this REQ.
- REQ-0075/0038/0102/0103/0096 detail composition + card rendering: unchanged.

## Deliberately NOT done (coordinate-required / out of scope)

- **Merge to `master` + deploy** — live services (`backpack-web`/`backpack-api`) are
  HANDS-OFF per PROJECT.md; not performed. Branch `req-0120-dex-master-detail-split`
  @ 9cae904 is ready; rebase onto latest master may be needed before merge.
- **pnpm-lock.yaml** — unchanged (installed with `--frozen-lockfile`).

## Tooling note (separate follow-up, not fixed here)

`tools/touch_next_req_reserved.py` fails at import with `SyntaxError: '(' was never
closed` (an unclosed bracket before `def ensure_gitignore` at line 109), so the number
was reserved by creating the `reserved/` stub manually. Worth a tiny fix REQ.

## E2E side effect (FYI)

The