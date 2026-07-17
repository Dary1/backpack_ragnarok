# REQ-0231 - cross-session CI hygiene: one queue lock, scoped cleanup

**Reserved:** 2026-07-17 (observed during REQ-0216)
**Slug:** ci-cross-session-hygiene

## Problem

Multiple agent sessions run ci.sh concurrently on llmlocal. Two failure modes
observed on 2026-07-17:

1. NO SHARED QUEUE: the e2e box lock serialises only the Playwright phase;
   everything else (sim, pg, tsc, vite build, chromium warmup) runs
   concurrently across sessions. Sessions have converged on an AD-HOC
   `flock /tmp/bpk_ci.lock` convention (copied session-to-session, enforced
   nowhere), and when it is not used the box saturates -- load avg hit 13.7,
   sshd stopped answering for ~40 min, and the box eventually REBOOTED
   mid-CI.
2. UNSCOPED CLEANUP: a contentadmin_e2e Playwright run was SIGKILLed
   externally (exit 137, no OOM trace) -- consistent with another session
   cleaning up "stray" processes by name/pattern instead of by its own
   process group, killing across sessions.

## Proposal

- Move the CI queue INSIDE tools/ci.sh: take `flock` on a well-known lock
  (e.g. ~/.cache/backpack/ci.box.lock, beside the e2e lock) around the whole
  run; env seam CI_LOCK_NONBLOCK=1 to fail fast. The convention becomes
  machine-enforced instead of folklore.
- Audit every harness/cleanup path (tools/*_e2e.sh, e2e_run.sh, any pkill)
  to kill ONLY its own process group / recorded PIDs, never by bare pattern.
- Optional: a loadavg preflight in ci.sh that waits (with a note) instead of
  measuring perf gates on a saturated box (couples with REQ-0230).

## Gates

- Two ci.sh runs started concurrently serialise; the second waits, both green.
- A harness abort leaves no orphans and kills nothing outside its group.


## Implementation (2026-07-17, branch req-0231-ci-cross-session-hygiene)

- 0bfbecc: ci.sh takes an exclusive flock on ~/.cache/backpack/ci.box.lock for
  the WHOLE run (fd 8; fd 9 stays the e2e lock in e2e_run.sh, nesting fine).
  Seams: CI_LOCK_NONBLOCK=1 (exit 75), CI_LOCK_WAIT (default 7200),
  CI_LOCK_FILE (tests). The ad-hoc /tmp/bpk_ci.lock convention is retired;
  do NOT wrap ci.sh in an external flock of the same file (same-description
  deadlock, documented in ci.sh).
- Same commit: artadmin/art_inspect/content_admin harnesses setsid every
  service into its own process group; cleanup kills exactly those groups
  (TERM, 0.5s, KILL), INT/TERM traps guarantee the EXIT trap runs on abort.
  e2e_fleet killManifest kills recorded worker GROUPS (detached => pgid==pid).
  No kill-by-name/pattern anywhere.

## Gate evidence

- Queue mechanics (real ci.sh code path, test lock file): while an external
  holder had the lock, CI_LOCK_NONBLOCK=1 exited 75 with ZERO gates run; a
  default run queued 9s until release, then ran gates. Two back-to-back
  ci.sh runs on one lock serialised (each logged queueing -> acquired).
- Abort hygiene (art_inspect_e2e.sh on its 1520-1522 decade): SIGTERM to the
  in-flight harness freed all three ports, left no api/static/proxy orphans,
  and other sessions' listeners were untouched (count went 3 -> 6 during the
  window -- concurrent sessions kept starting things; nothing of theirs died).
- Cross-session live case observed during testing: req-0232's artadmin
  harness legitimately held 1560-1562; the port preflight aborted our run
  politely (exit 75) instead of anything killing anything. Working as
  intended.
- PENDING both-green full-CI x2: blocked by a PRE-EXISTING stale gate on
  master -- req0207_wildlands_test.cjs pins baseline counts 15/30/7, broken
  by the REQ-0219 batch-007 live promotion (fails identically on untouched
  master). The req-0230 session has an uncommitted fix in flight; per user
  ruling (2026-07-17, hold-and-check) we wait for that to land, then merge
  master and run the concurrent full-CI gate.
