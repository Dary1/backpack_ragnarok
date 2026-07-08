# REQ-0082 — Dungeon auto-generation e2e regression (schedule create-panel drift)

Status: **done** — merged to master @ 8c8db9f (2026-07-07). Implemented A + B; full suite 125/125.
`req-0082-dungeon-autogen-e2e-regression` (off master @ bc45ddd, code-only — docs on FS),
not merged/deployed. Scope class: **test-infrastructure** (B adds a dev-only test seam;
no player-facing behavior change).

## 日本語サマリ

Full Test Suite の失敗2件(`client/e2e/schedule.spec.ts:274` と `:333`、REQ-0043 の
dungeon auto-gen)の原因は、**テストの陳腐化(drift)+ 状態汚染**(製品バグではない)。

REQ-0071(遠征ページ再設計)で作成フォームは「手動トグル + ルーム0件のとき自動展開」に
なった:`client/src/schedule/SchedulePage.tsx:187`
`const showCreatePanel = createOpen || (rooms !== null && rooms.length === 0);`
REQ-0043 のテストは作成フォーム(`schedule-dungeon-type-select` / `schedule-gen-seed-input`)が
常時表示の前提。呼び出し元がルームを1件でも持つとフォームは畳まれ `toBeVisible` が
10s タイムアウト。`:333`(dev fallback, canceled 154件蓄積)は常に、`:274`(guest 共有,
canceled 3件)は順序依存で失敗。

**修正 A+B を実装し、フル125件 = 125/125 緑を確認。**

## 1. Evidence (measured 2026-07-07, on llmlocal)

- Full `schedule.spec.ts`(24件): `:274` FAIL / `:325` PASS / `:333` FAIL / `:379` PASS →
  修正後 24/24 green。両失敗とも
  `expect(locator('[data-testid="schedule-dungeon-type-select"]')).toBeVisible()` の
  10s タイムアウト。失敗時スナップショット: schedule ページは描画済み、作成パネルは
  "Forge a new expedition +" トグルの奥(`:274` "Hide canceled (3)", `:333` "(154)")。
- `SchedulePage.tsx`: L187 auto-open は zero-rooms のみ; L176 `hasRooms=rooms.length>0`;
  トグル(`data-testid="schedule-create-toggle"`)は hasRooms のときだけ描画。
  `fetchRooms()` は canceled 含む全件を返す。
- `schedule.spec.ts`: `player` は `beforeAll` の単一 guest 共有; `beforeEach` は canvas のみ再PUT。
  dev のスケジュールルームを消すエンドポイントは無かった(warehouse `clear-debris` のみ)。

## 2. Root cause

REQ-0043 specs assume the create form is always present. REQ-0071 made it a manual toggle
force-opening only at `rooms.length === 0`. Callers accumulate canceled rooms (guest 3;
dev fallback 154, no cleanup) → panel collapsed → type-select absent. Product behavior is
intended; the tests drifted. REQ-0043 is `done` (terminal), so this REQ owns the fix.

## 3. Affected tests

`client/e2e/schedule.spec.ts` `:274` (flaky), `:333` (consistent); `:325`/`:379` passed but
`:325` shared the latent fragility.

## 4. Fix — A + B (ratified, implemented)

- **A (test-only):** `openCreatePanel(page)` helper — waits for the page to settle into
  either the auto-opened panel or the `schedule-create-toggle` (has-rooms) state, then clicks
  the toggle if the type-select isn't already visible. Called before the form assertions in the
  3 REQ-0043 specs. Robust to any room count; no product code change.
- **B (hygiene):** dev-only `POST /api/schedule/rooms/dev/clear` — mirror of warehouse
  `dev/clear-debris`: dev_mode NO-token fallback caller ONLY (403 for a real guest token, 405
  non-POST), caller-scoped, `schedule.devClearRooms` → `storage.clearRoomsForOwner` (files+pg
  identical). `global-setup.ts` calls it (404-tolerant until the API redeploys). `api_test`
  covers gating + caller-scoping.

Also (per user request during this work): **e2e partial-run scripts** added to
`client/package.json` — `e2e:failed` (`--last-failed`), `e2e:changed` (`--only-changed`);
plus `npm run e2e -- <file>` / `-g "<title>"` for ad-hoc subsets (avoids re-running all 125).

## 5. Gate plan

`bash tools/ci.sh`; success = REQ-0043 cases stable green in a full run, suite 125/125.

## 6. Status

built — green; branch `req-0082-dungeon-autogen-e2e-regression`, not merged/deployed.

## 7. Results

**Branch:** `req-0082-dungeon-autogen-e2e-regression`, off master @ `bc45ddd`. Code-only on the
server (docs single-sourced on FS). Commits: `ff4677f` (fix A+B), plus a `chore(e2e)` commit
(partial-run scripts). See `git log`.

**Files:** `client/e2e/schedule.spec.ts` (openCreatePanel + 3 call sites) ·
`client/e2e/global-setup.ts` (clearDevScheduleRooms hook) · `server/routes/schedule.cjs` (route) ·
`server/schedule.cjs` (facade) · `server/services/rooms.cjs` (devClearRooms) ·
`server/storage.cjs` (clearRoomsForOwner) · `server/tests/api_test.cjs` (dev-clear case) ·
`client/package.json` (e2e:failed / e2e:changed).

**Validation (llmlocal):**

| check | before | after |
|---|---|---|
| full e2e (125) | 123 passed / 2 failed | **125 passed / 0 failed (10.7m)** |
| `schedule.spec.ts` | 22 / 24 | **24 / 24** |
| `:274` / `:333` (regression) | FAIL / FAIL | **PASS / PASS** (in full-suite run) |
| `api_test` files backend | 134 | **135** (new dev-clear case) |
| `api_test` pg backend | 134 | **135** |
| server typecheck / client build / engine drift | — | clean / OK / OK |

Note: Fix B's globalSetup hook `POST /api/schedule/rooms/dev/clear` returns 404 against the
LIVE API until `backpack-api.service` redeploys from this branch (same 404-tolerance as the
warehouse hook); Fix A already carries the tests to green meanwhile. The full run above used
the tunnel (this branch predates REQ-0080's proxy+GPU), hence 10.7m.
