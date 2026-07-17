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
