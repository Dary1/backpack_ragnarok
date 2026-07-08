# REQ-0085 — Preset tab switch crashes on a corrupted null store slot

- **Status**: BUILT — merged to `master` (user go-ahead given in-chat) and LIVE on
  backpack-dev.qtie.jp. Branch `req-0085-preset-switch-null-slot-crash` implemented
  off master @ `8c8db9f` (commit `253a3fa`), then merged forward past two concurrent
  REQs that landed on master meanwhile (REQ-0086 warehouse-main-nav, REQ-0087
  expedition-stuck fix — commit `a4c11c0`) via a merge commit + client rebuild
  (`014ed4e`, resolves a dist-only rename/rename conflict — no source overlap)
  fast-forwarded onto master. Gates green before AND after that merge (§5). Live
  bundle confirmed serving the fix (`index-4eLrZpQq.js`). Staying in `built/` (not
  `done/`) pending the user's own hands-on confirmation on backpack-dev — this REQ
  file will move to `done/` once they've verified. Scope class: **bugfix,
  client+engine** (no schema/API change; no `backpack-api` restart required).

## 日本語サマリ

**症状**: Canvas の Preset タブ（Slot2〜Slot10）をクリックしても何も起きない。新しく
Preset を追加すると（Preset+ ボタン）正しく切り替わる。

**原因**: `mock-src/engine.js` の `switchPreset(st,n)` が `meta.store[n].linked` を
無条件に読んでいた。本番の dev プロフィール（`dev` プレイヤー）の実データを直接調査した
ところ、`presets.store` のうち `active`(=0) 以外の 9 スロット（index 1〜9 = Slot2〜
Slot10）が本来あるべき空プリセットのオブジェクトではなく **`null`** になっていた（発生源は
特定不能 -- st 単体からは再構築できない）。この状態で Slot2 以降をクリックすると
`TypeError: Cannot read properties of null (reading 'linked')` が React の pointerup
ハンドラ内で **無言のまま** 投げられ、UI 上は「何も起きない」ように見えていた。さらに、
この例外は `meta.store[meta.active]=outgoing` の代入が終わった **後**、
`meta.active=n` が実行される **前** に発生するため、失敗するたびに旧 active スロットが
誤って non-null になる、という二次的な不変条件違反も蓄積していた。

**修正**: `switchPreset` の `incoming` と、`reorderPreset`/`deletePreset` が共有する
`materializePresets` のスロット読み取りを `slot||emptyPresetSlot()` にフォールバック。
壊れたスロットに切り替えると、クラッシュする代わりに「空の新規プリセット」として
自己修復する（null スロットには元々救出可能な内容が無いため、データを失うことはない）。
エンジンのユニットテストを3件追加、mock-src テストは 97→100 に。`test:quick` ゲート
（sim/goldens/engine/tsc/drift/api files）全て green。クライアントを再ビルドし
`web/app/` の dist にも反映済み（`engine.js` は `?raw` インポートでバンドルに文字列
そのまま埋め込まれるため、リビルドしないと修正が本番バンドルに乗らない）。

**未実施**: master へのマージ + 本番配信の切り替え（ユーザーの承認待ち）。dev プロフィール
（`dev` プレイヤー、Postgres 上）に残っている壊れた9スロットへの直接データ修復は行って
いない — 修正版コードがデプロイされれば、ユーザーが各スロットを一度クリックした時点で
そのスロットは自動的に「空プリセット」として自己修復される（クラッシュしない）。既存の
アイテムは reference model により inventory 側に安全に残っているため、データ損失はない。

## 1. User report (verbatim, 2026-07-07, via backpack-dev.qtie.jp/app/#/backpacks)

> slot2-slot10をクリックしても何も起こらないです
> 新しくpresetを作るとちゃんと切り替えられる

## 2. Repro

Chrome-automated repro against the live dev site confirmed the report exactly:
clicking any of Slot2..Slot10 (indices 1-9) silently did nothing; clicking Slot1
(index 0) or adding a new preset both worked. Browser console (previously unchecked
by the user, since the failure has zero visible UI feedback) showed:

```
TypeError: Cannot read properties of null (reading 'linked')
    at Object.switchPreset (eval at ... <anonymous>:1783:24)
    ...
    at clickTab (...)
```

## 3. Root cause

`mock-src/engine.js`'s `switchPreset(st,n)`:

```js
const incoming=meta.store[n];
meta.store[meta.active]=outgoing;
st.linked=incoming.linked; // <- throws if incoming is null
```

Live-data inspection (read-only, via `server/storage.cjs`'s own `readProfile()` seam —
never touched Postgres directly) of the `dev` player's actual profile confirmed the
precise corruption: `presets.active=0`, 12 total presets (`Slot1`..`Slot10`,
`Preset 11`, `Preset 12`), and `presets.store` had **9 null entries at indices 1-9**
(exactly Slot2..Slot10) while index 0 (the active slot, which per the engine's own
invariant should be the ONE null entry) was a **real, non-null** object instead. This
is consistent with the crash itself being non-atomic: `meta.store[meta.active]`
gets overwritten with `outgoing` before the line that throws, so every failed
switch attempt (always from active=0, since active could never move) kept
re-writing store[0] with the current top-level content and never advanced —
explaining why store[0] ended up non-null while 1-9 stayed null. **How store[1..9]
first became null is not reconstructable from the data alone** — `addPreset` (never
writes null), `switchPreset`, `reorderPreset`, and `deletePreset` were all read
carefully and, called from a healthy state, cannot themselves manufacture a stray
non-active null in a single call. Given the defensive fix below closes the crash
regardless of cause, and the fallback is provably safe (a null slot cannot have had
recoverable content), further forensics were not pursued.

## 4. Fix

`mock-src/engine.js`:
- `switchPreset`: `const incoming=meta.store[n]||emptyPresetSlot();` — a corrupted
  (null) non-active slot now self-heals to a fresh empty preset instead of throwing.
- `materializePresets` (the shared helper `reorderPreset`/`deletePreset` build on):
  same `slot||emptyPresetSlot()` coalescing, so those two operations also stop
  silently propagating a stray null instead of healing it.

Both changes are purely defensive (fallback path only; the healthy/expected path —
`store[n]` already a real object — is byte-identical to before). No exported
function signature changed; no shared/engine.d.ts update needed.

`mock-src/tests/run.cjs`: 3 new regression tests --
1. `switchPreset` self-heals a corrupted (stray-null) non-active slot instead of
   throwing (also asserts the OLD active slot correctly ends up non-null, and that
   switching still works normally afterward).
2. `reorderPreset` tolerates a stray-null non-active slot elsewhere in `store[]`
   without throwing or propagating it (every slot is either the active `null` or a
   real object afterward).
3. `deletePreset`: same tolerance check.

## 5. Gates

- `node mock-src/tests/run.cjs`: **97 → 100 passed, 0 failed**.
- `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` (`npm run test:quick`), on
  the feature branch before merging master's concurrent work: sim tests 63/63,
  goldens (determinism contract) OK, mock-src engine 100/100, `tsc -p
  tsconfig.server.json` clean, engine type-surface drift check clean, server API
  tests (files backend) 135/135. **CI GREEN.**
- Client: `cd client && npm ci && npm run build` (`tsc -b && vite build`) — clean
  build. Confirmed the fix is actually embedded in the built bundle (`grep
  'meta.store\[n\]||' web/app/assets/index-*.js` matches — `engine.js` is inlined
  into the client bundle as a literal string via `client/src/engine/adapter.ts`'s
  `?raw` import, unminified, so the fix ships automatically on next build with zero
  adapter changes, exactly as that file's own module comment says).
- **Master had moved** (REQ-0083 e2e parallelization, REQ-0086 warehouse-main-nav,
  REQ-0087 expedition-stuck-fix landed while this REQ was in progress) and the main
  checkout had unrelated uncommitted changes (`content/vocab.json`,
  `tools/build_dungeon_preview.py` — a concurrent art/content session, never
  touched). Merged master into the feature branch instead of merging the feature
  branch into a dirty main checkout: `client/src/*`, `client/e2e/*`, `server/lib/
  meta.cjs`, `server/routes/schedule.cjs` auto-merged with **zero conflicts** (no
  file overlap with this REQ's changes); the only conflicts were **rename/rename on
  the generated `web/app/` dist** (both branches had independently rebuilt the
  client from a common ancestor) — resolved by discarding both sides' dist output
  and rebuilding fresh from the merged source, so the shipped bundle reflects REQ-
  0085 + REQ-0086 + REQ-0087 together. Re-ran the full gate on the merged state:
  sim 63/63, engine 100/100, tsc clean, drift clean, **server API tests 135→137/137**
  (REQ-0087 added 2). **CI GREEN.** `master` fast-forwarded cleanly onto the merge
  commit (`014ed4e`) — the collaborator's uncommitted files were untouched (verified
  before/after: identical `git status`).
- Live re-verification post-deploy: confirmed backpack-dev.qtie.jp serves the new
  bundle (`index-4eLrZpQq.js`) and that normal preset switching (0→1→2→3→4→2→0)
  works correctly with zero application errors (console showed only
  `setPointerCapture` `NotFoundError`s, an artifact of driving clicks via
  synthetic/untrusted `PointerEvent`s in the verification script itself, not a real
  app issue — real user clicks carry a genuine active pointer).
- NOT run: server API tests against the `pg` backend (`SKIP_PG=1`, no
  `DATABASE_URL` provisioned for this worktree) and client e2e (`SKIP_E2E=1`, needs
  a running server pair) — this change's UI-visible surface ("the tab now switches
  instead of crashing") is covered by the 3 new unit tests + the live before/after
  browser repro (§2, §5 above).

## 6. Deploy — done; live-data note

Merged to `master` and live (user go-ahead given in-chat). No `backpack-api`
restart was needed (server/ untouched by this REQ) — `web/app/`'s committed dist is
served as static files directly, so the merge itself was the entire deploy.

The user chose to let the fix **self-heal** the live `dev` profile's corrupted
slots rather than patch the database directly (both options were offered). One
wrinkle observed during post-deploy verification: by the time verification ran,
the `dev` player's profile was no longer in the originally-captured corrupted
shape (12 presets, 9 stray nulls) — it read back as a clean, healthy 5-preset
default state (`active:4`, exactly one null at index 4). This is consistent with
routine shared-dev-environment activity (e.g. an e2e run or another session
resetting the shared `dev` fallback player) rather than anything this REQ's fix
did, since the fix only ever *converts a crash into a successful switch* — it has
no path that deletes presets or reduces their count. Net effect: the specific
corrupted data this REQ was filed against is gone on its own, and the fix has
already been proven against a reconstructed copy of that exact corruption via the
3 new unit tests (§4), so nothing further to verify there. If the user still has
Slot2-10-style tabs showing on their own session next time they look, the self-
heal (§4) applies exactly as designed — no action needed on their part beyond a
normal click.

## 7. Follow-up (optional, not blocking this REQ)

The original source of the 9 stray nulls could not be identified from the data
alone (§3). If it recurs after this fix ships (i.e. a FRESH stray null appears in
some OTHER non-active slot later), that would be strong evidence the corruption is
still being actively produced by some code path not exercised by today's
investigation, worth a dedicated follow-up REQ at that point.
