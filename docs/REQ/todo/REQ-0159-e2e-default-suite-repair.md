# REQ-0159 — Repair the default e2e suite: retire the accounted failure set

**Reserved:** 2026-07-14 · **Slug:** e2e-default-suite-repair
**Origin:** user directive 2026-07-14 (orchestrator session, REQ-0145a close-out):
"file a REQ to repair the remaining e2e reds" — filed directly to `todo/` on that
directive.
**Filed from:** branch `req-0145a-server-refactor-r2` (REQ-0145a built; evidence below
measured on its master-synced tree @ faadac4 = master d387388 + REQ-0145a).

## 日本語サマリ

現状、素の `pnpm run e2e`(= tools/ci.sh step 7)は「全緑」にならず、「説明済み失敗
セット」を暗記して照合する運用になっている(REQ-0057 のマージ記録、REQ-0145a の最終
ゲート記録の両方が同じセットを個別に再確認する羽目になった)。本REQはその暗記運用を
終わらせる: (1) master 既存の stale-spec 赤3件を根治(spec更新 or 実回帰修正)、
(2) 並列モードのフレーク5件を安定化、(3) ハーネス専用の管理系3spec をデフォルト
suiteから除外し ci.sh に明示ステップとして組み込む。受け入れ = 静かな盤で
デフォルトsuite連続2回ゼロ失敗 + ci.sh が exit 0 で「CI GREEN」を再び文字通りにする。

## 1. Evidence (measured 2026-07-13/14 UTC, master d387388 / 0145a tree faadac4)

The default suite (164 tests @ faadac4) carries a persistent, ACCOUNTED failure set that
two independent merge-gate runs (REQ-0057's, REQ-0145a's) had to re-derive and cross-
reference by hand. "CI GREEN" currently requires tribal knowledge of which reds are
"fine". The set:

| Class | Spec | Symptom | Cross-reference |
|---|---|---|---|
| (A) stale-spec red, deterministic on master | `nav-routing.spec.ts:26` (all 5 nav routes) | `.schedule-rooms-view` never visible after clicking the Schedule nav route | REQ-0057 log: reproduced against the pure master bundle; REQ-0145a: reproduced solo on a quiet box |
| (A) | `dex-card.spec.ts:65` (footer "view full page" deep-link) | `.dex-detail-columns` not visible after deep-link | REQ-0057: pre-existing set; REQ-0145a: intermittent (passed on quiet-box rerun) |
| (A) | `schedule.spec.ts:1065` (monitor freeze guard) | fails under full-file ordering only | REQ-0057: "at full-file ordering"; passes solo |
| (B) parallel-mode flakes | `forecast.spec.ts:41`, `warehouse-mjolnir.spec.ts:203`, `landing.spec.ts:115`, `guest-auth.spec.ts:83`, `dex.spec.ts:280` | fail under E2E_PARALLEL=4 against live, pass on targeted/serial reruns | REQ-0057 hit the first two; REQ-0145a hit all five once, all passed on quiet-box rerun |
| (C) harness-only admin specs | `artadmin.spec.ts`, `artinspect.spec.ts`, `contentadmin.spec.ts` | REQUIRE the isolated HOME-remap harnesses (`tools/{artadmin,art_inspect,content_admin}_e2e.sh`); in the default suite their opening `dev/clear-all` 403s by design since REQ-0156's `ALLOW_DEV_CLEAR` hardening (which closed the 2026-07-13 live-registry wipe — see REQ-0145a's incident log) | REQ-0156 gates them via harnesses (3/1/1 green on the 0145a tree); default-suite runs can never pass them again, by design |

Class (C) is the direct residue of the REQ-0156 hardening: correct server behavior,
wrong suite membership. Classes (A)/(B) predate REQ-0145a/0156/0057 (REQ-0057's recon
called (A) "the stale-spec reds the recon note predicted").

## 2. Scope

1. **(A) Root-cause the three deterministic/ordering reds.** For each: decide
   spec-drift vs real regression by reading the CURRENT UI (client/src) against the
   spec's selectors, then either update the spec to the current intended UI or fix the
   regression. `.schedule-rooms-view` (nav-routing) is the anchor case — find what the
   Schedule route actually renders now and pin THAT. The monitor-freeze test's
   full-file-ordering failure is a shared-state leak between tests in
   `schedule.spec.ts` — find and isolate the leaked state (room/profile debris),
   don't just reorder.
2. **(B) Stabilize the five parallel flakes.** Likely classes: cross-worker shared
   live-state races (dev player profile/rooms) and missing readiness waits. Fix by
   proper awaits/unique fixtures; only as a LAST resort mark a spec serial
   (`test.describe.configure({ mode: 'serial' })` or a worker-pinned project), with a
   comment saying why.
3. **(C) Retire the admin trio from the default suite + wire harnesses into ci.**
   - `client/playwright.config.ts`: `testIgnore` for
     `**/{artadmin,artinspect,contentadmin}.spec.ts` with a pointer comment.
   - `tools/ci.sh`: new explicit step (after the client build, before/alongside step 7)
     running the three harnesses (`tools/artadmin_e2e.sh`, `tools/art_inspect_e2e.sh`,
     `tools/content_admin_e2e.sh`), guarded by the same SKIP_E2E toggle (plus SKIP_PG —
     they need DATABASE_URL) so ci covers them without the live-namespace trap.
   - The harnesses already take the box lock via e2e_run.sh; keep that.
4. **Docs:** server/README.md e2e section + architecture.md §6 updated in the same
   commits (suite membership, harness step, "CI GREEN means literally green" rule).

## 3. Frozen contract

- No server behavior changes. This REQ touches `client/e2e/*`, `client/playwright.config.ts`,
  `tools/ci.sh`, docs — plus client/src ONLY if a class-(A) item turns out to be a real
  UI regression (then the fix is the regression's, with its own test).
- The REQ-0156 `ALLOW_DEV_CLEAR` gate is untouchable (incident hardening).
- e2e stays serialized through `tools/e2e_run.sh`'s box lock.

## 4. Sequencing & collision notes

- **After REQ-0145a and REQ-0145b merge.** Both touch the same test/config surfaces
  (0145a: suite split precedent + ci.sh; 0145b: client refactor moving the components
  the class-(A) selectors point at — fixing selectors before 0145b lands would be
  double work). Implement on a fresh worktree cut from post-merge master.
- REQ-0080/0083/0117 posture (live-box e2e + parallel workers + box lock) is kept;
  this REQ repairs within it, it does not redesign it. A future redesign (fully
  isolated default suite, no live coupling — the REQ-0145a incident's deeper lesson)
  would be its own REQ.

## 5. Acceptance criteria

- Two CONSECUTIVE full default-suite runs on a quiet box: **0 failed, 0 flaky**
  (no accounted set, no memorized exceptions).
- `bash tools/ci.sh` exits 0 end-to-end with the harness step green (files+pg).
- Class-(A) resolutions documented per spec (drift vs regression, with the evidence).
- Any serial-mode fallback justified in a comment + this file.
- README/architecture.md describe the final suite membership + harness step.

## Execution log & amendments

(to be written during implementation)
