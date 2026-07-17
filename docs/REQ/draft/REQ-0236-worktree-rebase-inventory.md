# REQ-0236 — worktree-rebase-inventory: retire or rebase every pre-0217 tree, then lift the freeze

## Status
draft — AGENT-FILED on user request (2026-07-17, chat, during the REQ-0234
wrap-up). Blocked on an owner decision before work may start: retiring a
worktree is destructive (PROJECT.md: never mass-delete unprompted), so the
per-tree dispositions below need ratification — blanket policy or tree by
tree.

## Why
- ~95 worktrees under ~/backpack_ragnarok_worktrees/ predate REQ-0217 (and
  all predate REQ-0234's merge, bc6c012). Until every tree is rebased or
  gone, the e2e freeze cannot be lifted, and none of the post-0234
  protections apply to them: the REQ-0231 whole-run CI lock, the scoped
  ci.sh [7/7], the fixed admin-harness wiring, and the immediate lock
  diagnostics all live in code those trees do not have.
- This is not theoretical: on 2026-07-17 an ORPHANED pre-0234 retry loop
  (/tmp/req0230_ci_retry.sh, its session long dead) re-ran old-code ci.sh
  for hours, parked its artadmin harness on the frozen box lock, and held
  the 156x port decade ~30 min per attempt — blocking the REQ-0234 gate run
  until killed by hand. Every stale tree is a potential repeat.
- The freeze itself is now reboot-persistent (backpack-e2e-freeze systemd
  user unit, REQ-0234 follow-up), so the ONLY remaining path to a live
  incident from old harness code is a stale worktree being run — which this
  REQ eliminates.

## What to do
1. Inventory: for each ~/backpack_ragnarok_worktrees/* record branch, base
   commit, REQ status on the board (done/built/todo/abandoned), dirty state,
   and last-touched time. The table lives HERE in this REQ file.
2. Disposition per tree, in order of preference:
   - REQ is done/ and tree is clean -> `git worktree remove` + delete or
     archive the branch (it is history; master has it).
   - REQ is still open and work continues -> rebase onto master >= bc6c012,
     re-provision (pnpm install in root, client/, server/ — REQ-0234 F5),
     and keep.
   - Tree is dirty / diverged with no owner session -> salvage review first
     (diff vs master), park anything valuable as a patch attached to its
     REQ, then remove. NEVER delete uncommitted work without the owner
     decision this draft is waiting for.
3. Special case, first in line: req-0230-perf-gate-load-immunity — REQ-0230
   is done via REQ-0234 ((a)+(b), cpu-time best-of-3 @150ms). Diff that
   branch; if its approach improves on the merged gate, fold the delta into
   a follow-up; otherwise retire the tree.
4. When (and only when) zero trees remain on a pre-35a8edc base (the
   REQ-0214/0217 merge): lift the freeze
   (`systemctl --user disable --now backpack-e2e-freeze`), record the lift
   in ~/.cache/backpack/E2E_FREEZE_README.txt and in this REQ, and delete
   the legacy-freeze paragraph from docs/llm_managed/e2e_harness.md.

## Out of scope
- Deleting ~/backpack_ragnarok_state/ or any non-worktree checkout.
- Changing the freeze mechanism itself; art-session worktrees
  (*-artsession) — HANDS OFF per PROJECT.md.

## Gates
- The inventory table is complete (every tree accounted for) and recorded
  here with its executed disposition.
- Zero worktrees based before 35a8edc; freeze lifted afterwards and a
  legacy `pnpm run e2e` from the main checkout then queues/runs instead of
  exit 75 (one recorded run).
- Nothing uncommitted was destroyed without an explicit owner decision
  logged in this file.

## Log
- 2026-07-17 reserved as REQ-0236 (843c227) on branch
  req-0234-e2e-effectiveness-audit; spec written; reserved -> draft
  awaiting the owner's disposition ratification.
