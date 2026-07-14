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

**Implemented:** 2026-07-14, branch `req-0159-e2e-default-suite-repair`, cut from
post-merge master `0c86d83` (REQ-0145a AND REQ-0145b both `done/` — the §4
sequencing precondition was met; the user confirmed both merges before work started).

### Headline

`pnpm run e2e` went from **11 failed / 155 passed** to **0 failed / 159 passed**,
with no accounted set and no memorized exceptions. `tools/ci.sh` prints `CI GREEN`
and means it.

The measured baseline did NOT match this REQ's own §1 evidence table, and the
differences mattered — so every red below was re-derived from a fresh run rather
than inherited from the spec. Two corrections to §1 are recorded in "Amendments".

### Class (A) — the three deterministic reds. Verdict: 2 spec drift, 1 real leak.

| Spec | Verdict | Root cause | Fix |
|---|---|---|---|
| `nav-routing.spec.ts:26` | **SPEC DRIFT** | `.schedule-rooms-view` was deleted from `SchedulePage.tsx` by **REQ-0097** (3-column master/detail rewrite). Only a dead CSS rule still names it. The assertion had therefore been red since REQ-0097 and was asserting nothing about the shipped UI. | Pin `[data-testid="schedule-rooms-col"]` — the rooms column the route actually renders. |
| `dex-card.spec.ts:65` | **SPEC DRIFT** | `.dex-detail-columns` was deleted by **REQ-0108/REQ-0120** (Dex became master/detail; the grid and `[data-testid="dex-detail-pane"]` are now BOTH permanently mounted). | Pin the detail pane AND assert it retargeted to the deep-linked entry. **Strictly stronger** than the old "container is visible" check. |
| `schedule.spec.ts:1065` | **REAL SHARED-STATE LEAK** | Not a stale spec. The `dev/backdate is refused (403)` test fills all 4 slots — which AUTO-STARTS the run, making the room ACTIVE and squads 0–3 DEPLOYED — and was the only room-creating test in the file that never cancelled. Every later test deploying squads 0–3 then got a **409** from the cross-room deploy gate (`deployedUidSetsForGate`, server/services/squads.cjs). That 409 was **correct server behaviour** — it is the exact rule the "deploy-gate 409 across rooms" test asserts on purpose. | Cancel the room in the **leaking** test. The monitor guard's own `expect(r.status).toBe(200)` is left **untouched** — it must keep failing if a squad is ever wrongly still deployed. |

Note the discipline point on the third: the fix went into the test that *caused* the
mess, not the test that *reported* it. Nothing was relaxed to make the report go away.

### Class (B) — the flakes. The §1 list was wrong; the real ones were different.

None of the five specs §1 named (`forecast:41`, `warehouse-mjolnir:203`,
`landing:115`, `guest-auth:83`, `dex:280`) failed in the baseline. Two OTHER tests
flaked across six full runs, and **both turned out to be real defects, not flakiness**:

**B-1 `warehouse-mjolnir.spec.ts:203` — the test raced a 450 ms transient class.**
`beginClaimFadeOut` sets `fx='fadeout'` then clears it after `FLASH_FADEOUT_MS = 450`
(useWarehouseData.ts). The old assertion was a *polling* `toHaveClass(/…-fadeout/)`,
which can only pass if a poll happens to land inside that 450 ms window. Under
`E2E_PARALLEL=4` the polls are not that punctual: the captured failure logged 6 polls
seeing `…-flash` and the next 4 seeing the fx already cleared — it stepped clean over
the window. A longer timeout cannot fix this (it just waits longer on a class that is
already gone). Fixed by **recording** the class transitions with a MutationObserver
installed before the click, then asserting on the recorded sequence: flash happened,
fade-out happened, and the two never coexist. The fade-out is still **required**
(`toBe(true)`) — plus a new exclusivity assertion the old pair could not express.

**B-2 `workshop.spec.ts` dismantle — A REAL CLIENT BUG (`DismantlePanel.tsx`).**
This one cost two wrong hypotheses before the trace settled it, and it is the most
important finding in this REQ.

- *First hypothesis (WRONG):* the fixture seeded the blade off-grid — `cell:[8,1]`
  with a 2-tall blade on a 1-indexed 8-row page spans rows 8–9. Real fixture bug, and
  fixed (both dismantle seeds), but the test **still failed**. Recorded here because
  "it looked like the cause and wasn't" is exactly the trap this REQ exists to close.
- *Actual root cause, from the Playwright trace:* `POST /api/dismantle` returned
  **200 in 4 ms**. The dismantle SUCCEEDED. But the success toast (and the error
  banner) were rendered **inside the `dismantlable.length > 0` branch** of
  `DismantlePanel.tsx`. `confirmDismantle()` sets `result`, then awaits `loadGame()`,
  which drops the just-destroyed item from state — and if it was the caller's LAST
  dismantlable item, the list went empty, the panel flipped to its empty-state branch,
  and **the toast unmounted the confirmation it had just set**. A user who dismantles
  their last item sees nothing at all. Errors on the last item were swallowed the same
  way. The bug dates from REQ-0063.
- *Why it presented as a flake:* the seed APPENDED to the live dev profile. When that
  profile happened to hold another inventory item the list stayed non-empty and the
  toast survived (pass); when it didn't, the list emptied (fail). **The suite's
  coverage of the bug was decided by live-state leftovers — it "passed" precisely on
  the runs that never reached the broken path.** This is REQ-0145a's live-coupling
  lesson biting again, and it is the strongest argument on record for the
  fully-isolated default suite §4 defers to a future REQ.
- *Fix:* hoist the outcome banners OUT of the ternary (`client/src/schedule/DismantlePanel.tsx`),
  so the confirmation is independent of what the dismantle did to the list.
- *Guard:* the seed now clears every inventory page, so the blade is the ONLY
  dismantlable item and the test takes the **"dismantle the last item"** path every
  run. It asserts BOTH that the picker went empty AND that the toast is still on
  screen — so the guard cannot be satisfied by quietly leaving an item behind.
  Verified to have teeth: pre-fix, this test failed **deterministically** (runs v1+v2).

**Frozen-contract deviation (§3), user-approved 2026-07-14.** §3 permitted `client/src`
edits only for a class-(A) regression. B-2 is class (B) and is a real client bug. The
user was shown the finding and the options and directed: *"このREQで直す"* — fix it
here. `DismantlePanel.tsx` is the ONLY `client/src` file touched (plus the mandatory
`web/app/` dist rebuild). No server behaviour changed; `ALLOW_DEV_CLEAR` untouched.

### Class (C) — admin trio retired from the default suite, harnesses wired into ci

`client/playwright.config.ts` gains `testIgnore` for `artadmin`/`artinspect`/
`contentadmin` (7 tests), with the full rationale inline: their opening `dev/clear-all`
is 403'd by REQ-0156's `ALLOW_DEV_CLEAR` hardening in any non-harness run — correct
server behaviour, wrong suite membership. `tools/ci.sh` gains step **`[6.5/8] admin
e2e harnesses`** running all three harnesses, guarded by `SKIP_E2E`/`SKIP_PG`/
`SKIP_CLIENT` (they need a built client + `DATABASE_URL`). Each still takes the box
lock via `e2e_run.sh`, so they queue rather than race. **Zero coverage lost** — the
tests moved, they were not dropped. The harness configs are standalone `defineConfig`s
with their own `testMatch`, so the main config's `testIgnore` cannot leak into them.

### Amendments to this REQ's own §1 evidence

1. **§1's class-(B) list was stale.** All five named specs passed in the baseline; the
   two real flakes were `warehouse-mjolnir:203` (which §1 did name, but as a
   "parallel-mode flake" rather than the 450 ms polling race it is) and the workshop
   dismantle test, which §1 did not list at all. Anyone re-deriving this set from §1
   alone would have chased the wrong five tests.
2. **§1 called `dex-card.spec.ts:65` "intermittent (passed on quiet-box rerun)".** It
   is not intermittent. It asserts on a class that no DOM has contained since
   REQ-0108/0120 and can never pass. Treating it as a flake is what let it survive.

### Deliberately NOT done

- **No `test.skip`, no `test.fail`, no `describe.configure({mode:'serial'})`, no
  retries, no widened timeouts-as-fixes.** §2's serial-mode last resort was never
  needed. Nothing is quarantined.
- **The dead `.schedule-rooms-view` / `.dex-detail-columns` CSS rules are left in
  place** (`client/src/styles/schedule.css`, `dex.css`). They are harmless dead code
  and removing them is outside the frozen contract; noted here as a trivial follow-up.
- **The live-coupled default suite is not redesigned** — §4 keeps that for its own REQ,
  and B-2 above is the evidence for why it is worth doing.

### Gate results

All e2e gates run `E2E_PARALLEL=4 E2E_GPU=1` on a quiet box, with
`E2E_STATIC_PORT=8851` serving THIS worktree's `web/` (see the deployed-bundle trap
below — without it the run silently tests the main checkout's dist).

| Gate | Result |
|---|---|
| Baseline (pre-fix) | **11 failed / 155 passed** — 3 class-(A) + 1 flake + 7 class-(C) |
| `pnpm run e2e` — final run 1 | **exit 0 — 159 passed, 0 failed, 0 flaky** |
| `pnpm run e2e` — final run 2 (consecutive) | **exit 0 — 159 passed, 0 failed, 0 flaky** |
| `bash tools/ci.sh` end-to-end | **exit 0 — `CI GREEN`** |
| ↳ `[6.5/8]` artadmin harness | 3 passed |
| ↳ `[6.5/8]` artinspect harness | 1 passed |
| ↳ `[6.5/8]` contentadmin harness | 3 passed |
| ↳ `[7/7]` default suite | 159 passed |
| `tsc --noEmit` (client) | pass |
| `oxlint` (every touched file) | 0 warnings, 0 errors |
| client build + `web/app/` dist rebuild | pass (dist committed) |

166 baseline tests − 7 admin (moved to the harness step) = **159**. Nothing was
skipped, quarantined, or dropped: the count reconciles exactly.

### Two traps this REQ fell into, recorded so the next person doesn't

**1. The default suite serves the DEPLOYED bundle, not your worktree's.**
`local-proxy.cjs` proxies everything that is not `/api/*` to `E2E_STATIC_PORT`, which
defaults to **8801 = backpack-web.service = the MAIN CHECKOUT's `web/`**. Only `/api/*`
reaches your tree. So a `client/src` change is **not covered by a default-suite run**:
you can edit a component, run the suite green, and have tested none of it. This REQ hit
it head-on — two "final" verification runs passed the OLD bundle through and proved
nothing about the DismantlePanel fix; the failure looked identical to a fix that simply
had not worked. Rebuilding into the worktree's `web/app/` does not help either, because
:8801 never looks there. Gate a client change with `E2E_STATIC_PORT` pointed at your own
tree (recipe + the confirming `curl` now in server/README.md).

**2. Chaining the three admin harnesses collided on ports.**
The first end-to-end `ci.sh` run of the new `[6.5/8]` step exited 1 with all 3
contentadmin specs dead on `ECONNREFUSED :8923`. `content_admin_e2e.sh` defaulted to
`8921/8922/8923` — byte-identical to `artadmin_e2e.sh`. Harmless while each was only
ever run by hand, one at a time (REQ-0156/0157); fatal the moment ci ran them
back-to-back, because the second could not bind while the first's processes were still
coming down. Fixed at the source (content_admin gets its own band, 8931–8933) rather
than worked around in ci.sh — the defect was introduced by the new step, so it is the
new step's to fix properly.

### Commits (branch `req-0159-e2e-default-suite-repair`)

| Commit | What |
|---|---|
| `2fb4291` | (A) re-pin two stale specs to the shipped UI — nav-routing + dex-card |
| `22ac43e` | (A) fix the schedule shared-state leak in the LEAKER, not the reporter |
| `6b35ed9` | (B) warehouse-mjolnir: record class transitions instead of racing a 450 ms window |
| `3f7acde` | (B) **the real client bug** — DismantlePanel ate its own confirmation + regression guard |
| `085b691` | (C) testIgnore the admin trio; run their harnesses as ci.sh `[6.5/8]` |
| `1f3e265` | dist rebuild (`web/app/`) carrying the DismantlePanel fix |
| `5cd7609` | docs — suite membership, the deployed-bundle trap, "CI GREEN means green" |
| `0daacd4` | content_admin_e2e.sh port band 8931–8933 (collision found by the ci run) |

### Outcome

`todo → built`. All acceptance criteria in §5 are met: two consecutive full runs at
0 failed / 0 flaky, `ci.sh` exit 0 with the harness step green, every class-(A)
resolution documented drift-vs-regression with its evidence, no serial-mode fallback
needed anywhere, and README/architecture.md describing the final suite membership.

NOT merged, NOT deployed. The `web/app/` dist here carries a client fix, so landing
this REQ means a real deploy (client bundle + `backpack-web`), not a docs-only merge —
flagging that explicitly because PROJECT.md puts the main checkout and the live
services behind an explicit, fresh user go-ahead.
