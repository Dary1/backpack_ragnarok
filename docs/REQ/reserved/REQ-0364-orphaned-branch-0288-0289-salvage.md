# REQ-0364 — salvage or retire the orphaned branch carrying REQ-0288 + REQ-0289

**Status:** reserved — AGENT-PROPOSED, awaiting owner review. Not cleared to implement.
**Reserved:** 2026-08-03
**Slug:** orphaned-branch-0288-0289-salvage
**Found by:** REQ-0290, 2026-08-03, on trying to create its own worktree branch.
**User ruling (2026-08-03, chat):** report it, do not act on it this session — REQ-0290
was to proceed alone. This REQ is that report.

## What was found

A branch named **`req-0290-locked-po-not-allowed-cursor`** already existed. It carried no
REQ-0290 work at all. It carried a COMPLETE, gates-green-by-its-own-commits
implementation of **REQ-0288** and **REQ-0289**, and was never merged:

    11731bd0  REQ-0289: todo -> built (gates green; engine+client+e2e complete)
    4522ec28  REQ-0289: append implementation log
    0d2e74f8  REQ-0289: rebuild client bundle
    842e5fb8  REQ-0289: e2e -- bp-rotate pivot-law update + float spec
    2e19085c  REQ-0289: client -- badge at the Unit seat + sticky float
    251dd011  REQ-0289: engine tests -- pivot-law recalcs + new gate cases
    2e7c459c  REQ-0289: engine -- Unit-pivot BP rotation + arbitrary-origin queries
    11cb1de3  REQ-0288: todo -> built
    def2fef4  REQ-0288: implementation log + before/after evidence
    8a34886d  REQ-0288: drag-ghost e2e (probe seam) + check_ghost_chain tripwire
    942b299e  REQ-0288: registry-first ghosts, BP lift + whole-bag ghost, revert feedback

Tip 2026-07-22 16:11 UTC; fork point `375409bb`. **559 commits behind master.**
1410 insertions across 25 files. Renamed 2026-08-03 to
`stale/req-0290-branch-carrying-0288-0289-2026-07-22` so the REQ-0290 branch name was
free; no commit on it was altered.

`docs/REQ/todo/` on master still holds REQ-0288 and REQ-0289 — which is CORRECT, because
a REQ's status is its folder and that folder is the one on master. The branch's own
`todo -> built` moves never landed anywhere a reader would look. Nothing was lying; the
work simply never arrived.

## Why this needs a decision, not just a merge

- The branch predates 559 commits of master. `BoardRenderer.ts` alone took 7 of them;
  `ghosts.ts` 3; `shared/engine.js` 1. A rebase is a real merge exercise, not a fast-forward.
- REQ-0290 (landed 2026-08-03) **retired the unit seat core as a drag/rotate handle**.
  REQ-0289's central deliverable is *moving the ✥ badge onto the Unit seat* and
  *Unit-pivot rotation* — adjacent to, and partly overlapping, what REQ-0290 just changed.
  REQ-0288's BP-lift/ghost machinery is what REQ-0289 builds on. Any salvage must be
  re-reviewed against REQ-0290's design, not merely rebased.
- The branch also carries a committed `web/app/` bundle from 2026-07-22, which must be
  discarded and rebuilt regardless of the outcome.

## Options to rule between

1. **Salvage** — rebase/re-apply onto master, re-review against REQ-0290, re-run all gates,
   then `todo -> built` on master. Preserves ~1400 lines of reviewed work.
2. **Re-implement** — treat the branch as reference reading only, implement 0288/0289
   fresh from their (unchanged, still-accurate) specs. Cheaper to review, loses the diff.
3. **Retire** — decide the specs themselves are stale and re-open them as drafts.

## The real question underneath

Nothing detects an orphaned branch. This one was invisible for 12 days and was found only
because its NAME collided with a new REQ. Worth deciding whether that gets a guard (e.g. a
`git branch` sweep listing `req-*` branches with unmerged commits, in the deploy runbook or
a weekly check) — that guard, not the salvage, is the durable fix.

## Out of scope
- REQ-0290 itself (done).
- The 12 other live `req-*` worktrees, unless the sweep in the section above finds them
  in the same state — in which case they belong to this REQ too.
