# REQ-0074 — Common BP gacha: +2 cells to rolled shape size

> **RENUMBERED 2026-07-13: REQ-0097 → REQ-0074.** This REQ and
> `REQ-0097-expedition-master-detail` both held **0097** — two concurrent
> orchestrator sessions claimed the number a day apart (this one 2026-07-07,
> the expedition rebuild 2026-07-08), before the shared allocator in
> `~/backpack_ragnarok_state/req/` was the sole source of numbers. Both had
> already merged to `master`, so the number had to be broken by hand.
>
> **This REQ yielded the number** (owner ruling, 2026-07-13): it is a
> self-contained, terminal balance tweak with **zero inbound references**,
> whereas the expedition REQ is the backbone of the 0097–0100 series and is
> cited by REQ-0049 / 0057 / 0098 / 0099 / 0100 / 0119 and by seven code
> comments. `REQ-0097` now unambiguously means the expedition rebuild.
>
> **0074 was the board's only free number** (0073 is not free — it is the
> real, merged item-icon-gen REQ, filed at the legacy flat path
> `docs/REQ-0073-item-icon-gen.md` and never migrated onto the state board).
> Reusing 0074 is a deliberate, owner-approved exception to PROJECT.md's
> “numbers are MONOTONIC and never reused” rule; it is safe because the
> allocator counter is at 0149 and can never re-issue 0074. Note that
> REQ-0069 and REQ-0072 mention “0074” in passing as the old
> workshop-redesign slot from the 0070–0074 redesign series — that slot was
> actually built as **REQ-0076-redesign-workshop**, so those are stale
> references to a number that never held a REQ, not to this one.
>
> **Git history is NOT rewritten and remains authoritative.** Everything below
> that says `REQ-0097` — the branch `req-0097-common-bp-gacha-cell-buff`, the
> commit `fc415bf` (“REQ-0097: Common BP gacha shape +2 cells (4-6 -> 6-8)”),
> the worktree path — is preserved verbatim as the historical record of how
> this REQ was actually built. Do not “fix” those names.

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
