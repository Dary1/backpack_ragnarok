# REQ-0097 — Common BP gacha: +2 cells to rolled shape size

- **Status**: BUILT (2026-07-07) — implemented on branch
  `req-0097-common-bp-gacha-cell-buff` (worktree
  `~/backpack_ragnarok_worktrees/req-0097-common-bp-gacha-cell-buff`, off
  `master` @ `6177254`, rebased onto `2eebc30` after master moved).
  **MERGED AND DEPLOYED** (2026-07-07): fast-forwarded onto `master` as
  `fc415bf`, `backpack-api` restarted, live behavior re-verified after
  restart. Scope class: **balance tuning, server-only** (no schema/DTO
  change, no client behavior change — client already renders whatever
  shape the server returns).
- Origin: direct user request via this Cowork session — "Common BPガチャ
  から排出されるセル数を一律+2してください" (uniformly +2 the cell count
  dropped from the Common BP gacha).

## Request

Workshop's Common BP gacha (REQ-0042) rolls a random-walk polyomino shape
of 4-6 cells per roll. Bump both ends of that range by +2, so rolled
shapes are 6-8 cells instead.

## Change

`server/services/gacha.cjs`:
```diff
-const GACHA_MIN_CELLS = 4;
-const GACHA_MAX_CELLS = 6;
+const GACHA_MIN_CELLS = 6;
+const GACHA_MAX_CELLS = 8;
```
Plus two stale doc-comments in the same file that textually cited the
old "4-6" / "[4,6]" range (the retry-cap comment and the connectivity
comment above `rollPolyomino`) updated to "6-8" / "[6,8]" for accuracy.
No other constant touched — `GACHA_HP_PER_CELL` (15/cell, so hpMax now
scales to the larger shapes automatically), `GACHA_MIN_LINKER_DIRS`/
`GACHA_MAX_LINKER_DIRS` (1-3), `GACHA_WALK_RETRY_CAP` (2000) and
`GACHA_COMMON_BP_COST` (10 LRDST) are unchanged.

Two test files hardcode the range independently of the source constants
(same "must update in both places" note left in REQ-0042's own recon)
and were updated in lockstep:
- `server/tests/api_test.cjs` — gacha happy-path test's shape-length
  assertion (`>=4 && <=6` → `>=6 && <=8`, message text updated).
- `client/e2e/workshop.spec.ts` — two hardcoded bounds
  (`toBeGreaterThanOrEqual(4)`/`toBeLessThanOrEqual(6)` → 6/8) in the
  happy-path and roll-result-diagram e2e scenarios.

Whole-repo grep for `GACHA_MIN_CELLS`/`GACHA_MAX_CELLS` confirmed no
other file duplicates these numbers.

## Gates

| gate | result |
|---|---|
| `npm run test:quick` (sim + goldens + mock + typecheck + drift + api files) | 153/0 server api, 101/0 mock/sim suites combined, typecheck clean — CI GREEN, both before and after the post-rebase re-run |
| `node server/tests/api_test.cjs` standalone | all 8 gacha-suite tests pass, happy-path now asserts 6-8 |
| Full Playwright e2e | **not run** — judgment call matching REQ-0087's own precedent: pure numeric constant-range change, no DTO/wire-shape change, no client code path touched beyond the two hardcoded e2e literals already found and fixed by inspection |

## Deploy log

1. Branched worktree off `master`@`6177254`; master advanced to `2eebc30`
   (REQ-0096, dex icon fallback) while this REQ was in flight — confirmed
   zero file overlap via `git diff --stat`, so `git rebase master` was
   clean.
2. `git merge --ff-only` onto `master` succeeded as a pure fast-forward:
   `2eebc30` → `fc415bf`.
3. `systemctl --user restart backpack-api.service` — clean restart, no
   sudo needed. `/api/health` → 200.
4. Live behavioral verification: required `server/services/gacha.cjs`
   directly from the now-deployed `master` tree and called
   `rollCommonBp()` 20 times with distinct seeds. Observed cell counts:
   `[6,7,7,7,8,7,6,8,8,7,6,7,7,7,8,6,8,7,6,7]` — every sample in [6,8],
   none in the old [4,5] range.
5. Worktree removed post-merge (`git worktree remove`); `master` left
   with only the same pre-existing unrelated dirty files noted before
   this REQ started (`content/vocab.json`, `tools/build_dungeon_preview.py`
   + a handful of untracked batch/preview files from other concurrent
   work) — nothing new introduced.

## Outcome

Done. No deviations, no conflicts, no force-merges. Effective immediately
on the live dev server — the next Common BP gacha roll any player makes
returns a 6-8 cell shape instead of 4-6.
